# Fix failing tests

An agent is handed a small Python module with planted bugs and its test suite,
and works until the suite is green: run the tests, read the failure, edit the
module, run again.

Start here. It is the smallest task that still exercises the whole loop, and
every other recipe assumes this one makes sense.

## What it shows

- Uploading files, mounting them read-only, and copying them into a persistent
  writable output workspace
- Giving an agent the built-in toolset so it can run and edit code in a sandbox
- Streaming a turn and knowing when it is actually finished
- Capturing an artifact the agent produced, and checking that instead of
  trusting its summary

## Why the bugs are arranged this way

`calc.py` has four faults, and they are not independent. `mean` calls `total`,
so `mean` cannot pass until `total` is right — an agent that patches `mean` in
isolation makes the symptom move rather than go away. There is also an empty
input case that raises rather than returning a value, which only surfaces by
running the tests rather than by reading the source.

That is the point of the recipe. A single-shot fix does not work; the agent has
to re-run after each change and let the failures direct it.

## Verifying the result

The agent is asked to write the final test output to
`/mnt/session/outputs/result.txt`. Anything written under that path is captured
as a session output file, so the recipe downloads it and checks for a passing
run. An agent reporting success is not evidence — the runner's own output is.
File resources are currently read-only even when `access: read_write` is
requested, so the recipe deliberately edits copies under
`/mnt/session/outputs/workdir`.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- `python3` in the environment image. The tests use only the standard library,
  so nothing needs installing beyond the interpreter itself.

## Run it

```bash
pnpm recipe fix-failing-tests
```

Expected output ends with the captured `unittest` run and `OK`.

## Files

| Path | What it is |
|---|---|
| `main.ts` | The recipe |
| `fixtures/calc.py` | The module under test, with four planted faults |
| `fixtures/test_calc.py` | The suite that defines correct behaviour |
