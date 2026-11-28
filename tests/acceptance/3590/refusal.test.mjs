import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { claim, claimOf, fixture, holdEveryPair, PAIRS, show, showLog, tableLog, tableNow, within } from './helpers.mjs';

test('#3590.da82cdc0 a copy of the repository is refused at once with every pair held: claimPair returns { refused } and the log holds no bay-pair request of its process', { timeout: 420_000 }, async (t) => {
  const { box, repo } = fixture(t);
  const copy = join(repo.main, '.claude', 'worktrees', 'copy');
  cpSync(repo.worktree, copy, { recursive: true });
  const holders = await holdEveryPair(box);
  assert.ok(holders.every(Boolean), `not every one of the ${PAIRS} bay pairs was held within 3 min\n${showLog(box)}`);
  const run = claim(box, join(copy, 'scripts', 'bays.mjs'), copy);
  const result = await within(run.done, 3);
  assert.ok(result, `the copy's claim had not returned after 3 min with every pair held: it waits for a pair\n${run.output()}\n${showLog(box)}`);
  const seen = claimOf(result);
  assert.ok(seen, `the claim printed no CLAIM line\n${show(result)}`);
  assert.equal(typeof seen.refused, 'string', `claimPair did not return { refused } for a copy of the worktree: ${JSON.stringify(seen)}\n${show(result)}`);
  assert.equal(seen.pair, false, 'a copy of the worktree got a pair');
  const asked = tableLog(box).filter((entry) => entry.class === 'bay-pair' && entry.pid === seen.pid);
  assert.deepEqual(asked, [], `the log holds bay-pair entries of the refused claim's process (pid ${seen.pid})\n${showLog(box)}`);
  assert.ok(!tableNow(box).requests.some((request) => request.pid === seen.pid), `the table holds a request of the refused claim's process (pid ${seen.pid})`);
});
