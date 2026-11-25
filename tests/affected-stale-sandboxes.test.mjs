// #2857: a stopped run skips its tests' clean-up, so their sandboxes stay in the shared temporary folder: 605's repo
// copies (24 left, 9.5 GB) and 305's deep-show copies. Each run removes those a day old before it starts anything, and
// leaves what other tests keep there on purpose, such as 1455's base trees. The real scripts/affected.mjs runs in
// #2574's scratch tree, with a sandboxed HOME and TMPDIR.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, LONG, NODE, sandbox, start, tree } from './acceptance/2574/helpers.mjs';

test('a run removes 605\'s and 305\'s sandboxes a day old from the temporary folder, and keeps newer ones and everything else', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box);
  const made = (name, hoursAgo) => {
    const dir = join(fixture.tmp, name);
    mkdirSync(join(dir, 'repo'), { recursive: true });
    writeFileSync(join(dir, 'repo', 'file'), 'x');
    const then = new Date(Date.now() - hoursAgo * 3_600_000);
    utimesSync(join(dir, 'repo', 'file'), then, then);
    utimesSync(join(dir, 'repo'), then, then);
    utimesSync(dir, then, then);
    return dir;
  };
  const stale = [made('deep-605-oldA1', 30), made('deep-305-bins-oldB2', 25), made('deep-305-oldC3', 48)];
  const kept = [made('deep-605-newD4', 1), made('deep-305-bins-newE5', 23), made('da1455-base-0123456789ab', 72), made('deep-6050-oldF6', 72), made('deep-1162-proof', 72)];
  const run = await start(box, fixture, [NODE]).done;
  const all = `${dump(run)}`;
  assert.equal(run.status, 0, `the run passed\n${all}`);
  for (const dir of stale) assert.equal(existsSync(dir), false, `${dir}, a day old, is still there after the run\n${all}`);
  for (const dir of kept) assert.equal(existsSync(join(dir, 'repo', 'file')), true, `${dir} was removed, though it is newer than a day or not 605's or 305's\n${all}`);
});
