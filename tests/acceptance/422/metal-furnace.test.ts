// AC8 #422.45d51ce0: In a white furnace (a uniform environment of radiance 1 and no lights), white metal spheres (base
// color 1, metallic 1) at roughness 0, 0.5 and 1 read 1 within 1% at every pixel, and lit by one sun alone each matches
// a CPU reference of the compensated lobe within 1%. A planted lobe without the compensation reads 1 − ln 2 ≈ 0.31 at
// the roughness 1 sphere's center in the furnace, and one compensated on environment light alone reads 0.31 of the
// reference at the center of the sun-lit roughness 1 sphere with the sun behind the camera, each failing and naming the
// material.
//
// Three white metal balls (`metal_r000`, `metal_r050`, `metal_r100`: base color 1, metallic 1, roughness 0, 0.5, 1),
// each alone, radius 1, seen from 6 m along −Z (README: Assumed surfaces, the white furnace). In the furnace every
// pixel of each ball reads 1 within 1% in every channel of the linear target, and the background reads 1.
// Lit by one sun alone (1 lx shining along −Z, behind the camera; a black sky with no ambient and no environment):
// for roughness 0.5 and 1, every pixel at least 2 px inside the silhouette whose reference is at least 5% of the
// ball's peak matches the CPU reference within 1%: E × D × V × (n·l) ÷ E(n·v, α), the compensated lobe of a white metal
// (F = 1, so × (1 + F0 × (1 ÷ E − 1)) is × 1 ÷ E), D GGX and V height-correlated Smith at α = roughness², E by
// quadrature, at each pixel's own ray. Roughness 0's lobe is a mirror's, which no pixel can be judged against, so the
// whole ball is: the sun's image in it, Σ linear × each pixel's solid angle over the ball, equals the mirror sphere's
// E × R² ÷ (2d − R)² (= 1/121 here) within 1%, the limit of the compensated lobe as roughness goes to 0.
// `--planted uncompensated_lobe` fails the furnace naming metal_r100, whose center reads 0.31 (1 − ln 2 = 0.3069, to two
// places); `--planted compensates_environment_only` fails under the sun naming metal_r100, whose center reads 0.31 of
// the reference.
// Wrong programs: the base (no environment: the furnace is dark); a lobe uncompensated, compensated on one kind of
// light only, or compensated by a wrong E; a white metal that darkens at grazing angles or at high roughness.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, FURNACE_SKY, SPHERE_CAM, albedoTable, brdfCos, drawSpheres, dot, failsNaming, furnaceBackground, hitSphere, inside, lum, none,
  pixelRay, pixelSolidAngle, requireMetal, scale, sphereDoc, sun, unit, useDir, useGpu,
  type Drawn, type Lobe, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const ROUGH = [0, 0.5, 1] as const;
const ID = (r: number): string => `metal_r${String(Math.round(r * 100)).padStart(3, '0')}`;
const lobe = (r: number): Lobe => ({ base: [1, 1, 1], metallic: 1, roughness: r });
const params = (r: number) => ({ base_color: [1, 1, 1, 1], metallic: 1, roughness: r });
const LUX = 1;
const BEHIND: V3 = [0, 0, 0]; // the sun's rot: shining along −Z, the camera's view direction
const L: V3 = [0, 0, 1];
const D = 6; const R = 1;
/** The 2 × 2 pixels about the ball's center. */
const CENTER: [number, number][] = [[159, 159], [160, 159], [159, 160], [160, 160]];

function furnaceProblems(drawn: Drawn[]): string[] {
  const problems: string[] = [];
  for (const [i, r] of ROUGH.entries()) {
    const d = drawn[i]!; const id = ID(r);
    problems.push(...furnaceBackground(d, id));
    let worst = 0; let at = ''; let n = 0;
    for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
      if (d.ids.at(x, y) !== 'ball') continue;
      n++;
      const c = d.linear.at(x, y);
      for (const v of c) if (Math.abs(v - 1) > worst) { worst = Math.abs(v - 1); at = `(${x}, ${y}) reads [${c.map((k) => k.toFixed(4)).join(', ')}]`; }
    }
    console.log(`${AC[8]}: ${id} in the furnace: ${n} px, worst ${at}`);
    if (n < 20_000) problems.push(`${id}: only ${n} px of the ball in the furnace; the fixture needs 20,000`);
    if (worst > 0.01) problems.push(`${id}: doesn't read 1 within 1% in the white furnace: ${at}`);
  }
  return problems;
}
const centerOf = (d: Drawn): number => CENTER.reduce((s, [x, y]) => s + lum(d.linear.at(x, y)), 0) / CENTER.length;

/** The reference at pixel (x, y) of the sun-lit ball, or null off the ball. */
function reference(r: number, E: (mu: number) => number, x: number, y: number): number | null {
  const ray = pixelRay(SPHERE_CAM, x, y);
  const p = hitSphere(SPHERE_CAM.position, ray, [0, 0, 0], R);
  if (!p) return null;
  const n = unit(p); const v = scale(ray, -1);
  return dot(n, v) > 0 ? brdfCos(lobe(r), n, v, L, E)[0] * LUX : null;
}
function sunProblems(drawn: Drawn[]): string[] {
  const problems: string[] = [];
  for (const [i, r] of ROUGH.entries()) {
    const d = drawn[i]!; const id = ID(r);
    if (r === 0) {
      let sum = 0;
      for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
        const near = [-2, -1, 0, 1, 2].some((dy) => [-2, -1, 0, 1, 2].some((dx) => d.ids.at(x + dx, y + dy) === 'ball'));
        if (near) sum += lum(d.linear.at(x, y)) * pixelSolidAngle(SPHERE_CAM, x, y);
      }
      const want = (LUX * R * R) / (2 * D - R) ** 2;
      console.log(`${AC[8]}: ${id} under the sun: the sun's image ${sum.toExponential(5)} against ${want.toExponential(5)}`);
      if (Math.abs(sum - want) > 0.01 * want) problems.push(`${id}: the sun's image in the mirror ball is ${sum.toExponential(4)}, not E·R²/(2d − R)² = ${want.toExponential(4)} within 1%`);
      continue;
    }
    const E = albedoTable(r * r);
    const pts = inside(d.ids, 'ball', 2).flatMap(([x, y]) => { const ref = reference(r, E, x, y); return ref === null ? [] : [{ x, y, ref }]; });
    const peak = Math.max(...pts.map((p) => p.ref));
    let judged = 0; let worst = 0; let at = '';
    for (const p of pts) {
      if (p.ref < 0.05 * peak) continue;
      judged++;
      const got = lum(d.linear.at(p.x, p.y));
      const rel = Math.abs(got - p.ref) / p.ref;
      if (rel > worst) { worst = rel; at = `(${p.x}, ${p.y}): ${got.toFixed(5)} against ${p.ref.toFixed(5)}`; }
    }
    const ratio = centerOf(d) / (CENTER.reduce((s, [x, y]) => s + reference(r, E, x, y)!, 0) / CENTER.length);
    console.log(`${AC[8]}: ${id} under the sun: ${judged} px judged, worst ${(worst * 100).toFixed(3)}% at ${at}; center reads ${ratio.toFixed(4)} of the reference`);
    if (judged < 3_000) problems.push(`${id}: only ${judged} px judged under the sun; the fixture needs 3,000`);
    if (worst > 0.01) problems.push(`${id}: off the compensated lobe's CPU reference by ${(worst * 100).toFixed(2)}% (over 1%) at ${at}; its center reads ${ratio.toFixed(4)} of the reference`);
  }
  return problems;
}
const rounds = (v: number): boolean => v >= 0.305 && v < 0.315;

describe(`${AC[8]} white metal in the white furnace and under one sun`, () => {
  it(`${AC[8]} in the furnace white metal at roughness 0, 0.5 and 1 reads 1 within 1% at every pixel; the planted uncompensated_lobe reads 1 − ln 2 ≈ 0.31 at the roughness 1 center and fails, naming metal_r100`, () => {
    requireMetal();
    const docs = ROUGH.map((r) => sphereDoc(`furnace-${ID(r)}`, ID(r), params(r), FURNACE_SKY, null));
    none(furnaceProblems(drawSpheres(bin(), dir(), docs)), 'white metal in the furnace');
    const planted = drawSpheres(bin(), dir(), docs, 'uncompensated_lobe');
    failsNaming(furnaceProblems(planted), [ID(1)], 'the planted uncompensated_lobe');
    const center = centerOf(planted[2]!);
    console.log(`${AC[8]}: --planted uncompensated_lobe: metal_r100's center reads ${center.toFixed(4)} in the furnace (1 − ln 2 = ${(1 - Math.LN2).toFixed(4)})`);
    expect(rounds(center), `--planted uncompensated_lobe: metal_r100's center reads 1 − ln 2 ≈ 0.31 in the furnace, got ${center.toFixed(4)}`).toBe(true);
  }, 1_800_000);

  it(`${AC[8]} under one sun behind the camera each white metal ball matches the compensated lobe's CPU reference within 1%; the planted compensates_environment_only reads 0.31 of it at the roughness 1 center and fails, naming metal_r100`, () => {
    requireMetal();
    const docs = ROUGH.map((r) => sphereDoc(`sun-${ID(r)}`, ID(r), params(r), DARK_SKY, sun(LUX, BEHIND)));
    none(sunProblems(drawSpheres(bin(), dir(), docs)), 'white metal under the sun');
    const planted = drawSpheres(bin(), dir(), docs, 'compensates_environment_only');
    failsNaming(sunProblems(planted), [ID(1)], 'the planted compensates_environment_only');
    const E = albedoTable(1);
    const ratio = centerOf(planted[2]!) / (CENTER.reduce((s, [x, y]) => s + reference(1, E, x, y)!, 0) / CENTER.length);
    expect(rounds(ratio), `--planted compensates_environment_only: metal_r100's center reads 0.31 of the reference, got ${ratio.toFixed(4)}`).toBe(true);
  }, 1_800_000);
});
