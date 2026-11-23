// AC8 #2892.d7212061: "In a budget window on a reference Mac, the lab reaches its first frame within #172's 3 s with the
// inflating included, and the record gives the time spent inflating. A decision for Brotli holds only while that time is
// under 300 ms for the full player (drafted)"
//
// Split as #172's budgets are: the merge-base comparison and the window are the perf lane's (benchmarks/budgets.json
// has a task naming this criterion, valid against the merge base's budgets); the limit is judged here.
// asserts:
//   - on any machine: the lab's bundle stores the player compressed, and once ready its record, probe()'s
//     `load.inflate_ms` (README: The time spent inflating), is a time in ms above 0 and under its first frame's
//     (`first_frame_ms`, from navigation start);
//   - the perf lane's task, as above;
//   - on a reference Mac on mains power with Low Power Mode off and the thermal state nominal, five runs after a
//     warm-up, each a fresh page of the lab in headless Chrome: `first_frame_ms` within 3,000 ms by the repo's
//     `judgeLimit`, each run's record giving `load.inflate_ms`. Anywhere else INCONCLUSIVE, never a pass.
// The decision is gzip (decision.test.ts), so the Brotli clause's 300 ms isn't judged; each run's inflating time is
// logged. Wrong programs: the merge base (it stores the player as it is and its record gives no inflating time); a
// record that gives 0 or no time; a load whose inflating pushes the first frame past 3 s.
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FULL, REPO, TIMEOUT, benchmark, done, exportLab, inconclusive, judged, none, play, referenceMacProblem, useBrowsers, useShow, useTemp, type JsonValue,
} from '../172/helpers.ts';
import { AC, FIRST_FRAME_MS, git, mergeBase, storedPlayerFailures } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const CRITERION = '#2892.d7212061';

/** One fresh page of the lab: its first frame and the time its record gives for inflating, both in ms. */
async function once(out: string, what: string): Promise<{ first: number; inflate: number }> {
  const p = browsers(await play(out));
  await p.tab.mustBeReady(what);
  const r = await p.tab.evaluate<{ first: JsonValue; load: JsonValue }>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify({ first: v.first_frame_ms ?? null, load: v.load ?? null })); })()`);
  await done(p);
  const load = r.load as { inflate_ms?: JsonValue } | null;
  const inflate = load && typeof load === 'object' ? load.inflate_ms : undefined;
  expect(typeof r.first === 'number' && Number.isFinite(r.first) && r.first > 0, `${what}: probe().first_frame_ms is the time to the first frame: ${JSON.stringify(r.first)}`).toBe(true);
  expect(typeof inflate === 'number' && Number.isFinite(inflate) && inflate > 0, `${what}: the record gives the time spent inflating, probe().load.inflate_ms: ${JSON.stringify(r.load)}`).toBe(true);
  return { first: r.first as number, inflate: inflate as number };
}

describe(`${AC[8]} the lab's first frame within 3 s with the inflating included, and the record gives the time spent inflating`, () => {
  it(`${AC[8]} the record gives the time spent inflating, under the time to the first frame (on any machine)`, async () => {
    const what = 'the lab exported to the web';
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what);
    none(storedPlayerFailures(lab.out, lab.receipt, what), 'the bundle stores the player compressed, as the decision says');
    const r = await once(lab.out, what);
    console.log(`${AC[8]} first frame ${r.first.toFixed(1)} ms, inflating ${r.inflate.toFixed(1)} ms (a reading here, not a budget)`);
    expect(r.inflate, `the time spent inflating (${r.inflate} ms) is part of the time to the first frame (${r.first} ms)`).toBeLessThan(r.first);
  }, TIMEOUT);

  it(`${AC[8]} the perf lane has a task naming ${CRITERION}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; criteria?: string[]; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => (t.criteria ?? []).includes(CRITERION) || `${t.initialReason ?? ''} ${t.changeReason ?? ''}`.includes(CRITERION)), `benchmarks/budgets.json has a task naming ${CRITERION}`).toBe(true);
    validateBudgets(current, JSON.parse(git(['show', `${mergeBase()}:benchmarks/budgets.json`], 'the merge base\'s budgets')));
  }, TIMEOUT);

  it(`${AC[8]} on the reference Mac the lab's first frame, inflating included, comes within 3 s (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the first frame counts only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    const what = 'the lab exported to the web';
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what);
    none(storedPlayerFailures(lab.out, lab.receipt, what), 'the bundle stores the player compressed, as the decision says');
    await once(lab.out, `${what}, the warm-up`);
    const firsts: number[] = []; const inflates: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= 5; k++) {
      const start = loadavg()[0]!;
      const r = await once(lab.out, `${what}, run ${k}`);
      firsts.push(r.first); inflates.push(r.inflate); loads.push({ start, end: loadavg()[0]! });
    }
    console.log(`${AC[8]} the time spent inflating, per run: ${inflates.map((x) => x.toFixed(1)).join(', ')} ms`);
    await judged(AC[8], 'the lab\'s first frame in Chrome from navigation start, inflating included', FIRST_FRAME_MS, firsts, loads, 'ms');
  }, TIMEOUT);
});
