// Criterion 15: "Budget, a proposal until measured on the reference Mac in the local preflight: a circuit of 64 nodes
// and 128 parts with 8 breakers, 2 RCDs, 4 changeovers and a transformer solves in under 0.1 ms a step."
//
// Through `deep-logic first_party`, `playback`, `judge`, and #532's `view` and `frame` (README: The surface), as
// #1181's criterion 9 times its grid: the board (circuits.ts: GRID), 64 nodes and 128 parts, at 1,000 steps a second,
// linking circuit@2's reference library through the interface, in two programs: `busy` solves the circuit at every
// step and publishes the state; `idle` adds the same nodes and parts at init and only publishes. A frame of a live view
// runs one step and its eval_ns is that step's CPU time in the logic module; a step's solve is the median busy frame
// less the median idle frame. Each of five runs takes 60 frames of each, interleaved, after 120 frames of warm-up, the
// one-minute load read at each run's start and end; scripts/benchmark.mjs's judgeLimit judges the five against 0.1 ms:
// PASS passes, FAIL fails, anything else (off a reference Mac, under load) fails as INCONCLUSIVE with its readings,
// never a pass. First, on any machine, that what is timed is a solve: the source, both poles of an RCD, a breaker,
// the hall's lamp behind its four changeovers, the transformer's two windings and the farthest ladder load carry the
// currents this suite's own nodal solve gives (model.ts: solveRms), and all six kind rules pass. The wrong programs:
// a slow solve, and one that skips the work (zeros pass kcl and power, so the currents are checked).
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, frameCall, live, logicBin, median, num, onHost, prebuild, show, str, viewCall } from '../190/helpers.ts';
import { GRID, index } from './circuits.ts';
import { AC, INTERFACE, RULES, circuitLib, item, judgeCall, judged, nums, piece, playbackCall, played, refPiece, rel, rule } from './helpers.ts';
import { solveRms } from './model.ts';

prebuild(() => { logicBin(); });

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

describe(`${AC[15]} a board of 64 nodes and 128 parts, a step on the reference Mac`, () => {
  it(`${AC[15]} a circuit of 64 nodes and 128 parts with 8 breakers, 2 RCDs, 4 changeovers and a transformer solves: the currents of a nodal solve, and its kind rules pass`, () => {
    const kinds = (k: string): number => GRID.circuit.parts.filter((p) => p.kind === k).length;
    expect([GRID.circuit.nodes.length, new Set(GRID.circuit.nodes).size, GRID.circuit.parts.length, new Set(GRID.circuit.parts.map((p) => p.id)).size, kinds('breaker'), kinds('rcd'), kinds('changeover'), kinds('transformer')], '64 nodes and 128 parts, each its own name, with 8 breakers, 2 RCDs, 4 changeovers and a transformer').toEqual([64, 64, 128, 128, 8, 2, 4, 1]);
    const want = solveRms(GRID.circuit);
    const ids = ['mains', 'rcd_a', 'rcd_b', 'cb_b3', 'hall_lamp', 'bell_tx', 'bell', 'bulb_b3_8'];
    const at = Object.fromEntries(ids.map((id) => [id, index(GRID.circuit, id)]));
    expect([Math.abs(want.i[at['mains']!]!) > 10, Math.abs(want.i[at['cb_b3']!]!) < 4 * 16, rel(Math.abs(want.i[at['bell']!]!), 0.5) < 1e-12, rel(Math.abs(want.i[at['hall_lamp']!]!), 60 / 230) < 1e-3], `by the model the source gives ${want.i[at['mains']!]} A, the busiest breaker stays under its magnetic 64 A, the bell takes 0.5 A and the hall lamp is lit`).toEqual([true, true, true, true]);

    const L = circuitLib();
    const p = refPiece(L, [GRID]);
    const [play, judge] = onHost([playbackCall(p, GRID, [0, GRID.steps - 1]), judgeCall(p, GRID)]);
    const got = played(play!, GRID.item);
    const pairs: [string, 'i_rms' | 'i2_rms', number][] = [
      ['mains', 'i_rms', want.i[at['mains']!]!], ['rcd_a', 'i_rms', want.i[at['rcd_a']!]!], ['rcd_a', 'i2_rms', want.i2[at['rcd_a']!]!],
      ['rcd_b', 'i_rms', want.i[at['rcd_b']!]!], ['cb_b3', 'i_rms', want.i[at['cb_b3']!]!], ['hall_lamp', 'i_rms', want.i[at['hall_lamp']!]!],
      ['bell_tx', 'i_rms', want.i[at['bell_tx']!]!], ['bell_tx', 'i2_rms', want.i2[at['bell_tx']!]!], ['bulb_b3_8', 'i_rms', want.i[at['bulb_b3_8']!]!],
    ];
    for (const k of [0, GRID.steps - 1]) {
      const off = pairs.filter(([id, array, amps]) => !(rel(nums(got.get(k), array)[at[id]!]!, Math.abs(amps)) <= 1e-9)).map(([id, array, amps]) => `${id}.${array} ${nums(got.get(k), array)[at[id]!]} against ${Math.abs(amps)}`);
      expect(off, `step ${k}: each part carries the nodal solve's current within 1e-9 relative`).toEqual([]);
    }
    const j = judged(judge!, GRID.item);
    for (const code of Object.keys(RULES)) expect([rule(j, code).verdict, rule(j, code).fails], `${code} passes on the board: ${show(rule(j, code).fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${AC[15]} budget: a circuit of 64 nodes and 128 parts with 8 breakers, 2 RCDs, 4 changeovers and a transformer solves in under 0.1 ms a step on the reference Mac`, async () => {
    const L = circuitLib();
    const kinds = ['busy', 'idle'] as const;
    const pieces = kinds.map((w) => piece({ [GRID.item]: item({ ...GRID, solves: w === 'busy' ? 1 : 0 }, INTERFACE, [L.ref]) }, [], L.assets));
    const sessions = kinds.map(() => live(logicBin()));
    try {
      const ids: string[] = [];
      for (const [i, s] of sessions.entries()) {
        const opened = await s.call(viewCall(pieces[i]!, 120));
        expect(opened['ok'], `view opened the ${kinds[i]} board: ${show(opened)}`).toBe(true);
        ids.push(str(opened['session'], 'view.session'));
      }
      let k = 0;
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
      const shown = `a step of the 64-node, 128-part board: ${runs.map((r) => r.toFixed(4)).join(', ')} ms against 0.1 ms, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      console.log(`${AC[15]} ${shown}`);
      expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
      if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
    } finally {
      for (const s of sessions) s.stop();
    }
  }, TIMEOUT);
});
