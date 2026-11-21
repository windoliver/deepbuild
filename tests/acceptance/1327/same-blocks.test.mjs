// #1327 AC4: on the merge base's suites, the lanes run the same tests in the same blocks before and after this change.
// Before: the merge base's scripts/ over the merge base's test files, extracted with git archive. After: this
// checkout's scripts/ in this checkout, over the same files. Each side's own exports say, per file, its block in
// affected.mjs's plan(), its shard group, the lanes.mjs lists naming it and the unit lane's vitest commands running
// it (lanes-view.mjs). The two must match file for file (README).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, lanesView } from './helpers.mjs';

const git = (...args) => execFileSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

test("#1327.f28ef522 on the merge base's suites, the lanes put the same tests in the same blocks before and after the change", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1327-blocks-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const tests = git('ls-tree', '-r', '-z', '--name-only', base).split('\0').filter((path) => /\.test\.(?:mjs|js|ts)$/.test(path));

  const before = join(dir, 'base');
  mkdirSync(before);
  const archive = execFileSync('git', ['archive', base, '--', 'scripts', ':(glob)**/*.test.ts', ':(glob)**/*.test.mjs', ':(glob)**/*.test.js'], { cwd: CHECKOUT, maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', before], { input: archive });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(before, 'node_modules'));

  const was = lanesView({ cwd: before, dir }, tests);
  assert.equal(was.status, 0, `the merge base's lanes could not be read\n${was.all}`);
  const now = lanesView({ cwd: CHECKOUT, dir }, tests.filter((path) => existsSync(join(CHECKOUT, path))));
  assert.equal(now.status, 0, `this checkout's lanes could not be read\n${now.all}`);

  const files = Object.keys(was.view);
  assert.ok(files.length > 1000 && files.some((file) => was.view[file].block?.startsWith('alone/')), `the merge base's suites read as ${files.length} test files with none alone; the comparison would prove nothing`);
  const differ = files.filter((file) => JSON.stringify(now.view[file] ?? null) !== JSON.stringify(was.view[file]));
  const shown = differ.slice(0, 20).map((file) => `${file}\n  before: ${JSON.stringify(was.view[file])}\n  after:  ${JSON.stringify(now.view[file] ?? null)}`);
  assert.deepEqual(shown, [], `${differ.length} of the merge base's ${files.length} test files run differently after the change (first 20 shown)`);
});
