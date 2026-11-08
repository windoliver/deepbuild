// Test-side tools for the #494 acceptance tests: `deep-motion eval` (#391's JSON-lines CLI, as #417, #489 to #493
// extended it, with this suite's path channels and key travel) and `deep-show run` (#393's scenarios, with #387's
// `eval` and #493's `film` block, with this suite's `paths` and `morphs`), each built once per file; the documents the
// tests send (films with path channels, travelling keys, formula imports, graphs and match morphs); and the reference
// geometry the expected values come from. Nothing here stands in for the motion module: every value a test compares
// comes from a binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/494 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
export const SHOW_NAME = 'deep-show';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #494.e411da84',
  2: 'AC2 #494.67b2ec28',
  3: 'AC3 #494.32c3ee38',
  4: 'AC4 #494.a4c0e37e',
  5: 'AC5 #494.862daf9a',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A time field as the time grammar's text, `"<s>s"`. */
export const at = (s: number): string => `${s}s`;
/** The 60 fps frames k/60 s with from ≤ k/60 ≤ to, both ends included, in flicks. */
export function frames60(from: number, to: number): number[] {
  const out: number[] = [];
  // `+ 0` turns a −0 (Math.ceil(−1e-9)) into 0, which is what the binary answers.
  for (let k = Math.ceil(from * 60 - 1e-9) + 0; k <= Math.floor(to * 60 + 1e-9); k++) out.push((k * FLICKS) / 60 + 0);
  return out;
}
/** `n` evenly spaced whole-flick times from `from` to `to` seconds, both included. */
export function evenly(n: number, from: number, to: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(fl(from) + ((fl(to) - fl(from)) * i) / (n - 1)));
}

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program or a wrong fixture: at least one failure. */
export function fails(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program passes the check it must fail`).toBeGreaterThan(0);
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds its binaries once, in beforeAll, copied out under their own names; a test that uses a
// build that failed fails with cargo's error.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

/** `cargo build --locked --bin deep-motion`, once per file. */
export function useMotion(): () => string {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-494-motion-'));
    error = cargo(['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(TARGET, 'debug', exe(MOTION_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; };
}

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file. */
export function useShow(): () => string {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-494-show-'));
    error = cargo(['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'full']);
    if (error === '') { bin = join(dir, `${SHOW_NAME}-full`); copyFileSync(join(TARGET, 'debug', exe(SHOW_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: ${SHOW_NAME} --no-default-features --features full`).toBe(''); return bin; };
}

interface Started { timedOut: boolean; error: string; status: number | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], text: string): Started {
  const run = spawnSync(bin, args, { cwd: REPO, input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { timedOut, error: run.error?.message ?? '', status: run.status, stdout, stderr: (run.stderr ?? '').slice(-1500), lines };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine { doc: JsonObject; times: number[] }

/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const r = start(bin, ['eval'], `${lines.map((l) => JSON.stringify({ doc: l.doc, times: l.times })).join('\n')}\n`);
  expect(r.timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(r.error, `${MOTION_NAME} eval ran`).toBe('');
  expect(r.status, `${MOTION_NAME} eval exits 0; stderr: ${r.stderr}`).toBe(0);
  expect(r.lines.length, `${MOTION_NAME} eval: one output line per input line`).toBe(lines.length);
  return r.lines.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}

export interface Frame { t: number; items: JsonObject; channels: JsonObject }
/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Frame[] {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), items: isObject(f['items']) ? f['items'] : {}, channels: isObject(f['channels']) ? f['channels'] : {} };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return frames;
}
export const evalOk = (bin: string, line: EvalLine, what: string): Frame[] => accepted(evalAll(bin, [line])[0]!, line.times, what);

export type V2 = [number, number];
/** An item's evaluated position's x and y, `items.<id>.at.pos`. */
export function posOf(f: Frame, id: string, what: string): V2 {
  const p = arr(obj(obj(f.items[id], `${what}: items.${id}`)['at'], `${what}: items.${id}.at`)['pos'], `${what}: items.${id}.at.pos`);
  return [num(p[0], `${what}: items.${id}.at.pos[0]`), num(p[1], `${what}: items.${id}.at.pos[1]`)];
}
/** A channel's evaluated value, `channels.<id>.value`. */
export const channelValue = (f: Frame, id: string, what: string): JsonValue => obj(f.channels[id], `${what}: channels.${id} at ${f.t} flicks`)['value'] ?? null;

// ---------------------------------------------------------------------------------------------------
// Paths (README: Path value) and the reference geometry

/** A closed polygon's vertices, in u. */
export type Poly = V2[];
/** One sub-path of an evaluated path: its on-curve points in order and whether it closes. */
export interface Sub { points: V2[]; closed: boolean }
const VERB_POINTS: Record<string, number> = { M: 1, L: 1, Q: 2, C: 3, Z: 0 };
const VERB_NAMES = ['M', 'L', 'Q', 'C', 'Z'];

/** A path value as written (`{verbs, pts}`, path@1's own columns) from closed polygons. */
export function pathValue(polys: readonly Poly[]): JsonObject {
  const verbs: string[] = []; const pts: number[] = [];
  for (const poly of polys) {
    poly.forEach((p, i) => { verbs.push(i === 0 ? 'M' : 'L'); pts.push(p[0], p[1]); });
    verbs.push('Z');
  }
  return { verbs, pts };
}
/** An evaluated path value read into sub-paths (verbs as letters or path@1's u8 codes). */
export function readPath(value: JsonValue | undefined, what: string): Sub[] {
  const v = obj(value, what);
  const verbs = arr(v['verbs'], `${what}.verbs`).map((x, i) => {
    const name = typeof x === 'number' ? VERB_NAMES[x] : x;
    expect(typeof name === 'string' && name in VERB_POINTS, `${what}.verbs[${i}] is one of M, L, Q, C, Z, got ${JSON.stringify(x)}`).toBe(true);
    return name as string;
  });
  const pts = arr(v['pts'], `${what}.pts`).map((x, i) => num(x, `${what}.pts[${i}]`));
  const subs: Sub[] = []; let k = 0;
  for (const verb of verbs) {
    if (verb === 'M') subs.push({ points: [], closed: false });
    const sub = subs[subs.length - 1];
    expect(sub, `${what}: the path starts with M`).toBeDefined();
    if (verb === 'Z') { sub!.closed = true; continue; }
    const n = VERB_POINTS[verb]!;
    expect(k + 2 * n <= pts.length, `${what}: pts holds the points its verbs take`).toBe(true);
    sub!.points.push([pts[k + 2 * n - 2]!, pts[k + 2 * n - 1]!]);
    k += 2 * n;
  }
  expect(k, `${what}: every point in pts belongs to a verb`).toBe(pts.length);
  return subs;
}
export const pointCount = (subs: readonly Sub[]): number => subs.reduce((s, x) => s + x.points.length, 0);
export const allPoints = (subs: readonly Sub[]): V2[] => subs.flatMap((s) => s.points);

/** Distance from p to the segment ab. */
export function toSegment(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + s * dx), p[1] - (a[1] + s * dy));
}
/** Distance from p to a closed polygon's outline. */
export const toOutline = (p: V2, poly: Poly): number => Math.min(...poly.map((a, i) => toSegment(p, a, poly[(i + 1) % poly.length]!)));
/** The regular 64-gon on a circle of radius r about c, from angle 0, as a circle "at 64 points". */
export const circle64 = (c: V2, r: number): Poly => Array.from({ length: 64 }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / 64), c[1] + r * Math.sin((2 * Math.PI * i) / 64)] as V2);
/** A regular five-point star about c, outer radius R, its first tip straight up on screen (y down). */
export function star5(c: V2, R: number): Poly {
  const r = (R * Math.sin(Math.PI / 10)) / Math.sin((7 * Math.PI) / 10);
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5; const rad = i % 2 === 0 ? R : r;
    return [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)] as V2;
  });
}
/** An axis-aligned rectangle x0..x1 × y0..y1 as a polygon. */
export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A polygon's bounding-box centre. */
export function boxCenter(poly: readonly V2[]): V2 {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp2 = (a: V2, b: V2, p: number): V2 => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
export const fmt = (p: V2): string => `(${p[0]}, ${p[1]})`;

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents)

export const LAYER = 'main';
export const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export const SIZE: [number, number] = [800, 450];
/** The canvas module (Document envelope: `requires.modules`) each non-core kind these films use belongs to. */
const MODULE_OF: Record<string, string> = { 'vector@1': 'vector', 'graph@1': 'graph' };
/** A film of `SIZE` u with a still 2D camera `cam` over the page (y down), and the items given; it declares the
 * modules its kinds need (vector, graph), as `deep show` requires. */
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, span = '2s'): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } };
  const modules: JsonObject = {};
  for (const i of items) { const m = MODULE_OF[String(i['kind'])]; if (m) modules[m] = '^1'; }
  return {
    format: 1, id, profile: 'film', title: `#494 ${id}`, description: `The #494 acceptance tests' film ${id}.`, size: SIZE, camera: 'cam', layers: LAYERS,
    transport: { span }, ...(Object.keys(modules).length ? { requires: { modules } } : {}), items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A 2D rectangle: `box` [x, y, w, h] in u from its position. */
export function rect(id: string, box: [number, number, number, number], pos: V2 = [0, 0]): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order: `c${id}`, params: { box, paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] } };
}
/** A path@1 item drawing `polys`, at the origin. */
export function pathItem(id: string, polys: readonly Poly[]): JsonObject {
  return { id, kind: 'path@1', layer: LAYER, name: `Path ${id}`, order: `c${id}`, params: { ...pathValue(polys), paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } };
}
/** A key: its time in seconds, its value, linear unless given, and its other fields (`travel`). */
export const key = (s: number, value: JsonValue, extra: JsonObject = {}): JsonObject => ({ t: at(s), value, interp: 'linear', ...extra });
/** A channel of `type` on `target` with keys k0, k1, … in the order given, and its other fields (`morph`). */
export function channel(target: string, type: string, keys: JsonObject[], extra: JsonObject = {}): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map((k, i) => [`k${i}`, k])), ...extra };
}

// ---- formulas (vector@1 over an SVG this suite writes) and graphs

/** One part of a formula: its id and its outline, in SVG units (the document's u: README, Formulas). */
export interface Part { id: string; poly: Poly }
/** An SVG of `SIZE` with one filled path per part, each with its id: outlines only, as the typeset job writes. */
export function svgOf(parts: readonly Part[]): Buffer {
  const d = (poly: Poly): string => `${poly.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')} Z`;
  const body = parts.map((p) => `  <path id="${p.id}" d="${d(p.poly)}" fill="#000000"/>`).join('\n');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE[0]} ${SIZE[1]}" width="${SIZE[0]}" height="${SIZE[1]}">\n${body}\n</svg>\n`);
}
/** A vector@1 formula over the SVG at `src`, filling the page from the origin, so SVG units are document u. */
export function formula(id: string, src: string, alt: string): JsonObject {
  return { id, kind: 'vector@1', layer: LAYER, name: `Formula ${id}`, order: `d${id}`, params: { src, size: [...SIZE], colors: { '#000000': 'ink' }, alt }, at: { pos: [0, 0, 0] } };
}
/** A graph@1 with the basic layered layout: nodes 64 × 32 u, edges `[id, a, b]`, at `pos`. */
export function graph(id: string, nodes: string[], edges: [string, string, string][], pos: V2): JsonObject {
  return {
    id, kind: 'graph@1', layer: LAYER, name: `Graph ${id}`, order: `e${id}`, at: { pos: [pos[0], pos[1], 0] },
    params: { graph: { nodes: nodes.map((n) => ({ id: n, w: 64, h: 32 })), edges: edges.map(([e, a, b]) => ({ id: e, a, b })) }, layout: { algo: 'layered', seed: 494, spacing: { rank: 48 } } },
  };
}
/** A match morph from one item to another in the one shot, its 1 s window centred on `at` (README: Transition). */
export function matchMorph(from: string, to: string, fields: JsonObject = {}, centre = 0.5): JsonObject {
  return { from, to, kind: 'match_morph', at: at(centre), span: '1s', progress: 'linear', match_morph: fields };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test: deep-show)

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-494-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB494D', 1), b: ulid('01JB494D', 2) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** A scenario: the evidence store, your shell's process tree, one panel, the documents, and the calls. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  const docs: JsonObject = {};
  for (const id of Object.values(DOC)) docs[id] = { panel: 'main' };
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs, calls };
}
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], `${JSON.stringify(sc)}\n`);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run exits 0; stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr}`).toBe(0);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  return arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
}
/** `deep show` of a whole document from your shell, with its issues; the payload carries no `layers` and no item
 * `layer` (Writer layer: the hub stamps them). */
export function present(doc: string, document: JsonObject): JsonObject {
  const payload = clone(document);
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
/** #387's `eval` at a flick with #493's `film: true`. */
export const evalCall = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, film: true });
/** The film block of an `eval` reply. */
export function filmOf(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  return obj(reply['film'], `${what}: film`);
}
/** Puts bytes into the scenario's evidence store at their SHA-256, as the hub keeps them. */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
/** Presents `document` as DOC.a and reads its film block at each time. */
export function filmsAt(bin: string, evidence: string, document: JsonObject, times: readonly number[], what: string): JsonObject[] {
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, document), ...times.map((t) => evalCall(DOC.a, t))]));
  presented(replies[0]!, what);
  return times.map((t, i) => filmOf(replies[1 + i]!, `${what} at ${t} flicks`));
}

/** One piece a match morph draws (README: `morphs`). */
export interface Piece { from: string | null; to: string | null; center: V2; opacity: number }
/** A match morph's pieces at a time, from the film block's `morphs.<transition ID>`. */
export function piecesOf(f: JsonObject, transition: string, what: string): Piece[] {
  const m = obj(obj(f['morphs'], `${what}: film.morphs`)[transition], `${what}: film.morphs.${transition}`);
  return arr(m['pieces'], `${what}: film.morphs.${transition}.pieces`).map((v, i) => {
    const p = obj(v, `${what}: pieces[${i}]`);
    const c = arr(p['center'], `${what}: pieces[${i}].center`);
    const name = (x: JsonValue | undefined, k: string): string | null => {
      expect(x === null || typeof x === 'string', `${what}: pieces[${i}].${k} is an ID or null, got ${JSON.stringify(x)}`).toBe(true);
      return x as string | null;
    };
    return { from: name(p['from'], 'from'), to: name(p['to'], 'to'), center: [num(c[0], 'center x'), num(c[1], 'center y')], opacity: num(p['opacity'], `${what}: pieces[${i}].opacity`) };
  });
}
/** The one piece that matches, failing unless exactly one does. */
export function onePiece(pieces: readonly Piece[], test: (p: Piece) => boolean, label: string, what: string): Piece {
  const found = pieces.filter(test);
  expect(found.length, `${what}: exactly one piece is ${label}; the pieces: ${JSON.stringify(pieces).slice(0, 1500)}`).toBe(1);
  return found[0]!;
}
