// pi generates its tool list before the alphabetical workspace build reaches record. Importing wire's IDs must
// therefore work on a fresh checkout, not only after record/dist happened to be built in a previous run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the default IDs entry works before the database package is built', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-ids-cold-'));
  try {
    const pkg = join(dir, 'node_modules/@deepbuild/record');
    mkdirSync(pkg, { recursive: true });
    cpSync(new URL('../packages/record/package.json', import.meta.url), join(pkg, 'package.json'));
    cpSync(new URL('../packages/record/src/', import.meta.url), join(pkg, 'src'), { recursive: true });
    // Deliberately no dist, database driver, schemas or other workspace packages.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { ulid, ulidTime } = await import('@deepbuild/record/ids');
      const id = ulid(1, '00000000000000000001');
      assert.equal(id, '00000000010000000000000001');
      assert.equal(ulidTime(id), 1);
    `], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
