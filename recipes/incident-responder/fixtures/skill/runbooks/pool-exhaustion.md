# Connection pool exhaustion

## Confirming
- Latency ramp, not a step.
- Timeouts rather than 5xx from the application.
- Database CPU and slow-query log both normal.
- Active connections at or near the configured pool ceiling.

## Cause
More concurrent work than the pool can hand out. Usually a change to
concurrency, a retry loop, or a leak where connections are not returned.

## Mitigation
Raising the pool ceiling relieves symptoms and does not fix a leak. Prefer
finding what stopped returning connections. If a leak is confirmed, restarting
the affected pods buys time.

## Do not
Do not restart the database. The database is not the problem in this failure
mode and a restart drops every healthy connection too.
