// Criterion 9: "Budget, a proposal until measured on the reference Mac in the local preflight: a model of 2,000 live
// entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step."
//
// Through `deep-logic first_party`, `bake`, `judge`, and #532's `view` and `frame` (README: The surface), as #981's
// criterion 8 times lanes@1: the budget scene (scenes.ts: BUDGET), ten lines of source → queue → conveyor → queue →
// request → queue → request → queue → request → sink, 200 items each made at t = 0, linking the reference library
// through process@1, at a 1/60 s tick, one step a tick. Nothing reaches a sink before tick 840 (a 300-tick belt and
// three 180-tick holds), so all 2,000 are live through every timed step. Two programs (programs.ts): `busy` steps the
// model; `idle` builds the same model and writes the same arrays but calls nothing each step, the frame's own work. A
// frame of a live view runs one step, and its eval_ns is that step's CPU time in the logic module; a step's cost is the
// median busy frame less the median idle frame. Each of five runs takes 60 frames of each, interleaved, after 120 frames
// of warm-up, the one-minute load read at each run's start and end; scripts/benchmark.mjs's judgeLimit judges the five:
// PASS passes, FAIL fails, anything else (off a reference Mac, under load) fails as INCONCLUSIVE with its readings, never
// a pass. "In the local preflight" isn't something a test can see: it reads as this file run on the reference Mac.
// First, on any machine: the model has the counts the criterion names, keeps 2,000 live, and holds its kind rules.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, bakeCall, bakeOf, frameCall, live, logicBin, median, num, onHost, prebuild, show, str, viewCall, type JsonObject } from '../190/helpers.ts';
import { AC, INTERFACE, carry, judgeCall, judged, layout, numbers, passes, piece, processLib, rule, series, type Link } from './helpers.ts';
import { idleProgram, processWrites, sceneProgram } from './programs.ts';
import { BUDGET, BUDGET_EACH, BUDGET_LINES, shape } from './scenes.ts';

prebuild(() => { logicBin(); });

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

const LIMIT_US = 300;
const WRITES = processWrites(BUDGET);
function budgetPiece(which: 'busy' | 'idle', ref: Link, assets: Record<string, string>): JsonObject {
  layout(WRITES);
  const program = which === 'busy' ? sceneProgram(BUDGET, INTERFACE) : idleProgram(BUDGET, INTERFACE);
  return piece({ budget: { program, scene: BUDGET, writes: WRITES, links: [ref] } }, [], carry({ ...assets }, program));
}

/** judgeLimit on five runs with their loads: PASS passes, FAIL fails, anything else is INCONCLUSIVE, never a pass. */
async function judgeRuns(what: string, limit: number, runs: number[], loads: Load[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const shown = `${what}: ${runs.map((r) => r.toFixed(1)).join(', ')} µs against ${limit} µs, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[9]} ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
}

describe(`${AC[9]} process@1's budget on the reference Mac`, () => {
  it(`${AC[9]} the budget model has 40 queues, 30 resources and 10 conveyors, keeps 2,000 entities live and holds process.conserve and process.busy`, () => {
    const { stations, resources } = shape(BUDGET);
    const count = (op: string): number => stations.filter((b) => b.op === op).length;
    expect([count('queue'), resources, count('conveyor'), BUDGET_LINES * BUDGET_EACH], 'the scene: 40 queues, 30 resources, 10 conveyors, 2,000 items').toEqual([40, 30, 10, 2000]);
    const L = processLib();
    const p = budgetPiece('busy', L.ref, L.assets);
    const steps = 420;
    const [bake, judge] = onHost([{ ...bakeCall(p, steps), arrays: ['budget.count', 'budget.busy'] }, judgeCall(p, steps)]);
    const b = bakeOf(bake!, 'the budget model\'s bake');
    expect([b.traps, b.steps.length], `the model steps ${steps} steps without a trap: ${show(b.traps as never)}`).toEqual([[], steps]);
    const N = shape(BUDGET).stations.length;
    const liveAll = numbers(series(b, 'budget', 'count'), 'count').map((c) => c[N]);
    expect(liveAll.every((n) => n === 2000), `2,000 entities live at every one of the ${steps} steps the timing reads (first: ${liveAll[0]}, last: ${liveAll.at(-1)})`).toBe(true);
    const busy = numbers(series(b, 'budget', 'busy'), 'busy');
    expect(busy.at(-1)!.some((x) => x > 0), 'resources are working by the last timed step').toBe(true);
    const j = judged(judge!, 'budget');
    passes(rule(j, 'process.conserve'), 'process.conserve', steps);
    passes(rule(j, 'process.busy'), 'process.busy', steps);
  }, TIMEOUT);

  it(`${AC[9]} a model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step`, async () => {
    const L = processLib();
    const kinds = ['busy', 'idle'] as const;
    const pieces = kinds.map((w) => budgetPiece(w, L.ref, L.assets));
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
          const f = await s.call(frameCall(ids[i]!, k / BUDGET.rate));
          expect(f['traps'] ?? [], `the ${kinds[i]} frame at step ${k} traps nothing`).toEqual([]);
          out.push(f['steps'] === 1 ? num(f['eval_ns'], 'eval_ns') / 1000 : null);
        }
        return out;
      };
      for (let w = 0; w < 120; w++) await round();
      const step: number[] = [], loads: Load[] = [];
      for (let run = 0; run < 5; run++) {
        const start = loadavg()[0]!;
        const got: number[][] = [[], []];
        for (let f = 0; f < 60; f++) (await round()).forEach((x, i) => { if (x !== null) got[i]!.push(x); });
        loads.push({ start, end: loadavg()[0]! });
        expect(got.map((g) => g.length >= 30), `at least 30 one-step frames of each in run ${run}`).toEqual([true, true]);
        step.push(median(got[0]!) - median(got[1]!));
      }
      await judgeRuns('a step of 2,000 live entities, 40 queues, 30 resources and 10 conveyors', LIMIT_US, step, loads);
    } finally {
      for (const s of sessions) s.stop();
    }
  }, TIMEOUT);
});
