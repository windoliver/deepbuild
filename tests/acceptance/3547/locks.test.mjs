// #3547, criteria 2 and 3: a shard four days old stays, with its lock, while its lock names a live process, and leaves
// with its lock folder when that process is gone. Written blind from the issue at base 2edb19ff4 (README). Each lock is
// the script's own: the run that made the shards took it, and it either lives through the test or is killed by its PID.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AN_HOUR, FOUR_DAYS, STEP_MS, TEST, claimOnce, filesOf, leftOf, listing, lockDir, make, missingIn, original, sandbox, shardsIn, within } from './helpers.mjs';

test('#3547.da876765 a shard last made a tree four days before whose lock names a live process stays, and so does its lock, while the run removes the shard as old beside it that no process holds', TEST, async (t) => {
  const box = sandbox(t);
  // Shards 3 and 4 are four days old. The run that made them still holds shard 3, and lives until the test ends.
  const holder = await make(box, [AN_HOUR, AN_HOUR, FOUR_DAYS, FOUR_DAYS], { keep: [3] });
  const lock = filesOf(lockDir(box, 3));

  const run = await claimOnce(box, 1);
  const said = `afterwards ~/deepbuild-shards holds ${listing(box).join(', ')}\n${run.shown()}`;
  assert.deepEqual(run.given, [1], `a run that claims one was given ${run.given.join(', ') || 'no shard'}, not shard 1\n${run.shown()}`);
  assert.equal(holder.child.exitCode ?? holder.child.signalCode, null, `the process that holds shard 3 ended during the run, so its lock no longer names a live process\n${holder.shown()}`);
  assert.ok(shardsIn(box).includes(3), `shard 3, last made a tree four days before, was removed though its lock names a live process (pid ${holder.pid}); ${said}`);
  assert.ok(original(box, 3) && !missingIn(box, 3).length, `shard 3, whose lock names a live process (pid ${holder.pid}), did not stay as it was: ${original(box, 3) ? `it lacks ${missingIn(box, 3).join(', ')}` : 'its folder was removed and made again'}; ${said}`);
  assert.deepEqual(filesOf(lockDir(box, 3)), lock, `shard 3 stayed, but its lock did not stay as its live holder (pid ${holder.pid}) left it: ~/deepbuild-shards/3.lock ${filesOf(lockDir(box, 3)) ? `holds ${JSON.stringify(filesOf(lockDir(box, 3)))}, not ${JSON.stringify(lock)}` : 'is gone'}; ${said}`);
  // The same run removes what it should: without that, nothing shows that shard 3 stayed for its lock.
  assert.ok(!shardsIn(box).includes(4), `the run removed nothing: shard 4, last made a tree four days before and held by no process, is still there, so nothing shows that shard 3 stayed for its lock and not for the run removing no shard at all; ${said}`);
  assert.deepEqual(shardsIn(box), [1, 2, 3], `afterwards ~/deepbuild-shards holds shards ${shardsIn(box).join(', ')}, not 1, 2 and 3; ${said}`);

  await holder.release();
  await holder.end();
});

test('#3547.0ebc9715 a shard last made a tree four days before whose lock names a process that is gone is removed with its lock folder, and the shard an hour old beside it, its lock as dead, stays', TEST, async (t) => {
  const box = sandbox(t);
  // The run that made the shards holds shards 2 and 3 and is killed by its PID, so both locks name a process that is gone.
  const holder = await make(box, [AN_HOUR, AN_HOUR, FOUR_DAYS], { keep: [2, 3] });
  process.kill(holder.pid, 'SIGKILL');
  const end = await within(holder.exited, STEP_MS, 'the killed holder: its end');
  assert.equal(end.signal, 'SIGKILL', `the fixture's holder did not end by the test's SIGKILL: ${JSON.stringify(end)}`);
  assert.deepEqual(listing(box), ['1', '2', '2.lock', '3', '3.lock'], `the fixture's locks did not outlive their holder: ~/deepbuild-shards holds ${listing(box).join(', ')}`);

  const run = await claimOnce(box, 1);
  const said = `afterwards ~/deepbuild-shards holds ${listing(box).join(', ')}\n${run.shown()}`;
  assert.deepEqual(run.given, [1], `a run that claims one was given ${run.given.join(', ') || 'no shard'}, not shard 1\n${run.shown()}`);
  assert.ok(!shardsIn(box).includes(3), `shard 3, last made a tree four days before, is still there though its lock names a process that is gone (pid ${holder.pid}, killed); ${said}`);
  assert.deepEqual(leftOf(box, 3), [], `shard 3 was removed and its lock folder was left: ~/deepbuild-shards still holds ${leftOf(box, 3).map((name) => `~/deepbuild-shards/${name}`).join(', ')}; ${said}`);
  assert.ok(shardsIn(box).includes(2) && original(box, 2) && !missingIn(box, 2).length, `shard 2, last made a tree an hour before, did not stay as it was, though only its lock's holder is gone: ${!shardsIn(box).includes(2) ? 'it was removed' : original(box, 2) ? `it lacks ${missingIn(box, 2).join(', ')}` : 'its folder was removed and made again'}; ${said}`);
  assert.deepEqual(shardsIn(box), [1, 2], `afterwards ~/deepbuild-shards holds shards ${shardsIn(box).join(', ')}, not 1 and 2; ${said}`);
});
