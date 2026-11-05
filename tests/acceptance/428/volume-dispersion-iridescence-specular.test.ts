// AC2 #428.7a966fa8: The Khronos samples AttenuationTest, DispersionTest, IridescenceDielectricSpheres and SpecularTest,
// fetched by hash on first use and never committed, import with their volume, dispersion, iridescence and specular
// strength and color on their fields and render within 1% of a CPU reference of the same lobes on the same machine; each
// lists in `dropped` nothing but its lobes' own textures (AttenuationTest's thickness texture, SpecularTest's specular and
// specular color textures); and the white-furnace fixture with each of the four lobes at full strength stays at or
// under 1 at every roughness and angle; a planted import that leaves KHR_materials_dispersion in `dropped` draws
// DispersionTest's prisms without their fringes and fails, naming the material.
//
// Test 1, the samples (README: The Khronos samples; Readings), each fetched by hash, checked never committed and drawn
// with `imports: true` in its `SAMPLE_VIEWS` view, tone map none:
// - fields: `transmission`, `ior`, `absorption {thickness, attenuation {color, distance}}`, `dispersion`,
//   `iridescence {weight, ior, thickness}`, `specular_level` (glTF's strength ÷ 2) and `specular_color` as each file
//   gives them (helpers: `lobeFieldProblems`);
// - `dropped`: exactly AttenuationTest material 6's KHR_materials_volume/thicknessTexture and SpecularTest materials 6,
//   12 and 18's KHR_materials_specular/specularTexture, /specularColorTexture and /specularColorTexture, nothing else;
// - render: AttenuationTest over a white backdrop (unlit, between its blocks and its own grid) and DispersionTest over
//   white lines 1 mm wide every 3 mm on black (unlit, just behind the prisms), both with no light; every judged pixel
//   within 1% per channel of the raster transmission model (1 − F(n·v)) × base × attenuation × the opaque copy at each
//   channel's transmitted point, where the copy is flat; IridescenceDielectricSpheres' front spheres under a sun behind
//   the camera within 1% per pixel; SpecularTest's spheres, all at roughness 0, judged by their mirror flux (README:
//   Readings): Σ radiance × pixel area over each factor sphere = F0 × E × R² ÷ 4 within 1%, F0 the extension's weight ×
//   min(F0(ior) × specular color, 1), R 5 cm, E π lx;
// - `--planted drops_dispersion`: DispersionTest's render fails, naming `Mat_IOR_1.50_D5`.
// Test 2, the furnace: white balls with volume (transmission 1, thickness 2, AttenuationTest's attenuation), dispersion
// (transmission 1, thickness 2, dispersion 5), iridescence (weight 1, ior 1.3, 400 nm) and specular color at its
// strongest (25, which raises F0 to 1) at roughness 0, 0.25, 0.5, 0.75 and 1: no pixel above 1.01, the background 1.
// Wrong programs: the base (none of these extensions read: each is listed whole in `dropped`); a lobe off its field or
// drawn off its published form; a lobe texture dropped silently or a lobe dropped; a lobe that adds energy.
import { describe, it } from 'vitest';
import {
  AC, ASSET, FURNACE_SKY, SAMPLE_VIEWS, checkSample, drawSpheres, failsNaming, furnaceBackground, furnaceOver, importOf, khronos,
  lobeFieldProblems, nodeFlux, none, requireMetal, sphereDoc, useDir, useGpu, type Fetched, type Imported, type JsonObject,
} from './helpers.ts';
import { dielectricF0, gltfMaterial, nodeName } from './reference.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();

/** The lobe textures each sample may list in `dropped`, by material index; nothing else may be there, and these must be. */
const ALLOWED: Record<string, Record<number, string[]>> = {
  AttenuationTest: { 6: ['KHR_materials_volume/thicknessTexture'] },
  DispersionTest: {},
  IridescenceDielectricSpheres: {},
  SpecularTest: { 6: ['KHR_materials_specular/specularTexture'], 12: ['KHR_materials_specular/specularColorTexture'], 18: ['KHR_materials_specular/specularColorTexture'] },
};
function droppedProblems(f: Fetched, im: Imported): string[] {
  const allowed = ALLOWED[f.sample.name]!;
  const names = (f.gltf.json['materials'] as JsonObject[]).map((mm) => mm['name']);
  const indexOf = (mat: unknown): number => (typeof mat === 'number' ? mat : names.indexOf(mat as string));
  const problems: string[] = [];
  for (const d of im.dropped) {
    const i = indexOf(d.material);
    if (!(allowed[i] ?? []).some((a) => d.input === a)) problems.push(`${f.sample.name}: material ${String(d.material)} lists ${d.input} in dropped, which isn't one of its lobes' own textures`);
  }
  for (const [i, inputs] of Object.entries(allowed)) for (const a of inputs) {
    if (!im.dropped.some((d) => indexOf(d.material) === Number(i) && d.input === a)) problems.push(`${f.sample.name}: material ${i} doesn't list ${a} in dropped; a texture the import can't hold is never dropped silently`);
  }
  return problems;
}
/** SpecularTest's factor spheres by their mirror flux (README: Readings). */
function specularFlux(f: Fetched, run: Parameters<typeof nodeFlux>[0]): string[] {
  const view = SAMPLE_VIEWS.SpecularTest.view;
  const R = 0.05; const E = Math.PI;
  const out: string[] = [];
  for (const node of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]) {
    const mat = gltfMaterial(f.gltf, node);
    const f0 = dielectricF0(mat.lobes).map((c) => c * mat.lobes.specular);
    const got = nodeFlux(run, view, `${ASSET}#${nodeName(f.gltf, node)}`);
    for (let c = 0; c < 3; c++) {
      const want = (f0[c]! * E * R * R) / 4; const floor = (0.04 * E * R * R) / 4;
      if (Math.abs(got[c]! - want) > 0.01 * Math.max(want, floor)) out.push(`SpecularTest material ${mat.name} (#${node}): mirror flux ${got[c]!.toExponential(4)} in channel ${c}, the reference ${want.toExponential(4)} (F0 ${f0[c]!.toFixed(4)})`);
    }
  }
  return out;
}

describe(`${ID} volume, dispersion, iridescence and specular color`, () => {
  it(`${ID} AttenuationTest, DispersionTest, IridescenceDielectricSpheres and SpecularTest import their lobes, drop only their lobes' textures and render within 1% of the CPU reference; a planted import that drops dispersion fails, naming the material`, async () => {
    requireMetal();
    const out = dir();
    const failures: string[] = [];
    for (const name of ['AttenuationTest', 'DispersionTest', 'IridescenceDielectricSpheres', 'SpecularTest'] as const) {
      const f = await khronos(name, out);
      const { run, reply } = checkSample(bin(), out, f, SAMPLE_VIEWS[name]);
      const im = importOf(reply, ASSET, name);
      failures.push(...lobeFieldProblems(f.gltf, im, name), ...droppedProblems(f, im), ...run.failures);
      if (name === 'SpecularTest') failures.push(...specularFlux(f, run));
      console.log(`${ID}: ${name}: judged ${[...run.judged.values()].reduce((a, b) => a + b, 0)} pixels over ${run.judged.size} materials`);
    }
    none(failures, 'the four samples against their files and the CPU reference');

    const f = await khronos('DispersionTest', out);
    const planted = checkSample(bin(), out, f, SAMPLE_VIEWS.DispersionTest, 'drops_dispersion');
    failsNaming(planted.run.failures, ['Mat_IOR_1.50_D5'], '--planted drops_dispersion');
  }, 3_600_000);

  it(`${ID} the white furnace with volume, dispersion, iridescence and specular color at full strength stays at or under 1 at every roughness and angle`, () => {
    requireMetal();
    const out = dir();
    const glass = { base_color: [1, 1, 1, 1], metallic: 0, transmission: 1, ior: 1.5 };
    const docs: { name: string; doc: JsonObject }[] = [];
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const tag = String(Math.round(r * 100)).padStart(3, '0');
      const mats: Record<string, JsonObject> = {
        [`volume_${tag}`]: { ...glass, roughness: r, absorption: { thickness: 2, attenuation: { color: [0.1, 0.5, 0.9], distance: 1 } } },
        [`dispersion_${tag}`]: { ...glass, roughness: r, absorption: { thickness: 2 }, dispersion: 5 },
        [`iridescence_${tag}`]: { base_color: [1, 1, 1, 1], metallic: 0, roughness: r, iridescence: { weight: 1, ior: 1.3, thickness: 400 } },
        [`specular_color_${tag}`]: { base_color: [1, 1, 1, 1], metallic: 0, roughness: r, specular_color: [25, 25, 25] },
      };
      for (const [name, mat] of Object.entries(mats)) docs.push({ name, doc: sphereDoc(name, mat, FURNACE_SKY, null) });
    }
    const failures: string[] = [];
    for (const d of drawSpheres(bin(), out, docs)) failures.push(...furnaceBackground(d), ...furnaceOver(d));
    none(failures, 'the four lobes in the white furnace');
  }, 3_600_000);
});
