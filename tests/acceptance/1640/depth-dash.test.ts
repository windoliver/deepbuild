// AC4: "A crease edge on the far side of the cube never draws over its near faces, and with `dash` it dashes in its
// size space"
//
// A 1 m slab@1 cube read by a `mark.line@1` with `edges: {of: "cube", kind: {crease: {angle: 30}}}`, drawn on the
// reference Mac in a three-quarter view (#420's camera: up, right and in front of the box, so three faces show) into
// the object-ID target. Conditions, depth: the line draws the cube's 12 edges; the 9 that don't meet the corner
// farthest from the camera are the line's pixels at every sample from 15% to 85% along their projection, 3 ± 1.5 px
// across; the 3 on the far side, which meet that corner, show no line pixel near any sample clear of the visible
// edges. #420's `--planted edges_skip_depth` (mesh edges drawn without the depth test) draws them and fails, naming
// each by its corners. Conditions, dash: with `size_space: screen` and `dash: [8, 8]` (px), along each visible edge's
// middle 70% the line's dashes start every 16 ± 2 px on screen; with `size_space: world` and `dash: [0.1, 0.1]` (m),
// every 0.2 ± 0.02 m along the edge in the world. `--planted edges_dash_other_space` reads the dash in the other
// size space and fails both, naming the line and the edge.

import { describe, expect, it } from 'vitest';
import {
  AC, CUBE_SEGMENTS, creaseEdges, edgeLine, failsNaming, look, none, readIds, requireGpu, runGpu, segmentsOf, sessionDoc, useDir, useGpuBin,
  view3d, view3Reply, writeFile, type Frame3, type Ids, type LineSpec, type Startup,
} from './helpers.ts';
import { add, length, project, scale, sub, weldKey, type Pinhole, type V3 } from './reference.ts';

const bin = useGpuBin();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const WIDTH = 3;
const CAMERA: Pinhole = { position: [2.4, 1.9, 3.2], target: [0, 0.25, 0], fov: 35, size: SIZE };
const VISIBLE_EDGES = 9;
const HIDDEN_EDGES = 3;
const LINE = 'crease';
/** The two dashes AC4 draws: on and off lengths in the line's size space, and the period a check holds them to. */
const SCREEN_DASH = { dash: [8, 8], period: 16, tolerance: 2, unit: 'px' } as const;
const WORLD_DASH = { dash: [0.1, 0.1], width: 0.02, period: 0.2, tolerance: 0.02, unit: 'm' } as const;

function draw(line: Omit<LineSpec, 'edges'>, startup: Startup): Frame3 {
  const doc = writeFile(dir(), 'cube.json', sessionDoc('Crease cube', {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: CAMERA.position, target: CAMERA.target, fov: CAMERA.fov, near: 0.1 } },
    cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0, 0] } },
    [LINE]: edgeLine({ edges: creaseEdges('cube'), ...line }),
  }));
  const [reply] = runGpu(bin(), dir(), [view3d({ doc, look: look(), size: SIZE, frames: 1, counts: true, targets: ['ids'], capture: [0] })], startup);
  return view3Reply(reply!, `the crease cube${startup.planted ? ` with --planted ${startup.planted}` : ''}`, 1)[0]!;
}

/** The cube's edges as the line drew them, held to the 12 edges of a 1 m box between 8 corners. */
function cubeEdges(f: Frame3, what: string): { edges: [V3, V3][]; corners: V3[] } {
  const edges = segmentsOf(f, LINE, what);
  const corners = [...new Map(edges.flat().map((p) => [weldKey(p), p])).values()];
  const unitEdges = edges.filter(([a, b]) => Math.abs(length(sub(a, b)) - 1) < 1e-6);
  expect([edges.length, corners.length, unitEdges.length], `${what}: the crease line draws the box's ${CUBE_SEGMENTS} edges between its 8 corners`).toEqual([CUBE_SEGMENTS, 8, CUBE_SEGMENTS]);
  return { edges, corners };
}
const centreOf = (corners: V3[]): V3 => [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / corners.length) as V3;
const farthest = (corners: V3[]): V3 => corners.reduce((far, p) => (length(sub(p, CAMERA.position)) > length(sub(far, CAMERA.position)) ? p : far), corners[0]!);
/** An edge's name by its corners' signs about the box's centre, e.g. (−,−,−)–(+,−,−). */
function nameOf(a: V3, b: V3, centre: V3): string {
  const sign = (p: V3): string => `(${p.map((x, k) => (x < centre[k]! ? '−' : '+')).join(',')})`;
  return [sign(a), sign(b)].sort().join('–');
}
const proj = (p: V3): [number, number] => { const [x, y] = project(CAMERA, p); return [x, y]; };
function split(edges: [V3, V3][], corners: V3[]): { visible: [V3, V3][]; behind: [V3, V3][] } {
  const hidden = weldKey(farthest(corners));
  const meets = (e: [V3, V3]): boolean => weldKey(e[0]) === hidden || weldKey(e[1]) === hidden;
  return { visible: edges.filter((e) => !meets(e)), behind: edges.filter(meets) };
}
function toSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The depth half of AC4, in the ID target; failures name each edge by its corners. */
function depthProblems(ids: Ids, edges: [V3, V3][], corners: V3[]): string[] {
  const out: string[] = [];
  const centre = centreOf(corners);
  for (const p of corners) { const [x, y] = proj(p); if (x < 4 || y < 4 || x > SIZE[0] - 4 || y > SIZE[1] - 4) out.push(`corner ${JSON.stringify(p)} projects outside the frame`); }
  const { visible, behind } = split(edges, corners);
  if (visible.length !== VISIBLE_EDGES || behind.length !== HIDDEN_EDGES) out.push(`the box has ${visible.length} edges away from the far corner and ${behind.length} at it, not ${VISIBLE_EDGES} and ${HIDDEN_EDGES}`);
  const isLine = (x: number, y: number): boolean => ids.at(x, y) === LINE;
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
    if (drawn) out.push(`far-side edge ${name} draws over the near faces: line pixels at ${drawn} of ${clear} samples`);
  }
  return out;
}

/**
 * The dash half of AC4: along each visible edge's middle 70%, sampled every 0.5 mm in the world and read in the ID
 * target at its projection, the line's dashes start (off then on) every `period` within `tolerance`, measured in the
 * line's size space: px along the projection on screen, or m along the edge in the world. Failures name the line and
 * the edge.
 */
function dashProblems(ids: Ids, edges: [V3, V3][], corners: V3[], space: 'screen' | 'world', period: number, tolerance: number, unit: string): string[] {
  const out: string[] = [];
  const centre = centreOf(corners);
  for (const e of split(edges, corners).visible) {
    const name = `${LINE} (${space} dash): edge ${nameOf(e[0], e[1], centre)}`;
    const along = sub(e[1], e[0]);
    const metres = length(along);
    const a2 = proj(e[0]);
    const starts: number[] = [];
    let on = 0; let previous: boolean | null = null; let samples = 0;
    for (let s = 0.15 * metres; s <= 0.85 * metres; s += 0.0005) {
      const p = add(e[0], scale(along, s / metres));
      const q = proj(p);
      const here = ids.at(q[0], q[1]) === LINE;
      samples++;
      if (here) on++;
      if (here && previous === false) starts.push(space === 'world' ? s : Math.hypot(q[0] - a2[0], q[1] - a2[1]));
      previous = here;
    }
    if (on === 0) { out.push(`${name} draws nowhere in its middle 70%`); continue; }
    if (on === samples) { out.push(`${name} is solid: no gap in its middle 70%, so no dash of period ${period} ${unit}`); continue; }
    if (starts.length < 3) { out.push(`${name} has ${starts.length} dash starts in its middle 70%, too few for a dash of period ${period} ${unit}`); continue; }
    const periods = starts.slice(1).map((x, i) => x - starts[i]!);
    const off = periods.filter((d) => Math.abs(d - period) > tolerance);
    if (off.length) out.push(`${name} dashes with periods ${periods.map((d) => d.toFixed(3)).join(', ')} ${unit}, not ${period} ± ${tolerance} ${unit}`);
  }
  return out;
}

describe(`${AC[4]} crease edges keep mesh edges' depth rule, and dash in their size space`, () => {
  it(`${AC[4]} the ${HIDDEN_EDGES} crease edges on the cube's far side never draw over its near faces; the ${VISIBLE_EDGES} near ones draw unbroken at ${WIDTH} px (reference Mac)`, () => {
    requireGpu();
    const f = draw({ width: WIDTH, size_space: 'screen' }, {});
    const { edges, corners } = cubeEdges(f, 'the crease cube');
    none(depthProblems(readIds(dir(), f, 'the ID target'), edges, corners), 'the crease edges in depth');
  }, 3_600_000);

  it(`${AC[4]} #420's planted edges_skip_depth draws the ${HIDDEN_EDGES} far-side crease edges over the near faces and fails, naming each`, () => {
    requireGpu();
    const f = draw({ width: WIDTH, size_space: 'screen' }, { planted: 'edges_skip_depth' });
    const { edges, corners } = cubeEdges(f, 'the crease cube with --planted edges_skip_depth');
    const centre = centreOf(corners);
    const names = split(edges, corners).behind.map(([a, b]) => `far-side edge ${nameOf(a, b, centre)} draws over the near faces`);
    expect(names.length, 'three edges meet the far corner').toBe(HIDDEN_EDGES);
    failsNaming(depthProblems(readIds(dir(), f, 'the ID target'), edges, corners), names, 'the planted edges_skip_depth');
  }, 3_600_000);

  it(`${AC[4]} with size_space screen and dash [${SCREEN_DASH.dash.join(', ')}] px the crease edges dash every ${SCREEN_DASH.period} px on screen (reference Mac)`, () => {
    requireGpu();
    const f = draw({ width: WIDTH, size_space: 'screen', dash: [...SCREEN_DASH.dash] }, {});
    const { edges, corners } = cubeEdges(f, 'the screen-dashed crease cube');
    none(dashProblems(readIds(dir(), f, 'the ID target'), edges, corners, 'screen', SCREEN_DASH.period, SCREEN_DASH.tolerance, SCREEN_DASH.unit), 'the screen-space dash');
  }, 3_600_000);

  it(`${AC[4]} with size_space world and dash [${WORLD_DASH.dash.join(', ')}] m the crease edges dash every ${WORLD_DASH.period} m along the edge (reference Mac)`, () => {
    requireGpu();
    const f = draw({ width: WORLD_DASH.width, size_space: 'world', dash: [...WORLD_DASH.dash] }, {});
    const { edges, corners } = cubeEdges(f, 'the world-dashed crease cube');
    none(dashProblems(readIds(dir(), f, 'the ID target'), edges, corners, 'world', WORLD_DASH.period, WORLD_DASH.tolerance, WORLD_DASH.unit), 'the world-space dash');
  }, 3_600_000);

  it(`${AC[4]} the planted edges_dash_other_space reads the dash in the other size space and fails both, naming the line and the edges`, () => {
    requireGpu();
    const screen = draw({ width: WIDTH, size_space: 'screen', dash: [...SCREEN_DASH.dash] }, { planted: 'edges_dash_other_space' });
    const s = cubeEdges(screen, 'the screen-dashed crease cube with --planted edges_dash_other_space');
    failsNaming(dashProblems(readIds(dir(), screen, 'the ID target'), s.edges, s.corners, 'screen', SCREEN_DASH.period, SCREEN_DASH.tolerance, SCREEN_DASH.unit), [`${LINE} (screen dash): edge`], 'the planted edges_dash_other_space on screen');
    const world = draw({ width: WORLD_DASH.width, size_space: 'world', dash: [...WORLD_DASH.dash] }, { planted: 'edges_dash_other_space' });
    const w = cubeEdges(world, 'the world-dashed crease cube with --planted edges_dash_other_space');
    failsNaming(dashProblems(readIds(dir(), world, 'the ID target'), w.edges, w.corners, 'world', WORLD_DASH.period, WORLD_DASH.tolerance, WORLD_DASH.unit), [`${LINE} (world dash): edge`], 'the planted edges_dash_other_space in the world');
  }, 3_600_000);
});
