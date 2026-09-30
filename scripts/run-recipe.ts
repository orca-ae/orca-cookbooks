// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Recipe runner: `pnpm recipe <name>`.
 *
 * Loads `.env`, checks the SDK is actually installed, then imports the
 * recipe's `main.ts` and calls its default export.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const RECIPES = join(ROOT, 'recipes');

/**
 * Minimal `.env` reader.
 *
 * Deliberately not a dependency: the format we use is `KEY=value` with `#`
 * comments, and an existing environment variable always wins so CI can set
 * values without a file.
 */
function loadDotEnv(): void {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key === '' || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function listRecipes(): string[] {
  if (!existsSync(RECIPES)) return [];
  return readdirSync(RECIPES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(RECIPES, entry.name, 'main.ts')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * A fresh clone that skipped `pnpm install` would otherwise fail inside the
 * recipe with a bare module-resolution error, so say what is missing.
 */
async function requireSDK(): Promise<void> {
  try {
    await import('@runorca/orca-sdk');
  } catch {
    console.error('@runorca/orca-sdk is not installed. Run `pnpm install` first.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const available = listRecipes();

  if (name === undefined || name === '--list') {
    console.log(available.length === 0 ? 'No recipes yet.' : `Recipes:\n  ${available.join('\n  ')}`);
    process.exit(name === undefined ? 1 : 0);
  }

  const entry = join(RECIPES, name, 'main.ts');
  if (!existsSync(entry)) {
    console.error(`Unknown recipe "${name}".\n\nAvailable:\n  ${available.join('\n  ')}`);
    process.exit(1);
  }

  loadDotEnv();
  await requireSDK();

  const module: unknown = await import(pathToFileURL(entry).href);
  const run = (module as { default?: unknown }).default;
  if (typeof run !== 'function') {
    console.error(`recipes/${name}/main.ts must default-export a function.`);
    process.exit(1);
  }

  await (run as () => Promise<void>)();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `\n${error.message}` : error);
  process.exitCode = 1;
});
