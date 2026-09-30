// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turn a CSV into a report you can open.
 *
 * The agent gets a sandbox with pandas and plotly installed, a year of sales
 * data, and one instruction: find what matters and write it up as a standalone
 * HTML file. The recipe then pulls that file back out and saves it locally.
 *
 * Two things make this different from the other recipes: the environment is
 * built with packages rather than reused, and the deliverable is an artifact
 * rather than a message.
 */
import { toFile } from '@runorca/orca-sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const OUT_DIR = join(import.meta.dirname, 'out');

const DATA_PATH = '/mnt/session/uploads/sales.csv';
const REPORT_PATH = '/mnt/session/outputs/report.html';

const SYSTEM = `You are a data analyst. You write for someone who will read the
first paragraph and skim the rest.

Your sandbox has pandas and plotly. The shell tool is named mcp__orca__bash.

Method:
- Look at the data before deciding what to say about it.
- Lead with what changed or what is wrong, not with what is unremarkable.
- Every chart must earn its place. Three good ones beat eight.
- Quantify. "Down sharply" is not a finding; "down 74% from July" is.`;

const TASK = `${DATA_PATH} holds a year of sales by month, region and product.

Analyse it and write a single standalone HTML report to ${REPORT_PATH}.

Requirements:
- Embed the plotly charts inline so the file opens with no network access.
- Open with the most important finding, stated in one sentence with a number.
- Include the supporting detail underneath.

Write the file, then confirm it exists and report its size.`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    // A dedicated environment: this one needs packages, and the shared
    // cookbook environment does not carry them.
    const { environmentId, created } = await bootstrap(orca, config, {
      suffix: 'analysis',
      config: {
        type: 'cloud',
        packages: { pip: ['pandas', 'plotly'] },
        // Package installation needs egress. Nothing else here does.
        networking: { type: 'limited', allow_package_managers: true },
      },
    });
    console.log(`environment ${environmentId}${created ? ' (created)' : ' (reused)'}`);

    const bytes = readFileSync(join(FIXTURES, 'sales.csv'));
    const file = await orca.files.upload({
      file: await toFile(bytes, 'sales.csv', { type: 'text/csv' }),
    });
    cleanup.add('file sales.csv', () => orca.files.delete(file.id));

    const agent = await orca.agents.create({
      name: `${config.prefix}-data-analyst`,
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
      title: 'sales analysis',
      resources: [
        { type: 'file', file_id: file.id, mount_path: DATA_PATH, access: 'read_only' },
      ],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const result = await ask(orca, session.id, TASK);
    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}"`);
    }

    // The stream can report idle before the server has committed the turn, so
    // wait for the stored status before reading what the turn wrote.
    await waitForIdle(orca, session.id);
    await saveReport(orca, session.id, result.text);
  });
}

/** Pull the generated report out of the session and write it beside the recipe. */
async function saveReport(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
  transcript: string,
): Promise<void> {
  const files = await orca.sessions.files.list(sessionId);
  const report = files.data?.find((f) => f.filename?.endsWith('report.html'));

  if (report === undefined) {
    const seen = files.data?.map((f) => f.filename).join(', ') || 'none';
    throw new Error(`no report.html among the session outputs. Found: ${seen}`);
  }

  const response = await orca.sessions.files.download(sessionId, report.id);
  const html = await response.text();

  if (!/plotly/i.test(html)) {
    throw new Error('the report has no plotly output embedded in it');
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const target = join(OUT_DIR, 'report.html');
  writeFileSync(target, html);

  console.log(`\nreport saved to ${target} (${(html.length / 1024).toFixed(0)} KB)`);

  // The fixture hides one real collapse. Worth knowing whether it was found.
  if (/west/i.test(transcript) && /cirrus/i.test(transcript)) {
    console.log('the analyst found the Cirrus decline in the West');
  } else {
    console.log('note: the analyst did not surface the Cirrus decline in the West');
  }
}
