# A chat bot whose backend is the session

A thread in a chat tool is a conversation. A session is a conversation. This
recipe maps one to the other directly: the thread id goes into the session's
`metadata`, and that is the only record of the mapping.

No database, no cache to invalidate, nothing to keep in sync.

## What it shows

- `metadata` on a session as routing state
- Recovering the thread-to-session mapping after a process restart
- Per-thread cursors, so a follow-up resumes instead of replaying
- Keeping the transport thin enough to swap

## The session is the record

The usual instinct is a table: `thread_id -> session_id`, written on create,
read on every message. Then you own a store, its migrations, and the drift
between it and reality when a session is archived out from under it.

Stamping the thread id into the session's metadata removes all of that. To find
the session for a thread you ask the engine, and the answer is authoritative
because it is not a copy.

`ThreadRouter` still keeps an in-process cache — it saves a round trip — but the
cache is not the source of truth. `resolve` falls back to a metadata search, so
a restarted bot picks up threads it has never seen. That fallback is what makes
the design work.

The run restarts the bot halfway through to prove it: the first message in each
thread goes to one router, and the follow-ups go to a new router with an empty
cache. The per-thread cursor is in-memory state too, so a recovered thread
resumes after the last event its session has recorded. Without that, the next
stream would replay the thread from its first message and hand back an old
answer.

## Interleaved threads

The simulated inbox alternates between two threads on purpose:

```
alpha: best and worst products?
beta:  which region grew most?
alpha: break the worst one down by region     <- "the worst one" from alpha
beta:  and which was flat?                    <- "and" continues beta
```

Both follow-ups are meaningless without their own thread's history, and would
be wrong if the threads shared a session. Two sessions, two cursors, no
crosstalk.

## Swapping in a real transport

`InboundMessage` is `{ threadId, text, attachment? }`, because that is all a
real adapter needs to hand over. To wire an actual chat tool, replace the
simulated inbox with its event handler and map:

- thread identifier → `threadId` (use the parent thread, not the message id)
- message body → `text`
- the router's return value → post back into the thread

Everything else stays. Verify webhook signatures in the adapter, before
anything reaches the router.

## A scaling caveat

Sessions cannot be filtered by metadata server-side, so `search` lists the
agent's sessions and matches locally. That is fine at cookbook scale and it is
a full scan. A busy deployment should keep an index and treat the metadata as
the recovery path rather than the lookup path.

## Verifying the result

Four messages across two threads must produce exactly two sessions, and each
follow-up must reach the session its thread had before the restart. More
sessions would mean routing failed; fewer would mean threads were merged. A
follow-up that gets its thread's previous reply back means the resumed stream
replayed history.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- `python3` in the environment image

## Run it

```bash
pnpm recipe slack-data-bot
```
