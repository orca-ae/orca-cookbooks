// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import type Orca from '@runorca/orca-sdk';
import type { SessionInterruptEventInput } from '@runorca/orca-sdk/resources/sessions/events';

import type { Cleanup } from './cleanup.js';
import { waitForIdle } from './stream.js';

/**
 * Ending sessions, whatever state they are in.
 *
 * The server refuses to delete a session that is still running, and a recipe
 * that fails, or is interrupted with Ctrl-C, part-way through a turn leaves its
 * session running. Releasing one therefore stops the work first.
 */

export interface ReleaseOptions {
  /** How long to wait for the session to go idle after interrupting it. */
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Interrupt every thread that is still working, wait for the session to go
 * idle, then delete it.
 *
 * If the session never goes idle the delete is attempted anyway, and its error
 * is what surfaces: that names the actual problem.
 */
export async function releaseSession(
  orca: Orca,
  sessionId: string,
  options: ReleaseOptions = {},
): Promise<void> {
  const session = await orca.sessions.retrieve(sessionId);
  if (session.status !== 'idle' && session.status !== 'terminated') {
    await interruptWorkingThreads(orca, sessionId);
    try {
      await waitForIdle(orca, sessionId, options);
    } catch {
      // Fall through: the delete below reports why the session can't go.
    }
  }
  await orca.sessions.delete(sessionId);
}

/**
 * Interrupt the primary thread and every child thread that isn't idle. A
 * coordinator's subagents run on child threads, and interrupting only the
 * primary thread would leave them working.
 */
async function interruptWorkingThreads(orca: Orca, sessionId: string): Promise<void> {
  const events: SessionInterruptEventInput[] = [];
  try {
    for await (const thread of orca.sessions.threads.list(sessionId)) {
      if (thread.status === 'idle' || thread.status === 'terminated') continue;
      events.push(
        thread.parent_thread_id === null
          ? { type: 'user.interrupt' }
          : { type: 'user.interrupt', session_thread_id: thread.id },
      );
    }
  } catch {
    // No thread listing: interrupting the primary thread is the best we can do.
  }
  if (events.length === 0) events.push({ type: 'user.interrupt' });

  try {
    await orca.sessions.events.send(sessionId, { events });
    return;
  } catch {
    // A thread may have gone idle since it was listed, and the batch been
    // refused over that one. Send the interrupts one by one instead.
  }
  if (events.length === 1) return;
  for (const event of events) {
    try {
      await orca.sessions.events.send(sessionId, { events: [event] });
    } catch {
      // That thread went idle on its own.
    }
  }
}

/**
 * Register a session for release, ahead of the files, agents and stores it
 * uses. Call it straight after `sessions.create`, before anything that can
 * fail.
 */
export function trackSession(cleanup: Cleanup, orca: Orca, sessionId: string): void {
  cleanup.addFirst(`session ${sessionId}`, () => releaseSession(orca, sessionId));
}
