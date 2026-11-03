// AC5: "Every builder's declared vertex count equals what it builds, every closed builder is watertight (no open
// edges, Euler characteristic V − E + F = 2 − 2g per closed part on welded positions, with g the genus the builder
// computes from its params: 0 for a box or a sphere, 1 for a torus, a tube on a closed path or an extrude with one
// hole), and areas and volumes match closed forms to 1e-6 relative, on parity fixtures with planted-fault twins,
// among them a torus declared with genus 0 (parity/geometry/watertight-builders.scene)"
//
// The parity fixture's cases are one document of builder items (slab, lathe, extrude, tube, ball, coil, plate),
// presented through deep_show and read back with `geometry` (final stage, item space) and with `estimate_only`
// (the count before any build). The checks are this suite's CPU references (helpers.ts): welding at 1e-6 m,
// open, non-manifold and same-way edges, V − E + F against the genus each closed part reports, the genera the
// issue gives, and area and volume by triangle sums and the divergence theorem against each case's closed form.
// Ported where they fit: Godot's test_primitives.cpp (a box has exactly six distinct face normals; a cylinder's
// side points lie at its radius and its cap points at its two ends) and Unreal's MeshDescriptionTests prism
// counts (4n − 2 triangles for n sides there, per the oracle page, a number that depends on how its caps are
// triangulated; so this suite holds our n-sided lathe and tube prisms to 2n side triangles plus two caps of n − 2
// to n triangles each: 4n − 4 ≤ T ≤ 4n). Each twin runs its planted builder and must fail the case it names,
// the failure naming it.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, GEODESIC_ICOSA_2, cross, PARITY_SCENE, UV_BALL_32, admitted, boxForm, close, failsNaming, fixture, geometryCall, geometryOf,
  icosaForm, isObject, itemOf, latheForm, length, measureProblems, meshProblems, none, num, obj, octaForm, polygon, prismForm, runShow,
  scenario, sceneDoc, show, sub, unit, useBins, useDir, weld, weldKey, type Geometry, type GeometryReply, type JsonObject, type JsonValue,
  type ShowPlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();
const SCENE = fixture(...PARITY_SCENE.split('/'));

interface Case { name: string; item: JsonObject; genera: number[] | null; area?: number; volume?: number; declared?: number; formula?: JsonObject }
interface Twin { planted: ShowPlanted; case: string; names: string[] }
const CASES: Case[] = (SCENE['cases'] as JsonValue[]).map((v) => {
  const o = v as JsonObject;
  const c: Case = { name: String(o['name']), item: o['item'] as JsonObject, genera: o['genera'] === null ? null : (o['genera'] as number[]) };
  if (typeof o['area'] === 'number') c.area = o['area'];
  if (typeof o['volume'] === 'number') c.volume = o['volume'];
  if (typeof o['declared'] === 'number') c.declared = o['declared'];
  if (isObject(o['formula'])) c.formula = o['formula'];
  return c;
});
const TWINS: Twin[] = (SCENE['twins'] as JsonValue[]).map((v) => { const o = v as JsonObject; return { planted: o['planted'] as ShowPlanted, case: String(o['case']), names: o['names'] as string[] }; });

/** The fixture as one document: a camera, the curves the cases name, and each case's item under its own name. */
function parityDoc(): JsonObject {
  const items: Record<string, JsonObject> = { cam: CAMERA };
  for (const [id, curve] of Object.entries(obj(SCENE['curves'], 'the scene\'s curves'))) items[id] = { ...(curve as JsonObject), at: { pos: [0, 0, -20] } };
  CASES.forEach((c, i) => { items[c.name] = { ...c.item, at: { pos: [(i % 5) * 4, 0, Math.floor(i / 5) * 4] } }; });
  return sceneDoc('Watertight builders', items);
}

/** The fixture presented, then every case built (final stage) and counted without building. */
function built(planted?: ShowPlanted): { full: GeometryReply; estimate: GeometryReply } {
  const names = CASES.map((c) => c.name);
  const [shown, full, estimate] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
    show(DOC.a, parityDoc()),
    geometryCall(DOC.a, { items: names, t: '0s', stage: 'final' }),
    geometryCall(DOC.a, { items: names, t: '0s', estimate_only: true }),
  ], planted ? { planted } : {}));
  admitted(shown!, 'the parity fixture\'s document');
  return { full: geometryOf(full!, 'geometry of every case'), estimate: geometryOf(estimate!, 'the estimate of every case') };
}

/** Every check AC5 names, over every case; each failure names its case. */
function caseProblems(full: GeometryReply): string[] {
  const out: string[] = [];
  for (const c of CASES) {
    const g = full.items.get(c.name);
    if (!g) { out.push(`${c.name}: missing from the geometry reply`); continue; }
    const mesh = meshProblems(c.name, g, c.genera);
    out.push(...mesh);
    if (mesh.length) continue;
    if (c.declared !== undefined && g.declared !== c.declared) out.push(`${c.name}: declares ${g.declared} vertices; the design's count is ${c.declared}`);
    const want: { area?: number; volume?: number } = {};
    if (c.area !== undefined) want.area = c.area;
    if (c.volume !== undefined) want.volume = c.volume;
    out.push(...measureProblems(c.name, g, want));
  }
  return out;
}

/** The closed form the case's `formula` names, computed here from the params alone. */
function formOf(f: JsonObject): { area: number; volume?: number } {
  if (Array.isArray(f['box'])) return boxForm(f['box'] as V3);
  if (isObject(f['prism'])) {
    const p = f['prism'];
    const outer = polygon(p['outline'] as [number, number][]);
    const holes = (p['holes'] as [number, number][][]).map(polygon);
    const A = outer.area - holes.reduce((s, h) => s + h.area, 0);
    const P = outer.perimeter + holes.reduce((s, h) => s + h.perimeter, 0);
    return prismForm(A, P, num(p['height'], 'a prism\'s height'));
  }
  if (isObject(f['lathe'])) { const l = f['lathe']; return latheForm(l['outline'] as [number, number][], num(l['segments'], 'segments'), l['closed'] === true); }
  if (typeof f['octahedron'] === 'number') return octaForm(f['octahedron']);
  if (typeof f['icosahedron'] === 'number') return icosaForm(f['icosahedron']);
  if (Array.isArray(f['rectangle'])) { const [w, d] = f['rectangle'] as [number, number]; return { area: w * d }; }
  throw Error(`unknown formula ${JSON.stringify(f)}`);
}

describe(`${AC[5]} builders: declared counts, watertight closed parts, Euler characteristic by genus, closed-form areas and volumes`, () => {
  it(`${AC[5]} the parity fixture ${PARITY_SCENE} holds the issue's cases, its twins (the torus declared genus 0 among them) and closed forms that match their formulas`, () => {
    const byName = new Map(CASES.map((c) => [c.name, c]));
    const kinds = new Set(CASES.map((c) => String(c.item['kind'])));
    for (const k of ['slab@1', 'lathe@1', 'extrude@1', 'tube@1', 'ball@1', 'coil@1', 'plate@1']) expect(kinds.has(k), `the fixture builds ${k}`).toBe(true);
    // The genera the issue names: a box and a sphere 0; a torus, a tube on a closed path and an extrude with one hole 1.
    expect(byName.get('box')?.genera).toEqual([0]);
    expect(byName.get('ball_uv')?.genera).toEqual([0]);
    expect(byName.get('torus')?.genera).toEqual([1]);
    expect(byName.get('hoop')?.genera).toEqual([1]);
    expect(obj(SCENE['curves'], 'curves')['loop'] && (obj(obj(SCENE['curves'], 'curves')['loop'], 'loop')['params'] as JsonObject)['closed']).toBe(true);
    expect(byName.get('ring_block')?.genera).toEqual([1]);
    expect((byName.get('ring_block')?.item['params'] as JsonObject)['holes']).toHaveLength(1);
    expect(byName.get('ball_uv')?.declared).toBe(UV_BALL_32);
    expect(byName.get('ball_geodesic')?.declared).toBe(GEODESIC_ICOSA_2);
    expect(TWINS.some((t) => t.planted === 'torus_genus_0' && t.case === 'torus'), 'a twin declares the torus with genus 0').toBe(true);
    for (const t of TWINS) expect(byName.has(t.case), `twin ${t.planted} names a case`).toBe(true);
    for (const c of CASES) {
      if (!c.formula) { expect(c.area === undefined && c.volume === undefined, `${c.name}: every expected area or volume comes from a formula`).toBe(true); continue; }
      const f = formOf(c.formula);
      expect(close(c.area!, f.area, 1e-12), `${c.name}: area ${c.area} is its formula's ${f.area}`).toBe(true);
      if (f.volume !== undefined) expect(close(c.volume!, f.volume, 1e-12), `${c.name}: volume ${c.volume} is its formula's ${f.volume}`).toBe(true);
    }
  });

  it(`${AC[5]} every case declares the vertices it builds, before building and after, and every closed part is watertight with V − E + F = 2 − 2g and its closed-form area and volume to 1e-6`, () => {
    const { full, estimate } = built();
    expect(estimate.builds, 'estimate_only builds nothing: the counts come from params').toBe(0);
    for (const c of CASES) {
      const e = itemOf(estimate, c.name, 'the estimate');
      expect(e.built, `${c.name}: estimate_only returns no mesh`).toBe(false);
      expect(e.declared, `${c.name}: the count before the build equals the count the build declares`).toBe(itemOf(full, c.name, 'the build').declared);
    }
    none(caseProblems(full), 'the parity fixture\'s cases');
  }, 900_000);

  it(`${AC[5]} ported from Godot's test_primitives.cpp and Unreal's prism counts: a slab box has exactly six face normals, a lathe cylinder's side points sit at its radius and its caps at its ends, and an n-sided prism has between 4n − 4 and 4n triangles`, () => {
    const { full } = built();
    const box = itemOf(full, 'box', 'the build');
    const normals = new Set<string>();
    for (let t = 0; t < box.indices.length / 3; t++) {
      const [a, b, c] = [box.positions[box.indices[3 * t]!]!, box.positions[box.indices[3 * t + 1]!]!, box.positions[box.indices[3 * t + 2]!]!];
      normals.add(weldKey(unit(cross(sub(b, a), sub(c, a)))));
    }
    expect(normals.size, 'box: its triangles face exactly six directions').toBe(6);
    for (const name of ['cylinder', 'pipe']) {
      const g = itemOf(full, name, 'the build');
      const radialProblems = cylinderProblems(name, g, 0.5, 2);
      none(radialProblems, `${name}: points on its side at the radius 0.5 and its caps at its two ends`);
      const T = g.indices.length / 3;
      expect(T >= 4 * 16 - 4 && T <= 4 * 16, `${name}: a 16-sided prism has 60 to 64 triangles; it has ${T}`).toBe(true);
    }
  }, 900_000);

  for (const twin of TWINS) {
    it(`${AC[5]} planted twin ${twin.planted} fails case ${twin.case}, naming ${twin.names.join(' and ')}`, () => {
      const { full } = built(twin.planted);
      const problems = caseProblems(full).filter((p) => p.startsWith(`${twin.case}:`));
      failsNaming(problems, twin.names, `the planted ${twin.planted}`);
    }, 900_000);
  }
});


/**
 * Godot's cylinder case, read on our builder: every welded point lies on the side at the radius from the axis, or
 * on a cap at one of the two ends; the axis is the direction of the longest extent through the centre of the bounds.
 */
function cylinderProblems(name: string, g: Geometry, radius: number, height: number): string[] {
  const pts = weld(g.positions).points;
  const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  const ext = sub(hi, lo);
  const axis = ext.indexOf(Math.max(...ext));
  const out: string[] = [];
  if (Math.abs(ext[axis]! - height) > 1e-6) out.push(`${name}: its length along its axis is ${ext[axis]}, not ${height}`);
  const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  for (const p of pts) {
    const d = sub(p, centre);
    const along = d[axis]!;
    const off: V3 = [...d] as V3; off[axis] = 0;
    const r = length(off);
    const onSide = Math.abs(r - radius) <= 1e-6;
    const onCap = Math.abs(Math.abs(along) - height / 2) <= 1e-6 && r <= radius + 1e-6;
    if (!onSide && !onCap) out.push(`${name}: point ${JSON.stringify(p)} is neither on the side (r = ${r}) nor on a cap (${along} from the middle)`);
  }
  return out.slice(0, 5);
}
