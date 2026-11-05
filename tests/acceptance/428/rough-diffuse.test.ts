// AC5 #428.657b57c7: Rough diffuse keeps its energy: in a white furnace, white dielectric spheres with specular_level 0
// at diffuse_roughness 0.5 and 1 read the same as at 0 within 1% at every pixel, and lit by one sun behind the camera the
// sphere at 1 matches a CPU reference of the energy-preserving Oren-Nayar lobe within 1% at 10 points from centre to
// limb; a planted Lambert lobe misses the reference toward the limb, and a planted Oren-Nayar without energy
// compensation reads darker in the furnace, and each fails, naming the material.
//
// Test 1, the furnace: `clay_000`, `clay_050`, `clay_100` (base color 1, metallic 0, specular_level 0, diffuse_roughness
// 0, 0.5, 1) on #422's sphere fixture in the white furnace: the background 1 within 1%, and at every pixel all three show
// the ball, each channel of `clay_050` and `clay_100` within 1% of `clay_000`'s. `--planted oren_nayar_uncompensated`
// (FON's single scattering alone) fails naming `clay_100`.
// Test 2, the sun: `clay_100` under a π lx sun shining along the view: at 10 pixels on the centre row from the ball's
// centre to 3 px inside its limb, evenly spaced, each channel within 1% of `reference.ts`'s EON (KHR_materials_diffuse_
// roughness, as OpenPBR writes it: FON's single scattering plus its multiple-scattering lobe) at that pixel's ray.
// `--planted diffuse_lambert` fails naming `clay_100`, at a point toward the limb.
// Wrong programs: the base (Lambert only); Oren-Nayar's original or FON without the compensation; another roughness map.
import { describe, expect, it } from 'vitest';
import { AC, DARK_SKY, FURNACE_SKY, SPHERE_CAM, drawSpheres, failsNaming, furnaceBackground, none, requireMetal, sphereDoc, sun, useDir, useGpu, type GpuPlanted } from './helpers.ts';
import { LOBES, brdfCos, hitSphere, onb, pixelRay, unit, type Lobes } from './reference.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const clay = (r: number): Record<string, number | number[]> => ({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.5, specular_level: 0, diffuse_roughness: r });

function furnace(planted?: GpuPlanted): string[] {
  const out = dir();
  const drawn = drawSpheres(bin(), out, [0, 0.5, 1].map((r) => { const name = `clay_${String(r * 100).padStart(3, '0')}`; return { name, doc: sphereDoc(name, clay(r), FURNACE_SKY, null) }; }), planted);
  const failures = drawn.flatMap(furnaceBackground);
  const [z, ...others] = drawn;
  for (const d of others) {
    let worst = 0; let at = ''; let n = 0;
    for (let y = 0; y < z!.ids.height; y++) for (let x = 0; x < z!.ids.width; x++) {
      if (z!.ids.at(x, y) !== 'ball' || d.ids.at(x, y) !== 'ball') continue;
      n++;
      const a = z!.linear.at(x, y); const b = d.linear.at(x, y);
      for (let c = 0; c < 3; c++) { const off = Math.abs(b[c]! - a[c]!) / a[c]!; if (off > worst) { worst = off; at = `(${x}, ${y}) channel ${c}: ${b[c]!.toFixed(4)} against ${a[c]!.toFixed(4)}`; } }
    }
    expect(n, `${d.name}: the ball's pixels`).toBeGreaterThan(10_000);
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${d.name} in the furnace, worst ${(worst * 100).toFixed(2)}% off clay_000 at ${at}`);
    if (worst > 0.01) failures.push(`${d.name}: in the white furnace it doesn't read as clay_000 within 1%: ${(worst * 100).toFixed(2)}% off at ${at}`);
  }
  return failures;
}

function sunlit(planted?: GpuPlanted): string[] {
  const out = dir();
  const [d] = drawSpheres(bin(), out, [{ name: 'clay_100', doc: sphereDoc('clay_100', clay(1), DARK_SKY, sun(Math.PI, [0, 0, 0])) }], planted);
  const y = SPHERE_CAM.size[1] / 2;
  const cx = SPHERE_CAM.size[0] / 2;
  let limb = cx; while (d!.ids.at(limb + 1, y) === 'ball') limb++;
  const m: Lobes = { ...LOBES, base: [1, 1, 1], specular: 0, diffuseRoughness: 1 };
  const failures: string[] = [];
  for (let k = 0; k < 10; k++) {
    const x = cx + Math.round((k * (limb - 3 - cx)) / 9);
    const ray = pixelRay(SPHERE_CAM, x, y); const p = hitSphere(SPHERE_CAM.position, ray, [0, 0, 0], 1);
    expect(p, `point ${k} at (${x}, ${y}) is on the ball`).not.toBeNull();
    const n = unit(p!); const [t, b] = onb(n);
    const ref = brdfCos(m, { n, t, b }, [-ray[0], -ray[1], -ray[2]], [0, 0, 1]).map((v) => v * Math.PI);
    const got = d!.linear.at(x, y);
    const off = Math.max(...[0, 1, 2].map((c) => Math.abs(got[c]! - ref[c]!) / ref[c]!));
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: clay_100 point ${k} (${x}, ${y}): ${got[1].toFixed(4)}, EON ${ref[1]!.toFixed(4)}`);
    if (off > 0.01) failures.push(`clay_100: point ${k} of 10 from centre to limb (${x}, ${y}) reads ${got.map((v) => v.toFixed(4)).join(', ')}, the EON reference ${ref.map((v) => v.toFixed(4)).join(', ')} (${(off * 100).toFixed(2)}% off)`);
  }
  return failures;
}

describe(`${ID} rough diffuse keeps its energy`, () => {
  it(`${ID} in the white furnace, diffuse_roughness 0.5 and 1 read as 0 within 1% at every pixel; a planted uncompensated Oren-Nayar reads darker and fails, naming the material`, () => {
    requireMetal();
    none(furnace(), 'rough diffuse in the white furnace');
    failsNaming(furnace('oren_nayar_uncompensated'), ['clay_100'], '--planted oren_nayar_uncompensated');
  }, 3_600_000);

  it(`${ID} under one sun behind the camera, diffuse_roughness 1 matches the energy-preserving Oren-Nayar lobe within 1% at 10 points from centre to limb; a planted Lambert lobe misses toward the limb and fails, naming the material`, () => {
    requireMetal();
    none(sunlit(), 'rough diffuse under the sun');
    failsNaming(sunlit('diffuse_lambert'), ['clay_100: point 9'], '--planted diffuse_lambert');
  }, 3_600_000);
});
