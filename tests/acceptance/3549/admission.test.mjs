// #3549 criterion 3 (#3549.349bc6a3): a build past the ceiling, and one the memory rule leaves no room for on a
// test's own readings, waits in order and starts when a build ends. A planted throttle that admits it at once fails,
// naming the request. Each build is `throttle.mjs build --wait <min> -- node stub.mjs <name> <mode>`. The pool has
// more tokens than the builds held, so no build waits for a turn here: what waits, waits for its admission.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILD_MEMORY, CEILING, build, dump, endOf, entryOf, finish, inLine, refused, running, sandbox, startOf, until } from './helpers.mjs';

/**
 * With `count` builds held, which is all the table admits (`room` says why each of them is admitted, and `past` what
 * one more is): a request with no wait is refused at once; two more stand in line in the order they asked; and each
 * starts when a build ends, the one that asked first first.
 */
async function line(box, count, { room, past }) {
  const held = (k) => `held-${k + 1}`;
  const holders = Array.from({ length: count }, (_, k) => build(box, held(k), ['hold'], '0.1'));
  const asked = [];
  const all = () => dump(box, holders, asked);
  // Each of them is admitted: one that isn't ends INCONCLUSIVE once its 0.1 min is over.
  await until(() => holders.every((_, k) => startOf(box, held(k))) || holders.some((child) => !running(child)), 120_000);
  const left = holders.filter((_, k) => !startOf(box, held(k)));
  const out = left.find((child) => !running(child)) ?? left[0];
  if (out) assert.fail(`only ${holders.filter((_, k) => startOf(box, held(k))).length} of ${count} builds were admitted, though ${room}: ${out.named} ${running(out) ? 'still waits' : `ended with ${out.status}: ${out.output().trim().split('\n')[0]}`}\n${all()}`);

  // One more, with no wait: refused at once, its command never started.
  const none = build(box, 'no-wait', ['exit'], '0');
  asked.push(none);
  await until(() => startOf(box, 'no-wait') || !running(none), 120_000);
  assert.equal(startOf(box, 'no-wait'), undefined, `the build request ${none.named}, ${past}, started: it was admitted at once\n${all()}`);
  assert.ok(refused(none), `the build request ${none.named}, ${past}, asked with a wait of 0, didn't end with exit 3 and INCONCLUSIVE no grant (exit ${none.status})\n${all()}`);
  assert.equal(entryOf(box, none, 'timeout')?.class, 'build', `the log shows no build request that timed out for ${none.named}\n${all()}`);

  // Two more that wait, one after the other. Each stands in line before the next step, by the throttle's own count of
  // the requests in line (`throttle.mjs load`, section 6).
  const names = ['asked-first', 'asked-second'];
  const waiters = [];
  for (const [k, name] of names.entries()) {
    const child = build(box, name);
    waiters.push(child);
    asked.push(child);
    const seen = await inLine(box, (waiting) => waiting.build >= k + 1, { stopped: () => Boolean(startOf(box, name)) || !running(child) });
    assert.equal(startOf(box, name), undefined, `the build request ${child.named}, ${past}, started: it was admitted at once\n${all()}`);
    assert.ok(seen.at, `the build request ${child.named}, ${past}, never stood in line: ${running(child) ? `no sample of throttle.mjs load counted ${k + 1} waiting in the build class` : `it ended with ${child.status}`}\n${all()}`);
  }
  const [first, second] = waiters;

  // A build ends: the request that asked first starts, once it has, and the other still stands in line.
  finish(box, held(0));
  await until(() => names.some((name) => startOf(box, name)) || waiters.some((child) => !running(child)), 120_000);
  assert.ok(startOf(box, names[0]), `the build request that asked first, ${first.named}, didn't start when a build ended${startOf(box, names[1]) ? `: the one that asked second, ${second.named}, did` : ''}\n${all()}`);
  assert.ok(startOf(box, names[0]).at >= endOf(box, held(0))?.at, `the build request that asked first, ${first.named}, started before the build \`${held(0)}\` had ended\n${all()}`);
  const still = await inLine(box, (waiting) => waiting.build >= 1, { stopped: () => Boolean(startOf(box, names[1])) || !running(second) });
  assert.equal(startOf(box, names[1]), undefined, `the build request that asked second, ${second.named}, started when one build ended, beside the one that asked first: it was admitted ${past}\n${all()}`);
  assert.ok(still.at, `the build request that asked second, ${second.named}, no longer stood in line once the first had started${running(second) ? '' : `: it ended with ${second.status}`}\n${all()}`);

  // Another build ends: the second starts, once it has.
  finish(box, held(1));
  await until(() => startOf(box, names[1]) || !running(second), 120_000);
  const [taken, freed] = [startOf(box, names[1]), endOf(box, held(1))];
  assert.ok(taken && freed && taken.at >= freed.at, `the build request that asked second, ${second.named}, didn't start when another build ended (its start: ${taken?.at}; the build \`${held(1)}\`'s end: ${freed?.at})\n${all()}`);
  for (const child of waiters) assert.doesNotMatch(child.output(), /INCONCLUSIVE/, `the build request ${child.named} printed an INCONCLUSIVE line within its 10 min wait\n${all()}`);
}

test('#3549.349bc6a3 a build past the ceiling is not admitted: asked with no wait it is refused at once, and two that wait stand in line and start in the order they asked, each when a build ends', { timeout: 10 * 60_000 }, async (t) => {
  // Two tokens more than the ceiling, and memory for every build. The load reads far above the cores: a build's
  // admission doesn't read it.
  const box = sandbox(t, { cores: CEILING + 3, load: 1000 });
  await line(box, CEILING, {
    room: `the ceiling is ${CEILING}, the readings hold memory for every one, and an admission doesn't read their load`,
    past: `past the ceiling of ${CEILING} builds`,
  });
});

test('#3549.349bc6a3 a build the memory rule leaves no room for on the readings of the test is not admitted: asked with no wait it is refused at once, and two that wait stand in line and start in the order they asked, each when a build ends', { timeout: 10 * 60_000 }, async (t) => {
  // Three builds held, under the ceiling on either machine, on readings of three and a half builds' memory: each held
  // build is still settling, so a fourth has half a build's memory left, and with two held one more has room.
  const HELD = 3;
  const box = sandbox(t, { cores: 9, memory: (HELD + 0.5) * BUILD_MEMORY });
  await line(box, HELD, {
    room: `the ceiling is ${CEILING} and the readings hold ${HELD + 0.5} builds' memory`,
    past: `for which the memory rule leaves no room (${HELD} builds held and still settling, on readings of ${HELD + 0.5} builds' memory)`,
  });
});
