// AC4: a stop on an unchanged tree where one check had not ended on the last claim, and one where a check's recorded
// reads changed, each make their checkout and run that check (README).
//
// The gate runner on the bench (bench.ts): one session. In each test the session's tree never changes; the turn before
// the second stop runs `git status` and one shell command, which change no file.
// - Not ended: the first claim's stop is held 3 s; `sum` ends, and the bench holds `price`'s run past the hold and past
//   the second stop, so `price` has not ended on the last claim when the session stops again. The second stop must make
//   a checkout and run `price` there.
// - Recorded reads changed: the claim is a workspace claim (#67) whose check `state` reads the workspace's state file,
//   which the claim pins. The first claim pins a reading with one open item and passes; the second pins one with two,
//   on the same tree. The second stop must make a checkout, run `state` there on the new reading, and it fails.
// The planted runner `looks-at-tree-alone` (twins.json) decides from the tree alone: it fails both, naming the check.
import { afterEach, expect, test } from 'vitest';
import { commandsChangingNothing, openBench, PRICE, reading, shownStarts, shownVerdict, sleep, STATE, STATE_FILE, SUM, verdict, type Bench } from './bench.ts';

const AC4 = 'AC4 #2699.2f2544a1';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

test(`${AC4} not ended: on an unchanged tree, ${PRICE.check} had not ended on the last claim when the session stops again: the stop makes its checkout and runs ${PRICE.check} there`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  const FIRST = 'claim:2699N1';
  const SECOND = 'claim:2699N2';
  const checks = [SUM, PRICE];
  const release = b.holdNext(PRICE.check);
  let released = false;
  try {
    await b.stop({ claim: FIRST, checks, hold_ms: 3_000 });
    // The first claim's sum ends; its price run starts and is held.
    const settled = () => b.starts.some((s) => s.claim === FIRST && s.check === SUM.check && s.outcome !== null) && b.starts.some((s) => s.claim === FIRST && s.check === PRICE.check);
    for (let until = Date.now() + 300_000; Date.now() < until && !settled();) await sleep(100);
    const firstRuns = b.starts.filter((s) => s.claim === FIRST);
    if (!firstRuns.some((s) => s.check === SUM.check && s.outcome === 'passed') || !firstRuns.some((s) => s.check === PRICE.check && s.run !== null && s.outcome === null)) {
      throw Error(`BLOCKED: ${AC4} the first claim must have ${SUM.check} passed and ${PRICE.check}'s run still going: starts: ${shownStarts(b.starts)}`);
    }

    commandsChangingNothing(b.repo);
    await b.count();
    await b.stop({ claim: SECOND, checks });
    release();
    released = true;
    const c = await b.counted();

    const seen = `the second claim's verdict is ${shownVerdict(b.gate.verdictOf(SECOND))}; every start the gate asked for: ${shownStarts(b.starts)}; folders made under the checkouts' folder ${b.root}: ${JSON.stringify(c.checkouts)}`;
    const ran = b.starts.filter((s) => s.claim === SECOND && s.check === PRICE.check);
    expect(ran.map((s) => (s.run !== null && s.cwd.startsWith(`${b.root}/`) ? s.outcome : `not in a checkout: ${s.refused ?? s.cwd}`)), `${AC4} ${PRICE.check} had not ended on the last claim, so ${PRICE.check} must run for the second claim in a checkout under ${b.root}; ${seen}`).toEqual(['passed']);
    expect(c.checkouts, `${AC4} the stop where ${PRICE.check} had not ended makes its checkout under ${b.root}; ${seen}`).toHaveLength(1);
  } finally {
    if (!released) release();
  }
}), 900_000);

test(`${AC4} recorded reads changed: on an unchanged tree, ${STATE.check}'s recorded reads (the workspace's ${STATE_FILE}) changed since the last claim: the stop makes its checkout and runs ${STATE.check} there on the new reading`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  const FIRST = 'claim:2699R1';
  const SECOND = 'claim:2699R2';
  const checks = [SUM, STATE];
  await b.stop({ claim: FIRST, checks, state: reading(1) });
  const first = b.gate.verdictOf(FIRST);
  if (first?.outcome !== 'PASS' || !b.starts.some((s) => s.claim === FIRST && s.check === STATE.check && s.outcome === 'passed' && s.state === '{"open":1}\n')) {
    throw Error(`BLOCKED: ${AC4} the first claim must run ${STATE.check} on the reading with one open item and pass: it is ${shownVerdict(first)}; starts: ${shownStarts(b.starts)}`);
  }

  commandsChangingNothing(b.repo);
  await b.count();
  await b.stop({ claim: SECOND, checks, state: reading(2) });
  const c = await b.counted();

  const v = b.gate.verdictOf(SECOND);
  const seen = `the second claim's verdict is ${shownVerdict(v)}; every start the gate asked for: ${shownStarts(b.starts)}; folders made under the checkouts' folder ${b.root}: ${JSON.stringify(c.checkouts)}`;
  const ran = b.starts.filter((s) => s.claim === SECOND && s.check === STATE.check);
  expect(ran.map((s) => (s.run !== null && s.cwd.startsWith(`${b.root}/`) ? `${s.outcome} reading ${String(s.state).trim()}` : `not in a checkout: ${s.refused ?? s.cwd}`)), `${AC4} ${STATE.check}'s recorded reads changed (${STATE_FILE} now has two open items), so ${STATE.check} must run for the second claim in a checkout under ${b.root} on the new reading, and fail there; ${seen}`).toEqual(['failed reading {"open":2}']);
  expect(c.checkouts, `${AC4} the stop where ${STATE.check}'s recorded reads changed makes its checkout under ${b.root}; ${seen}`).toHaveLength(1);
  expect(v?.outcome, `${AC4} the claim is judged on the new reading, where ${STATE.check} fails: FAIL, never the last claim's PASS carried; ${seen}`).toBe('FAIL');
}), 900_000);
