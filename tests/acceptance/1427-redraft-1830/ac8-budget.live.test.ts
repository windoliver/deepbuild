// Criterion 8's budget, blind redraft for #1830 of ../1427/ac8-budget.live.test.ts (README): on the reference Mac, the
// check adds under 2 s to a 30-second journey. The journey is the lab's: a launch, five presses and a wait to 30 s of the
// replica's clock, run twice in fresh processes, once plainly (the calls driven one by one, nothing recorded) and once
// through `motion_check` (recorded at every 1/120 s and read for findings). Each of five pairs after a warm-up pair gives
// the added time, the second less the first, from spawning deep-drive to the last answer, and reads the one-minute load
// average at the pair's start and at its end; the five are judged by scripts/benchmark.mjs's judgeLimit against 2,000 ms
// with the five pairs' loads: PASS only on a reference Mac on mains power, Low Power Mode off and the thermal state
// nominal, with no pair's load above the core count and all five within the limit; anything else fails here, as FAIL or
// as INCONCLUSIVE with judgeLimit's reason, and never passes.
//
// Skipped unless DEEP_MOTION_BUDGETS=1: the local preflight's perf step sets it on the reference Mac. It spends no plan.
//   DEEP_MOTION_BUDGETS=1 npx vitest run --root tests/acceptance/1427-redraft-1830 ac8-budget.live.test.ts
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { Drive, REPO, cleanup, launchLab, motionCheck, must, press, requireMacos, waitUntil, type Obj } from '../1427/helpers.ts';

afterEach(cleanup, 60_000);
const OPTED = process.env.DEEP_MOTION_BUDGETS === '1';
const LIMIT_MS = 2000;

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
const oneMinuteLoad = (): number => loadavg()[0]!;

const calls = (): Obj[] => [
  launchLab(),
  press('Drift long'),
  waitUntil(1),
  press('Flicker 3'),
  press('Overshoot'),
  press('Jump'),
  waitUntil(30),
  { call: 'expect', locator: { role: 'button', name: 'Jump' }, expect: { name: 'jump-button', assert: 'visible' } },
];

/** Milliseconds from spawning deep-drive to the journey's last answer, the calls driven one by one. */
async function plain(): Promise<number> {
  const at = performance.now();
  const drive = await Drive.start();
  const [first, ...rest] = calls();
  const replica = (await must(drive, first!, 'launch')).replica as string;
  for (const c of rest) await must(drive, { ...c, replica }, String(c.call));
  const ms = performance.now() - at;
  await drive.stop();
  return ms;
}
/** The same, through the motion check, which records every step and reads the recording. */
async function checkedRun(): Promise<number> {
  const at = performance.now();
  const drive = await Drive.start();
  const reply = await motionCheck(drive, { journey: calls() });
  const ms = performance.now() - at;
  expect(reply.ok, `motion_check answers: ${JSON.stringify(reply).slice(0, 500)}`).toBe(true);
  expect(reply.recording.frames, 'it recorded all 30 s, a frame every 1/120 s').toBeGreaterThanOrEqual(30 * 120 - 2);
  await drive.stop();
  return ms;
}

describe.skipIf(!OPTED)('#1427 AC8 the check adds under 2 s to a 30-second journey, on the reference Mac', () => {
  it('five pairs after a warm-up pair: the checked run less the plain run, each under 2,000 ms', async () => {
    requireMacos();
    await plain();
    await checkedRun();
    const added: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      const start = oneMinuteLoad();
      const base = await plain();
      const withCheck = await checkedRun();
      loads.push({ start, end: oneMinuteLoad() });
      added.push(Math.max(0, withCheck - base));
    }
    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => Obj; judgeLimit: (o: Obj) => Obj };
    const verdict = bench.judgeLimit({ limit: LIMIT_MS, runs: added, fingerprint: bench.fingerprint(), loads });
    // Only PASS passes; FAIL fails as FAIL, and INCONCLUSIVE or BLOCKED fails as INCONCLUSIVE with judgeLimit's reason.
    expect(verdict.status, `${verdict.status === 'FAIL' ? 'FAIL' : 'INCONCLUSIVE'} the check's added time over five pairs: ${JSON.stringify(verdict)}`).toBe('PASS');
  }, 3_600_000);
});
