// AC3 #422.daf158a9: A cached cascade equals a clean render after the camera moves within or beyond a cascade texel,
// the sun turns, or a caster moves inside or outside the cascade.
//
// A long floor with posts from 4 m to 60 m and a key sun with four cascades out to 120 m (Light policy: cascades).
// Each of five cases is a patch at frame 1 of a three-frame run (frame 0 fills the cascade maps, frames 1 and 2 may
// reuse them): the camera moves 0.1 mm (inside any cascade texel a map of up to 8192 px over the near split could
// have), the camera moves 2.9 m, the sun turns 10°, the near caster moves 2 m inside the first cascade, and a caster
// 250 m out, past every cascade, moves 10 m. The clean render is a fresh process that opens at frame 1 (a seek, which
// applies every patch up to it), so nothing is cached. Frames 1 and 2 of the cached run each equal the clean frame 1
// exactly: the same linear target and the same final target, byte for byte (the scene holds still after the patch).
// `--planted cascade_cache_keeps_stale` (a cascade's map reused while the scene's item count is unchanged) fails,
// naming the sun's turn and the caster's move inside the cascade.
// Wrong programs: a cache keyed by less than everything a cascade reads (the sun's direction, the snapped projection,
// the casters' keys and transforms); a map re-rendered one frame late; texel snapping that depends on earlier frames.
import { describe, it } from 'vitest';
import {
  AC, AGENT, PLAIN_LOOK, box, camera, failsNaming, frameAt, framesOf, material, none, runGpu, sessionDoc, set, sun, useDir, useGpu, view3dCall,
  requireMetal, writeJson, type GpuPlanted, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 400];
const CAM: [number, number, number] = [0, 2, 8];

const scene = sessionDoc('cascades', SIZE, {
  cam: camera(CAM, [0, 0.5, -20], 50, { near: 0.1, far: 500 }),
  grey: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 }),
  floor: box([300, 0.1, 600], { pos: [0, -0.05, -150] }, { material: 'grey' }),
  near_box: box([1, 1, 1], { pos: [1, 0.5, 4] }, { material: 'grey' }),
  post_a: box([0.6, 3, 0.6], { pos: [-2, 1.5, -5] }, { material: 'grey' }),
  post_b: box([1, 4, 1], { pos: [3, 2, -15] }, { material: 'grey' }),
  post_c: box([2, 6, 2], { pos: [-4, 3, -30] }, { material: 'grey' }),
  post_d: box([3, 8, 3], { pos: [6, 4, -60] }, { material: 'grey' }),
  far_box: box([4, 4, 4], { pos: [0, 2, -250] }, { material: 'grey' }),
  sun: sun(20000, [-35, -30, 0], { shadow: true, cascades: 4, split: 0.7, shadow_far: 120, fade: true }),
});
const at1 = (ops: JsonObject[]): JsonObject[] => [{ frame: 1, writer: AGENT, ops }];
const CASES: [string, JsonObject[]][] = [
  ['the camera moves within a cascade texel', at1([set('cam', 'params/position', [CAM[0] + 0.0001, CAM[1], CAM[2]])])],
  ['the camera moves beyond a cascade texel', at1([set('cam', 'params/position', [2, 2.5, 6])])],
  ['the sun turns', at1([set('sun', 'at/rot', [-35, -20, 0])])],
  ['a caster moves inside the cascade', at1([set('near_box', 'at/pos', [-1, 0.5, 3])])],
  ['a caster moves outside the cascade', at1([set('far_box', 'at/pos', [10, 2, -260])])],
];

/** Each case cached (one run of frames 0–2) against its clean render (a fresh process opening at frame 1). */
function cacheProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'cascades', scene);
  const cached = runGpu(bin(), out, CASES.map(([, patches]) => view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, frames: 3, capture: [1, 2], targets: ['final', 'linear'], patches })), planted);
  const problems: string[] = [];
  for (const [i, [name, patches]] of CASES.entries()) {
    const [clean] = runGpu(bin(), out, [view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, from: 1, frames: 1, capture: [1], targets: ['final', 'linear'], patches })], planted);
    const want = frameAt(framesOf(clean!, `${name}: the clean render`), 1, `${name}: the clean render`);
    const got = framesOf(cached[i]!, `${name}: the cached run`);
    for (const n of [1, 2]) {
      const f = frameAt(got, n, `${name}: the cached run`);
      if (f.linear !== want.linear) problems.push(`${name}: the cached run's frame ${n} linear target ${f.linear} differs from the clean render's ${want.linear}`);
      if (f.final !== want.final) problems.push(`${name}: the cached run's frame ${n} final target ${f.final} differs from the clean render's ${want.final}`);
    }
  }
  return problems;
}

describe(`${AC[3]} a cached cascade equals a clean render`, () => {
  it(`${AC[3]} after the camera moves within or beyond a texel, the sun turns, or a caster moves inside or outside the cascade, the cached frames equal a clean render exactly; the planted cascade_cache_keeps_stale fails, naming the sun's turn and the inside caster`, () => {
    requireMetal();
    none(cacheProblems(), 'the cached cascades');
    failsNaming(cacheProblems('cascade_cache_keeps_stale'), ['the sun turns', 'a caster moves inside the cascade'], 'the planted cascade_cache_keeps_stale');
  }, 3_600_000);
});
