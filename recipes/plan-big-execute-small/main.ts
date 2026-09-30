// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Plan big, execute small.
 *
 * A coordinator that reads six documents itself ends the job carrying six
 * documents in its context, and the quality of its synthesis degrades as that
 * context fills with raw material it no longer needs.
 *
 * The alternative is to spend context deliberately: the coordinator plans,
 * hands each document to a worker whose whole job is that document, and
 * receives back a summary rather than the source. The reading is delegated;
 * the thinking is not.
 */
import { toFile } from '@runorca/orca-sdk';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrap, createClient, streamUntilIdle, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'corpus');
const CORPUS = '/mnt/session/uploads/corpus';

const BRIEF = `We are writing a client library against this API. Read the
reference material and tell me the three things most likely to cause a
production incident for a client that gets them wrong, and what a library
should do about each.`;

const COORDINATOR = `You are leading a review of API reference material.

The documents are at ${CORPUS}. You have a roster of readers.

Work this way:
- List the documents first. Do not read their contents yourself.
- Give each document to a reader, in parallel. A reader gets one document.
- Ask each reader for what a client integrator must not get wrong, and any
  caveat that would bite someone who only read the happy path.
- Synthesise their reports into the final answer.

You are the only one who sees the whole picture, so keep your context for that.
Reading the documents yourself defeats the arrangement.`;

const READER = `You read one document and report on it.

Report:
- What a client integrator must not get wrong.
- Any caveat or known gap, stated plainly, especially one that only bites in
  production or at scale.
- Nothing else. No preamble, no restating the document.

Be brief. Your report is one input among several.

The read tool is named mcp__orca__read.`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const names = readdirSync(FIXTURES).filter((n) => n.endsWith('.md')).sort();
    const resources = [];
    for (const name of names) {
      const bytes = readFileSync(join(FIXTURES, name));
      const file = await orca.files.upload({
        file: await toFile(bytes, name, { type: 'text/markdown' }),
      });
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file' as const,
        file_id: file.id,
        mount_path: `${CORPUS}/${name}`,
        access: 'read_only' as const,
      });
    }
    console.log(`${names.length} documents mounted`);

    // Readers are cheap and identical. One agent definition serves every
    // document; the coordinator decides how many run at once.
    const reader = await orca.agents.create({
      name: `${config.prefix}-document-reader`,
      model: config.fastModel,
      system: READER,
      tools: [
        {
          type: 'agent_toolset',
          // A tool that isn't disabled stays enabled, so turn everything off
          // and name the tools this role keeps.
          default_config: { enabled: false, permission_policy: { type: 'always_allow' } },
          configs: [
            { name: 'read', enabled: true },
            { name: 'glob', enabled: true },
            { name: 'grep', enabled: true },
          ],
        },
      ],
    });
    cleanup.add('agent reader', () => orca.agents.archive(reader.id));

    const coordinator = await orca.agents.create({
      name: `${config.prefix}-review-coordinator`,
      model: config.model,
      system: COORDINATOR,
      multiagent: { type: 'coordinator', agents: [reader.id] },
      tools: [
        {
          type: 'agent_toolset',
          // Enough to see what exists, not enough to read it: glob lists paths,
          // and grep would print contents, so it stays off with everything
          // else. The constraint is in the tool surface, not only in the prompt.
          default_config: { enabled: false, permission_policy: { type: 'always_allow' } },
          configs: [{ name: 'glob', enabled: true }],
        },
      ],
    });
    cleanup.add('agent coordinator', () => orca.agents.archive(coordinator.id));

    const session = await orca.sessions.create({
      agent: coordinator.id,
      environment_id: environmentId,
      title: 'API review, fanned out',
      resources,
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: BRIEF }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const result = await streamUntilIdle(orca, session.id);
    if (result.stopReason !== 'end_turn') {
      throw new Error(`coordinator stopped with "${result.stopReason}"`);
    }

    await waitForIdle(orca, session.id);
    await report(orca, session.id, result.text);
  });
}

async function report(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
  text: string,
): Promise<void> {
  let threads = 0;
  for await (const _thread of orca.sessions.threads.list(sessionId)) threads += 1;
  console.log(`\n${threads} thread(s) - one coordinator plus its readers`);

  if (threads < 2) {
    throw new Error(
      'the coordinator never delegated. It has no read tool, so it likely reported ' +
        'that it could not read the documents rather than handing them out.',
    );
  }

  // Each document hides one caveat that only bites in production. A synthesis
  // built from the happy path will not mention any of them.
  const caveats: [string, RegExp][] = [
    ['refresh token reuse / revocation lag', /revocation|reuse|token family|eventually consistent/i],
    ['burst allowance across regions', /burst|multi-?region|4x/i],
    ['webhook retry replay window', /replay|timestamp|retry/i],
    ['idempotency key not keyed on body', /idempotenc/i],
  ];

  console.log('\ncaveats surfaced in the synthesis:');
  let found = 0;
  for (const [label, pattern] of caveats) {
    const hit = pattern.test(text);
    if (hit) found += 1;
    console.log(`  ${hit ? 'yes' : ' no'}  ${label}`);
  }

  if (found === 0) {
    throw new Error('the synthesis surfaced none of the production caveats');
  }
  console.log(`\n${found}/${caveats.length} caveats reached the coordinator through its readers`);
}
