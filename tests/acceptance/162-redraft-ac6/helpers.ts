// Test-side tools for the blind redraft of #162's AC6: `deep-show` built once with `full` and driven by one JSON
// scenario on stdin (`deep-show run`, as tests/acceptance/501's helpers write it); the two fixture films; a reader of
// the Lottie JSON the export writes (layers by `nm`, shapes by `ty`, groups' `tr`, properties `{a, k}` and keyframes
// `{t, s, ...}`, evaluated at an export frame as a Lottie player evaluates them); and the twist's output path, computed
// here from the path ops' semantics as the base implements them. Nothing here stands in for the export: every value a
// test judges is read from the file the export wrote. README: The surface under test, Fixtures, Readings.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
type Pt = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/162-redraft-ac6 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const FULL = 'full';
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** Each test's time; the cargo build in `beforeAll` gets an hour. */
export const TIMEOUT = 600_000;
const BUILD_TIMEOUT = 3_600_000;

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white
 * space collapsed). */
export const AC6 = 'AC6 #162.bc95e877';
/** Within this many u a written point is the evaluated one (#160's parity tolerance for path ops). */
export const TOL = 0.01;

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: JsonValue | undefined, n = 1200): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.length} failures, the first: ${failures.slice(0, 10).join(' | ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, copied out of
// the target folder; a test whose build failed fails with cargo's error.

export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-162-ac6-bin-'));
    const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', FULL];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const bin = join(dir, SHOW);
    if (r.error) built = { bin, error: `cargo could not run: ${r.error.message}` };
    else if (r.status !== 0) built = { bin, error: `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}` };
    else { copyFileSync(join(targetOf(), 'debug', SHOW), bin); built = { bin, error: '' }; }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(built.error, `${SHOW} builds with features ${FULL}`).toBe('');
    return built.bin;
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-162-ac6-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario line in, one answer line `{"ok": true, "replies": [...]}` out, exit 0.

export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 30_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  let answer: JsonValue = null;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const out = obj(answer, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** The document the tests show (a ULID). */
const DOC = '01JB162A000000000000000006';
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, one panel showing the document, the calls. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
}
/** `deep show` of a whole document from your shell's peer; the hub stamps the writer layer, so the payload has none. */
export function present(document: JsonObject): JsonObject {
  const payload = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc: DOC, document: payload, include: ['issues'] };
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
/** The Lottie export the issue names: `video.codec: lottie` with `lottie: {container: json, images: embed}`. */
export function lottieExport(out: string): JsonObject {
  return { call: 'export', doc: DOC, out, video: { codec: 'lottie' }, lottie: { container: 'json', images: 'embed' } };
}
/** A delivered export: `{outcome: "exported", receipt}` and a JSON file at `out`. */
export function exportedFile(reply: JsonObject, out: string, what: string): JsonObject {
  expect(reply['outcome'], `${what} is exported: ${show(reply)}`).toBe('exported');
  obj(reply['receipt'], `${what}: receipt`);
  expect(existsSync(out), `${what}: the export wrote ${out}`).toBe(true);
  let file: JsonValue = null;
  try { file = JSON.parse(readFileSync(out, 'utf8')) as JsonValue; } catch (e) { expect.fail(`${what}: ${out} is JSON (${(e as Error).message})`); }
  return obj(file, `${what}: the Lottie file`);
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures): `film` profile documents with a 2D orthographic camera over the frame and a ground rect.

const LAYER = 'main';
const SIZE: [number, number] = [320, 180];
const RATE: [number, number] = [24, 1];
function film(id: string, span: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  const all: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
    { id: 'back', kind: 'rect@1', layer: LAYER, name: 'Ground', order: 'a1', params: { box: [0, 0, SIZE[0], SIZE[1]], paint: { fill: { role: 'ground' } } } },
    ...items,
  ];
  return {
    format: 1, id, profile: 'film', title: `#162 AC6 ${id}`, description: `The #162 AC6 acceptance test's film ${id}.`, size: SIZE,
    layers: { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items: Object.fromEntries(all.map((i) => [String(i['id']), i])),
    camera: 'cam', transport: { span, frame_rate: RATE }, ...extra,
  };
}
const d = (pts: Pt[]): string => `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;

/** The repeater film: 1 s at 24 fps; a square path `Tiles` with one op, a repeater of 3.5 copies 60 u apart along x
 * (fields as Path: ops gives them; opacity, partial and composite at their defaults). */
export const TILES = { name: 'Tiles', frames: 24, step: 60, square: [[20, 20], [50, 20], [50, 50], [20, 50]] as Pt[] } as const;
export function tilesFilm(): JsonObject {
  return film('tiles', '1s', [{
    id: 'tiles', kind: 'path@1', layer: LAYER, name: TILES.name, order: 'a2',
    params: { d: d([...TILES.square]), paint: { fill: { role: 'accent' } }, ops: [{ repeater: { copies: 3.5, at: { pos: [TILES.step, 0] } } }] },
  }]);
}
/** Copy k of the repeater: the square moved k steps along x, and its opacity (1, 1, 1, then the fraction 0.5). */
const tileCopy = (k: number): { points: Pt[]; opacity: number } =>
  ({ points: TILES.square.map(([x, y]) => [x + k * TILES.step, y] as Pt), opacity: k < 3 ? 1 : 0.5 });

/** The twist film: 2 s at 24 fps (48 export frames); a rect `Plate`, box [100, 50, w, 80], with one op, a twist of 60°
 * about its top-left corner (100, 50), so as a path (rect@1 with ops becomes one) it turns its corners by how near
 * they are to that corner; a channel keys w from 40 at 0.5 s to 160 at 1.5 s, linear, held before and after, so the
 * twist's output path changes while w moves and holds while it doesn't. */
export const PLATE = { name: 'Plate', frames: 48, rate: 24, box: [100, 50, 40, 80], angle: 60, center: [100, 50] as Pt, keys: [[0.5, 40], [1.5, 160]] as [number, number][] } as const;
export function plateFilm(): JsonObject {
  const [[t0, w0], [t1, w1]] = PLATE.keys as [[number, number], [number, number]];
  return film('plate', '2s', [{
    id: 'plate', kind: 'rect@1', layer: LAYER, name: PLATE.name, order: 'a2',
    params: { box: [...PLATE.box], paint: { fill: { role: 'accent' } }, ops: [{ twist: { angle: PLATE.angle, center: [...PLATE.center] } }] },
  }], {
    channels: { grow: { target: 'items/plate/params/box/2', type: 'f32', keys: { k0: { t: `${t0}s`, value: w0, interp: 'linear' }, k1: { t: `${t1}s`, value: w1, interp: 'linear' } } } },
  });
}
/** The plate's width at export frame f (t = f ÷ 24 s): the channel's linear keys (at frames 12 and 36), held outside
 * them; 5 u a frame between them. */
function plateWidth(f: number): number {
  const [[t0, w0], [t1, w1]] = PLATE.keys as [[number, number], [number, number]];
  const [f0, f1] = [t0 * PLATE.rate, t1 * PLATE.rate];
  return f <= f0 ? w0 : f >= f1 ? w1 : w0 + ((w1 - w0) * (f - f0)) / (f1 - f0);
}
/** The twist's output path at export frame f, as the base builds it: the rect as a path, M (x, y) L (x + w, y)
 * L (x + w, y + h) L (x, y + h) Z (crates/deep-canvas-marks/src/outline.rs `rect`), then its `twist`
 * (crates/deep-canvas-marks/src/pathops.rs): every point turned about `center` by angle × max(0, 1 − d ÷ R), R the
 * farthest anchor's distance from the centre, from +x toward +y (y down) for a positive angle; a line stays a line. */
function twistedPlate(f: number): Pt[] {
  const [x, y, , h] = PLATE.box; const w = plateWidth(f);
  const corners: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const [cx, cy] = PLATE.center;
  const reach = Math.max(...corners.map(([px, py]) => Math.hypot(px - cx, py - cy)));
  return corners.map(([px, py]): Pt => {
    const a = (PLATE.angle * Math.max(0, 1 - Math.hypot(px - cx, py - cy) / reach) * Math.PI) / 180;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    return [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c];
  });
}

// ---------------------------------------------------------------------------------------------------
// The Lottie reader (README: Readings). Its own code, written from the Lottie format: nothing of the writer's.

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export interface Lottie { fr: number; ip: number; op: number; layers: JsonObject[] }
export function lottieOf(file: JsonObject, what: string): Lottie {
  return { fr: num(file['fr'], `${what}: fr`), ip: num(file['ip'], `${what}: ip`), op: num(file['op'], `${what}: op`), layers: arr(file['layers'], `${what}: layers`).map((l, i) => obj(l, `${what}: layers[${i}]`)) };
}
/** The one layer of the root composition whose `nm` is the item's name. */
function layerNamed(l: Lottie, nm: string, what: string): JsonObject {
  const found = l.layers.filter((x) => x['nm'] === nm);
  expect(found.length, `${what}: one layer has nm ${JSON.stringify(nm)}; the layers' names: ${show(l.layers.map((x) => x['nm'] ?? null))}`).toBe(1);
  return found[0]!;
}
/** Every shape in a layer's tree, at any depth, hidden or not. */
function allShapes(layer: JsonObject): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (list: JsonValue | undefined): void => { for (const s of Array.isArray(list) ? list : []) if (isObject(s)) { out.push(s); walk(s['it']); } };
  walk(layer['shapes']);
  return out;
}

// Properties `{a, k}`: static (`a` 0, `k` the value) or keyed (`a` 1, `k` keyframes `{t, s, h?, o?, i?}`).
const keyedProp = (p: JsonObject): boolean => {
  const k = p['k'];
  return p['a'] === 1 || (Array.isArray(k) && k.length > 0 && isObject(k[0]) && typeof k[0]['t'] === 'number');
};
/** A keyed property's keyframes, or null for a static one. */
function keyframes(p: JsonValue | undefined, what: string): JsonObject[] | null {
  if (!isObject(p) || !keyedProp(p)) return null;
  const list = arr(p['k'], `${what}: k`).map((k, i) => obj(k, `${what}: k[${i}]`));
  list.forEach((k, i) => num(k['t'], `${what}: k[${i}].t`));
  return list;
}
function mix(a: JsonValue, b: JsonValue, u: number): JsonValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => mix(x, b[i] ?? x, u));
  if (isObject(a) && isObject(b)) return Object.fromEntries(Object.entries(a).map(([k, x]) => [k, k in b ? mix(x, b[k]!, u) : x]));
  return a;
}
const first = (v: JsonValue | undefined, fallback: number): number => (typeof v === 'number' ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : fallback);
/** A keyframe's time ease: the cubic Bézier (0, 0), o, i, (1, 1) read at x = u. */
function eased(o: JsonValue | undefined, i: JsonValue | undefined, u: number): number {
  if (!isObject(o) || !isObject(i) || u <= 0 || u >= 1) return u;
  const [x1, y1, x2, y2] = [first(o['x'], 0), first(o['y'], 0), first(i['x'], 1), first(i['y'], 1)];
  const at = (p1: number, p2: number, s: number): number => 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  let lo = 0; let hi = 1;
  for (let n = 0; n < 80; n++) { const m = (lo + hi) / 2; if (at(x1, x2, m) < u) lo = m; else hi = m; }
  return at(y1, y2, (lo + hi) / 2);
}
/** A property's value at local time τ, as a Lottie player reads it: a keyed one holds its first key's value before it
 * and its last key's after it, a hold key (`h` 1) holds to the next key, and others ease from their `s` to the next
 * key's `s`. */
function valueAt(p: JsonValue | undefined, tau: number, what: string): JsonValue | undefined {
  if (!isObject(p)) return undefined;
  const ks = keyframes(p, what);
  if (ks === null) return p['k'];
  expect(ks.length, `${what}: a keyed property has keys`).toBeGreaterThan(0);
  const start = (k: JsonObject): JsonValue | undefined => k['s'];
  if (tau <= (ks[0]!['t'] as number)) return start(ks[0]!);
  let j = 0;
  while (j + 1 < ks.length && (ks[j + 1]!['t'] as number) <= tau) j++;
  const a = ks[j]!;
  if (j + 1 === ks.length) return start(a) ?? ks[j - 1]?.['e'];
  const b = ks[j + 1]!;
  const from = start(a);
  if (a['h'] === 1 || from === undefined) return from;
  const to = start(b) ?? a['e'];
  if (to === undefined) return from;
  const u = (tau - (a['t'] as number)) / ((b['t'] as number) - (a['t'] as number));
  return mix(from, to, eased(a['o'], a['i'], u));
}
const vec = (v: JsonValue | undefined, fallback: number[]): number[] =>
  typeof v === 'number' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'number') && v.length > 0 ? (v as number[]) : fallback;

// Transforms: [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f).
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const compose = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const applied = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** A group's `tr` or a layer's `ks` at local time τ: position + rotation · scale ÷ 100 · (point − anchor), and its
 * opacity ÷ 100. Rotation is in degrees, from +x toward +y (y down). */
function transformAt(t: JsonValue | undefined, tau: number, what: string): { m: Affine; o: number } {
  if (!isObject(t)) return { m: IDENTITY, o: 1 };
  const a = vec(valueAt(t['a'], tau, `${what}.a`), [0, 0]);
  const pp = t['p'];
  const p = isObject(pp) && pp['s'] === true
    ? [vec(valueAt(pp['x'], tau, `${what}.p.x`), [0])[0]!, vec(valueAt(pp['y'], tau, `${what}.p.y`), [0])[0]!]
    : vec(valueAt(pp, tau, `${what}.p`), [0, 0]);
  const s = vec(valueAt(t['s'], tau, `${what}.s`), [100, 100]);
  const r = (vec(valueAt(t['r'], tau, `${what}.r`), [0])[0]! * Math.PI) / 180;
  const o = vec(valueAt(t['o'], tau, `${what}.o`), [100])[0]! / 100;
  const [sx, sy] = [s[0]! / 100, (s[1] ?? s[0]!) / 100];
  const lin = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy];
  const [ax, ay] = [a[0] ?? 0, a[1] ?? 0];
  return { m: [lin[0]!, lin[1]!, lin[2]!, lin[3]!, (p[0] ?? 0) - (lin[0]! * ax + lin[2]! * ay), (p[1] ?? 0) - (lin[1]! * ax + lin[3]! * ay)], o };
}
/** A layer's local time at composition frame F: (F − st) ÷ sr. */
const localTime = (layer: JsonObject, F: number): number => (F - (typeof layer['st'] === 'number' ? layer['st'] : 0)) / (typeof layer['sr'] === 'number' && layer['sr'] !== 0 ? layer['sr'] : 1);
/** A layer's own transform at composition frame F, through its parents (a parent passes its transform, not its
 * opacity). */
function layerMatrix(l: Lottie, layer: JsonObject, F: number, what: string, depth = 0): Affine {
  const own = transformAt(layer['ks'], localTime(layer, F), `${what}.ks`).m;
  if (typeof layer['parent'] !== 'number' || depth > 32) return own;
  const parent = l.layers.find((x) => x['ind'] === layer['parent']);
  expect(parent !== undefined, `${what}: its parent layer ${layer['parent']} is in the composition`).toBe(true);
  return compose(layerMatrix(l, parent!, F, `${what} → parent ${layer['parent']}`, depth + 1), own);
}

/** A shape and the groups it sits in, outer first, with the shape list at each level (the layer's, then each group's). */
interface Leaf { shape: JsonObject; groups: JsonObject[]; levels: JsonValue[][] }
const GEOMETRY = new Set(['sh', 'rc', 'el', 'sr']);
const shown = (list: JsonValue | undefined): JsonObject[] => (Array.isArray(list) ? list.filter((s): s is JsonObject => isObject(s) && s['hd'] !== true) : []);
/** Every shown geometry shape under `list`. */
function leaves(list: JsonValue[], groups: JsonObject[] = [], levels: JsonValue[][] = []): Leaf[] {
  const here = [...levels, list];
  return shown(list).flatMap((s) => (s['ty'] === 'gr' ? leaves(Array.isArray(s['it']) ? s['it'] : [], [...groups, s], here) : GEOMETRY.has(String(s['ty'])) ? [{ shape: s, groups, levels: here }] : []));
}
/** A written path in composition space: its vertices and the absolute points of its handles. */
interface Written { closed: boolean; v: Pt[]; i: Pt[]; o: Pt[]; opacity: number }
/** A leaf `sh` at composition frame F: its path through its groups' `tr` and its layer's `ks`, and the opacity it
 * draws at (its layer's, its groups' and the fills' at each level it sits in, multiplied). */
function writtenAt(l: Lottie, layer: JsonObject, leaf: Leaf, F: number, what: string): Written {
  expect(leaf.shape['ty'], `${what}: the geometry is a path shape (sh)`).toBe('sh');
  const tau = localTime(layer, F);
  let m = layerMatrix(l, layer, F, what);
  let opacity = transformAt(layer['ks'], tau, `${what}.ks`).o;
  for (const [n, g] of leaf.groups.entries()) {
    const t = transformAt(arr(g['it'], `${what}: group ${n}'s it`).find((s) => isObject(s) && s['ty'] === 'tr'), tau, `${what}: group ${n}'s tr`);
    m = compose(m, t.m); opacity *= t.o;
  }
  for (const level of leaf.levels) for (const s of shown(level)) if (s['ty'] === 'fl') opacity *= vec(valueAt(s['o'], tau, `${what}: a fill's o`), [100])[0]! / 100;
  let shape = valueAt(leaf.shape['ks'], tau, `${what}: ks`);
  if (Array.isArray(shape) && shape.length === 1) shape = shape[0]!;
  const b = obj(shape, `${what}: the path at frame ${F}`);
  const pts = (key: string): Pt[] => arr(b[key], `${what}: ${key}`).map((p, j) => { const q = arr(p, `${what}: ${key}[${j}]`); return [num(q[0], `${what}: ${key}[${j}][0]`), num(q[1], `${what}: ${key}[${j}][1]`)] as Pt; });
  const v = pts('v'); const i = pts('i'); const o = pts('o');
  expect([i.length, o.length], `${what}: one in and one out tangent per vertex`).toEqual([v.length, v.length]);
  return { closed: b['c'] === true, v: v.map((p) => applied(m, p)), i: v.map((p, j) => applied(m, [p[0] + i[j]![0], p[1] + i[j]![1]])), o: v.map((p, j) => applied(m, [p[0] + o[j]![0], p[1] + o[j]![1]])), opacity };
}
const offSegment = (p: Pt, a: Pt, b: Pt): number => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]; const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return dist(p, [a[0] + u * dx, a[1] + u * dy]);
};
/** How a written path differs from a closed polygon `want` (its corners in order, its sides straight): the same
 * sides, from any starting corner, in the same direction, each with its handles on the side, within TOL. A side of
 * zero length (a closing vertex written twice) is skipped. */
function polygonFailures(got: Written, want: Pt[], what: string): string[] {
  const n = got.v.length;
  const sides: [Pt, Pt, Pt, Pt][] = [];
  for (let j = 0; j < n; j++) {
    if (j + 1 === n && !got.closed) break;
    const k = (j + 1) % n;
    const side: [Pt, Pt, Pt, Pt] = [got.v[j]!, got.o[j]!, got.i[k]!, got.v[k]!];
    if (side.every((p) => dist(p, side[0]) <= TOL)) continue;
    sides.push(side);
  }
  if (sides.length !== want.length) return [`${what}: ${sides.length} sides, not ${want.length} (${n} vertices, closed ${got.closed})`];
  const shift = want.reduce((best, p, k) => (dist(sides[0]![0], p) < dist(sides[0]![0], want[best]!) ? k : best), 0);
  const failures: string[] = [];
  sides.forEach(([a, h1, h2, b], j) => {
    const [wa, wb] = [want[(j + shift) % want.length]!, want[(j + shift + 1) % want.length]!];
    const worst = Math.max(dist(a, wa), dist(b, wb), offSegment(h1, wa, wb), offSegment(h2, wa, wb));
    if (!(worst <= TOL)) failures.push(`${what}: side ${j} runs (${a[0].toFixed(3)}, ${a[1].toFixed(3)}) → (${b[0].toFixed(3)}, ${b[1].toFixed(3)}), handles (${h1[0].toFixed(3)}, ${h1[1].toFixed(3)}) and (${h2[0].toFixed(3)}, ${h2[1].toFixed(3)}), where the evaluated path's side runs (${wa[0].toFixed(3)}, ${wa[1].toFixed(3)}) → (${wb[0].toFixed(3)}, ${wb[1].toFixed(3)}): ${worst.toFixed(4)} u off`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The judgements (README: Readings): what the test asserts of each written file, as failures naming the frame.

/** The file's frame rate and span are the export's, so export frame f is composition frame ip + f. */
function spansFrames(l: Lottie, frames: number, what: string): void {
  expect(l.fr, `${what}: fr is the export frame rate, 24`).toBe(RATE[0] / RATE[1]);
  expect(l.op - l.ip, `${what}: the file spans the film's ${frames} export frames (op − ip)`).toBe(frames);
}
/** The layer is on at composition frame F (ip ≤ F < op). */
const layerOn = (layer: JsonObject, F: number): boolean =>
  (typeof layer['ip'] !== 'number' || layer['ip'] <= F) && (typeof layer['op'] !== 'number' || F < layer['op']);

/** The repeater's copies: from the layer's shapes down, through any one group that wraps all the geometry, the first
 * level with more than one group that holds geometry; each copy's leaves carry the wrapping groups and the copy's. */
function copiesOf(layer: JsonObject, what: string): { copies: Leaf[][]; loose: string[] } {
  let list = arr(layer['shapes'], `${what}: shapes`);
  const wrappers: JsonObject[] = []; const levels: JsonValue[][] = [];
  for (;;) {
    levels.push(list);
    const holding = shown(list).filter((s) => s['ty'] === 'gr' && leaves(Array.isArray(s['it']) ? s['it'] : []).length > 0);
    const loose = leaves(list).filter((l) => l.groups.length === 0).map((l) => String(l.shape['ty']));
    if (loose.length === 0 && holding.length === 1) { wrappers.push(holding[0]!); list = arr(holding[0]!['it'], `${what}: a wrapping group's it`); continue; }
    return { copies: holding.map((g) => leaves(arr(g['it'], `${what}: a copy's it`), [...wrappers, g], levels)), loose };
  }
}

/** The repeater film's file: no repeater shape, four groups holding geometry, and at every export frame each group's
 * square on one copy's, every copy once, at the copy's opacity. */
export function tilesFailures(l: Lottie, what: string): string[] {
  spansFrames(l, TILES.frames, what);
  const layer = layerNamed(l, TILES.name, what);
  expect(allShapes(layer).filter((s) => s['ty'] === 'rp').length, `${what}: Lottie 1.0.1 has no repeater, so the layer holds no repeater shape (rp)`).toBe(0);
  const { copies, loose } = copiesOf(layer, `${what}: layer ${TILES.name}`);
  expect(loose, `${what}: the copies are groups, with no geometry beside them`).toEqual([]);
  expect(copies.length, `${what}: the repeater's ⌈3.5⌉ copies are four groups that hold geometry`).toBe(4);
  const failures: string[] = [];
  for (let f = 0; f < TILES.frames; f++) {
    const F = l.ip + f;
    if (!layerOn(layer, F)) failures.push(`frame ${f}: layer ${TILES.name} is off (ip ${layer['ip']}, op ${layer['op']})`);
    const placed = new Set<number>();
    copies.forEach((ls, n) => {
      if (ls.length !== 1) { failures.push(`frame ${f}: group ${n} holds ${ls.length} shapes of geometry, not the square's one path`); return; }
      const w = writtenAt(l, layer, ls[0]!, F, `frame ${f}: group ${n}`);
      const cx = w.v.reduce((s, p) => s + p[0], 0) / Math.max(1, w.v.length);
      const k = Math.round((cx - 35) / TILES.step);
      if (!(k >= 0 && k <= 3) || placed.has(k)) { failures.push(`frame ${f}: group ${n}'s square is centred at x ${cx.toFixed(3)}, ${placed.has(k) ? `copy ${k}'s place again` : 'no copy\'s place'}`); return; }
      placed.add(k);
      const want = tileCopy(k);
      failures.push(...polygonFailures(w, want.points, `frame ${f}: group ${n} (copy ${k})`));
      if (!(Math.abs(w.opacity - want.opacity) <= 1e-3)) failures.push(`frame ${f}: copy ${k} (group ${n}) draws at opacity ${w.opacity.toFixed(4)}, not ${want.opacity}${k === 3 ? ', half the opacity of the others' : ''}`);
    });
  }
  return failures;
}

/** How far the twist's output path moves from export frame f − 1 to f (its farthest corner), 0 at frame 0. */
export const movedAt = (f: number): number => (f <= 0 || f >= PLATE.frames ? 0 : Math.max(...twistedPlate(f).map((p, j) => dist(p, twistedPlate(f - 1)[j]!))));
const changesAt = (f: number): boolean => movedAt(f) > 1e-9;
/** The export frames at which the twist's output path differs from the frame before. */
export const plateChanges = (): number[] => Array.from({ length: PLATE.frames }, (_, f) => f).filter(changesAt);

/** The twist film's file: no twist shape, one path, a key at each export frame where the output path changes, no key
 * at a frame where it doesn't (but frame 0, or the held frame just before a change), keys only on export frames, and
 * the path, read as a player reads it, equal to the output path at every export frame. */
export function plateFailures(l: Lottie, what: string): string[] {
  const n = PLATE.frames;
  spansFrames(l, n, what);
  const layer = layerNamed(l, PLATE.name, what);
  expect(allShapes(layer).filter((s) => s['ty'] === 'tw').length, `${what}: Lottie 1.0.1 has no twist, so the layer holds no twist shape (tw)`).toBe(0);
  const ls = leaves(arr(layer['shapes'], `${what}: shapes`));
  expect(ls.map((x) => x.shape['ty']), `${what}: layer ${PLATE.name} holds one path, the twist's output path`).toEqual(['sh']);
  const path = ls[0]!;
  const failures: string[] = [];
  const keyed = new Set<number>();
  const st = typeof layer['st'] === 'number' ? layer['st'] : 0;
  const sr = typeof layer['sr'] === 'number' && layer['sr'] !== 0 ? layer['sr'] : 1;
  for (const k of keyframes(path.shape['ks'], `${what}: the path's ks`) ?? []) {
    const f = st + (k['t'] as number) * sr - l.ip;
    if (Math.abs(f - Math.round(f)) > 1e-6) failures.push(`a key at Lottie time ${k['t']}: export frame ${f}, not a whole export frame`);
    else if (Math.round(f) < 0 || Math.round(f) >= n) failures.push(`a key at export frame ${Math.round(f)}, outside the export's frames 0 to ${n - 1}`);
    else keyed.add(Math.round(f));
  }
  for (let f = 0; f < n; f++) {
    const F = l.ip + f;
    if (changesAt(f) && !keyed.has(f)) failures.push(`frame ${f}: the output path changes here (w ${plateWidth(f)}, a corner moves ${movedAt(f).toFixed(3)} u) and no key is at this frame`);
    if (keyed.has(f) && !changesAt(f) && f !== 0 && !changesAt(f + 1)) failures.push(`frame ${f}: a key where the output path doesn't change (w ${plateWidth(f)}, as at frame ${f - 1})`);
    if (!layerOn(layer, F)) failures.push(`frame ${f}: layer ${PLATE.name} is off (ip ${layer['ip']}, op ${layer['op']})`);
    const w = writtenAt(l, layer, path, F, `frame ${f} (local time ${localTime(layer, F)})`);
    failures.push(...polygonFailures(w, twistedPlate(f), `frame ${f} (w ${plateWidth(f)})`));
  }
  return failures;
}
