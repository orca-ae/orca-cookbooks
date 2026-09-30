# Version a prompt, catch a regression, roll back

A system prompt is not a string you edit in place. Each update to an agent
produces a new immutable version, and a session can be pinned to any version
that has ever existed. This recipe uses that to treat a prompt change as
something measurable and reversible.

## What it shows

- `agents.update` producing a new version rather than mutating the old one
- Pinning a session to a specific version with `{ type: 'agent', id, version }`
- Scoring a prompt against a labelled set
- Rolling back without deleting anything

## The v2 that looks better

The interesting part is the fixture, not the machinery. `V1` is four plain
lines. `V2` is longer, better organised, and contains this:

> A ticket that describes something not working the way the user expected is a
> bug, even when it mentions money, charges, invoices, or refunds — those are
> usually symptoms of an underlying defect rather than true billing matters.

That sentence reads like domain expertise. It is also a rule that drags
`t-1` (double charge), `t-4` (wrong VAT), and `t-7` (refund request) out of
`billing`, which is where the labels put them.

A reviewer reading the diff would very likely approve it. The evaluation is
what catches it, and that is the entire argument for versioning prompts.

## No toolset

This agent gets no `agent_toolset`. It only classifies, so a sandbox would add
startup cost and a tool surface it has no use for. Not every agent needs one.

## A note on cost

Each evaluation opens one session per ticket, so a run is 8 sessions per
version, 16 in total, plus one pinned session at the end. That is deliberate —
sharing a session across tickets would let earlier answers influence later
ones, which is not what you want from an eval.

## Verifying the result

The recipe prints per-ticket hits and misses for both versions and only rolls
back if v2 actually scored worse. If v2 happens to hold up on your model, it
says so and stops rather than pretending to find a regression.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe prompt-versioning-and-rollback
```
