// AC6: "On a 1 m slab box, a `mark.line` with `edges` of kind `quads` draws 12 segments and of kind `all` 18,
// counted on welded positions, so an edge split for its normals draws once; in a three-quarter view the 9 edges
// that don't meet the hidden corner draw unbroken at the line's width, and the 3 that do draw nowhere. A planted
// reader that skips welding draws 24 segments for `quads` and fails, and one that skips the depth test draws the 3
// hidden edges and fails, naming them"
//
// A 1 m slab box (`slab@1 {size: [1, 1, 1]}`) and two lines reading it, `edges: {of: "cube", kind: "quads"}` and
// `kind: "all"`, 3 px wide in screen size space. Counted on wgpu's noop backend from `view3d`'s `segments` (each
// segment a mesh-edge line drew, in world metres, with `counts: true`): quads draws the cube's 12 edges, once each;
// all draws those 12 and one diagonal per face, 18. Drawn on Metal in a three-quarter view (a perspective camera
// up, right and in front of the box, so three faces show): in the object-ID target, sampled from 15% to 85% along
// each edge's projection, the 9 edges that don't meet the corner farthest from the camera are the line's pixels
// at every sample, about 3 px across; the 3 that meet it show no line pixel near any sample clear of the visible
// edges. `--planted edges_unwelded` draws 24 for quads; `--planted edges_skip_depth` draws the hidden 3, and the
// check names each by its corners.

import { describe, expect, it } from 'vitest';
import {
  ALL_SEGMENTS, AC, HIDDEN_EDGES, QUADS_SEGMENTS, UNWELDED_QUADS, VISIBLE_EDGES, failsNaming, frameAt, length, look, none, project, readIds,
  requireGpu, runGpu, sessionDoc, sub, useBins, useDir, view3Reply, view3d, weldKey, writeJson, type Frame3, type Ids, type JsonObject, type Pinhole,
  type Startup, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const WIDTH = 3;
const CAMERA: Pinhole = { position: [2.4, 1.9, 3.2], target: [0, 0.25, 0], fov: 35, size: SIZE };

const line = (kind: 'quads' | 'all'): JsonObject => ({ kind: 'mark.line@1', params: { edges: { of: 'cube', kind }, width: WIDTH, size_space: 'screen', paint: { fill: { role: 'accent' } } } });
function edgesDoc(kinds: ('quads' | 'all')[]): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: CAMERA.position, target: CAMERA.target, fov: CAMERA.fov, near: 0.1 } },
    cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0, 0] } },
  };
  for (const k of kinds) items[`edges_${k}`] = line(k);
  return sessionDoc(`Mesh edges ${kinds.join(' ')}`, items, { size: SIZE, camera: 'cam' });
}

function draw(kinds: ('quads' | 'all')[], startup: Startup, ids: boolean): Frame3 {
  const doc = writeJson(dir(), 'edges.json', edgesDoc(kinds));
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [view3d({ doc, look: look(), size: SIZE, frames: 1, counts: true, ...(ids ? { targets: ['ids'], capture: [0] } : {}) })], startup);
  return frameAt(view3Reply(reply!, 'the edges'), 0, 'the edges');
}

const segKey = (a: V3, b: V3): string => [weldKey(a), weldKey(b)].sort().join('|');
/** The segments a line drew, failing when the frame doesn't list them. */
function segmentsOf(f: Frame3, id: string): [V3, V3][] {
  expect(f.segments, 'the frame lists the segments each mesh-edge line drew (counts: true)').not.toBeNull();
  const s = f.segments!.get(id);
  expect(s, `the frame lists ${id}'s segments`).toBeDefined();
  return s!;
}
/** The cube's 8 corners as the segments name them, and its 12 edges. */
function cubeOf(segs: [V3, V3][]): { corners: V3[]; edges: [V3, V3][] } {
  const at = new Map<string, V3>();
  for (const [a, b] of segs) { at.set(weldKey(a), a); at.set(weldKey(b), b); }
  const corners = [...at.values()];
  const edges: [V3, V3][] = [];
  for (let i = 0; i < corners.length; i++) for (let j = i + 1; j < corners.length; j++) if (Math.abs(length(sub(corners[i]!, corners[j]!)) - 1) < 1e-6) edges.push([corners[i]!, corners[j]!]);
  return { corners, edges };
}

/** The counts AC6 asks for, on welded positions; failures say what was drawn. */
function countProblems(quads: [V3, V3][], all: [V3, V3][]): string[] {
  const out: string[] = [];
  const q = new Set(quads.map(([a, b]) => segKey(a, b)));
  const al = new Set(all.map(([a, b]) => segKey(a, b)));
  if (quads.length !== QUADS_SEGMENTS) out.push(`quads draws ${quads.length} segments, not ${QUADS_SEGMENTS}`);
  if (q.size !== quads.length) out.push(`quads draws ${quads.length - q.size} segments twice on welded positions`);
  if (all.length !== ALL_SEGMENTS) out.push(`all draws ${all.length} segments, not ${ALL_SEGMENTS}`);
  if (al.size !== all.length) out.push(`all draws ${all.length - al.size} segments twice on welded positions`);
  const { corners, edges } = cubeOf(quads);
  if (corners.length !== 8 || edges.length !== 12) out.push(`quads' segments meet at ${corners.length} points with ${edges.length} unit edges between them, not a 1 m cube's 8 and 12`);
  const cubeEdges = new Set(edges.map(([a, b]) => segKey(a, b)));
  for (const k of q) if (!cubeEdges.has(k)) out.push(`quads draws ${k}, which isn't an edge of the 1 m box`);
  for (const k of cubeEdges) if (!al.has(k)) out.push(`all leaves out the box edge ${k}`);
  const diagonals = all.filter(([a, b]) => Math.abs(length(sub(a, b)) - Math.SQRT2) < 1e-6);
  if (diagonals.length !== 6) out.push(`all draws ${diagonals.length} face diagonals, not one per face (6)`);
  return out;
}

/** An edge's name by its corners' signs about the box's centre, e.g. (−,−,−)–(+,−,−). */
function nameOf(a: V3, b: V3, centre: V3): string {
  const sign = (p: V3): string => `(${p.map((x, k) => (x < centre[k]! ? '−' : '+')).join(',')})`;
  return [sign(a), sign(b)].sort().join('–');
}
/** Distance in px from a point to a segment. */
function toSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The depth half of AC6, in the ID target; failures name each edge by its corners. */
function depthProblems(ids: Ids, edges: [V3, V3][], lineId: string): string[] {
  const out: string[] = [];
  const corners = [...new Map(edges.flat().map((p) => [weldKey(p), p])).values()];
  const centre: V3 = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / corners.length) as V3;
  const hidden = corners.reduce((far, p) => (length(sub(p, CAMERA.position)) > length(sub(far, CAMERA.position)) ? p : far), corners[0]!);
  const proj = (p: V3): [number, number] => { const [x, y] = project(CAMERA, p); return [x, y]; };
  for (const p of corners) { const [x, y] = proj(p); if (x < 4 || y < 4 || x > SIZE[0] - 4 || y > SIZE[1] - 4) out.push(`corner ${JSON.stringify(p)} projects outside the frame`); }
  const meets = (e: [V3, V3]): boolean => weldKey(e[0]) === weldKey(hidden) || weldKey(e[1]) === weldKey(hidden);
  const visible = edges.filter((e) => !meets(e));
  const behind = edges.filter(meets);
  if (visible.length !== VISIBLE_EDGES || behind.length !== HIDDEN_EDGES) out.push(`the box has ${visible.length} edges away from the hidden corner and ${behind.length} at it, not ${VISIBLE_EDGES} and ${HIDDEN_EDGES}`);
  const isLine = (x: number, y: number): boolean => ids.at(x, y) === lineId;
  for (const e of visible) {
    const [a, b] = [proj(e[0]), proj(e[1])];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: [number, number] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    let gaps = 0; let thin = 0; let wide = 0; let samples = 0;
    for (let f = 0.15; f <= 0.851; f += 0.05) {
      samples++;
      const p: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      let across = 0;
      for (let s = -(WIDTH + 4); s <= WIDTH + 4; s += 0.25) if (isLine(p[0] + n[0] * s, p[1] + n[1] * s)) across += 0.25;
      if (across === 0) gaps++;
      else if (across < WIDTH - 1.5) thin++;
      else if (across > WIDTH + 1.5) wide++;
    }
    const name = nameOf(e[0], e[1], centre);
    if (gaps) out.push(`edge ${name} is broken: no line pixel at ${gaps} of ${samples} samples`);
    if (thin || wide) out.push(`edge ${name} isn't ${WIDTH} px wide: ${thin} samples thinner and ${wide} wider than ${WIDTH} ± 1.5 px`);
  }
  const visibleProj = visible.map((e) => [proj(e[0]), proj(e[1])] as const);
  for (const e of behind) {
    const [a, b] = [proj(e[0]), proj(e[1])];
    let drawn = 0; let clear = 0;
    for (let f = 0.15; f <= 0.851; f += 0.05) {
      const p: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      if (visibleProj.some(([va, vb]) => toSegment(p, va, vb) < WIDTH / 2 + 3)) continue;
      clear++;
      let hit = false;
      for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) if (isLine(p[0] + dx, p[1] + dy)) hit = true;
      if (hit) drawn++;
    }
    const name = nameOf(e[0], e[1], centre);
    if (clear < 4) out.push(`edge ${name} has only ${clear} samples clear of the visible edges, too few to judge`);
    if (drawn) out.push(`hidden edge ${name} draws: line pixels at ${drawn} of ${clear} samples behind the box's faces`);
  }
  return out;
}

describe(`${AC[6]} mesh edges of a 1 m slab box`, () => {
  it(`${AC[6]} quads draws ${QUADS_SEGMENTS} segments and all ${ALL_SEGMENTS}, counted on welded positions, each edge once (noop lane)`, () => {
    const f = draw(['quads', 'all'], { backend: 'noop' }, false);
    none(countProblems(segmentsOf(f, 'edges_quads'), segmentsOf(f, 'edges_all')), 'the mesh-edge counts');
  }, 900_000);

  it(`${AC[6]} the planted edges_unwelded draws ${UNWELDED_QUADS} segments for quads and fails the count`, () => {
    const f = draw(['quads', 'all'], { backend: 'noop', planted: 'edges_unwelded' }, false);
    const quads = segmentsOf(f, 'edges_quads');
    expect(quads.length, 'the reader that skips welding draws each face\'s four edges').toBe(UNWELDED_QUADS);
    failsNaming(countProblems(quads, segmentsOf(f, 'edges_all')), [`quads draws ${UNWELDED_QUADS} segments`], 'the planted edges_unwelded');
  }, 900_000);

  it(`${AC[6]} in a three-quarter view the ${VISIBLE_EDGES} edges away from the hidden corner draw unbroken at ${WIDTH} px and the ${HIDDEN_EDGES} at it draw nowhere`, () => {
    requireGpu();
    const f = draw(['quads'], {}, true);
    const edges = segmentsOf(f, 'edges_quads');
    const cube = cubeOf(edges);
    expect([edges.length, cube.corners.length, cube.edges.length], 'on Metal too, quads draws the box\'s 12 edges between its 8 corners').toEqual([QUADS_SEGMENTS, 8, 12]);
    none(depthProblems(readIds(dir(), f, 'the ID target'), edges, 'edges_quads'), 'the edges in depth');
  }, 900_000);

  it(`${AC[6]} the planted edges_skip_depth draws the ${HIDDEN_EDGES} hidden edges and fails, naming each`, () => {
    requireGpu();
    const clean = segmentsOf(draw(['quads'], {}, false), 'edges_quads');
    const f = draw(['quads'], { planted: 'edges_skip_depth' }, true);
    const edges = segmentsOf(f, 'edges_quads');
    const corners = [...new Map(clean.flat().map((p) => [weldKey(p), p])).values()];
    const centre: V3 = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / corners.length) as V3;
    const hidden = corners.reduce((far, p) => (length(sub(p, CAMERA.position)) > length(sub(far, CAMERA.position)) ? p : far), corners[0]!);
    const names = clean.filter(([a, b]) => weldKey(a) === weldKey(hidden) || weldKey(b) === weldKey(hidden)).map(([a, b]) => `hidden edge ${nameOf(a, b, centre)} draws`);
    expect(names.length, 'three edges meet the hidden corner').toBe(HIDDEN_EDGES);
    failsNaming(depthProblems(readIds(dir(), f, 'the ID target'), edges, 'edges_quads'), names, 'the planted edges_skip_depth');
  }, 900_000);
});

