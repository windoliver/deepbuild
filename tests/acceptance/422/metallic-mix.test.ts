// AC9 #422.4f89df46: In the white furnace, spheres of base color 1 at metallic 0, 0.25, 0.5, 0.75 and 1 and roughness
// 0.5 never read above 1; at every pixel each part-metal sphere matches the same mix of the metallic 0 and metallic 1
// spheres within 1%; and a planted shading core that mixes metallic into one base reflectance before shading fails at
// the metallic 0.5 sphere, naming the material.
//
// Five balls (`metallic_000`, `metallic_025`, `metallic_050`, `metallic_075`, `metallic_100`: base color 1, roughness
// 0.5), each alone in the white furnace at the same place (README: Assumed surfaces). No pixel of any reads above 1 (at
// the criterion's 1%: 1.01, as pbrt-v4's BSDFEnergyConservation fails above 1.01). At every pixel where all three show
// the ball, the part-metal ball at m reads (1 − m) × the metallic 0 ball + m × the metallic 1 ball, per channel, within
// 1%: the glTF BRDF mixes its metal and dielectric lobes by metallic after each is shaded, so the furnace's reading is
// linear in m. `--planted premixed_metallic` (one F0 = mix(0.04, base, m) and diffuse (1 − m) × base, shaded once)
// fails, naming metallic_050.
// Wrong programs: the base (no environment: the furnace is dark); a premixed base reflectance, which dims the
// dielectric's diffuse by the metal's Fresnel; a mix that reflects more than it receives.
import { describe, it } from 'vitest';
import { AC, FURNACE_SKY, drawSpheres, failsNaming, furnaceBackground, none, requireMetal, sphereDoc, useDir, useGpu, type Drawn, type GpuPlanted } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const METALLIC = [0, 0.25, 0.5, 0.75, 1] as const;
const ID = (m: number): string => `metallic_${String(Math.round(m * 100)).padStart(3, '0')}`;

function mixProblems(planted?: GpuPlanted): string[] {
  const drawn: Drawn[] = drawSpheres(bin(), dir(), METALLIC.map((m) => sphereDoc(`mix-${ID(m)}`, ID(m), { base_color: [1, 1, 1, 1], metallic: m, roughness: 0.5 }, FURNACE_SKY, null)), planted);
  const problems: string[] = [];
  for (const [i, m] of METALLIC.entries()) {
    const d = drawn[i]!;
    problems.push(...furnaceBackground(d, ID(m)));
    let worst = 0; let at = '';
    for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
      if (d.ids.at(x, y) !== 'ball') continue;
      for (const v of d.linear.at(x, y)) if (v > worst) { worst = v; at = `(${x}, ${y})`; }
    }
    if (worst > 1.01) problems.push(`${ID(m)}: reads ${worst.toFixed(4)} at ${at}, above 1`);
  }
  const [zero, one] = [drawn[0]!, drawn[4]!];
  for (const [i, m] of METALLIC.entries()) {
    if (m === 0 || m === 1) continue;
    const d = drawn[i]!;
    let n = 0; let off = 0; let worst = 0; let at = '';
    for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
      if (d.ids.at(x, y) !== 'ball' || zero.ids.at(x, y) !== 'ball' || one.ids.at(x, y) !== 'ball') continue;
      n++;
      const got = d.linear.at(x, y); const a = zero.linear.at(x, y); const b = one.linear.at(x, y);
      let bad = false;
      for (let c = 0; c < 3; c++) {
        const want = (1 - m) * a[c]! + m * b[c]!;
        const rel = Math.abs(got[c]! - want) / Math.max(want, 1e-6);
        if (rel > 0.01) bad = true;
        if (rel > worst) { worst = rel; at = `(${x}, ${y}) channel ${'rgb'[c]}: ${got[c]!.toFixed(5)} against the mix ${want.toFixed(5)}`; }
      }
      if (bad) off++;
    }
    console.log(`${AC[9]}${planted ? ` (--planted ${planted})` : ''}: ${ID(m)}: ${n} px, ${off} off the mix by over 1%, worst ${(worst * 100).toFixed(3)}% at ${at}`);
    if (n < 20_000) problems.push(`${ID(m)}: only ${n} px shared by the three balls; the fixture needs 20,000`);
    if (off > 0) problems.push(`${ID(m)}: ${off} of ${n} px are off the mix of metallic_000 and metallic_100 by over 1%; worst ${(worst * 100).toFixed(2)}% at ${at}`);
  }
  return problems;
}

describe(`${AC[9]} part-metal spheres in the white furnace`, () => {
  it(`${AC[9]} metallic 0 to 1 at roughness 0.5 never read above 1, each part-metal ball is the mix of the pure ones within 1% at every pixel, and the planted premixed_metallic fails, naming metallic_050`, () => {
    requireMetal();
    none(mixProblems(), 'the part-metal balls');
    failsNaming(mixProblems('premixed_metallic'), [ID(0.5)], 'the planted premixed_metallic');
  }, 1_800_000);
});
