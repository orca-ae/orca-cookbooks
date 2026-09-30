# Gate an agent behind a human decision

An agent triages expense claims against a written policy. It can read, reason,
and recommend — but it cannot record anything. Both of its decision tools are
custom tools, so every call stops the turn and comes back to the host process,
which owns the ledger.

## What it shows

- Custom tools as a round trip rather than a call
- The `requires_action` bounce, and why a turn can go idle several times before
  it is actually finished
- Enforcing policy on the host side, where the agent cannot reach it
- Returning a tool error the agent can recover from

## Custom tools are not function calls

A built-in tool runs inside the sandbox and the caller never sees it. A custom
tool is the opposite. The engine emits `agent.custom_tool_use`, stops, and
waits. The turn goes idle with `stop_reason: requires_action` and stays there
until the caller sends a `user.custom_tool_result` carrying the id it was
given.

So the loop is: stream until idle, check *why* it went idle, service any
outstanding calls, resume from the cursor, repeat. That is what
`runToolLoop` in `lib/tools.ts` does, and it is why it answers every
outstanding call in one batch — an agent can request several tools in one turn,
and replying to one leaves the rest hanging.

## The trap in the fixture

Two claims are designed to be approved by an agent reading carelessly:

- `exp-2` is a legitimate travel expense with a receipt, and 880 USD. The
  amount rule is in a different paragraph from the category rule.
- `exp-4` is an 18.75 USD coffee — trivially approvable, except that it is from
  a contractor, and the contractor rule is last in the policy.

The host handler re-checks the amount rather than trusting the decision. An
over-limit approval is refused at the boundary and returned as a tool error, so
the agent sees the refusal and can escalate instead. This is the useful shape:
the gate is not advisory.

## Verifying the result

The ledger is written by this process, not by the agent, so the assertions are
about what actually got recorded — all five claims decided, and both escalation
rules honoured.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe human-in-the-loop-gate
```
