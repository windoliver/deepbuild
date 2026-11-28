import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('with no GLOSSARY.md the glossary check fails on that finding alone, without a crash', (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'glossary-lint-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const path of ['scripts/glossary-lint.mjs', 'scripts/doc-links.mjs', 'docs', 'contracts/plain-words.json', 'AGENTS.md']) cpSync(join(root, path), join(copy, path), { recursive: true });
  const run = spawnSync(process.execPath, [join(copy, 'scripts/glossary-lint.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /FAIL glossary: GLOSSARY\.md: there is no glossary at the repo root/);
  assert.doesNotMatch(run.stderr, /Error/);
});
