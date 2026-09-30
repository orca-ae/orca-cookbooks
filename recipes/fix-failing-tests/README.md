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
- Verifying the final test command through its correlated bash tool result,
  rather than trusting the agent's summary or an agent-written report

## Why the bugs are arranged this way

`calc.py` has four faults, and they are not independent. `mean` calls `total`,
so `mean` cannot pass until `total` is right — an agent that patches `mean` in
isolation makes the symptom move rather than go away. There is also an empty
input case that raises rather than returning a value, which only surfaces by
running the tests rather than by reading the source.

That is the point of the recipe. A single-shot fix does not work; the agent has
to re-run after each change and let the failures direct it.

## Verifying the result

The agent must finish with the exact verification command supplied by the
recipe. It runs the original, read-only `test_calc.py` against the repaired
`calc.py` under `/mnt/session/outputs/workdir`, ignoring any edited test copy.
Python runs in isolated mode, with the standard-library test runner loaded
before the working directory is added to its import path.

The recipe captures `agent.tool_use` and `agent.tool_result` events and matches
the result to that final command by `tool_use_id`. Success requires a non-error
result containing all eight passing tests and the bash tool's exit code 0.
Missing execution evidence, skipped tests, a failed shell, or any later tool
call makes verification fail. `result.txt` and assistant messages are not
accepted as evidence: an agent can write a convincing report without running
anything. This is an execution check, not a security boundary against malicious
Python that deliberately tampers with the test runner.

File resources are currently read-only even when `access: read_write` is
requested, so the recipe edits only copies in the writable output workspace.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- A sandbox that allows bash execution, with `python3` in the environment image.
  The `in-memory` runtime used by the tested local stack disables bash and cannot
  complete this recipe; it must fail verification rather than simulate a run.
  The tests use only the standard library,
  so nothing needs installing beyond the interpreter itself.

## Run it

```bash
pnpm recipe fix-failing-tests
```

Expected output includes the verified `unittest` run, `OK`, and `[exit_code] 0`.

## Files

| Path | What it is |
|---|---|
| `main.ts` | The recipe |
| `fixtures/calc.py` | The module under test, with four planted faults |
| `fixtures/test_calc.py` | The suite that defines correct behaviour |
