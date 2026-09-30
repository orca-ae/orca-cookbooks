# Explore an unfamiliar codebase

An agent is pointed at a small service and asked how it works. The catch is
that `ARCHITECTURE.md` is confidently, specifically wrong — it describes a
synchronous design the code abandoned when latency became a problem.

## What it shows

- Grounding an agent in source rather than in prose about the source
- Mounting several files as read-only session resources
- Adding a resource to a session that is already running and has already
  answered once

## Why the fixture is shaped this way

The stale document is not vague. It says payment happens inline, that an order
row only exists after the card is charged, and that there is no queue or worker.
Every one of those is false: `api.py` writes a `pending_payment` row, returns
`202`, and publishes to a queue; `worker.py` does the charging afterwards.

The document is the most readable file in the tree and it is the first thing a
summariser reaches for. An agent that trusts it produces a fluent answer that
would send an engineer looking for a bug in the wrong file.

`worker.py` — the file that makes the real design legible — is deliberately
withheld from the initial mount. The first turn has to reach the right shape
from `api.py` and `queue.py` alone; the second turn gets the worker mounted
into the live session and is asked what it got wrong.

## Verifying the result

The first answer is checked for the asynchronous reality, and the second for
engagement with the late-mounted file. Neither is a strong test of quality —
they catch the specific failure the fixture is built to provoke, which is
summarising the documentation.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe explore-unfamiliar-codebase
```
