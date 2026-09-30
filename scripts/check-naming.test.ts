// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs scripts/check-naming.sh against throwaway git repositories, so each
 * case sees exactly the files it sets up. Like the script, this file has to
 * name what it looks for, and the naming gate exempts it for that reason.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = join(import.meta.dirname, 'check-naming.sh');
const VENDOR = 'Claude';
const TOOL_TRAILER = `Assisted-by: ${VENDOR} Code`;

/** Build a repo holding the given files (path -> content) and run the gate in it. */
function runGate(files: Record<string, string>, symlinks: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-naming-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'scripts'));
    copyFileSync(SCRIPT, join(root, 'scripts', 'check-naming.sh'));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    for (const [path, target] of Object.entries(symlinks)) {
      symlinkSync(target, join(root, path));
    }
    const run = spawnSync('bash', [join(root, 'scripts', 'check-naming.sh')], { encoding: 'utf8' });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a vendor name in a recipe fails the gate', () => {
  const run = runGate({ 'recipes/demo/README.md': `Built on ${VENDOR}.\n` });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /vendor name found/);
});

test('a vendor name in contributor docs fails the gate', () => {
  const run = runGate({ 'CONTRIBUTING.md': `Use ${TOOL_TRAILER}.\n` });
  assert.equal(run.status, 1, run.output);
});

test('attribution and AI-disclosure files may name the tool', () => {
  const run = runGate(
    {
      'NOTICE': `Portions from a ${VENDOR} project.\n`,
      'LICENSE': `${VENDOR}\n`,
      'AI_POLICY.md': `${TOOL_TRAILER}\n`,
      'AGENTS.md': `The ${VENDOR}.md file points here.\n`,
      '.claude/settings.json': `{ "attribution": { "commit": "${TOOL_TRAILER}" } }\n`,
    },
    { 'CLAUDE.md': 'AGENTS.md' },
  );
  assert.equal(run.status, 0, run.output);
});

test('.gitignore may name the tool directory it ignores', () => {
  const run = runGate({ '.gitignore': `.${VENDOR.toLowerCase()}/worktrees/\n` });
  assert.equal(run.status, 0, run.output);
});

test('the repository gitignore excludes local .envrc credentials from the gate', () => {
  const run = runGate({
    '.gitignore': readFileSync(join(import.meta.dirname, '..', '.gitignore'), 'utf8'),
    '.envrc': 'export ANTHROPIC_API_KEY=private-test-value\n',
  });
  assert.equal(run.status, 0, run.output);
  assert.ok(!run.output.includes('.envrc'));
  assert.ok(!run.output.includes('private-test-value'));
});

test('the exemption covers only the vendor-name scan', () => {
  const run = runGate({ 'AGENTS.md': 'Run it on sonnet-4 by default.\n' });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /hardcoded model id found/);
});

test('a path containing "lock" is still checked', () => {
  const run = runGate({ 'recipes/deadlock-detector/README.md': `Built on ${VENDOR}.\n` });
  assert.equal(run.status, 1, run.output);
});

test('the pnpm lockfile is not checked', () => {
  const run = runGate({ 'pnpm-lock.yaml': `note: ${VENDOR}\n` });
  assert.equal(run.status, 0, run.output);
});

for (const [label, content, diagnostic] of [
  ['vendor', 'ANTHROPIC_API_KEY=private-test-value', 'vendor name found'],
  ['tool alias', 'agent_toolset_20260401 token=private-test-value', 'dated toolset alias found'],
  ['skill type', "{ type: 'anthropic', token: 'private-test-value' }", 'non-composing skill reference form found'],
  ['model', 'model=sonnet-4 token=private-test-value', 'hardcoded model id found'],
] as const) {
  test(`${label} violations report paths without exposing source contents`, () => {
    const run = runGate({ 'credentials.txt': `${content}\n` });
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes(diagnostic));
    assert.match(run.output, /^    credentials\.txt$/m);
    assert.ok(!run.output.includes('private-test-value'));
  });
}
