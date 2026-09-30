// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Take an issue through to a merged pull request.
 *
 * Three turns on one session, each reacting to something the previous turn
 * could not have known:
 *
 *   1. read the issue, fix the bug, open a PR
 *   2. CI fails, as the mock's first run always does, and has to be re-run
 *   3. a reviewer asks for a change, then it merges once a run passes
 *
 * The recipe is about steering a session that is already in motion. Each turn
 * resumes from the last cursor, so the agent keeps the context it built rather
 * than re-reading the repository every time.
 */
import { toFile } from '@runorca/orca-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const SOURCE_DIR = '/mnt/session/uploads/orders-fixture';
const WORKDIR = '/mnt/session/outputs/orders';

const FILES = ['gh', 'issue-42.json', 'pricing.py', 'test_pricing.py'];

const SYSTEM = `You are working an issue through to a merged pull request.

The source fixture is read-only at ${SOURCE_DIR}. At the start, copy every file
from there into the persistent writable checkout at ${WORKDIR}.

A 'gh' command is in the writable checkout too - run it as
'python3 ${WORKDIR}/gh ...'. It is the only way to see the issue, open a PR,
read CI, read review comments, or merge.

Ground rules:
- Read the issue before changing anything.
- Fix the source. If a test was too weak to catch the bug, strengthen it.
- Never claim CI passed without running 'gh pr checks' and reading the output.

The shell tool is named mcp__orca__bash.`;

const TURNS = [
  `Read issue 42, fix what it describes, and open a pull request for it.`,

  `Run the CI checks on that pull request. If they fail, fix what they caught
and run them again until they pass.`,

  `Read the review comments on the pull request, do what the reviewer asked,
re-run the checks, and merge once they are green.`,
];

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const resources = [];
    for (const name of FILES) {
      const bytes = readFileSync(join(FIXTURES, name));
      const file = await orca.files.upload({
        file: await toFile(bytes, name, { type: 'text/plain' }),
      });
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file' as const,
        file_id: file.id,
        mount_path: `${SOURCE_DIR}/${name}`,
        access: 'read_only' as const,
      });
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-issue-to-pr`,
      model: config.model,
      system: SYSTEM,
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'issue 42 to merged PR',
      resources,
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    // Threading the cursor is what makes these turns rather than three
    // conversations. Without it each stream would replay from the beginning.
    let cursor: string | undefined;
    let transcript = '';

    for (const [index, turn] of TURNS.entries()) {
      console.log(`\n--- turn ${index + 1} ---`);
      const result = await ask(orca, session.id, turn, { fromCursor: cursor });

      if (result.stopReason !== 'end_turn') {
        throw new Error(`turn ${index + 1} stopped with "${result.stopReason}"`);
      }
      cursor = result.cursor;
      transcript += `\n${result.text}`;
    }

    if (!/merged/i.test(transcript)) {
      throw new Error('the agent never reported merging the pull request');
    }
    console.log('\nissue taken through CI failure and review to a merge');
  });
}
