# Idempotency

Write endpoints accept an Idempotency-Key header. Responses are cached for 24 hours and replayed verbatim on a repeat.

## Caveat

Known gap: the cache is keyed on the header alone, not on the request body, so a reused key with a different body silently returns the first response.
