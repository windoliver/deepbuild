// Test-side tools for the #1401 acceptance tests: the base's `deep-show` (#393's hub, played by `deep-show run`), built
// once per file and driven by one JSON line; the evidence store seeded by its layout (`<first 2 hex>/<other 62 hex>`)
// with the fixtures' glTF meshes; scene documents as a shared document stores them (#96: revision 0, one layer per
// writer); the render-back call with the probes this suite adds (README: The surface under test); and the reviewed
// references the criteria are held to: camera@1's pinhole (#378, #1976), ray–sphere, ray–plane, ray–box and
// ray–triangle hits in f64, a seeded generator and a minimal glTF writer. Copied in part from #384's, #427's and
// #1976's helpers, since suites don't import each other. Nothing here stands in for the probe path under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1401 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed (README). */
export const AC1 = 'AC1 #1401.e76a9655';
export const AC2 = 'AC2 #1401.b2d6901b';
export const AC3 = 'AC3 #1401.a6573e7a';
export const AC4 = 'AC4 #1401.83ac6241';
export const AC5 = 'AC5 #1401.39142bf2';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 800) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The 3D offscreen copy draws its frame and its object-ID target on macOS's Metal device (#378, #424). */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`render-back draws a 3D revision and its object-ID target on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-show built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-show before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1401-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-show')), join(dir, exe('deep-show')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-show'));
  };
}
/** A fresh temporary folder per test (the evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1401-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Puts `bytes` into the evidence store at `root` by its layout; returns its SHA-256. */
export function seed(root: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The scenario: the hub's canvas side as `deep-show run` plays it (#393, #96), on the virtual display clock.

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
const REFRESH_HZ = 120;
export const PERIOD = FLICKS / REFRESH_HZ;
const CLOCK: JsonObject = { refresh_hz: REFRESH_HZ, lead: 2 * MS, check: MS / 2 };
/** Every call after the setup takes its own slot, 10 frames apart from frame 120 (1 s on the clock). */
export const slot = (n: number): number => (120 + 10 * n) * PERIOD;
/** The agent's patch k arrives at frame 20 + 4k, so each is current long before the first slot. */
export const patchAt = (k: number): number => (20 + 4 * k) * PERIOD;

/** The frame every render-back here asks for, in px: the documents' own size too. */
export const SIZE: [number, number] = [320, 240];

export interface SessionFixture { id: string; thread: string; layer: string; name: string; process: { pid: number; start: number } }
/** Two test agents, each writing its own layer of the shared document. */
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', layer: 'alpha-main', name: 'Test agent alpha: probes', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', layer: 'bravo-main', name: 'Test agent bravo: labels', process: { pid: 5200, start: 2_000 } };
const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }, { pid: 5200, ppid: 1, start: 2_000 }];
/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB1401D', 1);

/** The wrong programs (README: Planted programs), each reachable only through the scenario's `planted`. */
export type Planted = 'probe_from_depth' | 'probe_nearest_item';

/** The scenario: both agents' sessions, the shared document stored at revision 0 on panel `main`, then `calls`. */
export function scenario(evidence: string, document: JsonObject, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    panels: { main: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: 'main', document } },
    calls, ...(planted ? { planted } : {}),
  };
}

const SURFACE = 'render-back with `camera` and `probes`, answered with `hits` (README: The surface under test)';

/** `deep-show run`: one scenario, answered ok with one reply per call, every agent patch applied at its revision. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const label = `deep-show run (${what})`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label}: deep-show run answers the scenario ok (${SURFACE}${sc['planted'] ? `, and planted ${String(sc['planted'])}` : ''}); got ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  const calls = arr(sc['calls'], 'calls');
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (!isObject(c) || !isObject(c['patch'])) return;
    const base = c['patch']['base'] as number;
    expect(replies[i]!['outcome'], `${label}: the agent's patch on base ${base} applies: ${shown(replies[i])}`).toBe('applied');
    expect(replies[i]!['rev'], `${label}: the agent's patch on base ${base} makes revision ${base + 1}`).toBe(base + 1);
  });
  return replies;
}

export type Pixel = [number, number];
/** A render-back of the shared document by `session` at `t` flicks as of revision `rev`, at SIZE, from `camera` (a camera
 * item's ID) or the document's own camera, with one probe per pixel (README: The surface under test). */
export function renderBack(at: number, o: { t: number; rev: number; probes: Pixel[]; session?: string; camera?: string }): JsonObject {
  return {
    call: 'render_back', at, session: o.session ?? ALPHA.id, doc: DOC, t: o.t, rev: o.rev, size: SIZE,
    ...(o.camera ? { camera: o.camera } : {}), probes: o.probes,
  };
}

/** A render-back reply's `hits`: one list per probe, in the probes' order. */
export function hitLists(reply: JsonObject, probes: number, what: string): JsonValue[][] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  const hits = reply['hits'];
  expect(Array.isArray(hits), `${what}: render-back answers its probes with \`hits\`, one list of {item, sub, point, normal, distance} per probe (README: The surface under test); got ${shown(reply)}`).toBe(true);
  const lists = hits as JsonValue[];
  expect(lists.length, `${what}: one hit list per probe`).toBe(probes);
  return lists.map((l, i) => arr(l, `${what}: hits[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// The judge: a probe's hit list against the analytic hits through its pixel. Failures come back as sentences naming
// the probe, so a planted program's failure can be read for the probe it names.

/** One expected hit: the item the probe's ray meets, where, and how far along the ray. */
export interface Want { item: string; point: V3; t: number }
export const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(6)).join(', ');

/** An entry's `point` as f64[3], or null. */
export function pointOf(entry: JsonValue | undefined): V3 | null {
  if (!isObject(entry)) return null;
  const p = entry['point'];
  return Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (p as number[] as V3) : null;
}

/**
 * `got` against `want` in order: as many hits, each naming its item, its point within `bound` of the analytic one and,
 * with `distances`, its `distance` within `bound` of the analytic distance. An empty `want` is a probe that meets
 * nothing: `hits` for it is `[]`.
 */
export function listFailures(label: string, got: JsonValue[], want: Want[], bound: number, distances = false): string[] {
  const f: string[] = [];
  if (want.length === 0) {
    if (got.length !== 0) f.push(`${label}: its ray meets nothing, so its hits are [], got ${shown(got)}`);
    return f;
  }
  if (got.length !== want.length) f.push(`${label}: ${got.length} hits, expected ${want.length} (${want.map((w) => w.item).join(', ')}): ${shown(got)}`);
  want.forEach((w, i) => {
    const g = got[i];
    if (!isObject(g)) { f.push(`${label}: hit ${i} is ${shown(g)}, expected ${w.item}`); return; }
    if (g['item'] !== w.item) f.push(`${label}: hit ${i} names ${shown(g['item'])}, expected ${w.item}`);
    const p = pointOf(g);
    if (!p) { f.push(`${label}: hit ${i} has no point: f64[3]: ${shown(g)}`); return; }
    const off = dist(p, w.point);
    if (!(off <= bound)) f.push(`${label}: hit ${i} (${w.item}) placed at (${fmt(p)}), ${off.toExponential(3)} m from the analytic hit (${fmt(w.point)})`);
    if (distances) {
      const d = g['distance'];
      if (typeof d !== 'number' || !(Math.abs(d - w.t) <= bound)) f.push(`${label}: hit ${i} (${w.item}) has distance ${shown(d)}, expected ${w.t.toFixed(9)} m`);
    }
  });
  return f;
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1401 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// Documents: a 3D scene as a shared document stores it (#96, #378), its items keyed by ID, each in a writer's layer.

/** A scene document: `items` in insertion order (their `order` keys follow it), each in alpha's layer unless it names
 * another; both agents' layers; `camera` the envelope's camera. */
export function sceneDoc(title: string, camera: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const full: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) full[id] = { id, name: id, order: `a${String(k++).padStart(3, '0')}`, layer: ALPHA.layer, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1401 acceptance fixture.`, size: SIZE, camera, transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } },
    layers: {
      [ALPHA.layer]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' },
      [BRAVO.layer]: { writer: `agent:${BRAVO.thread}`, title: BRAVO.name, order: 'a1' },
    },
    items: full, ...extra,
  };
}
/** A perspective camera@1: position, target, `fov` degrees across the wider side, near and far in m. */
export const cameraItem = (position: V3, target: V3, fov: number, near: number, far: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near, far } });
/** A black sky with no ambient: nothing but the fixtures draws. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** An unlit, double-sided, opaque material of linear `color`. */
export const unlit = (color: V3): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } });
/** A see-through glass: unlit, double-sided, alpha_mode blend at alpha 0.3 (Material; Object: see-through order). */
export const glass = (): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [0.75, 0.9, 1, 1], unlit: true, alpha_mode: 'blend', alpha: 0.3, double_sided: true } });
/** A `mark.box@1` of `size` m centred on `pos`, drawn in `material`. */
export const boxItem = (pos: V3, size: V3, material: string, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...extra });
/** A `mesh.asset@1` of a glTF in the evidence store, placed at `pos`. */
export const meshItem = (h: string, material: string, pos?: V3): JsonObject =>
  ({ kind: 'mesh.asset@1', params: { sha256: h, node: 0 }, ...(pos ? { at: { pos } } : {}), material });

/** An axis-aligned box: its centre and size, as a `mark.box@1` at `pos` with no rotation draws it. */
export interface Box { id: string; centre: V3; size: V3 }

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, camera@1's pinhole, hits in f64.

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const rad = (d: number): number => (d * Math.PI) / 180;

/** camera@1's pinhole: position, target, +Y up, `fov` degrees across the wider side of `size` (#378, #1976). */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray from the eye through frame point (sx, sy) in px (x right, y down). */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** The ray through probe pixel (x, y): through its centre, (x + 0.5, y + 0.5) (README: Readings). */
export const probeRay = (cam: Pinhole, p: Pixel): V3 => rayAt(cam, p[0] + 0.5, p[1] + 0.5);
/** Where world point `p` lands in the frame, px (the inverse of `rayAt`). */
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** The pixel holding world point `p`. */
export const pixelOf = (cam: Pinhole, p: V3): Pixel => { const [x, y] = project(cam, p); return [Math.floor(x), Math.floor(y)]; };

/** The distance along unit `d` from `o` to where it first meets the sphere at `c` of radius `r` from outside, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): number | null {
  const oc = sub(o, c); const tca = -dot(oc, d);
  const perp = add(oc, scale(d, tca)); const h2 = dot(perp, perp);
  if (tca <= 0 || h2 > r * r) return null;
  return tca - Math.sqrt(r * r - h2);
}
/** The distance along unit `d` from `o` to the plane y = 0 inside |x|, |z| ≤ `half`, from above, or null. */
export function hitGround(o: V3, d: V3, half: number): number | null {
  if (o[1] <= 0 || d[1] >= 0) return null;
  const t = -o[1] / d[1]; const p = add(o, scale(d, t));
  return Math.abs(p[0]) <= half && Math.abs(p[2]) <= half ? t : null;
}
/** The distance along unit `d` from `o`, outside it, to where it first meets the axis-aligned box `b` grown by `grow` m
 * on every side (slabs, f64), or null. */
export function hitBox(o: V3, d: V3, b: Box, grow = 0): number | null {
  let near = -Infinity; let far = Infinity;
  for (let k = 0; k < 3; k++) {
    const lo = b.centre[k]! - b.size[k]! / 2 - grow; const hi = b.centre[k]! + b.size[k]! / 2 + grow;
    if (d[k] === 0) { if (o[k]! < lo || o[k]! > hi) return null; continue; }
    const a = (lo - o[k]!) / d[k]!; const c = (hi - o[k]!) / d[k]!;
    near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c));
  }
  return near <= far && near > 0 ? near : null;
}
/** Every box the ray meets, nearest first, ties by ID: the probe's analytic hits in a scene of boxes. */
export function boxHits(o: V3, d: V3, boxes: Box[]): Want[] {
  const found: Want[] = [];
  for (const b of boxes) {
    const t = hitBox(o, d, b);
    if (t !== null) found.push({ item: b.id, t, point: add(o, scale(d, t)) });
  }
  return found.sort((a, b) => a.t - b.t || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}
/** The distance along unit `d` from `o` to triangle (a, b, c), either face (Möller–Trumbore, f64), or null. */
export function hitTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
  const e1 = sub(b, a); const e2 = sub(c, a); const p = cross(d, e2); const det = dot(e1, p);
  if (Math.abs(det) < 1e-30) return null;
  const inv = 1 / det; const s = sub(o, a); const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1); const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) * inv;
  return t > 0 ? t : null;
}

/** A seeded generator (mulberry32): the same seed gives the same probes. */
export function seeded(n: number): () => number {
  let s = n >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Meshes as glTF (a `mesh.asset@1` reads a JSON glTF with its buffer inline as a data URI, #420).

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
/** The mesh with its positions rounded to f32, as the file holds them, so a reference sees the triangles drawn. */
export const f32 = (m: Mesh): Mesh => ({ positions: m.positions.map((p) => p.map(Math.fround) as V3), triangles: m.triangles });
/** A JSON glTF of `m` (positions and u32 indices, one node, no material), as bytes. */
export function gltf(m: Mesh): Buffer {
  const pos = Buffer.alloc(m.positions.length * 12); const idx = Buffer.alloc(m.triangles.length * 12);
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  m.positions.forEach((p, i) => p.forEach((v, k) => {
    pos.writeFloatLE(v, i * 12 + k * 4);
    lo[k] = Math.min(lo[k]!, Math.fround(v)); hi[k] = Math.max(hi[k]!, Math.fround(v));
  }));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length, uri: `data:application/octet-stream;base64,${Buffer.concat([pos, idx]).toString('base64')}` }],
  };
  return Buffer.from(JSON.stringify(doc));
}
