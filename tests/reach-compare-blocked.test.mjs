// #3065 regression: compare, like record, reads BLOCKED with exit 3 when it can't learn the workspace, not a stack trace.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('compare with no cargo on PATH says BLOCKED and exits 3', (t) => {
  // A PATH of git alone, so no cargo is found whatever folder git lives in.
  const bin = mkdtempSync(join(tmpdir(), 'reach-blocked-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  symlinkSync(spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  const result = spawnSync(process.execPath, ['scripts/reach.mjs', 'compare', 'docs/technical-design.md'], {
    cwd: root, encoding: 'utf8', env: { HOME: process.env.HOME, PATH: bin },
  });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stdout, /^BLOCKED reach: cargo metadata failed\b/);
  assert.equal(result.stderr, '');
});
