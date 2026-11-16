// Test-side tools for the #1729 acceptance tests: the base's `deep-show` (`deep-show run`, #393's hub stand-in) and
// `deep-gpu` (#377's GPU layer: `view3d` and `live`), built once per file and driven by one JSON line each; the
// evidence store seeded by its layout (`<first 2 hex>/<other 62 hex>`); the three sample models in `fixtures/`,
// checked by SHA-256; the small files the tests make (a PNG, Radiance HDRs, a JSON glTF); scene documents in the two
// forms the two binaries take (an agent's payload for deep_show and live, a session document for view3d); and readers
// of what they write (PNGs, the object-ID target). Copied in part from #1401's, #423's and #424's helpers, since
// suites don't import each other. Nothing here stands in for the render-back or the GPU layer under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1729 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed (README). */
export const AC = {
  1: 'AC1 #1729.f59f9cb0',
  2: 'AC2 #1729.797f90d5',
  3: 'AC3 #1729.1248be9e',
  4: 'AC4 #1729.6e5d2b27',
  5: 'AC5 #1729.612df1ca',
  6: 'AC6 #1729.3e434fdf',
  7: 'AC7 #1729.50fb770a',
  8: 'AC8 #1729.beae915f',
} as const;

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
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1200) ?? 'undefined';
/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Render-back of a 3D revision and the GPU layer draw on macOS's Metal device (#378). */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`render-back of a 3D revision and the GPU layer draw on macOS's Metal device; this is ${process.platform}`);
}
/** A reply this machine's GPU couldn't draw is INCONCLUSIVE, never a pass. */
function drawable(reply: JsonObject, what: string): void {
  if (/unsupported_platform|gpu_unavailable|no_device/.test(JSON.stringify(reply))) inconclusive(`${what}: this machine could not draw it (${shown(reply).slice(0, 300)})`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-show and deep-gpu built once per file by one cargo call, and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export interface Bins { show: () => string; gpu: () => string }
/** Builds both binaries before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(): Bins {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1729-bin-'));
    error = cargoBuild();
    if (error === '') for (const b of ['deep-show', 'deep-gpu']) copyFileSync(join(targetDir(), 'debug', exe(b)), join(dir, exe(b)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const bin = (name: string) => (): string => {
    expect(error, `the binaries build: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe(name));
  };
  return { show: bin('deep-show'), gpu: bin('deep-gpu') };
}
/** A fresh temporary folder per test (the evidence store, documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1729-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** A new folder under `root`. */
export function sub(root: string, name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (Asset: one checked read by a 64-hex name) and the files the tests put in it.

/** Puts `bytes` into the evidence store at `root` by its layout; returns its SHA-256. */
export function seed(root: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A file in the evidence store at `root`, read by its hash and checked against it. */
export function stored(root: string, h: string, what: string): Buffer {
  expect(h, `${what} is named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const bytes = readFileSync(join(root, h.slice(0, 2), h.slice(2)));
  expect(sha256(bytes), `${what} hashes to its name`).toBe(h);
  return bytes;
}
/** `bytes` written under `dir` by their hash, as view3d's and live's `assets` name a file: `{sha: path}`. */
export function file(dir: string, bytes: Buffer): { sha: string; path: string } {
  const sha = sha256(bytes);
  const path = join(dir, sha);
  writeFileSync(path, bytes);
  return { sha, path };
}
/** A SHA-256 no file in any store has: the hash of a text no test writes anywhere. */
export const ABSENT = sha256('#1729: the bytes no store holds');

// ---------------------------------------------------------------------------------------------------
// The three sample models (README: Fixtures), each pinned by SHA-256.

export type Model = 'Box' | 'Duck' | 'BoxTextured';
const PINS: Record<Model, string> = {
  Box: 'ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e',
  Duck: '65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5',
  BoxTextured: 'b510eca2e2ef33f62f9ed57d6e7ce2d10ebb2bdebc4a8e59d347719ba81abdf4',
};
/** A sample model's `.glb`, checked against its pin. */
export function model(name: Model): Buffer {
  const bytes = readFileSync(join(HERE, 'fixtures', `${name}.glb`));
  expect(sha256(bytes), `fixtures/${name}.glb has its pinned SHA-256`).toBe(PINS[name]);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// Files the tests make.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG of `w × h` texels all `rgba`, with no gamma, sRGB or ICC chunk. */
export function png(w: number, h: number, rgba: readonly [number, number, number, number]): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** The issue's red 64 px PNG: 64 × 64 texels of (255, 0, 0, 255). */
export const RED_PNG = (): Buffer => png(64, 64, [255, 0, 0, 255]);

/**
 * A flat (not run-length encoded) Radiance HDR of `w × h` pixels all one RGBE value, `-Y h +X w`. (128, 128, 128, 129)
 * is linear radiance 1 in every channel (128 × 2^(129 − 136)); (0, 0, 0, 0) is black.
 */
export function hdr(w: number, h: number, rgbe: readonly [number, number, number, number]): Buffer {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const body = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) Buffer.from(rgbe).copy(body, i * 4);
  return Buffer.concat([head, body]);
}
/** The lit environment and its all-black twin of the same size (AC4). */
export const HDR_W = 64;
export const HDR_H = 32;
export const WHITE_HDR = (): Buffer => hdr(HDR_W, HDR_H, [128, 128, 128, 129]);
export const BLACK_HDR = (): Buffer => hdr(HDR_W, HDR_H, [0, 0, 0, 0]);

/** A JSON glTF of an axis-aligned box of `size` m centred on the origin (one node, one mesh, u32 indices), as bytes. */
export function boxGltf(size: V3): Buffer {
  const h = size.map((s) => s / 2);
  const p: V3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x * h[0]!, y * h[1]!, z * h[2]!]);
  // Corners by index bits (x: 4, y: 2, z: 1); two triangles a face, wound outward.
  const tris = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]];
  const pos = Buffer.alloc(p.length * 12); const idx = Buffer.alloc(tris.length * 12);
  p.forEach((v, i) => v.forEach((c, k) => pos.writeFloatLE(c, i * 12 + k * 4)));
  tris.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: p.length, type: 'VEC3', min: h.map((v) => -v), max: h },
      { bufferView: 1, componentType: 5125, count: tris.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length, uri: `data:application/octet-stream;base64,${Buffer.concat([pos, idx]).toString('base64')}` }],
  };
  return Buffer.from(JSON.stringify(doc));
}

// ---------------------------------------------------------------------------------------------------
// Scene documents. One set of items, in two forms: the agent's payload (deep_show and live: no `id`, no `layers`, as
// #421's and #429's suites send it) and a session document (view3d: an `id`, one writer layer, every item in it, as
// #378's and #423's suites send it). Displayed text holds no number and no number word (the base's honest-numbers
// rule), so a fixture fails only on what this issue is about.

/** The frame every render here is drawn at, px; the documents' own size too. */
export const SIZE: [number, number] = [320, 240];
export const WRITER = 'agent:alpha';
export const OTHER_WRITER = 'agent:bravo';

/** A perspective camera@1: position, target, `fov` degrees across the wider side. */
export const camera = (position: V3, target: V3, fov = 40): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov } });
/** The models' camera: 5.5 m in front of a point above the origin, so a unit box and the Duck are whole in frame. */
export const MODEL_CAMERA = camera([0.1, 0.6, 5.5], [0.1, 0.6, 0]);
/** A grey sky with grey ambient light, and a sun from above and in front (Sky `sky@1`; Light). */
export const GREY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.3, 0.3, 0.3, 1], low: [0.3, 0.3, 0.3, 1], ambient_top: [0.4, 0.4, 0.4], ambient_low: [0.2, 0.2, 0.2] } };
export const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1] }, at: { rot: [-40, 25, 0] } };
/** A glTF file's whole scene placed as one item, drawn with the file's own materials (Asset: meshes; #423). */
export const sceneAsset = (sha: string): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node: { scene: 0 } }, at: { pos: [0, 0, 0] } });
/** A `material@1`. */
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A license an asset entry carries (Asset: `license`). */
export const CC_BY = (credit: string): JsonObject => ({ id: 'CC-BY-4.0', terms: 'https://creativecommons.org/licenses/by/4.0/legalcode', shareable: true, credit });
export const LICENSES: Record<Model | 'made', JsonObject> = {
  Box: CC_BY('Box: © Cesium, CC BY 4.0'),
  BoxTextured: CC_BY('Box Textured: © Cesium, CC BY 4.0'),
  Duck: { id: 'LicenseRef-SCEA-Shared-Source-1.0', terms: 'SCEA Shared Source License, Version 1.0', shareable: true, credit: 'Duck: © Sony' },
  made: { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', shareable: true, credit: 'Made by this suite' },
};
/** An asset entry of the document's `assets`, as #499's probing names one: its hash, kind and license. */
export const assetEntry = (sha: string, kind: 'mesh' | 'image', license: JsonObject = LICENSES.made): JsonObject => ({ sha256: sha, kind, license });

/** A scene: its items in order, its `assets`, and the kind minors it requires (`requires.kinds`, Document envelope). */
export interface Scene { title: string; items: Record<string, JsonObject>; assets?: Record<string, JsonObject>; kinds?: string[] }
function ordered(items: Record<string, JsonObject>, layer: string | null): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(3, '0')}`, ...(layer ? { layer } : {}), ...item };
  return out;
}
function envelope(s: Scene): JsonObject {
  return {
    format: 1, profile: 'scene', title: s.title, description: `${s.title}: an acceptance fixture for render-back reading the evidence store.`,
    size: SIZE, camera: 'cam', transport: { span: '2s' }, requires: { modules: { scene3d: '^1' }, ...(s.kinds ? { kinds: s.kinds } : {}) },
    ...(s.assets ? { assets: s.assets } : {}),
  };
}
/** The agent's payload: what deep_show and a live session take. */
export const payload = (s: Scene): JsonObject => ({ ...envelope(s), items: ordered(s.items, null) });
/** A session document: what view3d takes. */
export const sessionDoc = (id: string, s: Scene): JsonObject =>
  ({ ...envelope(s), id, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items: ordered(s.items, 'main') });
/** `value` as JSON under `dir`; its path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393): one scenario line in, one answer line out.

/** The agent's session and its process (#393). */
export const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Test agent: models', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** A document ID the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1729D0${String(n).padStart(16, '0')}`;
/** The wrong program this suite names (README: Planted program), reachable only through the scenario's `planted`. */
export type Planted = 'skips_missing_mesh_asset';

/** A scenario: the agent's session, each document in a visible panel of its own, then `calls`. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const panels: JsonObject = {};
  const map: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, SIZE[0], SIZE[1]] }; map[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: map, calls, ...(planted ? { planted } : {}) };
}
/** `deep-show run`: one scenario, answered ok with one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const label = `deep-show run (${what}${sc['planted'] ? `, planted ${String(sc['planted'])}` : ''})`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label}: deep-show run answers the scenario ok; got ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  replies.forEach((r, i) => drawable(r, `${label}: replies[${i}]`));
  return replies;
}
/** The agent's deep_show of a whole document, rendered back with its pixels at t = 0 (Render-back). */
export const showCall = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues', 'pixels'], size: SIZE });
/** A render-back of `doc` as of revision `rev` at t = 0, at SIZE (#384). */
export const renderBackCall = (doc: string, rev: number): JsonObject =>
  ({ call: 'render_back', session: SESSION, doc, t: 0, rev, size: SIZE });

/** A presented reply: its first snapshot's hash, read from the store and checked. */
export function snapshotOf(reply: JsonObject, evidence: string, what: string): { sha: string; png: Buffer } {
  expect(reply['outcome'], `${what} is presented: ${shown(reply)}`).toBe('presented');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what} carries a snapshot`).toBeGreaterThan(0);
  const sha = String(obj(snaps[0], `${what}: snapshots[0]`)['sha256']);
  return { sha, png: stored(evidence, sha, `${what}'s snapshot`) };
}
/** A presented deep_show reply's error issues, which the fixture documents must not have. */
export const errorIssues = (reply: JsonObject): JsonObject[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['severity'] === 'error');

export interface Row { id: string; box: [number, number, number, number] }
/** A presented reply's `visible` table: `{id, box: [x, y, w, h]}` in px (Render-back). */
export function visibleRows(reply: JsonObject, what: string): Row[] {
  return arr(reply['visible'], `${what}: visible`).map((r, i) => {
    const o = obj(r, `${what}: visible[${i}]`);
    const b = arr(o['box'], `${what}: visible[${i}].box`);
    expect(b.length === 4 && b.every((v) => typeof v === 'number'), `${what}: visible[${i}].box is [x, y, w, h]: ${shown(o)}`).toBe(true);
    return { id: String(o['id']), box: b as number[] as Row['box'] };
  });
}
/** The rows of an item or its parts (`<item>` or `<item>#<part>`). */
export const rowsOf = (rows: Row[], item: string): Row[] => rows.filter((r) => r.id === item || r.id.startsWith(`${item}#`));
/** The union of boxes `[x, y, w, h]` as edges `[x0, y0, x1, y1]`. */
export function union(boxes: Row['box'][]): [number, number, number, number] {
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[0] + b[2])), Math.max(...boxes.map((b) => b[1] + b[3]))];
}

/**
 * Where a reply says `code` at `path`: its own refusal (`{code, path}`, or deep-gpu's `{code, reason}` naming the path)
 * or an entry of its `issues` with that code and path. `at` matches the path exactly, or, given a prefix ending in
 * `/`, the path itself without it or anything under it ("at the item").
 */
export function carries(reply: JsonObject, code: string, at: string): boolean {
  const matches = (p: JsonValue | undefined): boolean =>
    typeof p === 'string' && (at.endsWith('/') ? p === at.slice(0, -1) || p.startsWith(at) : p === at || p.split(/[\s:,;()]+/).includes(at));
  const one = (o: JsonValue | undefined): boolean => isObject(o) && o['code'] === code && (matches(o['path']) || matches(o['reason']));
  return one(reply) || (Array.isArray(reply['issues']) && reply['issues'].some(one));
}
/**
 * The failure, naming `item`, of a reply that must carry `code` at `path`: one that carries it is never clean, since
 * the issue is in the reply itself; one that doesn't, presented (deep_show's `outcome`) or drawn (view3d's `frames`),
 * presents the frame as clean.
 */
export function refusalFailures(reply: JsonObject, code: string, path: string, item: string, what: string): string[] {
  if (carries(reply, code, path)) return [];
  const drawn = reply['outcome'] === 'presented' || Array.isArray(reply['frames']);
  const at = path.endsWith('/') ? `the item (${path.slice(0, -1)} or under it)` : path;
  return [`${what}: the reply carries no ${code} at ${at}${drawn ? `, and presents the frame as clean without ${item}` : ''}: ${shown(reply)}`];
}

// ---------------------------------------------------------------------------------------------------
// deep-gpu run (#377): `{out, calls}` in, `{ok, replies}` out.

export function runGpu(bin: string, out: string, calls: JsonObject[], what: string): JsonObject[] {
  const label = `deep-gpu run (${what})`;
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label} answers ok: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  replies.forEach((r, i) => drawable(r, `${label}: replies[${i}]`));
  return replies;
}

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #423's acceptance look: a physical basis, tone map none at the exposure whose scale is 1, no ground grid. */
export const LOOK: JsonObject = {
  id: 'look-render-back', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'An acceptance look for render-back reading the evidence store.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** view3d of a session document at SIZE, frame 0 captured with `targets`, its files named by hash in `assets` (#378, #423). */
export const view3dCall = (doc: string, assets: Record<string, string>, targets: ('final' | 'ids')[]): JsonObject =>
  ({ call: 'view3d', doc, look: LOOK, size: SIZE, frames: 1, capture: [0], targets, assets });
export interface Frame { final: string | null; ids: string | null; picks: Map<number, string> | null }
/** Frame 0 of a view3d reply that drew. */
export function frame0(reply: JsonObject, what: string): Frame {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  const s = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
  const picks = isObject(f!['picks']) ? new Map(Object.entries(f!['picks']).map(([k, id]) => [Number(k), String(id)])) : null;
  return { final: s(f!['final']), ids: s(f!['ids']), picks };
}
/** A file deep-gpu wrote under `out`, named by its SHA-256 and `ext`. */
export function written(out: string, h: string | null, ext: string, what: string): Buffer {
  expect(h, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const bytes = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(bytes), `${what}'s file hashes to its name`).toBe(h);
  return bytes;
}
/** The object-ID target's box of an item or its parts (`<item>` or `<item>#<part>`), as edges `[x0, y0, x1, y1]` in
 * px (x1, y1 one past the last pixel), or null where none of it drew (#378: pick ID r + 2^8 g + 2^16 b + 2^24 a). */
export function idsBox(out: string, f: Frame, item: string, what: string): [number, number, number, number] | null {
  const im = decodePng(written(out, f.ids, 'png', `${what}: the object-ID target`));
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  let box: [number, number, number, number] | null = null;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const o = (y * im.width + x) * 4;
    const pick = (im.rgba[o]! + im.rgba[o + 1]! * 256 + im.rgba[o + 2]! * 65_536 + im.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? null;
    if (id === null || !(id === item || id.startsWith(`${item}#`))) continue;
    box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)] : [x, y, x + 1, y + 1];
  }
  return box;
}

/** A live call (#379) of `frames` frames at 60 fps, its sessions opening at frame 1, with canonical events. */
export const liveCall = (frames: number, sessions: JsonObject[], events: JsonObject[], assets: Record<string, string>): JsonObject =>
  ({ call: 'live', look: LOOK, fps: 60, frames, sessions, events, assets });
/** A live reply's canonical render of `session`, purpose `render_back`: its pixel hash. */
export function canonicalHash(reply: JsonObject, session: string, what: string): string {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const list = arr(reply['canonicals'], `${what}: canonicals`).map((c, i) => obj(c, `${what}: canonicals[${i}]`));
  const c = list.find((x) => x['session'] === session && x['purpose'] === 'render_back');
  expect(c, `${what}: a canonical render_back of ${session}: ${shown(list as JsonValue)}`).toBeDefined();
  expect(c!['code'], `${what}: the canonical render of ${session} was made, not refused: ${shown(c)}`).toBeUndefined();
  expect(c!['pixel_hash'], `${what}: the canonical render of ${session} has a pixel hash: ${shown(c)}`).toMatch(/^[0-9a-f]+$/);
  return String(c!['pixel_hash']);
}

// ---------------------------------------------------------------------------------------------------
// PNG reading (8-bit RGB or RGBA, no interlace).

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(bytes: Buffer): Image {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < bytes.length) {
    const len = bytes.readUInt32BE(at); const type = bytes.toString('latin1', at + 4, at + 8); const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
/** The mean of each of red, green and blue over a rectangle `[x0, y0, x1, y1)` of an image, each 0 to 1. */
export function meanRgb(im: Image, r: [number, number, number, number]): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0]; let n = 0;
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
    const o = (y * im.width + x) * 4;
    sum[0] += im.rgba[o]! / 255; sum[1] += im.rgba[o + 1]! / 255; sum[2] += im.rgba[o + 2]! / 255;
    n++;
  }
  return sum.map((s) => s / Math.max(n, 1)) as [number, number, number];
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1729 ${label}: ${JSON.stringify(value)}`);
}
