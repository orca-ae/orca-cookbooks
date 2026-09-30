# Triage an incident with a skill, and gate the fix

An agent is paged for a P1. It has runbooks available as a skill, telemetry
mounted read-only, and no way to touch production except a custom tool that
routes its proposal to a human.

## What it shows

- Uploading a multi-file skill bundle and attaching it to an agent
- Progressive disclosure: the agent sees a name and description, then reads
- A custom tool as the only path to action
- Refusing a dangerous proposal at the host boundary

## The alert is wrong, on purpose

`alert.json` is called `OrdersServiceDatabaseDegraded` and helpfully suggests
restarting the database primary. Both are misleading, and both are the kind of
thing that gets written into an alert definition once and never revisited.

The metrics tell a different story:

| Signal | What it shows |
|---|---|
| p99 latency | ramps smoothly, 210ms → 2900ms |
| error rate | lags the latency, rising only later |
| database CPU | flat at ~38% throughout |
| active connections | climbs to exactly `pool_max` and pins there |

Flat database CPU with connections pinned at the ceiling is the runbook's
signature for **connection pool exhaustion** — and `deploys.log` shows worker
concurrency going from 8 to 32 nineteen minutes before the alert fired.

An agent that reads the alert and acts produces a confident, wrong answer that
would drop every healthy connection in production.

## Why a skill rather than a system prompt

The runbooks could be pasted into the system prompt. As a skill they are
versioned, reusable across agents, and loaded only when relevant — the agent
sees the skill's name and description, and reads `SKILL.md` when it decides the
skill applies.

Only `{ type: 'custom' }` skill references take effect. The other form is
accepted by the API and then skipped when the system prompt is composed, so it
fails silently rather than loudly.

## The gate refuses

`propose_remediation` throws if the action involves restarting the database —
the one thing the runbook explicitly rules out for this failure mode. The
refusal comes back as a tool error the agent can read and act on.

That is what makes it a gate rather than a suggestion. An agent that reached
the wrong conclusion gets told so and can recover.

## Verifying the result

The recipe fails if no remediation was proposed, or if the final proposal does
not reach connection pool exhaustion. The reasoning field is printed so you can
see whether the agent ruled out the alternatives or guessed correctly.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe incident-responder
```
