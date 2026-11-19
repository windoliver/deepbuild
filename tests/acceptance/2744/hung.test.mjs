// #2744 AC2: a hung holder doesn't stop the machine. A CLI grant held past `--hold <min>` while another request
// waits is ended: `expired` in the log, its command and every process in its tree stopped, the grant released, an
// `INCONCLUSIVE throttle: the <class> grant <id> was held past its <min> min bound ...` line and exit 3
// (docs/parallel-proof.md, section 6, "A hung holder's bound").
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, gone, log, pause, running, sandbox, started, startOf, throttle, until } from './helpers.mjs';

const expiredLine = (id, bound) => new RegExp(`^INCONCLUSIVE throttle: the test grant ${id} was held past its ${bound.replace('.', '\\.')} min bound while another request waited; its command was stopped`, 'm');

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
