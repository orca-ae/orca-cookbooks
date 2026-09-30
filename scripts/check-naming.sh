#!/usr/bin/env bash
# Copyright The Orca Authors
# SPDX-License-Identifier: Apache-2.0

# Naming and surface gate.
#
# Fails on constructs that are easy to emit by habit but wrong for this repo:
# vendor names, dated tool aliases, skill reference forms that never compose,
# and model ids hardcoded outside .env.example.
#
# Each pattern exists because it is a mistake a careful author still makes.
#
# Written for bash 3.2 (macOS system bash), so no mapfile and no associative
# arrays.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIST="$(mktemp)"
LIST_NO_ENV="$(mktemp)"
LIST_VENDOR="$(mktemp)"
trap 'rm -f "$LIST" "$LIST_NO_ENV" "$LIST_VENDOR"' EXIT

# Tracked files plus new files that are not gitignored, so a recipe added but
# not yet staged is still checked. Excludes this script and its test, which
# must name the patterns they look for, and the lockfile.
{ git ls-files; git ls-files --others --exclude-standard; } \
  | sort -u \
  | grep -v -e '^scripts/check-naming\.sh$' -e '^scripts/check-naming\.test\.ts$' \
  | grep -v '^pnpm-lock\.yaml$' \
  > "$LIST"

# .env.example documents ORCA_MODEL without naming a value, so it is exempt
# from the model-id check only.
grep -v '^\.env\.example$' "$LIST" > "$LIST_NO_ENV"

# Attribution files, the files that disclose which AI tool assisted a
# contribution, and .gitignore, which ignores that tool's local directories,
# may name the tool. They are exempt from the vendor-name check only.
grep -v -x -e 'NOTICE' -e 'LICENSE' -e 'AI_POLICY.md' -e 'AGENTS.md' -e 'CLAUDE.md' \
  -e '.claude/settings.json' -e '.gitignore' "$LIST" > "$LIST_VENDOR"

if [ ! -s "$LIST" ]; then
  echo "check-naming: no tracked files yet, nothing to check"
  exit 0
fi

status=0

# scan <file-list> <pattern> <message> [hint...]
scan() {
  list="$1"; pattern="$2"; message="$3"; shift 3
  # Report paths only: matching source lines may contain credentials.
  hits="$(xargs -0 grep -liE -- "$pattern" < <(tr '\n' '\0' < "$list") 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    status=1
    echo "check-naming: $message"
    for hint in "$@"; do echo "  $hint"; done
    echo "$hits" | sed 's/^/    /'
  fi
}

scan "$LIST_VENDOR" 'anthropic|claude' \
  'vendor name found' \
  'This repo does not reference vendor names.' \
  'Model ids belong in .env via ORCA_MODEL, never in code or prose.'

scan "$LIST" 'agent_toolset_20260401' \
  'dated toolset alias found' \
  "Use type: 'agent_toolset' - the engine canonicalises the dated form anyway."

scan "$LIST" "(\"type\"|type)[[:space:]]*:[[:space:]]*['\"]anthropic['\"]" \
  'non-composing skill reference form found' \
  "Only { type: 'custom' } skill references take effect."

scan "$LIST_NO_ENV" '(sonnet|opus|haiku|fable)-[0-9]' \
  'hardcoded model id found' \
  'Read the id from ORCA_MODEL instead; ids are deployment-specific.'

if [ $status -eq 0 ]; then
  echo "check-naming: ok ($(wc -l < "$LIST" | tr -d ' ') files)"
fi
exit $status
