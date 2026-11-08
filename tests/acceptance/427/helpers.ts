// Test-side tools for the #427 acceptance tests: the base's `deep-show` (#393's hub: `run`, and `live`, #140's real,
// shown window with its `after` calls) and `deep-gpu` (#425's `simplify` job), each built once per file and driven by
// JSON lines; the evidence store read and seeded by its layout; the scene documents, generated glTF meshes and the
// calls the tests send (README: Assumed surfaces); and the judges the planted programs must fail, each returning its
// failures as sentences that name what failed. Nothing here stands in for a diagnostic mode, the live view, the hub or
// the simplify job.
//
// Safety: every folder is a fresh temp folder removed after its test, except docs/evidence/427/ that the taste test
// keeps; the agent's own CLAUDE_* and DEEP_* variables are removed from every child; each process a test starts ends on
// its own or by spawnSync's timeout, which signals only that child; no network.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs (README: Criteria to tests). */
export const AC = {
  1: '#427.eec6bc2e', 2: '#427.341d687d', 3: '#427.dff2871f', 4: '#427.43a16f33',
  5: '#427.6de2b260', 6: '#427.88bc74a6', 7: '#427.f8669ef0', 8: '#427.78a8171b',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judges

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${brief(v)}`).toBe('string');
  return v as string;
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
/** A vector of 3 numbers, or null when it isn't one. */
export const vec3 = (v: JsonValue | undefined): V3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as V3) : null;
export const fmt = (v: readonly number[] | null): string => (v ? `(${v.map((x) => +x.toFixed(7)).join(', ')})` : 'missing');
export const far = (a: readonly number[] | null, b: readonly number[], tol = 1e-6): boolean =>
  !a || a.length !== b.length || a.some((x, i) => Math.abs(x - b[i]!) > tol);
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const SHA = /^[0-9a-f]{64}$/;
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, one naming each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} must fail this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const n of names) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}
/** Fails the test as INCONCLUSIVE: never a pass, never a skip. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}`);
}
/** Every mode here draws on macOS's Metal device, the reference platform; elsewhere the run is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the 3D modes draw on macOS's Metal device; this machine is ${process.platform}, which proves nothing either way`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <name>` once per file, copied out of target/debug under its own name.

export type BinName = 'deep-show' | 'deep-gpu';
const childEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE') || k.startsWith('DEEP_') || k === 'AI_AGENT') delete env[k];
  return env;
};

export function useBuilds(names: readonly BinName[]): (name: BinName) => string {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-427-bins-'));
    for (const name of names) {
      const args = ['build', '--locked', '--bin', name];
      const r = spawnSync('cargo', args, { cwd: REPO, env: childEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const error = r.error ? `cargo could not run: ${r.error.message}` : r.status !== 0
        ? `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(0, 4000)}` : '';
      const bin = join(dir, name);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', name), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name) => {
    const e = made.get(name);
    if (!e) throw Error(`the file didn't list ${name} in useBuilds`);
    expect(e.error, `the binary builds: cargo build --locked --bin ${name}`).toBe('');
    return e.bin;
  };
}

/** A fresh folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-427-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One JSON line in, one line out, exit 0: the answer. */
function answer(bin: string, args: string[], input: JsonObject, timeoutMs: number): JsonObject {
  const r = spawnSync(bin, args, { cwd: REPO, env: childEnv(), input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const shown = `${bin.split('/').pop()} ${args.join(' ')}`;
  if (r.error) return expect.fail(`${shown}: ${r.error.message}`);
  expect(r.status, `${shown} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line`).toBe(1);
  return obj(JSON.parse(lines[0]!) as JsonValue, `${shown}: the answer`);
}

// ---------------------------------------------------------------------------------------------------
// deep-show: the hub's scenario (#393), `run` and `live` (#140)

export const SESSION = 'sess-427';
export const DOC = '01JB0427D00000000000000001';
export const PANEL = 'main';
export const SIZE: [number, number] = [480, 320];
/** #96's virtual display clock as #376's scenarios carry it: 60 Hz, latched at the vsync, a check taking no clock time. */
const CLOCK: JsonObject = { refresh_hz: 60, lead: 0, check: 0 };

/** The scenario: one test agent's session, its process tree, the main panel showing DOC, the evidence store. */
export function scenario(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-427', name: 'Test agent: diagnostic modes', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { [PANEL]: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: PANEL } },
    window: [SIZE[0], SIZE[1] + 40],
    clock: CLOCK,
    record: {},
    ...extra,
    calls,
  };
}

/** The agent's deep_show of a whole revision. */
export const show = (document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, document, t: '0s', size: SIZE, include: ['issues', 'pixels'] });
/** A deep_show in a diagnostic mode of DOC's current revision (README: Assumed surfaces 1): no document, so no revision. */
export const mode = (name: string, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, mode: name, t: '0s', size: SIZE, include: ['issues', 'pixels'], ...extra });

/** `deep-show run`: the replies, one per call; `planted` names a wrong program (README: Planted programs). */
export function runShow(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const a = answer(bin, ['run'], planted ? { ...sc, planted } : sc, 900_000);
  expect(a['ok'], `deep-show run refused the scenario: ${brief(a, 2000)}`).toBe(true);
  const replies = objs(a['replies'], 'deep-show run: replies');
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** One `after` entry of `deep-show live` (#140), with the fields this suite adds (README: Assumed surfaces 2). */
export interface After { showing: number; presented: number; wakeups: number; rung: string; reply: JsonObject }
/**
 * `deep-show live`: the scenario's calls, then the app's real, shown window over DOC; each of `after` runs `after_ms`
 * after the window's first presented frame, as a call into the hub the window shows. A machine with no display
 * answers `no_display`: INCONCLUSIVE.
 */
export function runLive(bin: string, sc: JsonObject, after: { after_ms: number; call: JsonObject }[], planted?: string): After[] {
  const holdMs = Math.max(...after.map((a) => a.after_ms)) + 1_000;
  const input: JsonObject = { ...sc, live: { after: after as unknown as JsonValue, hold_ms: holdMs }, ...(planted ? { planted } : {}) };
  const a = answer(bin, ['live'], input, 300_000);
  if (a['ok'] === false && (a['code'] === 'no_display' || a['code'] === 'unsupported_platform')) inconclusive(`deep-show live could not show a window here (${String(a['code'])}); the app's side needs a Mac with a display`);
  expect(a['ok'], `deep-show live answered ok: ${brief(a, 2000)}`).toBe(true);
  const entries = objs(obj(a['live'], 'deep-show live: live')['after'], 'live.after');
  expect(entries.length, 'live.after: one entry per after-call').toBe(after.length);
  return entries.map((e, i) => {
    const what = `live.after[${i}]`;
    const showing = obj(e['showing'], `${what}.showing`);
    return {
      showing: num(showing[DOC], `${what}.showing[doc]: the revision the window shows`),
      presented: num(e['presented'], `${what}.presented: frames of that revision presented so far`),
      wakeups: num(e['wakeups'], `${what}.wakeups: the window's frame callbacks so far`),
      rung: str(e['rung'], `${what}.rung: the live view's meter rung`),
      reply: obj(e['reply'], `${what}.reply`),
    };
  });
}

/** A mode reply that drew: presented, display only, one display-only snapshot by hash; its snapshot and rows. */
export function drew(reply: JsonObject, what: string): { sha: string; rows: JsonObject[]; rev: number } {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  expect(reply['display_only'], `${what}: a mode's reply is display only`).toBe(true);
  const snaps = objs(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBeGreaterThanOrEqual(1);
  const sha = str(snaps[0]!['sha256'], `${what}: the snapshot's sha256`);
  expect(sha, `${what}: the snapshot is named by its SHA-256`).toMatch(SHA);
  return { sha, rows: objs(reply['drawn'], `${what}: drawn`), rev: num(reply['rev'], `${what}: rev`) };
}
export const rowsOf = (rows: JsonObject[], id: string, what?: string): JsonObject[] =>
  rows.filter((r) => r['id'] === id && (what === undefined || r['what'] === what));

/**
 * Every `drawn` row of one mode call, following #412's cursor: a reply past 64 KB names `next`, and the same scenario
 * with the call at that cursor gives the following page (each page a fresh process: the scenario is deterministic).
 */
export function allDrawn(bin: string, evidence: string, setup: JsonObject[], call: JsonObject, extra: JsonObject = {}, planted?: string): JsonObject[] {
  const rows: JsonObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 64; page++) {
    const c: JsonObject = cursor === null ? call : { ...call, cursor };
    const replies = runShow(bin, scenario(evidence, [...setup, c], extra), planted);
    const reply = replies.at(-1)!;
    rows.push(...drew(reply, `${String(call['mode'])} (page ${page})`).rows);
    if (typeof reply['next'] !== 'string') return rows;
    cursor = reply['next'];
  }
  return expect.fail(`${String(call['mode'])}: more than 64 pages of readings`);
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#393's layout: `<first 2 hex>/<other 62 hex>`)

export function seed(root: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function evidenceBytes(root: string, h: string, what: string): Buffer {
  expect(h, `${what} is a SHA-256`).toMatch(SHA);
  const path = join(root, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what} ${h} is in the evidence store`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}'s file hashes to its name`).toBe(h);
  return bytes;
}

export interface Image { width: number; height: number; rgba: Uint8Array }
/** An 8-bit RGB or RGBA PNG, not interlaced. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG depth ${depth}, color type ${color}, interlace ${interlace}`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      if (pred === undefined) throw Error(`PNG filter ${f}`);
      line[i] = (line[i]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * ch]!; rgba[o + 1] = line[x * ch + 1]!; rgba[o + 2] = line[x * ch + 2]!; rgba[o + 3] = ch === 4 ? line[x * ch + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}

/** The clean look's saturated status colors (crates/deep-canvas-marks/looks/clean.json at the base). */
const STATUS: Record<string, [number, number, number]> = {
  pass: [0x00, 0x74, 0x29], fail: [0xbf, 0x23, 0x2b], invalid: [0x86, 0x45, 0xb0], running: [0x00, 0x63, 0xb8],
};
/** The status colors a picture draws: each one with any pixel within 2 per channel of it. */
export function statusColorsIn(image: Image): string[] {
  const found = new Set<string>();
  for (let i = 0; i < image.rgba.length; i += 4) {
    for (const [state, c] of Object.entries(STATUS)) {
      if (Math.abs(image.rgba[i]! - c[0]) <= 2 && Math.abs(image.rgba[i + 1]! - c[1]) <= 2 && Math.abs(image.rgba[i + 2]! - c[2]) <= 2) found.add(state);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------------------------------
// Documents: a 3D scene as an agent sends it (#378's form), its items keyed by ID.

export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const full: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) full[id] = { id, name: id, order: `a${String(k++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a test scene for the #427 diagnostic modes.`, size: SIZE,
    camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, items: full, ...extra,
  };
}
export const camera = (target: V3 = [0, 0, 0], distance = 9): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', target, orbit: { azimuth: 30, elevation: 25, distance }, fov: 40 } });
export const box = (pos: V3, size: V3 = [1, 1, 1]): JsonObject =>
  ({ kind: 'mark.box@1', params: { size, paint: { fill: { role: 'muted' } } }, at: { pos } });
export const sun = (): JsonObject => ({ kind: 'light.sun@1', params: { illuminance: 10_000, shadow: true }, at: { rot: [-50, 30, 0] } });
export const point = (pos: V3): JsonObject => ({ kind: 'light.point@1', params: { power: 400 }, at: { pos } });
export const meshAsset = (h: string, pos: V3 = [0, 0, 0]): JsonObject =>
  ({ kind: 'mesh.asset@1', params: { sha256: h, node: 0 }, at: { pos } });
/** A linear f32 channel on `target`, its keys as [seconds, value]. */
export function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'linear' }])) };
}

// ---------------------------------------------------------------------------------------------------
// glTF meshes, JSON with the buffer inline, one node, one triangle primitive

export interface Mesh { positions: V3[]; normals?: V3[]; uv0?: [number, number][]; indices: number[] }
export function gltf(m: Mesh): Buffer {
  const f32 = (rows: number[][]): Buffer => { const b = Buffer.alloc(rows.length * rows[0]!.length * 4); rows.flat().forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
  const parts: { bytes: Buffer; acc: JsonObject; name?: string }[] = [];
  const lo = [0, 1, 2].map((c) => Math.min(...m.positions.map((p) => Math.fround(p[c]!))));
  const hi = [0, 1, 2].map((c) => Math.max(...m.positions.map((p) => Math.fround(p[c]!))));
  parts.push({ bytes: f32(m.positions), acc: { componentType: 5126, count: m.positions.length, type: 'VEC3', min: lo, max: hi }, name: 'POSITION' });
  if (m.normals) parts.push({ bytes: f32(m.normals), acc: { componentType: 5126, count: m.normals.length, type: 'VEC3' }, name: 'NORMAL' });
  if (m.uv0) parts.push({ bytes: f32(m.uv0), acc: { componentType: 5126, count: m.uv0.length, type: 'VEC2' }, name: 'TEXCOORD_0' });
  const idx = Buffer.alloc(m.indices.length * 4); m.indices.forEach((v, i) => idx.writeUInt32LE(v, i * 4));
  parts.push({ bytes: idx, acc: { componentType: 5125, count: m.indices.length, type: 'SCALAR' } });
  let offset = 0;
  const views: JsonObject[] = []; const accessors: JsonObject[] = []; const attributes: JsonObject = {};
  parts.forEach((p, i) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.bytes.length }); offset += p.bytes.length;
    accessors.push({ bufferView: i, ...p.acc });
    if (p.name) attributes[p.name] = i;
  });
  const bin = Buffer.concat(parts.map((p) => p.bytes));
  return Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'mesh' }],
    meshes: [{ primitives: [{ attributes, indices: parts.length - 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
    bufferViews: views, accessors,
  }));
}

/** A plate in the XY plane facing +z, `w` × `h` m centered at the origin, split into `nx` × `ny` quads; uv0 in metres
 * from its lower-left corner (u along +x, v along +y); each quad two triangles [a, b, c] and [a, c, d], face 2q and 2q + 1. */
export function plate(w: number, h: number, nx: number, ny: number, lift: (i: number, j: number) => number = () => 0): Mesh {
  const positions: V3[] = []; const normals: V3[] = []; const uv0: [number, number][] = []; const indices: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = (i / nx) * w; const y = (j / ny) * h;
    positions.push([x - w / 2, y - h / 2, lift(i, j)]); normals.push([0, 0, 1]); uv0.push([x, y]);
  }
  const at = (i: number, j: number): number => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return { positions, normals, uv0, indices };
}

/** A capped UV sphere of `radius`: `segments` around, `rings` from pole to pole, poles single vertices; its triangle
 * count is 2 × segments × (rings − 1). */
export function uvSphere(radius: number, segments: number, rings: number): Mesh {
  const positions: V3[] = [[0, radius, 0]]; const indices: number[] = [];
  for (let j = 1; j < rings; j++) for (let i = 0; i < segments; i++) {
    const phi = (Math.PI * j) / rings; const th = (2 * Math.PI * i) / segments;
    positions.push([radius * Math.sin(phi) * Math.cos(th), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(th)]);
  }
  positions.push([0, -radius, 0]);
  const ring = (j: number, i: number): number => 1 + (j - 1) * segments + (i % segments);
  const south = positions.length - 1;
  for (let i = 0; i < segments; i++) indices.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < segments; i++) {
    indices.push(ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j, i), ring(j + 1, i + 1), ring(j + 1, i));
  }
  for (let i = 0; i < segments; i++) indices.push(south, ring(rings - 1, i), ring(rings - 1, i + 1));
  return { positions, normals: positions.map((p) => scale(p, 1 / radius)), indices };
}

/** A glTF's index list from an accessor, its buffer inline (the simplify job's output, #425). */
export function accessorU32(doc: JsonObject, accessor: number): number[] {
  const acc = obj(arr(doc['accessors'], 'accessors')[accessor], `accessor ${accessor}`);
  const view = obj(arr(doc['bufferViews'], 'bufferViews')[num(acc['bufferView'], 'bufferView')], 'bufferView');
  const buffer = obj(arr(doc['buffers'], 'buffers')[num(view['buffer'], 'buffer')], 'buffer');
  const bytes = Buffer.from(str(buffer['uri'], 'buffer uri').split(',')[1]!, 'base64');
  const start = typeof view['byteOffset'] === 'number' ? view['byteOffset'] : 0;
  return Array.from({ length: num(acc['count'], 'count') }, (_, i) => bytes.readUInt32LE(start + i * 4));
}

// ---------------------------------------------------------------------------------------------------
// The quiet rule (AC3 and AC7): a mode draws no status color, leaves the revision and the live view's frame count
// unchanged, and its snapshot cited by a claim is refused, naming it.

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;

/**
 * Three runs on `document`, each mode call as given: `deep-show run` draws each mode (its snapshot's pixels hold no
 * status color); `deep-show live` with the window showing the document draws each again (the window's revision, frames
 * presented, frame callbacks and meter rung the same after them as before, each reply at revision 1, the same snapshot
 * as the run's); `deep-show run` with a claim citing each snapshot as a requirement's evidence, then `verdict`: each
 * requirement's row is not PASS and names its snapshot with the code `display_only`.
 */
export function quietProblems(bin: (n: BinName) => string, evidence: string, document: JsonObject, calls: JsonObject[], extra: JsonObject = {}): string[] {
  const p: string[] = [];
  const name = (c: JsonObject): string => String(c['mode']);
  const first = runShow(bin('deep-show'), scenario(evidence, [show(document), ...calls], extra));
  const shas = calls.map((c, i) => {
    const d = drew(first[i + 1]!, `${name(c)} in deep-show run`);
    if (d.rev !== 1) p.push(`${name(c)}: the reply names rev ${d.rev}, not the document's revision 1`);
    const found = statusColorsIn(decodePng(evidenceBytes(evidence, d.sha, `${name(c)}'s snapshot`)));
    if (found.length) p.push(`${name(c)}: its snapshot ${d.sha} draws the status color${found.length > 1 ? 's' : ''} ${found.join(', ')}`);
    return d.sha;
  });

  const after = runLive(bin('deep-show'), scenario(evidence, [show(document)], extra), [
    { after_ms: 1_000, call: { call: 'presented', panel: PANEL } },
    ...calls.map((c, i) => ({ after_ms: 1_200 + 200 * i, call: c })),
    { after_ms: 1_400 + 200 * calls.length, call: { call: 'presented', panel: PANEL } },
  ]);
  const [before, ...rest] = after;
  const end = rest.at(-1)!;
  if (before!.showing !== 1 || before!.presented < 1) p.push(`the window wasn't showing revision 1 before the modes (showing ${before!.showing}, ${before!.presented} frames presented)`);
  if (end.showing !== before!.showing) p.push(`the document's revision went from ${before!.showing} to ${end.showing} across the modes`);
  if (end.presented !== before!.presented) p.push(`the live view drew ${end.presented - before!.presented} frames across the modes`);
  if (end.wakeups !== before!.wakeups) p.push(`the live view got ${end.wakeups - before!.wakeups} frame callbacks across the modes`);
  if (end.rung !== before!.rung) p.push(`the live view's meter moved from ${before!.rung} to ${end.rung} across the modes`);
  calls.forEach((c, i) => {
    const d = drew(rest[i]!.reply, `${name(c)} with the app showing`);
    if (d.rev !== 1) p.push(`${name(c)} with the app showing: the reply names rev ${d.rev}, not 1`);
    if (d.sha !== shas[i]) p.push(`${name(c)}: the snapshot with the app showing (${d.sha}) isn't the run's (${shas[i]})`);
  });

  const claim = `claim:${ulid('01JB0427C', 1)}`;
  const reqs = calls.map((_, i) => `req:${ulid('01JB0427Q', i + 1)}`);
  const claims: JsonObject = { [claim]: { session: SESSION, deliverables: [DOC], requirements: reqs.map((id, i) => ({ id, check: { kind: 'render.contrast', snapshot: shas[i]! } })) } };
  const cited = runShow(bin('deep-show'), scenario(evidence, [show(document), ...calls, { call: 'verdict', claim }], { ...extra, claims }));
  const rows = objs(obj(cited.at(-1), 'verdict')['requirements'], 'verdict: requirements');
  calls.forEach((c, i) => {
    const row = rows.find((r) => r['id'] === reqs[i]);
    const text = JSON.stringify(row ?? null);
    if (!row) p.push(`${name(c)}: the verdict has no row for the requirement citing its snapshot ${shas[i]}`);
    else if (row['result'] === 'PASS' || !text.includes('"display_only"') || !text.includes(shas[i]!)) p.push(`${name(c)}: a claim citing its snapshot ${shas[i]} as evidence wasn't refused naming it: ${text.slice(0, 600)}`);
  });
  return p;
}
