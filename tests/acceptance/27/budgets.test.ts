// AC5 #27.ffbe7d6f Budgets, on the reference Mac in the local preflight, compared with the merge base: over 20 runs,
// the answer reaches the idle session within 2 s at p95.
//
// One measurement of a checkout (README: Readings, 6): a fresh home, its hub, `deep setup`, and 20 sessions of the
// Claude Code stand-in in the repo, each asking through its own deep mcp and stopping; each hold ends unanswered, so
// each session is idle with its waiter waiting. You answer each in turn with `deep inbox answer`. A run is one answer:
// from when you ran the command to when Claude Code started the woken turn (the stand-in stamps it). The same driver
// measures the merge base on its own build. Readings count only on a reference Mac (Mac15,7 or Mac15,12), Low Power
// Mode off, thermal state nominal, on battery or mains alike, and not loaded past its core count; anywhere else the
// test is skipped as INCONCLUSIVE with the readings, never passed. The wrong-program test checks the instrument on any
// machine.
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import {
  AC5, CURRENT, answer, carries, cleanup, environmentProblem, idleSessions, load, makeHome, makeRepo, median, mergeBase, percentile, REPO, setup,
  startHub, stopHub, within, type Checkout,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const FILE = 'tests/acceptance/27/budgets.test.ts';
const RUNS = 20;
const WAKE_MS = 2000;

interface Reading { checkout: string; ms: number[]; failures: string[]; loads: { one: number; cores: number }[] }
const shownReading = (r: Reading) => `${r.checkout}: ${r.ms.length} runs, p95 ${r.ms.length ? percentile(r.ms, 95).toFixed(0) : '-'} ms, p50 ${r.ms.length ? median(r.ms).toFixed(0) : '-'} ms (${r.ms.map((x) => x.toFixed(0)).join(', ')} ms); ${r.failures.length} not woken${r.failures.length ? `: ${r.failures.join('; ').slice(0, 1500)}` : ''}; load ${r.loads.map((l) => l.one.toFixed(1)).join(' to ')} on ${r.loads[0]?.cores} cores`;

/** One measurement of `co`: `n` idle sessions, each answered in turn from the CLI, each wake timed from the command's start. */
async function measure(co: Checkout, n: number, plant?: string): Promise<Reading> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const reading: Reading = { checkout: `${co.label}${plant ? ` with ${plant}` : ''}`, ms: [], failures: [], loads: [load()] };
  const { home } = makeHome(co.cli);
  const repo = makeRepo(home);
  const hub = await startHub(home, { plant, noAskWait: true, shortHold: true });
  try {
    await setup(home, env);
    const sessions = await idleSessions(hub, home, n, { env, cwd: repo.dir });
    for (const a of sessions) {
      const typed = await answer(home, a.handle, a.green.id, plant);
      const wake = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped));
      if (!wake || !carries(wake.prompt ?? '', a.green)) reading.failures.push(`${a.s.id} didn't wake with its answer to ${a.handle} within 30 s`);
      else reading.ms.push(Math.max(0, (wake.started ?? wake.at) - typed.started));
    }
    for (const a of sessions) a.claude.quit();
  } finally {
    reading.loads.push(load());
    await stopHub(hub);
  }
  return reading;
}

/** Skips the test as INCONCLUSIVE, printing why, when the machine's readings don't count. */
function inconclusiveIfUnfit(ctx: TestContext, loads: Reading['loads'], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}

describe(`${AC5} Budgets, on the reference Mac in the local preflight, compared with the merge base: over 20 runs, the answer reaches the idle session within 2 s at p95`, () => {
  it(`${AC5} the local preflight runs ${FILE}: a check lane in scripts/lanes.mjs runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism')
        && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    const vitest = checks.flatMap((lane) => lane.commands.filter((c) => c.some((a) => /vitest/.test(a))).map((c) => `${lane.name}: ${c.slice(2).join(' ').slice(0, 300)}`));
    expect(runs.map((r) => r.lane), `${AC5} some lane must run ${FILE} with --no-file-parallelism (it starts hubs and times them, so nothing may run beside it); the lanes' Vitest commands are:\n${vitest.join('\n')}`).not.toEqual([]);
  });

  it(`${AC5} on the reference Mac, over ${RUNS} runs your answer from the CLI reaches the idle session within 2 s at p95, compared with the merge base`, async (ctx) => {
    // The worst load reading counts, and the first is taken as the runs start: past the core count already, the runs
    // can only read INCONCLUSIVE, so they aren't taken (#964).
    const start = load();
    if (start.one > start.cores) inconclusiveIfUnfit(ctx, [start], 'no readings taken: the machine was loaded past its core count before the first run');
    const warm = await measure(CURRENT, 2);
    console.log(`${AC5} warm-up: ${shownReading(warm)}`);
    const base = await measure(await mergeBase(), RUNS);
    console.log(`${AC5} merge base: ${shownReading(base)}`);
    const now = await measure(CURRENT, RUNS);
    console.log(`${AC5} this checkout: ${shownReading(now)}`);
    inconclusiveIfUnfit(ctx, [...warm.loads, ...base.loads, ...now.loads], `readings only. ${shownReading(now)}. ${shownReading(base)}`);
    expect(now.failures, `${AC5} every answer must reach its idle session: ${shownReading(now)}`).toEqual([]);
    expect(now.ms, `${AC5} ${RUNS} runs`).toHaveLength(RUNS);
    const p95 = percentile(now.ms, 95);
    expect(p95, `${AC5} FAIL your answer reached the idle session in ${p95.toFixed(0)} ms at p95 over ${RUNS} runs, against ${WAKE_MS} ms: ${shownReading(now)}`).toBeLessThanOrEqual(WAKE_MS);
    // The design's comparison: a regression is a p50 more than 50% above the merge base's (and past the instrument's 2 ms).
    if (base.ms.length) {
      const [mine, theirs] = [median(now.ms), median(base.ms)];
      expect(mine > theirs * 1.5 && mine - theirs > 2, `${AC5} FAIL answer to wake regressed: p50 ${mine.toFixed(0)} ms against the merge base's ${theirs.toFixed(0)} ms`).toBe(false);
    } else console.log(`${AC5} the merge base woke no session, so nothing regresses from it: ${shownReading(base)}`);
  }, 3_600_000);

  it(`${AC5} (wrong program) a waiter that asks the hub for its answer every 5 s instead of being told (waiter-checks-every-5s) reads over 2 s at p95`, async () => {
    const r = await measure(CURRENT, 6, 'waiter-checks-every-5s');
    console.log(`${AC5} ${shownReading(r)}`);
    expect(r.ms.length, `the instrument woke the planted sessions: ${shownReading(r)}`).toBeGreaterThan(0);
    expect(percentile(r.ms, 95), `${AC5} the wake reading must catch waiter-checks-every-5s: ${shownReading(r)}`).toBeGreaterThan(WAKE_MS);
  }, 900_000);
});
