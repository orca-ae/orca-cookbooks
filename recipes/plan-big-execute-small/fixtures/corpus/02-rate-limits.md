# Rate limiting

Limits are per API key, sliding window, 1000 requests per minute. Burst allowance is 50 above the window. Exceeding returns 429 with Retry-After in seconds.

## Caveat

Known gap: the burst allowance is not shared across regions, so a multi-region client can exceed the documented ceiling by up to 4x.
