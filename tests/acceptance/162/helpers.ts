// Test-side tools for the #162 acceptance tests: `deep-show` built once per Cargo feature set and driven by one JSON
// scenario on stdin (`deep-show run`, #501's and #157's convention), with the scenario's `planted` key for the wrong
// programs; the fixture documents, made at test time; the `export` call with `video.codec: lottie` and the readers of
// what it answers (the receipt and its `warnings`, a FAIL's issues, a refusal) and of the file it writes (this suite's
// own reader of Lottie's JSON: layers, shapes, keyframes, easing and transforms); `eval` for the values a document
// evaluates to; a real hub (`deep hub run`, #1922's world) with the first-party import plug-in installed, its
// `deep_job` run of `import {from: lottie}` over `deep mcp`, and the document and report it keeps in the hub's evidence
// store; and OKLab for gradient ramps. Nothing here stands in for the export, its writer, its fidelity check, the
// import or the document check: each is read from what deep-show or the hub answers or writes. README: The surface
// under test.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect } from 'vitest';
import {
  FLICKS, REPO, isObject, present, presented, putEvidence, runShow, show, type JsonObject, type JsonValue, type Rate,
} from '../501/helpers.ts';
import { floatWav, lookOf, toneChannels, type Look } from '../157/helpers.ts';
import { install, job, openWorld, shown, type World } from '../1922/helpers.ts';

export {
  FLICKS, FULL, REPO, TIMEOUT, arr, blocked, failsNaming, inconclusive, int, isObject, none, num, obj, present, presented, putEvidence,
  referenceMacProblem, runShow, seeded, sha256, show, str, useShow, useTemp, type JsonObject, type JsonValue, type Rate,
} from '../501/helpers.ts';
export { lookOf, type Look } from '../157/helpers.ts';
export { events, lastPos, sleep, type World } from '../1922/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #162.ba90a515',
  2: 'AC2 #162.4fcf440a',
  3: 'AC3 #162.6dd976de',
  4: 'AC4 #162.b38a3ba1',
  5: 'AC5 #162.f8f7c065',
  6: 'AC6 #162.bc95e877',
  7: 'AC7 #162.76f8723c',
  8: 'AC8 #162.719d85b5',
  9: 'AC9 #162.d05d40e6',
  10: 'AC10 #162.178dca43',
  11: 'AC11 #162.ec813bb5',
  12: 'AC12 #162.d814f153',
  13: 'AC13 #162.30ea626f',
  14: 'AC14 #162.d1c6940c',
  15: 'AC15 #162.eabe9bb9',
  16: 'AC16 #162.43d9564a',
} as const;

/** The build with #157's test canvas module `test.guards` (its `test.device_loss@1 {frame}`), for criterion 4. */
export const GUARDS = 'full,test-export-guards';

/** The wrong programs the criteria name, each chosen by the scenario's `planted` (README: Planted programs). */
export type Planted = 'lottie_writer_drops_mask' | 'lottie_writer_lists_mask' | 'lottie_wraps_rotation' | 'lottie_writer_drops_markers';

// ---------------------------------------------------------------------------------------------------
// Time

/** A rate's frame in flicks (a whole number for every rate the fixtures use). */
export const frameFlicks = ([p, q]: Rate): number => (FLICKS * q) / p;
/** Seconds as whole flicks; throws when they aren't whole. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
/** The fidelity frames the criterion names: ⌊i × n ÷ 20⌋ for i from 0 to 19. */
export const fidelityFrames = (n: number): number[] => Array.from({ length: 20 }, (_, i) => Math.floor((i * n) / 20));

// ---------------------------------------------------------------------------------------------------
// Scenarios: the documents shown in turn (DOCS[0], DOCS[1], …), each on its own panel, from your shell (#501's peer).

const docId = (k: number): string => `01JB162D${String(k).padStart(18, '0')}`;
/** Document IDs, as many as a scenario shows (the first is #501's DOC.a's role: the main panel). */
export const DOCS: string[] = Array.from({ length: 32 }, (_, k) => docId(k + 1));
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

/** A scenario of `docs` documents, each on a panel of its own, then `calls`. */
export function scenarioOf(evidence: string, docs: number, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const d: JsonObject = {}; const panels: JsonObject = {};
  DOCS.slice(0, docs).forEach((id, k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    d[id] = { panel };
    panels[panel] = { rect: k === 0 ? [0, 0, 1280, 720] : [0, 720, 640, 360] };
  });
  return { evidence, sessions: {}, processes: PROCESSES, panels, docs: d, ...extra, calls };
}
/** One `deep-show run`: each document shown with `deep show` (document k as DOCS[k]), then `calls`; their replies. */
export function showRun(bin: string, evidence: string, documents: JsonObject[], calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const replies = runShow(bin, scenarioOf(evidence, Math.max(1, documents.length), [...documents.map((d, k) => present(DOCS[k]!, d)), ...calls], planted ? { planted } : {}), label);
  documents.forEach((_, k) => presented(replies[k]!, `${label}: document ${k + 1} (${String(documents[k]!['id'])})`));
  return replies.slice(documents.length);
}
/** An agent's session, its process tree under your shell's, and the verdict its record holds (#1162's world): what a
 * document whose status binding reads that verdict needs to be shown, from the agent's tree. */
const AGENT = { id: 'sess-title', thread: 'thread-title', name: 'Test agent: the title', process: { pid: 4100, start: 1_000 } } as const;
const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };
/** One `deep-show run` in the agent's world: the documents shown from the agent's tree, its record holding VERDICT as
 * failed, then `calls`; their replies. */
export function agentRun(bin: string, evidence: string, documents: JsonObject[], calls: JsonObject[], what: string): JsonObject[] {
  const sc = scenarioOf(evidence, Math.max(1, documents.length), [...documents.map((d, k) => ({ ...present(DOCS[k]!, d), peer: IN_AGENT })), ...calls], {
    sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } },
    processes: [...PROCESSES, { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 }],
    record: { [VERDICT]: { session: AGENT.id, state: 'fail' } },
  });
  const replies = runShow(bin, sc, what);
  documents.forEach((_, k) => presented(replies[k]!, `${what}: document ${k + 1} (${String(documents[k]!['id'])})`));
  return replies.slice(documents.length);
}
/** A `deep show` reply's issues of severity error (the document check's verdict on what was shown). */
export const errorsOf = (reply: JsonObject): JsonObject[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['severity'] === 'error');

// ---------------------------------------------------------------------------------------------------
// The export (README: `export` with `video.codec: lottie`)

/** A Lottie export of document k to `out` (`lottie.container` json unless `extra` says otherwise). */
export const lottieExport = (k: number, out: string, extra: JsonObject = {}): JsonObject =>
  ({ call: 'export', doc: DOCS[k]!, out, video: { codec: 'lottie' }, lottie: { container: 'json', images: 'embed' }, ...extra });

/** One entry of the receipt's `warnings`: `{item, kind: cannot_hold | sampled, what, …}`. */
interface Warning { item: string; kind: string; text: string; raw: JsonObject }
interface Exported { receipt: JsonObject; warnings: Warning[] }
/** A delivered Lottie export: its receipt and its warnings, each read strictly; any other outcome fails, naming it (a
 * BLOCKED reply, its fidelity reader missing, is never a pass). */
export function exportedOf(reply: JsonObject, what: string): Exported {
  if (reply['outcome'] === 'blocked') expect.fail(`BLOCKED: ${what}: the export is blocked: ${show(reply, 1500)}; this is not a pass`);
  expect(reply['outcome'], `${what} is exported: ${show(reply, 1500)}`).toBe('exported');
  const receipt = reply['receipt'];
  expect(isObject(receipt), `${what}: the reply has a receipt: ${show(reply, 600)}`).toBe(true);
  const list = (receipt as JsonObject)['warnings'];
  expect(Array.isArray(list), `${what}: receipt.warnings is a list: ${show(list ?? null, 600)}`).toBe(true);
  const warnings = (list as JsonValue[]).map((w, i) => {
    expect(isObject(w) && typeof w['item'] === 'string' && typeof w['what'] === 'string' && (w['kind'] === 'cannot_hold' || w['kind'] === 'sampled'),
      `${what}: receipt.warnings[${i}] is {item, kind: cannot_hold | sampled, what}: ${show(w, 400)}`).toBe(true);
    const o = w as JsonObject;
    return { item: o['item'] as string, kind: o['kind'] as string, text: JSON.stringify(o), raw: o };
  });
  return { receipt: receipt as JsonObject, warnings };
}
/** A reply's issues raised by one check kind (#157's `check` field). */
export const issuesOf = (reply: JsonObject, check: string): JsonObject[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['check'] === check);
/** The frames an issue names: `frame` and every entry of `frames`. */
export function framesNamed(i: JsonObject): number[] {
  const out: number[] = [];
  if (typeof i['frame'] === 'number') out.push(i['frame']);
  if (Array.isArray(i['frames'])) for (const f of i['frames']) if (typeof f === 'number') out.push(f);
  return out;
}
/** Every file under `dir`, by relative path (a temporary name included). */
export function leftIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p)); } };
  walk(dir);
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------
// Lottie, read by this suite (Lottie 1.0.1: layers ty 0 to 4, shapes by `ty`, properties `{a, k}`, keyframes `{t, s,
// e?, i, o, h?, to?, ti?}`, split positions `{s: true, x, y}`).

type Anim = JsonObject;
/** A Lottie file written as JSON. */
export function readLottie(path: string, what: string): Anim {
  expect(existsSync(path), `${what}: the export wrote ${path}`).toBe(true);
  let v: JsonValue;
  try { v = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${what}: ${path} is not JSON: ${(e as Error).message}`); }
  expect(isObject(v), `${what}: ${path} is a JSON object`).toBe(true);
  return v as Anim;
}
export interface Comp { id: string; layers: JsonObject[] }
/** The root composition and each precomposition asset, with their layers. */
function compsOf(anim: Anim): Comp[] {
  const out: Comp[] = [{ id: '', layers: (Array.isArray(anim['layers']) ? anim['layers'] : []).filter(isObject) }];
  for (const a of Array.isArray(anim['assets']) ? anim['assets'] : []) {
    if (isObject(a) && Array.isArray(a['layers'])) out.push({ id: String(a['id']), layers: a['layers'].filter(isObject) });
  }
  return out;
}
interface LayerAt { comp: Comp; layer: JsonObject }
/** Every layer named `nm` (its `nm`), in any composition. */
const layersNamed = (anim: Anim, nm: string): LayerAt[] => compsOf(anim).flatMap((comp) => comp.layers.filter((l) => l['nm'] === nm).map((layer) => ({ comp, layer })));
/** The one layer named `nm`; none or several fail, naming the names there are. */
export function layerNamed(anim: Anim, nm: string, what: string): LayerAt {
  const found = layersNamed(anim, nm);
  const names = compsOf(anim).flatMap((c) => c.layers.map((l) => String(l['nm'])));
  expect(found.length, `${what}: one layer is named ${JSON.stringify(nm)} (the item's name; README: names); the layers: ${JSON.stringify(names).slice(0, 600)}`).toBe(1);
  return found[0]!;
}
interface ShapeAt { shape: JsonObject; groups: JsonObject[] }
/** Every shape under `shapes` (a layer's `shapes` or a group's `it`), depth first, with the groups that hold it. */
export function shapesIn(shapes: JsonValue | undefined, groups: JsonObject[] = []): ShapeAt[] {
  const out: ShapeAt[] = [];
  for (const s of Array.isArray(shapes) ? shapes : []) {
    if (!isObject(s)) continue;
    out.push({ shape: s, groups });
    if (s['ty'] === 'gr') out.push(...shapesIn(s['it'], [...groups, s]));
  }
  return out;
}
/** A group's own transform: its `it` entry of type `tr`. */
export const groupTransform = (g: JsonObject): JsonObject | undefined => (Array.isArray(g['it']) ? g['it'] : []).find((x): x is JsonObject => isObject(x) && x['ty'] === 'tr');
export const GEOMETRY = new Set(['sh', 'rc', 'el', 'sr']);

/** Whether a property is keyed. */
export function isKeyed(prop: JsonValue | undefined): boolean {
  if (!isObject(prop)) return false;
  if (prop['a'] === 1) return true;
  const k = prop['k'];
  return Array.isArray(k) && k.length > 0 && isObject(k[0]) && typeof k[0]['t'] === 'number';
}
const asNums = (v: JsonValue | undefined): number[] => (typeof v === 'number' ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : NaN)) : []);
/** A property's keyframes, in order (an unkeyed one has none). */
export const keysOf = (prop: JsonValue | undefined): JsonObject[] => (isKeyed(prop) ? ((prop as JsonObject)['k'] as JsonValue[]).filter(isObject) : []);
/** An easing handle's x or y for dimension d (a number, or one per dimension). */
const handle = (h: JsonValue | undefined, axis: 'x' | 'y', d: number): number | null => {
  if (!isObject(h)) return null;
  const v = asNums(h[axis]);
  return v.length === 0 ? null : (v[d] ?? v[0]!);
};
/** A key owns a linear segment: not held, and both its handles on the diagonal (y = x for every dimension), which is
 * a straight line in time, whatever their x. */
export function isLinearKey(k: JsonObject, dims = 1): boolean {
  if (k['h'] === 1) return false;
  for (let d = 0; d < dims; d++) {
    const ox = handle(k['o'], 'x', d); const oy = handle(k['o'], 'y', d); const ix = handle(k['i'], 'x', d); const iy = handle(k['i'], 'y', d);
    if (ox === null || oy === null || ix === null || iy === null) return false;
    if (Math.abs(ox - oy) > 1e-9 || Math.abs(ix - iy) > 1e-9) return false;
  }
  return true;
}
/** Lottie's time easing: the cubic Bézier from (0, 0) through (ox, oy) and (ix, iy) to (1, 1), its y where its x is u
 * (solved by bisection in f64; the handles' x are clamped to [0, 1], as players clamp them). */
export function ease(ox: number, oy: number, ix: number, iy: number, u: number): number {
  const x1 = Math.min(1, Math.max(0, ox)); const x2 = Math.min(1, Math.max(0, ix));
  const at = (a: number, b: number, s: number): number => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  let lo = 0; let hi = 1;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (at(x1, x2, m) < u) lo = m; else hi = m; }
  return at(oy, iy, (lo + hi) / 2);
}
export type Pt = [number, number];
const cubic = (p: Pt[], u: number): Pt => {
  const v = 1 - u;
  return [0, 1].map((d) => v * v * v * p[0]![d]! + 3 * v * v * u * p[1]![d]! + 3 * v * u * u * p[2]![d]! + u * u * u * p[3]![d]!) as Pt;
};
const cubicD = (p: Pt[], u: number): Pt => {
  const v = 1 - u;
  return [0, 1].map((d) => 3 * v * v * (p[1]![d]! - p[0]![d]!) + 6 * v * u * (p[2]![d]! - p[1]![d]!) + 3 * u * u * (p[3]![d]! - p[2]![d]!)) as Pt;
};
const GL: [number, number][] = [
  [0, 0.5688888888888889], [-0.5384693101056831, 0.4786286704993665], [0.5384693101056831, 0.4786286704993665],
  [-0.906179845938664, 0.2369268850561891], [0.906179845938664, 0.2369268850561891],
];
/** A cubic's arc length from 0 to u (64 panels of 5-point Gauss–Legendre). */
function arcLength(p: Pt[], u: number): number {
  const panels = 64; let s = 0;
  for (let q = 0; q < panels; q++) {
    const a = (u * q) / panels; const b = (u * (q + 1)) / panels;
    for (const [x, w] of GL) { const d = cubicD(p, (a + b) / 2 + ((b - a) / 2) * x); s += ((b - a) / 2) * w * Math.hypot(d[0], d[1]); }
  }
  return s;
}
/** The point a fraction f of the way along a cubic by arc length (bisection on the parameter). */
function byArcLength(p: Pt[], f: number): Pt {
  const target = f * arcLength(p, 1);
  let lo = 0; let hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (arcLength(p, m) < target) lo = m; else hi = m; }
  return cubic(p, (lo + hi) / 2);
}
/** The point at parameter f of a cubic: the wrong program's motion, by parameter instead of by arc length. */
const byParameter = (p: Pt[], f: number): Pt => cubic(p, f);
interface Segment { from: JsonObject; to: JsonObject; start: number[]; end: number[]; u: number }
/** The segment of a keyed property that frame `f` falls in, or null before its first key or from its last. */
function segmentAt(prop: JsonValue | undefined, f: number): Segment | null {
  const keys = keysOf(prop);
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!; const b = keys[i + 1]!;
    const ta = Number(a['t']); const tb = Number(b['t']);
    if (f >= ta && f < tb) return { from: a, to: b, start: asNums(a['s']), end: asNums(a['e'] ?? b['s']), u: (f - ta) / (tb - ta) };
  }
  return null;
}
/** The value of a Lottie property at frame `f`: held before its first key and from its last, eased per dimension
 * between keys, held where a key says `h: 1`; a position whose key has spatial tangents moves along their cubic by arc
 * length (the `byParameter` reading only with `spatial: 'parameter'`). A split position reads x and y apart. */
export function valueAt(prop: JsonValue | undefined, f: number, spatial: 'arc' | 'parameter' = 'arc'): number[] {
  if (!isObject(prop)) return [];
  if (prop['s'] === true && isObject(prop['x'])) return [valueAt(prop['x'], f)[0]!, valueAt(prop['y'], f)[0]!];
  if (!isKeyed(prop)) return asNums(prop['k']);
  const keys = keysOf(prop);
  const first = keys[0]!;
  if (f < Number(first['t'])) return asNums(first['s']);
  const seg = segmentAt(prop, f);
  if (!seg) {
    const last = keys[keys.length - 1]!;
    return last['s'] !== undefined ? asNums(last['s']) : asNums(keys[keys.length - 2]?.['e'] ?? keys[keys.length - 2]?.['s']);
  }
  const { from: a, start, end, u } = seg;
  if (a['h'] === 1) return start;
  const to = asNums(a['to']); const ti = asNums(a['ti']);
  const p = (d: number): number => ease(handle(a['o'], 'x', d) ?? 0, handle(a['o'], 'y', d) ?? 0, handle(a['i'], 'x', d) ?? 1, handle(a['i'], 'y', d) ?? 1, u);
  if (to.length >= 2 && ti.length >= 2 && (to.some((x) => Math.abs(x) > 1e-9) || ti.some((x) => Math.abs(x) > 1e-9))) {
    const ctrl: Pt[] = [[start[0]!, start[1]!], [start[0]! + to[0]!, start[1]! + to[1]!], [end[0]! + ti[0]!, end[1]! + ti[1]!], [end[0]!, end[1]!]];
    const q = spatial === 'arc' ? byArcLength(ctrl, p(0)) : byParameter(ctrl, p(0));
    return [q[0], q[1], ...start.slice(2)];
  }
  return start.map((s, d) => s + ((end[d] ?? s) - s) * p(d));
}
/** A 2D affine `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
type Affine = [number, number, number, number, number, number];
const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** A layer's `ks` or a group's `tr` at frame f: T(p) · R(r) · S(s ÷ 100) · T(−a); skew is read as none and a transform
 * that skews fails. */
function transformAt(t: JsonObject | undefined, f: number, what: string): Affine {
  if (!t) return [1, 0, 0, 1, 0, 0];
  const p = valueAt(t['p'], f); const a = valueAt(t['a'], f); const s = valueAt(t['s'], f); const r = valueAt(t['r'], f)[0] ?? 0;
  const sk = valueAt(t['sk'], f)[0] ?? 0;
  expect(Math.abs(sk), `${what}: its transform has no skew`).toBeLessThan(1e-9);
  const sx = (s[0] ?? 100) / 100; const sy = (s[1] ?? s[0] ?? 100) / 100;
  const c = Math.cos((r * Math.PI) / 180); const n = Math.sin((r * Math.PI) / 180);
  const ax = a[0] ?? 0; const ay = a[1] ?? 0;
  const lin: Affine = [c * sx, n * sx, -n * sy, c * sy, 0, 0];
  const shifted = apply(lin, [-ax, -ay]);
  return [lin[0], lin[1], lin[2], lin[3], (p[0] ?? 0) + shifted[0], (p[1] ?? 0) + shifted[1]];
}
/** A layer's transform into the root composition at root frame f: its own, its parents' (`parent` by `ind`) and, for a
 * layer in a precomposition, the one layer that places it. Only start times 0, stretch 1 and no time remap are read;
 * anything else fails the harness, naming the layer. */
function layerToRoot(anim: Anim, at: LayerAt, f: number, what: string): Affine {
  const { comp, layer } = at;
  const own = (l: JsonObject): Affine => {
    expect((Number(l['st'] ?? 0) === 0) && Number(l['sr'] ?? 1) === 1 && l['tm'] === undefined, `${what}: layer ${String(l['nm'])} starts at 0 with no stretch or remap (harness)`).toBe(true);
    let m = transformAt(isObject(l['ks']) ? l['ks'] : undefined, f, `${what}: layer ${String(l['nm'])}`);
    if (typeof l['parent'] === 'number') {
      const parent = comp.layers.find((x) => x['ind'] === l['parent']);
      expect(parent, `${what}: layer ${String(l['nm'])}'s parent ${String(l['parent'])} is in its composition`).toBeDefined();
      m = mul(own(parent!), m);
    }
    return m;
  };
  let m = own(layer);
  if (comp.id !== '') {
    const placing = compsOf(anim).flatMap((c) => c.layers.filter((l) => l['ty'] === 0 && l['refId'] === comp.id).map((l) => ({ comp: c, layer: l })));
    expect(placing.length, `${what}: one layer places the precomposition ${comp.id} (harness)`).toBe(1);
    m = mul(layerToRoot(anim, placing[0]!, f, what), m);
  }
  return m;
}
/** A shape's transform into the root composition: its layer's and each group's around it. */
export function shapeToRoot(anim: Anim, at: LayerAt, groups: JsonObject[], f: number, what: string): Affine {
  let m = layerToRoot(anim, at, f, what);
  for (const g of groups) m = mul(m, transformAt(groupTransform(g), f, `${what}: group ${String(g['nm'])}`));
  return m;
}

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures). Every time in a document is flicks or a time literal; positions in u, y down.

const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made at test time by the #162 acceptance tests.' };
/** The look every fixture names: #157's flat colours (ground #e8e8e8, accent #f2c230, ink #1b1d22, …). */
const LOOK: Look = lookOf('look-162');
export const ACCENT = '#f2c230';
export const INK = '#1b1d22';
const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** An item in the writer layer `main`, named `name` (the name the export writes as its layer's `nm`). */
export function item(id: string, kind: string, name: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind, layer: 'main', name, order, params, ...extra };
}
const camera2d = (size: [number, number]): JsonObject =>
  item('cam', 'camera@1', 'Camera', 'a00', { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] });
export const ground = (size: [number, number]): JsonObject =>
  item('back', 'rect@1', 'Ground', 'a01', { box: [0, 0, size[0], size[1]], paint: { fill: { role: 'ground' } } });
/** A keyed channel: `[seconds, value, interp]` keys (interp linear when left out). */
export function channel(target: string, keys: [number, JsonValue, JsonValue?][], type = 'f32'): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map(([t, value, interp], i) => [`k${String(i).padStart(3, '0')}`, { t: fl(t), value, interp: interp ?? 'linear' }])) };
}
interface FilmSpec {
  id: string; size: [number, number]; rate: Rate; frames: number; items: JsonObject[]; channels?: JsonObject; drivers?: JsonObject;
  markers?: JsonObject; strips?: JsonObject; assets?: JsonObject; requires?: JsonObject; extra?: JsonObject; sampleRate?: number;
}
/** A film: the look put in the store, a camera over its frame and a ground, then `items`. */
export function film(evidence: string, s: FilmSpec): JsonObject {
  putEvidence(evidence, LOOK.bytes);
  const items = [camera2d(s.size), ground(s.size), ...s.items];
  return {
    format: 1, id: s.id, profile: 'film', title: `#162 ${s.id}`, description: `The #162 acceptance tests' document ${s.id}.`, size: s.size, layers: LAYERS,
    camera: 'cam', look: { asset: `${LOOK.id}@1`, theme: 'light' },
    transport: { span: s.frames * frameFlicks(s.rate), frame_rate: s.rate, ...(s.sampleRate ? { sample_rate: s.sampleRate } : {}) },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), channels: s.channels ?? {},
    assets: { [LOOK.id]: { sha256: LOOK.sha, license: CC0 }, ...(s.assets ?? {}) },
    ...(s.drivers ? { drivers: s.drivers } : {}), ...(s.markers ? { markers: s.markers } : {}), ...(s.strips ? { strips: s.strips } : {}),
    ...(s.requires ? { requires: s.requires } : {}), ...(s.extra ?? {}),
  };
}

/** The title (README: Fixtures): 320 × 180 at 24 fps for 2 s (48 export frames). A rect mask `veil` over the whole
 * frame, whose width a hold key halves at 0.9375 s (export frame 22.5, so it first cuts frame 23 and first shows in a
 * sampled frame at 24); a thick curve `line` in it, its trim's end and its y on Bézier keys; and a rect `tiles` with a
 * repeater of three copies, turned on a Bézier key. `eased` swaps the trim's key for a named ease (in_out_cubic) and the
 * turn's for a spring. */
export const TITLE = { size: [320, 180] as [number, number], rate: [24, 1] as Rate, frames: 48, maskAt: 0.9375, firstMaskFrame: 24 } as const;
export const TITLE_NAMES = { veil: 'Veil', line: 'Line', tiles: 'Tiles' } as const;
export function titleDoc(evidence: string, variant: 'bezier' | 'eased' = 'bezier', more: JsonObject[] = [], requires?: JsonObject): JsonObject {
  const bez = (x1: number, y1: number, x2: number, y2: number): JsonObject => ({ bezier: { x1, y1, x2, y2 } });
  const trimInterp: JsonValue = variant === 'eased' ? { ease: { name: 'in_out_cubic' } } : bez(0.42, 0, 0.58, 1);
  const turnInterp: JsonValue = variant === 'eased' ? { spring: { freq_hz: 2, damping_ratio: 0.4 } } : bez(0.33, 0, 0.67, 1);
  return film(evidence, {
    id: variant === 'eased' ? 'title-eased' : 'title', size: TITLE.size, rate: TITLE.rate, frames: TITLE.frames,
    items: [
      item('veil', 'mask@1', TITLE_NAMES.veil, 'a02', { shape: 'rect', box: [0, 0, 320, 180], applies_to: 'children' }),
      item('line', 'path@1', TITLE_NAMES.line, 'a03', {
        d: 'M 40 120 C 100 30 220 30 280 120', paint: { stroke: { role: 'ink', width: 24, cap: 'round' } }, ops: [{ trim: { start: 0, end: 0 } }],
      }, { parent: 'veil' }),
      item('tiles', 'rect@1', TITLE_NAMES.tiles, 'a04', {
        box: [-12, -12, 24, 24], paint: { fill: { role: 'accent' } }, ops: [{ repeater: { copies: 3, at: { pos: [36, 0] }, opacity: [1, 0.5] } }],
      }, { at: { pos: [36, 150, 0] } }),
      ...more,
    ],
    channels: {
      trim: channel('items/line/params/ops/0/trim/end', [[0, 0, trimInterp], [1.5, 1]]),
      lift: channel('items/line/at/pos/1', [[0, 0, bez(0.25, 0.1, 0.25, 1)], [2, -10]]),
      turn: channel('items/tiles/at/rot/2', [[0, 0, turnInterp], [2, 45]]),
      veil: channel('items/veil/params/box/2', [[0, 320, 'hold'], [TITLE.maskAt, 160, 'hold']]),
    },
    ...(requires ? { requires } : {}),
  });
}

/** A sound strip on a stereo float WAV of the #157 tone (440 and 660 Hz), `seconds` long, in the store. */
export function toneStrip(evidence: string, seconds: number, sr = 48_000): { strips: JsonObject; assets: JsonObject } {
  const sha = putEvidence(evidence, floatWav(toneChannels(Math.round(seconds * sr), sr), sr));
  return { strips: { tone: { track: 1, src: sha, start: 0, in: 0, out: fl(seconds), rate: 1 } }, assets: { tone: { sha256: sha, license: CC0 } } };
}
/** A verdict handle a status binding reads (the agent's record holds it: `agentRun`). */
export const VERDICT = 'verdict:01JB162V000000000000000001';
/** A glow pass, composed as #429's and #430's operators are (an item of kind `gpu.pass@1`): the group's target plus
 * 60% of the mean of nine taps 3 px apart around each pixel; a group runs it by naming this item in its `passes`. */
function glowPass(id: string): JsonObject {
  const steps: JsonObject = { pix: { op: 'pixel@1' }, p: { op: 'convert@1', args: { x: 'pix', to: 'vec2<i32>' } } };
  let last = '';
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const k = `${i + 1}${j + 1}`;
    steps[`o${k}`] = { op: 'const@1', args: { value: [3 * i, 3 * j], type: 'vec2<i32>' } };
    steps[`q${k}`] = { op: 'add@1', args: { a: 'p', b: `o${k}` } };
    steps[`c${k}`] = { op: 'load@1', args: { tex: 'src', ixy: `q${k}` } };
    steps[`s${k}`] = last === '' ? { op: 'mul@1', args: { a: `c${k}`, b: 1 } } : { op: 'add@1', args: { a: last, b: `c${k}` } };
    last = `s${k}`;
  }
  steps['halo'] = { op: 'mul@1', args: { a: last, b: 0.6 / 9 } };
  steps['out'] = { op: 'add@1', args: { a: 'c11', b: 'halo' } };
  return item(id, 'gpu.pass@1', 'Glow', 'z00', {
    origin: 'composed', about: 'A glow: the target plus 60% of its blur.',
    inputs: { src: { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } } }, steps,
    outputs: { color: 'out', blend: 'replace' }, resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
  });
}
/** A group `halo` running the glow pass `glow` over a spark, with the pass's item. */
export const glowing = (sparkBox: [number, number, number, number]): JsonObject[] => [
  glowPass('glow'),
  item('halo', 'group@1', 'Halo', 'a05', { passes: [{ op: 'glow', params: {} }] }),
  item('spark', 'rect@1', 'Spark', 'a06', { box: sparkBox, paint: { fill: { role: 'accent' } } }, { parent: 'halo' }),
];

// ---------------------------------------------------------------------------------------------------
// eval: the values a shown document evaluates to (#1918's `paths`, #493's film glyphs)

export const evalCall = (k: number, t: number, paths: string[]): JsonObject => ({ call: 'eval', doc: DOCS[k]!, t, paths });
/** Each path's evaluated value in an `eval` reply, as a number; a path it can't read fails, naming it. */
export function valuesOf(reply: JsonObject, paths: string[], what: string): number[] {
  expect(reply['outcome'], `${what}: eval answers evaluated: ${show(reply, 800)}`).toBe('evaluated');
  const v = reply['values'];
  expect(isObject(v), `${what}: eval's values: ${show(v ?? null, 600)}`).toBe(true);
  return paths.map((p) => {
    const x = (v as JsonObject)[p];
    expect(typeof x === 'number' && Number.isFinite(x), `${what}: eval reads ${p} as a number, got ${show(x ?? null)}`).toBe(true);
    return x as number;
  });
}
export const glyphsCall = (k: number, t: number): JsonObject => ({ call: 'eval', doc: DOCS[k]!, t, film: true });
/** A text item's glyphs as drawn at t, each `{x, y}` its origin after its animators move it. */
export function glyphsOf(reply: JsonObject, itemId: string, what: string): Pt[] {
  expect(reply['outcome'], `${what}: eval answers evaluated: ${show(reply, 800)}`).toBe('evaluated');
  const film = reply['film'];
  const glyphs = isObject(film) && isObject(film['glyphs']) ? film['glyphs'][itemId] : undefined;
  expect(Array.isArray(glyphs), `${what}: eval's film.glyphs.${itemId} is a list: ${show(film ?? null, 600)}`).toBe(true);
  return (glyphs as JsonValue[]).map((g, i) => {
    expect(isObject(g) && typeof g['x'] === 'number' && typeof g['y'] === 'number', `${what}: glyph ${i} has x and y`).toBe(true);
    return [(g as JsonObject)['x'] as number, (g as JsonObject)['y'] as number];
  });
}

// ---------------------------------------------------------------------------------------------------
// The import (README: `import {from: lottie}` over deep_job): the first-party plug-in installed into a real hub, its
// Lottie tool run on a file in the project folder, and the document and report it keeps, read from the hub's store.

const IMPORT_PACKAGE = join(REPO, 'packages', 'jobs', 'import');
const IMPORT_KIND = 'import';
export interface ImportWorld { w: World; tool: string; evidence: string }
/** A hub with the import plug-in installed and the kind `import`'s Lottie tool (the one tool of the kind whose name
 * starts `lottie`). */
export async function importWorld(): Promise<ImportWorld> {
  expect(existsSync(join(IMPORT_PACKAGE, 'deepbuild.json')), `the import plug-in is at packages/jobs/import (README: the import); it isn't`).toBe(true);
  const w = await openWorld();
  const ran = await install(w, IMPORT_PACKAGE);
  expect(ran.code, `deep install packages/jobs/import loads it: ${shown(ran)}`).toBe(0);
  const listed = await job(w, { op: 'list' });
  const kinds = Array.isArray(listed.value['kinds']) ? (listed.value['kinds'] as JsonObject[]) : [];
  const kind = kinds.find((k) => k['kind'] === IMPORT_KIND);
  expect(kind, `deep_job lists the kind ${IMPORT_KIND}: ${listed.text.slice(0, 1200)}`).toBeDefined();
  const tools = (Array.isArray(kind!['tools']) ? kind!['tools'] : []).filter(isObject).map((t) => String(t['tool']));
  const lottie = tools.filter((t) => /^lottie[-_.a-z0-9]*@\d+\.\d+\.\d+$/.test(t));
  expect(lottie.length, `the kind ${IMPORT_KIND} lists one tool whose name starts lottie: ${JSON.stringify(tools)}`).toBe(1);
  return { w, tool: lottie[0]!, evidence: join(w.home, '.deepbuild', 'evidence') };
}
/** Bytes from the hub's evidence store, by SHA-256 (`<2 hex>/<62 hex>`). */
export function stored(iw: ImportWorld, sha: string, what: string): Buffer {
  const path = join(iw.evidence, sha.slice(0, 2), sha.slice(2));
  expect(/^[0-9a-f]{64}$/.test(sha) && existsSync(path), `${what}: the hub's evidence store holds ${sha}`).toBe(true);
  return readFileSync(path);
}
export interface Imported { document: JsonObject; report: JsonObject; reply: JsonObject; text: string }
/** One import of a Lottie file's bytes, written as `name` in the project folder: done, with its document and report
 * read by hash from the hub's store; any other reply fails, naming it. */
export async function importLottie(iw: ImportWorld, bytes: Uint8Array | string, name: string, params: JsonObject = {}): Promise<Imported> {
  const path = join(iw.w.project, name);
  writeFileSync(path, bytes);
  const o = await job(iw.w, { op: 'run', kind: IMPORT_KIND, tool: iw.tool, params: JSON.stringify({ from: 'lottie', look: 'generated', ...params }), inputs: [{ name: 'file', path }] });
  if (o.value['status'] === 'blocked' || /BLOCKED/.test(String(o.value['status'] ?? ''))) expect.fail(`BLOCKED: the import of ${name}: ${o.text.slice(0, 1500)}; this is not a pass`);
  expect(!o.isError && o.value['status'] === 'done', `the import of ${name} is done: ${o.text.slice(0, 1500)}`).toBe(true);
  const outputs = isObject(o.value['outputs']) ? (o.value['outputs'] as JsonObject) : {};
  const sha = (n: string): string => String(isObject(outputs[n]) ? (outputs[n] as JsonObject)['sha256'] : '');
  const parse = (n: string): JsonObject => {
    const v = JSON.parse(stored(iw, sha(n), `the import of ${name}: its ${n}`).toString('utf8')) as JsonValue;
    expect(isObject(v), `the import of ${name}: its ${n} is a JSON object`).toBe(true);
    return v as JsonObject;
  };
  return { document: parse('document'), report: parse('report'), reply: o.value as JsonObject, text: o.text };
}
/** The report's issues: `{code, layer, …}`. */
export const reportIssues = (r: JsonObject): JsonObject[] => (Array.isArray(r['issues']) ? r['issues'].filter(isObject) : []);
/** Whether an issue names a layer: one of its string fields is the layer's `nm`. */
export const namesLayer = (i: JsonObject, nm: string): boolean => Object.values(i).some((v) => v === nm || (Array.isArray(v) && v.includes(nm)));
/** A document's items, by ID. */
export const itemsOf = (doc: JsonObject): Record<string, JsonObject> =>
  Object.fromEntries(Object.entries(isObject(doc['items']) ? doc['items'] : {}).filter((e): e is [string, JsonObject] => isObject(e[1])));
/** The item a layer named `name` came back as: the outermost item of that name (no ancestor shares it). */
export function itemNamed(doc: JsonObject, name: string, what: string): [string, JsonObject] {
  const items = itemsOf(doc);
  const named = Object.entries(items).filter(([, i]) => i['name'] === name);
  const outer = named.filter(([, i]) => {
    for (let p = i['parent']; typeof p === 'string'; p = items[p]?.['parent']) if (items[p]?.['name'] === name) return false;
    return true;
  });
  expect(outer.length, `${what}: one outermost item is named ${JSON.stringify(name)}; named: ${JSON.stringify(named.map(([id, i]) => [id, i['kind']]))}`).toBe(1);
  return outer[0]!;
}
/** The document's look (`look.asset` → `assets[id].sha256`) read from the hub's store: role → `#rrggbb`. */
export function lookRoles(iw: ImportWorld, doc: JsonObject, what: string): Record<string, string> {
  const look = doc['look'];
  const ref = isObject(look) ? String(look['asset'] ?? '') : '';
  const id = ref.replace(/@\d+$/, '');
  const entry = isObject(doc['assets']) ? doc['assets'][id] : undefined;
  expect(isObject(entry) && typeof entry['sha256'] === 'string', `${what}: the document names its look by asset (look.asset → assets.${id}.sha256): ${show(look ?? null)}`).toBe(true);
  const def = JSON.parse(stored(iw, (entry as JsonObject)['sha256'] as string, `${what}: the look`).toString('utf8')) as JsonObject;
  const palette = isObject(def['palette']) ? def['palette'] : {};
  const roles = isObject(def['roles']) ? def['roles'] : {};
  const out: Record<string, string> = {};
  for (const [role, v] of Object.entries(roles)) {
    const hex = typeof v === 'string' ? (/^#/.test(v) ? v : typeof palette[v] === 'string' ? (palette[v] as string) : '') : '';
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) out[role] = hex.slice(0, 7).toLowerCase();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Colour: sRGB and OKLab (OKLab's published matrices), for the gradient's ΔEOK.

export type Rgb = [number, number, number];
export const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toEncoded = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function oklab([r, g, b]: Rgb): Rgb {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((c) => toEncoded(Math.min(1, Math.max(0, c)))) as Rgb;
}
export const deltaEOK = (x: Rgb, y: Rgb): number => { const p = oklab(x); const q = oklab(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
