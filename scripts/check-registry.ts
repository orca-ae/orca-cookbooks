// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Registry gate.
 *
 * Checks registry.yaml and authors.yaml: every entry has a title, path, date,
 * known categories and defined authors; every registered path exists and
 * carries a README; nothing is registered twice; every recipe directory is
 * registered; and authors.yaml stays sorted. The JSON schemas under .github/
 * give editors completion for the same files; this script is what enforces
 * the rules.
 *
 * Deliberately no live network calls, such as looking up author handles, so
 * the check cannot fail on a fork or in an offline CI run for reasons
 * unrelated to the change under test.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');

const CATEGORIES = new Set([
  'Getting Started',
  'Tools and Permissions',
  'Files and Resources',
  'Memory',
  'Multiagent',
  'Skills',
  'MCP',
  'Operations',
  'Applications',
]);

interface Entry {
  title?: unknown;
  path?: unknown;
  categories?: unknown;
  authors?: unknown;
  date?: unknown;
  description?: unknown;
}

const problems: string[] = [];
const note = (message: string): void => {
  problems.push(message);
};

function readYaml(file: string): unknown {
  const full = join(ROOT, file);
  if (!existsSync(full)) {
    note(`${file} is missing`);
    return undefined;
  }
  try {
    return parse(readFileSync(full, 'utf8'));
  } catch (error) {
    note(`${file} is not valid YAML: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

function checkAuthors(raw: unknown): Set<string> {
  const handles = new Set<string>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    note('authors.yaml must be a mapping of handle -> author');
    return handles;
  }

  const keys = Object.keys(raw);
  for (const key of keys) {
    handles.add(key);
    const author = (raw as Record<string, unknown>)[key];
    const name = (author as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string' || name.trim() === '') {
      note(`authors.yaml: "${key}" has no name`);
    }
  }

  const sorted = [...keys].sort();
  if (keys.join('\n') !== sorted.join('\n')) {
    note(`authors.yaml is not alphabetically sorted. Expected order: ${sorted.join(', ')}`);
  }
  return handles;
}

function checkRegistry(raw: unknown, authors: Set<string>): void {
  if (!Array.isArray(raw)) {
    note('registry.yaml must be an array of entries');
    return;
  }

  const seenPaths = new Set<string>();

  raw.forEach((value, index) => {
    const entry = value as Entry;
    const where = typeof entry.title === 'string' ? `"${entry.title}"` : `entry ${index}`;

    for (const field of ['title', 'path', 'date'] as const) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        note(`${where}: ${field} is required`);
      }
    }

    if (typeof entry.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      note(`${where}: date must be YYYY-MM-DD, got "${entry.date}"`);
    }

    if (typeof entry.path === 'string') {
      if (seenPaths.has(entry.path)) note(`${where}: path "${entry.path}" is registered twice`);
      seenPaths.add(entry.path);

      const dir = join(ROOT, entry.path);
      if (!existsSync(dir)) {
        note(`${where}: path "${entry.path}" does not exist`);
      } else if (!existsSync(join(dir, 'README.md'))) {
        note(`${where}: "${entry.path}" has no README.md`);
      }
    }

    if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
      note(`${where}: at least one category is required`);
    } else {
      for (const category of entry.categories) {
        if (typeof category !== 'string' || !CATEGORIES.has(category)) {
          note(`${where}: unknown category "${String(category)}"`);
        }
      }
    }

    if (!Array.isArray(entry.authors) || entry.authors.length === 0) {
      note(`${where}: at least one author is required`);
    } else {
      for (const handle of entry.authors) {
        if (typeof handle !== 'string' || !authors.has(handle)) {
          note(`${where}: author "${String(handle)}" is not defined in authors.yaml`);
        }
      }
    }
  });

  // A recipe that exists but is unregistered is invisible in the index, which
  // is the failure mode nobody notices until someone asks where it went.
  const recipesDir = join(ROOT, 'recipes');
  if (existsSync(recipesDir)) {
    for (const dir of readdirSync(recipesDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const path = `recipes/${dir.name}`;
      if (!seenPaths.has(path)) note(`${path} exists but is not in registry.yaml`);
    }
  }
}

const authors = checkAuthors(readYaml('authors.yaml'));
checkRegistry(readYaml('registry.yaml'), authors);

if (problems.length > 0) {
  console.error('check-registry: problems found\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('check-registry: ok');
