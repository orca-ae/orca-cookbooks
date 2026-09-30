# Slow query after a deploy

## Confirming
- Latency steps at a deploy boundary.
- Database CPU rises with latency.
- One query dominates the slow-query log.

## Mitigation
Roll back the deploy. Add the missing index afterwards, not during.
