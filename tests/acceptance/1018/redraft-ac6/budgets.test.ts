// #1018 AC6 #1018.e558130f, blind redraft (README): "Budgets, on the reference Mac in the local preflight, compared with
// the merge base: with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict."
//
// Both sides run on this machine in one run (design: Speed claims name their baseline): this checkout's hub and the
// merge base's, each built from its own source, each with its own record holding the same 10,000 seeded results (twenty
// checks on 500 trees, from real claims). Then, on each side, pairs of sessions in two worktrees of one repo claim the
// same change: A's claim is on a tree no claim had, so its check runs; B's claim follows on the same tree, so on this
// side its result carries across sessions from A's run, and on the merge base its check runs again.
//
// What carrying adds is read from the hub's own record, never from a session's word: a claim's gate time is from its
// stop (agent.stop) to its verdict (verdict.made), less the time its own runs took (run.started to run.finished). So the
// run carrying replaces earns this side no credit; what is left is what the gate does around the runs, where carrying
// works. Two figures, each per run as this side's p95 less the merge base's over the same claims:
//   carried: B's claims, whose result carries on this side (the criterion's case);
//   ran:     A's claims, which run on both sides but on this side are looked up among the kept keys first.
// Each is judged by the design's rule for timing results (scripts/benchmark.mjs judgeLimit): five runs after a
// warm-up, PASS when all five are within 5 ms, FAIL when all five are over it by more than the margin, otherwise
// INCONCLUSIVE. A PASS also needs the measurement to resolve 5 ms: each run's noise floor (the merge base against
// itself) gives the figure's resolution, which must be at most 5/3 ms. Off a reference Mac (Mac15,7 or Mac15,12, on mains,
// Low Power Mode off, thermal state nominal) or with the machine loaded past its core count, before or after, the test
// skips as INCONCLUSIVE; it never passes by skipping.
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC6, bench, benchmark, carriedOrFail, cleanup, figures, fixed, loadProblem, machineProblem, mergeBase, mergeBaseSide, pairs, resolution, seed,
  stopHub, thisSide, type Bench, type Figures, type Judged, type PairSample,
} from './helpers.ts';

const LIMIT_MS = 5;
const KEYS = 10_000;
/** Pairs per run and side: 200 claims of each kind, so a p95 is the 190th of 200. */
const N = 200;
const WARM = 20;
const RUNS = 5;
/** The largest resolution (one standard deviation of a figure) at which a PASS counts: 5 ms is then three of them. */
const RESOLVES = LIMIT_MS / 3;

const shownFigures = (name: string, fs: readonly Figures[]): string => [
  `${name}: this side adds ${fixed(fs.map((f) => f.adds))} ms at p95`,
  `p95 this side ${fixed(fs.map((f) => f.head))}, merge base ${fixed(fs.map((f) => f.base))}`,
  `p50 this side ${fixed(fs.map((f) => f.headP50))}, merge base ${fixed(fs.map((f) => f.baseP50))}`,
  `noise floors ${fixed(fs.map((f) => f.floor))}, resolution ${resolution(fs.map((f) => f.floor)).toFixed(2)} ms`,
].join('; ');

describe(`${AC6} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC6} with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict`, async (ctx: TestContext) => {
    const before = await machineProblem();
    if (before) { ctx.skip(`INCONCLUSIVE ${before}: a budget counts only on a reference Mac`); return; }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const head = thisSide();
    const base = mergeBaseSide(mergeBase());
    const sides: Bench[] = [];
    try {
      const [h, b] = await Promise.all([bench(head), bench(base)]);
      sides.push(h, b);
      // One side at a time, so each side's checks have the machine's slots to themselves.
      const hKept = await seed(h, KEYS);
      const bKept = await seed(b, KEYS);
      expect(hKept, `this side's record must keep ${KEYS} results before the measurement (distinct check and snapshot, passed)`).toBeGreaterThanOrEqual(KEYS);
      expect(bKept, `the merge base's record must hold the same ${KEYS} results`).toBeGreaterThanOrEqual(KEYS);
      await pairs(h, b, WARM, 'warm-up', carriedOrFail);
      const runs: PairSample[][] = [];
      for (let r = 0; r < RUNS; r++) runs.push(await pairs(h, b, N, `run ${r + 1}`, carriedOrFail));

      const carried = runs.map((run) => figures(run, 'b'));
      const ran = runs.map((run) => figures(run, 'a'));
      const where = `${String(machine.model)} macOS ${String(machine.macosBuild)}, this side ${head.commit.slice(0, 12)} against the merge base ${base.commit.slice(0, 12)}, ${hKept} keys kept, ${N} pairs a run`;
      console.log(`${AC6} ${where}\n  ${shownFigures('carried', carried)}\n  ${shownFigures('ran', ran)}`);

      const after = loadProblem();
      if (after) { ctx.skip(`INCONCLUSIVE ${after} after the measurement; the readings above are readings only`); return; }
      const results: [string, Judged, number][] = ([['carried', carried], ['ran', ran]] as const).map(([name, fs]) => [
        name,
        // What carrying adds can't be less than nothing: a negative reading is noise, and counts as 0 ms added.
        judgeLimit({ limit: LIMIT_MS, runs: fs.map((f) => Math.max(0, f.adds)), fingerprint: machine }),
        resolution(fs.map((f) => f.floor)),
      ]);
      const said = results.map(([name, j, res]) => `${name} ${j.status}${j.reason ? ` (${j.reason})` : ''}, resolution ${res.toFixed(2)} ms`).join('; ');
      console.log(`${AC6} ${said}`);
      for (const [name, j] of results) if (j.status === 'BLOCKED') throw Error(`BLOCKED ${name}: ${j.reason}`);
      for (const [name, j] of results) expect(j.status, `FAIL ${name}: ${shownFigures(name, name === 'carried' ? carried : ran)} against ${LIMIT_MS} ms (${where})`).not.toBe('FAIL');
      const blurred = results.filter(([, j, res]) => j.status === 'PASS' && res > RESOLVES);
      if (blurred.length) { ctx.skip(`INCONCLUSIVE the measurement can't tell ${LIMIT_MS} ms: resolution over ${RESOLVES.toFixed(2)} ms for ${blurred.map(([n, , r]) => `${n} (${r.toFixed(2)} ms)`).join(', ')}; ${said}`); return; }
      if (results.some(([, j]) => j.status === 'INCONCLUSIVE')) { ctx.skip(`INCONCLUSIVE ${said}`); return; }
    } finally {
      await Promise.all(sides.map((s) => stopHub(s.hub)));
      await cleanup();
    }
  }, 4 * 3_600_000);
});
