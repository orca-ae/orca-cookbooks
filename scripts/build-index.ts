// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Regenerate the README recipe table from registry.yaml.
 *
 * The table lives between two markers so the surrounding prose is hand-written
 * and the listing cannot drift from the registry.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const START = '<!-- recipes:start -->';
const END = '<!-- recipes:end -->';

interface Entry {
  title: string;
  path: string;
  description?: string;
  categories: string[];
  archived?: boolean;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const entries = (parse(readFileSync(join(ROOT, 'registry.yaml'), 'utf8')) as Entry[])
  .filter((entry) => entry.archived !== true);

// Group by first category so the table reads as a curriculum rather than an
// alphabetical dump.
const order = [
  'Getting Started',
  'Tools and Permissions',
  'Files and Resources',
  'Memory',
  'Multiagent',
  'Skills',
  'MCP',
  'Operations',
  'Applications',
];

const lines: string[] = [];
for (const category of order) {
  const inCategory = entries.filter((entry) => entry.categories[0] === category);
  if (inCategory.length === 0) continue;

  lines.push(`### ${category}`, '', '| Recipe | What it shows |', '| --- | --- |');
  for (const entry of inCategory.sort((a, b) => a.title.localeCompare(b.title))) {
    lines.push(`| [${entry.title}](${entry.path}) | ${oneLine(entry.description ?? '')} |`);
  }
  lines.push('');
}

const readmePath = join(ROOT, 'README.md');
const readme = readFileSync(readmePath, 'utf8');

const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`README.md must contain ${START} and ${END}`);
  process.exit(1);
}

const updated =
  readme.slice(0, start + START.length) + '\n\n' + lines.join('\n').trimEnd() + '\n\n' + readme.slice(end);

writeFileSync(readmePath, updated);
console.log(`build-index: wrote ${entries.length} recipe(s) to README.md`);
