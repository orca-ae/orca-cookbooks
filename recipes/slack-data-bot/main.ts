// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * A chat bot whose backend is the session itself.
 *
 * A thread in a chat tool is a conversation, and a session is a conversation.
 * Rather than keeping a database that maps one to the other, this stamps the
 * thread id into the session's `metadata` and looks it up again on the next
 * message. There is no store to keep in sync, because the session *is* the
 * record.
 *
 * The transport is simulated so the recipe runs with no chat workspace. What
 * the transport carries is deliberately thin - a thread id and some text -
 * because that is all a real adapter would hand over.
 */
import { toFile } from '@runorca/orca-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ask, bootstrap, createClient, trackSession, waitForIdle, withCleanup, type Cleanup } from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const DATA_PATH = '/mnt/session/uploads/sales.csv';

/** What an adapter for any chat tool would deliver. */
interface InboundMessage {
  threadId: string;
  text: string;
  attachment?: string;
}

/** Two threads, interleaved, so session routing is actually exercised. */
const INBOX: InboundMessage[] = [
  { threadId: 'thread-alpha', text: 'What were our best and worst products last year?', attachment: 'sales.csv' },
  { threadId: 'thread-beta', text: 'Which region grew the most?', attachment: 'sales.csv' },
  { threadId: 'thread-alpha', text: 'Break the worst one down by region for me.' },
  { threadId: 'thread-beta', text: 'And which was flat or declining?' },
];

const SYSTEM = `You answer questions about sales data in a chat thread.

The data is at ${DATA_PATH}. The shell tool is named mcp__orca__bash.

You are writing into a chat window, so: lead with the answer, keep it to a few
sentences, and give numbers rather than adjectives. No headings, no bullet
lists unless there are genuinely several items. Follow-up questions arrive in
the same thread and you are expected to remember the earlier ones.`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    const bytes = readFileSync(join(FIXTURES, 'sales.csv'));
    const file = await orca.files.upload({
      file: await toFile(bytes, 'sales.csv', { type: 'text/csv' }),
    });
    cleanup.add('file sales.csv', () => orca.files.delete(file.id));

    const agent = await orca.agents.create({
      name: `${config.prefix}-chat-analyst`,
      model: config.model,
      system: SYSTEM,
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const lastReply = new Map<string, string>();

    // The first message in each thread opens its session.
    const bot = new ThreadRouter(orca, agent.id, environmentId, file.id, cleanup);
    for (const message of INBOX.slice(0, 2)) await relay(bot, message, lastReply);

    // Then the process restarts: a new router with no cache and no cursors, as
    // a freshly started bot would have. The follow-ups have to reach the same
    // sessions through the metadata search alone.
    console.log('\n--- restart: a new router with an empty cache ---');
    const restarted = new ThreadRouter(orca, agent.id, environmentId, file.id, cleanup);
    for (const message of INBOX.slice(2)) await relay(restarted, message, lastReply);

    restarted.summarise(bot.mapping());
  });
}

/** Deliver one message and print the exchange. */
async function relay(
  bot: ThreadRouter,
  message: InboundMessage,
  lastReply: Map<string, string>,
): Promise<void> {
  console.log(`\n[${message.threadId}] < ${message.text}`);
  const reply = await bot.handle(message);
  console.log(`[${message.threadId}] > ${reply.trim()}`);

  // A resumed stream that replayed the thread would hand back the previous
  // answer instead of a new one.
  if (reply === lastReply.get(message.threadId)) {
    throw new Error(`[${message.threadId}] got its previous reply again: the stream replayed`);
  }
  lastReply.set(message.threadId, reply);
}

/**
 * Routes inbound messages to the right session.
 *
 * A cache saves a round trip within one process, but it is not the source of
 * truth: `resolve` falls back to searching sessions by metadata, so a restarted
 * process picks up threads it has never seen. That fallback is the reason this
 * design works at all - the mapping survives the bot.
 */
class ThreadRouter {
  readonly #cache = new Map<string, string>();
  readonly #turns = new Map<string, string | undefined>();

  constructor(
    private readonly orca: ReturnType<typeof createClient>['orca'],
    private readonly agentId: string,
    private readonly environmentId: string,
    private readonly fileId: string,
    private readonly cleanup: Cleanup,
  ) {}

  async handle(message: InboundMessage): Promise<string> {
    const sessionId = await this.resolve(message.threadId);

    // Each thread keeps its own cursor, so a follow-up resumes rather than
    // replaying everything said in that thread so far.
    const cursor = this.#turns.get(message.threadId);
    const result = await ask(this.orca, sessionId, message.text, {
      fromCursor: cursor,
      echo: false,
    });
    this.#turns.set(message.threadId, result.cursor);

    if (result.stopReason !== 'end_turn') {
      return `(stopped: ${result.stopReason})`;
    }
    await waitForIdle(this.orca, sessionId);
    return result.text;
  }

  /** Cache, then metadata search, then create. */
  async resolve(threadId: string): Promise<string> {
    const cached = this.#cache.get(threadId);
    if (cached !== undefined) return cached;

    const found = await this.search(threadId);
    if (found !== undefined) {
      console.log(`  (recovered session ${found} from metadata)`);
      this.#cache.set(threadId, found);
      // The cursor lived in memory too, so it didn't survive either. Resume
      // after the last event already recorded, or the next stream would replay
      // the thread from its first message.
      this.#turns.set(threadId, await this.latestEventId(found));
      return found;
    }

    const session = await this.orca.sessions.create({
      agent: this.agentId,
      environment_id: this.environmentId,
      title: `chat ${threadId}`,
      // The routing key. Nothing else records the mapping.
      metadata: { thread_id: threadId, source: 'cookbook-chat' },
      resources: [
        { type: 'file', file_id: this.fileId, mount_path: DATA_PATH, access: 'read_only' },
      ],
    });
    trackSession(this.cleanup, this.orca, session.id);
    console.log(`  (opened session ${session.id})`);

    this.#cache.set(threadId, session.id);
    return session.id;
  }

  /**
   * Find an existing session for a thread.
   *
   * Sessions cannot be filtered by metadata server-side, so this lists the
   * agent's sessions and matches locally. Fine at cookbook scale; a busy
   * deployment wants a real index rather than a full scan.
   */
  async search(threadId: string): Promise<string | undefined> {
    for await (const session of this.orca.sessions.list({ agent_id: this.agentId })) {
      const record = session as unknown as { metadata?: Record<string, string> };
      if (record.metadata?.['thread_id'] === threadId) return session.id;
    }
    return undefined;
  }

  /** The id of the newest event recorded in a session. */
  async latestEventId(sessionId: string): Promise<string | undefined> {
    for await (const event of this.orca.sessions.events.list(sessionId, { order: 'desc', limit: 1 })) {
      return event.id;
    }
    return undefined;
  }

  /** The thread-to-session mapping this router has seen. */
  mapping(): Map<string, string> {
    return new Map(this.#cache);
  }

  /** Check that every thread reached the session it had before the restart. */
  summarise(beforeRestart: Map<string, string>): void {
    console.log(`\n${this.#cache.size} thread(s) served after the restart:`);
    for (const [threadId, sessionId] of this.#cache) {
      if (beforeRestart.get(threadId) !== sessionId) {
        throw new Error(`${threadId} reached a different session after the restart`);
      }
      console.log(`  ${threadId} -> ${sessionId} (same session as before)`);
    }
    if (this.#cache.size !== 2) {
      throw new Error(`expected 2 sessions for 2 threads, got ${this.#cache.size}`);
    }
    console.log(
      '\ntwo threads, two sessions, four messages across a restart - context stayed where it belonged',
    );
  }
}
