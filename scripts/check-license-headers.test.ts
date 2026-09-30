// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COPYRIGHT_LINE,
  LICENSE_LINE,
  addHeader,
  commentPrefixFor,
  hasHeader,
  isSkipped,
  shebangPrefixFor,
} from './check-license-headers.js';

test('extension-less scripts are recognized by their shebang', () => {
  assert.equal(shebangPrefixFor('#!/bin/bash\nset -e\n'), '#');
  assert.equal(shebangPrefixFor('#!/usr/bin/env bash\n'), '#');
  assert.equal(shebangPrefixFor('#!/usr/bin/env python3\n'), '#');
  assert.equal(shebangPrefixFor('#!/usr/bin/env node\n'), '//');
  assert.equal(shebangPrefixFor('plain text\n'), null);
  assert.equal(shebangPrefixFor('#!/usr/bin/env ruby\n'), null);
});

test('comment prefix follows the file type', () => {
  assert.equal(commentPrefixFor('lib/stream.ts'), '//');
  assert.equal(commentPrefixFor('recipes/fix-failing-tests/main.ts'), '//');
  assert.equal(commentPrefixFor('scripts/check-naming.sh'), '#');
  assert.equal(commentPrefixFor('registry.yaml'), '#');
  assert.equal(commentPrefixFor('.github/workflows/check.yml'), '#');
});

test('prose, data and exempt paths are not checked', () => {
  assert.equal(commentPrefixFor('README.md'), null);
  assert.equal(commentPrefixFor('package.json'), null);
  assert.equal(commentPrefixFor('.github/registry_schema.json'), null);
  assert.equal(commentPrefixFor('pnpm-lock.yaml'), null);
  assert.equal(commentPrefixFor('.github/ISSUE_TEMPLATE/bug_report.yml'), null);
  assert.equal(commentPrefixFor('recipes/fix-failing-tests/fixtures/calc.py'), null);
  assert.equal(commentPrefixFor('LICENSE'), null);
});

test('fixtures are skipped even when they are scripts', () => {
  // The mock CLI has a shebang and no extension; it is still agent input.
  assert.equal(isSkipped('recipes/issue-to-pr/fixtures/gh'), true);
  assert.equal(isSkipped('recipes/incident-responder/fixtures/skill/SKILL.md'), true);
  assert.equal(isSkipped('scripts/typecheck.sh'), false);
});

test('a header is recognized only near the top', () => {
  assert.equal(hasHeader(`// ${COPYRIGHT_LINE}\n// ${LICENSE_LINE}\n\nexport {};\n`), true);
  assert.equal(hasHeader(`// ${LICENSE_LINE}\nexport {};\n`), false);
  const buried = `${'\n'.repeat(20)}// ${COPYRIGHT_LINE}\n// ${LICENSE_LINE}\n`;
  assert.equal(hasHeader(buried), false);
});

test('the header goes after a shebang and keeps one blank line before the code', () => {
  const fixed = addHeader('#!/usr/bin/env bash\nset -euo pipefail\n', '#');
  assert.equal(
    fixed,
    `#!/usr/bin/env bash\n# ${COPYRIGHT_LINE}\n# ${LICENSE_LINE}\n\nset -euo pipefail\n`,
  );
  assert.equal(hasHeader(fixed), true);
});

test('a yaml-language-server modeline stays on the first line', () => {
  const fixed = addHeader(
    '# yaml-language-server: $schema=./.github/registry_schema.json\n#\n# One entry per recipe.\n',
    '#',
  );
  const lines = fixed.split('\n');
  assert.equal(lines[0], '# yaml-language-server: $schema=./.github/registry_schema.json');
  assert.equal(lines[1], `# ${COPYRIGHT_LINE}`);
  assert.equal(lines[2], `# ${LICENSE_LINE}`);
  assert.equal(hasHeader(fixed), true);
});

test('an existing blank line is not doubled', () => {
  const fixed = addHeader('\nexport {};\n', '//');
  assert.equal(fixed, `// ${COPYRIGHT_LINE}\n// ${LICENSE_LINE}\n\nexport {};\n`);
});

test('the header is two OpenTelemetry-style lines with no year', () => {
  assert.equal(
    addHeader('export {};\n', '//'),
    '// Copyright The Orca Authors\n// SPDX-License-Identifier: Apache-2.0\n\nexport {};\n',
  );
  assert.equal(
    addHeader('key: value\n', '#'),
    '# Copyright The Orca Authors\n# SPDX-License-Identifier: Apache-2.0\n\nkey: value\n',
  );
});
