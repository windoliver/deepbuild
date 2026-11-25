// Criterion 9: "Budget, a proposal until measured on the reference Mac in the local preflight: a circuit of 64 nodes and
// 128 parts solves in under 0.1 ms a step."
//
// Through `deep-logic first_party`, `playback`, `judge`, and #532's `view` and `frame` (README: The surface): the grid
// (circuits.ts: GRID), 64 nodes and 128 parts, at 1,000 steps a second, linking circuit@1's reference library through
// the interface, in two programs: `busy` solves the circuit at every step and publishes the state; `idle` adds the same
// nodes and parts at init and only publishes. A frame of a live view runs one step, and its eval_ns is that step's CPU
// time in the logic module; a step's solve is the median busy frame less the median idle frame, so the frame's own work
// (copying and hashing the arrays, in a debug build) is left out. Each of five runs takes 60 frames of each,
// interleaved, after 120 frames of warm-up, the one-minute load read at each run's start and end; scripts/benchmark.mjs's
// judgeLimit judges the five against 0.1 ms: PASS passes, FAIL fails, anything else (off a reference Mac, under load)
// fails as INCONCLUSIVE with its readings, never a pass. First, on any machine, that what is timed is a solve: the
// grid's source and its farthest load carry the currents this suite's own nodal solve gives (model.ts: solveRms), and
// circuit.kcl, circuit.power and circuit.fuse pass. The wrong programs: a slow solve, and one that skips the work (zeros
// pass kcl and power, so the currents are checked).
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, frameCall, live, logicBin, median, num, onHost, prebuild, show, str, viewCall } from '../190/helpers.ts';
import { GRID, index } from './circuits.ts';
import { AC, FUSE, INTERFACE, KCL, POWER, circuitLib, fixturePiece, judgeCall, judged, nums, playbackCall, played, rule } from './helpers.ts';
import { solveRms } from './model.ts';

prebuild(() => { logicBin(); });

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[9]} a circuit of 64 nodes and 128 parts, a step on the reference Mac`, () => {
  it(`${AC[9]} a circuit of 64 nodes and 128 parts solves: the currents of a nodal solve, and its kind rules pass`, () => {
    expect([GRID.circuit.nodes.length, GRID.circuit.parts.length, new Set(GRID.circuit.parts.map((p) => p.id)).size], '64 nodes and 128 parts, each its own ID').toEqual([64, 128, 128]);
    const want = solveRms(GRID.circuit, (p) => p.kind !== 'fault');
    const [source, far, fuse] = [index(GRID.circuit, 'mains'), index(GRID.circuit, 'bulb63'), index(GRID.circuit, 'main_fuse')];
    expect([want.i[source]! > 10 && want.i[source]! < 100, want.i[far]! > 0 && want.i[far]! < want.i[index(GRID.circuit, 'bulb2')]!], `by the model the source gives ${want.i[source]} A, under the fuse's 100 A, and the farthest load takes the least, ${want.i[far]} A`).toEqual([true, true]);

    const L = circuitLib();
    const p = fixturePiece(GRID, INTERFACE, [L.ref], L.assets);
    const [play, judge] = onHost([playbackCall(p, GRID, [0, GRID.steps - 1]), judgeCall(p, GRID)]);
    const at = played(play!, GRID.item);
    for (const k of [0, GRID.steps - 1]) {
      const irms = nums(at.get(k), 'i_rms');
      expect([rel(irms[source]!, Math.abs(want.i[source]!)), rel(irms[far]!, Math.abs(want.i[far]!)), rel(irms[fuse]!, Math.abs(want.i[fuse]!))].every((d) => d <= 1e-9), `step ${k}: the source, the farthest load and the fuse carry ${irms[source]}, ${irms[far]} and ${irms[fuse]} A, the nodal solve's ${want.i[source]}, ${want.i[far]}, ${want.i[fuse]} within 1e-9 relative`).toBe(true);
    }
    const j = judged(judge!, GRID.item);
    for (const code of [KCL, POWER, FUSE]) expect([rule(j, code).verdict, rule(j, code).fails], `${code} passes on the grid: ${show(rule(j, code).fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${AC[9]} budget: a circuit of 64 nodes and 128 parts solves in under 0.1 ms a step on the reference Mac`, async () => {
    const L = circuitLib();
    const kinds = ['busy', 'idle'] as const;
    const pieces = kinds.map((w) => fixturePiece(GRID, INTERFACE, [L.ref], L.assets, { solves: w === 'busy' ? 1 : 0 }));
    const sessions = kinds.map(() => live(logicBin()));
    try {
      const ids: string[] = [];
      for (const [i, s] of sessions.entries()) {
        const opened = await s.call(viewCall(pieces[i]!, 120));
        expect(opened['ok'], `view opened the ${kinds[i]} grid: ${show(opened)}`).toBe(true);
        ids.push(str(opened['session'], 'view.session'));
      }
      let k = 0;
      /** One frame of each, one step later: each one-step frame's eval_ns, in ms. */
      const round = async (): Promise<(number | null)[]> => {
        k += 1;
        const out: (number | null)[] = [];
        for (const [i, s] of sessions.entries()) {
          const f = await s.call(frameCall(ids[i]!, k / GRID.rate));
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
        runs.push(Math.max(0, median(got[0]!) - median(got[1]!)));
      }
      const { fingerprint, judgeLimit } = await benchmark();
      const machine = fingerprint();
      const result = judgeLimit({ limit: 0.1, runs, fingerprint: machine, loads });
      const shown = `a step of the 64-node, 128-part grid: ${runs.map((r) => r.toFixed(4)).join(', ')} ms against 0.1 ms, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      console.log(`${AC[9]} ${shown}`);
      expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
      if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
    } finally {
      for (const s of sessions) s.stop();
    }
  }, TIMEOUT);
});
