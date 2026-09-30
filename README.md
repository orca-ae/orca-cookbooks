# Orca Cookbooks

Runnable recipes for [Orca Agent Engine](https://github.com/orca-ae/orca-agent-engine). Each one is
a small, complete program that solves a real task and can be read in a sitting.

Recipes are TypeScript, built on the Orca TypeScript SDK, `@runorca/orca-sdk`. Every one reads its
configuration from the environment, creates what it needs, and cleans up after itself, so you can
run any of them repeatedly without leaving residue behind.

Documentation for the engine and its API lives at [docs.runorca.ai](https://docs.runorca.ai).

## Prerequisites

- Node.js 22 or later, with pnpm. `corepack enable` provides the pnpm version pinned in
  `package.json`. Recent Node.js releases no longer include corepack; if the command isn't found,
  run `npm install -g corepack` first.
- A reachable Orca Agent Engine deployment. To run one yourself, follow the engine's
  [quick start](https://github.com/orca-ae/orca-agent-engine#quick-start). The recipes run real
  agents, so the engine needs a model provider configured, as its quick start describes. A hosted
  workspace works too.
- A workspace API key for that deployment. For a self-hosted engine, the
  [engine docs](https://docs.runorca.ai) explain how to create one; a hosted workspace issues keys
  from its settings.

## Setup

```bash
git clone https://github.com/orca-ae/orca-cookbooks.git
cd orca-cookbooks
cp .env.example .env    # fill in ORCA_BASE_URL, ORCA_API_KEY and ORCA_MODEL
pnpm install
```

`ORCA_MODEL` is deliberately not defaulted, because the ids available to you depend on the model
provider your deployment uses:

- **Self-hosted engine:** use a model id that the provider configured in your engine accepts.
- **Hosted workspace:** list the ids with the `ork` CLI.

  ```bash
  brew install orca-ae/tap/ork
  ork agent providers list
  ```

## Running a recipe

```bash
pnpm recipe --list
pnpm recipe fix-failing-tests
```

Start with `fix-failing-tests`. It is the smallest recipe that still uses the whole loop, and the
others assume it makes sense.

## Recipes

<!-- recipes:start -->

### Getting Started

| Recipe | What it shows |
| --- | --- |
| [Fix failing tests](recipes/fix-failing-tests) | An agent copies mounted fixtures into a writable output workspace, then iterates on four entangled faults until its suite is green, verified from the final bash tool result against the original read-only tests. |

### Tools and Permissions

| Recipe | What it shows |
| --- | --- |
| [Gate an agent behind a human decision](recipes/human-in-the-loop-gate) | Custom tools as a round trip. The agent recommends; the host process holds the ledger and refuses an over-limit approval at the boundary. |
| [Take an issue to a merged pull request](recipes/issue-to-pr) | Three turns on one session - fix, CI failure, review comment - against a mock CLI rigged to fail the first check run. |

### Files and Resources

| Recipe | What it shows |
| --- | --- |
| [Explore an unfamiliar codebase](recipes/explore-unfamiliar-codebase) | Documentation that is confidently wrong, and an agent that has to ground itself in the source. Adds a resource to a session already running. |
| [Turn a CSV into a report you can open](recipes/data-analyst) | A sandbox built with pandas and plotly, a year of sales data, and one collapse buried in it. The generated HTML is downloaded and saved. |

### Memory

| Recipe | What it shows |
| --- | --- |
| [Remember preferences between sessions](recipes/remember-user-preferences) | Two sessions, one memory store. The second never heard the first conversation and has to recover what matters from what was written down. |

### Multiagent

| Recipe | What it shows |
| --- | --- |
| [Coordinate a team whose members have different tools](recipes/coordinate-specialist-team) | Three specialists with three tool surfaces, including one with no tools at all - so the coordinator cannot shortcut its own team. |
| [Plan big, execute small](recipes/plan-big-execute-small) | A coordinator with no read tool reviews six documents by handing each to a worker, spending its own context on the comparison instead. |
| [Watch subagents work, live](recipes/watch-subagents-live) | A coordinator delegates to three specialists, and a follower attaches to each thread as it appears so the work is visible while it happens. |

### Skills

| Recipe | What it shows |
| --- | --- |
| [Triage an incident with a skill, and gate the fix](recipes/incident-responder) | Runbooks as an uploaded skill, telemetry whose alert name is misleading, and a remediation tool that refuses the one thing the runbook forbids. |

### MCP

| Recipe | What it shows |
| --- | --- |
| [Wire an agent to an MCP server](recipes/operate-in-production) | The three pieces that must line up - server, toolset reference, and a vault credential bound by URL - plus answering always_ask confirmations. |

### Operations

| Recipe | What it shows |
| --- | --- |
| [Version a prompt, catch a regression, roll back](recipes/prompt-versioning-and-rollback) | A v2 that reads like an improvement and scores worse. Measures both against labelled data, then pins new sessions to the version that won. |

### Applications

| Recipe | What it shows |
| --- | --- |
| [A chat bot whose backend is the session](recipes/slack-data-bot) | Thread id in session metadata as the only record of the mapping, recovered by search after a restart. Two interleaved threads, no crosstalk. |
| [Give an agent a database without giving it the database](recipes/mongodb-atlas) | Custom tools bridge to a store the sandbox cannot reach, and the query tool validates a model-composed filter before executing it. |

<!-- recipes:end -->

All fixture data is fictional.

## Known limitations

- **data-analyst** builds its sandbox with `pip` packages. It needs a deployment that allows
  environment package installation, and not every deployment does.
- **watch-subagents-live** attaches to each subagent thread when its `session.thread_created`
  event arrives. Some deployments don't project that event onto the session's primary stream;
  there the recipe finds threads by polling instead, so its followers attach a little later.
- **operate-in-production** needs an external MCP server that speaks Streamable HTTP, so it isn't
  self-contained. It explains what to set and exits when `ORCA_MCP_SERVER_URL` is unset.

## What is deliberately absent

Some capabilities don't exist in the engine, so no recipe pretends they do:

| Capability | Status |
|---|---|
| Session spend budgets | `POST /v1/sessions` rejects a `budget` field |
| Advisor roster entries | The roster accepts agents and `self` only |
| Pinning inference to a geography | `model.inference_geo` is accepted, then dropped |
| Outcome grading that re-drives an agent | Outcomes are advisory |
| Skills discovered from a mounted repository | Mounted checkouts are not scanned |
| Scheduled deployments | Not implemented; triggers, in hosted workspaces, are the closest thing |

## Layout

| Path | What it is |
| --- | --- |
| `recipes/<name>/` | One recipe: `README.md`, `main.ts`, and its fixtures |
| `lib/` | Shared helpers: client, bootstrap, streaming, custom tools, cleanup |
| `scripts/` | The recipe runner and the checks |
| `registry.yaml` | Recipe metadata; the table above is generated from it |
| `authors.yaml` | Recipe authors, keyed by GitHub handle |

## Checks

```bash
pnpm check          # naming, license headers, registry, unit tests, typecheck
pnpm index          # regenerate the recipe table
```

`pnpm check` runs offline and needs no credentials. Running a recipe against a live deployment
consumes real session time, so that is never automatic.

## What is in `lib/`

Three behaviours are worth knowing about, because they are easy to get wrong and are handled once
here rather than in each recipe.

**Resume cursors are transport cursors.** The SDK exposes JSON event UUIDs but discards the SSE
`id:` sequence required by `from_cursor`. The helper streams a first turn live, then polls persisted
history after the last UUID for later turns so nothing is replayed or skipped.

**Idle is not immediate.** The `session.status_idle` event can arrive before the server has
committed the status change, so deleting straight after the event fails. `waitForIdle` polls the
session record to close that window.

**A session has to stop before it can go.** The server won't delete a running session, and a
recipe that fails or is interrupted mid-turn leaves one running. `trackSession` registers a release
that interrupts every thread still working, waits for idle, then deletes, ahead of the files and
agents the session uses. `withCleanup` runs it on Ctrl-C too, and the streaming helpers stop the
recipe at its next turn boundary so it doesn't start new work while cleanup runs.

## Contributing

New recipes and fixes are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to add a recipe
and what `pnpm check` expects. If you use an AI assistant, read the [AI policy](AI_POLICY.md) first.
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Where to talk

- [Issues](https://github.com/orca-ae/orca-cookbooks/issues) for broken recipes and recipe requests.
- [Discussions](https://github.com/orca-ae/orca-cookbooks/discussions) for questions and ideas.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## License

Orca Cookbooks is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
