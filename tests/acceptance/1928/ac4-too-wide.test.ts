// AC4: "On the 1 m slab cube, `by: 0.5` on `parts: [top]` is refused at check with `offset_faces.too_wide`,
// naming the item, the face, 0.5 m and the limit of 0.5 m, with 0 builds, and `by: 0.49` builds an inner face of
// 0.02 × 0.02 = 0.0004 m². A planted check that lets 0.5 through builds a face with zero-length edges and fails,
// naming the face"
//
// Two documents, each one 1 m slab cube `cube` under `mod.offset_faces@1 {parts: [top], by}`: by 0.49 in the
// first, by 0.5 in the second.
//   - by 0.49 is presented, and its inner face (in the plane y = 1, touching no corner of the cube) is 0.0004 m²
//     within 1e-9 relative.
//   - by 0.5 is shown to a hidden panel. The base evaluates no frame for a hidden panel, so presenting a revision
//     there builds nothing and only the check can refuse it: "at check, with 0 builds". It must be refused
//     (`deep_show` outcome `refused`) with an error issue `offset_faces.too_wide` whose fields name `item:
//     "cube"`, `face`: the ID of the cube's top face in the mesh the modifier takes (the builder's, read from the
//     first document's row at `stage: "built"` as its face in the plane y = 1), `by: 0.5` and `max: 0.5`. No
//     revision of that document then stands, so `geometry` answers it `no_revision`.
// When `geometry` builds the second document instead, the check reads what was built and names each face with a
// zero-length edge (one of its triangles has two corners at one welded point) as `built face <id>`.

import { describe, expect, it } from 'vitest';
import { AC, CUBE, DOC, SLOW, admitted, failsNaming, fieldOf, geometryCall, issuesOf, meshRow, none, obj, offsetFaces, runShow, scenario, sceneDoc, show, shown, useDir, useShow, type JsonObject, type Planted } from './helpers.ts';
import { areaProblems, boxCorners, hasZeroEdge, inPlane, touches } from './reference.ts';

const bin = useShow();
const dir = useDir();

const doc = (by: number): JsonObject => sceneDoc(`A cube's top offset by ${by} m`, {
  cube: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by })] },
});
const CORNERS = boxCorners([-0.5, 0, -0.5], [0.5, 1, 0.5]);
const near = (value: unknown, want: number): boolean => typeof value === 'number' && Math.abs(value - want) <= 1e-9;

function tooWideProblems(planted?: Planted): string[] {
  const replies = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [
    show(DOC.a, doc(0.49)), geometryCall(DOC.a, ['cube']), geometryCall(DOC.a, ['cube'], { stage: 'built' }),
    show(DOC.b, doc(0.5)), geometryCall(DOC.b, ['cube']),
  ], planted, [DOC.b]));
  const out: string[] = [];

  // by 0.49 builds.
  admitted(replies[0], 'by 0.49');
  const narrow = meshRow(replies[1], 'cube', 'by 0.49').view;
  const inner = narrow.faces.filter((f) => inPlane(narrow, f, 1, 1) && !touches(narrow, f, CORNERS));
  if (inner.length !== 1) out.push(`by 0.49: ${inner.length} faces in the top plane touch no corner of the cube, not the one inner face`);
  for (const f of inner) out.push(...areaProblems(narrow, f, 0.0004, 1e-9, `by 0.49: the inner face (face ${f.id})`));

  // The cube's top face, as the mesh the modifier takes numbers it.
  const plain = meshRow(replies[2], 'cube', 'the cube as its builder made it').view;
  const tops = plain.faces.filter((f) => inPlane(plain, f, 1, 1));
  expect(tops.length, 'the cube as its builder made it has one face in its top plane').toBe(1);
  const top = tops[0]!.id;

  // by 0.5, where nothing is built, is refused, naming the item, the face, 0.5 m and the limit of 0.5 m.
  const wide = obj(replies[3], 'by 0.5: the deep_show reply');
  const issues = issuesOf(wide, 'by 0.5');
  const tooWide = issues.filter((i) => i.code === 'offset_faces.too_wide');
  if (wide['outcome'] !== 'refused') out.push(`by 0.5 on the cube's top (face ${top}) was not refused at check: deep_show answered ${shown(wide['outcome'])}`);
  if (tooWide.length === 0) out.push(`by 0.5: no issue offset_faces.too_wide; the issues were ${shown(issues.map((i) => i.raw))}`);
  for (const i of tooWide) {
    if (i.severity !== 'error') out.push(`offset_faces.too_wide has severity ${i.severity}, not error`);
    if (fieldOf(i, 'item') !== 'cube') out.push(`offset_faces.too_wide names item ${shown(fieldOf(i, 'item'))}, not cube`);
    if (fieldOf(i, 'face') !== top) out.push(`offset_faces.too_wide names face ${shown(fieldOf(i, 'face'))}, not the cube's top, face ${top}`);
    if (!near(fieldOf(i, 'by'), 0.5)) out.push(`offset_faces.too_wide names by ${shown(fieldOf(i, 'by'))}, not 0.5 m`);
    if (!near(fieldOf(i, 'max'), 0.5)) out.push(`offset_faces.too_wide names max ${shown(fieldOf(i, 'max'))}, not the limit of 0.5 m`);
  }

  // With 0 builds: no revision stands to build.
  const after = obj(replies[4], 'by 0.5: the geometry reply');
  if (after['code'] !== 'no_revision') {
    out.push(`by 0.5 left a revision to build: geometry answered ${after['code'] === undefined ? `${shown(after['builds'])} builds` : shown(after['code'])}, not no_revision`);
    if (Array.isArray(after['items'])) {
      const built = meshRow(after, 'cube', 'by 0.5 as built');
      for (const f of built.view.faces.filter((x) => hasZeroEdge(built.view, built.indices, x))) out.push(`by 0.5 built face ${f.id} with zero-length edges`);
    }
  }
  return out;
}

describe(`${AC[4]} an offset as wide as its face is refused at check`, () => {
  it(`${AC[4]} by 0.5 on the cube's top is refused with offset_faces.too_wide naming the item, the face, 0.5 m and the limit of 0.5 m, with 0 builds, and by 0.49 builds an inner face of 0.0004 m²`, () => {
    none(tooWideProblems(), 'the too-wide offset');
  }, SLOW);

  it(`${AC[4]} the planted offset_too_wide_unchecked (a check that lets 0.5 through) builds a face with zero-length edges and fails, naming the face`, () => {
    failsNaming(tooWideProblems('offset_too_wide_unchecked'), [/by 0\.5 built face \d+ with zero-length edges/], 'the planted offset_too_wide_unchecked');
  }, SLOW);
});
