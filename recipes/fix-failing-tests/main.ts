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
import type { SessionResourceRequest } from '@runorca/orca-sdk/resources/sessions/resources';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** Read-only fixture source and persistent writable working copy. */
const SOURCE_DIR = '/mnt/session/uploads';
const WORKDIR = '/mnt/session/outputs/workdir';

/**
 * Bytes written under this path are captured as session output files, which is
 * how the recipe verifies the result rather than trusting the agent's summary.
 */
const REPORT_PATH = '/mnt/session/outputs/result.txt';
const REPORT_NAME = 'result.txt';

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

The shell tool is named mcp__orca__bash.`;

const TASK = `Copy calc.py and test_calc.py from ${SOURCE_DIR} to ${WORKDIR}.
Run the copied test suite there and make every test pass by editing calc.py.

When the suite is fully green, write the final unittest output to ${REPORT_PATH}
exactly as the test runner printed it, so the result can be checked independently.`;

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

    const result = await ask(orca, session.id, TASK);

    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}" instead of finishing`);
    }

    // The stream can report idle before the server has committed the turn, so
    // wait for the stored status before reading what the turn wrote.
    await waitForIdle(orca, session.id);
    await verifyReport(orca, session.id);
  });
}

/**
 * Check the captured output rather than the agent's own account of it.
 *
 * A summary saying the suite passed is not evidence; the runner's output is.
 */
async function verifyReport(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
): Promise<void> {
  const files = await orca.sessions.files.list(sessionId);

  const report = files.data?.find((file) => file.filename?.endsWith(REPORT_NAME));
  if (report === undefined) {
    const seen = files.data?.map((f) => f.filename).join(', ') || 'none';
    throw new Error(`the agent did not write ${REPORT_NAME}. Session files: ${seen}`);
  }

  const response = await orca.sessions.files.download(sessionId, report.id);
  const text = await response.text();

  console.log('--- captured test output ---');
  console.log(text.trim());
  console.log('----------------------------');

  const passed = /\bOK\b/.test(text) && !/\bFAILED\b/.test(text);
  if (!passed) {
    throw new Error('the captured output does not show a passing suite');
  }

  console.log('\nsuite is green, verified from captured output');
}
