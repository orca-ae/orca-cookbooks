// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { Cleanup, withCleanup } from './cleanup.js';

test('resources are released in reverse order of registration', async () => {
  const cleanup = new Cleanup();
  const released: string[] = [];
  cleanup.add('file', async () => released.push('file'));
  cleanup.add('agent', async () => released.push('agent'));
  await cleanup.run();
  assert.deepEqual(released, ['agent', 'file']);
});

test('entries added with addFirst are released before everything else', async () => {
  const cleanup = new Cleanup();
  const released: string[] = [];
  cleanup.add('file', async () => released.push('file'));
  cleanup.addFirst('session', async () => released.push('session'));
  // Registered after the session, as a file added to a running session is.
  cleanup.add('late file', async () => released.push('late file'));
  await cleanup.run();
  assert.deepEqual(released, ['session', 'late file', 'file']);
});

test('a failed release is reported and the rest still run', async () => {
  const cleanup = new Cleanup();
  const released: string[] = [];
  cleanup.add('file', async () => released.push('file'));
  cleanup.add('agent', async () => {
    throw new Error('boom');
  });
  await cleanup.run();
  assert.deepEqual(released, ['file']);
});

test('resources registered while a run is in progress are released too', async () => {
  const cleanup = new Cleanup();
  const released: string[] = [];
  // A session whose create call was in flight when cleanup started.
  cleanup.add('resource', async () => {
    released.push('resource');
    cleanup.addFirst('late session', async () => released.push('late session'));
  });
  await cleanup.run();
  assert.deepEqual(released, ['resource', 'late session']);
});

test('concurrent runs release each resource once', async () => {
  const cleanup = new Cleanup();
  let count = 0;
  cleanup.add('slow', async () => {
    count += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await Promise.all([cleanup.run(), cleanup.run()]);
  assert.equal(count, 1);
});

test('withCleanup releases on failure and rethrows the original error', async () => {
  const released: string[] = [];
  await assert.rejects(
    withCleanup(async (cleanup) => {
      cleanup.add('file', async () => released.push('file'));
      throw new Error('recipe failed');
    }),
    /recipe failed/,
  );
  assert.deepEqual(released, ['file']);
});

/**
 * Run a recipe-shaped script in a child process and send it SIGINTs, the first
 * when `trigger` appears in its output, then one per entry in `laterMs` (each
 * measured from the first). Returns the output, exit code and elapsed time.
 */
async function interruptChild(body: string[], trigger: string, laterMs: number[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-signal-'));
  try {
    // .mts: the temp dir has no package.json, and top-level await needs ESM.
    const script = join(dir, 'recipe.mts');
    const moduleURL = (name: string) =>
      JSON.stringify(pathToFileURL(join(import.meta.dirname, name)).href);
    const names = body.some((line) => line.includes('throwIfStopped'))
      ? 'throwIfStopped, withCleanup'
      : 'withCleanup';
    const imports = [`import { ${names} } from ${moduleURL('cleanup.ts')};`];
    if (body.some((line) => line.includes('ask('))) {
      imports.push(`import { ask } from ${moduleURL('stream.ts')};`);
    }
    writeFileSync(
      script,
      [
        ...imports,
        'const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));',
        ...body,
      ].join('\n'),
    );

    const started = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let interrupted = false;
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (!interrupted && output.includes(trigger)) {
        interrupted = true;
        child.kill('SIGINT');
        for (const ms of laterMs) setTimeout(() => child.kill('SIGINT'), ms);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    return { output, code, elapsed: Date.now() - started };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A pending timer keeps the process alive, as a recipe's open stream does.
const WAIT_FOREVER = '  await sleep(60_000);';

test('Ctrl-C releases resources before the process exits', async () => {
  const { output, code } = await interruptChild(
    [
      'await withCleanup(async (cleanup) => {',
      "  cleanup.add('file', async () => { console.log('released file'); });",
      "  console.log('ready');",
      WAIT_FOREVER,
      '});',
    ],
    'ready',
  );
  assert.match(output, /released file/);
  assert.equal(code, 130, output);
});

test('one Ctrl-C relayed as two signals still finishes cleanup', async () => {
  // A package-manager script and the tsx wrapper each forward the terminal's
  // SIGINT, so the recipe can receive the same Ctrl-C twice, milliseconds apart.
  const { output, code } = await interruptChild(
    [
      'await withCleanup(async (cleanup) => {',
      "  cleanup.add('file', async () => { await sleep(300); console.log('released file'); });",
      "  console.log('ready');",
      WAIT_FOREVER,
      '});',
    ],
    'ready',
    [30],
  );
  assert.match(output, /released file/);
  assert.equal(code, 130, output);
});

test('a second Ctrl-C more than a second later skips cleanup', async () => {
  const { output, code, elapsed } = await interruptChild(
    [
      'await withCleanup(async (cleanup) => {',
      "  cleanup.add('file', async () => { await sleep(10_000); console.log('released file'); });",
      "  console.log('ready');",
      WAIT_FOREVER,
      '});',
    ],
    'ready',
    [1_200],
  );
  assert.doesNotMatch(output, /released file/);
  assert.equal(code, 130, output);
  assert.ok(elapsed < 6_000, `took ${elapsed}ms`);
});

test('after Ctrl-C, ask() does not start another turn', async () => {
  // The fake session ends each turn after 200ms, while releasing takes a full
  // second: long enough for a recipe that didn't stop to send its next turn.
  const { output, code } = await interruptChild(
    [
      'const orca = { sessions: { events: {',
      "  send: async () => { console.log('sent turn'); return {}; },",
      '  stream: async () => (async function* () {',
      '    await sleep(200);',
      "    yield { id: 'evt_idle', type: 'session.status_idle', stop_reason: { type: 'end_turn' } };",
      '  })(),',
      '} } };',
      'await withCleanup(async (cleanup) => {',
      "  cleanup.add('file', async () => { await sleep(1_000); console.log('released file'); });",
      '  for (let turn = 1; turn <= 3; turn += 1) {',
      "    await ask(orca as never, 'sesn_1', `turn ${turn}`, { echo: false });",
      '  }',
      "  console.log('all turns done');",
      '});',
    ],
    'sent turn',
  );
  assert.equal(output.match(/sent turn/g)?.length, 1, output);
  assert.match(output, /released file/);
  assert.doesNotMatch(output, /all turns done/);
  assert.equal(code, 130, output);
});

test('Ctrl-C stops the recipe body at its next turn boundary', async () => {
  const { output, code } = await interruptChild(
    [
      'await withCleanup(async (cleanup) => {',
      "  cleanup.add('file', async () => { console.log('released file'); });",
      '  for (let turn = 1; turn <= 5; turn += 1) {',
      '    console.log(`turn ${turn}`);',
      '    await sleep(200);',
      '    throwIfStopped();',
      '  }',
      '});',
    ],
    'turn 1',
  );
  assert.match(output, /released file/);
  assert.doesNotMatch(output, /turn 3/);
  assert.equal(code, 130, output);
});
