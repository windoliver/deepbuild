// AC2: "A 1 m cube with crease edges and `hidden` set, in a three-quarter view, gives 12 spans, each a whole edge:
// 9 visible and the 3 that meet the far corner hidden. A planted classifier that casts against nothing reports 12
// visible and fails, naming the first hidden edge"
//
// The fixture is cube.ts: a 1 m slab@1 cube in #1640's AC4 view, read by `twin` (no `hidden`) and by `edges`
// (`hidden: {paint}`), drawn on the noop lane with `counts: true`.
//
// Fixture guard, which the base answers, drawn from the document without `edges`: `twin` draws the cube's 12 edges,
// each 1 m long between its 8 corners, and 3 of them meet the corner farthest from the camera. Those 12 segments,
// ranked by welded ends, are the edges by ID (README: An edge's ID and start). Conditions: `spans` lists 12 spans in
// edge order, one per edge, each from 0 to 1 m within 1e-5 m; the three edges that meet the far corner are hidden
// and the other nine visible. Under `--planted edges_spans_cast_nothing` the 12 spans are all visible and the check
// fails, its first failure naming the hidden edge with the lowest ID.

import { describe, expect, it } from 'vitest';
import { AC, NOOP, drawHidden, failsNaming, none, spansOf, useDir, useGpuBin, type Span, type Startup } from './helpers.ts';
import { CAMERA, LINE, TWIN, box, cubeItems, cubeProblems, firstHidden, nameOf, type Box } from './cube.ts';
import { CUBE } from './reference.ts';

const bin = useGpuBin();
const dir = useDir();

/** The cube's spans and its edges by ID, the fixture held to its guard. */
function cube(startup: Startup): { spans: Span[]; b: Box; what: string } {
  const { edges, frames, what } = drawHidden(bin(), dir(), { title: 'Hidden cube', items: cubeItems() }, LINE, TWIN, startup);
  const b = box(edges, CAMERA.position, `${what}, its guard`);
  return { spans: spansOf(frames[0]!, LINE, what), b, what };
}

describe(`${AC[2]} a 1 m cube with crease edges and hidden set, in a three-quarter view`, () => {
  it(`${AC[2]} gives 12 spans, each a whole edge: 9 visible and the 3 that meet the far corner hidden (noop lane)`, () => {
    const { spans, b, what } = cube(NOOP);
    none(cubeProblems(spans, b), `${what}: the cube's spans`);
  }, 600_000);

  it(`${AC[2]} a planted classifier that casts against nothing reports 12 visible and fails, naming the first hidden edge (noop lane)`, () => {
    const { spans, b, what } = cube({ backend: 'noop', planted: 'edges_spans_cast_nothing' });
    expect(spans.map((s) => s.hidden), `${what}: the planted classifier reports 12 visible spans`).toEqual(Array.from({ length: CUBE.spans }, () => false));
    const problems = cubeProblems(spans, b);
    const name = nameOf(b, firstHidden(b));
    failsNaming(problems, [name], 'the classifier that casts against nothing');
    expect(problems[0], 'the first failure names the first hidden edge').toContain(name);
  }, 600_000);
});
