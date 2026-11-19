// AC5: "`dissolve` turns a 3 × 3 m `plate {grid: [3, 3]}` of 16 points into 4 points, 4 edges and 1 face of
// 9 m², V − E + F = 1, and a 1 m slab cube under `subdivide {scheme: simple}` at level 1 (26 points) back into
// 8 points, 12 edges and 6 faces holding 1 m³, within 1e-12 relative. A planted dissolve that keeps the points
// between two straight edges leaves 12 points on the plate and fails, naming the count"
//
// Four items: `grid`, a `plate@1 {grid: [3, 3], size: [3, 3]}`, and `plate`, the same under `mod.dissolve@1`;
// `split`, a 1 m slab cube under `mod.subdivide@1 {levels: 1, scheme: simple}`, and `cube`, the same and then
// `mod.dissolve@1`. `grid` and `split` are the inputs the criterion states, held to its 16 and 26 points.
// Counts are the polygon view's (reference.ts), the plate's area its one face's loop's (Newell), and the cube's
// volume the divergence theorem's over triangles that close on welded points. A failure names the count it is
// about, as `<n> points, not <m>`.

import { describe, expect, it } from 'vitest';
import { AC, CUBE, DOC, SLOW, admitted, dissolve, failsNaming, geometryCall, meshRow, none, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type Planted } from './helpers.ts';
import { areaProblems, countProblems, countsOf, fmt, relative, solid } from './reference.ts';

const bin = useShow();
const dir = useDir();

const PLATE: JsonObject = { grid: [3, 3], size: [3, 3] };
const SIMPLE: JsonObject = { kind: 'mod.subdivide@1', params: { levels: 1, scheme: 'simple' } };
const doc = (): JsonObject => sceneDoc('A dissolved plate and cube', {
  grid: { kind: 'plate@1', params: PLATE },
  plate: { kind: 'plate@1', params: PLATE, modifiers: [dissolve()] },
  split: { kind: 'slab@1', params: CUBE, modifiers: [SIMPLE] },
  cube: { kind: 'slab@1', params: CUBE, modifiers: [SIMPLE, dissolve()] },
});

function dissolveProblems(planted?: Planted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['grid', 'plate', 'split', 'cube'])], planted));
  admitted(shown, 'the plate and the cube');
  // The inputs, as the criterion states them.
  expect(countsOf(meshRow(reply, 'grid', 'the plate before dissolve').view).points, 'the 3 × 3 m plate of grid [3, 3] has 16 points').toBe(16);
  expect(countsOf(meshRow(reply, 'split', 'the cube before dissolve').view).points, 'the cube under subdivide simple at level 1 has 26 points').toBe(26);

  const plate = meshRow(reply, 'plate', 'the dissolved plate').view;
  const flat = countsOf(plate);
  const out = countProblems('the dissolved plate', flat, { points: 4, edges: 4, faces: 1 });
  const euler = flat.points - flat.edges + flat.faces;
  if (euler !== 1) out.push(`the dissolved plate: V − E + F = ${euler}, not 1`);
  for (const f of plate.faces) out.push(...areaProblems(plate, f, 9, 1e-12, `the dissolved plate: face ${f.id}`));

  const cube = meshRow(reply, 'cube', 'the dissolved cube');
  out.push(...countProblems('the dissolved cube', countsOf(cube.view), { points: 8, edges: 12, faces: 6 }));
  const { open, volume } = solid(cube.view, cube.indices);
  if (open > 0) out.push(`the dissolved cube: ${open} of its edges aren't on two triangles wound opposite ways, so it doesn't close`);
  if (!(relative(volume, 1) <= 1e-12)) out.push(`the dissolved cube: it holds ${fmt(volume)} m³, not 1 m³ (off by ${relative(volume, 1).toExponential(1)} of it)`);
  return out;
}

describe(`${AC[5]} dissolve merges faces in one plane and removes the points left on straight edges`, () => {
  it(`${AC[5]} the 3 × 3 plate becomes 4 points, 4 edges and 1 face of 9 m² with V − E + F = 1, and the subdivided cube 8 points, 12 edges and 6 faces holding 1 m³`, () => {
    none(dissolveProblems(), 'dissolve');
  }, SLOW);

  it(`${AC[5]} the planted dissolve_keeps_straight_points (the points between two straight edges kept) leaves 12 points on the plate and fails, naming the count`, () => {
    failsNaming(dissolveProblems('dissolve_keeps_straight_points'), ['the dissolved plate: 12 points, not 4'], 'the planted dissolve_keeps_straight_points');
  }, SLOW);
});
