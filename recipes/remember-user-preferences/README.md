# Remember preferences between sessions

A session is a working context and it ends. A memory store outlives it: a small
filesystem mounted into the sandbox that the agent reads and writes with
ordinary file tools.

Two sessions run here against the same store. The first is told things in
passing. The second is a stranger to that conversation and has to recover them.

## What it shows

- Creating a memory store and mounting it as a session resource
- Seeding a store from the host before any agent runs
- The split that matters in practice: one store per customer and writable, one
  shared and read-only
- Reading back what the agent chose to keep

## Memory is a filesystem, not a retrieval index

The agent gets a mount path, not a search API. It writes markdown it wants to
find later and reads it at the start of the next conversation. That means what
ends up stored is a judgement the agent makes — which is why the system prompt
tells it what is worth keeping (things that would change a future
recommendation) and what is not (chat transcripts).

The recipe prints the stored files after the first session so you can see that
judgement rather than infer it.

## Why two stores

The server derives each mount path from the memory store name. With the default
prefix they are `/mnt/memory/cookbooks-customer-preferences/` for the writable
shopper store and `/mnt/memory/cookbooks-catalog-notes/` for the read-only
shared store. A custom `ORCA_RESOURCE_PREFIX` changes both paths. Access is set
per attachment, so the same agent gets different rights to each.

That split is the normal shape: an agent that can write to shared reference
data will eventually write to it.

## The test

Session two is asked about sizing and what to avoid. It never heard about
sizing up in outerwear, and it never heard about wool. If both come back, they
came out of the store — there is no other path for them.

The catalog supplies the rest: the Aster runs small, and the Larch is
discontinued in favour of the Cedar. The shopper already owns the Aster, which
is in personal memory, so a good answer draws on both mounts.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- A deployment with a memory backend. Memory routes are registered
  conditionally, so on a deployment without one they do not exist at all and
  this recipe will fail at store creation.

## Run it

```bash
pnpm recipe remember-user-preferences
```
