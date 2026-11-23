// #3066 AC4: the failures on main before and after are the same IDs. Two things a test can hold of that, both between
// this checkout and its merge base with origin/main (README): the list of main's failures (scripts/known-failures.json)
// names the same IDs, and every test file the merge base holds still runs where it ran, an alone file moved to the
// parallel block being the one move there is. Both pass on the base, where before and after are one tree; each is
// proven by a planted wrong program (README: Twins).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, LONG, gitHere, lanesOf } from './helpers.mjs';

const mergeBase = () => gitHere('merge-base', 'HEAD', 'origin/main').trim();

test("#3066.4268aebb scripts/known-failures.json names the same failures as on the merge base: the same test IDs, lint findings, timing IDs and skips", () => {
  const ids = (text) => {
    const { failures = {}, lint = {}, timing = [], skips = [] } = JSON.parse(text);
    return { failures: Object.keys(failures).sort(), lint: Object.entries(lint).map(([key, count]) => `${key} (${count})`).sort(), timing: [...timing].sort(), skips: skips.map(({ id }) => id).sort() };
  };
  const before = ids(gitHere('show', `${mergeBase()}:scripts/known-failures.json`));
  const after = ids(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  assert.ok(before.failures.length + before.lint.length > 0, "the merge base's scripts/known-failures.json names no failure, so the comparison is empty");
  assert.deepEqual(after, before, "scripts/known-failures.json does not name the failures the merge base's names");
});

test("#3066.4268aebb every test file of the merge base still runs where it ran: timed, slow, by hand or in a lane of its own as before, or in affected.mjs's parallel or alone block as before", LONG, (t) => {
  const base = mergeBase();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3066-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Before: the merge base's scripts/, with the lane.json files it reads beside them, as `git archive` holds them.
  const tracked = gitHere('ls-tree', '-r', '--name-only', base).split('\n');
  const before = join(dir, 'before');
  mkdirSync(before);
  const tar = join(dir, 'before.tar');
  gitHere('archive', '-o', tar, base, 'scripts', ...tracked.filter((path) => /^tests\/acceptance\/\d+\/lane\.json$/.test(path)));
  const unpacked = spawnSync('tar', ['-xf', tar, '-C', before], { encoding: 'utf8' });
  assert.equal(unpacked.status, 0, `the merge base's scripts/ could not be unpacked: ${unpacked.stderr}`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(before, 'node_modules'));
  // The merge base's test files that this checkout still holds, read by each side's own scripts in this checkout.
  const files = tracked.filter((path) => /\.test\.(?:mjs|js|ts)$/.test(path) && existsSync(join(CHECKOUT, path)));
  const was = lanesOf(CHECKOUT, { files, scripts: join(before, 'scripts'), dir }).blocks;
  const is = lanesOf(CHECKOUT, { files, dir }).blocks;

  const counted = Object.values(was);
  assert.ok(counted.length > 1000 && counted.some((block) => block?.startsWith('alone/')) && counted.some((block) => block?.startsWith('parallel/')), `the merge base's lanes place too few files to compare: ${counted.length}`);
  // An entry leaving alone is not a test leaving a lane: its files run on, in the parallel block, by the same runner.
  const runs = (block) => block?.replace(/^(?:alone|parallel)\//, 'run/') ?? null;
  const moved = Object.keys(was).filter((file) => runs(was[file]) !== runs(is[file])).map((file) => `${file}: ${was[file]} -> ${is[file]}`);
  assert.deepEqual(moved, [], `${moved.length} test files of the merge base no longer run where they ran`);
});
