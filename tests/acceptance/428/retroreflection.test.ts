// AC6 #428.1da426e1: Retroreflection sends light back: a flat white metal panel (base color 1, metallic 1) at roughness
// 0.3 and retroreflection 1, lit only by a point light at the camera and turned 0°, 20°, 40° and 60° from facing it,
// matches at its centre a CPU reference of the lobe with the view mirrored about the normal within 1%, and in the white
// furnace stays at or under 1; at 0° it equals the panel at retroreflection 0 within 1%; and a planted panel that
// ignores retroreflection reads under 1% of the reference at 40° and fails, naming the material.
//
// Test 1, the point light: `retro_100` (base color 1, metallic 1, roughness 0.3, retroreflection 1) on a 1 m panel
// (a box 1 cm deep) turned about y, the camera 3 m in front of it (fov 30° on 320 × 320) and a point light of 36π lm
// (9 cd: 1 lx at 3 m) at the camera with no radius: the mean of the 2 × 2 centre pixels, per channel, within 1% of the
// mean of `reference.ts`'s compensated GGX lobe at v mirrored about n at those pixels' rays (each pixel's own v, l and
// 1 ÷ d²); at 0° the same panel in `retro_000` (retroreflection 0) within 1% of `retro_100`. `--planted
// retroreflection_ignored`: at 40° `retro_100` reads under 1% of the reference, and the check fails naming it.
// Test 2, the furnace: `retro_100` at the four angles in the white furnace: no panel pixel above 1.01, the background 1.
// Wrong programs: the base (no retroreflection); a mirrored lobe that isn't the lobe's, or that adds energy; one mixed
// in at 0 or ignored.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, FURNACE_SKY, PLAIN_LOOK, box, camera, failsNaming, frameAt, framesOf, furnaceBackground, furnaceOver, material, none, pointLight,
  readIds, readLinear, readPng, requireMetal, runGpu, sessionDoc, useDir, useGpu, view3dCall, writeJson, type Drawn, type GpuPlanted, type JsonObject,
} from './helpers.ts';
import { LOBES, add, brdfCos, dot, pixelRay, rotate, scale, sub, unit, type Lobes, type Pinhole, type Rgb, type V3 } from './reference.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();
const CAM: Pinhole = { position: [0, 0, 3], target: [0, 0, 0], fov: 30, size: [320, 320] };
const ANGLES = [0, 20, 40, 60];
const POWER = 36 * Math.PI;
const metal = (retro: number): JsonObject => material({ base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.3, retroreflection: retro });
function panelDoc(name: string, angle: number, sky: JsonObject, lit: boolean): JsonObject {
  return sessionDoc(`${name}-${angle}`, CAM.size, {
    cam: camera(CAM.position, CAM.target, CAM.fov), sky, [name]: metal(name === 'retro_100' ? 1 : 0),
    panel: box([1, 1, 0.01], [0, 0, 0], name, [0, angle, 0]), ...(lit ? { lamp: pointLight(POWER, CAM.position) } : {}),
  });
}
function draw(planted: GpuPlanted | undefined, docs: { name: string; doc: JsonObject }[]): Drawn[] {
  const out = dir();
  return runGpu(bin(), out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `panel-${i}`, d.doc), look: PLAIN_LOOK, size: CAM.size, targets: ['final', 'linear', 'ids'] })), planted).map((r, i) => {
    const f = frameAt(framesOf(r, docs[i]!.name), 0, docs[i]!.name);
    return { name: docs[i]!.name, linear: readLinear(out, f.linear, CAM.size, docs[i]!.name), final: readPng(out, f.final, docs[i]!.name), ids: readIds(out, f, docs[i]!.name) };
  });
}
const CENTRE: [number, number][] = [[159, 159], [160, 159], [159, 160], [160, 160]];
/** The panel's centre in the frame and in the CPU reference (each pixel's own ray to the panel's front face). */
function centre(d: Drawn, angle: number, retro: number): { got: Rgb; ref: Rgb } {
  const n = rotate([0, angle, 0], [0, 0, 1]); const face: V3 = scale(n, 0.005);
  const m: Lobes = { ...LOBES, base: [1, 1, 1], metallic: 1, roughness: 0.3 };
  const I = POWER / (4 * Math.PI);
  const got: Rgb = [0, 0, 0]; const ref: Rgb = [0, 0, 0];
  for (const [x, y] of CENTRE) {
    expect(d.ids.at(x, y), `${d.name}: the centre pixel (${x}, ${y}) shows the panel`).toBe('panel');
    const ray = pixelRay(CAM, x, y);
    const p = add(CAM.position, scale(ray, dot(sub(face, CAM.position), n) / dot(ray, n)));
    const toCam = sub(CAM.position, p); const d2 = dot(toCam, toCam);
    const v = unit(toCam); const t = unit(rotate([0, angle, 0], [1, 0, 0]));
    const f = brdfCos(m, { n, t, b: [0, 1, 0] }, v, v, retro);
    const g = d.linear.at(x, y);
    for (let c = 0; c < 3; c++) { ref[c] = ref[c]! + (f[c]! * I) / d2 / 4; got[c] = got[c]! + g[c]! / 4; }
  }
  return { got, ref };
}
function lit(planted?: GpuPlanted): { failures: string[]; at40: { got: Rgb; ref: Rgb } } {
  const drawn = draw(planted, [...ANGLES.map((a) => ({ name: 'retro_100', doc: panelDoc('retro_100', a, DARK_SKY, true) })), { name: 'retro_000', doc: panelDoc('retro_000', 0, DARK_SKY, true) }]);
  const failures: string[] = [];
  let at40: { got: Rgb; ref: Rgb } = { got: [0, 0, 0], ref: [0, 0, 0] };
  ANGLES.forEach((a, i) => {
    const r = centre(drawn[i]!, a, 1);
    if (a === 40) at40 = r;
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: retro_100 at ${a}°: ${r.got.map((v) => v.toFixed(5)).join(', ')}, the mirrored lobe ${r.ref.map((v) => v.toFixed(5)).join(', ')}`);
    const off = Math.max(...[0, 1, 2].map((c) => Math.abs(r.got[c]! - r.ref[c]!) / r.ref[c]!));
    if (off > 0.01) failures.push(`retro_100: turned ${a}°, its centre reads ${r.got[1]!.toFixed(5)}, not within 1% of the mirrored lobe's ${r.ref[1]!.toFixed(5)}`);
  });
  const z = centre(drawn[0]!, 0, 1).got; const plain = centre(drawn[4]!, 0, 0).got;
  if ([0, 1, 2].some((c) => Math.abs(z[c]! - plain[c]!) > 0.01 * plain[c]!)) failures.push(`retro_100: at 0° it reads ${z[1]!.toFixed(5)}, not within 1% of retro_000's ${plain[1]!.toFixed(5)}`);
  return { failures, at40 };
}

describe(`${ID} retroreflection sends light back`, () => {
  it(`${ID} a white metal panel with retroreflection 1, lit from the camera, matches the mirrored-view lobe within 1% at 0°, 20°, 40° and 60°, and equals retroreflection 0 at 0°; a planted panel that ignores it reads under 1% at 40° and fails, naming the material`, () => {
    requireMetal();
    none(lit().failures, 'the retroreflective panel');
    const planted = lit('retroreflection_ignored');
    expect(planted.at40.got[1], '--planted retroreflection_ignored: at 40° the panel reads under 1% of the reference').toBeLessThan(0.01 * planted.at40.ref[1]);
    failsNaming(planted.failures, ['retro_100: turned 40°'], '--planted retroreflection_ignored');
  }, 3_600_000);

  it(`${ID} in the white furnace the retroreflective panel stays at or under 1 at every angle`, () => {
    requireMetal();
    const failures = draw(undefined, ANGLES.map((a) => ({ name: `retro_100 at ${a}°`, doc: panelDoc('retro_100', a, FURNACE_SKY, false) }))).flatMap((d) => [...furnaceBackground(d), ...furnaceOver(d, 'panel')]);
    none(failures, 'the retroreflective panel in the white furnace');
  }, 3_600_000);
});
