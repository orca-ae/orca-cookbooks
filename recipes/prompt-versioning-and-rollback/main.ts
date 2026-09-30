// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Version a system prompt, measure a regression, and roll back.
 *
 * An agent's system prompt is not a string you edit in place - each update
 * makes a new immutable version, and a session can be pinned to any of them.
 * That turns prompt changes into something you can evaluate and revert rather
 * than something you hope about.
 *
 * The recipe ships v1, scores it against labelled tickets, ships a v2 that
 * reads like an improvement and is not, catches the regression, and pins new
 * work back to v1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, waitForIdle, withCleanup, type Cleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const LABELS = ['billing', 'bug', 'feature_request'] as const;

/** The prompt in production. Plain, and it works. */
const V1 = `You classify customer support tickets.

Reply with exactly one of: billing, bug, feature_request.
Reply with the label alone - no punctuation, no explanation.`;

/**
 * The tempting rewrite. More guidance, more words, and a sentence that quietly
 * redirects anything money-shaped away from billing. It reads like a
 * refinement, which is exactly why it needs measuring rather than reviewing.
 */
const V2 = `You are an expert support triage specialist with deep product knowledge.

Classify each ticket into one of: billing, bug, feature_request.

Think carefully about user intent rather than surface wording. A ticket that
describes something not working the way the user expected is a bug, even when
it mentions money, charges, invoices, or refunds - those are usually symptoms
of an underlying defect rather than true billing matters.

Reply with the label alone.`;

interface Ticket {
  id: string;
  text: string;
  label: string;
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();
  const tickets = readTickets();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    // No toolset. This agent only classifies, so giving it a sandbox would add
    // startup cost and a surface it has no use for.
    const agent = await orca.agents.create({
      name: `${config.prefix}-ticket-triage`,
      model: config.model,
      system: V1,
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));
    console.log(`agent ${agent.id} at version ${agent.version}`);

    const v1 = agent.version;
    const scoreV1 = await evaluate(orca, config, environmentId, agent.id, v1, tickets, cleanup);
    console.log(`\nv${v1} scored ${scoreV1}/${tickets.length}\n`);

    // Updating produces a new immutable version; v1 does not change.
    const updated = await orca.agents.update(agent.id, { system: V2 });
    const v2 = updated.version;
    console.log(`shipped v${v2}`);

    const scoreV2 = await evaluate(orca, config, environmentId, agent.id, v2, tickets, cleanup);
    console.log(`\nv${v2} scored ${scoreV2}/${tickets.length}\n`);

    const versions = [];
    for await (const snapshot of orca.agents.versions.list(agent.id)) {
      versions.push(snapshot.version);
    }
    console.log(`versions on record: ${versions.sort((a, b) => a - b).join(', ')}`);

    if (scoreV2 >= scoreV1) {
      console.log('\nv2 did not regress on this set; nothing to roll back');
      return;
    }

    console.log(`\nv${v2} regressed against v${v1}. Pinning new sessions back to v${v1}.`);

    // Rolling back is not an edit. The prompt history is intact; new work is
    // simply pinned to the version that measured better.
    const pinned = await orca.sessions.create({
      agent: { type: 'agent', id: agent.id, version: v1 },
      environment_id: environmentId,
      title: `pinned to v${v1}`,
    });
    trackSession(cleanup, orca, pinned.id);
    console.log(`session ${pinned.id} is running v${v1} while v${v2} stays on the agent`);
  });
}

/** Run every ticket through one pinned version and count exact matches. */
async function evaluate(
  orca: ReturnType<typeof createClient>['orca'],
  config: ReturnType<typeof createClient>['config'],
  environmentId: string,
  agentId: string,
  version: number,
  tickets: Ticket[],
  cleanup: Cleanup,
): Promise<number> {
  console.log(`--- evaluating v${version} ---`);
  let correct = 0;

  for (const ticket of tickets) {
    const session = await orca.sessions.create({
      agent: { type: 'agent', id: agentId, version },
      environment_id: environmentId,
      title: `eval v${version} ${ticket.id}`,
    });
    trackSession(cleanup, orca, session.id);

    const result = await ask(orca, session.id, ticket.text, { echo: false });
    const predicted = normalise(result.text);
    const hit = predicted === ticket.label;
    if (hit) correct += 1;

    console.log(`  ${ticket.id}  ${hit ? 'ok  ' : 'MISS'}  want=${ticket.label} got=${predicted}`);
    await waitForIdle(orca, session.id);
  }

  return correct;
}

/** Pick a known label out of the reply, so stray punctuation is not a miss. */
function normalise(text: string): string {
  const lowered = text.toLowerCase();
  for (const label of LABELS) {
    if (lowered.includes(label)) return label;
  }
  return lowered.trim().split(/\s+/)[0] ?? '';
}

function readTickets(): Ticket[] {
  const text = readFileSync(join(FIXTURES, 'tickets.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Ticket);
}
