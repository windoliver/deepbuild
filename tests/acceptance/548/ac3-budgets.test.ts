// #548.154ef157: Budgets, on the reference Mac in the local preflight, compared with the merge base: an idle item on the
// turn clock adds no work per frame; 64 occurrence rows add under 0.05 ms to a step; drawing 1,000 vec3 elements of a
// linear write adds under 0.1 ms a frame; a preview of a 4 MiB state takes under 1 ms; a checkpoint of 3 written pages
// of a 32 MiB memory takes under 0.5 ms; and a piece that uses none of these gains no work per frame
//
// README: Criterion 3. Counters, judged on any machine: the frames of an idle turn-clock item and of a piece that uses
// none of these run no preview and blend nothing (`previews`, `blends`) and run the steps the merge base's frames run;
// `benchmarks/budgets.json` holds a task naming this criterion with its four limits (docs/parallel-proof.md §12a: a
// budget in the local preflight is met by the budget window's record once a task names the criterion). Timings,
// judged with `judgeLimit` on `fingerprint()` from scripts/benchmark.mjs: off a reference Mac at rest they are
// INCONCLUSIVE, never a pass; each is guarded first, on any machine, so it times the clause's work.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMITS_64, EMIT_ROWS, PAGES3_WRITTEN, SWARM, big, emitter, idle, pages3, plain, swarm } from './programs.ts';
import { SEED } from './fixtures.ts';
import {
  AC, REPO, TIMEOUT, arr, baseLogicBin, bakeCall, bakeOf, bench, cores, inconclusive, int, live, load, logic, logicBin, median, none, obj,
  openView, piece, prebuild, show, type Act, type Frame, type JsonObject, type Judged, type Live, type EmitsSpec,
} from './helpers.ts';

prebuild(() => { logicBin(); });
const FRAMES = 120;

/** The frames of a view of `p` played a frame at a time, with each frame's act. */
async function frames(l: Live, p: JsonObject, count: number, act: (n: number) => Act = () => ({ play: true })): Promise<Frame[]> {
  const v = await openView(l, p, 5);
  const out: Frame[] = [];
  for (let n = 1; n <= count; n++) out.push((await v.frame(act(n))).landed);
  return out;
}
async function framesOn(p: JsonObject, count: number, bin?: string): Promise<Frame[]> {
  const l = live([], bin);
  try { return await frames(l, p, count); } finally { l.stop(); }
}
const idlePiece = (): JsonObject => piece({ seed: SEED, controls: { tap: 'slider' }, items: { idle: { program: idle(), reads: ['tap'], writes: { n: { type: 'i32' } }, clock: 'on_input' } } });
const plainPiece = (): JsonObject => piece({ seed: SEED, items: { plain: { program: plain(), writes: { x: { type: 'f64' } } } } });
/** Each frame's work counters against the merge base's frames of the same piece: no preview, no blend, the same steps. */
function sameWork(change: Frame[], base: Frame[], what: string): string[] {
  const failures: string[] = [];
  for (const [i, f] of change.entries()) {
    if (f.previews !== 0) failures.push(`${what}, frame ${i + 1}: previews ${show(f.previews)}, not 0`);
    if (f.blends !== 0) failures.push(`${what}, frame ${i + 1}: blends ${show(f.blends)}, not 0`);
    const b = base[i];
    if (b && f.steps !== b.steps) failures.push(`${what}, frame ${i + 1}: ${f.steps} steps run, where the merge base runs ${b.steps}`);
  }
  return failures;
}

describe(`${AC[3]} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC[3]} an idle item on the turn clock adds no work per frame: no step after step 0, no preview, no blend, as the merge base`, async () => {
    const change = await framesOn(idlePiece(), FRAMES);
    expect(change[0]!.steps, 'the first frame runs step 0').toBe(1);
    const failures = change.slice(1).flatMap((f, i) => (f.steps === 0 ? [] : [`frame ${i + 2}: ${f.steps} steps run by an idle item`]));
    failures.push(...sameWork(change, [], 'the idle turn-clock item'));
    none(failures, 'the idle item\'s frames');
    const base = baseLogicBin();
    none(sameWork(change, await framesOn(idlePiece(), FRAMES, base.bin), 'the idle turn-clock item'), `the idle item's frames against the merge base ${base.sha.slice(0, 12)}`);
  }, TIMEOUT);

  it(`${AC[3]} a piece that uses none of these gains no work per frame against the merge base`, async () => {
    const change = await framesOn(plainPiece(), FRAMES);
    none(sameWork(change, [], 'the plain piece'), 'the plain piece\'s frames');
    const base = baseLogicBin();
    const was = await framesOn(plainPiece(), FRAMES, base.bin);
    const failures = sameWork(change, was, 'the plain piece');
    change.forEach((f, i) => { const k = Object.keys(f.draws).sort().join(', '); const b = Object.keys(was[i]?.draws ?? {}).sort().join(', '); if (k !== b) failures.push(`the plain piece, frame ${i + 1}: it draws ${k}, where the merge base draws ${b}`); });
    none(failures, `the plain piece's frames against the merge base ${base.sha.slice(0, 12)}`);
  }, TIMEOUT);

  it(`${AC[3]} benchmarks/budgets.json holds a task naming this criterion with its four limits, so the budget window measures it against the merge base`, async () => {
    const b = await bench();
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    expect(() => b.validateBudgets(budgets, undefined), 'the lane accepts benchmarks/budgets.json').not.toThrow();
    const tasks = arr(budgets['tasks'], 'budgets.tasks').map((t, i) => obj(t, `budgets.tasks[${i}]`));
    const task = tasks.find((t) => Array.isArray(t['criteria']) && t['criteria'].includes(AC[3]));
    expect(task, `a budgets.json task's criteria name ${AC[3]}`).toBeDefined();
    expect(arr(task!['command'], 'the task\'s command')[0], 'the task runs a node benchmark').toBe('node');
    expect(task!['targets'], 'the task\'s targets: the criterion\'s four limits (README: Criterion 3)').toMatchObject({ occurrences_64_ms: 0.05, linear_1000_vec3_ms: 0.1, preview_4mib_ms: 1, checkpoint_3_pages_ms: 0.5 });
  }, TIMEOUT);

  it(`${AC[3]} 64 occurrence rows under 0.05 ms a step, 1,000 linear vec3 elements under 0.1 ms a frame, a 4 MiB preview under 1 ms, a checkpoint of 3 written pages of 32 MiB under 0.5 ms`, async () => {
    // Guards, on any machine, so each timing times the clause's work.
    // The one kind's count and rows start the emit region (Logic: occurrences: each kind in declaration order).
    const hitAt = 0;
    const shots = (rows: number): JsonObject => piece({ seed: SEED, items: { shots: { program: emitter(rows, hitAt), writes: { k: { type: 'i32' } }, emits: EMITS_64 as unknown as EmitsSpec } } });
    const [b64, b0] = logic([bakeCall(shots(EMIT_ROWS), 60), bakeCall(shots(0), 60)]);
    expect(bakeOf(b64!, 'the emitter\'s bake').occurrences['shots']?.length, '64 rows a step for 60 steps').toBe(EMIT_ROWS * 60);
    expect(bakeOf(b0!, 'its twin\'s bake').occurrences['shots']?.length ?? 0, 'its twin, the same stores, emits none').toBe(0);
    const swarmPiece = (interpolate: 'linear' | 'hold'): JsonObject => piece({ seed: SEED, items: { swarm: { program: swarm(), step_rate: 10, writes: { pos: { type: 'vec3', count: SWARM, interpolate } } } } });
    const lin = await framesOn(swarmPiece('linear'), 30);
    const hold = await framesOn(swarmPiece('hold'), 30);
    none([...lin.slice(6).flatMap((f, i) => (f.blends === SWARM ? [] : [`linear, frame ${i + 7}: blends ${show(f.blends)}, not 1,000`])), ...hold.flatMap((f, i) => (f.blends === 0 ? [] : [`hold, frame ${i + 1}: blends ${show(f.blends)}, not 0`]))], 'the swarm\'s blends');
    const bigPiece = piece({ seed: SEED, controls: { place: 'point' }, items: { big: { program: big(), writes: { k: { type: 'i32' } }, preview: { reads: ['place.hover'], writes: { seen: { type: 'i32' } } } } } });
    const toggle = (n: number): Act => (n === 1 ? { play: true } : { hover: { place: n % 2 ? [3, 4] : [5, 6] } });
    const lb = live();
    let previews: Frame[];
    let stills: Frame[];
    try {
      previews = await frames(lb, bigPiece, 9, toggle);
      const v = await openView(lb, bigPiece, 5);
      await v.frame({ play: true, hover: { place: [3, 4] } });
      stills = [];
      for (let n = 0; n < 8; n++) stills.push((await v.frame({})).landed);
    } finally { lb.stop(); }
    none([...previews.slice(1).flatMap((f, i) => (f.previews === 1 && f.steps === 0 ? [] : [`a hover change, frame ${i + 2}: previews ${show(f.previews)}, steps ${f.steps}`])),
      ...stills.flatMap((f, i) => (f.previews === 0 && f.steps === 0 ? [] : [`a still frame ${i + 1}: previews ${show(f.previews)}, steps ${f.steps}`]))], 'the 4 MiB preview\'s frames');
    const pagesPiece = piece({ seed: SEED, items: { pages3: { program: pages3(), writes: { sum: { type: 'i32' } }, budget: { memory: 32 }, checkpoint: { every: 60, budget: 256 * 1024 * 1024 } } } });
    const ringOf = (reply: JsonObject): { step: number; whole: boolean; pages: number[]; ns: number | null }[] => {
      const ring = obj(obj(reply['ring'], 'the bake\'s ring (#547)')['pages3'], 'ring.pages3');
      return arr(ring['checkpoints'], 'ring.pages3.checkpoints').map((k, i) => {
        const o = obj(k, `ring checkpoint ${i}`);
        return { step: int(o['step'], `ring checkpoint ${i}.step`), whole: o['whole'] === true, pages: arr(o['pages'], `ring checkpoint ${i}.pages`).map((p) => Number(p)), ns: typeof o['ns'] === 'number' ? o['ns'] : null };
      });
    };
    const kept = ringOf(logic([bakeCall(pagesPiece, 480)])[0]!).filter((k) => !k.whole);
    expect(kept.length, 'the 480-step bake keeps checkpoints of written pages').toBeGreaterThan(0);
    none(kept.flatMap((k) => [...(JSON.stringify(k.pages) === JSON.stringify(PAGES3_WRITTEN) ? [] : [`checkpoint ${k.step}: pages ${show(k.pages)}, not the 3 written`]), ...(k.ns !== null && k.ns > 0 ? [] : [`checkpoint ${k.step}: no store time (ns ${show(k.ns)})`])]), 'the 32 MiB item\'s checkpoints of 3 written pages');

    // The timings: only on a reference Mac at rest, on release builds (README: Criterion 3's timings).
    const { fingerprint, judgeLimit } = await bench();
    const machine = fingerprint();
    const gate = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: machine, loads: Array.from({ length: 5 }, () => ({ start: load(), end: load() })) });
    if (gate.status !== 'PASS') inconclusive(`the timings aren't taken here: ${gate.reason ?? gate.status} (machine ${show(machine, 300)}, load ${load().toFixed(1)} on ${cores()} cores); every guard above passed`);
    const bin = logicBin(true);
    const readings = { occurrences_64_ms: [] as number[], linear_1000_vec3_ms: [] as number[], preview_4mib_ms: [] as number[], checkpoint_3_pages_ms: [] as number[] };
    const loads: { start: number; end: number }[] = [];
    for (let run = 0; run <= 5; run++) {
      const start = load();
      const l = live([], bin);
      try {
        // 64 rows: 600 steps of the emitter against its twin, alternated, in sessions of their own (#531's open and step).
        const per = async (rows: number): Promise<number> => {
          const o = await l.call({ call: 'open', piece: shots(rows), track: [] });
          const s = String(o['session']);
          await l.call({ call: 'step', session: s, to: 59 });
          const { ms } = await l.timed({ call: 'step', session: s, to: 659 });
          return ms / 600;
        };
        const occ = [await per(EMIT_ROWS) - await per(0), await per(EMIT_ROWS) - await per(0), await per(EMIT_ROWS) - await per(0)];
        // 1,000 linear vec3 elements: 60 frames each, linear against hold.
        const frameMs = async (p: JsonObject): Promise<number> => {
          const v = await openView(l, p, 5);
          const ms: number[] = [];
          for (let n = 0; n < 60; n++) { const t0 = performance.now(); await v.frame({ play: true }); ms.push(performance.now() - t0); }
          return median(ms);
        };
        const linear = await frameMs(swarmPiece('linear')) - await frameMs(swarmPiece('hold'));
        // The 4 MiB preview: hover changes against still frames, no step either way.
        const v = await openView(l, bigPiece, 5);
        await v.frame({ play: true });
        const change: number[] = []; const still: number[] = [];
        for (let n = 0; n < 40; n++) {
          let t0 = performance.now(); await v.frame({ hover: { place: n % 2 ? [3, 4] : [5, 6] } }); change.push(performance.now() - t0);
          t0 = performance.now(); await v.frame({}); still.push(performance.now() - t0);
        }
        // The checkpoint: its store time as the ring reports it (README: the ring's `ns`).
        const ring = ringOf(await l.call(bakeCall(pagesPiece, 480))).filter((k) => !k.whole);
        if (run > 0) {
          readings.occurrences_64_ms.push(Math.max(0, median(occ)));
          readings.linear_1000_vec3_ms.push(Math.max(0, linear));
          readings.preview_4mib_ms.push(Math.max(0, median(change) - median(still)));
          readings.checkpoint_3_pages_ms.push(median(ring.map((k) => (k.ns ?? Number.NaN) / 1e6)));
          loads.push({ start, end: load() });
        }
      } finally { l.stop(); }
    }
    const limits = { occurrences_64_ms: 0.05, linear_1000_vec3_ms: 0.1, preview_4mib_ms: 1, checkpoint_3_pages_ms: 0.5 };
    const judged: [string, Judged][] = Object.entries(limits).map(([k, limit]) => [k, judgeLimit({ limit, runs: readings[k as keyof typeof readings], fingerprint: machine, loads })]);
    console.log(`${AC[3]} timings:\n  ${judged.map(([k, j]) => `${k}: ${j.status} (limit ${j.limit}, runs ${j.runs.map((x) => x.toFixed(4)).join(', ')}${j.reason ? `; ${j.reason}` : ''})`).join('\n  ')}`);
    const failed = judged.filter(([, j]) => j.status === 'FAIL' || j.status === 'BLOCKED');
    expect(failed.map(([k, j]) => `${k}: ${j.reason ?? j.status}`), 'no timing is over its limit').toEqual([]);
    const open = judged.filter(([, j]) => j.status !== 'PASS');
    if (open.length) inconclusive(`readings neither all within nor all over: ${open.map(([k, j]) => `${k} (${j.reason ?? j.status})`).join('; ')}`);
  }, TIMEOUT);
});
