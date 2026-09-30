// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import type Orca from '@runorca/orca-sdk';
import type { SessionEvent } from '@runorca/orca-sdk/resources/sessions/events';

import { throwIfStopped } from './cleanup.js';

/**
 * Driving a session turn to completion.
 *
 * The SDK types a session event as `{ id, type, ...unknown }` — deliberately
 * open, because the harness owns the payload vocabulary. Narrowing therefore
 * happens at runtime, here, once, rather than being re-guessed in each recipe.
 */

/** Why the agent stopped. `requires_action` means it is waiting on the caller. */
export type StopReason = 'end_turn' | 'requires_action' | 'retries_exhausted' | 'unknown';

export interface TurnResult {
  stopReason: StopReason;
  /** Concatenated assistant text across the turn. */
  text: string;
  /** Id of the last event seen, used as the local replay boundary. */
  cursor: string | undefined;
  /** Events whose type the caller asked to capture. */
  captured: SessionEvent[];
}

export interface StreamOptions {
  /**
   * Resume from a previous cursor.
   *
   * Without this the stream **replays from the beginning of the session**.
   * That is correct for a first turn and wrong for every turn after it, which
   * is why multi-turn recipes thread `result.cursor` through.
   */
  fromCursor?: string | undefined;
  /** Event types to collect into `captured`, e.g. `agent.custom_tool_use`. */
  capture?: readonly string[];
  /** Print assistant text and tool activity as it arrives. Default true. */
  echo?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Pull `stop_reason.type` off a `session.status_idle` event. */
function readStopReason(event: SessionEvent): StopReason {
  const reason = asRecord(event['stop_reason']);
  const type = reason?.['type'];
  if (type === 'end_turn' || type === 'requires_action' || type === 'retries_exhausted') {
    return type;
  }
  return 'unknown';
}

/** Concatenate the text blocks of an `agent.message` event. */
export function readMessageText(event: SessionEvent): string {
  const content = event['content'];
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const raw of content) {
    const block = asRecord(raw);
    if (block?.['type'] === 'text' && typeof block['text'] === 'string') {
      out += block['text'];
    }
  }
  return out;
}

/**
 * Consume the event stream until the session goes idle.
 *
 * Returns rather than throws on `requires_action`: a custom-tool recipe needs
 * to answer and resume, and that is a normal path, not a failure.
 *
 * Throws `StoppedError` instead of returning once Ctrl-C has started cleanup:
 * the turn most likely ended because cleanup interrupted it, and the recipe
 * must not carry on to its next step.
 */
export async function streamUntilIdle(
  orca: Orca,
  sessionId: string,
  options: StreamOptions = {},
): Promise<TurnResult> {
  const result = await consumeUntilIdle(orca, sessionId, options);
  throwIfStopped();
  return result;
}

async function consumeUntilIdle(
  orca: Orca,
  sessionId: string,
  options: StreamOptions,
): Promise<TurnResult> {
  const { fromCursor, capture = [], echo = true } = options;
  const wanted = new Set(capture);

  let text = '';
  let cursor: string | undefined = fromCursor;
  const captured: SessionEvent[] = [];

  const consume = (event: SessionEvent): TurnResult | undefined => {
    cursor = event.id;

    if (wanted.has(event.type)) {
      captured.push(event);
    }

    switch (event.type) {
      case 'agent.message': {
        const chunk = readMessageText(event);
        text += chunk;
        if (echo && chunk !== '') process.stdout.write(chunk);
        break;
      }
      case 'agent.tool_use':
      case 'agent.mcp_tool_use': {
        if (echo && typeof event['name'] === 'string') {
          process.stdout.write(`\n  [${event['name']}]\n`);
        }
        break;
      }
      case 'session.error': {
        const error = asRecord(event['error']);
        const message =
          typeof event['message'] === 'string'
            ? event['message']
            : typeof error?.['message'] === 'string'
              ? error['message']
              : 'unknown error';
        throw new Error(`session ${sessionId} reported an error: ${message}`);
      }
      case 'session.status_idle': {
        if (echo) process.stdout.write('\n');
        return { stopReason: readStopReason(event), text, cursor, captured };
      }
      case 'session.status_terminated': {
        if (echo) process.stdout.write('\n');
        return { stopReason: 'unknown', text, cursor, captured };
      }
      default:
        return undefined;
    }
    return undefined;
  };

  if (fromCursor === undefined) {
    const stream = await orca.sessions.events.stream(sessionId);
    for await (const event of stream) {
      const result = consume(event);
      if (result !== undefined) return result;
    }
    return { stopReason: 'unknown', text, cursor, captured };
  }

  // `from_cursor` is an SSE transport sequence, not the UUID in the JSON
  // event's `id` field. The published SDK discards the SSE `id:` line, so a
  // resumed live tail cannot be positioned correctly. Poll persisted history
  // and discard events through the last UUID observed by the previous turn.
  // This is less efficient than a real SSE cursor but deterministic for the
  // short transcripts these recipes create.
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const boundary = cursor;
    let foundBoundary = false;

    for await (const event of orca.sessions.events.list(sessionId, { limit: 500, order: 'asc' })) {
      if (!foundBoundary) {
        if (event.id === boundary) foundBoundary = true;
        continue;
      }

      const result = consume(event);
      if (result !== undefined) return result;
    }

    // Persisted event history is projected asynchronously. A just-observed
    // idle boundary can briefly be absent from the list endpoint even though
    // the next user event was accepted. Retry until the common deadline.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`session ${sessionId} did not reach idle within 600000ms`);
}

/**
 * Wait for the session's stored status to actually read `idle`.
 *
 * The `session.status_idle` event can reach a client before the server has
 * committed the status change, so a lifecycle mutation immediately after the
 * event can still fail because the stored session reads `running`. Polling the
 * session record closes that window.
 */
export async function waitForIdle(
  orca: Orca,
  sessionId: string,
  { timeoutMs = 60_000, intervalMs = 500 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const session = await orca.sessions.retrieve(sessionId);
    if (session.status === 'idle' || session.status === 'terminated') return;

    if (Date.now() >= deadline) {
      throw new Error(
        `session ${sessionId} still reads "${session.status}" after ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Send one user message and drive the turn to completion. */
export async function ask(
  orca: Orca,
  sessionId: string,
  text: string,
  options: StreamOptions = {},
): Promise<TurnResult> {
  throwIfStopped();
  await orca.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  });
  return streamUntilIdle(orca, sessionId, options);
}
