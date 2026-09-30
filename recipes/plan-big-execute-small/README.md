# Plan big, execute small

A coordinator reviews six API reference documents without reading any of them.
It lists what exists, hands each document to a reader, and synthesises the
reports that come back.

## What it shows

- Delegating the reading and keeping the thinking
- One reusable worker definition serving many parallel units of work
- Enforcing the arrangement through the tool surface, not just the prompt
- Checking that delegation actually happened, via thread count

## Why not just read them

A coordinator that reads six documents ends the job carrying six documents. Its
context fills with raw material it no longer needs, and the synthesis — the
part only it can do — happens with the least room to do it in.

Fanning out inverts that. Each reader spends its whole context on one document
and returns a short report. The coordinator's context holds six reports and the
brief, which is what it needs to compare them.

The saving is context, not just wall-clock. That is why the readers run on
`ORCA_MODEL_FAST`: extracting caveats from one document is narrow work, and the
comparison across documents is where the stronger model earns its place.

## The constraint is in the tools

The coordinator's prompt says not to read the documents. Prompts are advice.
The coordinator's toolset is `glob` only — no `read`, and no `grep`, which
would print the contents it matched — so it can discover what is there and
cannot open it. Every other tool is disabled explicitly, with
`default_config.enabled: false`: a tool that isn't disabled stays enabled.

The readers get `read`, `glob`, and `grep`, and no shell.

This is the general lesson: if an arrangement matters, put it in the tool
surface. An agent under pressure will do the sensible-looking thing the prompt
told it not to.

## What is planted in the corpus

Each document is unremarkable on the happy path and ends with a `Caveat`
section describing something that only bites in production — refresh token
revocation lag, a burst allowance that is not shared across regions, webhook
retries reusing the original timestamp, an idempotency cache keyed on the
header but not the body.

A synthesis built from skimming will produce a reasonable-sounding summary and
mention none of them. The recipe reports how many reached the final answer.

## What this recipe does not do

Comparing the cost of delegation against a single-agent control is the obvious
next measurement, but per-thread `usage` is not reliably populated, so a cost
comparison here would be arithmetic on absent data. The recipe measures what it
can actually observe: whether delegation happened, and whether the findings
survived the trip back.

## Verifying the result

Fails if only one thread ran — meaning the coordinator never delegated — or if
none of the planted caveats reached the synthesis.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe plan-big-execute-small
```
