// AC6 #225.18b68534: "Budgets, on the reference Mac in the local preflight: 1,000 streams of 60 steps integrate in under
// 30 ms at check"
//
// The film: `many`, a vector_field@1 with `fn: {x: "-y", y: "x"}` and `streams: {starts: {points: [1,000 points on a
// 40 × 25 grid over [−1, 1] × [−0.6, 0.6]]}, step: 0.05, time: 3}` (60 steps each; pad 3 keeps every turned point in
// the box). `{"call": "vector_field", item: "many"}` answers `integrate_ms`, the wall time the check spent integrating
// this item's streams, measured by the binary (README: The surface under test).
// Read once with the debug build, so a missing surface fails anywhere: 1,000 streams of 61 or 62 points each (60 steps
// and the start, a last partial step allowed) and an `integrate_ms` above 0. Then only where the perf lane can judge a
// timing (scripts/benchmark.mjs's judgeLimit: a reference Mac on mains power, Low Power Mode off, thermal state nominal,
// the load at each run's start and end below the core count), a release build: one warm-up process, then five fresh
// processes, each run's `integrate_ms` judged against 30 ms by judgeLimit. A FAIL fails; anything but PASS is
// INCONCLUSIVE, and off the reference Mac the test is INCONCLUSIVE before anything is timed. Never a pass by skipping.
// scripts/lanes.mjs runs this file as a timed file, so the local preflight judges it (README: Run).
// Wrong programs: the base (no vector_field@1, no integrate_ms); an integration that reports no time or integrates
// nothing; one dearer than 30 ms for these 60,000 steps (an integration per frame, a tree-walking evaluator per step).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, SWIRL, TIMEOUT, field, fieldCall, fieldOf, film, inconclusive, judgeLimit, load, present, presented, run, scenario, timingProblem, useBins, useFolders,
  type JsonObject,
} from './helpers.ts';

const bin = useBins(['show'], ['show-release']);
const folder = useFolders();
const FILE = 'tests/acceptance/225/ac6-budgets.test.ts';
const STARTS = Array.from({ length: 1000 }, (_, k) => [-1 + (2 * (k % 40)) / 39, -0.6 + (1.2 * Math.floor(k / 40)) / 24, 0]);
const DOC: JsonObject = film('a thousand streams', [640, 480], [field('many', 'a0', { fn: SWIRL, streams: { starts: { points: STARTS }, step: 0.05, time: 3 } })]);

/** One fresh process: the item's integration time at check, its streams checked. */
function integrateMs(path: string, what: string): number {
  const [shown, reply] = run(path, scenario(folder(), [present(DOC), fieldCall('many')]));
  presented(shown!, `${what}: the film of 1,000 streams`);
  const f = fieldOf(reply!, `${what}: vector_field many`);
  expect(f.streams.length, `${what}: 1,000 streams`).toBe(1000);
  const short = f.streams.filter((s) => s.points.length < 61 || s.points.length > 62);
  expect(short.map((s) => `${s.id}: ${s.points.length} points`), `${what}: every stream is 60 steps long`).toEqual([]);
  expect(f.integrateMs, `${what}: the check's integration time is measured`).toBeGreaterThan(0);
  return f.integrateMs;
}

describe(`${AC[6]} the integration budget on the reference Mac`, () => {
  it(`${AC[6]} 1,000 streams of 60 steps integrate in under 30 ms at check (five fresh release processes after a warm-up)`, async () => {
    const reading = integrateMs(bin('show'), 'debug');
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);
    const problem = await timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest (debug reading ${reading.toFixed(3)} ms): ${problem}`);
    const release = bin('show-release');
    integrateMs(release, 'warm-up');
    const runs: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < 5; k++) { const start = load(); runs.push(integrateMs(release, `run ${k + 1}`)); loads.push({ start, end: load() }); }
    const v = await judgeLimit(30, runs, loads);
    console.log(`${AC[6]}: integrate_ms ${runs.map((r) => r.toFixed(3)).join(', ')} against 30 ms: ${JSON.stringify(v)}`);
    expect(v['status'], `1,000 streams of 60 steps within 30 ms: ${JSON.stringify(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') inconclusive(`the integration budget: ${JSON.stringify(v)}`);
  }, 4 * TIMEOUT);
});
