// #3549 criterion 6 (#3549.98c012e3): the log's `granted` and `timeout` entries for a top-level request carry
// `waited`, the milliseconds since it asked, within 1 s of the test's own clock. A planted throttle that writes the
// wait limit there fails. Four top-level build requests on a table whose every build slot is held: one refused at
// once, one whose wait runs out, one granted after a wait, and one whose stall bound starts again and then runs out.
//
// This process can't see the moment a request asks: it is after the request's process starts and before a sample of
// `throttle.mjs load` counts it in line. So each wait is known between two readings of this clock, and `waited` must
// lie within 1 s of that span. A wait limit, in minutes or in milliseconds, lies outside every span but a `--wait`
// request's that timed out, whose wait is its limit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CEILING, build, dump, ended, entryOf, finish, inLine, refused, running, sandbox, startOf, stub, throttle, until } from './helpers.mjs';

// The criterion's 1 s.
const WITHIN_MS = 1_000;
// A wait of 0.05 min is 3 s; a stall bound of 0.2 min, 12 s; the request that is granted asks with a wait of 10 min.
const WAIT_MIN = 0.05, STALL_MIN = 0.2;
const WAIT_MS = WAIT_MIN * 60_000, STALL_MS = STALL_MIN * 60_000;

test('#3549.98c012e3 the granted and timeout entries of the log for top-level build requests carry waited, within 1 s of this clock: one refused at once, one whose wait ran out, one granted after a wait, and one whose stall bound ran out after a grant changed hands', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: 9 });
  // Builds asked with no wait, one after another, until one is refused: every build slot is then held, by the base's
  // count or under the ceiling.
  const held = [];
  let none = null;
  const asked = [];
  const all = () => dump(box, held, none, asked);
  for (let k = 1; k <= CEILING + 2 && !none; k++) {
    const child = build(box, `held-${k}`, ['hold'], '0');
    await until(() => startOf(box, `held-${k}`) || !running(child), 120_000);
    if (startOf(box, `held-${k}`)) held.push(child); else none = child;
  }
  assert.ok(held.length && none && refused(none), `no build request with a wait of 0 was refused once the build slots were held (${held.length} builds held${none ? `; ${none.named} ended with ${none.status}` : ''})\n${all()}`);

  /** The log's entry of `event` for `child`'s request, which must carry `waited`, a count of milliseconds. */
  const entry = (child, event) => {
    const found = entryOf(box, child, event);
    assert.equal(found?.class, 'build', `the log has no ${event} entry of class build for the top-level request ${child.named}\n${all()}`);
    assert.ok(Number.isFinite(found.waited) && found.waited >= 0, `the log's ${event} entry for the top-level request ${child.named} carries no waited, the milliseconds since it asked: ${JSON.stringify(found)}\n${all()}`);
    return found;
  };
  /** `waited` within 1 s of the span this clock gives the request's wait, `least` to `most` ms. */
  const within = (child, found, least, most, how) => {
    t.diagnostic(`${found.event} of \`${child.label}\`: waited ${found.waited} ms; by this clock between ${Math.round(least)} and ${Math.round(most)} ms`);
    // deadline: the criterion's 1 s, about the wait as this process's clock bounds it.
    assert.ok(found.waited >= least - WITHIN_MS && found.waited <= most + WITHIN_MS, `the log's ${found.event} entry for the top-level request ${child.named} carries waited ${found.waited} ms, not within ${WITHIN_MS / 1000} s of this clock: the request waited between ${Math.round(least)} and ${Math.round(most)} ms (${how}): ${JSON.stringify(found)}\n${all()}`);
  };
  // The request refused at once: it waited no longer than its process lived.
  const refusal = entry(none, 'timeout');
  within(none, refusal, 0, none.ended - none.asked, 'it asked with a wait of 0, no earlier than its process started, and had ended by its process\'s end');

  // One that waits for a slot, with a wait of 10 min, then one with a stall bound of 0.2 min: each in line, by the
  // throttle's own count, before the next step.
  const slow = build(box, 'granted-after-a-wait');
  asked.push(slow);
  const inSlow = await inLine(box, (waiting) => waiting.build >= 1, { every: 400, stopped: () => Boolean(startOf(box, 'granted-after-a-wait')) || !running(slow) });
  assert.ok(inSlow.at, `the build request ${slow.named} never stood in line, though every build slot is held\n${all()}`);
  const stalled = throttle(box, 'build', ['--stall', String(STALL_MIN)], stub(box, 'stalled', 'exit'));
  asked.push(stalled);
  const inStalled = await inLine(box, (waiting) => waiting.build >= 2, { every: 400, stopped: () => Boolean(startOf(box, 'stalled')) || !running(stalled) || !running(slow) });
  assert.ok(inStalled.at, `the build request ${stalled.named} never stood in line behind ${slow.named}\n${all()}`);
  // One whose wait of 0.05 min runs out: its 3 s pass while the two above stand in line.
  const short = build(box, 'timed-out', ['exit'], String(WAIT_MIN));
  asked.push(short);
  await ended(short, 120_000);
  assert.ok(refused(short) && !startOf(box, 'timed-out'), `the build request ${short.named} didn't wait out its ${WAIT_MIN} min and end with exit 3 and INCONCLUSIVE no grant (exit ${short.status})\n${all()}`);
  within(short, entry(short, 'timeout'), WAIT_MS, short.ended - short.asked, `its wait of ${WAIT_MIN} min ran out, and it asked no earlier than its process started`);

  // A build ends: the first in line is granted its slot, which it holds. It asked before the sample that counted it,
  // and wasn't granted before the build was let end.
  const lifted = Date.now();
  finish(box, 'held-1');
  const grantedSeen = await until(() => (entryOf(box, slow, 'granted') || !running(slow)) && Date.now(), 120_000);
  const grant = entry(slow, 'granted');
  assert.equal(grant.grant, 'top-level', `the log's granted entry for ${slow.named} isn't a top-level grant: ${JSON.stringify(grant)}\n${all()}`);
  within(slow, grant, lifted - inSlow.at, grantedSeen - slow.asked, 'it stood in line from before a sample counted it until after a build was let end, and asked no earlier than its process started');
  assert.ok(await until(() => startOf(box, 'granted-after-a-wait'), 120_000), `the build request ${slow.named} was granted but its command never started\n${all()}`);

  // A grant of the class changed hands, so the stall bound starts again: the last request leaves the line a bound
  // later, having waited from before the sample that counted it.
  await ended(stalled, 120_000);
  assert.ok(refused(stalled) && !startOf(box, 'stalled'), `the build request ${stalled.named} didn't wait out its stall bound and end with exit 3 and INCONCLUSIVE no grant (exit ${stalled.status})\n${all()}`);
  // Had it left the line before the build was let end, it waited its bound alone.
  const again = stalled.ended >= lifted + STALL_MS - 1_500;
  within(stalled, entry(stalled, 'timeout'), again ? lifted - inStalled.at + STALL_MS : STALL_MS, stalled.ended - stalled.asked, again
    ? `it stood in line from before a sample counted it, and its stall bound of ${STALL_MIN} min started again once a build was let end`
    : `its stall bound of ${STALL_MIN} min ran out before a grant changed hands`);
});
