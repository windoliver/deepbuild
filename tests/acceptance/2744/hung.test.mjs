// #2744 AC2: a hung holder doesn't stop the machine. A CLI grant held past `--hold <min>` while another request
// waits is ended: `expired` in the log, its command and every process in its tree stopped, the grant released, an
// `INCONCLUSIVE throttle: the <class> grant <id> was held past its <min> min bound ...` line and exit 3
// (docs/parallel-proof.md, section 6, "A hung holder's bound").
import assert from 'node:assert/strict';
import test from 'node:test';
import { TEST_LIMIT, dump, gone, log, pause, running, sandbox, started, startOf, throttle, until } from './helpers.mjs';

const expiredLine = (id, bound) => new RegExp(`^INCONCLUSIVE throttle: the test grant ${id} was held past its ${bound.replace('.', '\\.')} min bound while another request waited; its command was stopped`, 'm');

test('#2744.e68bc50e a test grant whose command never exits (it ignores SIGTERM, and so does its child) is ended past its --hold bound while a test request waits: INCONCLUSIVE, exit 3, its tree stopped, released, and the waiting request granted', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const hung = throttle(box, ['test', '--wait', '1', '--hold', '0.05'], 'hung', ['term', 'child']);
  const held = await started(box, hung, 'test', 30_000);
  assert.ok(await until(() => startOf(box, 'hung-child'), 10_000), `the hung command's child never started\n${dump(box, hung)}`);
  const grandchild = startOf(box, 'hung-child');
  // The rest of the machine's test slots, held by commands well inside their default bound.
  const others = [];
  for (let k = 1; k < TEST_LIMIT; k++) {
    others.push(throttle(box, ['test', '--wait', '1'], `other-${k}`));
    await started(box, others.at(-1), 'test', 30_000, hung, ...others);
  }
  const waiter = throttle(box, ['test', '--wait', '1'], 'waiter', ['exit']);
  const all = () => dump(box, hung, ...others, waiter);
  // Within the bound (3 s), the SIGTERM it ignores, the 10 s before the SIGKILL, and slack for a loaded machine.
  assert.ok(await until(() => startOf(box, 'waiter'), 45_000), `the waiting test request was never granted while the hung grant held its slot\n${all()}`);
  const granted = startOf(box, 'waiter');
  assert.match(String(granted.throttle), /^test:\S+$/, all());
  assert.ok(granted.t >= held.t + 3_000 - 500, `the waiter ran before the hung grant's 0.05 min bound had passed: it can't have waited for that slot\n${all()}`);
  const run = await Promise.race([hung.done, pause(30_000).then(() => null)]);
  assert.ok(run, `the hung grant's throttle.mjs still runs 30 s after its slot went to the waiter\n${all()}`);
  assert.equal(run.status, 3, `the hung grant's run exited ${run.status}, not 3 (INCONCLUSIVE)\n${all()}`);
  assert.match(run.stdout, expiredLine(held.id, '0.05'), all());
  assert.doesNotMatch(run.stdout, /^PASS/m, all());
  assert.ok(await until(() => gone(held.pid) && gone(grandchild.pid), 5_000), `the hung command (pid ${held.pid}) or its child (pid ${grandchild.pid}) still runs\n${all()}`);
  const entries = log(box);
  const expired = entries.findIndex((e) => e.event === 'expired' && JSON.stringify(e).includes(held.id));
  const released = entries.findIndex((e) => e.event === 'released' && e.id === held.id);
  assert.ok(expired >= 0, `the log has no expired entry for grant ${held.id}\n${all()}`);
  assert.ok(released > expired, `the log has no released entry for grant ${held.id} after its expired entry\n${all()}`);
  assert.equal((await waiter.done).status, 0, all());
  // Only the grant past its bound was ended.
  assert.ok(others.every(running), `a grant inside its bound was ended\n${all()}`);
});

test('#2744.e68bc50e a hung test grant is never ended while no one waits, and is ended past its --hold bound once a timed request waits', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const hung = throttle(box, ['test', '--wait', '1', '--hold', '0.02'], 'hung');
  const held = await started(box, hung, 'test', 30_000);
  // Well past its 1.2 s bound, with nothing waiting.
  await pause(4_000);
  assert.ok(running(hung) && !gone(held.pid), `the grant was ended past its bound though no request waited\n${dump(box, hung)}`);
  assert.equal(log(box).find((e) => e.event === 'expired'), undefined, dump(box, hung));
  // A top-level timed request waits for the hung holder (and, on a loaded machine, for the load too).
  const timed = throttle(box, ['timed', '--wait', '0.4'], 'timed', ['exit']);
  const all = () => dump(box, hung, timed);
  const ended = await Promise.race([hung.done, pause(20_000).then(() => null)]);
  assert.ok(ended, `the hung grant was still held 20 s after a timed request began to wait\n${all()}`);
  assert.equal(ended.status, 3, `the hung grant's run exited ${ended.status}, not 3 (INCONCLUSIVE)\n${all()}`);
  assert.match(ended.stdout, expiredLine(held.id, '0.02'), all());
  assert.ok(await until(() => gone(held.pid), 5_000), `the hung command (pid ${held.pid}) still runs\n${all()}`);
  const entries = log(box);
  assert.ok(entries.some((e) => e.event === 'expired' && JSON.stringify(e).includes(held.id)), `no expired entry for grant ${held.id}\n${all()}`);
  assert.ok(entries.some((e) => e.event === 'released' && e.id === held.id), `no released entry for grant ${held.id}\n${all()}`);
  // The timed request is granted, unless the machine's load (its gate for a top-level request) stops it; then its
  // timeout must not name the released grant as what blocked it.
  const run = await timed.done;
  if (!startOf(box, 'timed')) {
    assert.doesNotMatch(run.stdout, new RegExp(held.id), `the timed request's timeout names the hung grant, which should have been released\n${all()}`);
    const timeout = log(box).find((e) => e.event === 'timeout' && e.class === 'timed');
    assert.ok(timeout, all());
    assert.doesNotMatch(JSON.stringify(timeout.blockers ?? []), new RegExp(held.id), all());
  } else {
    assert.equal(run.status, 0, all());
  }
});
