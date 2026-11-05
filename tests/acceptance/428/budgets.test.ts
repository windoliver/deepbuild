// AC8 #428.d719d951: Budgets, on the reference Mac in the local preflight, compared with the merge base: the castle draws
// in under 10 ms of GPU time per frame full screen on the reference Mac's display at the showpiece's render scale while
// moving, with 64 lamps cut to the 32 that contribute most; building it from its document takes under 500 ms; a still
// scene draws nothing; sheen, anisotropy and translucency on every part of the product fixture add under 1 ms of GPU
// at 1080p.
//
// Test 1, the budgets, by the five-run rule (helpers: `judge`; after a warm-up run; INCONCLUSIVE, never FAIL, when the
// machine's one-minute load is over 1 a core), on a reference Mac (Mac15,7 or Mac15,12; elsewhere INCONCLUSIVE):
// - the castle (`packs/examples/castle.json` in its look, recipes from `packs/composites-1.0.0`, #422's): at frame 0 its
//   `light_cut` shades 32 lights and names at least 64 between shaded and left out; then its orbit, 300 frames at
//   30 fps full screen on this Mac's display at internal scale 0.5 (the showpiece's render scale while moving) with
//   `timings`: each run's p95 `gpu_ms` under 10 ms;
// - building it: a fresh process's `view3d` of the castle with `cold: true`, its `cold.build_ms` under 500 ms;
// - a still scene: the product fixture with nothing moving in #379's `live` for 60 frames: within 8 frames of its first
//   it draws no frame and submits no GPU work (#421's reading);
// - the product fixture (12 parts, each its own material) at 1920 × 1080, orbiting, 120 frames at 60 fps with
//   `timings`, drawn with sheen, anisotropy and translucency on every part and without them, in one process: each run's
//   median with them less the median without, under 1 ms; the warm-up run checks the two frames differ on 1% of pixels.
// Test 2, the merge base: as #1015's and #1017's budgets read it, the perf lane (scripts/benchmark.mjs,
// benchmarks/budgets.json) has a task whose reason names #428, its budgets valid against the merge base's
// (`validateBudgets` against `benchmarks/budgets.json` at the pinned merge base below), and its command runs.
// Wrong programs: lobes paid for by parts that don't use them; a castle over budget or lit by more than 32 lamps; a
// still scene that redraws; a build that compiles or bakes on the critical path.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, REPO, RUNS, SHOW_LOOK, SHOW_SKY, arr, ball, box, camera, frameAt, framesOf, isObject, judge, material, num, obj, percentile,
  readPng, requireReferenceMac, runGpu, sessionDoc, str, sun, useDir, useGpu, view3dCall, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const dir = useDir();
/** The merge base this suite was written on, pinned, so the comparison stays with the pre-#428 renderer after it merges. */
const BASE = '1d3ae6324441b3ff412f6601295fa474434943a4';
const CASTLE = 'packs/examples/castle.json';
const CASTLE_LOOK = 'packs/examples/castle.look.json';
const PACKS = [join(REPO, 'packs', 'composites-1.0.0')];
const HD: [number, number] = [1920, 1080];
const median = (xs: number[]): number => percentile(xs, 50);
const repoJson = (path: string): JsonObject => obj(JSON.parse(readFileSync(join(REPO, path), 'utf8')) as JsonValue, path);

/** The product fixture: 12 parts of a headphone on a stand, each its own material; `lobes` puts all three on each. */
function productDoc(lobes: boolean, moving: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera([0, 0.3, 1.2], [0, 0.2, 0], 35), sky: SHOW_SKY, sun: sun(30_000, [-45, 30, 0]) };
  const parts: [string, JsonObject][] = [
    ['cup_l', ball(0.08, [-0.11, 0.2, 0], '')], ['cup_r', ball(0.08, [0.11, 0.2, 0], '')], ['pad_l', ball(0.06, [-0.085, 0.2, 0], '')], ['pad_r', ball(0.06, [0.085, 0.2, 0], '')],
    ['band', box([0.24, 0.02, 0.04], [0, 0.33, 0], '')], ['slider_l', box([0.015, 0.1, 0.02], [-0.11, 0.28, 0], '')], ['slider_r', box([0.015, 0.1, 0.02], [0.11, 0.28, 0], '')],
    ['stand', box([0.03, 0.3, 0.03], [0, 0.15, -0.06], '')], ['base', box([0.2, 0.02, 0.2], [0, 0.01, -0.06], '')], ['cable', box([0.005, 0.005, 0.3], [0.1, 0.02, 0.1], '')],
    ['table', box([2, 0.02, 2], [0, -0.01, 0], '')], ['card', box([0.15, 0.002, 0.1], [-0.25, 0.001, 0.15], '')],
  ];
  parts.forEach(([id, item], k) => {
    const params: JsonObject = { base_color: [0.2 + 0.05 * k, 0.3, 0.5 - 0.03 * k, 1], metallic: k % 3 === 0 ? 1 : 0, roughness: 0.35 + 0.04 * k };
    if (lobes) Object.assign(params, { sheen: { weight: 1, roughness: 0.5 }, anisotropy: { strength: 0.8, rotation: 15 * k }, translucency: { kind: 'thin', amount: 0.4 } });
    items[`m_${id}`] = material(params);
    items[id] = { ...item, material: `m_${id}` };
  });
  if (moving) items['cam'] = { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.2, 0], orbit: { azimuth: 0, elevation: 15, distance: 1.2 }, fov: 35, near: 0.05, far: 50 } };
  return sessionDoc(`product-${lobes ? 'lobes' : 'plain'}`, HD, items, moving
    ? { channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 360, interp: 'linear' } } } } }
    : {});
}
/** A document as `live` takes it (#379, #421): no session ID or layers. */
function payload(doc: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  delete out['id']; delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}
const castleCall = (extra: JsonObject): JsonObject => {
  const d = repoJson(CASTLE);
  const size = arr(d['size'], `${CASTLE}: size`).map((v, i) => num(v, `${CASTLE}: size[${i}]`)) as [number, number];
  return view3dCall({ doc: join(REPO, CASTLE), look: repoJson(CASTLE_LOOK), size, packs: PACKS, ...(extra as object) });
};

describe(`${ID} the budgets, on the reference Mac`, () => {
  it(`${ID} the castle draws under 10 ms of GPU a frame full screen at render scale 0.5 with 64 lamps cut to 32; it builds in under 500 ms; a still scene draws nothing; the three lobes on every part of the product fixture add under 1 ms at 1080p`, () => {
    const display = requireReferenceMac();
    // The castle's lamps: 32 shaded of at least 64.
    {
      const out = dir();
      const [r] = runGpu(bin(), out, [castleCall({ frames: 1, capture: [], light_cut: true })]);
      const cut = frameAt(framesOf(r!, 'the castle'), 0, 'the castle').lightCut;
      expect(cut, 'the castle\'s frame 0 reports its light cut').not.toBeNull();
      console.log(`${ID}: the castle's light cut shades ${cut!.shaded.length} and leaves out ${cut!.leftOut.length}`);
      expect(cut!.shaded.length, 'the castle shades the 32 lights that contribute most').toBe(32);
      expect(new Set([...cut!.shaded, ...cut!.leftOut]).size, 'the castle has 64 lamps for the cut to choose from').toBeGreaterThanOrEqual(64);
    }
    const castleMs = (): number => {
      const out = dir();
      const [r] = runGpu(bin(), out, [castleCall({ size: display, frames: 300, fps: 30, capture: [], timings: true, surface: { internal_scale: 0.5 } })]);
      const frames = framesOf(r!, 'the timed castle');
      expect(frames.length, 'the timed castle draws 300 frames').toBe(300);
      return percentile(frames.map((f) => { expect(f.gpu_ms, `frame ${f.frame} carries its GPU time`).not.toBeNull(); return f.gpu_ms!; }), 95);
    };
    castleMs();
    judge(`${ID}: the castle's p95 GPU frame time at ${display.join(' × ')}, internal scale 0.5 (ms)`, Array.from({ length: RUNS }, castleMs), 10);

    const buildMs = (): number => {
      const out = dir();
      const [r] = runGpu(bin(), out, [castleCall({ frames: 1, capture: [], cold: true })]);
      return num(obj(r!['cold'], 'the castle\'s cold report')['build_ms'], 'cold.build_ms');
    };
    buildMs();
    judge(`${ID}: building the castle from its document (ms)`, Array.from({ length: RUNS }, buildMs), 500);

    // A still scene draws nothing once settled.
    {
      const out = dir();
      const [r] = runGpu(bin(), out, [{ call: 'live', look: PLAIN_LOOK, frames: 60, fps: 60, report: ['fences'], sessions: [{ session: 's-still', writer: 'agent:sess-428', doc: writeJson(out, 'still', payload(productDoc(true, false))), size: HD }] }]);
      const frames = arr(r!['frames'], 'live: frames').map((v, i) => obj(v, `live: frames[${i}]`));
      const drawn = frames.flatMap((f) => arr(f['views'], 'views').map((v) => obj(v, 'view')).filter((v) => v['session'] === 's-still' && v['drawn'] === true).map(() => num(f['frame'], 'frame')));
      const first = Math.min(...frames.map((f) => num(f['frame'], 'frame')));
      const submits = arr(r!['fences'], 'live: fences').map((v) => obj(v, 'fence')).filter((f) => f['event'] === 'submit' && f['session'] === 's-still' && typeof f['frame'] === 'number').map((f) => f['frame'] as number);
      console.log(`${ID}: the still product draws at frames ${drawn.join(', ')}; submits at ${[...new Set(submits)].join(', ')}`);
      expect(drawn.filter((f) => f < first + 8).length, 'the still scene draws its first frame').toBeGreaterThan(0);
      expect(drawn.filter((f) => f >= first + 8), 'a still scene draws nothing once settled').toEqual([]);
      expect([...new Set(submits.filter((f) => f >= first + 8))], 'a still scene submits no GPU work once settled').toEqual([]);
    }

    let checked = false;
    const lobesMs = (): number => {
      const out = dir();
      const calls = [true, false].map((lobes) => view3dCall({ doc: writeJson(out, `product-${lobes}`, productDoc(lobes, true)), look: SHOW_LOOK, size: HD, frames: 120, fps: 60, capture: checked ? [] : [0], targets: ['final'], timings: true }));
      const [a, b] = runGpu(bin(), out, calls).map((r, i) => framesOf(r, i === 0 ? 'with the lobes' : 'without them'));
      if (!checked) {
        const [pa, pb] = [a!, b!].map((fs, i) => readPng(out, frameAt(fs, 0, `product ${i}`).final, `product ${i}`));
        let changed = 0;
        for (let k = 0; k < pa!.rgba.length; k += 4) if (Math.abs(pa!.rgba[k]! - pb!.rgba[k]!) + Math.abs(pa!.rgba[k + 1]! - pb!.rgba[k + 1]!) + Math.abs(pa!.rgba[k + 2]! - pb!.rgba[k + 2]!) > 6) changed++;
        expect(changed / (HD[0] * HD[1]), 'the lobes change at least 1% of the product fixture\'s pixels, so the timed draws differ').toBeGreaterThanOrEqual(0.01);
        checked = true;
      }
      const ms = (fs: typeof a): number => median(fs!.map((f) => { expect(f.gpu_ms, `frame ${f.frame} carries its GPU time`).not.toBeNull(); return f.gpu_ms!; }));
      return ms(a) - ms(b);
    };
    lobesMs();
    judge(`${ID}: sheen, anisotropy and translucency on every part of the product fixture at 1080p, added GPU time (ms)`, Array.from({ length: RUNS }, lobesMs), 1);
  }, 7_200_000);

  it(`${ID} the perf lane has a task naming #428, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as JsonObject;
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${BASE}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = arr(current['tasks'], 'budgets.json: tasks').map((t, i) => obj(t, `tasks[${i}]`));
    const task = tasks.find((t) => /#428\b/.test(`${isObject(t) ? String(t['initialReason'] ?? '') : ''} ${String(t['changeReason'] ?? '')}`));
    expect(task, 'benchmarks/budgets.json must have a task whose reason names issue #428, timing the castle and the lobes against the merge base').toBeDefined();
    const [cmd, ...args] = arr(task!['command'], 'the task\'s command').map((c, i) => str(c, `command[${i}]`));
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000 });
    expect(r.status, `${[cmd, ...args].join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 3_700_000);
});
