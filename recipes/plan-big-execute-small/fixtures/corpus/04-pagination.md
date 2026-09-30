# Pagination

All list endpoints are cursor-paginated. Cursors are opaque and expire after 10 minutes. Page size defaults to 25, maximum 100.

## Caveat

Known gap: cursor expiry is not surfaced distinctly - an expired cursor returns an empty page rather than an error.
