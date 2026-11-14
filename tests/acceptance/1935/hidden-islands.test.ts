// #1935.aaf15575: "A closed box with a second closed box fully inside it reports the inner box's 12 triangles as
// hidden, naming them; a cup's inner faces, open to the sky, are not hidden. A fixture with 10 stray vertices and a
// 1 mm² floating triangle reports both; its clean twin reports 0 and 1 island"
//
// Fixtures (gltf.ts), each one primitive with no normals and no UV sets:
//   - `boxInBox`: a closed 2 m cube about the origin (triangles 0–11) around a closed 1 m cube about the origin
//     (triangles 12–23).
//   - `cup`: a square cup open to +Y, outside 2.5 × 0.5 × 2.5 m, its cavity 2 m wide and 0.25 m deep, walls and floor
//     0.25 m thick: one closed surface of 28 triangles, its inner walls and floor triangles 18–27. Its cavity is eight
//     times as wide as it is deep, so every inner face sees the sky across most of its upper half (README: Fixtures).
//   - `strayCube(true)`: the unit cube (6 m², vertices 0–7), 10 vertices no triangle uses (8–17) and a 2 mm × 1 mm
//     triangle (1 mm²) 2 m above the cube that touches nothing (vertices 18–20). `strayCube(false)`: the cube alone.
//
// asserts, in one run, with `{kind: geometry.shading}`:
//   - the box in a box: `hidden_faces` 12 and `ids.hidden_faces` exactly `0:12` … `0:23`, so no face of the outer box;
//   - the cup: `hidden_faces` 0 and `ids.hidden_faces` empty;
//   - the stray fixture: `unused_vertices` 10, `islands` 2 and `smallest_island_share` 1 mm² ÷ (6 m² + 1 mm²) within 1%;
//   - its clean twin: `unused_vertices` 0 and `islands` 1.
// Wrong programs: the base, which reports none of these; hidden faces by normals or by distance from the centre
// (the cup's inner faces point inward); a ray to the bounding sphere only along the face normal; islands counted with
// stray vertices or on unwelded triangles; the share by face count rather than area.
import { describe, it } from 'vitest';
import { TIMEOUT, idsFailures, judge, nearFailures, none, the, useBuild, useFolders, type Case, type Judged } from './helpers.ts';
import { FLOAT_BASE, FLOAT_HEIGHT, boxInBox, cup, strayCube } from './gltf.ts';

/** The criterion's ID: `#1935.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1935.aaf15575';
const bin = useBuild();
const folder = useFolders();

const BOXES = boxInBox();
/** The floating triangle's area over the mesh's: 1 mm² over the unit cube's 6 m² and itself. */
const TRIANGLE = (FLOAT_BASE * FLOAT_HEIGHT) / 2;
const SHARE = TRIANGLE / (6 + TRIANGLE);
const CASES: Case[] = [
  { name: 'a closed box with a second closed box fully inside it', prim: BOXES.prim, check: {} },
  { name: 'a cup open to the sky', prim: cup(), check: {} },
  { name: 'a cube with 10 stray vertices and a 1 mm² floating triangle', prim: strayCube(true), check: {} },
  { name: 'its clean twin', prim: strayCube(false), check: {} },
];

describe(`${ID} hidden faces, stray vertices and islands`, () => {
  it(`${ID} the box inside a box reports its 12 triangles hidden, naming them; a cup's inner faces are not hidden; 10 stray vertices and a 1 mm² floating triangle are reported, and the clean twin reports 0 and 1 island`, () => {
    const j = judge(bin(), folder(), CASES);
    const [boxes, cupped, dirty, clean] = CASES.map((c) => the(j, c.name)) as [Judged, Judged, Judged, Judged];
    none([
      ...nearFailures(boxes, 'hidden_faces', 12, 0),
      ...idsFailures(boxes, 'ids.hidden_faces', BOXES.inner),
      ...nearFailures(cupped, 'hidden_faces', 0, 0),
      ...idsFailures(cupped, 'ids.hidden_faces', []),
      ...nearFailures(dirty, 'unused_vertices', 10, 0),
      ...nearFailures(dirty, 'islands', 2, 0),
      ...nearFailures(dirty, 'smallest_island_share', SHARE, SHARE * 0.01),
      ...nearFailures(clean, 'unused_vertices', 0, 0),
      ...nearFailures(clean, 'islands', 1, 0),
    ], 'hidden faces, stray vertices and islands');
  }, TIMEOUT);
});
