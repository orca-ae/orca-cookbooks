<!--
Thanks for contributing! Please read CONTRIBUTING.md before opening a pull request.
Keep each pull request to one logical change, and title it the way you would write a commit
subject, for example "issue-to-pr: require a passing check run before merge".
-->

### What changes and why

<!-- Link the issue or discussion this addresses (for example, "Fixes #123"). Call out changes to
     lib/, CI or templates. -->

### Recipes run live

<!-- Which recipes you ran with `pnpm recipe <name>`, against what kind of deployment (local stack,
     Kubernetes, hosted), and the lines of output that show the result. Remove hostnames, ids and
     keys first. If you ran none, say why. -->

### AI assistance

<!-- Required when an AI tool generated or substantially rewrote code, tests, documentation or a design in
     this pull request. Autocomplete, spelling and grammar fixes, formatting and mechanical renames don't
     count. See AI_POLICY.md. Choose one: -->

- [ ] No AI assistance
- [ ] AI-assisted. Tool(s): ___ . What it did: ___ . How I verified the result: ___ .

### Checklist

- [ ] Every commit is signed off (`git commit -s`), as described in CONTRIBUTING.md
- [ ] Commits with meaningful AI assistance carry one `Assisted-by:` trailer
- [ ] `pnpm check` passes locally, and `pnpm index` has been run if `registry.yaml` changed
- [ ] Each changed recipe's README still describes what its `main.ts` does
- [ ] Everything a changed recipe creates is released, including when it fails part-way
