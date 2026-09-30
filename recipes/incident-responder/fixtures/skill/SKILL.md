---
name: incident-runbooks
description: Runbooks for triaging production alerts on the orders service - how to read the symptoms, which checks to run in what order, and what each failure mode looks like. Use when handling a page or investigating a production incident.
---

# Incident runbooks

Work the symptom, not the alert name. Alerts describe what tripped, not what
broke.

## Order of operations

1. Establish blast radius before cause. How many requests, which regions, since
   when.
2. Check the most recent change first. Most incidents are something that
   shipped.
3. Only then look at dependencies.

Do not propose a fix until you can say what the failure mode is.

## Failure modes

Each has a signature. Match the signature, not the vibe.

### Connection pool exhaustion
Latency climbs smoothly, then requests fail with timeouts rather than errors.
Error rate lags latency by minutes. Database CPU is *normal* - this is the tell
that separates it from a slow query.
See `runbooks/pool-exhaustion.md`.

### Slow query after a deploy
Latency steps up rather than climbing, and it steps at a deploy boundary.
Database CPU rises with it.
See `runbooks/slow-query.md`.

### Downstream timeout
Errors appear without a latency ramp. One dependency's error rate moves; the
rest of the system looks healthy.
