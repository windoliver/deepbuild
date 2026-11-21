// Test-side tools for the #1782 acceptance tests. The binary, its JSON lines, the documents' envelope, the look and
// the failure helpers are #1640's, imported, not copied. This file adds only what this suite's surface needs
// (README: The surface under test): the criterion IDs, the planted names, lines with `material` and `hidden`, a
// `view3d` call that can seek, readers for `spans`, `dashes` and `edge_spans_computed`, and the checks every span
// list is held to, which return their failures as sentences naming the edge. Nothing here stands in for the picker,
// the span classifier, the dash or a cache.

import { expect } from 'vitest';
import {
  arr, edgeLine, isObject, look, num, obj, runGpu, sessionDoc as sessionDoc1640, shown, view3d, writeFile,
  type JsonObject, type JsonValue, type LineSpec, type Startup as Startup1640, type View3Call,
} from '../1640/helpers.ts';
import type { V3 } from '../1640/reference.ts';
import { rank, type Asset, type Edge, type Want } from './reference.ts';

export { failsNaming, look, none, requireGpu, useDir, useGpuBin, writeFile } from '../1640/helpers.ts';
export type { JsonObject, JsonValue } from '../1640/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1782.99240d77',
  2: 'AC2 #1782.977b8e45',
  3: 'AC3 #1782.53389245',
  4: 'AC4 #1782.183712ab',
  5: 'AC5 #1782.91964396',
  6: 'AC6 #1782.078d7c3c',
  7: 'AC7 #1782.b25597d6',
  8: 'AC8 #1782.c6ee5604',
} as const;

/** "each end within 1e-5 m" (AC3, AC4, AC5). */
export const TOLERANCE = 1e-5;
/** `crease {angle: 30}`, the issue's angle in every criterion. */
export const ANGLE = 30;
export const SIZE: [number, number] = [640, 480];

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`

/** `deep-gpu --planted` names: this suite's eight and #1640's `crease_below_angle` (README: Planted programs). */
export type Planted =
  | 'edges_material_every_shared' | 'edges_spans_cast_nothing' | 'edges_spans_ends_only' | 'edges_spans_no_perspective'
  | 'edges_dash_restarts_at_split' | 'edges_spans_count_glass' | 'edges_spans_cache_no_camera' | 'edges_id_from_draw_order'
  | 'crease_below_angle';
export interface Startup { backend?: 'noop'; planted?: Planted }
export const NOOP: Startup = { backend: 'noop' };
export const startName = (s: Startup): string => `deep-gpu run${s.backend ? ` --backend ${s.backend}` : ''}${s.planted ? ` --planted ${s.planted}` : ''}`;
/** One scenario `{out, calls}`, accepted, with one reply per call (#1640's `runGpu`, with this suite's names). */
export const run = (bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] =>
  runGpu(bin, out, calls, startup as unknown as Startup1640);

// ---------------------------------------------------------------------------------------------------
// Documents

/** A whole scene document as a session holds it (#378): #1640's envelope under this suite's name. */
export function sessionDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return sessionDoc1640(title, items, { id: `doc-1782-${slug}`, description: `${title}: a #1782 acceptance fixture.`, ...extra });
}
/** A perspective camera at `position` looking at `target`, `fov` degrees across the wider side. */
export const perspective = (position: V3, target: V3, fov = 40): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: [...position], target: [...target], fov, near: 0.1 } });
/** A material of linear `color`, opaque unless `more` says otherwise. */
export const material = (color: V3, more: JsonObject = {}): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [...color, 1], roughness: 0.8, metallic: 0, ...more } });
/** A `mesh.asset@1` of `a` at the origin, unrotated, so its world positions are its mesh's own. */
export const assetItem = (a: Asset, more: JsonObject = {}): JsonObject =>
  ({ kind: 'mesh.asset@1', params: { sha256: a.sha, node: 0 }, at: { pos: [0, 0, 0] }, ...more });

/** `edges` under `crease {angle: 30}`, with `border` and `material` beside the kind when given (README: Documents). */
export function creaseEdges(of: string, o: { border?: boolean; material?: boolean } = {}): JsonObject {
  return { of, kind: { crease: { angle: ANGLE } }, ...(o.border === undefined ? {} : { border: o.border }), ...(o.material === undefined ? {} : { material: o.material }) };
}
/** The paint the tests give `hidden`: another role of the look than the line's own `accent`. */
export const HIDDEN_PAINT: JsonObject = { fill: { role: 'muted' } };
export interface HiddenSpec { dash?: [number, number]; paint?: JsonObject }
/** A mesh-edge `mark.line@1` (#1640's `edgeLine`), with `hidden: {dash?, paint}` in its params when given. */
export function line(s: LineSpec, hidden?: HiddenSpec): JsonObject {
  const base = edgeLine(s);
  if (!hidden) return base;
  const style: JsonObject = { ...(hidden.dash ? { dash: [...hidden.dash] } : {}), paint: hidden.paint ?? HIDDEN_PAINT };
  return { ...base, params: { ...obj(base['params'], 'the line\'s params'), hidden: style } };
}

// ---------------------------------------------------------------------------------------------------
// `view3d` with `counts: true`, and its frames

export interface Draw {
  title: string; items: Record<string, JsonObject>; assets?: readonly Asset[]; extra?: JsonObject;
  /** The frames the call draws: `frames` of them from frame `from`, at `fps` (#380's seek). */
  from?: number; frames?: number; fps?: number;
  targets?: ('final' | 'ids')[]; capture?: 'every' | number[];
}
/** Writes the document and its assets under `dir` and returns the `view3d` call that draws it with `counts`. */
export function viewCall(dir: string, d: Draw): JsonObject {
  const assets: Record<string, string> = {};
  for (const a of d.assets ?? []) assets[a.sha] = writeFile(dir, `${a.sha}.gltf`, a.bytes);
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const doc = writeFile(dir, `${slug}.json`, sessionDoc(d.title, d.items, d.extra));
  const call: View3Call = {
    doc, look: look(), size: SIZE, frames: d.frames ?? 1, counts: true, assets,
    ...(d.fps === undefined ? {} : { fps: d.fps }), ...(d.targets ? { targets: d.targets } : {}), ...(d.capture ? { capture: d.capture } : {}),
  };
  return { ...view3d(call), ...(d.from === undefined ? {} : { from: d.from }) };
}

export interface Frame { frame: number; pixel_hash: string | null; raw: JsonObject }
/** A `view3d` reply's frames, held to `count` frames from `from`, each once, in order. */
export function framesOf(reply: JsonObject, what: string, from = 0, count = 1): Frame[] {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const list = arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const raw = obj(v, `${what}: frames[${i}]`);
    return { frame: num(raw['frame'], `${what}: frames[${i}].frame`), pixel_hash: typeof raw['pixel_hash'] === 'string' ? raw['pixel_hash'] : null, raw };
  });
  expect(list.map((f) => f.frame), `${what}: frames ${from} to ${from + count - 1}, each once, in order`).toEqual(Array.from({ length: count }, (_, i) => from + i));
  return list;
}
/** One document drawn by one `view3d` call, on the noop lane unless `startup` says otherwise. */
export function draw(bin: string, dir: string, d: Draw, startup: Startup = NOOP): Frame[] {
  const [reply] = run(bin, dir, [viewCall(dir, d)], startup);
  return framesOf(reply!, `${d.title} on ${startName(startup)}`, d.from ?? 0, d.frames ?? 1);
}

/** A frame's entry for `line` in one of its per-line reports, failing when the frame or the line isn't there. */
function entry(f: Frame, field: string, line: string, what: string): JsonValue {
  const map = f.raw[field];
  expect(isObject(map), `${what}: frame ${f.frame} reports ${field} (counts: true); it reports ${JSON.stringify(Object.keys(f.raw))}`).toBe(true);
  const value = (map as JsonObject)[line];
  expect(value, `${what}: frame ${f.frame} lists ${line} in ${field}; it lists ${JSON.stringify(Object.keys(map as JsonObject))}`).toBeDefined();
  return value!;
}
const point = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
/** #420's `segments`: the segments a mesh-edge line drew, in world metres. */
export function segmentsOf(f: Frame, line: string, what: string): [V3, V3][] {
  const at = `${what}: frame ${f.frame}.segments[${line}]`;
  return arr(entry(f, 'segments', line, what), at).map((s, k): [V3, V3] => {
    const pair = arr(s, `${at}[${k}]`);
    expect(pair.length, `${at}[${k}] is [a, b]`).toBe(2);
    return [point(pair[0], `${at}[${k}][0]`), point(pair[1], `${at}[${k}][1]`)];
  });
}

// ---------------------------------------------------------------------------------------------------
// Spans, dashes and counters (README: `view3d` frames gain three reports)

export interface Span { edge: number; from: number; to: number; hidden: boolean }
/** A list of `{edge, from, to, hidden}`: exactly those four fields, `edge` a 0-based rank, `from` and `to` in m. */
export function parseSpans(value: JsonValue | undefined, what: string): Span[] {
  return arr(value, what).map((v, i): Span => {
    const o = obj(v, `${what}[${i}]`);
    expect(Object.keys(o).sort(), `${what}[${i}] is {edge, from, to, hidden}`).toEqual(['edge', 'from', 'hidden', 'to']);
    const edge = num(o['edge'], `${what}[${i}].edge`);
    expect(Number.isInteger(edge) && edge >= 0, `${what}[${i}].edge is a 0-based rank, got ${edge}`).toBe(true);
    expect(typeof o['hidden'], `${what}[${i}].hidden is a boolean`).toBe('boolean');
    return { edge, from: num(o['from'], `${what}[${i}].from`), to: num(o['to'], `${what}[${i}].to`), hidden: o['hidden'] === true };
  });
}
export const spansOf = (f: Frame, line: string, what: string): Span[] => parseSpans(entry(f, 'spans', line, what), `${what}: frame ${f.frame}.spans[${line}]`);
export const dashesOf = (f: Frame, line: string, what: string): Span[] => parseSpans(entry(f, 'dashes', line, what), `${what}: frame ${f.frame}.dashes[${line}]`);
/** How many times the frame computed the line's spans. */
export const computedOf = (f: Frame, line: string, what: string): number => num(entry(f, 'edge_spans_computed', line, what), `${what}: frame ${f.frame}.edge_spans_computed[${line}]`);
/** #1640's count: how many times the frame derived the line's pick set. */
export const derivedOf = (f: Frame, line: string, what: string): number => num(entry(f, 'edge_sets_derived', line, what), `${what}: frame ${f.frame}.edge_sets_derived[${line}]`);

/** The `spans` of a mesh-edge line's row in a `geometry` reply of `deep-show run`. */
export function geometrySpans(reply: JsonObject, line: string, what: string): Span[] {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['items'], `${what}: items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const row = rows.find((r) => r['id'] === line);
  expect(row, `${what}: the reply holds ${line}: ${shown(reply)}`).toBeDefined();
  expect(row!['spans'], `${what}: ${line}'s row gives spans; it gives ${JSON.stringify(Object.keys(row!))}`).toBeDefined();
  return parseSpans(row!['spans'], `${what}: ${line}.spans`);
}

// ---------------------------------------------------------------------------------------------------
// Edges by ID, and the checks span lists are held to

/**
 * A line's picked edges by ID (README: An edge's ID and start): the `segments` of `twin`, a line with the same
 * `edges` and no `hidden`, ranked by welded ends. Every item these tests read edges of is unrotated and unscaled, so
 * the order of its world positions is the order of its mesh's own.
 */
export const rankedEdges = (f: Frame, twin: string, what: string): Edge[] => rank(segmentsOf(f, twin, what));

const coords = (p: V3): string => `(${p.map((x) => String(+x.toFixed(6)).replace('-', '−')).join(', ')})`;
/** An edge by its ID and its two ends, e.g. `edge 0 (−0.5, 0, 0)–(0.5, 0, 0)` (README: How an edge is named). */
export const edgeName = (e: Edge): string => `edge ${e.id} ${coords(e.start)}–${coords(e.end)}`;
export const spanText = (s: { from: number; to: number; hidden: boolean }): string => `${s.from} to ${s.to} m ${s.hidden ? 'hidden' : 'visible'}`;

/**
 * What every span list is held to: in edge order and then `from` order; every picked edge tiled from 0 to its
 * length; neighbours differing in `hidden`; no span of zero length.
 */
export function tilingProblems(spans: readonly Span[], edges: readonly Edge[]): string[] {
  const out: string[] = [];
  const by = new Map<number, Span[]>();
  spans.forEach((s, i) => {
    const p = spans[i - 1];
    if (p && (s.edge < p.edge || (s.edge === p.edge && s.from < p.from))) out.push(`spans[${i}] (edge ${s.edge}, ${spanText(s)}) follows edge ${p.edge}'s ${spanText(p)}: not in edge order and then from order`);
    by.set(s.edge, [...(by.get(s.edge) ?? []), s]);
  });
  const past = [...by.keys()].filter((k) => k >= edges.length);
  if (past.length) out.push(`${past.length} edge IDs are past the line's ${edges.length} picked edges, e.g. edge ${past[0]}`);
  for (const e of edges) {
    const own = by.get(e.id) ?? [];
    if (!own.length) { out.push(`${edgeName(e)} has no span`); continue; }
    if (Math.abs(own[0]!.from) > TOLERANCE) out.push(`${edgeName(e)}: its first span starts at ${own[0]!.from} m, not 0`);
    const last = own[own.length - 1]!;
    if (Math.abs(last.to - e.length) > TOLERANCE) out.push(`${edgeName(e)}: its last span ends at ${last.to} m, not at its length, ${e.length} m`);
    own.forEach((s, k) => {
      if (!(s.to > s.from)) out.push(`${edgeName(e)}: a span of no length, ${spanText(s)}`);
      const p = own[k - 1];
      if (!p) return;
      if (Math.abs(s.from - p.to) > TOLERANCE) out.push(`${edgeName(e)}: ${spanText(s)} doesn't start where ${spanText(p)} ends`);
      if (s.hidden === p.hidden) out.push(`${edgeName(e)}: neighbouring spans are both ${s.hidden ? 'hidden' : 'visible'} (${spanText(p)}; ${spanText(s)})`);
    });
  }
  return out;
}

/** An edge's spans (or its dashes) against hand-worked ones, each end within 1e-5 m; a failure names the edge. */
export function spanProblems(got: readonly Span[], e: Edge, want: readonly Want[], noun = 'span', name = edgeName(e)): string[] {
  const own = got.filter((s) => s.edge === e.id);
  const wanted = want.map(([from, to, hidden]) => ({ from, to, hidden }));
  const list = (l: readonly { from: number; to: number; hidden: boolean }[]): string => l.map(spanText).join('; ') || 'none';
  if (own.length !== wanted.length) return [`${name} has ${own.length} ${noun}${own.length === 1 ? '' : 's'} (${list(own)}), not ${wanted.length} (${list(wanted)})`];
  const out: string[] = [];
  own.forEach((s, k) => {
    const w = wanted[k]!;
    if (s.hidden !== w.hidden || Math.abs(s.from - w.from) > TOLERANCE || Math.abs(s.to - w.to) > TOLERANCE) out.push(`${name}: ${noun} ${k} is ${spanText(s)}, not ${spanText(w)}`);
  });
  return out;
}
/** A box's edge by ID and ends, and by its corners' signs about the box's centre as #1640 names them. */
export function boxEdgeName(e: Edge, centre: V3): string {
  const sign = (p: V3): string => `(${p.map((x, k) => (x < centre[k]! ? '−' : '+')).join(',')})`;
  return `${edgeName(e)} [${sign(e.start)}–${sign(e.end)}]`;
}

/**
 * A document with a `hidden` line, drawn after its guard in one run. The guard is the same document without that
 * line, so the base draws it; its `twin` line has the same `edges` and no `hidden`. Returns the line's picked
 * edges by ID, ranked from the guard's `segments`, and the document's frames.
 */
export function drawHidden(bin: string, dir: string, d: Draw, hidden: string, twin: string, startup: Startup = NOOP): { edges: Edge[]; frames: Frame[]; what: string } {
  const what = `${d.title} on ${startName(startup)}`;
  const rest = Object.fromEntries(Object.entries(d.items).filter(([id]) => id !== hidden));
  const guard: Draw = { title: `${d.title} guard`, items: rest, ...(d.assets ? { assets: d.assets } : {}), ...(d.extra ? { extra: d.extra } : {}) };
  const [first, second] = run(bin, dir, [viewCall(dir, guard), viewCall(dir, d)], startup);
  const edges = rankedEdges(framesOf(first!, `${what}, its guard`)[0]!, twin, `${what}, its guard`);
  return { edges, frames: framesOf(second!, what, d.from ?? 0, d.frames ?? 1), what };
}
