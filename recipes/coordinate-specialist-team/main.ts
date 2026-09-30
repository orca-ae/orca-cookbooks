// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Coordinate a team whose members have different tools.
 *
 * The interesting part is not that work is delegated - it is that each
 * specialist gets a different surface. The pricing analyst can read the rules
 * file and run a shell to do arithmetic. The account researcher can read notes
 * but has no shell. The writer has neither: it only receives what the other two
 * found, so it cannot quietly go and look something up instead of using their
 * work.
 *
 * Scoping tools per role is how you keep a roster honest.
 */
import { toFile } from '@runorca/orca-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrap, createClient, streamUntilIdle, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const WORKDIR = '/mnt/session/uploads';

const BRIEF = `Northwind Logistics wants a quote. Produce a one-page proposal:
the recommended configuration, the price with the arithmetic shown, and the two
strongest reasons for them specifically. Flag anything that needs approval.`;

const COORDINATOR = `You are running a small proposal team.

Your team is a pricing analyst, an account researcher, and a proposal writer.
The analyst and the researcher can read files; the writer cannot, by design -
it works only from what you pass it.

Get the numbers and the account context first, then brief the writer with
everything it needs in the brief itself. Assemble the final proposal yourself.

Never state a price you have not had the analyst compute.`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const resources = [];
    for (const name of ['pricing-rules.md', 'account-notes.md']) {
      const bytes = readFileSync(join(FIXTURES, name));
      const file = await orca.files.upload({
        file: await toFile(bytes, name, { type: 'text/markdown' }),
      });
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file' as const,
        file_id: file.id,
        mount_path: `${WORKDIR}/${name}`,
        access: 'read_only' as const,
      });
    }

    // Reads the rules and does the arithmetic in a shell rather than in its
    // head - tiered pricing with a floor is exactly where mental maths slips.
    const analyst = await orca.agents.create({
      name: `${config.prefix}-pricing-analyst`,
      model: config.model,
      system: `You compute prices from the rules at ${WORKDIR}/pricing-rules.md.

Read the rules before quoting anything. Do the arithmetic with the shell rather
than in your head, and show each step: list price, volume tier, term
adjustment, resulting per-seat price. Check every floor and say explicitly
which ones bind.

The shell tool is named mcp__orca__bash.`,
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
      ],
    });
    cleanup.add('agent analyst', () => orca.agents.archive(analyst.id));

    // Reads, but no shell. Nothing here needs to execute anything.
    const researcher = await orca.agents.create({
      name: `${config.prefix}-account-researcher`,
      model: config.fastModel,
      system: `You summarise what is known about an account from
${WORKDIR}/account-notes.md.

Report what is stated and what it implies for a proposal - constraints,
deadlines, stated objections, prior history. Separate what the notes say from
what you are inferring. Do not invent detail.

The read tool is named mcp__orca__read.`,
      tools: [
        {
          type: 'agent_toolset',
          // Reading is all this role needs. A tool that isn't disabled stays
          // enabled, so turn everything off and name the tools it keeps. This
          // takes the shell away; it doesn't hide files. Every file mounted in
          // the session is readable, the pricing rules included.
          default_config: { enabled: false, permission_policy: { type: 'always_allow' } },
          configs: [
            { name: 'read', enabled: true },
            { name: 'glob', enabled: true },
            { name: 'grep', enabled: true },
          ],
        },
      ],
    });
    cleanup.add('agent researcher', () => orca.agents.archive(researcher.id));

    // No tools at all. It writes from the brief it is given.
    const writer = await orca.agents.create({
      name: `${config.prefix}-proposal-writer`,
      model: config.model,
      system: `You write short client-facing proposals.

You work only from the brief you are given. You have no file access and no
shell. If the brief is missing something you need, say what is missing rather
than guessing or inventing a number.

Plain language. No filler. Never restate the client's own request back to them.`,
    });
    cleanup.add('agent writer', () => orca.agents.archive(writer.id));

    const coordinator = await orca.agents.create({
      name: `${config.prefix}-proposal-coordinator`,
      model: config.model,
      system: COORDINATOR,
      multiagent: { type: 'coordinator', agents: [analyst.id, researcher.id, writer.id] },
    });
    cleanup.add('agent coordinator', () => orca.agents.archive(coordinator.id));

    const session = await orca.sessions.create({
      agent: coordinator.id,
      environment_id: environmentId,
      title: 'Northwind proposal',
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
    check(result.text);
  });
}

/**
 * 340 seats sits in the 100-499 tier at 18%, and they asked about two years,
 * which takes another 8% off. 1200 -> 984 -> 905.28, comfortably above both
 * floors. The proposal should land near that number and should not claim a
 * floor was breached.
 */
function check(text: string): void {
  const quoted = /9[0-9]{2}(\.\d+)?/.test(text) || /905/.test(text);
  if (!quoted) {
    console.warn(
      '\nnote: expected a per-seat price near 905.28 (18% volume, then 8% for two years).',
    );
  }
  if (!/two[- ]year|2[- ]year/i.test(text)) {
    throw new Error('the proposal ignored the two-year commitment the account asked about');
  }
  console.log('\nproposal assembled from scoped specialists');
}
