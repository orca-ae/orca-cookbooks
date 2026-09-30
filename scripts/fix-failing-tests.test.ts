// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import type { SessionEvent } from '@runorca/orca-sdk/resources/sessions/events';

import run from '../recipes/fix-failing-tests/main.js';

const GREEN = '........\n----------------------------------------------------------------------\nRan 8 tests in 0.001s\n\nOK\n';
const COMMAND = `cd /mnt/session/outputs/workdir && python3 -I -c 'import runpy, sys, unittest; sys.path.insert(0, "."); runpy.run_path("/mnt/session/uploads/test_calc.py", run_name="__main__")'`;

function execution(text = `${GREEN}\n[exit_code] 0`, isError = false): SessionEvent[] {
  return [
    { id: 'verify', type: 'agent.tool_use', name: 'mcp__orca__bash', input: { command: COMMAND } },
    { id: 'result', type: 'agent.tool_result', tool_use_id: 'verify', is_error: isError, content: [{ type: 'text', text }] },
  ];
}

/** Exercise the actual recipe and SDK against a local HTTP/SSE deployment. */
async function deployment(t: TestContext, events: SessionEvent[]) {
  const releases: string[] = [];
  const messages: string[] = [];
  const requests: string[] = [];
  let uploads = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const route = `${request.method} ${request.url}`;
    requests.push(route);
    response.setHeader('content-type', 'application/json');
    const json = (value: unknown) => response.end(JSON.stringify(value));
    if (request.method === 'DELETE' || request.url?.endsWith('/archive')) {
      releases.push(route);
      json({});
    } else if (route === 'GET /v1/environments') {
      json({ data: [{ id: 'env_test', name: 'test-cookbook' }], next_page: null });
    } else if (route === 'POST /v1/files') {
      json({ id: `file_${++uploads}` });
    } else if (route === 'POST /v1/agents') {
      json({ id: 'agt_test' });
    } else if (route === 'POST /v1/sessions' || route === 'GET /v1/sessions/ses_test') {
      json({ id: 'ses_test', status: 'idle' });
    } else if (route === 'POST /v1/sessions/ses_test/events') {
      messages.push(body);
      json({ data: [] });
    } else if (route === 'GET /v1/sessions/ses_test/events/stream') {
      response.setHeader('content-type', 'text/event-stream');
      for (const event of [...events, { id: 'idle', type: 'session.status_idle', stop_reason: { type: 'end_turn' } }]) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      response.end();
    } else if (route === 'GET /v1/sessions/ses_test/files') {
      // A convincing but agent-written report must never be sufficient.
      json({ data: [{ id: 'report', filename: 'result.txt' }], has_more: false });
    } else if (route === 'GET /v1/sessions/ses_test/files/report/content') {
      response.end(GREEN);
    } else {
      response.statusCode = 400;
      json({ error: { message: `unexpected request: ${route}` } });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  for (const [key, value] of Object.entries({
    ORCA_BASE_URL: `http://127.0.0.1:${address.port}`,
    ORCA_API_KEY: 'test-key',
    ORCA_MODEL: 'test-model',
    ORCA_RESOURCE_PREFIX: 'test-cookbook',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  return { releases, messages, requests };
}

test('an agent-written passing report without test execution fails and cleans up', async (t) => {
  const { releases } = await deployment(t, [
    { id: 'write', type: 'agent.tool_use', name: 'mcp__orca__write', input: { path: '/mnt/session/outputs/result.txt', content: GREEN } },
    { id: 'summary', type: 'agent.message', content: [{ type: 'text', text: 'All tests pass.' }] },
  ]);
  await assert.rejects(run(), /no verified test execution/i);
  assert.deepEqual(releases, [
    'DELETE /v1/sessions/ses_test',
    'POST /v1/agents/agt_test/archive',
    'DELETE /v1/files/file_2',
    'DELETE /v1/files/file_1',
  ]);
});

test('the exact verification command and its successful tool result pass', async (t) => {
  const { messages, releases, requests } = await deployment(t, execution());
  await run();
  assert.ok(messages.some((message) => message.includes(JSON.stringify(COMMAND).slice(1, -1))));
  assert.ok(!requests.some((request) => request.includes('/sessions/ses_test/files')));
  assert.equal(releases[0], 'DELETE /v1/sessions/ses_test');
});

for (const [name, text, isError] of [
  ['disabled bash', '[stderr]\nbash disabled: cannot isolate subprocess writes\n[exit_code] 126', true],
  ['failed tests', 'Ran 8 tests in 0.001s\n\nFAILED (failures=4)\n[exit_code] 1', true],
  ['nonzero exit despite OK', `${GREEN}\n[exit_code] 1`, false],
  ['missing exit status', GREEN, false],
  ['zero tests', 'Ran 0 tests in 0.001s\n\nOK\n[exit_code] 0', false],
  ['skipped tests', 'Ran 8 tests in 0.001s\n\nOK (skipped=8)\n[exit_code] 0', false],
  ['tool error despite passing text', `${GREEN}\n[exit_code] 0`, true],
] as const) {
  test(`${name} cannot be rescued by a passing report`, async (t) => {
    await deployment(t, execution(text, isError));
    await assert.rejects(run(), /no verified test execution/i);
  });
}

test('a passing result for another tool call is not verification', async (t) => {
  const events = execution();
  events[1] = { ...events[1]!, tool_use_id: 'unrelated' };
  await deployment(t, events);
  await assert.rejects(run(), /no verified test execution/i);
});

test('a verification call without a tool result fails', async (t) => {
  await deployment(t, execution().slice(0, 1));
  await assert.rejects(run(), /no verified test execution/i);
});

test('echoing a green summary is not running the verification command', async (t) => {
  const events = execution();
  events[0] = { ...events[0]!, input: { command: `printf '${GREEN}'` } };
  await deployment(t, events);
  await assert.rejects(run(), /no verified test execution/i);
});

test('a tool call after a passing run invalidates that run', async (t) => {
  await deployment(t, [
    ...execution(),
    { id: 'edit', type: 'agent.tool_use', name: 'mcp__orca__write', input: { path: '/mnt/session/outputs/workdir/calc.py', content: 'broken' } },
  ]);
  await assert.rejects(run(), /no verified test execution/i);
});
