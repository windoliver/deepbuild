// AC8: "A slab with face attribute `wear` and parts top and side, run through array ×3, bevel and subdivide, gives
// every output face exactly one part and a `wear` equal to its source face's; a planted bevel that drops `wear`, or
// leaves bevel faces outside every part, fails, naming the attribute or the face"
//
// A slab@1 box (plan 0.2–1.2 × 0.1–0.7 m, 0.2 m thick) keeps a face attribute `wear` by `mod.store@1 {name: wear,
// domain: face, field: distance}`: each face's distance from the item's origin at its centroid, a different value
// on each of the six faces. `src` is that slab; `out` is the same slab and store, then `mod.array@1 {count: 3}`,
// `mod.bevel@1 {width: 0.03, segments: 2}` and `mod.subdivide@1 {levels: 1}`. `src` must name parts `top` and
// `side` and put each face in exactly one part. Every output face of `out` (its triangles, grouped by `faces`)
// must lie in exactly one part, whose name is a source part's (an array copy may add `.<k>`), and carry one
// `wear` equal to a source face's of that part that faces its way (their normals less than 90° apart): its
// source face. A failure names the face (`face <id>`) and, for a wrong or missing value, the attribute.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, facesOf, failsNaming, geometryCall, isObject, meshRow, none, partsOf, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type JsonValue, type MeshRow, type ShowPlanted } from './helpers.ts';
import { add, cross, dot, fmt, sub, triAt, unit, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const SLAB: JsonObject = { outline: [[0.2, 0.1], [1.2, 0.1], [1.2, 0.7], [0.2, 0.7]], thickness: 0.2 };
const STORE: JsonObject = { kind: 'mod.store@1', params: { name: 'wear', domain: 'face', type: 'f32', field: 'distance' } };
const doc = (): JsonObject => sceneDoc('Parts and wear through generate modifiers', {
  src: { kind: 'slab@1', params: SLAB, modifiers: [STORE] },
  out: {
    kind: 'slab@1', params: SLAB, modifiers: [
      STORE,
      { kind: 'mod.array@1', params: { count: 3, offset: [1.5, 0, 0] } },
      { kind: 'mod.bevel@1', params: { width: 0.03, segments: 2 } },
      { kind: 'mod.subdivide@1', params: { levels: 1 } },
    ],
  },
});

interface Face { id: number; tris: number[]; normal: V3; parts: Set<string>; wear: (number | null)[] }

/** Each face's triangles, area-weighted outward normal, the parts its triangles are in, and its `wear` per triangle (null where missing). */
function facesWith(g: MeshRow, what: string, out: string[]): Map<number, Face> {
  const faces = facesOf(g, what);
  const parts = partsOf(g, what);
  const attr = isObject(g.raw['attributes']) ? (g.raw['attributes'] as JsonObject)['wear'] : undefined;
  let values: JsonValue[] = [];
  if (!isObject(attr)) out.push(`${what}: has no attribute wear`);
  else if (attr['domain'] !== 'face') out.push(`${what}: its attribute wear has domain ${String(attr['domain'])}, not face`);
  else if (!Array.isArray(attr['values']) || attr['values'].length !== faces.length) out.push(`${what}: its attribute wear doesn't hold one value per triangle`);
  else values = attr['values'];
  const partOf = new Map<number, string[]>();
  for (const [name, tris] of parts) for (const t of tris) partOf.set(t, [...(partOf.get(t) ?? []), name]);
  const byFace = new Map<number, Face>();
  faces.forEach((f, t) => {
    const face = byFace.get(f) ?? { id: f, tris: [], normal: [0, 0, 0], parts: new Set<string>(), wear: [] };
    const [a, b, c] = triAt(g.indices, t).map((i) => g.positions[i]!) as [V3, V3, V3];
    face.tris.push(t);
    face.normal = add(face.normal, cross(sub(b, a), sub(c, a)));
    for (const p of partOf.get(t) ?? []) face.parts.add(p);
    const v = values[t];
    face.wear.push(typeof v === 'number' && Number.isFinite(v) ? v : null);
    const n = partOf.get(t)?.length ?? 0;
    if (n !== 1) out.push(`${what}: face ${f} (triangle ${t}) is in ${n === 0 ? 'no part' : `${n} parts`}`);
    byFace.set(f, face);
  });
  return byFace;
}

const base = (part: string): string => part.replace(/(\.\d+)+$/, '');

function partProblems(planted?: ShowPlanted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['src', 'out'])], planted));
  admitted(shown!, 'the wear document');
  const problems: string[] = [];
  // The source faces.
  const srcIssues: string[] = [];
  const src = facesWith(meshRow(reply!, 'src', 'the source slab'), 'the source slab', srcIssues);
  expect(srcIssues, `the source slab keeps wear on every face and each face in one part:\n  ${srcIssues.join('\n  ')}`).toEqual([]);
  const sources = [...src.values()].map((f) => ({ id: f.id, part: [...f.parts][0]!, wear: f.wear[0]!, normal: unit(f.normal) }));
  const srcParts = new Set(sources.map((s) => s.part));
  expect(srcParts.has('top') && srcParts.has('side'), `the slab names parts top and side, got ${[...srcParts].join(', ')}`).toBe(true);
  for (const f of src.values()) expect(new Set(f.wear).size, `the source face ${f.id} has one wear`).toBe(1);
  // The output faces.
  const out = facesWith(meshRow(reply!, 'out', 'the output'), 'the output', problems);
  for (const f of out.values()) {
    const name = `the output: face ${f.id}`;
    if (f.parts.size > 1) problems.push(`${name} spreads over parts ${[...f.parts].join(', ')}`);
    const part = [...f.parts][0];
    if (part !== undefined && !srcParts.has(base(part))) problems.push(`${name} is in part ${part}, which no source part names`);
    if (f.wear.some((w) => w === null)) { problems.push(`${name} has no wear`); continue; }
    if (new Set(f.wear).size > 1) { problems.push(`${name} has more than one wear: ${[...new Set(f.wear)].map((w) => fmt(w!)).join(', ')}`); continue; }
    const w = f.wear[0]!;
    const n = unit(f.normal);
    const match = sources.find((s) => Math.abs(s.wear - w) <= 1e-9 && (part === undefined || s.part === base(part)) && dot(s.normal, n) > 0);
    if (!match) problems.push(`${name} (part ${part ?? 'none'}) has wear ${fmt(w)}, which is no source face's of its part facing its way (the source faces' wear: ${sources.map((s) => `${s.part} ${fmt(s.wear)}`).join(', ')})`);
  }
  return problems;
}

describe(`${AC[8]} parts and face attributes through array, bevel and subdivide`, () => {
  it(`${AC[8]} every output face is in exactly one part and keeps its source face's wear`, () => {
    none(partProblems(), 'parts and wear');
  }, SLOW);

  it(`${AC[8]} the planted bevel_drops_wear fails, naming the attribute`, () => {
    failsNaming(partProblems('bevel_drops_wear'), ['wear'], 'the planted bevel_drops_wear');
  }, SLOW);

  it(`${AC[8]} the planted bevel_faces_unparted fails, naming the face`, () => {
    failsNaming(partProblems('bevel_faces_unparted'), ['is in no part'], 'the planted bevel_faces_unparted');
  }, SLOW);
});
