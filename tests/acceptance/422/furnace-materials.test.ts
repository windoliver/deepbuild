// AC5 #422.8976921a: A white-furnace fixture's materials never reflect more energy than they receive, and match a CPU
// BRDF reference within 1% on the same machine.
//
// The fixture (helpers.ts: sphereDoc): each material alone on a smooth ball of radius 1 at the origin, seen from 6 m on
// +Z at fov 30 on 320 × 320 px, so the ball is a disk of about 101 px radius: 32,020 pixel centres hit it, 30,420 of
// them at least 2 px inside its rim (counted by this file's own pinhole and ray-sphere hit). The materials, all at
// roughness 0.5 or more so that specular antialiasing (α² widened by about 1e-4 for this ball's ~0.01 rad of normal
// per pixel) moves no lobe by more than 0.2%:
//   white_plastic  base [1, 1, 1]          metallic 0    roughness 0.5   (the white dielectric, diffuse plus specular)
//   orange_plastic base [0.9, 0.4, 0.1]    metallic 0    roughness 1     (a coloured dielectric, judged per channel)
//   gold           base [1, 0.78, 0.34]    metallic 1    roughness 0.5   (a coloured metal)
//   half_copper    base [0.95, 0.64, 0.54] metallic 0.5  roughness 0.75  (a part metal, the issue's scope line)
//
// 1. The white furnace (README: Assumed surfaces 2; radiance 1 in every direction, no lights). The fixture holds only
//    if its background reads 1 within 1% (furnaceBackground) and the ball covers at least 30,400 px of the ID target
//    (95% of the 32,020-px disk, rounded down to a hundred: a rasterized rim may differ from the analytic one by a
//    ring of about 2π·101 ≈ 635 px, 2%). Never more than received: no pixel of the ball reads above 1.01 in any
//    channel of the linear target (the criterion's 1%, pbrt-v4's BSDFEnergyConservation threshold). So that this
//    bound can't pass on a ball the furnace doesn't light, each ball's mean luminance over its pixels 2 px inside must
//    reach at least half of the CPU reference's furnace response there (the reference integrated over the hemisphere
//    per n·v). Half is a guard, not an accuracy bar; the 1% match is judged under the sun, where the reference is
//    exact. The bound isn't derived from the reference: glTF's fresnel_mix, judged one direction at a time,
//    integrates for white_plastic to 1.011 at n·v = 0.5 and 1.14 at grazing, so the furnace bound is a requirement on
//    the environment path in its own right.
// 2. One sun alone (1 lx toward [−0.41, 0.57, 0.71], the upper left in front; a black sky with no ambient and no
//    environment). The CPU reference is helpers.ts' brdfCos: glTF 2.0's BRDF (GGX, height-correlated Smith,
//    α = roughness², Schlick's Fresnel at v·h; the dielectric's Lambertian diffuse weighted by 1 − F and its specular
//    lobe at F0 0.04; the metal's specular at F0 = base color; the two shaded and then mixed by metallic), each
//    specular lobe × (1 + F0 × (1 ÷ E − 1)) with E its directional albedo by quadrature (Material), × n·l × 1 lx, at
//    each pixel's own ray, computed in this process on the machine that drew the frame. Judged: every channel of
//    every ball pixel at least 2 px inside the rim whose reference is at least 5% of that channel's peak on the ball,
//    each within 1%. Each material needs at least as many judged samples in its sparsest channel as 95% of what the
//    reference judges on the analytic disk, rounded down to a hundred: white_plastic 27,306 → 25,900; orange_plastic
//    27,396 → 26,000; gold 8,421 → 7,900 (a metal lights only its highlight above the 5% cut); half_copper
//    27,193 → 25,800. Moving the rim in by one more pixel costs white_plastic 491 samples (1.8%) and gold none.
//    The reference counts as an oracle (technical design: The parity suite) because it reproduces a number the issue
//    states, E(n·v = 1, α = 1) = 1 − ln 2 (AC8), and its planted twin fails: under --planted uncompensated_lobe
//    (README: Planted programs) the reference's own uncompensated lobe is off it by 15.1% for gold and 21.4% for
//    half_copper at their worst judged samples, so that build must fail naming both (the plastics differ by only
//    0.07% and 1.4%, too close to the 1% to name).
// Every failure names its material. Wrong programs: the base (no environment: the furnace's background isn't 1); a
// furnace that doesn't light materials; an environment path that adds an unweighted diffuse to the specular; a missing
// or doubled compensation; a wrong distribution, visibility, Fresnel, α mapping, metallic mix or light unit.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, FURNACE_SKY, SPHERE_CAM, albedo, albedoTable, brdfCos, dot, drawSpheres, failsNaming, furnaceBackground, hitSphere, inside, lum,
  none, pixelRay, requireMetal, scale, sphereDoc, sun, towardSun, unit, useDir, useGpu,
  type Drawn, type JsonObject, type Lobe, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

interface Material { id: string; lobe: Lobe; minJudged: number }
const MATERIALS: Material[] = [
  { id: 'white_plastic', lobe: { base: [1, 1, 1], metallic: 0, roughness: 0.5 }, minJudged: 25_900 },
  { id: 'orange_plastic', lobe: { base: [0.9, 0.4, 0.1], metallic: 0, roughness: 1 }, minJudged: 26_000 },
  { id: 'gold', lobe: { base: [1, 0.78, 0.34], metallic: 1, roughness: 0.5 }, minJudged: 7_900 },
  { id: 'half_copper', lobe: { base: [0.95, 0.64, 0.54], metallic: 0.5, roughness: 0.75 }, minJudged: 25_800 },
];
const MIN_BALL_PX = 30_400;
const SUN_ROT: V3 = [-35, -30, 0];
const LUX = 1;

function docs(tag: string, sky: JsonObject, light: JsonObject | null): JsonObject[] {
  return MATERIALS.map(({ id, lobe }) => sphereDoc(`${tag}-${id}`, id,
    { base_color: [...lobe.base, 1], metallic: lobe.metallic, roughness: lobe.roughness, specular_level: 0.5 }, sky, light));
}

/** The ball's normal and the direction to the eye at pixel (x, y), or null off the ball. */
function surfaceAt(x: number, y: number): { n: V3; v: V3 } | null {
  const ray = pixelRay(SPHERE_CAM, x, y);
  const p = hitSphere(SPHERE_CAM.position, ray, [0, 0, 0], 1);
  if (!p) return null;
  const n = unit(p); const v = scale(ray, -1);
  return dot(n, v) > 0 ? { n, v } : null;
}

/** The reference's luminance under radiance 1 from every direction, ∫ f·(n·l) dω by a 128 × 64 midpoint rule,
 * tabulated at 17 values of n·v and read linearly. Only the furnace's "is it lit" guard reads it. */
function furnaceResponse(lobe: Lobe): (mu: number) => number {
  const E = albedoTable(lobe.roughness * lobe.roughness);
  const NT = 128; const NP = 64; const dT = Math.PI / 2 / NT; const dP = (2 * Math.PI) / NP;
  const at = (mu: number): number => {
    const v: V3 = [Math.sqrt(1 - mu * mu), 0, mu];
    let s = 0;
    for (let i = 0; i < NT; i++) {
      const t = (i + 0.5) * dT;
      for (let k = 0; k < NP; k++) {
        const p = (k + 0.5) * dP;
        s += lum(brdfCos(lobe, [0, 0, 1], v, [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)], E)) * Math.sin(t) * dT * dP;
      }
    }
    return s;
  };
  const table = Array.from({ length: 17 }, (_, i) => at(Math.max(i / 16, 0.02)));
  return (mu) => { const x = Math.min(Math.max(mu, 0), 1) * 16; const i = Math.min(Math.floor(x), 15); return table[i]! + (table[i + 1]! - table[i]!) * (x - i); };
}

function furnaceProblems(drawn: Drawn[]): string[] {
  const problems: string[] = [];
  for (const [i, { id, lobe }] of MATERIALS.entries()) {
    const d = drawn[i]!;
    problems.push(...furnaceBackground(d, id));
    let n = 0; let worst = -Infinity; let at = '';
    for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
      if (d.ids.at(x, y) !== 'ball') continue;
      n++;
      const c = d.linear.at(x, y);
      if (Math.max(...c) > worst) { worst = Math.max(...c); at = `(${x}, ${y}) reads [${c.map((k) => k.toFixed(4)).join(', ')}]`; }
    }
    const response = furnaceResponse(lobe);
    let got = 0; let want = 0;
    for (const [x, y] of inside(d.ids, 'ball', 2)) {
      const s = surfaceAt(x, y);
      if (s) { got += lum(d.linear.at(x, y)); want += response(dot(s.n, s.v)); }
    }
    console.log(`${AC[5]}: ${id} in the furnace: ${n} px, brightest ${at}; luminance summed 2 px inside ${got.toFixed(1)} against the reference's ${want.toFixed(1)}`);
    if (n < MIN_BALL_PX) problems.push(`${id}: only ${n} px of the ball drawn in the furnace; the 32,020-px disk needs ${MIN_BALL_PX}`);
    if (worst > 1.01) problems.push(`${id}: reflects more energy than it receives in the white furnace: ${at}, above 1.01`);
    if (!(got >= 0.5 * want && want > 0)) problems.push(`${id}: isn't lit by the white furnace: its luminance sums to ${got.toFixed(1)}, under half the CPU reference's ${want.toFixed(1)}`);
  }
  return problems;
}

function sunProblems(drawn: Drawn[]): string[] {
  const l = towardSun(SUN_ROT);
  const problems: string[] = [];
  for (const [i, { id, lobe, minJudged }] of MATERIALS.entries()) {
    const d = drawn[i]!;
    const E = albedoTable(lobe.roughness * lobe.roughness);
    const pts = inside(d.ids, 'ball', 2).flatMap(([x, y]) => {
      const s = surfaceAt(x, y);
      return s ? [{ x, y, ref: brdfCos(lobe, s.n, s.v, l, E).map((c) => c * LUX) }] : [];
    });
    const peak = [0, 1, 2].map((c) => pts.reduce((m, p) => Math.max(m, p.ref[c]!), 0));
    const judged = [0, 0, 0]; let worst = 0; let at = '';
    for (const p of pts) {
      const got = d.linear.at(p.x, p.y);
      for (let c = 0; c < 3; c++) {
        if (p.ref[c]! < 0.05 * peak[c]!) continue;
        judged[c]!++;
        const rel = Math.abs(got[c]! - p.ref[c]!) / p.ref[c]!;
        if (!(rel <= worst)) { worst = rel; at = `(${p.x}, ${p.y}) channel ${'rgb'[c]}: ${got[c]!.toFixed(5)} against ${p.ref[c]!.toFixed(5)}`; }
      }
    }
    console.log(`${AC[5]}: ${id} under the sun: judged ${judged.join('/')} samples (r/g/b), worst ${(worst * 100).toFixed(3)}% at ${at}`);
    if (Math.min(...judged) < minJudged) problems.push(`${id}: only ${Math.min(...judged)} samples judged in its sparsest channel under the sun; the fixture needs ${minJudged}`);
    if (!(worst <= 0.01)) problems.push(`${id}: off the CPU BRDF reference by ${(worst * 100).toFixed(2)}% (over 1%) at ${at}`);
  }
  return problems;
}

describe(`${AC[5]} the white-furnace fixture's materials`, () => {
  it(`${AC[5]} in the white furnace no material reflects more energy than it receives: every ball pixel at most 1.01, each ball lit`, () => {
    requireMetal();
    none(furnaceProblems(drawSpheres(bin(), dir(), docs('furnace', FURNACE_SKY, null))), 'the materials in the white furnace');
  }, 1_800_000);

  it(`${AC[5]} under one sun each material matches the CPU BRDF reference within 1% at every judged pixel; the planted uncompensated_lobe fails, naming gold and half_copper`, () => {
    requireMetal();
    expect(Math.abs(albedo(1, 1) - (1 - Math.LN2)), "the CPU reference reproduces the issue's E(1, α = 1) = 1 − ln 2").toBeLessThan(1e-4);
    const lit = docs('sun', DARK_SKY, sun(LUX, SUN_ROT));
    none(sunProblems(drawSpheres(bin(), dir(), lit)), 'the materials under one sun');
    failsNaming(sunProblems(drawSpheres(bin(), dir(), lit, 'uncompensated_lobe')), ['gold', 'half_copper'], 'the planted uncompensated_lobe');
  }, 1_800_000);
});
