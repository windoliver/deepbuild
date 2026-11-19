// AC2: "With `depth: 0.2` the inner face lies 0.2 m above the top plane and the cube holds 1 + 0.2 ÷ 3 × (1 +
// 0.64 + 0.8) = 1.162667 m³, and with `depth: −0.2` it holds 0.837333 m³. With `parts: [side], by: 0.1, depth:
// 0.2` it holds 1 + 4 × 0.162667 = 1.650667 m³, each within 1e-6 relative. A planted offset that moves every
// inner face along the item's +y instead of its face's normal passes the top case and fails the side case,
// naming a side face"
//
// Three 1 m slab cubes (x and z from −0.5 to 0.5 m, y from 0 to 1 m), each under one `mod.offset_faces@1`:
// `raised` {parts: [top], by: 0.1, depth: 0.2}, `sunk` {parts: [top], by: 0.1, depth: −0.2} and `sides`
// {parts: [side], by: 0.1, depth: 0.2}. A volume is the divergence theorem's over the row's triangles, which
// must close on welded points (reference.ts: solid). An inner face is a face that touches no corner of the
// cube; it must lie 0.2 m outside the plane of the cube's face it faces, within 1e-9 m at every corner: the top
// plane for `raised`, and for `sides` one of the four side planes each. The top case is `raised` and `sunk`;
// the side case is `sides`, and a failure about one of its inner faces names it `face <id>, the inner face of
// a side face`.

import { describe, it } from 'vitest';
import { AC, CUBE, DOC, SLOW, admitted, failsNaming, geometryCall, meshRow, none, offsetFaces, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type MeshRow, type Planted } from './helpers.ts';
import { PLACE, areaVector, boxCorners, dot, fmt, fmtV, relative, solid, sub, touches, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const doc = (): JsonObject => sceneDoc('Raised and sunk panels', {
  raised: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by: 0.1, depth: 0.2 })] },
  sunk: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by: 0.1, depth: -0.2 })] },
  sides: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['side'], by: 0.1, depth: 0.2 })] },
});
const CORNERS = boxCorners([-0.5, 0, -0.5], [0.5, 1, 0.5]);
const CENTRE: V3 = [0, 0.5, 0];
const UP: V3[] = [[0, 1, 0]];
const AROUND: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

/** Why the row doesn't hold `want` m³ within 1e-6 relative. */
function volumeProblems(row: MeshRow, want: number, what: string): string[] {
  const { open, volume } = solid(row.view, row.indices);
  const out: string[] = [];
  if (open > 0) out.push(`${what}: ${open} of its edges aren't on two triangles wound opposite ways, so it doesn't close`);
  if (!(relative(volume, want) <= 1e-6)) out.push(`${what}: it holds ${fmt(volume)} m³, not ${fmt(want)} m³`);
  return out;
}

/**
 * Why the row's inner faces aren't one per normal of `normals`, each lying 0.2 m outside the plane of the cube's
 * face with that normal (0.5 m from the cube's centre). An inner face belongs to the normal it faces most.
 */
function innerProblems(row: MeshRow, normals: V3[], part: string, what: string): string[] {
  const { view } = row;
  const inner = view.faces.filter((f) => !touches(view, f, CORNERS));
  const out: string[] = [];
  if (inner.length !== normals.length) out.push(`${what}: ${inner.length} faces touch no corner of the cube, not ${normals.length} (one inner face per ${part} face)`);
  const faced = new Set<V3>();
  for (const f of inner) {
    const name = `${what}: face ${f.id}, the inner face of a ${part} face`;
    if (!f.loop) { out.push(`${name}: its boundary is not one simple loop`); continue; }
    const n = areaVector(view, f.loop);
    const side = normals.reduce((best, s) => (dot(n, s) > dot(n, best) ? s : best));
    faced.add(side);
    const outside = f.points.map((p) => dot(sub(view.points[p]!, CENTRE), side) - 0.5);
    if (!outside.every((d) => Math.abs(d - 0.2) <= PLACE)) out.push(`${name}, lies ${fmt(Math.min(...outside))} to ${fmt(Math.max(...outside))} m outside the plane of the face facing ${fmtV(side)}, not 0.2 m`);
  }
  if (inner.length === normals.length && faced.size !== normals.length) out.push(`${what}: its inner faces face ${faced.size} of its ${normals.length} ${part} faces`);
  return out;
}

function depthProblems(planted?: Planted): { top: string[]; side: string[] } {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['raised', 'sunk', 'sides'])], planted));
  admitted(shown, 'the panels');
  const raised = meshRow(reply, 'raised', 'depth 0.2 on the top');
  const sunk = meshRow(reply, 'sunk', 'depth −0.2 on the top');
  const sides = meshRow(reply, 'sides', 'depth 0.2 on the sides');
  return {
    top: [
      ...innerProblems(raised, UP, 'top', 'depth 0.2 on the top'),
      ...volumeProblems(raised, 1.162667, 'depth 0.2 on the top'),
      ...volumeProblems(sunk, 0.837333, 'depth −0.2 on the top'),
    ],
    side: [
      ...innerProblems(sides, AROUND, 'side', 'depth 0.2 on the sides'),
      ...volumeProblems(sides, 1.650667, 'depth 0.2 on the sides'),
    ],
  };
}

describe(`${AC[2]} an inner face moved by a depth along its face's normal`, () => {
  it(`${AC[2]} depth 0.2 lifts the top's inner face 0.2 m and the cube holds 1.162667 m³, depth −0.2 holds 0.837333 m³, and the four sides at depth 0.2 hold 1.650667 m³`, () => {
    const { top, side } = depthProblems();
    none([...top, ...side], 'the raised and sunk panels');
  }, SLOW);

  it(`${AC[2]} the planted offset_depth_along_y (every inner face moved along the item's +y) passes the top case and fails the side case, naming a side face`, () => {
    const { top, side } = depthProblems('offset_depth_along_y');
    none(top, 'the planted offset_depth_along_y, on the top');
    failsNaming(side, [/face \d+, the inner face of a side face, lies /], 'the planted offset_depth_along_y, on the sides');
  }, SLOW);
});
