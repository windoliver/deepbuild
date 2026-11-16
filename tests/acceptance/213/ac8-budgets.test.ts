// AC8 #213.16543e66: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 256 rays in a
// level of 300 static shapes are answered in under 1.3 ms of CPU; a mirror of a 1,000,000-element f64 array whose
// writer changed 1% in 64 runs costs under 0.1 ms a step; and an item without services or mirrors gains no work"
//
// One timed test, in parts, as #538's budgets are judged (README: Criterion 8):
//   1. On any machine, debug builds, guarded so what is timed is the clause's work: `volley` asks 256 rays every step in
//      a level of 300 static boxes and reads 256 answers, each with a hit, with each step's `service_ns`; `reader8`
//      mirrors `bulk`'s 1,000,000 f64, whose 10,000 changed elements a step lie in 64 runs, its list counting 64, with
//      each step's `mirror_ns`; `ticker`, with neither services nor mirrors, shows 0 of both at every step and the same
//      fuel in deep-show's run as in deep-logic's bake of it alone.
//   2. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's task
//      `logic-between-steps`, valid by the lane's validator, and scripts/lanes.mjs runs this file as a timed one.
//   3. Only where the lane can judge (a reference Mac at rest, else INCONCLUSIVE before anything is timed): release
//      builds, a warm-up run and five, each run's medians judged by scripts/benchmark.mjs's judgeLimit.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, REPO, TIMEOUT, bakeCall, bakeSteps, bench, binOf, box, checkCall, handleOf, inconclusive, int, isObject, ints, layoutOf,
  load, logic, logicCall, median, none, obj, one, perItem, piece, presented, readEntry, readJson, runShow, scenario, sceneDoc, show, showCall,
  showSteps, useBuilds, useTemp, world, type Handles, type JsonObject, type JsonValue, type LogicItem, type Vec3,
} from './helpers.ts';
import { castParams, probeHandles } from './fixtures.ts';
import { bulk, reader8, requestsOf, ticker, volley } from './programs.ts';

const ID = CRITERIA[8];
const FILE = 'tests/acceptance/213/ac8-budgets.test.ts';
useBuilds(['show', 'logic']);
const temp = useTemp();

const LEVEL = 'level';
const RAYS = 256;
const SHOW_STEPS = 60;
const LOGIC_STEPS = 64;
const RUNS = 5;
const TASK = {
  id: 'logic-between-steps', command: ['node', 'benchmarks/canvas.mjs', 'between-steps'], margin: 0.5,
  targets: { cast_256_ms: 1.3, mirror_1pct_ms: 0.1, idle_work: 0 },
};

/**
 * The level: 296 pillars (0.4 × 2 × 0.4 m boxes, at seeded places within 20 m of the origin and at least 1.5 m from it)
 * and 4 walls closing a 44 m square, 300 static shapes in all, one a body.
 */
function levelWorld(): JsonObject {
  let a = 2131;
  const next = (): number => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4_294_967_296; };
  const bodies: JsonObject = {};
  for (let i = 0; i < 296;) {
    const x = -20 + 40 * next();
    const z = -20 + 40 * next();
    if (Math.hypot(x, z) < 1.5) continue;
    bodies[`p${String(i).padStart(3, '0')}`] = { kind: 'static', shapes: [{ shape: 'pillar', contact_material: 'stone' }], pose: { pos: [x, 1, z] } };
    i++;
  }
  for (const [id, shape, pos] of [['w_n', 'ns', [0, 1, 22]], ['w_s', 'ns', [0, 1, -22]], ['w_e', 'ew', [22, 1, 0]], ['w_w', 'ew', [-22, 1, 0]]] as const) {
    bodies[id] = { kind: 'static', shapes: [{ shape, contact_material: 'stone' }], pose: { pos: [...pos] } };
  }
  return world({
    capacity: { bodies: 320, shapes: 320, joints: 0, contacts: 64, particles: 0 },
    contact_materials: { stone: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { pillar: box([0.2, 1, 0.2]), ns: box([23, 2, 0.5]), ew: box([0.5, 2, 23]) },
    bodies,
  });
}
const levelScene = (evidence: string, logicItems: Record<string, LogicItem>): JsonObject =>
  sceneDoc(evidence, { title: 'Volley level', span: '2s', worlds: { [LEVEL]: levelWorld() }, logic: logicItems });
/** volley's 256 rays from (0, 1, 0), level, spread evenly around the circle, 100 m, every group. */
function volleyRays(h: Handles): Buffer {
  const w = handleOf(h, LEVEL, null, 'the level');
  return requestsOf(Array.from({ length: RAYS }, (_, i) => {
    const t = (2 * Math.PI * i) / RAYS;
    return { world: w, groups: -1, max: 100, from: [0, 1, 0] as Vec3, dir: [Math.cos(t), 0, Math.sin(t)] as Vec3 };
  }));
}
/** The volley's run: each step's answers, hits, service time and fuel. */
function volleyRun(bin: string, rays: Buffer, evidence: string): { answered: number[]; hits: number[]; ns: number[]; fuel: number[] } {
  const doc = DOC(81);
  const scene = levelScene(evidence, { volley: { program: volley(rays, 'level'), params: castParams(RAYS, { writes: { answered: { type: 'i32' }, hits: { type: 'i32' } }, budget: { fuel: 2_000_000 } }) } });
  const [shown, ran] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, SHOW_STEPS)]), 'the volley');
  presented(shown, 'the volley');
  const steps = showSteps(ran, SHOW_STEPS, 'the volley');
  const of = (s: JsonObject, field: string): number => int(perItem(s, field, 'volley', 'the volley'), `the volley: step ${String(s['step'])}'s ${field}.volley`);
  return {
    answered: steps.map((s) => one(s, 'volley.answered', 'the volley')), hits: steps.map((s) => one(s, 'volley.hits', 'the volley')),
    ns: steps.map((s) => of(s, 'service_ns')), fuel: steps.map((s) => of(s, 'fuel')),
  };
}
/** bulk and its mirror reader, the reader's list count copied out: each step's count and the reader's mirror time. */
function bulkPiece(listAt: number): JsonObject {
  return piece({
    seed: 213,
    items: {
      bulk: { program: bulk(), writes: { vals: { type: 'f64', count: 1_000_000 } }, budget: { memory: 8 } },
      reader8: { program: reader8(listAt), writes: { ranges: { type: 'i32' } }, mirrors: [{ array: 'bulk.vals', at: 'vals_at' }], budget: { memory: 8 } },
    },
  });
}
function bulkRun(bin: string): { ranges: number[]; ns: number[] } {
  const [checked] = logic([checkCall(bulkPiece(0))], { bin });
  const listAt = readEntry(layoutOf(checked!, 'reader8', 'the bulk piece'), 'bulk.vals', 'ranges', 'reader8').offset;
  const [baked] = logic([bakeCall(bulkPiece(listAt), LOGIC_STEPS, { arrays: ['reader8.ranges'] })], { bin });
  const steps = bakeSteps(baked!, LOGIC_STEPS, 'the bulk mirror');
  return {
    ranges: steps.map((s) => ints(s.arrays['reader8.ranges'], `step ${s.step}: reader8.ranges`)[0]! >>> 0),
    ns: steps.map((s) => int(s.items['reader8']?.['mirror_ns'], `the bulk mirror: step ${s.step}'s items.reader8.mirror_ns`)),
  };
}

describe(`${ID} between-step services and mirrors within their budgets, and no work for an item that has neither`, () => {
  it(`${ID} 256 rays in a level of 300 static shapes answered in under 1.3 ms of CPU; a 1% mirror of 1,000,000 f64 in 64 runs under 0.1 ms a step; no work without services or mirrors; judged on the reference Mac`, async () => {
    const showBin = binOf('show');
    const logicBin = binOf('logic');
    const gaps: string[] = [];

    // 1. The work each clause times, on any machine.
    const evidence = temp();
    const h = probeHandles(showBin, evidence, (items) => levelScene(evidence, items), 'the level');
    const rays = volleyRays(h);
    const v = volleyRun(showBin, rays, evidence);
    for (let k = 1; k < SHOW_STEPS; k++) {
      if (v.answered[k] !== RAYS) gaps.push(`volley's step ${k} reads ${v.answered[k]} answers, not ${RAYS}`);
      if (v.hits[k]! < RAYS) gaps.push(`volley's step ${k} reads ${v.hits[k]} hits over ${RAYS} rays inside four walls`);
      if (v.fuel[k]! < RAYS * 4000) gaps.push(`volley's step ${k} paid ${v.fuel[k]} fuel, under the 4,000 × ${RAYS} its requests charge it`);
    }
    for (let k = 0; k < SHOW_STEPS - 1; k++) if (!(v.ns[k]! > 0)) gaps.push(`step ${k}'s service_ns.volley is ${v.ns[k]}: no time read for answering its ${RAYS} rays`);

    const b = bulkRun(logicBin);
    for (let k = 1; k < LOGIC_STEPS; k++) {
      if (b.ranges[k] !== 64) gaps.push(`reader8's step ${k} lists ${b.ranges[k]} ranges, not bulk's 64 runs`);
      if (!(b.ns[k]! > 0)) gaps.push(`step ${k}'s mirror_ns of reader8 is ${b.ns[k]}: no time read for its mirror`);
    }

    const idle = DOC(82);
    const items = { ticker: { program: ticker(), params: { writes: { n: { type: 'i32' } } } } };
    const [shown, ran] = runShow(showBin, scenario(evidence, [idle], [showCall(idle, sceneDoc(evidence, { title: 'Idle', span: '2s', logic: items })), logicCall(idle, 30)]), 'the idle item');
    presented(shown, 'the idle item');
    const idleSteps = showSteps(ran, 30, 'the idle item');
    const [alone] = logic([bakeCall(piece({ seed: 213, items: { ticker: { program: ticker(), writes: { n: { type: 'i32' } } } } }), 30)], { bin: logicBin });
    const aloneSteps = bakeSteps(alone!, 30, 'the ticker alone');
    idleSteps.forEach((s, k) => {
      for (const field of ['service_ns', 'mirror_ns']) {
        const x = perItem(s, field, 'ticker', 'the idle item');
        if (x !== 0) gaps.push(`the idle item's step ${k} reads ${field} ${show(x)}, not 0`);
      }
      const fuel = int(perItem(s, 'fuel', 'ticker', 'the idle item'), `the idle item's step ${k} fuel`);
      const own = int(aloneSteps[k]!.items['ticker']?.['fuel'], `deep-logic's ticker step ${k} fuel`);
      if (fuel !== own) gaps.push(`the idle item's step ${k} pays ${fuel} fuel beside no world, deep-logic's bake of it ${own}`);
      if (aloneSteps[k]!.items['ticker']?.['mirror_ns'] !== 0) gaps.push(`deep-logic's ticker step ${k} reads mirror_ns ${show(aloneSteps[k]!.items['ticker']?.['mirror_ns'])}, not 0`);
    });

    // 2. The record compared with the merge base.
    const budgets = obj(readJson(join(REPO, 'benchmarks', 'budgets.json')), 'benchmarks/budgets.json');
    const task = (Array.isArray(budgets['tasks']) ? budgets['tasks'] : []).filter(isObject).find((t) => t['id'] === TASK.id);
    if (!task) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
    else {
      for (const [k, want] of Object.entries(TASK)) if (show(task[k]) !== show(want as JsonValue)) gaps.push(`${TASK.id}.${k} is ${show(task[k])}, not ${show(want as JsonValue)}`);
      if (!(Array.isArray(task['criteria']) && task['criteria'].includes(ID))) gaps.push(`${TASK.id}.criteria doesn't name ${ID}`);
      if (!(typeof task['initialReason'] === 'string' && task['initialReason'].includes('#213'))) gaps.push(`${TASK.id}.initialReason doesn't name #213`);
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
    const showRelease = binOf('show-release');
    const logicRelease = binOf('logic-release');
    const read = (): { cast: number; mirror: number } => {
      const ev = temp();
      const hh = probeHandles(showRelease, ev, (it) => levelScene(ev, it), 'the level, release');
      const run = volleyRun(showRelease, volleyRays(hh), ev);
      const m = bulkRun(logicRelease);
      return { cast: median(run.ns.slice(0, SHOW_STEPS - 1)) / 1e6, mirror: median(m.ns.slice(1)) / 1e6 };
    };
    read();
    const runs: { cast: number; mirror: number }[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = load();
      runs.push(read());
      loads.push({ start, end: load() });
    }
    const verdicts = [
      ['cast_256_ms', bn.judgeLimit({ limit: TASK.targets.cast_256_ms, runs: runs.map((r) => r.cast), fingerprint, loads })],
      ['mirror_1pct_ms', bn.judgeLimit({ limit: TASK.targets.mirror_1pct_ms, runs: runs.map((r) => r.mirror), fingerprint, loads })],
    ] as const;
    const failed = verdicts.filter(([, j]) => j.status === 'FAIL');
    expect(failed.map(([n, j]) => `${n}: ${show(j.runs)} ms, ${j.reason ?? ''}`), 'no budget is over its limit on the reference Mac').toEqual([]);
    const open = verdicts.filter(([, j]) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map(([n, j]) => `${n}: ${j.status}, ${show(j.runs)} ms, ${j.reason ?? ''}`).join('; '));
  }, TIMEOUT * 2);
});
