// AC8 #211.c0b6687b: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 8 moves a step
// add under 0.3 ms of CPU in the app; a checkpoint with 50 changed map entries adds under 0.1 ms and 2 KB; and an item
// without pages gains no work at check, per step or per frame"
//
// One timed test, in parts, as #213's budgets are judged:
//   1. On any machine, debug builds, guarded so what is timed is the clause's work: the flood (programs.ts) with 8 moves
//      landing every step from step 3 and 5 of each 8 pages written, so from step 11 each step's moves write 5 dirty
//      pages back, and a checkpoint every 10 steps from checkpoint 30 holds 50 changed map entries: each step with
//      moves reads a positive `pages_ns`, each such checkpoint `map_changed` 50 and `map_bytes` above 0 and under 2,048
//      (machine-independent). An item without pages reads `pages_ns` 0 at every step and no page part in any checkpoint.
//   2. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's task
//      `logic-world-pages`, valid by the lane's validator, and scripts/lanes.mjs runs this file as a timed one.
//   3. Only where the lane can judge (a reference Mac at rest, else INCONCLUSIVE before anything is timed): a release
//      deep-logic, a warm-up run and five, each run's medians judged by scripts/benchmark.mjs's judgeLimit.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CRITERIA, REPO, TIMEOUT, bakeCall, bakeOf, bench, binOf, inconclusive, int, isObject, load, logic, median, none, obj, pagesOf, piece, readJson,
  show, useBuilds, type Bake, type JsonObject, type JsonValue,
} from './helpers.ts';
import { flood, floodWrites, idle, kWrites } from './programs.ts';

const ID = AC(8);
const FILE = 'tests/acceptance/211/ac8-budgets.test.ts';
useBuilds(['logic']);

const STEPS = 200;
const RUNS = 5;
const TASK = {
  id: 'logic-world-pages', command: ['node', 'benchmarks/canvas.mjs', 'world-pages'], margin: 0.5,
  targets: { moves_8_ms: 0.3, checkpoint_50_ms: 0.1, checkpoint_50_bytes: 2048, idle_work: 0 },
};
const floodPiece = (): JsonObject => piece({
  seed: 211_08,
  items: {
    world: {
      program: flood({ name: 'flood8', moves: 8, last: STEPS - 1, limit: 2047, write: 5 }), writes: floodWrites,
      pages: pagesOf({ max: 2048, slots: 64, moves: 8, lead: 4 }), budget: { memory: 5 }, checkpoint: { every: 10, budget: 1_073_741_824 },
    },
  },
});
const idlePiece = (): JsonObject => piece({ seed: 211_08, items: { idle: { program: idle(), writes: kWrites, checkpoint: { every: 10 } } } });
/** Each step's `pages_ns` of an item, and each of its checkpoints' map fields. */
const pagesNs = (b: Bake, item: string): number[] => b.steps.map((s) => int(s.items[item]!.raw['pages_ns'], `step ${s.step}'s items.${item}.pages_ns`));
function floodRun(bin: string): { ns: number[]; checkpoints: { step: number; changed: number; bytes: number; ns: number }[] } {
  const [reply] = logic([bakeCall(floodPiece(), STEPS)], { bin });
  const b = bakeOf(reply!, STEPS, 'the flood of 8 moves a step');
  return {
    ns: pagesNs(b, 'world'),
    checkpoints: (b.checkpoints['world'] ?? []).filter((c) => c.step >= 30).map((c) => ({
      step: c.step, changed: int(c.raw['map_changed'], `checkpoint ${c.step}'s map_changed`), bytes: int(c.raw['map_bytes'], `checkpoint ${c.step}'s map_bytes`), ns: int(c.raw['map_ns'], `checkpoint ${c.step}'s map_ns`),
    })),
  };
}

describe(`${ID} world pages within their budgets, and no work for an item without them`, () => {
  it(`${ID} 8 moves a step under 0.3 ms of CPU; a checkpoint of 50 changed map entries under 0.1 ms and 2 KB; no work without pages; judged on the reference Mac`, async () => {
    const logicBin = binOf('logic');
    const gaps: string[] = [];

    // 1. The work each clause times, on any machine.
    const f = floodRun(logicBin);
    for (let k = 3; k < STEPS; k++) if (!(f.ns[k]! > 0)) gaps.push(`the flood's step ${k} reads pages_ns ${f.ns[k]}: no time read for its 8 moves`);
    if (f.checkpoints.length !== (STEPS - 30) / 10 + 1) gaps.push(`the flood has ${f.checkpoints.length} checkpoints from 30 to ${STEPS}, not ${(STEPS - 30) / 10 + 1}`);
    for (const c of f.checkpoints) {
      if (c.changed !== 50) gaps.push(`checkpoint ${c.step} holds ${c.changed} changed map entries, not the 50 its 10 steps' write-backs changed`);
      if (!(c.bytes > 0 && c.bytes < 2048)) gaps.push(`checkpoint ${c.step}'s 50 changed map entries add ${c.bytes} bytes, not under 2 KB`);
    }
    const [idleReply] = logic([bakeCall(idlePiece(), 60)], { bin: logicBin });
    const quiet = bakeOf(idleReply!, 60, 'the item without pages');
    pagesNs(quiet, 'idle').forEach((ns, k) => { if (ns !== 0) gaps.push(`the item without pages reads pages_ns ${ns} at step ${k}, not 0`); });
    for (const c of quiet.checkpoints['idle'] ?? []) {
      for (const k of ['map', 'map_changed', 'map_bytes', 'map_ns']) if (c.raw[k] !== undefined && c.raw[k] !== null && c.raw[k] !== 0) gaps.push(`the item without pages' checkpoint ${c.step} carries ${k} ${show(c.raw[k])}`);
    }

    // 2. The record compared with the merge base.
    const budgets = obj(readJson(join(REPO, 'benchmarks', 'budgets.json')), 'benchmarks/budgets.json');
    const task = (Array.isArray(budgets['tasks']) ? budgets['tasks'] : []).filter(isObject).find((t) => t['id'] === TASK.id);
    if (!task) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
    else {
      for (const [k, want] of Object.entries(TASK)) if (show(task[k]) !== show(want as JsonValue)) gaps.push(`${TASK.id}.${k} is ${show(task[k])}, not ${show(want as JsonValue)}`);
      if (!(Array.isArray(task['criteria']) && task['criteria'].includes(CRITERIA[8]))) gaps.push(`${TASK.id}.criteria doesn't name ${CRITERIA[8]}`);
      if (!(typeof task['initialReason'] === 'string' && task['initialReason'].includes('#211'))) gaps.push(`${TASK.id}.initialReason doesn't name #211`);
    }
    const bn = await bench();
    try { bn.validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
    none(gaps, 'what each budget times, and its record');

    // 3. The timings, judged only where the lane can.
    const fingerprint = bn.fingerprint();
    const gate = bn.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint, loads: Array.from({ length: RUNS }, () => ({ start: load(), end: load() })) });
    if (gate.status !== 'PASS') inconclusive(`the timings are judged only on a reference Mac at rest: ${gate.reason ?? gate.status}`);
    const release = binOf('logic-release');
    const read = (): { moves: number; checkpoint: number } => {
      const r = floodRun(release);
      return { moves: median(r.ns.slice(11)) / 1e6, checkpoint: median(r.checkpoints.map((c) => c.ns)) / 1e6 };
    };
    read();
    const runs: { moves: number; checkpoint: number }[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = load();
      runs.push(read());
      loads.push({ start, end: load() });
    }
    const verdicts = [
      ['moves_8_ms', bn.judgeLimit({ limit: TASK.targets.moves_8_ms, runs: runs.map((r) => r.moves), fingerprint, loads })],
      ['checkpoint_50_ms', bn.judgeLimit({ limit: TASK.targets.checkpoint_50_ms, runs: runs.map((r) => r.checkpoint), fingerprint, loads })],
    ] as const;
    const failed = verdicts.filter(([, j]) => j.status === 'FAIL');
    expect(failed.map(([n, j]) => `${n}: ${show(j.runs)} ms, ${j.reason ?? ''}`), 'no budget is over its limit on the reference Mac').toEqual([]);
    const open = verdicts.filter(([, j]) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map(([n, j]) => `${n}: ${j.status}, ${show(j.runs)} ms, ${j.reason ?? ''}`).join('; '));
  }, TIMEOUT * 2);
});
