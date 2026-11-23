// The AC2 fixture and its check, shared by the files that read the cube: cube.test.ts (frames on the noop lane),
// geometry.test.ts (the `geometry` call on `deep-show`) and ids.test.ts (AC8, from two cameras). A 1 m slab@1 cube
// in #1640's AC4 view, or from another eye when a file moves the camera: a perspective
// camera above, to the right and in front of it, so three faces show and one corner is farthest. Two lines read its
// crease edges: `twin`, with no `hidden`, which the base answers, and `edges`, with `hidden: {paint}` (no hidden
// dash: a hidden span draws solid). The check returns its failures in edge order, each naming the edge.

import { expect } from 'vitest';
import { length, sub, weldKey, type V3 } from '../1640/reference.ts';
import { boxEdgeName, creaseEdges, line, perspective, spanProblems, tilingProblems, type JsonObject, type Span } from './helpers.ts';
import { CUBE, type Edge } from './reference.ts';

/** #1640's AC4 camera: up, right and in front of the box. */
export const CAMERA = { position: [2.4, 1.9, 3.2] as V3, target: [0, 0.25, 0] as V3, fov: 35 } as const;
export const LINE = 'edges';
export const TWIN = 'twin';

/** The camera at `eye`, the cube, the twin line and the line with `hidden`. */
export function cubeItems(eye: V3 = CAMERA.position): Record<string, JsonObject> {
  return {
    cam: perspective(eye, CAMERA.target, CAMERA.fov),
    cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0, 0] } },
    [TWIN]: line({ edges: creaseEdges('cube') }),
    [LINE]: line({ edges: creaseEdges('cube') }, {}),
  };
}

export interface Box { edges: Edge[]; centre: V3; far: V3 }
export const meets = (e: Edge, corner: V3): boolean => weldKey(e.start) === weldKey(corner) || weldKey(e.end) === weldKey(corner);
/**
 * The fixture guard, which the base answers: the twin line's edges by ID are the cube's 12, each 1 m long between
 * its 8 corners, and three of them meet the corner farthest from `eye`.
 */
export function box(edges: Edge[], eye: V3, what: string): Box {
  const corners = [...new Map(edges.flatMap((e) => [e.start, e.end]).map((p) => [weldKey(p), p])).values()];
  const unit = edges.filter((e) => Math.abs(e.length - CUBE.edge) <= 1e-6);
  expect([edges.length, corners.length, unit.length], `${what}: the twin line draws the cube's 12 edges, 1 m each, between its 8 corners`).toEqual([CUBE.spans, 8, CUBE.spans]);
  const centre = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / corners.length) as V3;
  const far = corners.reduce((f, p) => (length(sub(p, eye)) > length(sub(f, eye)) ? p : f), corners[0]!);
  expect(edges.filter((e) => meets(e, far)).length, `${what}: three edges meet the corner farthest from the camera`).toBe(CUBE.hidden);
  return { edges, centre, far };
}
export const nameOf = (b: Box, e: Edge): string => boxEdgeName(e, b.centre);
/** "The first hidden edge": the edge with the lowest ID that meets the far corner. */
export const firstHidden = (b: Box): Edge => b.edges.find((e) => meets(e, b.far))!;

/** AC2's check: 12 spans, one a whole edge each, hidden exactly where the edge meets the far corner. */
export function cubeProblems(spans: readonly Span[], b: Box): string[] {
  const out = tilingProblems(spans, b.edges);
  if (spans.length !== CUBE.spans) out.push(`the cube's line gives ${spans.length} spans, not ${CUBE.spans}`);
  for (const e of b.edges) out.push(...spanProblems(spans, e, [[0, CUBE.edge, meets(e, b.far)]], 'span', nameOf(b, e)));
  const hidden = spans.filter((s) => s.hidden).length;
  if (hidden !== CUBE.hidden || spans.length - hidden !== CUBE.visible) out.push(`the cube's line gives ${spans.length - hidden} visible and ${hidden} hidden spans, not ${CUBE.visible} and ${CUBE.hidden}`);
  return out;
}
