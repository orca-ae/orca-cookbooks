# Error model

Errors return a stable machine-readable type plus a human message. Types are namespaced by resource.

## Caveat

Known gap: validation errors report only the first failing field, so a client cannot show all problems at once.
