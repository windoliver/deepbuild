// #2359: compare every decoded archive value with the map exported from the pinned original archive.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the migrated MiTeX archive preserves every pinned upstream command value', () => {
  const proof = spawnSync('cargo', ['run', '--locked', '--offline', '--manifest-path', join(root, 'tests/mitex-archive/Cargo.toml')], {
    cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(proof.status, 0, `MiTeX archive comparison failed: ${proof.error?.message ?? proof.stderr}`);
  assert.match(proof.stdout, /[1-9]\d+ command values equal/);
});
