// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import type Orca from '@runorca/orca-sdk';
import type {
  SessionCustomToolResultEventInput,
  SessionEvent,
} from '@runorca/orca-sdk/resources/sessions/events';

import { streamUntilIdle, type StreamOptions, type TurnResult } from './stream.js';

/**
 * Custom tools, which are a round trip rather than a call.
 *
 * A built-in tool runs inside the sandbox and the caller never sees it. A
 * custom tool is the opposite: the engine emits `agent.custom_tool_use`, stops,
 * and waits. The turn goes idle with `requires_action` and stays there until
 * the caller sends back a `user.custom_tool_result` carrying the id it was
 * given. So a custom tool is not a function the agent calls - it is a message
 * exchange the caller has to service, and a turn can bounce through idle
 * several times before it finishes.
 *
 * That bouncing is the whole complication, so it lives here once.
 */

/** Handles one invocation and returns whatever the agent should see. */
export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export type ToolHandlers = Record<string, ToolHandler>;

export interface ToolLoopOptions extends StreamOptions {
  /** Guard against an agent that keeps asking. */
  maxRounds?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Drive a session to a real finish, servicing custom tools along the way.
 *
 * Returns on `end_turn`. Throws if the agent asks for a tool nobody handles,
 * because the alternative is a session that waits forever on a result that is
 * never coming.
 */
export async function runToolLoop(
  orca: Orca,
  sessionId: string,
  handlers: ToolHandlers,
  options: ToolLoopOptions = {},
): Promise<TurnResult> {
  const { maxRounds = 25, ...streamOptions } = options;

  // Custom-tool events have to be captured on every pass, on top of whatever
  // the caller asked for.
  const capture = ['agent.custom_tool_use', ...(streamOptions.capture ?? [])];

  let result = await streamUntilIdle(orca, sessionId, { ...streamOptions, capture });

  for (let round = 0; round < maxRounds; round += 1) {
    if (result.stopReason !== 'requires_action') return result;

    const calls = result.captured.filter((event) => event.type === 'agent.custom_tool_use');
    if (calls.length === 0) {
      throw new Error(
        `session ${sessionId} is waiting on an action but emitted no custom tool call`,
      );
    }

    // Answer every outstanding call in one batch. The agent can request several
    // tools in a single turn, and replying one at a time leaves the rest
    // unanswered.
    const events = await Promise.all(calls.map((call) => respond(handlers, call)));

    await orca.sessions.events.send(sessionId, { events });

    result = await streamUntilIdle(orca, sessionId, {
      ...streamOptions,
      capture,
      fromCursor: result.cursor,
    });
  }

  throw new Error(`session ${sessionId} did not finish within ${maxRounds} tool rounds`);
}

/**
 * Build the reply for one call.
 *
 * A handler that throws is reported back as a tool error rather than being
 * allowed to kill the run: the agent can often recover from a failed tool, and
 * it cannot recover from a caller that walked away.
 */
async function respond(
  handlers: ToolHandlers,
  call: SessionEvent,
): Promise<SessionCustomToolResultEventInput> {
  const name = typeof call['name'] === 'string' ? call['name'] : '';
  const handler = handlers[name];

  if (handler === undefined) {
    throw new Error(
      `the agent called "${name}", which has no handler. Handled: ${Object.keys(handlers).join(', ')}`,
    );
  }

  const base = { type: 'user.custom_tool_result', custom_tool_use_id: call.id } as const;

  try {
    const output = await handler(asRecord(call['input']));
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? null);
    return { ...base, content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, is_error: true, content: [{ type: 'text', text: message }] };
  }
}
