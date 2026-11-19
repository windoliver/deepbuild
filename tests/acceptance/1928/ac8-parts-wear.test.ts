// AC8: "A slab with face attribute `wear`, parts `top` and `side` and box uv0, under `offset_faces {parts:
// [top], by: 0.1, inner: panel}` and `dissolve`, gives every output face exactly one part and a `wear` equal to
// its source face's, and its inner face's uv0 spans 0.8 by 0.8 units within 1e-9. A planted offset that drops
// `wear`, or leaves the inner face outside every part, fails, naming the attribute or the face"
//
// A `slab@1` (plan 0.2–1.2 × 0.1–1.1 m, 0.5 m thick, `uv0: box`, so its top is 1 × 1 m and 1 × 1 UV units) keeps
// a face attribute `wear` by `mod.store@1 {name: wear, domain: face, field: distance}`: each face's distance from
// the item's origin at its centroid, a different value on each of its six faces. `src` is that slab; `out` is the
// same slab and store, then `mod.offset_faces@1 {parts: [top], by: 0.1, inner: panel}` and `mod.dissolve@1`.
// `src` must name parts `top` and `side`, with each face in one part and one wear. An output face's source face
// is the source face in whose plane it lies (the offset has no depth, so the ring faces and the inner face lie in
// the top's plane). Every output face must lie in exactly one part: `panel` for the inner face (the one in the
// top's plane that touches no corner of the slab), and its source face's part for any other; and must carry one
// `wear`, its source face's within 1e-9. The inner face's uv0, over its vertices, must span 0.8 units one way
// and 0.8 the other, within 1e-9. A failure names the face (`face <id>`) and, for a value, the attribute.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, dissolve, failsNaming, geometryCall, isObject, meshRow, none, offsetFaces, partsOfFaces, runShow, scenario, sceneDoc, show, useDir, useShow, uv0Of, type JsonObject, type JsonValue, type MeshRow, type Planted } from './helpers.ts';
import { PLACE, areaVector, boxCorners, dot, fmt, inPlane, length, scale, sub, touches, type Face, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const SLAB: JsonObject = { outline: [[0.2, 0.1], [1.2, 0.1], [1.2, 1.1], [0.2, 1.1]], thickness: 0.5, uv0: 'box' };
const STORE: JsonObject = { kind: 'mod.store@1', params: { name: 'wear', domain: 'face', type: 'f32', field: 'distance' } };
const doc = (): JsonObject => sceneDoc('Parts, wear and uv0 through offset_faces and dissolve', {
  src: { kind: 'slab@1', params: SLAB, modifiers: [STORE] },
  out: { kind: 'slab@1', params: SLAB, modifiers: [STORE, offsetFaces({ parts: ['top'], by: 0.1, inner: 'panel' }), dissolve()] },
});
const CORNERS = boxCorners([0.2, 0, 0.1], [1.2, 0.5, 1.1]);

/** The row's face attribute `wear`, one value per triangle (null where it has none); null, with a problem, when the row has no such attribute. */
function wearOf(row: MeshRow, what: string, out: string[]): (number | null)[] | null {
  const attr = isObject(row.raw['attributes']) ? row.raw['attributes']['wear'] : undefined;
  if (!isObject(attr)) { out.push(`${what}: has no attribute wear`); return null; }
  if (attr['domain'] !== 'face') { out.push(`${what}: its attribute wear has domain ${String(attr['domain'])}, not face`); return null; }
  const values: JsonValue | undefined = attr['values'];
  if (!Array.isArray(values) || values.length !== row.faces.length) { out.push(`${what}: its attribute wear doesn't hold one value per triangle`); return null; }
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
}
/** A face's plane: its unit normal and its distance from the origin along it; null when its boundary is no simple loop. */
function planeOf(row: MeshRow, f: Face): { n: V3; d: number } | null {
  if (!f.loop) return null;
  const a = areaVector(row.view, f.loop);
  const n = scale(a, 1 / length(a));
  return { n, d: dot(n, row.view.points[f.loop[0]!]!) };
}

function partProblems(planted?: Planted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['src', 'out'])], planted));
  admitted(shown, 'the wear document');

  // The source faces: each one's plane, part and wear.
  const src = meshRow(reply, 'src', 'the source slab');
  const srcIssues: string[] = [];
  const srcWear = wearOf(src, 'the source slab', srcIssues);
  expect(srcIssues, 'the source slab keeps a face attribute wear').toEqual([]);
  const srcParts = partsOfFaces(src, 'the source slab');
  const sources = src.view.faces.map((f) => {
    const plane = planeOf(src, f);
    const parts = srcParts.get(f.id) ?? [];
    const wear = [...new Set(f.tris.map((t) => srcWear![t]))];
    expect(plane !== null && parts.length === 1 && wear.length === 1 && wear[0] !== null, `the source face ${f.id} is one loop in one part with one wear (parts ${parts.join(', ')}; wear ${wear.join(', ')})`).toBe(true);
    return { plane: plane!, part: parts[0]!, wear: wear[0]! };
  });
  expect(sources.length, 'the source slab has six faces').toBe(6);
  expect(['top', 'side'].every((p) => sources.some((s) => s.part === p)), `the slab names parts top and side, got ${[...new Set(sources.map((s) => s.part))].join(', ')}`).toBe(true);
  const top = sources.find((s) => s.part === 'top')!.plane;

  // The output faces.
  const problems: string[] = [];
  const out = meshRow(reply, 'out', 'the output');
  const wear = wearOf(out, 'the output', problems);
  const parts = partsOfFaces(out, 'the output');
  const uv = uv0Of(out, 'the output');
  const inners = out.view.faces.filter((f) => inPlane(out.view, f, 1, top.d) && !touches(out.view, f, CORNERS));
  if (inners.length !== 1) problems.push(`the output: ${inners.length} faces in the top's plane touch no corner of the slab, not the one inner face`);
  for (const f of out.view.faces) {
    const inner = inners.includes(f);
    const name = `the output: face ${f.id}${inner ? ', the inner face,' : ''}`;
    const plane = planeOf(out, f);
    const source = plane && sources.find((s) => length(sub(s.plane.n, plane.n)) <= PLACE && Math.abs(s.plane.d - plane.d) <= PLACE);
    if (!source) { problems.push(`${name} lies in no source face's plane`); continue; }
    const mine = parts.get(f.id) ?? [];
    const want = inner ? 'panel' : source.part;
    if (mine.length === 0) problems.push(`${name} is in no part`);
    else if (mine.length > 1) problems.push(`${name} is in ${mine.length} parts: ${mine.join(', ')}`);
    else if (mine[0] !== want) problems.push(`${name} is in part ${mine[0]}, not ${want}`);
    if (wear) {
      const values = [...new Set(f.tris.map((t) => wear[t]!))];
      if (values.some((w) => w === null)) problems.push(`${name} has no wear`);
      else if (values.length > 1) problems.push(`${name} has more than one wear: ${values.map((w) => fmt(w!)).join(', ')}`);
      else if (!(Math.abs(values[0]! - source.wear) <= 1e-9)) problems.push(`${name} has wear ${fmt(values[0]!)}, not its source face's ${fmt(source.wear)}`);
    }
    if (inner) {
      const at = [...new Set(f.tris.flatMap((t) => [0, 1, 2].map((j) => out.indices[3 * t + j]!)))].map((i) => uv[i]!);
      const span = [0, 1].map((k) => Math.max(...at.map((p) => p[k]!)) - Math.min(...at.map((p) => p[k]!)));
      if (!span.every((s) => Math.abs(s - 0.8) <= 1e-9)) problems.push(`${name} has a uv0 that spans ${fmt(span[0]!)} by ${fmt(span[1]!)} units, not 0.8 by 0.8`);
    }
  }
  return problems;
}

describe(`${AC[8]} parts, face attributes and uv0 through offset_faces and dissolve`, () => {
  it(`${AC[8]} every output face is in exactly one part and keeps its source face's wear, and the inner face's uv0 spans 0.8 by 0.8 units`, () => {
    none(partProblems(), 'parts, wear and uv0');
  }, SLOW);

  it(`${AC[8]} the planted offset_drops_wear fails, naming the attribute`, () => {
    failsNaming(partProblems('offset_drops_wear'), ['wear'], 'the planted offset_drops_wear');
  }, SLOW);

  it(`${AC[8]} the planted offset_inner_unparted fails, naming the face`, () => {
    failsNaming(partProblems('offset_inner_unparted'), [/face \d+, the inner face, is in no part/], 'the planted offset_inner_unparted');
  }, SLOW);
});
