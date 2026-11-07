// AC1 #428.df10ac08: The Khronos samples SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by
// hash on first use and never committed, import with their sheen, anisotropy and diffuse transmission and render
// within 1% of a CPU reference of the same lobes on the same machine; in AnisotropyStrengthTest the roughness 1 column
// equals its strength 0 sphere within 1 code value, while at roughness 0.2 and strength 1 the highlight is at least 3
// times longer along the tangent than across it; a sphere with wrap 0.5 goes dark 120° from its light, within 1°,
// where wrap 0 goes dark at 90°; and the white-furnace fixture with each lobe at full strength stays at or under 1 at
// every roughness and angle.
//
// Eight tests, one per clause (REDRAFT.md: Clauses to tests). Every number is read from the renderer's own targets:
// the linear f32 target for every lobe value and angle, the final 8-bit target for "1 code value", the object-ID target
// for which part a pixel shows. The CPU reference is `lobes.ts`, from the published texts, at each pixel's own ray.
// Off macOS every test fails INCONCLUSIVE before it draws; a sample neither cached nor reachable is BLOCKED.
import { describe, expect, it } from 'vitest';
import {
  AC1, DARK_SKY, FURNACE_SKY, PLAIN_LOOK, answered, arr, ball, dot, frame0, hitSphere, insideBy, isObject, khronos, list,
  lum, material, nodeAsset, nodeMaterial, nodeTriangles, none, num, obj, ortho, orthoCaster, orthoWorld, perspective,
  pixel, pixelRay, readIds, readLinear, readPng, requireMetal, runGpu, scale, sceneAsset, sessionDoc, shown, sun,
  towardSun, view3dCall, worlds, writeJson, useDir, useGpu,
  type Fetched, type Gltf, type Ids, type JsonObject, type JsonValue, type Linear, type Ortho, type Pinhole, type Rgb,
  type V3,
} from './helpers.ts';
import { shade, type Lobes } from './lobes.ts';

const bin = useGpu();
const dir = useDir();
const LONG = 3_600_000;

const SHEEN = 'KHR_materials_sheen';
const ANISO = 'KHR_materials_anisotropy';
const DT = 'KHR_materials_diffuse_transmission';
const deg = (r: number): number => (r * 180) / Math.PI;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
const rgb = (v: JsonValue | undefined, fallback: Rgb): Rgb => (Array.isArray(v) ? [Number(v[0]), Number(v[1]), Number(v[2])] : fallback);
const fmt = (c: readonly number[]): string => `[${c.map((v) => v.toPrecision(5)).join(', ')}]`;

/** A material's glTF extension body, or null. */
function ext(m: JsonObject, name: string): JsonObject | null {
  const e = m['extensions'];
  return isObject(e) && isObject(e[name]) ? e[name] : null;
}
const pbr = (m: JsonObject): JsonObject => (isObject(m['pbrMetallicRoughness']) ? m['pbrMetallicRoughness'] : {});
/** The lobes of glTF material `m` as its file declares them (REDRAFT.md: The CPU reference reads the file). */
function fileLobes(m: JsonObject): Lobes {
  const p = pbr(m);
  const out: Lobes = { base: rgb(p['baseColorFactor'], [1, 1, 1]), metallic: (p['metallicFactor'] as number | undefined) ?? 1, roughness: (p['roughnessFactor'] as number | undefined) ?? 1, specularWeight: 1 };
  const s = ext(m, SHEEN);
  if (s) out.sheen = { color: rgb(s['sheenColorFactor'], [0, 0, 0]), roughness: (s['sheenRoughnessFactor'] as number | undefined) ?? 0 };
  const a = ext(m, ANISO);
  if (a) out.anisotropy = { strength: (a['anisotropyStrength'] as number | undefined) ?? 0, rotation: deg((a['anisotropyRotation'] as number | undefined) ?? 0) };
  const d = ext(m, DT);
  if (d) out.thin = { amount: (d['diffuseTransmissionFactor'] as number | undefined) ?? 0, color: rgb(d['diffuseTransmissionColorFactor'], [1, 1, 1]) };
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The import (REDRAFT.md: Assumed surfaces 1–3)

interface Imported { materials: Map<number, JsonObject>; dropped: { material: JsonValue; input: string }[] }
function importOf(reply: JsonObject, item: string, what: string): Imported {
  answered(reply, what);
  const entries = arr(reply['imports'], `${what}: imports`).map((e, i) => obj(e, `${what}: imports[${i}]`));
  const e = entries.find((x) => x['item'] === item);
  expect(e, `${what}: imports has an entry for ${item}, got ${shown(reply['imports'])}`).toBeDefined();
  const materials = new Map<number, JsonObject>();
  for (const [i, v] of arr(e!['materials'], `${what}: materials`).entries()) {
    const m = obj(v, `${what}: materials[${i}]`);
    materials.set(num(m['index'], `${what}: materials[${i}].index`), obj(m['params'], `${what}: materials[${i}].params`));
  }
  const dropped = arr(e!['dropped'] ?? [], `${what}: dropped`).map((d, i) => { const o = obj(d, `${what}: dropped[${i}]`); return { material: o['material'] ?? null, input: String(o['input']) }; });
  return { materials, dropped };
}
/** A color field as the import wrote it: an array, or `base` (the part's base color), or absent (`fallback`). */
function colorField(v: JsonValue | undefined, base: Rgb, fallback: 'base' | Rgb): Rgb {
  if (v === undefined || v === null) return fallback === 'base' ? base : fallback;
  if (v === 'base') return base;
  return rgb(v, [NaN, NaN, NaN]);
}
/** Every sheen, anisotropy and diffuse transmission the file declares, and the base numbers the lobes ride on,
 * against the import's `material@1` fields; and nothing of those lobes but their own textures in `dropped`. */
function lobeImportProblems(g: Gltf, im: Imported, model: string): string[] {
  const problems: string[] = [];
  for (const [i, m] of list(g, 'materials').entries()) {
    const used = [SHEEN, ANISO, DT].filter((e) => ext(m, e));
    if (used.length === 0) continue;
    const at = `${model} material ${i} (${(m['name'] as string | undefined) ?? 'unnamed'})`;
    const p = im.materials.get(i);
    if (!p) { problems.push(`${at}: not in the import`); continue; }
    const want = fileLobes(m);
    const base = colorField(p['base_color'], [NaN, NaN, NaN], [NaN, NaN, NaN]);
    if (!want.base.every((c, k) => close(base[k]!, c))) problems.push(`${at}: base_color ${shown(p['base_color'])}, the file declares ${fmt(want.base)}`);
    if (!close(Number(p['metallic']), want.metallic)) problems.push(`${at}: metallic ${shown(p['metallic'])}, the file declares ${want.metallic}`);
    if (!close(Number(p['roughness']), want.roughness)) problems.push(`${at}: roughness ${shown(p['roughness'])}, the file declares ${want.roughness}`);
    if (want.sheen) {
      const s = isObject(p['sheen']) ? p['sheen'] : {};
      const weight = (s['weight'] as number | undefined) ?? 0;
      const color = colorField(s['color'], base, 'base').map((c) => c * weight);
      const rough = (s['roughness'] as number | undefined) ?? 0.5;
      if (!want.sheen.color.every((c, k) => close(color[k]!, c))) problems.push(`${at}: sheen weight × color is ${fmt(color)} (sheen ${shown(p['sheen'])}), the file's sheenColorFactor is ${fmt(want.sheen.color)}`);
      if (!close(rough, want.sheen.roughness)) problems.push(`${at}: sheen roughness ${rough}, the file's sheenRoughnessFactor is ${want.sheen.roughness}`);
    }
    if (want.anisotropy) {
      const a = isObject(p['anisotropy']) ? p['anisotropy'] : {};
      const strength = (a['strength'] as number | undefined) ?? 0; const rotation = (a['rotation'] as number | undefined) ?? 0;
      if (!close(strength, want.anisotropy.strength)) problems.push(`${at}: anisotropy strength ${strength}, the file's anisotropyStrength is ${want.anisotropy.strength}`);
      if (Math.abs(rotation - want.anisotropy.rotation) > 1e-4) problems.push(`${at}: anisotropy rotation ${rotation}°, the file's anisotropyRotation is ${want.anisotropy.rotation}°`);
    }
    if (want.thin) {
      const t = isObject(p['translucency']) ? p['translucency'] : {};
      const kind = (t['kind'] as string | undefined) ?? 'thin'; const amount = (t['amount'] as number | undefined) ?? 0;
      const color = colorField(t['color'], base, 'base');
      if (kind !== 'thin') problems.push(`${at}: translucency kind ${kind}; KHR_materials_diffuse_transmission is the thin kind`);
      if (!close(amount, want.thin.amount)) problems.push(`${at}: translucency amount ${amount}, the file's diffuseTransmissionFactor is ${want.thin.amount}`);
      if (!want.thin.color.every((c, k) => close(color[k]!, c))) problems.push(`${at}: translucency color ${fmt(color)} (translucency ${shown(p['translucency'])}), the file's diffuseTransmissionColorFactor is ${fmt(want.thin.color)}`);
    }
    // The lobe is read, so its extension is never listed as dropped; a texture inside it no field holds is.
    const mine = im.dropped.filter((d) => d.material === i || d.material === m['name']);
    for (const e of used) {
      const body = ext(m, e)!;
      const textures = Object.entries(body).filter(([, v]) => isObject(v) && typeof v['index'] === 'number').map(([k]) => k);
      for (const d of mine.filter((x) => x.input.startsWith(e))) {
        if (!textures.some((k) => d.input === `${e}/${k}`)) problems.push(`${at}: dropped lists ${d.input}: the lobe is lost, though the import reads ${e}`);
      }
      for (const k of textures) if (!mine.some((d) => d.input.includes(k))) problems.push(`${at}: ${e}.${k} is neither kept nor listed in dropped`);
    }
  }
  return problems;
}

/** The import's own fields for material `i` with its texture maps taken out (REDRAFT.md: SheenChair's lobes). */
function withoutMaps(p: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !['maps', 'normal_map', 'normal_scale', 'occlusion_strength'].includes(k)));
}

// ---------------------------------------------------------------------------------------------------
// Fixtures

/** #422's sphere fixture: one ball of radius 1 at the origin, seen from 6 m on +Z. */
const SPHERE_CAM: Pinhole = { position: [0, 0, 6], target: [0, 0, 0], fov: 30, size: [320, 320] };
function sphereDoc(name: string, params: JsonObject, sky: JsonObject, light: JsonObject | null): JsonObject {
  return sessionDoc(name, SPHERE_CAM.size, {
    cam: perspective(SPHERE_CAM.position, SPHERE_CAM.target, SPHERE_CAM.fov), sky, mat: material(params), ball: ball(1, [0, 0, 0], 'mat'), ...(light ? { sun: light } : {}),
  });
}
/** One ball of radius 1 seen orthographically from +Z, 2.4 m across 512 px (213 px to its radius). */
const BALL_VIEW: Ortho = { target: [0, 0, 0], viewWidth: 2.4, size: [512, 512] };
function orthoBallDoc(name: string, params: JsonObject, light: JsonObject): JsonObject {
  return sessionDoc(name, BALL_VIEW.size, { cam: ortho(BALL_VIEW.target, BALL_VIEW.viewWidth), sky: DARK_SKY, mat: material(params), ball: ball(1, [0, 0, 0], 'mat'), sun: light });
}
interface Drawn { linear: Linear; ids: Ids }
function draw(out: string, docs: { doc: JsonObject; size: [number, number]; assets?: Fetched }[], what: string): Drawn[] {
  const replies = runGpu(bin(), out, docs.map((d, i) => view3dCall({
    doc: writeJson(out, `${what}-${i}`, d.doc), look: PLAIN_LOOK, size: d.size, targets: ['linear', 'ids'],
    ...(d.assets ? { assets: d.assets.assets, licenses: d.assets.licenses } : {}),
  })));
  return replies.map((r, i) => { const f = frame0(r, `${what} ${i}`); return { linear: readLinear(out, f, docs[i]!.size, `${what} ${i}`), ids: readIds(out, f, `${what} ${i}`) }; });
}

/** Per channel, judged where the reference is at least 5% of that channel's peak: within 1% of the reference. */
interface Tally { judged: number; failed: number; worst: string; worstRel: number }
function judge(tally: Tally, got: Rgb, ref: Rgb, floor: Rgb, where: string): void {
  let counted = false;
  for (let c = 0; c < 3; c++) {
    if (ref[c]! < floor[c]!) continue;
    counted = true;
    const rel = Math.abs(got[c]! - ref[c]!) / ref[c]!;
    if (rel > tally.worstRel) { tally.worstRel = rel; tally.worst = `${where} reads ${fmt(got)}, the reference ${fmt(ref)}`; }
    if (rel > 0.01) { tally.failed++; break; }
  }
  if (counted) tally.judged++;
}
const tally = (): Tally => ({ judged: 0, failed: 0, worst: '', worstRel: 0 });

const ANISO_SUN: V3 = [-30, -30, 0]; // toward the sun (−0.433, 0.5, 0.75): upper left, in front
const ANISO_PX = 384; const ANISO_WIDTH = 0.9; // one 0.4 m sphere 171 px to its radius

describe(`${AC1}: Khronos lobe samples, their CPU reference, the anisotropic highlight, wrap and the furnace`, () => {
  it(`${AC1} (1): SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by hash and never committed, import with their sheen, anisotropy and diffuse transmission`, async () => {
    requireMetal();
    const out = dir();
    const samples = [await khronos('SheenChair', out), await khronos('AnisotropyStrengthTest', out), await khronos('DiffuseTransmissionTest', out)];
    const replies = runGpu(bin(), out, samples.map((s) => view3dCall({
      doc: writeJson(out, `import-${s.name}`, sessionDoc(`import-${s.name}`, [64, 64], { cam: perspective([0, 1, 6], [0, 1, 0], 40), sky: DARK_SKY, sample: sceneAsset(s.sha) })),
      look: PLAIN_LOOK, size: [64, 64], targets: ['final'], assets: s.assets, licenses: s.licenses, imports: true,
    })));
    const problems: string[] = [];
    for (const [k, s] of samples.entries()) {
      const im = importOf(replies[k]!, 'sample', `${s.name}'s import`);
      const found = lobeImportProblems(s.gltf, im, s.name);
      console.log(`${AC1}: ${s.name}: ${im.materials.size} materials imported, ${found.length} problems`);
      problems.push(...found);
    }
    none(problems, 'each sample imports with its sheen, anisotropy and diffuse transmission on their fields');
  }, LONG);

  it(`${AC1} (2): SheenChair's two velvets, as imported, render within 1% of a CPU reference of their base and sheen lobes`, async () => {
    requireMetal();
    const out = dir();
    const chair = await khronos('SheenChair', out);
    const [reply] = runGpu(bin(), out, [view3dCall({
      doc: writeJson(out, 'chair', sessionDoc('chair', [64, 64], { cam: perspective([0, 1, 6], [0, 1, 0], 40), sky: DARK_SKY, sample: sceneAsset(chair.sha) })),
      look: PLAIN_LOOK, size: [64, 64], targets: ['final'], assets: chair.assets, licenses: chair.licenses, imports: true,
    })]);
    const im = importOf(reply!, 'sample', "SheenChair's import");
    const velvets = list(chair.gltf, 'materials').map((m, i) => ({ m, i })).filter(({ m }) => ext(m, SHEEN));
    expect(velvets.map((v) => v.i), 'SheenChair has its two velvets, materials 0 and 4').toEqual([0, 4]);
    const rot: V3 = [-20, 60, 0]; const l = towardSun(rot); const LUX = 2;
    const drawn = draw(out, velvets.map(({ i }) => ({ doc: sphereDoc(`velvet-${i}`, withoutMaps(im.materials.get(i)!), DARK_SKY, sun(LUX, rot)), size: SPHERE_CAM.size })), 'velvet');
    const problems: string[] = [];
    for (const [k, { m, i }] of velvets.entries()) {
      const d = drawn[k]!; const lobes = fileLobes(m); const name = `SheenChair material ${i} (${String(m['name'])})`;
      const refs: { x: number; y: number; ref: Rgb }[] = [];
      const peak: Rgb = [0, 0, 0];
      for (let y = 0; y < SPHERE_CAM.size[1]; y++) for (let x = 0; x < SPHERE_CAM.size[0]; x++) {
        if (!insideBy(d.ids, x, y, 2, 'ball')) continue;
        const ray = pixelRay(SPHERE_CAM, x, y); const p = hitSphere(SPHERE_CAM.position, ray, [0, 0, 0], 1);
        if (!p) continue;
        const v = scale(ray, -1);
        if (dot(p, v) < 0.3) continue; // grazing pixels are left out (REDRAFT.md: The measure)
        const ref = scale(shade(lobes, p, null, v, l), LUX) as Rgb;
        refs.push({ x, y, ref });
        for (let c = 0; c < 3; c++) peak[c] = Math.max(peak[c]!, ref[c]!);
      }
      const t = tally();
      for (const { x, y, ref } of refs) judge(t, d.linear.at(x, y), ref, scale(peak, 0.05) as Rgb, `${name} at (${x}, ${y})`);
      console.log(`${AC1}: ${name}: ${t.judged} px judged, ${t.failed} over 1%, worst ${(t.worstRel * 100).toFixed(2)}%: ${t.worst}`);
      if (t.judged < 5000) problems.push(`${name}: only ${t.judged} px could be judged; the fixture needs 5,000`);
      if (t.failed > 0) problems.push(`${name}: ${t.failed} of ${t.judged} px differ from the CPU reference by over 1%; worst ${(t.worstRel * 100).toFixed(2)}%: ${t.worst}`);
    }
    none(problems, "SheenChair's velvets render within 1% of the CPU reference of their lobes");
  }, LONG);

  it(`${AC1} (3): AnisotropyStrengthTest's 49 spheres render within 1% of a CPU reference of the anisotropic lobe`, async () => {
    requireMetal();
    const out = dir();
    const sample = await khronos('AnisotropyStrengthTest', out);
    const g = sample.gltf; const w = worlds(g);
    const spheres = [...w.keys()].filter((i) => typeof list(g, 'nodes')[i]!['mesh'] === 'number' && ext(list(g, 'materials')[nodeMaterial(g, i)]!, ANISO));
    expect(spheres.length, 'AnisotropyStrengthTest has 49 anisotropic spheres').toBe(49);
    const l = towardSun(ANISO_SUN); const v: V3 = [0, 0, 1];
    const views = spheres.map((i): Ortho => { const c = w.get(i)!; return { target: [c[0][3], c[1][3], c[2][3]], viewWidth: ANISO_WIDTH, size: [ANISO_PX, ANISO_PX] }; });
    const drawn = draw(out, views.map((o, k) => ({
      doc: sessionDoc(`aniso-${spheres[k]}`, o.size, { cam: ortho(o.target, o.viewWidth), sky: DARK_SKY, sun: sun(1, ANISO_SUN), aniso: sceneAsset(sample.sha) }), size: o.size, assets: sample,
    })), 'aniso');
    const problems: string[] = [];
    for (const [k, i] of spheres.entries()) {
      const d = drawn[k]!; const m = list(g, 'materials')[nodeMaterial(g, i)]!; const lobes = fileLobes(m);
      const name = `AnisotropyStrengthTest material ${nodeMaterial(g, i)} (roughness ${lobes.roughness.toFixed(3)}, strength ${lobes.anisotropy!.strength.toFixed(3)})`;
      const cast = orthoCaster(nodeTriangles(g, i, w.get(i)!), views[k]!);
      const a2 = lobes.roughness ** 4; const item = `aniso#${i}`;
      const refs: { x: number; y: number; ref: Rgb }[] = []; let peak = 0;
      for (let y = 0; y < ANISO_PX; y++) for (let x = 0; x < ANISO_PX; x++) {
        if (!insideBy(d.ids, x, y, 2, item)) continue;
        const hit = cast(x, y); const hx = cast(x + 1, y); const hy = cast(x, y + 1);
        if (!hit || !hx || !hy) continue;
        // Where the pixel's footprint in slope space reaches a quarter of α_b², the renderer's specular antialiasing
        // may widen the lobe; no published lobe does, so those pixels are left out (REDRAFT.md: The measure).
        const dn = (hx.n[0] - hit.n[0]) ** 2 + (hx.n[1] - hit.n[1]) ** 2 + (hx.n[2] - hit.n[2]) ** 2 + (hy.n[0] - hit.n[0]) ** 2 + (hy.n[1] - hit.n[1]) ** 2 + (hy.n[2] - hit.n[2]) ** 2;
        if (dn > a2 / 4) continue;
        const ref = shade(lobes, hit.n, hit.t, v, l);
        refs.push({ x, y, ref }); peak = Math.max(peak, ...ref);
      }
      const t = tally();
      for (const { x, y, ref } of refs) judge(t, d.linear.at(x, y), ref, [0.05 * peak, 0.05 * peak, 0.05 * peak], `${name} at (${x}, ${y})`);
      console.log(`${AC1}: ${name}: ${t.judged} px judged, ${t.failed} over 1%, worst ${(t.worstRel * 100).toFixed(2)}%`);
      if (lobes.roughness >= 1 / 6 - 1e-9 && t.judged < 150) problems.push(`${name}: only ${t.judged} px could be judged; each sphere of roughness 1/6 or more needs 150`);
      if (t.failed > 0) problems.push(`${name}: ${t.failed} of ${t.judged} px differ from the CPU reference by over 1%; worst ${(t.worstRel * 100).toFixed(2)}%: ${t.worst}`);
    }
    none(problems, "AnisotropyStrengthTest's spheres render within 1% of the CPU reference of the anisotropic lobe");
  }, LONG);

  it(`${AC1} (4): DiffuseTransmissionTest's factor planes, lit from behind and from the front, render within 1% of a CPU reference of diffuse transmission`, async () => {
    requireMetal();
    const out = dir();
    const sample = await khronos('DiffuseTransmissionTest', out);
    const g = sample.gltf; const w = worlds(g);
    // The planes whose transmission is factors only: materials "Factor 0.0" … "ColorFactor 1.0" (REDRAFT.md).
    const planes = [...w.keys()].filter((i) => {
      if (typeof list(g, 'nodes')[i]!['mesh'] !== 'number') return false;
      const d = ext(list(g, 'materials')[nodeMaterial(g, i)]!, DT);
      return d !== null && !Object.values(d).some((v) => isObject(v) && typeof v['index'] === 'number');
    });
    expect(planes.length, 'DiffuseTransmissionTest has ten planes whose transmission is factors only').toBe(10);
    const view: Ortho = { target: [2.408, -0.607, 0], viewWidth: 6.4, size: [640, 256] };
    const LUX = 3;
    const lights: { name: string; rot: V3 }[] = [{ name: 'lit from behind', rot: [0, 180, 0] }, { name: 'lit from the front, 30° off the axis', rot: [0, 30, 0] }];
    const items: Record<string, JsonObject> = {};
    for (const [k, i] of planes.entries()) { const c = w.get(i)!; items[`p${k}`] = nodeAsset(sample.sha, String(list(g, 'nodes')[i]!['name']), [c[0][3], c[1][3], c[2][3]]); }
    const drawn = draw(out, lights.map((s) => ({
      doc: sessionDoc(`dt-${s.rot[1]}`, view.size, { cam: ortho(view.target, view.viewWidth), sky: DARK_SKY, sun: sun(LUX, s.rot), ...items }), size: view.size, assets: sample,
    })), 'transmission');
    const problems: string[] = [];
    for (const [j, s] of lights.entries()) {
      const d = drawn[j]!; const l = towardSun(s.rot);
      const refs = planes.map((i) => {
        const tri = nodeTriangles(g, i, w.get(i)!)[0]!;
        return scale(shade(fileLobes(list(g, 'materials')[nodeMaterial(g, i)]!), tri.n[0], null, [0, 0, 1], l), LUX) as Rgb;
      });
      const peak = Math.max(...refs.flat());
      for (const [k, i] of planes.entries()) {
        const m = list(g, 'materials')[nodeMaterial(g, i)]!; const name = `DiffuseTransmissionTest material ${nodeMaterial(g, i)} (${String(m['name'])}), ${s.name}`;
        const ref = refs[k]!; let judged = 0; let failed = 0; let worst = '';
        for (let y = 0; y < view.size[1]; y++) for (let x = 0; x < view.size[0]; x++) {
          if (!insideBy(d.ids, x, y, 2, `p${k}`)) continue;
          judged++;
          const got = d.linear.at(x, y);
          if ([0, 1, 2].some((c) => Math.abs(got[c]! - ref[c]!) > 0.01 * Math.max(ref[c]!, 0.05 * peak))) { failed++; if (!worst) worst = `(${x}, ${y}) reads ${fmt(got)}, the reference ${fmt(ref)}`; }
        }
        console.log(`${AC1}: ${name}: reference ${fmt(ref)}, ${judged} px judged, ${failed} off by over 1%`);
        if (judged < 2000) problems.push(`${name}: only ${judged} px could be judged; each plane needs 2,000`);
        if (failed > 0) problems.push(`${name}: ${failed} of ${judged} px differ from the CPU reference by over 1% (of the reference, or of 5% of the view's peak where it is darker); first ${worst}`);
      }
    }
    none(problems, "DiffuseTransmissionTest's factor planes render within 1% of the CPU reference of diffuse transmission");
  }, LONG);

  it(`${AC1} (5): in AnisotropyStrengthTest the roughness 1 column equals its strength 0 sphere within 1 code value`, async () => {
    requireMetal();
    const out = dir();
    const sample = await khronos('AnisotropyStrengthTest', out);
    const g = sample.gltf; const w = worlds(g);
    const column = [...w.keys()].filter((i) => {
      if (typeof list(g, 'nodes')[i]!['mesh'] !== 'number') return false;
      const m = list(g, 'materials')[nodeMaterial(g, i)]!;
      return ext(m, ANISO) !== null && fileLobes(m).roughness === 1;
    });
    expect(column.length, 'AnisotropyStrengthTest has seven spheres at roughness 1').toBe(7);
    const zero = column.find((i) => fileLobes(list(g, 'materials')[nodeMaterial(g, i)]!).anisotropy!.strength === 0)!;
    expect(zero, 'one sphere of the roughness 1 column has strength 0').toBeDefined();
    const view: Ortho = { target: [0, 3, 0], viewWidth: 8, size: [640, 640] }; const K = 80; // 80 px a metre: centres 80 px apart
    const [reply] = runGpu(bin(), out, [view3dCall({
      doc: writeJson(out, 'column', sessionDoc('column', view.size, { cam: ortho(view.target, view.viewWidth), sky: DARK_SKY, sun: sun(1, ANISO_SUN), aniso: sceneAsset(sample.sha) })),
      look: PLAIN_LOOK, size: view.size, targets: ['final', 'ids'], assets: sample.assets, licenses: sample.licenses,
    })]);
    const f = frame0(reply!, 'the AnisotropyStrengthTest grid'); const final = readPng(out, f, 'the grid'); const ids = readIds(out, f, 'the grid');
    const at = (i: number): [number, number] => { const c = w.get(i)!; return [c[0][3], c[1][3]]; };
    const problems: string[] = [];
    const disc: [number, number][] = [];
    let brightest = 0;
    for (let y = 0; y < view.size[1]; y++) for (let x = 0; x < view.size[0]; x++) {
      if (!insideBy(ids, x, y, 2, `aniso#${zero}`)) continue;
      disc.push([x, y]); brightest = Math.max(brightest, ...pixel(final, x, y));
    }
    console.log(`${AC1}: the strength 0 sphere at roughness 1 (material ${nodeMaterial(g, zero)}): ${disc.length} px, brightest code ${brightest}`);
    if (disc.length < 1500) problems.push(`the strength 0 sphere at roughness 1 shows only ${disc.length} px 2 px inside its edge; the view needs 1,500`);
    if (brightest < 25) problems.push(`the strength 0 sphere at roughness 1 is too dark to compare (brightest code ${brightest}); its sun lights it`);
    for (const j of column.filter((i) => i !== zero)) {
      const m = list(g, 'materials')[nodeMaterial(g, j)]!;
      const name = `material ${nodeMaterial(g, j)} (roughness 1, strength ${fileLobes(m).anisotropy!.strength.toFixed(3)})`;
      const dx = (at(j)[0] - at(zero)[0]) * K; const dy = -(at(j)[1] - at(zero)[1]) * K;
      expect(Math.abs(dx - Math.round(dx)) + Math.abs(dy - Math.round(dy)), `${name} sits a whole number of pixels from the strength 0 sphere`).toBeLessThan(1e-6);
      let off = 0; let worst = 0; let first = ''; let missing = 0;
      for (const [x, y] of disc) {
        const [x2, y2] = [x + Math.round(dx), y + Math.round(dy)];
        if (!insideBy(ids, x2, y2, 2, `aniso#${j}`)) { missing++; continue; }
        const a = pixel(final, x, y); const b = pixel(final, x2, y2);
        const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!)));
        worst = Math.max(worst, d);
        if (d > 1) { off++; if (!first) first = `(${x2}, ${y2}) reads ${fmt(b)} where the strength 0 sphere's (${x}, ${y}) reads ${fmt(a)}`; }
      }
      console.log(`${AC1}: ${name}: ${disc.length - missing} px compared, ${off} over 1 code, worst ${worst} codes`);
      if (missing > 0) problems.push(`${name}: ${missing} px of the strength 0 sphere's disc don't land on ${name}'s own disc`);
      if (off > 0) problems.push(`${name}: ${off} px differ from the strength 0 sphere by over 1 code value; first ${first}`);
    }
    none(problems, 'anisotropy has no effect at roughness 1');
  }, LONG);

  it(`${AC1} (6): at roughness 0.2 and strength 1 the highlight is at least 3 times longer along the tangent than across it`, () => {
    requireMetal();
    const out = dir();
    const params: JsonObject = { base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.2, anisotropy: { strength: 1, rotation: 0 } };
    // The sun behind the camera puts the highlight at the ball's centre, where uv0's u, the tangent, runs horizontally.
    const [d] = draw(out, [{ doc: orthoBallDoc('streak', params, sun(1, [0, 0, 0])), size: BALL_VIEW.size }], 'streak');
    const { linear, ids } = d!;
    // The highlight's centre is its mirror point, n = h: the ball's centre, the pixel whose centre is 0.5 px from it.
    // (Along the tangent α_t is 1, so the lobe is flat there and brightens toward the limb; the highlight is measured
    // through its mirror point, never from the brightest pixel.)
    const px = BALL_VIEW.size[0] / 2 - 1; const py = BALL_VIEW.size[1] / 2 - 1;
    expect(insideBy(ids, px, py, 2, 'ball'), 'the ball covers its own centre').toBe(true);
    const peak = lum(linear.at(px, py));
    expect(peak, 'the highlight lights the ball centre').toBeGreaterThan(0);
    // From the centre, along a row or column, the half-maximum crossing (linear between pixel centres), or the edge.
    const reach = (sx: number, sy: number): number => {
      let prev = peak;
      for (let k = 1; ; k++) {
        const x = px + sx * k; const y = py + sy * k;
        if (!insideBy(ids, x, y, 2, 'ball')) return k - 1;
        const v = lum(linear.at(x, y));
        if (v < peak / 2) return k - 1 + (prev - peak / 2) / (prev - v);
        prev = v;
      }
    };
    const along = reach(1, 0) + reach(-1, 0); const across = reach(0, 1) + reach(0, -1);
    console.log(`${AC1}: roughness 0.2, strength 1: the highlight's centre (${px}, ${py}) reads ${peak.toFixed(4)}; half-maximum length ${along.toFixed(2)} px along the tangent (horizontal), ${across.toFixed(2)} px across, ratio ${(along / across).toFixed(2)}`);
    expect(across, 'the highlight is resolved across the tangent (at least 2 px at half maximum)').toBeGreaterThanOrEqual(2);
    expect(along, `the highlight is at least 3 times longer along the tangent (${along.toFixed(2)} px) than across it (${across.toFixed(2)} px)`).toBeGreaterThanOrEqual(3 * across);
  }, LONG);

  it(`${AC1} (7): a sphere with wrap 0.5 goes dark 120° from its light within 1°, where wrap 0 goes dark at 90°`, () => {
    requireMetal();
    const out = dir();
    const wraps = [0.5, 0];
    const params = (wrap: number): JsonObject => ({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0, translucency: { kind: 'wrap', amount: 1, wrap } });
    const rot: V3 = [0, 90, 0]; // toward the sun +X: the angle from the light at (x, y) on the ball is acos(x ÷ R)
    expect(Math.abs(towardSun(rot)[0] - 1), 'the sun shines along −X').toBeLessThan(1e-12);
    const drawn = draw(out, wraps.map((wrap) => ({ doc: orthoBallDoc(`wrap-${wrap}`, params(wrap), sun(1, rot)), size: BALL_VIEW.size })), 'wrap');
    const problems: string[] = [];
    for (const [k, wrap] of wraps.entries()) {
      const { linear, ids } = drawn[k]!; const want = deg(Math.acos(-wrap));
      for (const row of [BALL_VIEW.size[1] / 2 - 1, BALL_VIEW.size[1] / 2]) {
        const xs = [...Array(BALL_VIEW.size[0]).keys()].filter((x) => insideBy(ids, x, row, 2, 'ball'));
        const peak = Math.max(...xs.map((x) => lum(linear.at(x, row))));
        const start = xs.reduce((b, x) => (lum(linear.at(x, row)) > lum(linear.at(b, row)) ? x : b), xs[0]!);
        // Walking away from the light, the first pixel that reads dark (under 1e-5 of the row's peak); the edge lies
        // halfway between its centre and the last lit one's.
        let dark = -1;
        for (let x = start; x >= 0 && insideBy(ids, x, row, 2, 'ball'); x--) if (lum(linear.at(x, row)) <= 1e-5 * peak) { dark = x; break; }
        const name = `the wrap ${wrap} sphere, row ${row}`;
        if (dark < 0) { problems.push(`${name}: no pixel goes dark before the ball's far edge`); continue; }
        const [wx] = orthoWorld(BALL_VIEW, dark + 0.5, row);
        const angle = deg(Math.acos(Math.max(-1, Math.min(1, wx / 1))));
        console.log(`${AC1}: ${name}: goes dark at x ${(dark + 1).toFixed(1)} px, ${angle.toFixed(2)}° from its light (want ${want.toFixed(0)}°)`);
        if (Math.abs(angle - want) > 1) problems.push(`${name} goes dark ${angle.toFixed(2)}° from its light, not ${want.toFixed(0)}° within 1°`);
      }
    }
    none(problems, 'wrap moves the shadow line to acos(−wrap)');
  }, LONG);

  it(`${AC1} (8): the white-furnace fixture with each lobe at full strength stays at or under 1 at every roughness and angle`, () => {
    requireMetal();
    const out = dir();
    const ROUGH = [0, 0.25, 0.5, 0.75, 1];
    const lobes: { name: string; params: (r: number) => JsonObject }[] = [
      { name: 'sheen', params: (r) => ({ base_color: [1, 1, 1, 1], metallic: 0, roughness: r, sheen: { weight: 1, color: [1, 1, 1], roughness: r } }) },
      { name: 'anisotropy', params: (r) => ({ base_color: [1, 1, 1, 1], metallic: 1, roughness: r, anisotropy: { strength: 1, rotation: 0 } }) },
      { name: 'thin translucency', params: (r) => ({ base_color: [1, 1, 1, 1], metallic: 0, roughness: r, translucency: { kind: 'thin', amount: 1, color: [1, 1, 1] } }) },
      { name: 'wrap translucency', params: (r) => ({ base_color: [1, 1, 1, 1], metallic: 0, roughness: r, translucency: { kind: 'wrap', amount: 1, wrap: 1, color: [1, 1, 1] } }) },
    ];
    const cases = lobes.flatMap((lobe) => ROUGH.map((r) => ({ name: `${lobe.name} at roughness ${r}`, params: lobe.params(r) })));
    const drawn = draw(out, cases.map((c, i) => ({ doc: sphereDoc(`furnace-${i}`, c.params, FURNACE_SKY, null), size: SPHERE_CAM.size })), 'furnace');
    const problems: string[] = [];
    for (const [i, c] of cases.entries()) {
      const { linear, ids } = drawn[i]!;
      let bgWorst = 0; let bgAt = ''; let n = 0; let worst = 0; let at = '';
      for (let y = 0; y < SPHERE_CAM.size[1]; y++) for (let x = 0; x < SPHERE_CAM.size[0]; x++) {
        const v = linear.at(x, y);
        if (ids.at(x, y) === null) {
          if (x % 4 === 0 && y % 4 === 0) for (const k of v) if (Math.abs(k - 1) > bgWorst) { bgWorst = Math.abs(k - 1); bgAt = `(${x}, ${y}) reads ${fmt(v)}`; }
          continue;
        }
        if (!(ids.at(x, y) === 'ball' || ids.at(x, y)!.startsWith('ball#'))) continue;
        n++;
        const top = Math.max(...v);
        if (top > worst) { worst = top; at = `(${x}, ${y}) reads ${fmt(v)}`; }
      }
      console.log(`${AC1}: furnace, ${c.name}: ${n} px, brightest ${at}; background worst off 1 by ${bgWorst.toFixed(4)}`);
      if (bgWorst > 0.01) problems.push(`${c.name}: the furnace's background isn't radiance 1 within 1%: ${bgAt}`);
      if (n < 20_000) problems.push(`${c.name}: only ${n} px of the ball in the furnace; the fixture needs 20,000`);
      if (worst > 1.01) problems.push(`${c.name}: reflects more than it receives in the white furnace: ${at}`);
    }
    none(problems, 'every lobe at full strength stays at or under 1 in the white furnace');
  }, LONG);
});
