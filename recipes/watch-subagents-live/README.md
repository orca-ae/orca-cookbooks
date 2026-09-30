# Watch subagents work, live

A coordinator delegates a lesson plan to three specialists. Each runs in its own
thread, and this recipe attaches a follower to every thread as it appears, so
you watch several agents work at once instead of waiting for one summary.

## What it shows

- A coordinator with a roster of specialist agents
- `initial_events`, so work begins at session creation
- Watching the primary stream for `session.thread_created`, with polling
  `sessions.threads.list` as the fallback
- Opening a per-thread stream with `sessions.threads.events.stream`
- Per-thread accounting afterwards with `sessions.threads.list`

## Why you need the thread streams

The primary session stream carries the coordinator's view: a thread appeared, a
thread went idle, here is the assembled answer. It does not carry what the
subagents said to themselves along the way. If you only read the primary
stream, delegation looks like a long pause followed by a result.

Opening each thread's own stream is what makes the work visible while it is
happening. The followers run concurrently and are awaited when the session goes
idle. A follower that fails is logged rather than propagated — losing sight of
one subagent is not a reason to abandon the session.

Some deployments don't project `session.thread_created` onto the primary
stream. The recipe also polls the session's thread list every couple of
seconds, so on those deployments a follower still attaches, a little after the
thread starts, and its output says the thread was found by polling. The run
fails only if subagents ran and no follower attached to any of them.

## Roster entries are just agents

The specialists are created as ordinary agents with nothing special about them.
They become subagents by being named in the coordinator's `multiagent` roster.
The roster accepts an agent id, `{ type: 'agent', id, version }` for a pinned
version, or `{ type: 'self' }`.

There is exactly one roster level — a coordinator cannot contain another
coordinator.

## Model choice

The specialists run on `ORCA_MODEL_FAST` and the coordinator on `ORCA_MODEL`.
The scoped work is narrow and well specified; the assembly is the part that
benefits from the stronger model. If `ORCA_MODEL_FAST` is unset it falls back
to `ORCA_MODEL`, so the recipe still runs with one model configured.

## On per-thread usage

`sessions.threads.list` returns a `usage` block, and it may come back empty —
the field is shape-aligned but not always populated. The recipe prints what is
there and says so when there is nothing, rather than reporting zeros as if they
were measurements.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe watch-subagents-live
```

Output interleaves the coordinator's narration with `[thread]`-prefixed lines
from each specialist.
