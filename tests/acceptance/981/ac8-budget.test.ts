// Criterion 8: "Budget, a proposal until measured on the reference Mac in the local preflight: 50 vehicles on a graph of
// 400 edges step in under 0.2 ms a step, and a route search takes under 0.1 ms."
//
// Through `deep-logic first_party`, `bake`, and #532's `view` and `frame` (README: The surface): the grid scene
// (scenes.ts: GRIDSCENE), 400 paths, 54 bays, 50 vehicles, linking the reference library through lanes@1, in three
// programs (programs.ts: gridProgram): `busy` sends every vehicle on a seeded task over steps 0 to 12 and then only
// steps the world; `idle` places the same vehicles and calls nothing; `search` places them and asks route() once a
// step for a far pair of bays. A frame of a live view runs one step, and its eval_ns is that step's CPU time in the
// logic module; a step's cost is the median busy frame less the median idle frame, a search's the median search frame
// less the median idle frame, so the frame's own work (copying and hashing arrays, in a debug build) is left out. Each
// of five runs takes 60 frames of each, interleaved, after 120 frames of warm-up (busy's sending among them), the
// one-minute load read at each run's start and end; scripts/benchmark.mjs's judgeLimit judges the five: PASS passes,
// FAIL fails, anything else (off a reference Mac, under load) fails as INCONCLUSIVE with its readings, never a pass.
// "In the local preflight" isn't something a test can see: it reads as this file run on the reference Mac. First, on
// any machine, the route search is the quickest time over the drawn grid, worked here by Dijkstra.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, bakeCall, bakeOf, frameCall, live, logicBin, median, num, onHost, prebuild, show, str, viewCall, type JsonObject } from '../190/helpers.ts';
import { AC, INTERFACE, carry, lanes, layout, piece, series, type Link } from './helpers.ts';
import { gridProgram, lanesWrites, type Writes } from './programs.ts';
import { GRID, GRIDSCENE, SEARCHES, bayTime, bayNames, stronglyConnected, unreachableBays } from './scenes.ts';

prebuild(() => { logicBin(); });

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

const WRITES: Record<'busy' | 'idle' | 'search', Writes> = {
  busy: lanesWrites(GRID.vehicles), idle: lanesWrites(GRID.vehicles), search: lanesWrites(GRID.vehicles, { t: { type: 'f64' } }),
};
function gridPiece(which: 'busy' | 'idle' | 'search', ref: Link, assets: Record<string, string>): JsonObject {
  const program = gridProgram(INTERFACE, layout(WRITES[which]), which);
  return piece({ grid: { program, writes: WRITES[which], scene: GRIDSCENE, links: [ref] } }, [], carry({ ...assets }, program));
}

/** judgeLimit on five runs with their loads: PASS passes, FAIL fails, anything else is INCONCLUSIVE, never a pass. */
async function judge(what: string, limit: number, runs: number[], loads: Load[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const shown = `${what}: ${runs.map((r) => r.toFixed(1)).join(', ')} µs against ${limit} µs, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[8]} ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
}

describe(`${AC[8]} lanes@1's budget on the reference Mac`, () => {
  it(`${AC[8]} the 400-path grid holds 54 bays every node reaches, and route() gives the quickest time over it`, () => {
    expect([GRIDSCENE.paths.length, bayNames(GRIDSCENE).length, stronglyConnected(GRIDSCENE), unreachableBays(GRIDSCENE)], '400 paths, 54 bays, every node reaching every other').toEqual([400, 54, true, []]);
    const want = SEARCHES.map(([a, b]) => bayTime(GRIDSCENE, a, b));
    expect(want.every((t) => t > 100 && t < 1000), `the searched pairs are far apart: ${want.join(', ')} s`).toBe(true);
    const L = lanes();
    const [search, busy] = onHost([bakeCall(gridPiece('search', L.ref, L.assets), 8), bakeCall(gridPiece('busy', L.ref, L.assets), 60)]);
    const t = series(bakeOf(search!, 'the search program\'s bake'), 'grid', 't').map((x) => num(x[0], 'a route time'));
    t.forEach((x, k) => expect(Math.abs(x - want[k % want.length]!), `route() at step ${k} gives ${x} s, the quickest ${want[k % want.length]} s`).toBeLessThanOrEqual(1e-9));
    const b = bakeOf(busy!, 'the busy program\'s bake');
    expect([b.traps, b.steps.length], `50 vehicles on the grid step 60 steps without a trap: ${show(b.traps as never)}`).toEqual([[], 60]);
  }, TIMEOUT);

  it(`${AC[8]} 50 vehicles on a graph of 400 edges step in under 0.2 ms a step, and a route search takes under 0.1 ms`, async () => {
    const L = lanes();
    const kinds = ['busy', 'idle', 'search'] as const;
    const pieces = kinds.map((w) => gridPiece(w, L.ref, L.assets));
    const sessions = kinds.map(() => live(logicBin()));
    try {
      const ids: string[] = [];
      for (const [i, s] of sessions.entries()) {
        const opened = await s.call(viewCall(pieces[i]!, 120));
        expect(opened['ok'], `view opened the ${kinds[i]} piece: ${show(opened)}`).toBe(true);
        ids.push(str(opened['session'], 'view.session'));
      }
      let k = 0;
      /** One frame of each, one step later: each one-step frame's eval_ns, in µs. */
      const round = async (): Promise<(number | null)[]> => {
        k += 1;
        const out: (number | null)[] = [];
        for (const [i, s] of sessions.entries()) {
          const f = await s.call(frameCall(ids[i]!, k / GRIDSCENE.rate));
          expect(f['traps'] ?? [], `the ${kinds[i]} frame at step ${k} traps nothing`).toEqual([]);
          out.push(f['steps'] === 1 ? num(f['eval_ns'], 'eval_ns') / 1000 : null);
        }
        return out;
      };
      for (let w = 0; w < 120; w++) await round();
      const step: number[] = [], search: number[] = [], loads: Load[] = [];
      for (let run = 0; run < 5; run++) {
        const start = loadavg()[0]!;
        const got: number[][] = [[], [], []];
        for (let f = 0; f < 60; f++) (await round()).forEach((x, i) => { if (x !== null) got[i]!.push(x); });
        loads.push({ start, end: loadavg()[0]! });
        expect(got.map((g) => g.length >= 30), `at least 30 one-step frames of each in run ${run}`).toEqual([true, true, true]);
        step.push(median(got[0]!) - median(got[1]!));
        search.push(median(got[2]!) - median(got[1]!));
      }
      const results = await Promise.allSettled([judge('a step of 50 vehicles on 400 edges', 200, step, loads), judge('a route search on 400 edges', 100, search, loads)]);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason?.message ?? r.reason));
      if (failed.length) throw Error(failed.some((m) => !m.startsWith('INCONCLUSIVE')) ? failed.join('\n') : `INCONCLUSIVE: ${failed.join('\n')}`);
    } finally {
      for (const s of sessions) s.stop();
    }
  }, TIMEOUT);
});
