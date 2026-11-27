import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const git = (...args) => execFileSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const NAMES = ['alone', 'timed', 'slow'];

function exported(cwd) {
  const code = `const lanes = await import(${JSON.stringify(join(cwd, 'scripts/lanes.mjs'))}); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(NAMES)}.map((name) => [name, lanes[name] ?? null]))));`;
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let lists = null;
  try { lists = JSON.parse(read.stdout.trim().split('\n').at(-1)); } catch {}
  return { lists, all: `exit ${read.status}\n${read.stdout.slice(-2000)}\n${read.stderr.slice(-4000)}` };
}

function lacking(a, b) {
  const count = (list) => list.reduce((map, entry) => map.set(entry, (map.get(entry) ?? 0) + 1), new Map());
  const left = count(a), right = count(b);
  return [...left].filter(([entry, n]) => n > (right.get(entry) ?? 0)).map(([entry, n]) => (n - (right.get(entry) ?? 0) > 1 ? `${entry} (x${n - (right.get(entry) ?? 0)})` : entry));
}

test("#3419.10f9c195 on a tree with no lane file changed, the alone, timed and slow lists lanes.mjs exports are equal before and after, entry for entry", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3419-lists-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const folders = [...new Set(git('ls-tree', '-r', '-z', '--name-only', base, '--', 'tests/acceptance').split('\0').filter((path) => path.endsWith('/lane.json')).map((path) => path.slice(0, -'lane.json'.length)))];
  const tree = (side, scripts) => {
    const cwd = join(dir, side);
    mkdirSync(cwd);
    const archive = execFileSync('git', ['archive', base, '--', ...(scripts ? [] : ['scripts']), ...folders], { cwd: CHECKOUT, maxBuffer: 1024 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', cwd], { input: archive, maxBuffer: 1024 * 1024 * 1024 });
    if (scripts) cpSync(scripts, join(cwd, 'scripts'), { recursive: true });
    symlinkSync(join(CHECKOUT, 'node_modules'), join(cwd, 'node_modules'));
    return cwd;
  };
  const before = exported(tree('before', null)), after = exported(tree('after', join(CHECKOUT, 'scripts')));
  assert.ok(before.lists && NAMES.every((name) => Array.isArray(before.lists[name])), `the merge base's lanes.mjs could not be read\n${before.all}`);
  assert.ok(after.lists && NAMES.every((name) => Array.isArray(after.lists[name])), `this checkout's lanes.mjs could not be read, or exports no ${NAMES.join(', ')} lists\n${after.all}`);
  assert.ok(folders.length > 0 && before.lists.alone.length > 500 && before.lists.timed.length > 100 && before.lists.slow.length > 50, `the merge base's lists are too short (${NAMES.map((name) => `${name} ${before.lists[name].length}`).join(', ')}; ${folders.length} lane files) for the comparison to prove anything`);
  const differ = NAMES.flatMap((name) => [
    ...lacking(before.lists[name], after.lists[name]).map((entry) => `${name}: ${entry} is in the merge base's list, not in this checkout's`),
    ...lacking(after.lists[name], before.lists[name]).map((entry) => `${name}: ${entry} is in this checkout's list, not in the merge base's`),
  ]);
  assert.deepEqual(differ, [], `on the merge base's tree, the lists lanes.mjs exports differ before and after the change`);
});
