// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Explore an unfamiliar codebase.
 *
 * The mounted service has an ARCHITECTURE.md that is confidently wrong: it
 * describes a synchronous design the code abandoned. An agent that summarises
 * the documentation produces a fluent, useless answer.
 *
 * The recipe checks that the agent grounded itself in the code instead, then
 * mounts one more file into the already-running session to show that a session
 * is not sealed at creation.
 */
import { toFile } from '@runorca/orca-sdk';
import type { SessionResourceRequest } from '@runorca/orca-sdk/resources/sessions/resources';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const WORKDIR = '/mnt/session/uploads/orders-service';

/** Mounted up front. The late one is added after the first answer. */
const INITIAL = ['ARCHITECTURE.md', 'api.py', 'queue.py', 'payments.py', 'store.py'];
const LATE = 'worker.py';

const SYSTEM = `You are orienting an engineer who has just inherited a service.

The source is at ${WORKDIR}.

Documentation in a repository is a claim, not a fact. Read the code and let it
settle any disagreement. When the two conflict, say so plainly and say which
one you trust.

The shell tool is named mcp__orca__bash.`;

const FIRST = `Describe how this service handles an incoming order, end to end.

Be specific about whether payment happens inside the request or after it, and
what state an order is in when the caller gets a response.`;

const SECOND = `A file has just been added at ${WORKDIR}/${LATE}. Read it.

Does it change your account of what happens after an order is created? Say what
you got wrong before, if anything.`;

async function upload(orca: ReturnType<typeof createClient>['orca'], name: string) {
  const bytes = readFileSync(join(FIXTURES, name));
  const type = name.endsWith('.md') ? 'text/markdown' : 'text/x-python';
  return orca.files.upload({ file: await toFile(bytes, name, { type }) });
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const resources: SessionResourceRequest[] = [];
    for (const name of INITIAL) {
      const file = await upload(orca, name);
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file',
        file_id: file.id,
        mount_path: `${WORKDIR}/${name}`,
        access: 'read_only',
      });
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-explore-unfamiliar-codebase`,
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
      title: 'explore unfamiliar codebase',
      resources,
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    console.log('--- first pass: docs and code disagree ---');
    const first = await ask(orca, session.id, FIRST);
    assertGrounded(first.text);

    // The session is live and already has an opinion. Adding a resource now
    // means the next turn sees something the first one could not have.
    await waitForIdle(orca, session.id);
    const late = await upload(orca, LATE);
    cleanup.add(`file ${LATE}`, () => orca.files.delete(late.id));

    await orca.sessions.resources.add(session.id, {
      type: 'file',
      file_id: late.id,
      mount_path: `${WORKDIR}/${LATE}`,
      access: 'read_only',
    });
    console.log(`\nmounted ${LATE} into the running session\n`);

    console.log('--- second pass: after the late mount ---');
    const second = await ask(orca, session.id, SECOND, { fromCursor: first.cursor });

    if (!/worker/i.test(second.text)) {
      throw new Error('the agent did not engage with the file added mid-session');
    }

    console.log('\nagent grounded itself in the code and absorbed the late mount');
  });
}

/**
 * The failure this recipe is about is a confident summary of the stale doc, so
 * the check is for the asynchronous reality the code describes.
 */
function assertGrounded(text: string): void {
  const sawAsync = /async|queue|background|worker|202|pending/i.test(text);
  if (!sawAsync) {
    throw new Error(
      'the agent described the synchronous design from ARCHITECTURE.md, ' +
        'which the code contradicts - it summarised the docs instead of reading the source',
    );
  }
}
