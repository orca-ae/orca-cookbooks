# Contributing to Orca Cookbooks

Thanks for your interest in Orca Cookbooks, the runnable recipes for Orca Agent Engine. New recipes,
fixes to existing ones, documentation and bug reports are all welcome.

> **Using an AI assistant?** Read the [AI policy](AI_POLICY.md) first.
> **Are you a coding agent?** Start with [AGENTS.md](AGENTS.md).

## Ways to contribute

- **Report a broken recipe.** Open an
  [issue](https://github.com/orca-ae/orca-cookbooks/issues/new/choose). Problems in Orca Agent
  Engine itself, the `ork` CLI or the TypeScript SDK belong in the
  [engine repository](https://github.com/orca-ae/orca-agent-engine/issues).
- **Propose a recipe.** Open a recipe request, or start a
  [discussion](https://github.com/orca-ae/orca-cookbooks/discussions/categories/ideas) if the idea
  is still taking shape.
- **Fix something.** Comment on the issue to say you're working on it, so nobody duplicates your
  work.
- **Improve the docs.** If a recipe confused you, it will confuse the next person too.

## Where to talk

| For                                      | Use                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Broken recipes and concrete requests     | [Issues](https://github.com/orca-ae/orca-cookbooks/issues)                                    |
| Questions                                | [Discussions: Q&A](https://github.com/orca-ae/orca-cookbooks/discussions/categories/q-a)     |
| Recipe ideas and changes to discuss first | [Discussions: Ideas](https://github.com/orca-ae/orca-cookbooks/discussions/categories/ideas) |
| Security vulnerabilities                 | Report privately, as described in [SECURITY.md](SECURITY.md)                                 |
| Conduct concerns                         | See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                                                  |

## Before you write code

- **Small, self-contained changes** can go straight to a pull request: a fix to a recipe, a
  documentation correction, a typo.
- **A new recipe** is easier to land when its scope is agreed first. Open a recipe request that
  says what task the agent solves and what the recipe shows that no other recipe does.
- **Changes to the shared helpers in `lib/` or to repository conventions** start as an
  [Ideas discussion](https://github.com/orca-ae/orca-cookbooks/discussions/categories/ideas). If the
  change needs a written design, a maintainer will ask for an Orca Improvement Proposal (OIP) in
  `proposals/`, numbered within this repository. Recipes and fixes don't need one.

## Build and test

You need Node.js 22 or later and pnpm. `corepack enable` provides the pnpm version pinned in
`package.json`. Recent Node.js releases no longer include corepack; if the command isn't found, run
`npm install -g corepack` first.

```bash
git clone https://github.com/orca-ae/orca-cookbooks.git
cd orca-cookbooks
pnpm install --frozen-lockfile
```

Before you open a pull request, run the checks that CI runs:

```bash
pnpm check    # naming, license headers, registry, unit tests, typecheck
pnpm index    # regenerate the README's recipe table from registry.yaml
```

`pnpm check` runs offline and needs no credentials. `pnpm check:headers --fix` adds a missing
license header, and CI fails when `pnpm index` would change the README.

Running a recipe needs a reachable Orca Agent Engine deployment and consumes real session time, so
it is never automatic:

```bash
cp .env.example .env    # fill in ORCA_BASE_URL, ORCA_API_KEY and ORCA_MODEL
pnpm recipe fix-failing-tests
```

If you changed what a recipe does, run it and say so in your pull request.

## Adding a recipe

A recipe is one directory under `recipes/`:

| Path                       | What it is                                                     |
| -------------------------- | -------------------------------------------------------------- |
| `recipes/<name>/README.md` | What the recipe shows, how to run it, and what to look for     |
| `recipes/<name>/main.ts`   | The program. Its default export is an `async` function         |
| `recipes/<name>/fixtures/` | Files the agent works on. Keep them small and fictional        |

Then add an entry to [`registry.yaml`](registry.yaml), add yourself to
[`authors.yaml`](authors.yaml) (keyed by GitHub handle, sorted), and run `pnpm index`.
`pnpm check:registry` checks the entry.

Every recipe follows these rules:

- **Configuration comes from the environment**, through [`lib/env.ts`](lib/env.ts). No recipe
  hardcodes a model id, a URL or a resource id.
- **Everything a recipe creates, it releases.** Register a cleanup for each resource right after
  you create it, and register sessions with `trackSession`, so a failure or Ctrl-C part-way
  through leaves nothing behind.
- **Check results, not the agent's account of them.** Verify an outcome from captured output or
  state, as `fix-failing-tests` does, rather than from the agent's summary.
- **Constraints live in the tool surface.** When a recipe says an agent can't do something, its
  toolset has to withhold the tool; a prompt alone doesn't hold under pressure.
- **The README describes what `main.ts` does.** Don't describe behaviour the code doesn't have.
- **No vendor names and no dated tool aliases.** `pnpm check:naming` explains what it rejects.

## Code style

- TypeScript on Node.js, as ES modules, with two-space indentation.
- A recipe should be readable in a sitting. Comments explain why, not what.
- `camelCase` for values, `PascalCase` for types and classes.
- Never commit secrets. Read them from the environment; `.env` is ignored by git.
- Files, commit messages and pull requests are public. Don't write internal hostnames, private
  repository names, customer names, personal paths, credentials, AI session links or references to
  non-public issues into them.

## Commits

### Sign your commits (DCO)

Every commit needs a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "fix-failing-tests: verify the suite from captured output"
```

The `-s` flag adds a line such as `Signed-off-by: Your Name <you@example.com>`. The line certifies
that you wrote the change, or otherwise have the right to submit it under the project's license. The
full text is at [developercertificate.org](https://developercertificate.org/).

If you forgot to sign off, fix the last commit with `git commit --amend -s --no-edit`, or a series
with `git rebase --signoff origin/main`, and then force-push your branch.

We don't use a CLA. The DCO sign-off is all we ask.

### Write useful messages

Start the subject with what you changed, such as a recipe name, `lib`, `scripts` or `docs`, then a
short summary in the imperative mood: `issue-to-pr: require a passing check run before merge`. In
the body, explain why the change is needed and call out any follow-up work.

Pull requests are squash-merged. The pull request title becomes the commit subject on `main`, so
title your pull request the same way. The squashed commit keeps the `Signed-off-by:` and
`Assisted-by:` trailers of the commits it replaces.

### Say when AI helped

If an AI tool helped meaningfully, add one `Assisted-by:` trailer that names the tool, in the form
`Assisted-by: <tool>`. Don't credit a tool with `Co-authored-by:`, which is for people, and don't
add session links or other trailers that a tool generates. The [AI policy](AI_POLICY.md) explains
what counts.

## Pull requests

1. Fork the repository on GitHub, create a branch for your change, and push it to your fork.
2. Keep each pull request to one logical change. Smaller pull requests get reviewed sooner.
3. Fill in the [pull request template](.github/pull_request_template.md): what changed and why,
   which recipes you ran, and AI assistance.
4. Make sure CI passes.
5. A code owner reviews and approves the change. Code owners are listed in
   [CODEOWNERS](.github/CODEOWNERS).

If your pull request has been quiet for a while, @-mention one of the maintainers.

## Security issues

Don't report a vulnerability in a public issue, pull request or discussion. Follow
[SECURITY.md](SECURITY.md) instead.

## License

Orca Cookbooks is licensed under the [Apache License 2.0](LICENSE), and so is your contribution.
If you copy code from another project, keep its license header in the file and add the project to
[NOTICE](NOTICE) in the same pull request.
