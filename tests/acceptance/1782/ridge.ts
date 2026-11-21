// The "1 m edge" fixture, shared by blocker.test.ts (AC3, AC4, AC6) and dash.test.ts (AC5). The edge is the ridge of
// the fold (reference.ts: fold), a `mesh.asset@1` read with `crease {angle: 30}` and `border: false`, so the line
// picks the ridge alone: edge 0, from (−0.5, 0, 0), its start, to (0.5, 0, 0). The camera is on +Z, where nothing of
// the fold is in front of the ridge, and one flat quad stands between them (reference.ts: quad). Two lines read the
// fold: `twin`, with no `hidden`, which the base answers, and `edges`, with `hidden`.
//
// Orthographic: the camera looks along −Z, so a quad from x0 to x1 hides the ridge from x0 to x1 at any distance.
// Perspective: the camera is at (0, 0, 4), on the ridge's perpendicular through its midpoint, 4 m away; a quad in
// the plane z = 2, halfway, hides twice its own width of the ridge.

import { expect } from 'vitest';
import type { LineSpec } from '../1640/helpers.ts';
import { weldKey } from '../1640/reference.ts';
import { assetItem, creaseEdges, line, material, perspective, type Draw, type HiddenSpec, type JsonObject } from './helpers.ts';
import { RIDGE, fold, type Asset, type Edge } from './reference.ts';

export const LINE = 'edges';
export const TWIN = 'twin';
/** The frame is 640 px across 1.6 m: 400 px a metre. */
export const VIEW_WIDTH = 1.6;
/** How far the perspective camera is from the ridge, and where the blocker stands: halfway. */
export const EYE = 4;
export const HALFWAY = 2;

const CAMERAS: Record<View, JsonObject> = {
  orthographic: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], view_width: VIEW_WIDTH } },
  perspective: perspective([0, 0, EYE], [0, 0, 0]),
};
/** The materials an occluder can have: opaque, a pane at transmission 1, and `alpha_mode: blend`. */
const MATERIALS: Record<string, JsonObject> = {
  grey: material([0.5, 0.5, 0.5]),
  glass: material([0.85, 0.92, 1], { transmission: 1, roughness: 0.05 }),
  cloth: material([0.6, 0.1, 0.12], { alpha_mode: 'blend', alpha: 0.6 }),
};

export type View = 'orthographic' | 'perspective';
export interface Ridge {
  title: string; view: View;
  /** The item between the camera and the ridge: its ID, its quad and its material. */
  occluder: { id: string; quad: Asset; material: 'grey' | 'glass' | 'cloth' };
  /** A cutaway that reaches the occluder only and removes what of it lies at x > 0, past the ridge's midpoint. */
  cut?: boolean;
  /** The line's own width, size space and dash, and its `hidden` style. */
  style?: Omit<LineSpec, 'edges'>; hidden?: HiddenSpec;
}
/** The document: the camera, the fold, the occluder, the cutaway when asked, and the two lines. */
export function ridge(r: Ridge): Draw {
  const edges = creaseEdges('fold', { border: false });
  const items: Record<string, JsonObject> = {
    cam: CAMERAS[r.view], ...MATERIALS,
    fold: assetItem(FOLD, { material: 'grey' }),
    [r.occluder.id]: assetItem(r.occluder.quad, { material: r.occluder.material }),
    ...(r.cut ? { cut: { kind: 'cutaway@1', params: { planes: [{ normal: [1, 0, 0], offset: 0 }], applies_to: r.occluder.id } } } : {}),
    [TWIN]: line({ edges, ...r.style }),
    [LINE]: line({ edges, ...r.style }, r.hidden ?? {}),
  };
  return { title: r.title, items, assets: [FOLD, r.occluder.quad] };
}
const FOLD = fold();

/** The fixture guard, which the base answers: the twin line draws one segment, the ridge. Returns it as edge 0. */
export function ridgeEdge(edges: Edge[], what: string): Edge {
  expect(edges.map((e) => [weldKey(e.start), weldKey(e.end)]), `${what}: the twin line draws the fold's ridge alone, from (−0.5, 0, 0) to (0.5, 0, 0)`).toEqual([[weldKey(RIDGE.start), weldKey(RIDGE.end)]]);
  return edges[0]!;
}
