// #1018 AC6 #1018.e558130f, blind redraft for #1830 (README): "Budgets, on the reference Mac in the local preflight,
// compared with the merge base: with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a
// claim's verdict."
//
// It runs in place of tests/acceptance/1018/redraft-ac6/budgets.test.ts and measures what that draft measures, with its
// helpers (../1018/redraft-ac6/helpers.ts, frozen): both sides on this machine in one run, this checkout's hub and the
// merge base's, each built from its own source, each with its own record holding the same 10,000 seeded results. Then,
// on each side, pairs of sessions in two worktrees of one repo claim the same change: A's claim is on a tree no claim
// had, so its check runs; B's claim follows on the same tree, so on this side its result carries across sessions from
// A's run, and on the merge base its check runs again. A claim's gate time is read from the hub's own record: from its
// stop (agent.stop) to its verdict (verdict.made), less the time its own runs took. Two figures, each per run as this
// side's p95 less the merge base's over the same claims: `carried` (B's claims) and `ran` (A's claims).
//
// What this draft changes: a run is one call of `pairs` (200 pairs, both sides), and each run reads the one-minute load
// average, os.loadavg()[0], at its start and at its end; both judgeLimit calls get them as `loads`, one { start, end }
// per run in the runs' order (the design's timing rule: a run whose load at its start or its end is above the core
// count counts neither way). The fit gate before the build is this file's own: judgeLimit on this machine's
// fingerprint and the load read now, so an unfit machine skips as INCONCLUSIVE before it builds or measures anything.
// judgeLimit is the judge: PASS passes (when the run's own noise resolves 5 ms, as the first redraft asks), FAIL fails,
// and INCONCLUSIVE or BLOCKED skips as INCONCLUSIVE with its reason, never a pass.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC6, REPO, bench, carriedOrFail, cleanup, figures, fixed, mergeBase, mergeBaseSide, pairs, resolution, seed, stopHub, thisSide,
  type Bench, type Figures, type PairSample,
} from '../1018/redraft-ac6/helpers.ts';

const LIMIT_MS = 5;
const KEYS = 10_000;
/** Pairs per run and side: 200 claims of each kind, so a p95 is the 190th of 200. */
const N = 200;
const WARM = 20;
const RUNS = 5;
/** The largest resolution (one standard deviation of a figure) at which a PASS counts: 5 ms is then three of them. */
const RESOLVES = LIMIT_MS / 3;

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; margin?: number; reason?: string }
interface Benchmark {
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Judged;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

/**
 * Why this machine can't time a budget now, as judgeLimit reads it: its fingerprint, and the load read now standing in
 * for each run's start and end. Null when it can. The runs it judges are placeholders; only its reason is read.
 */
function unfit({ judgeLimit }: Benchmark, machine: Record<string, unknown>): string | null {
  const now = loadavg()[0]!;
  const verdict = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: machine, loads: Array.from({ length: RUNS }, () => ({ start: now, end: now })) });
  return verdict.status === 'PASS' ? null : verdict.reason ?? verdict.status;
}

const shownFigures = (name: string, fs: readonly Figures[]): string => [
  `${name}: this side adds ${fixed(fs.map((f) => f.adds))} ms at p95`,
  `p95 this side ${fixed(fs.map((f) => f.head))}, merge base ${fixed(fs.map((f) => f.base))}`,
  `p50 this side ${fixed(fs.map((f) => f.headP50))}, merge base ${fixed(fs.map((f) => f.baseP50))}`,
  `noise floors ${fixed(fs.map((f) => f.floor))}, resolution ${resolution(fs.map((f) => f.floor)).toFixed(2)} ms`,
].join('; ');
const shownLoads = (loads: readonly Load[]): string => `one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}`;

describe(`${AC6} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC6} with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict`, async (ctx: TestContext) => {
    const judge = await benchmark();
    const machine = judge.fingerprint();
    const before = unfit(judge, machine);
    if (before) { ctx.skip(`INCONCLUSIVE ${before}: a budget counts only on a fit reference Mac`); return; }
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
      const loads: Load[] = [];
      for (let r = 0; r < RUNS; r++) {
        const start = loadavg()[0]!;
        runs.push(await pairs(h, b, N, `run ${r + 1}`, carriedOrFail));
        loads.push({ start, end: loadavg()[0]! });
      }

      const carried = runs.map((run) => figures(run, 'b'));
      const ran = runs.map((run) => figures(run, 'a'));
      const where = `${String(machine.model)} macOS ${String(machine.macosBuild)}, this side ${head.commit.slice(0, 12)} against the merge base ${base.commit.slice(0, 12)}, ${hKept} keys kept, ${N} pairs a run, ${shownLoads(loads)}`;
      console.log(`${AC6} ${where}\n  ${shownFigures('carried', carried)}\n  ${shownFigures('ran', ran)}`);

      const results: [string, Judged, number][] = ([['carried', carried], ['ran', ran]] as const).map(([name, fs]) => [
        name,
        // What carrying adds can't be less than nothing: a negative reading is noise, and counts as 0 ms added.
        judge.judgeLimit({ limit: LIMIT_MS, runs: fs.map((f) => Math.max(0, f.adds)), fingerprint: machine, loads }),
        resolution(fs.map((f) => f.floor)),
      ]);
      const said = results.map(([name, j, res]) => `${name} ${j.status}${j.reason ? ` (${j.reason})` : ''}, resolution ${res.toFixed(2)} ms`).join('; ');
      console.log(`${AC6} ${said}`);
      for (const [name, j] of results) expect(j.status, `FAIL ${name}: ${shownFigures(name, name === 'carried' ? carried : ran)} against ${LIMIT_MS} ms (${where})`).not.toBe('FAIL');
      if (results.some(([, j]) => j.status !== 'PASS')) { ctx.skip(`INCONCLUSIVE ${said}`); return; }
      const blurred = results.filter(([, , res]) => res > RESOLVES);
      if (blurred.length) { ctx.skip(`INCONCLUSIVE the measurement can't tell ${LIMIT_MS} ms: resolution over ${RESOLVES.toFixed(2)} ms for ${blurred.map(([n, , r]) => `${n} (${r.toFixed(2)} ms)`).join(', ')}; ${said}`); return; }
    } finally {
      await Promise.all(sides.map((s) => stopHub(s.hub)));
      await cleanup();
    }
  }, 4 * 3_600_000);
});
