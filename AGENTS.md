# Repository Guidelines

Orca Cookbooks: runnable TypeScript recipes for Orca Agent Engine, each a small, complete program
that solves one real task against a live deployment and cleans up after itself.

This file is for coding agents. People start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Agents
follow the [AI policy](AI_POLICY.md): only a human adds `Signed-off-by:`, and a human approves every
push, pull request, issue and comment before an agent makes it.

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`, never `CLAUDE.md`: a write that replaces
the file turns the symlink into a copy.

## Repo map

| Path                       | What it is                                                              |
| -------------------------- | ----------------------------------------------------------------------- |
| `recipes/<name>/`          | One recipe: `README.md`, `main.ts` (default-exported `async` function), `fixtures/` |
| `lib/`                     | Shared helpers: client and config, bootstrap, streaming, custom tools, cleanup |
| `scripts/run-recipe.ts`    | `pnpm recipe <name>`: loads `.env` and runs a recipe                    |
| `scripts/check-*.{sh,ts}`  | The offline checks behind `pnpm check`                                  |
| `scripts/build-index.ts`   | `pnpm index`: regenerates the README's recipe table                     |
| `registry.yaml`            | Recipe metadata; the README table is generated from it                 |
| `authors.yaml`             | GitHub handle to author name, sorted                                    |
| `.github/`                 | CI, issue forms, the pull request template, CODEOWNERS, editor schemas  |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm check                 # naming, license headers, registry, unit tests, typecheck; offline
pnpm check:headers --fix   # add missing license headers
pnpm index                 # regenerate the README recipe table after editing registry.yaml
pnpm recipe --list
pnpm recipe <name>         # needs .env and a live deployment; consumes session time
```

## Hard rules

1. **Configuration comes from the environment.** Recipes read `ORCA_*` through
   [`lib/env.ts`](lib/env.ts). Never hardcode a model id, URL or resource id, and never name an
   AI vendor or a dated tool alias; `pnpm check:naming` rejects them.
2. **Everything a recipe creates, it releases.** Register a cleanup with `withCleanup` right after
   each create call, before the next thing that can fail, so an error or Ctrl-C part-way through
   leaves nothing behind. Sessions go through `trackSession`: the server won't delete a running
   session, so it interrupts the work first, and it releases the session ahead of the files and
   agents the session uses. After Ctrl-C, `ask` and `streamUntilIdle` throw at the next turn
   boundary; a recipe that reads a stream itself calls `throwIfStopped()` where a turn ends.
3. **Verify outcomes from evidence.** Check captured output, files or state, never the agent's own
   summary of what it did.
4. **Constraints live in the tool surface.** If a recipe says an agent lacks a tool, the toolset
   config must withhold it: `default_config: { enabled: false }` plus `enabled: true` on each tool
   the agent keeps. Tools not disabled stay enabled.
5. **Docs describe what the code does.** A recipe's README matches its `main.ts`. The root README's
   "Known limitations" lists only behaviour someone has observed. Don't describe features that
   don't exist.
6. **Never commit secrets.** `.env` is gitignored; keep it that way.
7. **Commit subjects are imperative and scoped** to what changed, for example
   `issue-to-pr: require a passing check run before merge`. Bodies explain why. The human author
   signs off (DCO, `git commit -s`), never an agent. Disclose AI help with one `Assisted-by:`
   trailer. Never add AI `Co-Authored-By:` lines, session links or references to non-public issues.
8. **Files and commit messages are public.** Never write internal hostnames, private repository
   names, customer names, personal paths, credentials or AI session links into them.
9. **Validate before review:** `pnpm install --frozen-lockfile && pnpm check`, plus `pnpm index`
   after a registry change. Run a recipe live only when a person asks you to; it costs real session
   time.

Pull requests follow [the template](.github/pull_request_template.md): what changed and why, which
recipes ran live, and AI assistance.
