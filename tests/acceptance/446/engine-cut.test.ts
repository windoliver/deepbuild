// AC8 #446.d9d8c199: In the engine fixture cut by a plane that faces the key light, a piston behind the cut receives the
// light's full direct illuminance within 1%, `shadows: whole` restores the shadow, and a cached shadow map equals a clean
// render after the plane moves.
//
// The engine (helpers: engineDoc): #424's block over its crankshaft with a piston inside, its +X face looking through the
// cut x > 0.2 at the key light on +X, once a sun (the cascades' map) and once a spot (a local map, which #424 never
// reached). The face's pixels (from the ID target, 3 px in, at least 1,500) read ρ E ÷ π within 1%: E = π lx from the
// sun, I cos θ ÷ d² from the spot, per pixel. Under `shadows: whole` the same pixels read under 1% of that. `--planted
// cut_color_only` (#424's: the planes clip the color pass, not the shadow pass) leaves the face dark, so it must fail,
// naming "full".
//
// The cache. The plane starts at x = 1.6, past the block's face, so nothing is cut and frame 0's map holds the whole block;
// a patch at frame 1 moves it to x = 0.2. Frames 1 and 2 of the cached run each equal a fresh process opening at frame 1
// on the final and linear targets' names, and frame 1 differs from frame 0, so the plane moved something. A map that
// stayed would leave the piston dark, where the clean render lights it. `--planted cut_key_omits_planes` (the planes
// clip the shadow pass but aren't in the map's key, so the map stays) must fail, naming "clean".
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, ENGINE, engineDoc, failsNaming, frameAt, framesOf, none, only, rayAt, readIds, readLinear, requireMetal, runGpu, set, useDir, useGpu, view3dCall, within, writeJson,
  type GpuPlanted, type Ids, type Linear, type Patch, type V3,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const dir = useDir();
const SIZE = ENGINE.size;
const KEYS = ['sun', 'spot'] as const;
const I = ENGINE.spot.power / (4 * Math.PI);

/** The face's point at pixel (x, y). */
function onFace(x: number, y: number): V3 {
  const d = rayAt(ENGINE.cam, x + 0.5, y + 0.5); const o = ENGINE.cam.position;
  const t = (ENGINE.face.x - o[0]) / d[0];
  return [ENGINE.face.x, o[1] + t * d[1], o[2] + t * d[2]];
}
/** What the face reads with the light's whole direct illuminance on it. */
function full(key: 'sun' | 'spot', p: V3): number {
  if (key === 'sun') return (ENGINE.rho * ENGINE.sunE) / Math.PI;
  const to: V3 = [ENGINE.spot.pos[0] - p[0], ENGINE.spot.pos[1] - p[1], ENGINE.spot.pos[2] - p[2]];
  const d = Math.hypot(...to);
  return (ENGINE.rho * I * (to[0] / d)) / (Math.PI * d * d);
}
/** The face's pixels, 3 px in from its silhouette. */
function facePixels(ids: Ids): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    if (!within(ids, x, y, 'piston', 3)) continue;
    const p = onFace(x, y);
    if (p[1] > ENGINE.face.y[0] && p[1] < ENGINE.face.y[1] && p[2] > ENGINE.face.z[0] && p[2] < ENGINE.face.z[1]) out.push([x, y]);
  }
  expect(out.length, 'at least 1,500 pixels of the piston\'s face show through the cut').toBeGreaterThanOrEqual(1_500);
  return out;
}
function readFace(l: Linear, px: [number, number][], key: 'sun' | 'spot'): { x: number; y: number; ratio: number }[] {
  return px.map(([x, y]) => ({ x, y, ratio: l.at(x, y) / full(key, onFace(x, y)) }));
}
function illuminanceProblems(planted?: GpuPlanted): string[] {
  const found: string[] = [];
  for (const key of KEYS) {
    const out = dir();
    const [cut, whole] = runGpu(bin(), out, (['cut', 'whole'] as const).map((s) => view3dCall({ doc: writeJson(out, `${key}-${s}`, engineDoc(key, s)), size: SIZE, targets: ['linear', 'ids'] })), planted);
    const a = only(cut!, `${key}: cut`); const b = only(whole!, `${key}: whole`);
    const px = facePixels(readIds(out, a, `${key}: cut`));
    for (const r of readFace(readLinear(out, a, SIZE, `${key}: cut`), px, key)) {
      if (Math.abs(r.ratio - 1) > 0.01) { found.push(`the ${key} doesn't reach the face in full at (${r.x}, ${r.y}): ${r.ratio.toFixed(3)} of it`); break; }
    }
    for (const r of readFace(readLinear(out, b, SIZE, `${key}: whole`), px, key)) {
      if (r.ratio > 0.01) { found.push(`shadows: whole doesn't restore the ${key}'s shadow at (${r.x}, ${r.y}): ${r.ratio.toFixed(3)} of the light`); break; }
    }
  }
  return found;
}
function cacheProblems(planted?: GpuPlanted): string[] {
  const found: string[] = [];
  const patches: Patch[] = [{ frame: 1, writer: AGENT, ops: [set('cut', 'params/planes/0/offset', ENGINE.offset)] }];
  for (const key of KEYS) {
    const out = dir();
    const doc = writeJson(out, key, engineDoc(key, 'cut', ENGINE.closed));
    const call = { doc, size: SIZE, targets: ['final' as const, 'linear' as const], patches };
    const [cached] = runGpu(bin(), out, [view3dCall({ ...call, frames: 3, capture: [0, 1, 2] })], planted);
    const [clean] = runGpu(bin(), out, [view3dCall({ ...call, from: 1, capture: [1] })], planted);
    const want = only(clean!, `${key}: the clean render`);
    const frames = framesOf(cached!, `${key}: the cached run`);
    for (const n of [1, 2]) {
      const f = frameAt(frames, n, `${key}: the cached run`);
      if (f.linear !== want.linear || f.final !== want.final) found.push(`the ${key}'s cached frame ${n} differs from the clean render after the plane moved`);
    }
    expect(frameAt(frames, 1, `${key}: the cached run`).final, `the plane's move changes the ${key}'s picture`).not.toBe(frameAt(frames, 0, `${key}: the cached run`).final);
  }
  return found;
}

describe(`${ID} a cut lets the key light in, whole keeps it out, and the cache follows the plane`, () => {
  it(`${ID} the piston's face reads the sun's and the spot's full direct illuminance within 1% through the cut and none under shadows: whole; the planted cut_color_only fails`, () => {
    requireMetal();
    none(illuminanceProblems(), 'the engine');
    failsNaming(illuminanceProblems('cut_color_only'), ['full'], 'the planted cut_color_only');
  }, 1_800_000);

  it(`${ID} after the plane moves, cached frames equal a clean render, under the sun and the spot; the planted cut_key_omits_planes fails`, () => {
    requireMetal();
    none(cacheProblems(), 'the cache');
    failsNaming(cacheProblems('cut_key_omits_planes'), ['clean'], 'the planted cut_key_omits_planes');
  }, 1_800_000);
});
