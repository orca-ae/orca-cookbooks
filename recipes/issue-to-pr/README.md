# Take an issue to a merged pull request

Three turns on a single session, each one reacting to something the previous
turn could not have known: the fix, then a CI failure, then a review comment.

## What it shows

- Steering a session that is already in motion, across several turns
- Threading the event cursor so each turn resumes instead of replaying
- Giving an agent a tool surface it cannot see past — here, a mock `gh`

## The mock CLI

`fixtures/gh` is a small offline Python program with state in `.gh-state/`. It
supports `issue view`, `pr create`, `pr checks`, `pr comments`, and `pr merge`,
and it is the only way for the agent to interact with the world.

The uploaded fixture is mounted read-only. The agent copies it into
`/mnt/session/outputs/orders` before starting, giving both source edits and the
mock CLI state a persistent writable workspace.

It is rigged in two ways that matter:

**The first `pr checks` run always fails, whatever the code does.** The agent
has to come back to code it had already decided it was finished with. This is
the common real shape — being done is a claim CI gets to reject — and it is
invisible from the issue text. Later runs report the real result of the test
suite.

**`pr merge` refuses unless the latest check run passed.** An agent that tries
to shortcut straight to merging, or to merge over a red check, is stopped by
the tool, not by the prompt.

## The bug, and why the tests miss it

`discount_total` applies the discount inside the accumulation loop, so it
compounds per line. Three 100.00 lines at 10% return **243.90** instead of
270.00 — an effective 18.7% off.

The existing test suite passes. Its only discount test uses a single line item,
and one line cannot compound. So the agent has to notice that a green suite is
not evidence here, and strengthen the test as part of the fix. The issue says
as much, which is the hint. CI doesn't enforce it: the rigged first run fails
whatever the code does, and later runs only run the suite the agent leaves
behind, so strengthening the test is the agent's own call.

## Verifying the result

The recipe asserts the transcript reports a merge. The mock merges only after a
passing check run, so a real merge means the agent's final suite passed. The
transcript is still the agent's own account, which makes this a weaker check
than reading the final source or the mock's state.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- `python3` in the environment image

## Run it

```bash
pnpm recipe issue-to-pr
```
