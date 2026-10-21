// Criterion 3: tests/acceptance/311/catalogue.test.ts passes unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BASE, CHECKOUT, git } from './helpers.mjs';

// The test file and what it reads: its helpers and the two planted bodies.
const FILES = ['catalogue.test.ts', 'helpers.ts', 'fixtures/issue-learn-paused.md', 'fixtures/issue-clean.md']
  .map((f) => `tests/acceptance/311/${f}`);

test('criterion 3: tests/acceptance/311/catalogue.test.ts, its helpers and fixtures equal the base\'s, and it passes', () => {
  for (const file of FILES) {
    assert.equal(readFileSync(join(CHECKOUT, file), 'utf8'), git(['show', `${BASE}:${file}`]), `${file} changed from ${BASE}`);
  }
  const r = spawnSync(process.execPath, [join(CHECKOUT, 'node_modules/vitest/vitest.mjs'), 'run', '--root', 'tests/acceptance/311', 'catalogue.test.ts'], {
    cwd: CHECKOUT, encoding: 'utf8', timeout: 300_000, env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  const output = `${r.stdout}${r.stderr}`;
  // An implementation that catalogues learn.paused (the issue's option 3a) fails #311's planted
  // learn.paused body and AC7's refusal here.
  assert.equal(r.status, 0, `vitest failed on #311's catalogue test:\n${output}`);
  assert.match(output, /Test Files\s+1 passed/, `vitest ran #311's catalogue test file:\n${output}`);
});
