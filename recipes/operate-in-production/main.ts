// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wire an agent to a real MCP server, with credentials it never sees.
 *
 * Three things have to line up, and getting any of them wrong fails in a
 * different way:
 *
 *   1. the server is declared on the agent as `mcp_servers`
 *   2. a matching `mcp_toolset` tool references it by name - without this the
 *      create request is rejected outright
 *   3. a vault credential binds to the server *by URL*, and the session is
 *      given the vault
 *
 * The credential is injected at the gateway on the way out. It never enters
 * the sandbox, never reaches the model, and is never echoed back by the API.
 */
import { bootstrap, createClient, streamUntilIdle, trackSession, waitForIdle, withCleanup } from '../../lib/index.js';

const SERVER_NAME = 'reference';

const SYSTEM = `You have access to an external service through MCP tools.

Before answering, list the tools you actually have and say what each one does.
Then use them to answer the question. If a tool call fails, report the error
verbatim rather than guessing what the answer would have been.`;

const TASK = `What tools do you have available, and what can you find out with
them? Try at least one and show me the real result.`;

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  const url = process.env['ORCA_MCP_SERVER_URL'];
  const token = process.env['ORCA_MCP_SERVER_TOKEN'];

  if (url === undefined || url.trim() === '') {
    console.error(
      [
        'This recipe needs an MCP server to talk to.',
        '',
        '  ORCA_MCP_SERVER_URL=https://your-mcp-server.example/mcp',
        '  ORCA_MCP_SERVER_TOKEN=<bearer token>   # omit if the server is open',
        '',
        'The transport must be Streamable HTTP - the engine accepts type "url" only,',
        'and rejects sse and stdio servers.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  await withCleanup(async (cleanup) => {
    const { environmentId } = await bootstrap(orca, config);

    // The vault holds credentials; the session references the vault. The agent
    // record never names a credential.
    const vaultIds: string[] = [];
    if (token !== undefined && token.trim() !== '') {
      const vault = await orca.vaults.create({
        display_name: `${config.prefix}-mcp-credentials`,
      });
      cleanup.add(`vault ${vault.id}`, () => orca.vaults.delete(vault.id));

      await orca.vaults.credentials.create(vault.id, {
        display_name: `${SERVER_NAME} bearer`,
        auth: {
          type: 'static_bearer',
          token,
          // Binding is by URL, not by server name. This must match the URL on
          // the agent exactly, or the credential silently will not apply.
          mcp_server_url: url,
        },
      });
      vaultIds.push(vault.id);
      console.log(`vault ${vault.id} holds the bearer credential`);
    } else {
      console.log('no token supplied; connecting without credentials');
    }

    const agent = await orca.agents.create({
      name: `${config.prefix}-mcp-operator`,
      model: config.model,
      system: SYSTEM,
      mcp_servers: [{ name: SERVER_NAME, type: 'url', url }],
      tools: [
        { type: 'agent_toolset', default_config: { permission_policy: { type: 'always_allow' } } },
        {
          // Declaring the server is not enough. Every declared server must be
          // referenced by an mcp_toolset entry or the create request 400s.
          type: 'mcp_toolset',
          mcp_server_name: SERVER_NAME,
          // Remote tools reach outside the sandbox, so they ask first. The
          // confirmation arrives on the stream and this process answers it.
          default_config: { permission_policy: { type: 'always_ask' } },
        },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));
    console.log(`agent ${agent.id}`);

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'mcp operations',
      vault_ids: vaultIds.length > 0 ? vaultIds : undefined,
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: TASK }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    await drive(orca, session.id);
    await waitForIdle(orca, session.id);
    await showLifecycle(orca, agent.id);
  });
}

/**
 * Run the session, answering tool confirmations as they arrive.
 *
 * `always_ask` pauses the turn the same way a custom tool does: idle with
 * `requires_action`, and the idle event's `stop_reason.event_ids` names the
 * tool calls waiting on a decision. Each confirmation carries the waiting
 * call's event `id` as its `tool_use_id`. Here everything is allowed and
 * logged, which is the shape a real approval queue would slot into.
 */
async function drive(
  orca: ReturnType<typeof createClient>['orca'],
  sessionId: string,
): Promise<void> {
  let cursor: string | undefined;

  for (let round = 0; round < 20; round += 1) {
    const result = await streamUntilIdle(orca, sessionId, {
      fromCursor: cursor,
      capture: ['agent.mcp_tool_use', 'agent.tool_use', 'session.status_idle'],
    });
    cursor = result.cursor;

    if (result.stopReason !== 'requires_action') {
      if (result.stopReason !== 'end_turn') {
        throw new Error(`session stopped with "${result.stopReason}"`);
      }
      return;
    }

    // Prefer the ids the idle event lists. Without them, a call is waiting
    // when the engine evaluated its permission as "ask".
    const idle = result.captured.findLast((event) => event.type === 'session.status_idle');
    const waiting = new Set(waitingEventIds(idle));
    const pending = result.captured.filter(
      (event) =>
        event.type !== 'session.status_idle' &&
        (waiting.size > 0 ? waiting.has(event.id) : event['evaluated_permission'] === 'ask'),
    );
    if (pending.length === 0) {
      throw new Error(
        'the session is waiting on an action but no tool confirmation was captured',
      );
    }

    await orca.sessions.events.send(sessionId, {
      events: pending.map((event) => {
        console.log(`  approving ${String(event['name'] ?? 'tool')}`);
        return {
          type: 'user.tool_confirmation' as const,
          tool_use_id: event.id,
          result: 'allow' as const,
        };
      }),
    });
  }

  throw new Error('too many confirmation rounds');
}

/** The event ids a `requires_action` idle event says are waiting on the caller. */
function waitingEventIds(idle: { [key: string]: unknown } | undefined): string[] {
  const reason = idle?.['stop_reason'];
  const ids =
    typeof reason === 'object' && reason !== null
      ? (reason as Record<string, unknown>)['event_ids']
      : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** The five-verb shape every registry resource shares. */
async function showLifecycle(
  orca: ReturnType<typeof createClient>['orca'],
  agentId: string,
): Promise<void> {
  const current = await orca.agents.retrieve(agentId);
  console.log(`\nagent ${current.id} is at version ${current.version}`);
  console.log(`  mcp servers: ${current.mcp_servers.map((s) => s.name).join(', ') || 'none'}`);
  console.log(`  tools:       ${current.tools.map((t) => t.type).join(', ')}`);

  // The credential is never echoed. Only its existence is observable.
  console.log('\ncredentials are write-only: the API never returns the token');
}
