// AC1 #428.df10ac08: The Khronos samples SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by hash
// on first use and never committed, import with their sheen, anisotropy and diffuse transmission and render within 1% of
// a CPU reference of the same lobes on the same machine; in AnisotropyStrengthTest the roughness 1 column equals its
// strength 0 sphere within 1 code value, while at roughness 0.2 and strength 1 the highlight is at least 3 times longer
// along the tangent than across it; a sphere with wrap 0.5 goes dark 120° from its light, within 1°, where wrap 0 goes
// dark at 90°; and the white-furnace fixture with each lobe at full strength stays at or under 1 at every roughness and
// angle.
//
// Test 1, the samples (README: The Khronos samples; Readings): each fetched by hash and checked absent from HEAD and the
// index, drawn as one `mesh.asset@1` item with `imports: true` in the orthographic view `SAMPLE_VIEWS` names, tone map
// none: every material carrying KHR_materials_sheen, _anisotropy or _diffuse_transmission has the file's values on its
// `sheen`, `anisotropy` and `translucency` fields (helpers: `lobeFieldProblems`); every judged pixel (2 px inside its
// node, one triangle under all of it (helpers: `oneTriangleAt`; the owner's approved proposal on #1173, since at 4× MSAA a
// pixel where two triangles meet shades both at its centre), its material's inputs all read by the reference, the lobe
// wider than the pixel, its textures magnified) is within
// 1% per channel of `reference.ts`'s lobes at that pixel's ray (SheenChair's velvet and AnisotropyStrengthTest's spheres
// under a sun behind the camera; DiffuseTransmissionTest under its own light, behind its panels), each failure naming
// its material; and in AnisotropyStrengthTest, each sphere of the roughness 1 column (nodes 43 to 48, strengths 1/6 to
// 1) matches the strength 0 sphere (node 42) 160 px below it, pixel for pixel, within 1 code value of the final target.
// Test 2, the fixtures: a white metal ball (uv0 about the sphere, so u runs round its axis) at roughness 0.2 with
// anisotropy strength 1 under a sun behind the camera: through the highlight's peak, the run of pixels above half its
// luminance along the tangent (the frame's x) is at least 3 times the run across it (y); white balls with `wrap`
// translucency (amount 1) at wrap 0.5 and 0, lit by a sun from +x: along the centre row, the angle from the light where
// the ball goes dark (luminance under 0.2% of its peak) is 120° and 90°, within 1°; and in the white furnace, white balls
// with sheen (weight 1, white), anisotropy (strength 1, on white metal), thin translucency (amount 1) and wrap
// translucency (amount 1, wrap 1) at roughness 0, 0.25, 0.5, 0.75 and 1 never read above 1.01, the furnace's background 1.
// Wrong programs: the base (no lobe fields read, KHR_lights_punctual not read, so DiffuseTransmissionTest is refused
// `extension_required`); a lobe dropped on import or drawn off its published form; anisotropy that acts at roughness 1;
// a highlight stretched across the tangent, or not at all; a wrap that doesn't reach past the shadow line or reaches
// another angle; a lobe that adds energy.
import { describe, expect, it } from 'vitest';
import {
  AC, ASSET, DARK_SKY, FURNACE_SKY, SAMPLE_VIEWS, SPHERE_CAM, checkSample, drawSpheres, furnaceBackground, furnaceOver, importOf, khronos,
  lobeFieldProblems, none, px, requireMetal, sphereDoc, sun, useDir, useGpu, type Drawn, type JsonObject, type SampleRun,
} from './helpers.ts';
import { deg, dot, hitSphere, lum, pixelRay, type V3 } from './reference.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

/** Each roughness 1 sphere against the strength 0 one below it, pixel for pixel in the final target. */
function roughOneColumn(run: SampleRun): string[] {
  const failures: string[] = [];
  const base = `${ASSET}#42`;
  for (let k = 1; k <= 6; k++) {
    const other = `${ASSET}#${42 + k}`;
    let compared = 0; let worst = 0; let at = '';
    for (let y = 0; y < run.ids.height; y++) for (let x = 0; x < run.ids.width; x++) {
      if (run.ids.at(x, y) !== base || run.ids.at(x, y - 160 * k) !== other) continue;
      const a = px(run.final, x, y); const b = px(run.final, x, y - 160 * k);
      compared++;
      const off = Math.max(...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!)));
      if (off > worst) { worst = off; at = `(${x}, ${y}) ${a.join('/')} against (${x}, ${y - 160 * k}) ${b.join('/')}`; }
    }
    if (compared < 1000) failures.push(`AnisotropyStrengthTest: the roughness 1 sphere at strength ${k}/6 (node ${42 + k}) shares only ${compared} pixels with the strength 0 sphere 160·${k} px below it`);
    else if (worst > 1) failures.push(`AnisotropyStrengthTest material ${42 + k}: at roughness 1 and strength ${k}/6 it differs from the strength 0 sphere by ${worst} code values, at ${at}`);
  }
  return failures;
}

/** The pixels of `d`'s ball along the centre row, with the angle of each one's normal from `toward`. */
function rowAngles(d: Drawn, toward: V3): { x: number; angle: number; lum: number }[] {
  const y = Math.floor(SPHERE_CAM.size[1] / 2);
  const out: { x: number; angle: number; lum: number }[] = [];
  for (let x = 0; x < SPHERE_CAM.size[0]; x++) {
    if (d.ids.at(x, y) !== 'ball' || d.ids.at(x - 1, y) !== 'ball' || d.ids.at(x + 1, y) !== 'ball') continue;
    const p = hitSphere(SPHERE_CAM.position, pixelRay(SPHERE_CAM, x, y), [0, 0, 0], 1);
    if (!p) continue;
    out.push({ x, angle: deg(Math.acos(Math.max(-1, Math.min(1, dot(p, toward))))), lum: lum(d.linear.at(x, y)) });
  }
  return out;
}
/** The angle from the light where the row goes dark: between the last pixel above 0.2% of the peak and the first under. */
function darkAngle(d: Drawn, toward: V3): { angle: number; problems: string[] } {
  const row = rowAngles(d, toward).sort((a, b) => a.angle - b.angle);
  const peak = Math.max(...row.map((r) => r.lum));
  const dark = (r: { lum: number }): boolean => r.lum < 0.002 * peak;
  const firstDark = row.findIndex(dark);
  if (firstDark <= 0) return { angle: NaN, problems: [`${d.name}: no dark side along the centre row (${row.length} pixels, peak ${peak.toFixed(4)})`] };
  const problems: string[] = [];
  const lit = row.slice(firstDark).filter((r) => !dark(r));
  if (lit.length) problems.push(`${d.name}: lit again past where it goes dark, at ${lit.map((r) => `${r.angle.toFixed(1)}°`).slice(0, 5).join(', ')}`);
  return { angle: (row[firstDark - 1]!.angle + row[firstDark]!.angle) / 2, problems };
}

describe(`${ID} sheen, anisotropy and translucency`, () => {
  it(`${ID} SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by hash, import their lobes and render within 1% of the CPU reference; the roughness 1 column equals its strength 0 sphere within 1 code value`, async () => {
    requireMetal();
    const out = dir();
    const failures: string[] = [];
    for (const name of ['SheenChair', 'AnisotropyStrengthTest', 'DiffuseTransmissionTest'] as const) {
      const f = await khronos(name, out);
      const { run, reply } = checkSample(bin(), out, f, SAMPLE_VIEWS[name], undefined, true);
      failures.push(...lobeFieldProblems(f.gltf, importOf(reply, ASSET, name), name), ...run.failures);
      console.log(`${ID}: ${name}: judged ${[...run.judged.values()].reduce((a, b) => a + b, 0)} pixels over ${run.judged.size} materials`);
      if (name === 'AnisotropyStrengthTest') failures.push(...roughOneColumn(run));
    }
    none(failures, 'the three samples against their files and the CPU reference');
  }, 3_600_000);

  it(`${ID} an anisotropic highlight at roughness 0.2 is at least 3 times longer along the tangent; wrap 0.5 goes dark at 120° and wrap 0 at 90°, within 1°; each lobe at full strength stays at or under 1 in the white furnace`, () => {
    requireMetal();
    const out = dir();
    const white = { base_color: [1, 1, 1, 1], metallic: 0 };
    const roughs = [0, 0.25, 0.5, 0.75, 1];
    const furnace: { name: string; doc: JsonObject }[] = [];
    for (const r of roughs) {
      const tag = String(Math.round(r * 100)).padStart(3, '0');
      furnace.push(
        { name: `sheen_${tag}`, doc: sphereDoc(`sheen_${tag}`, { ...white, roughness: r, sheen: { weight: 1, color: [1, 1, 1, 1], roughness: r } }, FURNACE_SKY, null) },
        { name: `anisotropy_${tag}`, doc: sphereDoc(`anisotropy_${tag}`, { base_color: [1, 1, 1, 1], metallic: 1, roughness: r, anisotropy: { strength: 1 } }, FURNACE_SKY, null) },
        { name: `thin_${tag}`, doc: sphereDoc(`thin_${tag}`, { ...white, roughness: r, translucency: { kind: 'thin', amount: 1, color: [1, 1, 1, 1] } }, FURNACE_SKY, null) },
        { name: `wrap_${tag}`, doc: sphereDoc(`wrap_${tag}`, { ...white, roughness: r, translucency: { kind: 'wrap', amount: 1, wrap: 1, color: [1, 1, 1, 1] } }, FURNACE_SKY, null) },
      );
    }
    const lit = [
      { name: 'brushed', doc: sphereDoc('brushed', { base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.2, anisotropy: { strength: 1 } }, DARK_SKY, sun(Math.PI, [0, 0, 0])) },
      { name: 'wrap_half', doc: sphereDoc('wrap_half', { ...white, roughness: 1, specular_level: 0, translucency: { kind: 'wrap', amount: 1, wrap: 0.5 } }, DARK_SKY, sun(Math.PI, [0, 90, 0])) },
      { name: 'wrap_none', doc: sphereDoc('wrap_none', { ...white, roughness: 1, specular_level: 0, translucency: { kind: 'wrap', amount: 1, wrap: 0 } }, DARK_SKY, sun(Math.PI, [0, 90, 0])) },
    ];
    const drawn = drawSpheres(bin(), out, [...lit, ...furnace]);
    const failures: string[] = [];

    // The highlight's runs above half its peak, through the peak, along x (the tangent, round the ball's axis) and y.
    const b = drawn[0]!;
    let peak = 0; let px0 = 0; let py0 = 0;
    for (let y = 0; y < b.ids.height; y++) for (let x = 0; x < b.ids.width; x++) if (b.ids.at(x, y) === 'ball') { const l = lum(b.linear.at(x, y)); if (l > peak) { peak = l; px0 = x; py0 = y; } }
    const run = (dx: number, dy: number): number => { let n = 0; for (let k = 1; ; k++) { const x = px0 + dx * k; const y = py0 + dy * k; if (b.ids.at(x, y) !== 'ball' || lum(b.linear.at(x, y)) <= peak / 2) return n; n++; } };
    const along = 1 + run(1, 0) + run(-1, 0); const across = 1 + run(0, 1) + run(0, -1);
    console.log(`${ID}: the roughness 0.2, strength 1 highlight at (${px0}, ${py0}) runs ${along} px along the tangent and ${across} px across it`);
    if (along < 3 * across) failures.push(`brushed: the highlight runs ${along} px along the tangent and ${across} px across it, under 3 times`);

    for (const [d, want] of [[drawn[1]!, 120], [drawn[2]!, 90]] as const) {
      const { angle, problems } = darkAngle(d, [1, 0, 0]);
      failures.push(...problems);
      console.log(`${ID}: ${d.name} goes dark ${angle.toFixed(2)}° from its light`);
      if (!(Math.abs(angle - want) <= 1)) failures.push(`${d.name}: goes dark ${angle.toFixed(2)}° from its light, not ${want}° within 1°`);
    }
    for (const d of drawn.slice(3)) failures.push(...furnaceBackground(d), ...furnaceOver(d));
    none(failures, 'the anisotropic highlight, the wrap angles and the white furnace');
    expect(drawn.length).toBe(3 + furnace.length);
  }, 3_600_000);
});
