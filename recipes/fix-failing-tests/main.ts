// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Fix failing tests.
 *
 * The entry-point recipe. An agent is given a module with planted bugs and its
 * test file, and iterates - run, read the failure, edit, run again - until the
 * suite is green. It is the smallest task that still needs the whole loop:
 * mounted files, a sandbox to run code in, and a stream to watch.
 */
import { toFile } from '@runorca/orca-sdk';
import type { SessionEvent } from '@runorca/orca-sdk/resources/sessions/events';
import type { SessionResourceRequest } from '@runorca/orca-sdk/resources/sessions/resources';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, readMessageText, trackSession, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** Read-only fixture source and persistent writable working copy. */
const SOURCE_DIR = '/mnt/session/uploads';
const WORKDIR = '/mnt/session/outputs/workdir';

// Run the original, read-only tests against the repaired working copy. Load
// unittest before adding the workdir so a copied unittest.py cannot shadow it.
// -I ignores PYTHONPATH and user site packages. This runs in the sandbox only.
const VERIFY_COMMAND = `cd ${WORKDIR} && python3 -I -c 'import runpy, sys, unittest; sys.path.insert(0, "."); runpy.run_path("${SOURCE_DIR}/test_calc.py", run_name="__main__")'`;

const SYSTEM = `You are fixing a small Python module so its test suite passes.

The source fixtures are read-only at ${SOURCE_DIR}. Before running anything,
create ${WORKDIR} and copy both files there. Work only on the copies in
${WORKDIR}; files under /mnt/session/outputs persist between tool calls.

Method:
- Run the suite first and read the actual failures. Do not guess from the source.
- Fix the module, never the tests. The tests define the intended behaviour.
- Some failures are entangled: one function calls another, so a fix can only be
  judged after its dependency is correct. Re-run after each change.
- Stop when the suite is green.
- If the shell cannot execute tests, report the limitation. Never invent output.

The shell tool is named mcp__orca__bash.`;

const TASK = `Copy calc.py and test_calc.py from ${SOURCE_DIR} to ${WORKDIR}.
Run the copied test suite there and make every test pass by editing calc.py.

As your final tool call, run this exact verification command without changing it:
${VERIFY_COMMAND}

It runs the original read-only tests against your repaired calc.py. Do not write
a result report or make any tool calls after it succeeds. The host checks the
actual bash tool result, not your summary or a file you write.`;

async function uploadFixture(
  upload: (file: File) => Promise<{ id: string }>,
  name: string,
): Promise<string> {
  const bytes = readFileSync(join(FIXTURES, name));
  const file = await toFile(bytes, name, { type: 'text/x-python' });
  const meta = await upload(file);
  return meta.id;
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId, created } = await bootstrap(orca, config);
    console.log(`environment ${environmentId}${created ? ' (created)' : ' (reused)'}`);

    // Uploaded files are workspace-scoped, so they are removed on the way out
    // rather than left to accumulate across runs.
    const fixtures = ['calc.py', 'test_calc.py'];
    const resources: SessionResourceRequest[] = [];

    for (const name of fixtures) {
      const fileId = await uploadFixture((file) => orca.files.upload({ file }), name);
      cleanup.add(`file ${name}`, () => orca.files.delete(fileId));
      resources.push({
        type: 'file',
        file_id: fileId,
        mount_path: `${SOURCE_DIR}/${name}`,
        access: 'read_only',
      });
      console.log(`uploaded ${name} -> ${fileId}`);
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-fix-failing-tests`,
      model: config.model,
      system: SYSTEM,
      tools: [
        {
          type: 'agent_toolset',
          // The agent needs to run and edit without stopping to ask; this
          // recipe is about the iteration loop, not about permissioning.
          default_config: { permission_policy: { type: 'always_allow' } },
        },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));
    console.log(`agent ${agent.id}`);

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'fix failing tests',
      resources,
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const result = await ask(orca, session.id, TASK, {
      capture: ['agent.tool_use', 'agent.tool_result'],
    });

    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}" instead of finishing`);
    }

    verifyExecution(result.captured);
  });
}

/**
 * Only the final tool call may certify the result: subsequent edits or runs
 * would invalidate it. An agent-written file is not execution evidence.
 */
function verifyExecution(events: SessionEvent[]): void {
  const call = events.findLast((event) => event.type === 'agent.tool_use');
  const input = call?.['input'];
  if (
    call?.['name'] !== 'mcp__orca__bash' ||
    typeof input !== 'object' ||
    input === null ||
    !('command' in input) ||
    input.command !== VERIFY_COMMAND
  ) {
    throw new Error('no verified test execution: the final tool call must run the exact verification command');
  }

  const result = events.slice(events.indexOf(call) + 1).find(
    (event) => event.type === 'agent.tool_result' && event['tool_use_id'] === call.id,
  );
  const text = result === undefined ? '' : readMessageText(result);

  // The fixture contains eight tests. Require the runner's complete summary
  // and the shell tool's exit status; zero tests and skipped tests do not pass.
  const passed = /(?:^|\n)Ran 8 tests in [0-9.]+s\r?\n\r?\nOK\s*\n\[exit_code\] 0\s*$/.test(text);
  if (result?.['is_error'] !== false || !passed) {
    throw new Error(`no verified test execution: expected eight passing tests and exit code 0. Tool result: ${text || '(missing)'}`);
  }

  console.log('--- verified bash test output ---');
  console.log(text.trim());
  console.log('---------------------------------');
  console.log('\nsuite is green, verified from the bash tool result');
}
