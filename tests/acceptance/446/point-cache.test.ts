// AC2 #446.1a955ffe: A point light's shadow map is reused while the light and every item meeting its range are unchanged,
// so a still interior issues no shadow passes, and an item entering the range invalidates it.
//
// Reuse. A closed room with a table under one shadowed point lamp of range 3.2 m, `shadowed: {points: 1}`, the cache at
// its default `static`; a crate and a visitor stand 30 m away, outside the range. Eight frames, by patches: frame 3 the
// visitor walks in beside the table, frame 6 the crate moves far outside the range, frame 7 the lamp moves 0.3 m. The
// map draws at frames 0, 3 and 7, six passes each (one a cube face), and no other frame issues a pass: the report's
// `shadows.passes`, each map's `drawn`, and the GPU timer's passes all agree. The same document at `cache: none` draws
// six passes every frame and, a clean rebuild each time, equals the cached run on every frame's pixel hash. Wrong
// programs: a map redrawn every frame (the `none` run must fail the reuse check, naming "still"); `--planted
// local_map_stale`, a map keyed by the light alone, fails naming frame 3.
//
// The proof line: the house by day and at night with per-pass GPU timings, and each cached map equal to a clean rebuild.
// Three still frames of each (helpers: houseDoc): frame 0 draws its maps and its timer reports the shadow passes and
// the geometry, printed; frames 1 and 2 issue none; frame 2 equals a fresh process opening there, by pixel hash. By day
// the glazed window under `shadow: auto` lets the sun through: from inside, the floor in the pool reads ρ E cos θ ÷ π
// within 2% on at least 500 pixels, and the same window under `shadow: cast` leaves them dark (the wrong program).
import { describe, expect, it } from 'vitest';
import {
  AGENT, AC, DARK_SKY, HOUSE, box, camera, dot, failsNaming, frameAt, framesOf, hashOf, houseDoc, inSunPool, matte, none, only, point, readLinear, rayAt, requireMetal, runGpu, sessionDoc,
  set, shadowTimers, shadowsOf, towardSun, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject, type Patch, type Pinhole, type V3, type ViewFrame,
} from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 320];
const FRAMES = 8;
const DRAWN = [0, 3, 7];
const FACES = 6;

function interiorDoc(cache: 'static' | 'none'): JsonObject {
  const grey = { material: 'grey' };
  return sessionDoc(`interior-${cache}`, SIZE, {
    cam: camera([-2.4, 1.9, 2.1], [0.6, 0.4, -0.3], 60), sky: DARK_SKY, grey: matte(0.8),
    floor: box([6.4, 0.2, 5.4], [0, -0.1, 0], grey), roof: box([6.4, 0.2, 5.4], [0, 2.9, 0], grey),
    wall_w: box([0.2, 2.8, 5.4], [-3.1, 1.4, 0], grey), wall_e: box([0.2, 2.8, 5.4], [3.1, 1.4, 0], grey),
    wall_n: box([6.4, 2.8, 0.2], [0, 1.4, -2.6], grey), wall_s: box([6.4, 2.8, 0.2], [0, 1.4, 2.6], grey),
    table: box([1.2, 0.7, 0.8], [0.4, 0.35, -0.4], grey),
    crate: box([1, 1, 1], [30, 0.5, 0], grey), visitor: box([0.5, 1.2, 0.5], [30, 0.6, 5], grey),
    lamp: point(119, [0, 2.2, 0], { shadow: true, range: 3.2, radius: 0.02 }),
  }, { light_policy: { shadowed: { points: 1 }, cache } });
}
const PATCHES: Patch[] = [
  { frame: 3, writer: AGENT, ops: [set('visitor', 'at/pos', [-0.9, 0.6, 0.3])] },
  { frame: 6, writer: AGENT, ops: [set('crate', 'at/pos', [34, 0.5, 2])] },
  { frame: 7, writer: AGENT, ops: [set('lamp', 'at/pos', [0.3, 2.2, 0])] },
];
function run(cache: 'static' | 'none', planted?: GpuPlanted): ViewFrame[] {
  const out = dir();
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `interior-${cache}`, interiorDoc(cache)), size: SIZE, frames: FRAMES, capture: 'every', targets: ['final'], patches: PATCHES, shadows: true, timings: true })], planted);
  return framesOf(reply!, `the interior at cache ${cache}`);
}
/** The map draws at DRAWN frames and only there, by the report and by the GPU's own timer. */
function reuseProblems(frames: ViewFrame[]): string[] {
  const out: string[] = [];
  for (let n = 0; n < FRAMES; n++) {
    const f = frameAt(frames, n, 'the interior');
    const s = shadowsOf(f, 'the interior');
    const want = DRAWN.includes(n);
    const map = s.maps.find((m) => m.light === 'lamp');
    const where = want ? 'a frame with a change' : 'a still frame';
    if (!map) { out.push(`${where}: frame ${n} reports no map for the lamp`); continue; }
    if (map.drawn !== want) out.push(`${where}: frame ${n}'s map drawn is ${map.drawn}`);
    if (s.passes !== (want ? FACES : 0)) out.push(`${where}: frame ${n} issued ${s.passes} shadow passes`);
    const timed = shadowTimers(f, 'the interior');
    if ((timed.length > 0) !== want) out.push(`${where}: frame ${n}'s GPU timer saw [${timed.join(', ')}]`);
  }
  return out;
}
function cleanProblems(cached: ViewFrame[], clean: ViewFrame[]): string[] {
  const out: string[] = [];
  for (let n = 0; n < FRAMES; n++) {
    if (hashOf(frameAt(cached, n, 'the cached run'), 'the cached run') !== hashOf(frameAt(clean, n, 'the clean run'), 'the clean run')) out.push(`frame ${n} of the cached run differs from the clean rebuild`);
  }
  return out;
}
/** The house: still frames issue no pass, frame 2 equals a fresh process there; the timings printed. */
function houseProblems(mode: 'day' | 'night'): string[] {
  const out = dir();
  const look = mode === 'day' ? HOUSE.dayLook : HOUSE.nightLook;
  const doc = writeJson(out, `house-${mode}`, houseDoc(mode));
  const call = { doc, look, size: HOUSE.size, targets: ['final' as const] };
  const [cached] = runGpu(bin(), out, [view3dCall({ ...call, frames: 3, capture: 'every', shadows: true, timings: true })]);
  const [clean] = runGpu(bin(), out, [view3dCall({ ...call, from: 2, capture: [2] })]);
  const frames = framesOf(cached!, `the house ${mode}`);
  const problems: string[] = [];
  const first = frameAt(frames, 0, `the house ${mode}`);
  console.log(`${ID}: the house by ${mode}, frame 0: ${first.gpu_ms} ms GPU; passes ${JSON.stringify([...(first.passes_ms ?? new Map<string, number>())])}`);
  if (first.gpu_ms === null) problems.push(`the house by ${mode} reports no GPU time`);
  if (shadowTimers(first, 'the house').length === 0) problems.push(`the house by ${mode}: frame 0's timer saw no shadow pass`);
  if (!first.passes_ms?.has('scene3d.geometry')) problems.push(`the house by ${mode}: frame 0's timer saw no geometry pass`);
  for (const n of [1, 2]) {
    const f = frameAt(frames, n, `the house ${mode}`);
    if (shadowsOf(f, 'the house').passes !== 0) problems.push(`the house by ${mode}: still frame ${n} issued ${shadowsOf(f, 'the house').passes} shadow passes`);
    if (shadowTimers(f, 'the house').length !== 0) problems.push(`the house by ${mode}: still frame ${n}'s timer saw [${shadowTimers(f, 'the house').join(', ')}]`);
  }
  if (hashOf(frameAt(frames, 2, 'the house'), 'the house') !== hashOf(only(clean!, 'the clean house'), 'the clean house')) problems.push(`the house by ${mode}: the cached frame 2 differs from a clean rebuild`);
  return problems;
}

/** The inside of the left room looking at the floor under the window. */
const INSIDE: Pinhole = { position: [-2, 2.2, -2.5], target: [-2, 0, 2.6], fov: 60, size: [480, 320] };
function poolProblems(glass: 'auto' | 'cast'): string[] {
  const out = dir();
  const doc = houseDoc('day', { glass, sky: DARK_SKY, cam: camera(INSIDE.position, INSIDE.target, INSIDE.fov) });
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `pool-${glass}`, doc), size: INSIDE.size, targets: ['linear'] })]);
  const l = readLinear(out, only(reply!, `the pool, glass ${glass}`), INSIDE.size, `the pool, glass ${glass}`);
  const sun = towardSun(HOUSE.sunRot);
  const want = (HOUSE.rho * HOUSE.sun * sun[1]) / Math.PI;
  let judged = 0;
  const problems: string[] = [];
  for (let y = 0; y < INSIDE.size[1]; y++) for (let x = 0; x < INSIDE.size[0]; x++) {
    const d = rayAt(INSIDE, x + 0.5, y + 0.5);
    if (d[1] >= -1e-6) continue;
    const t = -INSIDE.position[1] / d[1];
    const p: V3 = [INSIDE.position[0] + t * d[0], 0, INSIDE.position[2] + t * d[2]];
    if (!inSunPool(p, sun, 0.1)) continue;
    judged++;
    if (Math.abs(l.at(x, y) / want - 1) > 0.02) problems.push(`the sun doesn't reach the floor through the glass at (${x}, ${y}): ${l.at(x, y).toFixed(1)} nits, want ${want.toFixed(1)}`);
  }
  expect(judged, `at least 500 floor pixels lie in the pool; sun·up is ${dot(sun, [0, 1, 0]).toFixed(3)}`).toBeGreaterThanOrEqual(500);
  return problems;
}

describe(`${ID} a point light's map is reused until something in its range changes`, () => {
  it(`${ID} the map draws only when the lamp or an item in its range changes, a still interior issues no shadow pass, and every frame equals a clean rebuild; cache none and the planted local_map_stale fail`, () => {
    requireMetal();
    const cached = run('static');
    const clean = run('none');
    none(reuseProblems(cached), 'the cached interior');
    none(cleanProblems(cached, clean), 'the cached interior against a clean rebuild');
    failsNaming(reuseProblems(clean), ['still frame'], 'a map redrawn every frame (cache none)');
    const stale = run('static', 'local_map_stale');
    failsNaming([...reuseProblems(stale), ...cleanProblems(stale, clean)], ['frame 3'], 'the planted local_map_stale');
  }, 1_800_000);

  it(`${ID} the house by day and at night reports per-pass GPU timings, issues no shadow pass while still, equals a clean rebuild, and by day the sun comes through its glass`, () => {
    requireMetal();
    none([...houseProblems('day'), ...houseProblems('night')], 'the house');
    none(poolProblems('auto'), 'glass under shadow: auto');
    failsNaming(poolProblems('cast'), ['doesn\'t reach'], 'glass under shadow: cast');
  }, 1_800_000);
});
