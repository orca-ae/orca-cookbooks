// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Gate an agent behind a human decision.
 *
 * The agent classifies expenses but cannot act on them. Both of its tools are
 * custom tools, which means the engine stops the turn and hands the call back
 * to this process. Approving and escalating happen here, in host code, against
 * a ledger the agent cannot reach.
 *
 * That is the point. The agent's judgement is a proposal; the authority to
 * record it stays outside the sandbox.
 */
import { toFile } from '@runorca/orca-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bootstrap,
  createClient,
  runToolLoop,
  trackSession,
  withCleanup,
  type ToolHandlers,
} from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const WORKDIR = '/mnt/session/uploads';

const SYSTEM = `You are triaging expense claims against a written policy.

The policy is at ${WORKDIR}/policy.md and the claims are at
${WORKDIR}/expenses.jsonl. Read both before deciding anything.

You cannot record decisions yourself. Call decide() to approve or reject, and
escalate() when the policy says a human must look. Every claim must end up in
exactly one of those two calls. Work through them one at a time.

The shell tool is named mcp__orca__bash.`;

const TASK = `Read the policy and the claims, then decide every claim.`;

/** What the agent proposed, recorded on this side of the boundary. */
interface Ledger {
  approved: string[];
  rejected: string[];
  escalated: string[];
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const resources = [];
    for (const name of ['policy.md', 'expenses.jsonl']) {
      const bytes = readFileSync(join(FIXTURES, name));
      const file = await orca.files.upload({
        file: await toFile(bytes, name, { type: 'text/plain' }),
      });
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file' as const,
        file_id: file.id,
        mount_path: `${WORKDIR}/${name}`,
        access: 'read_only' as const,
      });
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-human-in-the-loop-gate`,
      model: config.model,
      system: SYSTEM,
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
        {
          type: 'custom',
          name: 'decide',
          description:
            'Record a final decision on one expense claim. Use only when the policy is unambiguous.',
          input_schema: {
            type: 'object',
            properties: {
              expense_id: { type: 'string' },
              decision: { type: 'string', enum: ['approve', 'reject'] },
              reason: { type: 'string', description: 'The policy rule this follows from.' },
            },
            required: ['expense_id', 'decision', 'reason'],
          },
        },
        {
          type: 'custom',
          name: 'escalate',
          description: 'Hand one expense claim to a human reviewer.',
          input_schema: {
            type: 'object',
            properties: {
              expense_id: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['expense_id', 'reason'],
          },
        },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'expense triage',
      resources,
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: TASK }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const ledger: Ledger = { approved: [], rejected: [], escalated: [] };
    const handlers = buildHandlers(ledger);

    const result = await runToolLoop(orca, session.id, handlers, { echo: true });
    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}"`);
    }

    report(ledger);
  });
}

/**
 * Host-side enforcement.
 *
 * `decide` re-checks the amount rather than trusting the agent, so a wrong
 * approval is refused at the boundary instead of being recorded. The refusal
 * goes back as a tool error, which the agent can read and act on.
 */
function buildHandlers(ledger: Ledger): ToolHandlers {
  const claims = readClaims();

  return {
    decide(input) {
      const id = String(input['expense_id'] ?? '');
      const decision = String(input['decision'] ?? '');
      const claim = claims.get(id);

      if (claim === undefined) throw new Error(`no such expense: ${id}`);

      if (decision === 'approve' && claim.amount_usd > 200) {
        throw new Error(
          `refusing to approve ${id}: ${claim.amount_usd} USD is over the 200 limit, ` +
            'the policy requires escalate() for this claim',
        );
      }

      (decision === 'approve' ? ledger.approved : ledger.rejected).push(id);
      return { recorded: true, expense_id: id, decision };
    },

    escalate(input) {
      const id = String(input['expense_id'] ?? '');
      if (!claims.has(id)) throw new Error(`no such expense: ${id}`);
      ledger.escalated.push(id);
      return { recorded: true, expense_id: id, queued_for_review: true };
    },
  };
}

interface Claim {
  id: string;
  amount_usd: number;
}

function readClaims(): Map<string, Claim> {
  const text = readFileSync(join(FIXTURES, 'expenses.jsonl'), 'utf8');
  const claims = new Map<string, Claim>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const claim = JSON.parse(line) as Claim;
    claims.set(claim.id, claim);
  }
  return claims;
}

function report(ledger: Ledger): void {
  console.log('\n--- ledger, written by this process ---');
  console.log(`  approved:  ${ledger.approved.join(', ') || '(none)'}`);
  console.log(`  rejected:  ${ledger.rejected.join(', ') || '(none)'}`);
  console.log(`  escalated: ${ledger.escalated.join(', ') || '(none)'}`);

  const total = ledger.approved.length + ledger.rejected.length + ledger.escalated.length;
  if (total !== 5) {
    throw new Error(`expected all 5 claims to be decided, got ${total}`);
  }
  if (!ledger.escalated.includes('exp-2')) {
    throw new Error('exp-2 is 880 USD and must be escalated, not decided');
  }
  if (!ledger.escalated.includes('exp-4')) {
    throw new Error('exp-4 is from a contractor and must be escalated');
  }
  console.log('\nevery claim decided, and the two escalation rules were honoured');
}
