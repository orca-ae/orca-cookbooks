// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Carry preferences between sessions with a memory store.
 *
 * A session is a working context and it ends. A memory store is a small
 * filesystem that outlives it, mounted into the sandbox at a path the agent
 * can read and write with ordinary file tools.
 *
 * The recipe runs two sessions against the same store. The first is told
 * things in passing; the second is a stranger to that conversation and has to
 * recover them. Two stores are mounted to show the split that matters: one
 * per-customer and writable, one brand-wide and read-only.
 */
import { bootstrap, createClient, ask, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

function systemPrompt(personalMount: string, catalogMount: string): string {
  return `You are a shopping assistant with a memory that survives between
conversations.

${personalMount} is yours to read and write. Keep what would change a future
recommendation - sizes, fit, materials to avoid, budget, things already owned.
Write it as short markdown you would want to find later. Do not keep chat
transcripts.

${catalogMount} is shared reference and read-only. Never write there.

At the start of a conversation, read your memory before answering. At the end
of one, update it.

The shell tool is named mcp__orca__bash.`;
}

const CATALOG = `# Stock notes

- The Aster jacket runs one size small.
- Merino base layers are back in stock in all sizes.
- The Larch parka is discontinued; the Cedar parka replaces it.
`;

const FIRST = `I'm after a winter coat. Some things that matter: I'm a UK 12 but
I size up in outerwear because I layer. Wool makes me itch - I've returned two
jumpers over it. I'd rather not go past 250 pounds. I already own the Aster
jacket, so nothing like that.

What should I look at?`;

const SECOND = `What size should I order in the Cedar parka, and is there
anything you'd steer me away from?`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const personalName = `${config.prefix}-customer-preferences`;
    const catalogName = `${config.prefix}-catalog-notes`;
    const personalMount = `/mnt/memory/${personalName}/`;
    const catalogMount = `/mnt/memory/${catalogName}/`;

    const personal = await orca.memoryStores.create({
      name: personalName,
      description: 'What one shopper has told us, across conversations.',
    });
    cleanup.add(`memory store ${personal.id}`, () => orca.memoryStores.delete(personal.id));

    const catalog = await orca.memoryStores.create({
      name: catalogName,
      description: 'Brand-wide stock notes. Read-only to agents.',
    });
    cleanup.add(`memory store ${catalog.id}`, () => orca.memoryStores.delete(catalog.id));

    // Seeded from the host, so the read-only store has something in it before
    // any agent runs.
    await orca.memoryStores.memories.create(catalog.id, {
      body: { path: '/stock.md', content: CATALOG },
    });

    const agent = await orca.agents.create({
      name: `${config.prefix}-shopping-assistant`,
      model: config.model,
      system: systemPrompt(personalMount, catalogMount),
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const resources = [
      {
        type: 'memory_store' as const,
        memory_store_id: personal.id,
        access: 'read_write' as const,
      },
      {
        type: 'memory_store' as const,
        memory_store_id: catalog.id,
        access: 'read_only' as const,
      },
    ];

    console.log('--- session one: the shopper explains themselves ---');
    const first = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'shopping, first conversation',
      resources,
    });
    trackSession(cleanup, orca, first.id);

    const firstTurn = await ask(orca, first.id, FIRST);
    if (firstTurn.stopReason !== 'end_turn') {
      throw new Error(`first session stopped with "${firstTurn.stopReason}"`);
    }
    await waitForIdle(orca, first.id);

    await showMemories(orca, personal.id);

    // A separate session. It shares the store and nothing else - none of the
    // first conversation is in its context.
    console.log('\n--- session two: a fresh context, same memory ---');
    const second = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'shopping, later conversation',
      resources,
    });
    trackSession(cleanup, orca, second.id);

    const secondTurn = await ask(orca, second.id, SECOND);
    await waitForIdle(orca, second.id);

    assertRecalled(secondTurn.text);
  });
}

async function showMemories(
  orca: ReturnType<typeof createClient>['orca'],
  storeId: string,
): Promise<void> {
  console.log('\n--- what the agent chose to keep ---');

  // Listing gives identity, not content: the published `list` takes no `view`
  // parameter, so each memory is fetched with `view: 'full'` to read its body.
  const ids: string[] = [];
  for await (const item of orca.memoryStores.memories.list(storeId)) {
    ids.push((item as { id: string }).id);
  }

  if (ids.length === 0) {
    throw new Error('the first session wrote nothing to the memory store');
  }

  for (const id of ids) {
    const memory = await orca.memoryStores.memories.retrieve(storeId, id, { view: 'full' });
    console.log(`\n  ${memory.path}`);
    for (const line of (memory.content ?? '').split('\n')) {
      if (line.trim() !== '') console.log(`    ${line}`);
    }
  }
}

/**
 * The second session never heard about sizing up or the wool problem, so
 * either it read them out of memory or it is guessing.
 */
function assertRecalled(text: string): void {
  const sizing = /size up|14|larger|one size/i.test(text);
  const wool = /wool|itch|merino/i.test(text);

  if (!sizing) {
    throw new Error('the second session did not recall the sizing-up preference');
  }
  if (!wool) {
    throw new Error('the second session did not recall the wool sensitivity');
  }
  console.log('\nboth preferences survived into a session that never heard them');
}
