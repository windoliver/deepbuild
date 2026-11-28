import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = 'crates/deep-app';
const lint = (root) => spawnSync(process.execPath, [join(CHECKOUT, 'scripts/app-copy-lint.mjs'), '--root', root], { encoding: 'utf8' });
const rootWith = (t, ...parts) => {
  const root = mkdtempSync(join(tmpdir(), 'app-copy-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, APP), { recursive: true });
  for (const part of parts) cpSync(join(CHECKOUT, APP, part), join(root, APP, part), { recursive: true });
  return root;
};

test("a root holding the app's source alone is linted against this checkout's tables, which it names", (t) => {
  const ran = lint(rootWith(t, 'src'));
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, new RegExp(`^copy tables read from ${join(CHECKOUT, APP, 'copy').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `, 'm'));
  assert.match(ran.stdout, /^PASS copy$/m);
});

test('a checkout that lost its copy tables fails, naming where they should be', (t) => {
  const root = rootWith(t, 'src', 'Cargo.toml');
  const ran = lint(root);
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, new RegExp(`^FAIL copy: no copy tables at ${join(root, APP, 'copy').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.doesNotMatch(ran.stdout, /PASS copy/);
});
