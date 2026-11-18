// #2744 AC3: a stuck drain says why. A timed request whose wait passes leaves the table, its `INCONCLUSIVE no grant`
// line goes on with `; blocked by <class> grant <id> held by pid <pid> since <time> (<command>)`, the log's `timeout`
// entry lists the holder in `blockers`, and the holder is marked, so a later timed request behind it no longer stops
// new top-level grants (docs/parallel-proof.md, section 6, "A stuck drain"). The holder below never finishes and is
// far inside its default bound, so the timed request can't drain whatever the machine's load.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, log, pause, running, sandbox, started, startOf, throttle } from './helpers.mjs';

test('#2744.303fcdcd a timed request that can\'t drain within its --wait gives up: INCONCLUSIVE no grant naming the test grant, its holder\'s pid and command, the log\'s timeout lists it as a blocker, and new grants start again', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const holder = throttle(box, ['test', '--wait', '1'], 'stuck-holder-2744');
  const held = await started(box, holder, 'test', 30_000);
  const timed = throttle(box, ['timed', '--wait', '0.05'], 'timed', ['exit']);
  // Pending behind the timed request's drain, which stops new top-level grants until it gives up.
  await pause(1_000);
  const after = throttle(box, ['test', '--wait', '0.5'], 'after', ['exit']);
  const all = () => dump(box, holder, timed, after);
  const run = await timed.done;
  assert.equal(startOf(box, 'timed'), undefined, `the timed request ran its command though the holder never finished\n${all()}`);
  assert.notEqual(run.status, 0, all());
  const [first] = run.stdout.trimStart().split('\n');
  assert.match(first, /^INCONCLUSIVE no grant/, all());
  const blocked = first.match(/; blocked by (\S+) grant (\S+) held by pid (\d+) since (.+?) \((.+)\)/);
  assert.ok(blocked, `the timed request's INCONCLUSIVE no grant line doesn't say what blocked it\n${all()}`);
  const [, cls, id, pid, , command] = blocked;
  assert.equal(cls, 'test', all());
  assert.equal(id, held.id, `the line names grant ${id}, not the holder's grant ${held.id}\n${all()}`);
  // The holder is the throttle.mjs process the grant is held by; its command's own pid names the same holder.
  assert.ok([holder.pid, held.pid].includes(Number(pid)), `the line names pid ${pid}, not the holder (${holder.pid}) or its command (${held.pid})\n${all()}`);
  assert.match(command, /stuck-holder-2744/, `the line doesn't name the holder's command\n${all()}`);
  const timeout = log(box).find((e) => e.event === 'timeout' && e.class === 'timed');
  assert.ok(timeout, `the log has no timeout entry for the timed request\n${all()}`);
  assert.match(JSON.stringify(timeout.blockers ?? null), new RegExp(held.id), `the log's timeout entry doesn't list grant ${held.id} in blockers\n${all()}`);
  // Its hold on new grants is gone: the test request that waited behind the drain runs.
  const next = await after.done;
  assert.ok(startOf(box, 'after'), `the test request behind the drain never ran after the timed request gave up\n${all()}`);
  assert.equal(next.status, 0, all());
  assert.ok(running(holder), `the holder, inside its bound, was ended\n${all()}`);
});

test('#2744.303fcdcd once a drain gave up on a holder, a later timed request behind the same holder no longer stops new top-level grants', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const holder = throttle(box, ['test', '--wait', '1'], 'stuck-holder-2744');
  await started(box, holder, 'test', 30_000);
  const first = throttle(box, ['timed', '--wait', '0.05'], 'first-timed', ['exit']);
  await first.done;
  // A second timed request, pending for the rest of the test: the holder still never finishes.
  const second = throttle(box, ['timed', '--wait', '0.4'], 'second-timed', ['exit']);
  await pause(1_000);
  const fresh = throttle(box, ['test', '--wait', '0.1'], 'fresh', ['exit']);
  const all = () => dump(box, holder, first, second, fresh);
  const run = await fresh.done;
  assert.ok(startOf(box, 'fresh'), `a new top-level test request waited out its 0.1 min behind a timed request pending on a holder an earlier drain had given up on\n${all()}`);
  assert.equal(run.status, 0, all());
  assert.ok(running(second), `the second timed request should still be pending, behind the holder\n${all()}`);
  assert.equal(startOf(box, 'second-timed'), undefined, `the second timed request ran though the holder never finished\n${all()}`);
});
