# Webhooks

Delivery is at-least-once with exponential backoff over 24 hours. Payloads are signed with HMAC-SHA256 over the raw body. Consumers must verify the signature before parsing.

## Caveat

Known gap: retries reuse the original timestamp, so a strict replay window on the consumer side will reject legitimate retries.
