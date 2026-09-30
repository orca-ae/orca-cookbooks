// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Watch subagents work, live.
 *
 * A coordinator delegates to a roster of specialists. Each one runs in its own
 * thread with its own context, and the primary stream only carries the
 * coordinator's side of things - a thread appearing, a thread going idle.
 *
 * To see inside a subagent you open its thread stream. This recipe watches the
 * primary stream for new threads and attaches a follower to each one as it
 * appears, so several agents are printing at once.
 */
import {
  bootstrap,
  createClient,
  throwIfStopped,
  trackSession,
  waitForIdle,
  withCleanup,
} from '../../lib/index.js';

const BRIEF = `Put together a one-week introduction to tessellation for a
class of 14-year-olds. I need the sequence of lessons, one hands-on activity,
and a way to check they understood it.`;

const COORDINATOR = `You are planning a week of lessons with a small team.

Delegate. You have a curriculum sequencer, an activity designer, and an
assessment writer. Give each a brief that is specific enough to act on without
further questions, let them work in parallel where the work is independent, and
assemble what comes back into one plan.

Do not do their work yourself.`;

const SPECIALISTS = [
  {
    key: 'sequencer',
    name: 'curriculum-sequencer',
    system: `You sequence lessons. Given a topic and an age group, produce a
day-by-day outline with a stated objective per day and a note on what each day
assumes from the one before. Be concrete about time. No activities, no
assessment - other people are doing those.`,
  },
  {
    key: 'activity',
    name: 'activity-designer',
    system: `You design one hands-on classroom activity. Materials a school
actually has, steps a teacher can follow, a realistic duration, and the specific
misconception the activity is meant to surface. One activity, in detail.`,
  },
  {
    key: 'assessment',
    name: 'assessment-writer',
    system: `You write checks for understanding. Produce a short set of items
that distinguish real understanding from pattern-matching, with what a correct
answer shows and what a common wrong answer reveals.`,
  },
] as const;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    // Specialists are ordinary agents. They become subagents only by being
    // named in a coordinator's roster.
    const roster: string[] = [];
    for (const spec of SPECIALISTS) {
      const agent = await orca.agents.create({
        name: `${config.prefix}-${spec.name}`,
        model: config.fastModel,
        system: spec.system,
      });
      cleanup.add(`agent ${spec.name}`, () => orca.agents.archive(agent.id));
      roster.push(agent.id);
      console.log(`specialist ${spec.name} -> ${agent.id}`);
    }

    const coordinator = await orca.agents.create({
      name: `${config.prefix}-lesson-coordinator`,
      model: config.model,
      system: COORDINATOR,
      multiagent: { type: 'coordinator', agents: roster },
    });
    cleanup.add(`agent coordinator`, () => orca.agents.archive(coordinator.id));

    const session = await orca.sessions.create({
      agent: coordinator.id,
      environment_id: environmentId,
      title: 'lesson plan, watched live',
      // The brief is delivered as an initial event, so work starts at session
      // creation rather than after a separate send.
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: BRIEF }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`\nsession ${session.id}\n`);

    const followed = await watch(orca, session.id);

    await waitForIdle(orca, session.id);
    const threads = await summariseThreads(orca, session.id);
    if (threads > 1 && followed === 0) {
      throw new Error('subagents ran, but no follower attached to any of their threads');
    }
  });
}

/**
 * Follow the primary stream, attaching a follower to each thread as it appears.
 *
 * Threads are announced by `session.thread_created` on the primary stream, but
 * some deployments don't project that event there. A poller lists the session's
 * threads alongside the stream, so a follower still attaches on those, a
 * little later.
 *
 * Followers run concurrently and are awaited at the end. A follower that fails
 * is reported rather than allowed to reject the whole run - losing sight of one
 * subagent is not a reason to abandon the session.
 */
async function watch(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
): Promise<number> {
  const followers: Promise<void>[] = [];
  const seen = new Set<string>();
  // Lets go of followers still open once the session is done (see below).
  const release = new AbortController();

  const attach = (threadId: string, how: string): void => {
    if (seen.has(threadId)) return;
    seen.add(threadId);
    console.log(`\n[thread ${threadId} started${how}]`);
    followers.push(follow(orca, sessionId, threadId, release.signal));
  };

  let watching = true;
  const poller = (async () => {
    while (watching) {
      try {
        for await (const thread of orca.sessions.threads.list(sessionId)) {
          if (thread.parent_thread_id !== null) attach(thread.id, ', found by polling');
        }
      } catch {
        // Try again on the next round.
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  })();

  try {
    const primary = await orca.sessions.events.stream(sessionId);
    let done = false;
    for await (const event of primary) {
      switch (event.type) {
        case 'session.thread_created': {
          const threadId = readThreadId(event);
          if (threadId !== undefined) attach(threadId, '');
          break;
        }
        case 'agent.message': {
          process.stdout.write(text(event));
          break;
        }
        case 'session.error':
          throw new Error(`session error: ${String(event['message'] ?? 'unknown')}`);
        case 'session.status_idle':
        case 'session.status_terminated':
          done = true;
          break;
        default:
          break;
      }
      if (done) break;
    }
    // After Ctrl-C the turn ends because cleanup interrupted it: stop here.
    throwIfStopped();
  } finally {
    watching = false;
    await poller;
  }

  // Followers are only for watching. Give them time to finish, then let go of
  // any still open, such as one attached by polling to a thread that had
  // already finished, whose stream may have nothing left to send.
  const timer = setTimeout(() => release.abort(), FOLLOWER_GRACE_MS);
  await Promise.allSettled(followers);
  clearTimeout(timer);
  return seen.size;
}

/** How long followers get to finish once the session is idle. */
const FOLLOWER_GRACE_MS = 30_000;

/** Print one subagent's own stream, prefixed so the interleaving is readable. */
async function follow(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
  threadId: string,
  signal: AbortSignal,
): Promise<void> {
  const tag = threadId.slice(-6);
  try {
    const stream = await orca.sessions.threads.events.stream(sessionId, threadId, { signal });
    for await (const event of stream) {
      if (event.type === 'agent.message') {
        const body = text(event).trim();
        if (body !== '') console.log(`  [${tag}] ${body.split('\n')[0]}`);
      }
      if (event.type === 'agent.tool_use' && typeof event['name'] === 'string') {
        console.log(`  [${tag}] (${event['name']})`);
      }
      if (
        event.type === 'session.thread_status_idle' ||
        event.type === 'session.thread_status_terminated'
      ) {
        console.log(`  [${tag}] done`);
        return;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      console.log(`  [${tag}] stopped following: the session finished first`);
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`  [${tag}] follower stopped: ${reason}`);
  }
}

/** Per-thread accounting after the fact. */
async function summariseThreads(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
): Promise<number> {
  console.log('\n--- threads ---');
  let count = 0;
  for await (const thread of orca.sessions.threads.list(sessionId)) {
    count += 1;
    // Per-thread usage is not reliably populated. Zeros would read as a
    // measurement, so say it's missing instead.
    const input = thread.usage?.input_tokens ?? 0;
    const output = thread.usage?.output_tokens ?? 0;
    const tokens = input === 0 && output === 0 ? 'no usage reported' : `in ${input}, out ${output}`;
    console.log(`  ${thread.id}  ${tokens}`);
  }
  console.log(`\n${count} thread(s)`);
  return count;
}

function readThreadId(event: { [key: string]: unknown }): string | undefined {
  for (const key of ['session_thread_id', 'thread_id', 'id']) {
    const value = event[key];
    if (typeof value === 'string' && value.startsWith('sth_')) return value;
  }
  return undefined;
}

function text(event: { [key: string]: unknown }): string {
  const content = event['content'];
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const raw of content) {
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw as { type?: unknown }).type === 'text' &&
      typeof (raw as { text?: unknown }).text === 'string'
    ) {
      out += (raw as { text: string }).text;
    }
  }
  return out;
}
