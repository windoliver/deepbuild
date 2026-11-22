// Criterion 5, its budget: "Forty movers over two hours: `conflicts` over the whole span runs in under 20 ms on the
// reference Mac, and its result is equal on macOS, Linux and in headless Chrome by state hash"
//
// Through `deep-logic first_party`, `bake`, and #532's `view` and `frame` (README: The surface): the forty movers
// (scenes.ts: FORTY; model.ts: forty), linking the reference library through separation@1, in two programs: `busy`
// asks conflicts(0, 7200) at every step and publishes the state; `idle` loads the same forty movers and only
// publishes. A frame of a live view runs one step, and its eval_ns is that step's CPU time in the logic module; the
// call's cost is the median busy frame less the median idle frame, so the frame's own work (copying and hashing the
// arrays, in a debug build) is left out. That is the criterion's "`conflicts` over the whole span": one call over
// [0, 7200] s for all 780 pairs. Each of five runs takes 60 frames of each, interleaved, after 120 frames of warm-up,
// the one-minute load read at each run's start and end; scripts/benchmark.mjs's judgeLimit judges the five: PASS
// passes, FAIL fails, anything else (off a reference Mac, under load) fails as INCONCLUSIVE with its readings, never
// a pass. First, on any machine: the call's result is the model's, window for window, and holds conflicts and clear
// pairs. The hosts are ac5-hosts.test.ts.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, arraysAt, bakeCall, bakeOf, frameCall, live, logicBin, median, num, onHost, prebuild, show, str, viewCall, type JsonObject } from '../190/helpers.ts';
import { AC, INTERFACE, layout, piece, separation, windowsDiffer, windowsOf, type Link } from './helpers.ts';
import { conflicts, flyAll, fragile } from './model.ts';
import { WINDOWS, script, scriptWrites } from './programs.ts';
import { FORTY, LATERAL, TOL } from './scenes.ts';

prebuild(() => { logicBin(); });

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

const N = FORTY.scene.movers.length;
const WRITES = scriptWrites(N);
/** The logic module's step rate where an item names none. */
const RATE = 60;
function fortyPiece(which: 'busy' | 'idle', ref: Link, assets: Record<string, string>): JsonObject {
  const program = script({ name: which, movers: N, ...(which === 'busy' ? { each: [{ op: 'conflicts' as const, span: FORTY.span }] } : {}) }, INTERFACE);
  return piece({ forty: { program, writes: WRITES, scene: FORTY.scene, links: [ref] } }, [], assets);
}

describe(`${AC[5]} conflicts over two hours of forty movers, on the reference Mac`, () => {
  it(`${AC[5]} forty movers over two hours: conflicts over the whole span gives every window of the closed form, and its result holds conflicts and clear pairs`, () => {
    const flown = flyAll(FORTY.scene);
    const want = conflicts(FORTY.scene, flown, ...FORTY.span);
    expect([N, FORTY.span, Math.max(...flown.map((s) => s[s.length - 1]!.time)) < FORTY.span[1]], 'forty movers, all on their routes within the two hours').toEqual([40, [0, 7200], true]);
    expect(FORTY.sweep.flatMap((span) => fragile(FORTY.scene, flown, ...span)), 'no window of the fixture hangs on rounding').toEqual([]);
    const pairs = new Set(want.map((w) => `${w.a},${w.b}`));
    const level = conflicts({ ...FORTY.scene, minima: { ...FORTY.scene.minima, vertical: 1e9 } }, flown, ...FORTY.span).filter((w) => !pairs.has(`${w.a},${w.b}`));
    expect([want.length, pairs.size, want.length <= WINDOWS, level.length > 0, want.every((w) => w.min === LATERAL && w.to - w.from >= 1)], `the result holds 9 windows of 9 pairs among 780, and pairs inside 5,556 m that their levels keep clear (${level.length})`).toEqual([9, 9, true, true, true]);

    const S = separation();
    layout(WRITES);
    const [reply] = onHost([bakeCall(fortyPiece('busy', S.ref, S.assets), 3)]);
    const b = bakeOf(reply!, 'the forty movers\' bake');
    expect([b.traps, b.steps.length], `forty movers step 3 steps without a trap: ${show(b.traps as never)}`).toEqual([[], 3]);
    for (const k of [0, 1, 2]) expect(windowsDiffer(windowsOf(arraysAt(b, 'forty', k)), want, TOL), `step ${k}: conflicts over the whole span gives the model's windows within 1e-6 s`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} forty movers over two hours: conflicts over the whole span runs in under 20 ms on the reference Mac`, async () => {
    const S = separation();
    layout(WRITES);
    const kinds = ['busy', 'idle'] as const;
    const pieces = kinds.map((w) => fortyPiece(w, S.ref, S.assets));
    const sessions = kinds.map(() => live(logicBin()));
    try {
      const ids: string[] = [];
      for (const [i, s] of sessions.entries()) {
        const opened = await s.call(viewCall(pieces[i]!, 120));
        expect(opened['ok'], `view opened the ${kinds[i]} piece: ${show(opened)}`).toBe(true);
        ids.push(str(opened['session'], 'view.session'));
      }
      let k = 0;
      /** One frame of each, one step later: each one-step frame's eval_ns, in ms. */
      const round = async (): Promise<(number | null)[]> => {
        k += 1;
        const out: (number | null)[] = [];
        for (const [i, s] of sessions.entries()) {
          const f = await s.call(frameCall(ids[i]!, k / RATE));
          expect(f['traps'] ?? [], `the ${kinds[i]} frame at step ${k} traps nothing`).toEqual([]);
          out.push(f['steps'] === 1 ? num(f['eval_ns'], 'eval_ns') / 1e6 : null);
        }
        return out;
      };
      for (let w = 0; w < 120; w++) await round();
      const runs: number[] = [], loads: Load[] = [];
      for (let run = 0; run < 5; run++) {
        const start = loadavg()[0]!;
        const got: number[][] = [[], []];
        for (let f = 0; f < 60; f++) (await round()).forEach((x, i) => { if (x !== null) got[i]!.push(x); });
        loads.push({ start, end: loadavg()[0]! });
        expect(got.map((g) => g.length >= 30), `at least 30 one-step frames of each in run ${run}`).toEqual([true, true]);
        runs.push(median(got[0]!) - median(got[1]!));
      }
      const { fingerprint, judgeLimit } = await benchmark();
      const machine = fingerprint();
      const result = judgeLimit({ limit: 20, runs, fingerprint: machine, loads });
      const shown = `conflicts over two hours of forty movers: ${runs.map((r) => r.toFixed(3)).join(', ')} ms against 20 ms, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      console.log(`${AC[5]} ${shown}`);
      expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
      if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
    } finally {
      for (const s of sessions) s.stop();
    }
  }, TIMEOUT);
});
