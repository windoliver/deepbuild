// #3547, criterion 1 and the Scope's first line: a run that claims shards also removes each shard that no live process
// holds and that was last made a tree more than three days before, highest number first. Written blind from the issue
// at base 2edb19ff4 (README). The run is one process that calls claimShards as scripts/affected.mjs does (helpers.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { AN_HOUR, FOUR_DAYS, TEST, ageTarget, ballast, claimOnce, entriesOf, listing, make, missingIn, original, sandbox, shardsIn, standing, untilRemoval, worktreeLacks } from './helpers.mjs';

test('#3547.beafe89b six shards, none held, the first five last made a tree four days before and the sixth an hour before: a run that claims two is given shards 1 and 2, and afterwards the folder holds 1, 2 and 6', TEST, async (t) => {
  const box = sandbox(t);
  await make(box, [FOUR_DAYS, FOUR_DAYS, FOUR_DAYS, FOUR_DAYS, FOUR_DAYS, AN_HOUR]);
  // The worktree's own target/ is as old as the five: it is no shard ("Not in this task").
  ageTarget(box, FOUR_DAYS);

  const run = await claimOnce(box, 2);
  assert.equal(run.status, 0, `the run that claims two ended with ${run.signal ?? `exit ${run.status}`}\n${run.shown()}`);
  assert.deepEqual(run.given, [1, 2], `a run that claims two was given ${run.given.length ? `shards ${run.given.join(' and ')}` : 'no shard'}, not shards 1 and 2\n${run.shown()}`);

  const held = shardsIn(box);
  assert.deepEqual(held, [1, 2, 6], `afterwards ~/deepbuild-shards holds ${held.length} shards (${held.join(', ')}), not the 3 it should, shards 1, 2 and 6: of shards 3, 4 and 5, each last made a tree four days before and held by no process, the run removed ${[3, 4, 5].filter((k) => !held.includes(k)).join(', ') || 'none'}\n${run.shown()}`);
  // Nothing named from a shard's number is left beside them: no lock, and no folder a removal moved aside.
  assert.deepEqual(listing(box).filter((name) => /^\d/.test(name)), ['1', '2', '6'], `afterwards ~/deepbuild-shards holds more of its shards than the folders 1, 2 and 6: ${listing(box).join(', ')}\n${run.shown()}`);
  for (const k of [1, 2]) assert.deepEqual(missingIn(box, k), [], `shard ${k}, which the run was given, does not hold the worktree's tree: it lacks ${missingIn(box, k).join(', ')}\n${run.shown()}`);
  assert.ok(original(box, 6) && !missingIn(box, 6).length, `shard 6, last made a tree an hour before, is not the folder it was: ${original(box, 6) ? `it lacks ${missingIn(box, 6).join(', ')}` : 'it was removed and made again'}\n${run.shown()}`);
  assert.deepEqual(worktreeLacks(box), [], `the run changed the worktree, which is no shard: it lacks ${worktreeLacks(box).join(', ')}\n${run.shown()}`);
});

test('#3547.beafe89b the run removes a shard last made a tree more than three days before, and no younger one: a shard 74 hours old is removed, and a shard 70 hours old stays', TEST, async (t) => {
  const box = sandbox(t);
  await make(box, [AN_HOUR, 70 * AN_HOUR, 74 * AN_HOUR]);

  const run = await claimOnce(box, 1);
  const said = `afterwards ~/deepbuild-shards holds ${listing(box).join(', ')}\n${run.shown()}`;
  assert.deepEqual(run.given, [1], `a run that claims one was given ${run.given.join(', ') || 'no shard'}, not shard 1\n${run.shown()}`);
  assert.ok(!shardsIn(box).includes(3), `shard 3, last made a tree 74 hours before and held by no process, is still there: more than three days is more than 72 hours; ${said}`);
  assert.ok(shardsIn(box).includes(2) && original(box, 2) && !missingIn(box, 2).length, `shard 2, last made a tree 70 hours before, did not stay as it was, though that is not more than three days: ${!shardsIn(box).includes(2) ? 'it was removed' : original(box, 2) ? `it lacks ${missingIn(box, 2).join(', ')}` : 'its folder was removed and made again'}; ${said}`);
  assert.deepEqual(listing(box).filter((name) => /^\d/.test(name)), ['1', '2'], `afterwards ~/deepbuild-shards holds more of its shards than the folders 1 and 2: ${listing(box).join(', ')}\n${run.shown()}`);
});

test('#3547.beafe89b the run removes its shards highest number first: with shards 3, 4 and 5 each last made a tree four days before, none of them has lost an entry while a higher one still stands', TEST, async (t) => {
  const box = sandbox(t);
  const old = [3, 4, 5];
  // Each of the three holds 2,000 folders more, so its removal lasts long enough to be stopped part way.
  await make(box, [AN_HOUR, AN_HOUR, FOUR_DAYS, FOUR_DAYS, FOUR_DAYS, AN_HOUR], { fill: (k) => { if (old.includes(k)) ballast(box, k, 2_000); } });
  const before = new Map(old.map((k) => [k, entriesOf(box, k)]));

  const watched = await untilRemoval(box, 2, old);
  // Read lowest first: a remover that works downward and could not be stopped can only have moved on to a lower shard.
  const seen = old.map((k) => [k, standing(box, k, before.get(k))]);
  const run = await watched.finish();
  const said = `when the first entry left shard ${watched.touched}: ${seen.map(([k, state]) => `shard ${k} ${state}`).join(', ')}\n${run.shown()}`;

  assert.deepEqual(run.given, [1, 2], `a run that claims two was given ${run.given.join(' and ') || 'no shard'}, not shards 1 and 2\n${run.shown()}`);
  assert.notEqual(watched.touched, null, `the run removed nothing: no entry left shard 3, 4 or 5 while it ran, and ~/deepbuild-shards still holds ${shardsIn(box).length} shards (${shardsIn(box).join(', ')})\n${run.shown()}`);
  assert.ok(watched.stopped, `the run had ended before the test saw an entry leave shard ${watched.touched}, so it saw nothing of the order: ${said}`);
  for (const [low, state] of seen) {
    for (const [high, above] of seen) {
      if (high > low && state !== 'whole') assert.equal(above, 'gone', `shard ${low} was being removed while shard ${high}, a higher number, was ${above}: the run does not remove highest number first; ${said}`);
    }
  }
  assert.deepEqual(shardsIn(box), [1, 2, 6], `afterwards ~/deepbuild-shards holds ${shardsIn(box).length} shards (${shardsIn(box).join(', ')}), not shards 1, 2 and 6; ${said}`);
});
