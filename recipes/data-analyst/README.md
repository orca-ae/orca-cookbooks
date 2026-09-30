# Turn a CSV into a report you can open

An agent gets a sandbox with pandas and plotly, a year of sales data, and one
instruction: find what matters and write it up. The recipe pulls the generated
HTML back out and saves it locally, so the deliverable is a file you open
rather than a message you read.

## What it shows

- Building an environment with `packages` instead of reusing the shared one
- Narrow egress: `allow_package_managers` on limited networking
- Capturing an artifact from `/mnt/session/outputs/` and downloading it

## A separate environment, on purpose

Every other recipe reuses the shared cookbook environment. This one calls
`bootstrap` with a `suffix` and its own config, because it needs pip packages
the shared environment does not carry.

The networking setting is the part worth copying. Installing packages needs
egress, and nothing else in this recipe does, so it gets
`{ type: 'limited', allow_package_managers: true }` rather than unrestricted
access. The agent can reach a package index and nothing else.

## The finding hidden in the fixture

The data is generated, not random. `Cirrus` in the `West` region drops to a
quarter of its expected volume from July onward and stays there — a real
collapse buried in 192 rows across four regions and four products.

Nothing in the prompt mentions it. An analyst that reports totals and a
month-over-month trend will produce something that looks fine and misses it
entirely. The recipe notes whether it was found; it does not fail on it,
because "did the analysis notice the interesting thing" is a judgement, not an
assertion.

## Verifying the result

Two checks that are worth making: the report exists among the session outputs,
and it actually has plotly output embedded. A report referencing a CDN would
render blank offline, which is why the prompt asks for standalone HTML and the
recipe checks for it.

The saved file lands in `recipes/data-analyst/out/report.html`.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`
- A deployment whose environments can install pip packages. Not every
  deployment allows that; see "Known limitations" in the root README

## Run it

```bash
pnpm recipe data-analyst
```
