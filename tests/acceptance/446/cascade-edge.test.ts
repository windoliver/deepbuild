// AC5 #446.77ebb2fa: A cascade's snapped projection doesn't change while the camera moves less than one texel, so the
// cache hits, and a soft shadow at a cascade edge isn't cut.
//
// Snapping. A long floor with posts, a key sun of three cascades out to 60 m (`shadow_far` fixed, so a camera move can't
// move a split), the casters wide enough to set the maps' depth range. Frame 0 gives cascade 0's texel and its light-space
// x axis (row 0 of `clip`). Then the camera walks along that axis, a fifth of a texel a frame, 15 frames: three texels.
// A grid can't keep a projection across its own lines, so "moves less than one texel" is read as a move inside one texel
// cell (README: Readings). For each cascade, each frame's `clip` either equals the last one's, and then `drawn` is false,
// or it moved by a whole number of its texels, and then `drawn` is true; cascade i changes at most ⌈travel ÷ texel i⌉ + 1
// times, cascade 0 at most four of 15; the last frame equals a fresh process there. `--planted cascade_unsnapped` (the
// map follows the camera exactly) fails, naming "changed".
//
// The soft edge. A bar 80 m long over the floor, under a sun of angle 5° on the camera's up vector, two uniform cascades
// (`split: 0`), `fade: false`, so a hard switch. Its shadow runs across the whole frame at constant view depth, and the
// split lies on its near penumbra. The twin moves the split to 20 m, off the shadow. In strips of 17 columns across the
// frame, smoothed over 5 rows, the two profiles agree within 0.12 of the lit level on every row, so the edge cuts
// nothing; the twin's near penumbra is at least 15 rows wide, so there is a soft shadow to cut. The cascades' own reach:
// each cascade's half-width under 5° is at least the penumbra's reach for this bar, 6.08 m × tan 2.5°, above its
// half-width under a 0.001° sun (Light policy: cascades, "an expansion by the penumbra's reach"). `--planted
// cascade_filter_in_texels` (the disk sized in the cascade's texels, so it jumps at the split) fails naming "strip", and
// `--planted cascade_no_penumbra_reach` fails naming "reach".
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, DARK_SKY, box, camera, cascadesOf, failsNaming, frameAt, framesOf, hashOf, matte, none, only, penumbraWidth, project, readLinear, requireMetal, runGpu, rad, sessionDoc, set,
  sun, towardSun, unit, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject, type Linear, type Patch, type Pinhole, type V3,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();

// ---------------------------------------------------------------------------------------------------
const WALK_SIZE: [number, number] = [640, 400];
const WALK_EYE: V3 = [0, 8, 14];
const WALK_AT: V3 = [0, 0, 0];
const STEPS = 15;
function walkDoc(): JsonObject {
  const grey = { material: 'grey' };
  return sessionDoc('walk', WALK_SIZE, {
    cam: camera(WALK_EYE, WALK_AT, 45, { near: 0.5 }), sky: DARK_SKY, grey: matte(0.6),
    floor: box([400, 0.1, 400], [0, -0.05, 0], grey),
    post_a: box([0.6, 3, 0.6], [-2, 1.5, 2], grey), post_b: box([1, 4, 1], [3, 2, -8], grey), post_c: box([2, 6, 2], [-4, 3, -24], grey),
    sun: sun(Math.PI, [-50, 30, 0], { shadow: true, cascades: 3, split: 0.5, shadow_far: 60, angle: 0.53 }),
  }, { light_policy: { soft: { method: 'pcss' } } });
}
function walkProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'walk', walkDoc());
  const [probe] = runGpu(bin(), out, [view3dCall({ doc, size: WALK_SIZE, cascades: true })], planted);
  const first = cascadesOf(only(probe!, 'the first frame'), 'the first frame');
  const c0 = first[0];
  expect(c0, 'the sun draws cascades').toBeDefined();
  const across = unit([c0!.clip[0]!, c0!.clip[4]!, c0!.clip[8]!]);
  const step = c0!.texel_m / 5;
  const at = (k: number, p: V3): V3 => [p[0] + k * step * across[0], p[1] + k * step * across[1], p[2] + k * step * across[2]];
  const patches: Patch[] = [];
  for (let k = 1; k <= STEPS; k++) patches.push({ frame: k, writer: AGENT, ops: [set('cam', 'params/position', at(k, WALK_EYE)), set('cam', 'params/target', at(k, WALK_AT))] });
  const call = { doc, size: WALK_SIZE, patches, cascades: true, targets: ['final' as const] };
  const [walked] = runGpu(bin(), out, [view3dCall({ ...call, frames: STEPS + 1, capture: 'every' })], planted);
  const [clean] = runGpu(bin(), out, [view3dCall({ ...call, from: STEPS, capture: [STEPS] })], planted);
  const frames = framesOf(walked!, 'the walk');
  const problems: string[] = [];
  first.forEach((c, i) => {
    let changes = 0;
    const scaleOf = Math.hypot(c.clip[0]!, c.clip[4]!, c.clip[8]!);
    const cell = scaleOf * c.texel_m;
    for (let k = 1; k <= STEPS; k++) {
      const a = cascadesOf(frameAt(frames, k - 1, 'the walk'), 'the walk')[i]!; const b = cascadesOf(frameAt(frames, k, 'the walk'), 'the walk')[i]!;
      const same = a.clip.every((v, n) => v === b.clip[n]);
      if (same) {
        if (b.drawn) problems.push(`cascade ${i} drew at frame ${k} with its projection unchanged: the cache missed`);
        continue;
      }
      changes++;
      if (!b.drawn) problems.push(`cascade ${i} kept its map at frame ${k} with its projection changed`);
      for (const n of [12, 13]) {
        const moved = (b.clip[n]! - a.clip[n]!) / cell;
        if (Math.abs(moved - Math.round(moved)) > 1e-3) problems.push(`cascade ${i} changed at frame ${k} by ${moved.toFixed(4)} texels, not a whole number`);
      }
    }
    const allowed = Math.ceil((STEPS * step) / c.texel_m) + 1;
    if (changes > allowed) problems.push(`cascade ${i} changed ${changes} times in ${(STEPS * step / c.texel_m).toFixed(2)} of its texels`);
  });
  if (hashOf(frameAt(frames, STEPS, 'the walk'), 'the walk') !== hashOf(only(clean!, 'the clean render'), 'the clean render')) problems.push('the walk\'s last frame differs from a clean render');
  return problems;
}

// ---------------------------------------------------------------------------------------------------
const EDGE_SIZE: [number, number] = [800, 400];
const CAM: Pinhole = { position: [0, 10, 10], target: [0, 0, 0], fov: 50, size: EDGE_SIZE };
const NEAR = 0.5;
const ANGLE = 5;
/** The sun on the camera's up vector, 45° up from −Z: towardSun([−135, 0, 0]) = (0, 0.7071, −0.7071). */
const ROT: V3 = [-135, 0, 0];
const LIT = 0.8;
/** The bar's near shadow edge falls on the floor at z = 0.6, view depth 0.7071 (20 − z); the blocker is 4.3 ÷ 0.7071 m off. */
const SPLIT = Math.SQRT1_2 * (20 - 0.6);
const BLOCKER = 4.3 / Math.SQRT1_2;
function edgeDoc(split: number, angle: number): JsonObject {
  const l = towardSun(ROT);
  return sessionDoc(`edge-${split}-${angle}`, EDGE_SIZE, {
    cam: camera(CAM.position, CAM.target, CAM.fov, { near: NEAR }), sky: DARK_SKY, grey: matte(0.8),
    floor: box([100, 0.1, 100], [0, -0.05, 0], { material: 'grey' }),
    bar: box([80, 0.6, 0.6], [0, 4, -4], { material: 'grey' }),
    sun: sun(Math.PI / l[1], ROT, { shadow: true, angle, cascades: 2, split: 0, fade: false, shadow_far: 2 * split - NEAR }),
  }, { light_policy: { soft: { method: 'pcss', max_penumbra: 128 } } });
}
const ROW = (z: number): number => Math.round(project(CAM, [0, 0, z])[1]);
const STRIPS = [16, 110, 250, 400, 550, 690, 783];
/** One strip's profile over the shadow, from z = 1.4 to z = −1.4, in units of the lit level. */
function strip(l: Linear, cx: number): number[] {
  const out: number[] = [];
  for (let y = ROW(1.4); y >= ROW(-1.4); y--) {
    let sum = 0;
    for (let dy = -2; dy <= 2; dy++) for (let x = cx - 8; x <= cx + 8; x++) sum += l.at(x, y + dy);
    out.push(sum / 85 / LIT);
  }
  return out;
}
function edgeProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const call = (split: number, angle: number): JsonObject => view3dCall({ doc: writeJson(out, `edge-${split}-${angle}`, edgeDoc(split, angle)), size: EDGE_SIZE, targets: ['linear'], cascades: true });
  const [onEdge, offEdge, hard] = runGpu(bin(), out, [call(SPLIT, ANGLE), call(20, ANGLE), call(SPLIT, 0.001)], planted);
  const a = only(onEdge!, 'the split on the shadow'); const b = only(offEdge!, 'the split off the shadow'); const h = only(hard!, 'the hard sun');
  expect(Math.abs(a.splits![1]! - SPLIT), `the split lies on the penumbra: ${a.splits![1]} m, want ${SPLIT} m`).toBeLessThan(0.05);
  expect(Math.abs(b.splits![1]! - 20), `the twin's split is off the shadow: ${b.splits![1]} m`).toBeLessThan(0.05);
  const la = readLinear(out, a, EDGE_SIZE, 'the split on the shadow'); const lb = readLinear(out, b, EDGE_SIZE, 'the split off the shadow');
  const problems: string[] = [];
  for (const cx of STRIPS) {
    const pa = strip(la, cx); const pb = strip(lb, cx);
    const worst = pa.reduce((m, v, i) => Math.max(m, Math.abs(v - pb[i]!)), 0);
    if (worst > 0.12) problems.push(`strip x = ${cx}: the split changes the shadow by ${worst.toFixed(3)} of the lit level`);
    const mid = Math.floor(pb.length / 2);
    const near = pb.slice(0, mid);
    if (Math.max(...pb) < 0.97 || Math.min(...pb) > 0.03) problems.push(`strip x = ${cx}: the twin's profile doesn't run from lit to dark`);
    if (penumbraWidth(near) < 15) problems.push(`strip x = ${cx}: the twin's near penumbra is only ${penumbraWidth(near).toFixed(1)} rows`);
  }
  const reach = BLOCKER * Math.tan(rad(ANGLE) / 2);
  cascadesOf(a, 'the soft sun').forEach((c, i) => {
    const half = (m: number[]): number => 1 / Math.hypot(m[0]!, m[4]!, m[8]!);
    const grown = half(c.clip) - half(cascadesOf(h, 'the hard sun')[i]!.clip);
    if (grown < 0.99 * reach) problems.push(`cascade ${i} grew by ${grown.toFixed(3)} m, under the penumbra's reach of ${reach.toFixed(3)} m`);
  });
  return problems;
}

describe(`${ID} cascades snap to texels and a soft shadow crosses their edge whole`, () => {
  it(`${ID} a camera walking a fifth of a texel a frame changes each cascade's projection only by whole texels, the cache hits between, and the last frame equals a clean render; the planted cascade_unsnapped fails`, () => {
    requireMetal();
    none(walkProblems(), 'the walk');
    failsNaming(walkProblems('cascade_unsnapped'), ['changed'], 'the planted cascade_unsnapped');
  }, 1_800_000);

  it(`${ID} a penumbra on a cascade's edge equals the same penumbra off it across the frame, and each cascade grows by the penumbra's reach; the planted cascade_filter_in_texels and cascade_no_penumbra_reach fail`, () => {
    requireMetal();
    none(edgeProblems(), 'the soft edge');
    failsNaming(edgeProblems('cascade_filter_in_texels'), ['strip'], 'the planted cascade_filter_in_texels');
    failsNaming(edgeProblems('cascade_no_penumbra_reach'), ['reach'], 'the planted cascade_no_penumbra_reach');
  }, 1_800_000);
});
