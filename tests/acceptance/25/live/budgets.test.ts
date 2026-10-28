// AC8 #25.e5d5c962: budgets, on the reference Mac in the local preflight, compared with the merge base: a held stop
// adds under 20 ms beyond the checks it waits for; the background waiter uses under 5 MB and no CPU while it waits;
// an answer reaches an idle session within 2 s at p95.
//
// Each measurement (measure.ts, README: Budgets) runs `deep setup`'s own entries through the Claude Code stand-in
// against a real hub: ten sessions whose stops are held while you answer, and ten left idle whose waiters are
// sampled for 30 s and then woken by your answer. The merge base's side is measured by the same driver on the base's
// own build, so the comparison is real. The readings are always taken and printed; they count only on a reference
// Mac (Mac15,7 or Mac15,12), Low Power Mode off, thermal state nominal, on battery or mains alike, and not loaded past
// its core count; anywhere else the test is skipped as INCONCLUSIVE with the readings and the load, never passed.
// The wrong-program tests check the instrument itself on any machine: each plant's reading is over its limit.
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { AC8, cleanup, CURRENT, environmentProblem, judge, load, percentile, REPO, type Checkout, type Judged } from './helpers.ts';
import { COULD_NOT_ASK, measure, median, mergeBase, shownReading, type Plan, type Reading } from './measure.ts';

afterAll(cleanup, 60_000);

const FILE = 'tests/acceptance/25/live/budgets.test.ts';
const FULL = { held: 10, idle: 10, wake: true };
const HELD_MS = 20;
const WAKE_MS = 2000;
const WAITER_BYTES = 5_000_000;
const p95 = (xs: number[]) => percentile(xs, 95);
const largest = (xs: number[]) => Math.max(...xs);

/** Skips the test as INCONCLUSIVE, printing why, when the machine's readings don't count; returns otherwise. */
function inconclusiveIfLoaded(ctx: TestContext, loads: Reading['loads'], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}

/**
 * One measurement of this checkout: every session's route must deliver. A failure fails the test, naming the session,
 * unless the machine was loaded past its cores, when it can't be told from contention: INCONCLUSIVE, with the load.
 */
async function measured(ctx: TestContext, co: Checkout, plan: Plan): Promise<Reading> {
  let r: Reading;
  try {
    r = await measure(co, plan);
  } catch (error) {
    // The hub, setup and a plant it refuses are never the load's doing; sessions that couldn't ask may be.
    if ((error as Error).message.startsWith(COULD_NOT_ASK)) inconclusiveIfLoaded(ctx, [await load()], (error as Error).message);
    throw error;
  }
  if (r.failures.length) {
    inconclusiveIfLoaded(ctx, [...r.loads, await load()], shownReading(r));
    throw Error(r.failures.join('\n'));
  }
  return r;
}

/**
 * The merge-base comparison (design: Every task carries its own budgets): a reading regresses when this checkout's
 * median is more than 50% above the base's and further from it than the instrument resolves (README: Disputes, 3).
 * A route the merge base doesn't deliver has no base reading: it is printed as missing there, and nothing regresses.
 */
function regressions(now: Reading[], base: Reading): string[] {
  const pooled = (pick: (r: Reading) => number[]) => now.flatMap(pick);
  const rows: [string, number[], number[], number, number, string][] = [
    ['held stop beyond the answer', pooled((r) => r.heldMs), base.heldMs, 1, 2, 'ms'],
    ['answer to wake', pooled((r) => r.wakeMs), base.wakeMs, 1, 2, 'ms'],
    ['waiter resident memory', pooled((r) => r.waiterRssBytes), base.waiterRssBytes, 1e6, 1, 'MB'],
    ['waiter CPU over 30 s', pooled((r) => r.waiterCpuMs), base.waiterCpuMs, 1, 10, 'ms'],
  ];
  const out: string[] = [];
  for (const [name, mine, theirs, scale, floor, unit] of rows) {
    const a = median(mine) / scale;
    if (!theirs.length) { console.log(`${AC8} ${name}: median ${a.toFixed(2)} ${unit}; the merge base has no reading (its route didn't deliver: ${base.failures.join('; ').slice(0, 600)})`); continue; }
    const b = median(theirs) / scale;
    console.log(`${AC8} ${name}: median ${a.toFixed(2)} ${unit} against the merge base's ${b.toFixed(2)} ${unit}`);
    if (a > b * 1.5 && a - b > floor) out.push(`${name} regressed: median ${a.toFixed(2)} ${unit} against the merge base's ${b.toFixed(2)} ${unit}`);
  }
  return out;
}

describe(`${AC8} Budgets, on the reference Mac in the local preflight, compared with the merge base: a held stop adds under 20 ms beyond the checks it waits for; the background waiter uses under 5 MB and no CPU while it waits; an answer reaches an idle session within 2 s at p95`, () => {
  it(`${AC8} the local preflight runs ${FILE}: a check lane in scripts/lanes.mjs runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism')
        && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    const vitest = checks.flatMap((lane) => lane.commands.filter((c) => c.some((a) => /vitest/.test(a))).map((c) => `${lane.name}: ${c.slice(2).join(' ').slice(0, 300)}`));
    expect(runs.map((r) => r.lane), `some lane must run ${FILE} with --no-file-parallelism (it starts hubs and times them, so nothing may run beside it); the lanes' Vitest commands are:\n${vitest.join('\n')}`).not.toEqual([]);
  });

  it(`${AC8} on the reference Mac, a held stop adds under ${HELD_MS} ms beyond the answer it waits for, the waiter holds under 5 MB and uses no CPU while it waits, and an answer wakes an idle session within 2 s at p95, compared with the merge base (a warm-up, then five runs)`, async (ctx) => {
    const warm = await measured(ctx, CURRENT, FULL);
    console.log(`${AC8} warm-up: ${shownReading(warm)}`);
    // The merge base's own routes, measured by the same driver; one it doesn't deliver is shown missing there.
    const base = await measure(await mergeBase(), FULL);
    console.log(`${AC8} merge base: ${shownReading(base)}`);
    inconclusiveIfLoaded(ctx, [...warm.loads, ...base.loads], `readings only. ${shownReading(warm)}. ${shownReading(base)}`);
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await measured(ctx, CURRENT, FULL));
      console.log(`${AC8} run ${i + 1}: ${shownReading(runs[i]!)}`);
    }
    const judged: Judged[] = [
      judge(`${AC8} held stop beyond the answer it waits for, p95`, runs.map((r) => p95(r.heldMs)), HELD_MS, 'ms', true),
      judge(`${AC8} answer to the idle session's wake, p95`, runs.map((r) => p95(r.wakeMs)), WAKE_MS, 'ms', false),
      judge(`${AC8} waiter resident memory while it waits, largest`, runs.map((r) => largest(r.waiterRssBytes) / 1e6), WAITER_BYTES / 1e6, 'MB', true),
      judge(`${AC8} waiter CPU over 30 s of waiting, most`, runs.map((r) => largest(r.waiterCpuMs)), 0, 'ms', false),
    ];
    for (const j of judged) console.log(`${j.verdict} ${j.text}`);
    const regressed = regressions(runs, base);
    inconclusiveIfLoaded(ctx, runs.flatMap((r) => r.loads), `readings only. ${judged.map((j) => j.text).join('; ')}`);
    expect([...judged.filter((j) => j.verdict === 'FAIL').map((j) => `FAIL ${j.text}`), ...regressed.map((r) => `FAIL ${AC8} ${r}`)], 'every budget within its limit and no reading regressed from the merge base').toEqual([]);
    const open = judged.filter((j) => j.verdict === 'INCONCLUSIVE');
    if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.text).join('; ')}`);
  }, 7_200_000);

  // The instrument, on any machine: each wrong program reads over its limit, far enough that load can't hide it.
  it(`${AC8} (wrong program) a held stop that looks for its answer every 250 ms instead of being told (stop-hold-polls) reads over ${HELD_MS} ms beyond the answer at p95`, async (ctx) => {
    const r = await measured(ctx, CURRENT, { held: 5, idle: 0, wake: false, plant: 'stop-hold-polls' });
    console.log(`${AC8} ${shownReading(r)}`);
    expect(p95(r.heldMs), `the held-stop reading must catch stop-hold-polls: ${shownReading(r)}`).toBeGreaterThanOrEqual(HELD_MS);
  }, 900_000);

  it(`${AC8} (wrong program) a waiter that runs in Node, as the merge base's does, and asks the hub for its answer every 50 ms (waiter-polls) reads over 5 MB and above no CPU while it waits`, async (ctx) => {
    const r = await measured(ctx, CURRENT, { held: 0, idle: 2, wake: false, plant: 'waiter-polls' });
    console.log(`${AC8} ${shownReading(r)}`);
    expect(largest(r.waiterRssBytes), `the waiter's memory reading must catch waiter-polls: ${shownReading(r)}`).toBeGreaterThan(WAITER_BYTES);
    expect(largest(r.waiterCpuMs), `the waiter's CPU reading must catch waiter-polls: ${shownReading(r)}`).toBeGreaterThan(0);
  }, 900_000);

  it(`${AC8} (wrong program) a waiter that asks the hub for its answer every 5 s instead of being told (waiter-checks-every-5s) reads over 2 s from answer to wake at p95`, async (ctx) => {
    const r = await measured(ctx, CURRENT, { held: 0, idle: 6, wake: true, plant: 'waiter-checks-every-5s' });
    console.log(`${AC8} ${shownReading(r)}`);
    expect(p95(r.wakeMs), `the wake reading must catch waiter-checks-every-5s: ${shownReading(r)}`).toBeGreaterThan(WAKE_MS);
  }, 900_000);
});
