# Give an agent a database without giving it the database

An agent reviews card transactions for fraud. It has two custom tools — one
that queries, one that flags — and both run in this process against a
connection the sandbox has no route to.

The agent composes queries. It never holds a credential and could not reach the
cluster if it tried.

## What it shows

- Custom tools as a controlled bridge to a system the agent must not hold keys to
- Validating a model-composed query before executing it
- Swapping the backing store without the agent noticing

## Runs with or without Atlas

Set `MONGODB_URI` and it queries a real cluster. Leave it unset and it runs
against `fixtures/transactions.json` through an in-memory matcher that supports
enough of the query language to be useful — `$gt`, `$lt`, `$in`, `$regex`,
`$and`, `$or`.

The agent cannot tell which it got, because it only ever sees the tool. That is
the whole argument for this shape: the tool is the contract, and the storage is
an implementation detail behind it.

```bash
MONGODB_URI=mongodb+srv://...   # optional
MONGODB_DB=cookbooks            # optional, defaults to cookbooks
pnpm add mongodb                # only needed for the Atlas path
```

## Validating the filter is the interesting part

A filter document composed by a model is untrusted input. Passing it straight
to a driver is how you end up running server-side JavaScript.

`assertSafeFilter` walks the document and rejects `$where`, `$function`,
`$accumulator`, `$expr`, and `$javascript` — operators that *execute* rather
than match — and refuses any field outside a known list. It also caps nesting
depth, since a deeply recursive filter is its own denial of service.

None of those operators are needed to match on six scalar fields. The rejection
comes back as a tool error, so an agent that reaches for one is told why and
can try again.

## The pattern in the data

Forty ordinary European transactions, plus three on `acct-03`: Bangkok, duty
free, 1899.00 / 2450.50 / 980.25 EUR, between 03:15 and 04:23 on one night.

Any one of them is only mildly odd. Together — same account, same merchant,
same unusual city, tight time window, an order of magnitude above that
account's normal spend — they are a burst. The system prompt pushes toward that
reading by asking for anomalies relative to the account's own history rather
than to intuition.

## Verifying the result

Fails if nothing was flagged, or if the flags missed the planted burst entirely.
Reports how many of the three were caught.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe mongodb-atlas
```
