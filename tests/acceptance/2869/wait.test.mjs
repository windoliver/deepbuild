// #2869, criterion 1: a request waiting for a grant whose table write fails with ENOSPC keeps waiting and keeps its
// place, trying again until its --wait runs out; once there is space and a slot it is granted and runs its command;
// it reads INCONCLUSIVE (no grant) only when the wait runs out, as any wait does. Every test slot is held by a stub, so
// the waiters really wait, and the disk fills only for the waiters' throttle.mjs (README: The full disk).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, faults, finish, free, fullFor, holdAll, pause, queued, running, sandbox, started, startOf, throttle, until, within } from './helpers.mjs';

const ID = '#2869.08271434';

for (const scope of ['all', 'table']) {
  const what = scope === 'all' ? 'every write into the table folder fails' : 'only the table\'s own write fails';
  test(`${ID} two requests waiting for a test slot while the disk is full (${what}, ENOSPC) keep waiting and keep their places: once space comes back, each free slot goes to the next in line, first, second, then a third queued after them whose writes never failed`, { timeout: 180_000 }, async (t) => {
    const box = sandbox(t);
    const holders = await holdAll(box);
    const first = throttle(box, ['test', '--wait', '1'], 'first', [], { disk: { scope } });
    await queued(box, first, ...holders);
    const second = throttle(box, ['test', '--wait', '1'], 'second', [], { disk: { scope } });
    await queued(box, second, first, ...holders);
    // Last in line, and its own writes go through: a waiter that lost its place on a failed write falls behind it.
    const third = throttle(box, ['test', '--wait', '1'], 'third');
    await queued(box, third, first, second, ...holders);
    const waiters = [first, second, third];
    const all = () => dump(box, ...waiters, ...holders);
    // The disk fills while they wait: the first two have their table writes fail at least twice, over at least 3 s.
    await fullFor(box, [first, second]);
    assert.ok(running(first), `the first waiter gave up while the disk was full, though its --wait of 1 min hadn't run out\n${all()}`);
    assert.ok(running(second), `the second waiter gave up while the disk was full, though its --wait of 1 min hadn't run out\n${all()}`);
    assert.doesNotMatch(first.output() + second.output(), /BLOCKED|INCONCLUSIVE/, all());
    // Space comes back; the waiters go on waiting, with no slot free.
    free(box);
    await pause(1_000);
    assert.ok(waiters.every(running), `a waiter ended once space came back, with no slot free\n${all()}`);
    const granted = () => waiters.filter((run) => startOf(box, run.label)).map((run) => run.label);
    // Each slot that frees goes to the next in line, and to no one behind it.
    for (const [k, [next, freeing]] of [[first, 'holder-1'], [second, 'first'], [third, 'second']].entries()) {
      finish(box, freeing);
      await until(() => granted().length > k || !running(next), 60_000);
      await pause(1_500);
      assert.deepEqual(granted(), waiters.slice(0, k + 1).map((run) => run.label), `once ${freeing}'s slot freed, the waiters granted were ${granted().join(', ') || 'none'}, not ${next.label} next in line\n${all()}`);
      await started(box, next, 0, ...waiters, ...holders);
    }
    for (const run of waiters) {
      finish(box, run.label);
      assert.equal((await run.done).status, 0, `${run.label}'s run exited other than its command's 0\n${all()}`);
    }
    assert.doesNotMatch(waiters.map((run) => run.output()).join(''), /BLOCKED|INCONCLUSIVE/, all());
  });
}

test(`${ID} a request whose wait runs out while the disk stays full reads INCONCLUSIVE no grant (exit 3), not BLOCKED, and not before its --wait ran out`, { timeout: 180_000 }, async (t) => {
  const box = sandbox(t);
  const holders = await holdAll(box);
  // --wait 0.1 is 6 s.
  const waiter = throttle(box, ['test', '--wait', '0.1'], 'waiter', ['exit'], { disk: { scope: 'all' } });
  await queued(box, waiter, ...holders);
  const all = () => dump(box, waiter, ...holders);
  await fullFor(box, [waiter], { n: 1, ms: 0 });
  const ran = await within(waiter.done, 90_000);
  assert.ok(ran, `the waiter was still running 90 s after its 6 s wait\n${all()}`);
  assert.doesNotMatch(ran.stdout, /BLOCKED/, `a full disk ended the wait BLOCKED\n${all()}`);
  assert.equal(ran.status, 3, `the waiter exited ${ran.status}, not 3 (INCONCLUSIVE)\n${all()}`);
  assert.match(ran.stdout.trimStart().split('\n')[0], /^INCONCLUSIVE no grant/, all());
  assert.ok(ran.ended - waiter.started >= 6_000, `the waiter gave up after ${ran.ended - waiter.started} ms, before its 6 s wait ran out\n${all()}`);
  assert.equal(startOf(box, 'waiter'), undefined, `the waiter ran its command with no slot free\n${all()}`);
  assert.ok(faults(box, waiter.pid).length >= 1, all());
  assert.ok(holders.every(running), `a holder ended\n${all()}`);
});
