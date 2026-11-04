// AC3 #421.c70cf9fb: Lights match photometry on linear targets read back on the reference Mac: a point light's
// illuminance falls with the inverse square, a spot keeps its lumens counted over the whole sphere, and a sun gives
// its lux, each within 1%.
//
// A white diffuse floor (a `material@1` with base color 1, metallic 0, specular level 0, roughness 1) is drawn by
// #378's `view3d` into its linear target (scene-referred, before exposure) under one light at a time, and once with
// none (subtracted, so any ambient term cancels). On a white Lambertian surface the linear value is E ÷ π (the base's
// own convention for the sun, Units and axes: lumens and lux). For every pixel of a 5 × 5 patch around the point under
// the light, the test unprojects the pixel to the floor with #378's pinhole and computes E there:
//   point, 800 lm at heights 1 m and 2 m: E = (800 ÷ 4π) × cos θ ÷ d²; and E(1 m) ÷ E(2 m) = 4;
//   spot, 800 lm at 2 m pointing down, inner 20°, outer 30°: E = (800 ÷ 4π) × cos θ ÷ d², the point light's own
//     (lm = 4π × cd: the spot's power counts the whole sphere), and spot ÷ point at 2 m = 1;
//   sun, 100 lx shining straight down: E = 100.
// Each within 1%. `--planted spot_counts_cone` (a spot's lumens spread over its cone, cd = lm ÷ 2π(1 − cos outer))
// fails, naming the spot.
// Wrong programs: the base (no point or spot light: `unknown_kind`); a light falling as 1/r or 1/r³; a spot dividing
// by its cone's solid angle or by π; a sun without its ÷ π, or dimmed by a policy weight with one light in view.
import { describe, it } from 'vitest';
import {
  AC, PLAIN_LOOK, box, camera, failsNaming, frameAt, framesOf, material, none, onFloor, project, readLinear, requireReferenceMac, runGpu,
  sessionDoc, sub, useBins, useDir, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [400, 400];
const CAM: Pinhole = { position: [0, 4, 4], target: [0, 0, 0], fov: 50, size: SIZE };
const LM = 800;
const LUX = 100;
const TOL = 0.01;
const lum = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function floorDoc(name: string, light: JsonObject | null): JsonObject {
  return sessionDoc(`photometry-${name}`, SIZE, {
    cam: camera(CAM.position, CAM.target, CAM.fov),
    white: material({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 }),
    floor: box([20, 0.1, 20], { pos: [0, -0.05, 0] }, { material: 'white' }),
    ...(light ? { light } : {}),
  });
}
const point = (h: number): JsonObject => ({ kind: 'light.point@1', params: { power: LM, color: [1, 1, 1] }, at: { pos: [0, h, 0] } });
const spot = (h: number): JsonObject => ({ kind: 'light.spot@1', params: { power: LM, color: [1, 1, 1], inner: 20, outer: 30 }, at: { pos: [0, h, 0], rot: [-90, 0, 0] } });
const sun: JsonObject = { kind: 'light.sun@1', params: { illuminance: LUX, color: [1, 1, 1] }, at: { rot: [-90, 0, 0] } };

/** Illuminance on the floor (normal +Y) at `p` from an isotropic source of `lm` lumens at `at`. */
function isotropic(lm: number, at: V3, p: V3): number {
  const d = sub(at, p);
  const r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  return ((lm / (4 * Math.PI)) * (d[1] / Math.sqrt(r2))) / r2;
}

interface Case { name: string; light: JsonObject; e: (p: V3) => number }
const CASES: Case[] = [
  { name: 'point at 1 m', light: point(1), e: (p) => isotropic(LM, [0, 1, 0], p) },
  { name: 'point at 2 m', light: point(2), e: (p) => isotropic(LM, [0, 2, 0], p) },
  { name: 'spot at 2 m', light: spot(2), e: (p) => isotropic(LM, [0, 2, 0], p) },
  { name: 'sun', light: sun, e: () => LUX },
];

/** The photometry check: failures as sentences naming the light. */
function photometryProblems(bin: string, out: string, planted?: GpuPlanted): string[] {
  const docs = [floorDoc('dark', null), ...CASES.map((c) => floorDoc(c.name.replace(/\W+/g, '-'), c.light))];
  const replies = runGpu(bin, out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `floor-${i}`, d), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['linear'] })), planted);
  const targets = replies.map((r, i) => readLinear(out, frameAt(framesOf(r, `render ${i}`), 0, `render ${i}`).linear, SIZE, `render ${i}: linear`));
  const dark = targets[0]!;
  const [cx, cy] = project(CAM, [0, 0, 0]).map(Math.floor) as [number, number];
  const problems: string[] = [];
  const measured = new Map<string, number>();
  for (const [k, c] of CASES.entries()) {
    const lit = targets[k + 1]!;
    let worst = 0; let at = ''; let sum = 0; let n = 0;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      const e = (lum(lit.at(x, y)) - lum(dark.at(x, y))) * Math.PI;
      const want = c.e(onFloor(CAM, x, y));
      const rel = Math.abs(e - want) / want;
      sum += e / want; n++;
      if (rel > worst) { worst = rel; at = `(${x}, ${y}): ${e.toFixed(4)} lx against ${want.toFixed(4)}`; }
    }
    measured.set(c.name, sum / n);
    console.log(`${AC[3]}: ${c.name}: mean read ÷ expected ${(sum / n).toFixed(5)}; worst ${at}`);
    if (worst > TOL) problems.push(`${c.name}: illuminance read back off by ${(worst * 100).toFixed(2)}% (over 1%) at ${at}`);
  }
  // Ratios, independent of the E ÷ π convention: the inverse square, and the spot's lumens over the whole sphere.
  const r = (a: string, b: string): number => measured.get(a)! / measured.get(b)!;
  const inverseSquare = r('point at 1 m', 'point at 2 m');
  if (Math.abs(inverseSquare - 1) > TOL) problems.push(`point: E(1 m) ÷ E(2 m) is ${(4 * inverseSquare).toFixed(4)}, not 4 within 1%: not the inverse square`);
  const sphere = r('spot at 2 m', 'point at 2 m');
  if (Math.abs(sphere - 1) > TOL) problems.push(`spot: on its axis it gives ${sphere.toFixed(4)} × the point light of the same lumens, not 1 within 1%: its lumens aren't counted over the whole sphere`);
  return problems;
}

describe(`${AC[3]} photometry on linear targets read back on the reference Mac`, () => {
  it(`${AC[3]} a point light falls with the inverse square, a spot gives the point light's illuminance on its axis, and a sun gives its lux, each within 1%; the planted spot_counts_cone fails, naming the spot`, () => {
    requireReferenceMac();
    const bin = bins.bin('deep-gpu');
    none(photometryProblems(bin, dir()), 'photometry');
    failsNaming(photometryProblems(bin, dir(), 'spot_counts_cone'), ['spot'], 'the planted spot_counts_cone');
  }, 1_800_000);
});
