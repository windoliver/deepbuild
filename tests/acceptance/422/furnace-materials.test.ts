// AC5 #422.8976921a: A white-furnace fixture's materials never reflect more energy than they receive, and match a CPU
// BRDF reference within 1% on the same machine.
//
// The fixture's materials, each on a smooth ball of radius 1 seen from 6 m: a white plastic (base color 1, metallic 0,
// roughness 0.5), an orange plastic ([0.9, 0.4, 0.1], metallic 0, roughness 1), gold ([1, 0.78, 0.34], metallic 1,
// roughness 0.4) and rough gold (the same at roughness 0.8). In the white furnace (a uniform environment of radiance 1
// prefiltered from a white sky, no lights; README: Assumed surfaces), the background reads 1 within 1% and no pixel of
// any ball reads above 1.01 in any channel of the linear target (pbrt-v4's BSDFEnergyConservation threshold, ported).
// Under one sun alone (1 lx from the upper left, a black sky with no ambient and no environment), every pixel of each
// ball at least 2 px inside its silhouette whose reference is at least 5% of that channel's peak matches, per channel
// within 1%, the CPU reference: glTF's BRDF (GGX, height-correlated Smith, α = roughness²; the dielectric's Lambertian
// diffuse and its specular lobe at F0 0.04 mixed by Schlick's Fresnel at v·h; the metal's specular at F0 = base color),
// metal and dielectric each shaded and then mixed by metallic, each specular lobe × (1 + F0 × (1 ÷ E − 1)) with E its
// directional albedo (computed here by quadrature), times n·l and the sun's illuminance, at each pixel's own ray.
// Wrong programs: the base (no environment: the furnace is dark); a diffuse lobe not weighted by 1 − F, which reflects
// up to 1.04 in the furnace; an uncompensated or doubly compensated lobe; a wrong distribution, visibility, Fresnel or
// α mapping; a light that isn't in lux.
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, FURNACE_SKY, SPHERE_CAM, albedoTable, brdfCos, drawSpheres, dot, furnaceBackground, hitSphere, inside, none, pixelRay,
  requireMetal, sphereDoc, sun, towardSun, unit, useDir, useGpu, scale,
  type Drawn, type Lobe, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const GOLD: [number, number, number] = [1, 0.78, 0.34];
const MATERIALS: [string, Lobe][] = [
  ['white_plastic', { base: [1, 1, 1], metallic: 0, roughness: 0.5 }],
  ['orange_plastic', { base: [0.9, 0.4, 0.1], metallic: 0, roughness: 1 }],
  ['gold', { base: GOLD, metallic: 1, roughness: 0.4 }],
  ['rough_gold', { base: GOLD, metallic: 1, roughness: 0.8 }],
];
const params = (m: Lobe) => ({ base_color: [...m.base, 1], metallic: m.metallic, roughness: m.roughness });
const SUN_ROT: V3 = [-35, -30, 0];
const LUX = 1;

/** No ball pixel above 1.01 in the furnace; failures name the material. */
function furnaceProblems(drawn: Drawn[]): string[] {
  const problems: string[] = [];
  for (const [i, [id]] of MATERIALS.entries()) {
    const d = drawn[i]!;
    problems.push(...furnaceBackground(d, id));
    let worst = 0; let at = ''; let n = 0;
    for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
      if (d.ids.at(x, y) !== 'ball') continue;
      n++;
      const c = d.linear.at(x, y);
      for (const v of c) if (v > worst) { worst = v; at = `(${x}, ${y}) reads [${c.map((k) => k.toFixed(4)).join(', ')}]`; }
    }
    console.log(`${AC[5]}: ${id} in the furnace: ${n} px, brightest ${at}`);
    if (n < 20_000) problems.push(`${id}: only ${n} px of the ball in the furnace; the fixture needs 20,000`);
    if (worst > 1.01) problems.push(`${id}: reflects more than it receives in the white furnace: ${at}, above 1.01`);
  }
  return problems;
}

/** Each ball under the sun against the CPU reference, per pixel and channel; failures name the material. */
function sunProblems(drawn: Drawn[]): string[] {
  const l = towardSun(SUN_ROT);
  const problems: string[] = [];
  for (const [i, [id, lobe]] of MATERIALS.entries()) {
    const d = drawn[i]!;
    const E = albedoTable(lobe.roughness * lobe.roughness);
    const pts = inside(d.ids, 'ball', 2).flatMap(([x, y]) => {
      const ray = pixelRay(SPHERE_CAM, x, y);
      const p = hitSphere(SPHERE_CAM.position, ray, [0, 0, 0], 1);
      if (!p) return [];
      const n = unit(p); const v = scale(ray, -1);
      return dot(n, v) > 0 ? [{ x, y, ref: brdfCos(lobe, n, v, l, E).map((c) => c * LUX) }] : [];
    });
    const peak = [0, 1, 2].map((c) => Math.max(...pts.map((p) => p.ref[c]!)));
    let judged = 0; let worst = 0; let at = '';
    for (const p of pts) {
      const got = d.linear.at(p.x, p.y);
      for (let c = 0; c < 3; c++) {
        if (p.ref[c]! < 0.05 * peak[c]!) continue;
        judged++;
        const rel = Math.abs(got[c]! - p.ref[c]!) / p.ref[c]!;
        if (rel > worst) { worst = rel; at = `(${p.x}, ${p.y}) channel ${'rgb'[c]}: ${got[c]!.toFixed(5)} against ${p.ref[c]!.toFixed(5)}`; }
      }
    }
    console.log(`${AC[5]}: ${id} under the sun: ${judged} channel samples judged, worst ${(worst * 100).toFixed(3)}% at ${at}`);
    if (judged < 10_000) problems.push(`${id}: only ${judged} channel samples judged under the sun; the fixture needs 10,000`);
    if (worst > 0.01) problems.push(`${id}: off the CPU BRDF reference by ${(worst * 100).toFixed(2)}% (over 1%) at ${at}`);
  }
  return problems;
}

describe(`${AC[5]} the white-furnace fixture's materials`, () => {
  it(`${AC[5]} in the white furnace no material reflects more energy than it receives: no pixel above 1.01`, () => {
    requireMetal();
    const drawn = drawSpheres(bin(), dir(), MATERIALS.map(([id, m]) => sphereDoc(`furnace-${id}`, id, params(m), FURNACE_SKY, null)));
    none(furnaceProblems(drawn), 'the furnace');
  }, 1_800_000);

  it(`${AC[5]} under one sun each material matches the CPU BRDF reference within 1% at every judged pixel`, () => {
    requireMetal();
    const drawn = drawSpheres(bin(), dir(), MATERIALS.map(([id, m]) => sphereDoc(`sun-${id}`, id, params(m), DARK_SKY, sun(LUX, SUN_ROT))));
    none(sunProblems(drawn), 'the materials under the sun');
  }, 1_800_000);
});
