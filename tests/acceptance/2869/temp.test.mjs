// #2869, criterion 2: a failed write leaves no temp file of its own behind. While the disk is full for a waiting
// request, the table folder is looked at four times, 400 ms apart: a file of the waiter's own (its pid in the name,
// or the lock naming it) present at every look is one it left behind. A write that is tried again may make and remove
// its file in between; that is never seen at four looks in a row. The full disk creates the file and lands part of the
// data before the write fails, as a real one does, so there is a file to leave (README: The full disk).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, finish, free, fullFor, holdAll, own, pause, queued, running, sandbox, started, throttle } from './helpers.mjs';

const ID = '#2869.48e3b6ea';

for (const scope of ['all', 'table']) {
  const what = scope === 'all' ? 'every write into the table folder fails, the lock file\'s first' : 'only the table\'s own write fails, its temp file';
  test(`${ID} a waiting request whose writes fail with ENOSPC (${what}) leaves no temp file of its own in the table folder, while it waits and once it ends`, { timeout: 180_000 }, async (t) => {
    const box = sandbox(t);
    const holders = await holdAll(box);
    const waiter = throttle(box, ['test', '--wait', '1'], 'waiter', [], { disk: { scope } });
    await queued(box, waiter, ...holders);
    const all = () => dump(box, waiter, ...holders);
    await fullFor(box, [waiter]);
    const looks = [];
    for (let k = 0; k < 4; k++) {
      if (k) await pause(400);
      looks.push(own(box, waiter));
    }
    const left = looks[0].filter((name) => looks.every((look) => look.includes(name)));
    assert.deepEqual(left, [], `the waiter's failed writes left ${left.join(', ')} in the table folder (at each of 4 looks, 400 ms apart, the disk full)\n${all()}`);
    assert.ok(running(waiter), `the waiter ended while the disk was full, its wait not run out\n${all()}`);
    free(box);
    finish(box, 'holder-1');
    await started(box, waiter, 60_000, ...holders);
    finish(box, 'waiter');
    assert.equal((await waiter.done).status, 0, all());
    assert.deepEqual(own(box, waiter), [], `once the waiter ended, the table folder still holds files of its own\n${all()}`);
  });
}
