// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Triage a production incident with a skill, and gate the fix.
 *
 * Two things combine here. The runbooks are uploaded as a skill, so they are
 * available to the agent without being pasted into a system prompt. And the
 * only way to act is a custom tool, so the proposed remediation comes back to
 * this process for a human decision rather than being applied.
 *
 * The telemetry is built so the alert name is misleading. Reading the runbook
 * is what separates the right answer from the plausible one.
 */
import { toFile } from '@runorca/orca-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bootstrap,
  createClient,
  runToolLoop,
  trackSession,
  waitForIdle,
  withCleanup,
  type ToolHandlers,
} from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const TELEMETRY = '/mnt/session/uploads/telemetry';

/** Paths inside the bundle. The root SKILL.md is required. */
const SKILL_FILES = ['SKILL.md', 'runbooks/pool-exhaustion.md', 'runbooks/slow-query.md'];

const TELEMETRY_FILES = ['alert.json', 'metrics.csv', 'deploys.log'];

const SYSTEM = `You are on call for the orders service.

Telemetry for this incident is at ${TELEMETRY}.

You have a runbook skill available. Read its entrypoint before you diagnose
anything - the failure modes have specific signatures and they are easy to
confuse.

An alert's name and its suggested remediation are written by whoever configured
the alert, months ago. Treat them as a hypothesis.

You cannot change production. When you know the failure mode, call
propose_remediation() with what you want done and why. A human approves it.

The shell tool is named mcp__orca__bash.`;

const TASK = `A P1 just fired. Work out what is actually happening and propose a
remediation.`;

interface Proposal {
  failure_mode: string;
  action: string;
  reasoning: string;
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    // A skill is a versioned bundle. The path inside the bundle is carried by
    // the uploaded file's name, so nested files keep their layout.
    const skill = await orca.skills.create({
      display_title: `${config.prefix}-incident-runbooks`,
      files: await Promise.all(
        SKILL_FILES.map(async (relative) =>
          toFile(
            readFileSync(join(FIXTURES, 'skill', relative)),
            `incident-runbooks/${relative}`,
            { type: 'text/markdown' },
          ),
        ),
      ),
    });
    cleanup.add(`skill ${skill.id}`, async () => {
      for await (const version of orca.skills.versions.list(skill.id)) {
        await orca.skills.versions.delete(skill.id, version.version);
      }
      await orca.skills.delete(skill.id);
    });
    console.log(`skill ${skill.id}`);

    const resources = [];
    for (const name of TELEMETRY_FILES) {
      const bytes = readFileSync(join(FIXTURES, 'telemetry', name));
      const file = await orca.files.upload({
        file: await toFile(bytes, name, { type: 'text/plain' }),
      });
      cleanup.add(`file ${name}`, () => orca.files.delete(file.id));
      resources.push({
        type: 'file' as const,
        file_id: file.id,
        mount_path: `${TELEMETRY}/${name}`,
        access: 'read_only' as const,
      });
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-incident-responder`,
      model: config.model,
      system: SYSTEM,
      // Only `custom` skill references take effect. The other form is accepted
      // by the API and then skipped when the prompt is composed.
      skills: [{ type: 'custom', skill_id: skill.id, version: 'latest' }],
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
        {
          type: 'custom',
          name: 'propose_remediation',
          description:
            'Propose an action for a human to approve. This is the only way to affect production.',
          input_schema: {
            type: 'object',
            properties: {
              failure_mode: {
                type: 'string',
                description: 'The specific failure mode, named as the runbook names it.',
              },
              action: { type: 'string', description: 'What should be done.' },
              reasoning: {
                type: 'string',
                description: 'The evidence in the telemetry that rules out the alternatives.',
              },
            },
            required: ['failure_mode', 'action', 'reasoning'],
          },
        },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'P1 orders latency',
      resources,
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: TASK }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const proposals: Proposal[] = [];
    const handlers: ToolHandlers = {
      propose_remediation(input) {
        const proposal: Proposal = {
          failure_mode: String(input['failure_mode'] ?? ''),
          action: String(input['action'] ?? ''),
          reasoning: String(input['reasoning'] ?? ''),
        };

        // The one thing the runbook forbids for this failure mode. Refusing at
        // the boundary is the difference between a gate and a suggestion.
        if (/restart.*(database|primary|db)\b/i.test(proposal.action)) {
          throw new Error(
            'refused: restarting the database is explicitly ruled out for this failure mode. ' +
              'Re-read the runbook and propose something else.',
          );
        }

        proposals.push(proposal);
        return { status: 'queued_for_approval' };
      },
    };

    const result = await runToolLoop(orca, session.id, handlers);
    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}"`);
    }

    await waitForIdle(orca, session.id);
    review(proposals);
  });
}

function review(proposals: Proposal[]): void {
  if (proposals.length === 0) {
    throw new Error('the agent never proposed a remediation');
  }

  console.log('\n--- proposed, pending approval ---');
  for (const proposal of proposals) {
    console.log(`\n  failure mode: ${proposal.failure_mode}`);
    console.log(`  action:       ${proposal.action}`);
    console.log(`  reasoning:    ${proposal.reasoning}`);
  }

  const last = proposals[proposals.length - 1];
  if (last === undefined) return;

  const diagnosed = /pool|connection/i.test(`${last.failure_mode} ${last.reasoning}`);
  if (!diagnosed) {
    throw new Error(
      'the agent did not reach connection pool exhaustion. The signature is in the ' +
        'metrics: a latency ramp with flat database CPU and connections pinned at the ceiling.',
    );
  }
  console.log('\ndiagnosed against the runbook signature, not the alert name');
}
