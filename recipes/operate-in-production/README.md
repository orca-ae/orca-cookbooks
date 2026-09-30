# Wire an agent to an MCP server, with credentials it never sees

Three pieces have to line up to give an agent a remote tool, and each one fails
differently when it is wrong. This recipe wires all three and answers the
permission prompts that result.

## What it shows

- Declaring an MCP server on an agent and referencing it from an `mcp_toolset`
- Storing a bearer credential in a vault and attaching the vault to a session
- `always_ask` permissions, and answering `user.tool_confirmation`
- Why the agent record never names a credential

## The three pieces

**1. Declare the server.** `mcp_servers: [{ name, type: 'url', url }]` on the
agent. Only `type: 'url'` is accepted — the transport is Streamable HTTP, and
`sse` and `stdio` servers are rejected.

**2. Reference it from a toolset.** Every declared server must be named by an
`mcp_toolset` tool. Declaring a server and forgetting the toolset entry is a
400 on create, not a silent no-op — which is the good outcome, and easy to hit
because the server declaration alone looks complete.

**3. Bind a credential by URL.** The vault credential carries
`mcp_server_url`, and it must match the URL on the agent exactly. Binding is by
URL, *not* by server name, so a credential that looks correctly named and has a
different URL simply does not apply — and that one does fail quietly.

The session gets `vault_ids`. The agent record never references a credential at
all.

## Where the credential goes

Nowhere the agent can reach. The token is injected at the gateway on the way
out. It does not enter the sandbox, does not reach the model, and is never
echoed back — credential fields are write-only, so you cannot read one back to
check it. Rotating means writing a new value.

## always_ask is the same pause as a custom tool

The MCP toolset is set to `always_ask` because remote tools reach outside the
sandbox. When the agent calls one, the turn goes idle with `requires_action`,
and the idle event's `stop_reason.event_ids` lists the calls waiting on a
decision. Each waits for a `user.tool_confirmation` whose `tool_use_id` is that
call's event `id` — structurally identical to the custom-tool round trip in
`human-in-the-loop-gate`.

This recipe approves everything and logs it, which is where a real approval
queue would sit.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- An MCP server over Streamable HTTP:

```bash
ORCA_MCP_SERVER_URL=https://your-mcp-server.example/mcp
ORCA_MCP_SERVER_TOKEN=<bearer token>   # omit if the server needs no auth
```

The recipe explains and exits if the URL is unset rather than failing obscurely.

## What is not here

Pinning inference to a geography is not covered: the engine accepts
`model.inference_geo` and then drops it, so a recipe could only pretend. The
root README lists the capabilities the engine leaves out.

## Run it

```bash
pnpm recipe operate-in-production
```
