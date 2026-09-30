# Coordinate a team whose members have different tools

A coordinator produces a sales proposal using three specialists. The point is
not that work is delegated — it is that each specialist gets a *different tool
surface*, and the shape of the team comes from those differences.

## What it shows

- Scoping the built-in toolset per role: `default_config.enabled: false`, then
  `configs` entries with `enabled: true` for the tools a role keeps. A tool that
  isn't disabled stays enabled, so listing tools in `configs` alone restricts
  nothing
- A roster member with no tools at all
- Making a coordinator depend on its specialists rather than shortcut them

## The three surfaces

| Role | Tools | Why |
|---|---|---|
| Pricing analyst | full toolset | Reads the rules and does the arithmetic in a shell |
| Account researcher | `read`, `glob`, `grep` | Needs to read notes; has nothing to execute |
| Proposal writer | none | Works only from the brief it is handed |

The writer having no tools is the load-bearing choice. Give it file access and
it will eventually go and read the pricing rules itself, and then you have two
agents independently computing a price. Withholding the tools makes the
dependency real: the writer cannot produce a number the analyst did not supply.

The researcher's narrowed toolset is the same idea, more mildly. It has no
reason to run a shell, so it does not get one.

## Why the analyst uses a shell for arithmetic

Tiered pricing with floors is exactly where mental arithmetic slips. 340 seats
falls in the 100–499 band at 18%, and the two-year prepaid takes a further 8%
off the post-volume price — 1200 → 984 → 905.28. That is a compounding
sequence, not a single subtraction, and the floors have to be checked against
the result rather than the list price.

The system prompt tells the analyst to show each step, so a wrong number is
visible rather than merely wrong.

## The fixture's tension

`account-notes.md` says procurement wants "under 800 a seat", twice. The rules
give 905.28. That gap is deliberate: a good proposal has to address it rather
than quietly quote 800, and the floor rules mean it cannot simply discount to
meet it. Watch whether the team surfaces the conflict or papers over it.

## Verifying the result

The recipe requires the two-year commitment to be addressed, since the account
explicitly asked about it, and warns if the per-seat figure is far from 905.28.
The price check is a warning rather than a failure — models phrase numbers in
ways a regex should not be trusted to adjudicate.

## Prerequisites

- A reachable Agent Engine deployment, and `.env` filled in from `.env.example`

## Run it

```bash
pnpm recipe coordinate-specialist-team
```
