// Test-side tools for the #1637 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #424's object-ID
// target and #484's `cull_report` and `seeks`) built once per file and driven by JSON lines; the fields this suite adds
// (README: The surface under test); the city, its walk and its cut, generated here so every file draws the same
// scenes; #378's pinhole; the ID target's reader; the perf lane's judge. Nothing here stands in for the prepass, the
// pyramid, the cull or the draws under test. Parts are copied from #484's and #424's helpers, since suites don't import
// each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1637 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text (README). */
export const AC = { 1: '#1637.1a41b696', 2: '#1637.27a6396a', 3: '#1637.4c39d672', 4: '#1637.2d8df0a5', 5: '#1637.5eb3096a' } as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function objs(v: JsonValue | undefined, what: string): JsonObject[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return (v as JsonValue[]).map((x, i) => obj(x, `${what}[${i}]`));
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted twin's check: it found problems, and they name what the criterion says they name. */
export function failsNaming(problems: readonly string[], names: readonly (string | RegExp)[], what: string): void {
  expect(problems.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const n of names) {
    const hit = problems.some((p) => (typeof n === 'string' ? p.includes(n) : n.test(p)));
    expect(hit, `${what}: a failure names ${String(n)}; the failures were:\n  ${problems.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The machine, the build and folders

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
const EXE = 'deep-gpu';
const CARGO_ARGS = ['build', '--locked', '--bin', EXE];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1637-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', EXE), join(dir, EXE));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, EXE);
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1637-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'pyramid_from_previous_frame' | 'occlusion_by_centre' | 'occlusion_in_cascades' | 'occlusion_in_probe_captures';

/** One process: the calls in order, a reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${EXE} ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], `${name}: replies`);
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// Files the binary writes under `out` are named by their SHA-256 with their kind's extension (#378, #483).
export function namedFile(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what}: a file named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${hash!}.${ext}`));
  expect(sha256(b), `${what}: the file's SHA-256 is its name`).toBe(hash);
  return b;
}
export function u32File(out: string, hash: string | null, what: string): Uint32Array {
  const b = namedFile(out, hash, 'u32', what);
  return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace), as #424's helpers read it

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
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
  return { width, height, rgba, channels };
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378, #424's targets, #484's cull report and seeks), with this suite's fields (README: The surface under test).

export interface View3d {
  doc: string; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'ids')[]; timings?: boolean;
  /** #484's: each captured frame reports what each cull kept, per view and batch. */
  cull_report?: boolean;
  /** #484's: right after frame `after` draws, the same session jumps to frame `to`. */
  seeks?: { after: number; to: number }[];
  /** This suite's (the issue's `occlusion: off` on a view): the camera's passes cull by the frustum only. */
  occlusion?: 'off';
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });

/** A cull row (#484): an instancer's kept elements in one pass, one batch. */
export interface CullRow { item: string; view: string; batch: string; count: number; kept: string }
/** A pass's kept items (this suite's): the whole items the pass drew. */
export interface ItemRow { view: string; count: number; kept: string }
export interface Drawn {
  frame: number; hash: string | null; final: string | null; ids: string | null; picks: Map<number, string> | null;
  cull: CullRow[] | null; items: ItemRow[] | null;
  gpuMs: number | null; passesMs: Map<string, number> | null; declaredMs: Map<string, number> | null;
}
const optStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
const optNum = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
const numMap = (v: JsonValue | undefined, what: string): Map<string, number> | null =>
  (isObject(v) ? new Map(Object.entries(v).map(([k, x]) => [k, num(x, `${what}.${k}`)])) : null);
export function framesOf(reply: JsonObject, what: string): Drawn[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i): Drawn => {
    const at = `${what}: frames[${i}]`;
    return {
      frame: num(f['frame'], `${at}.frame`), hash: optStr(f['pixel_hash']), final: optStr(f['final']), ids: optStr(f['ids']),
      picks: isObject(f['picks']) ? new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)])) : null,
      cull: f['cull'] === undefined ? null : objs(f['cull'], `${at}.cull`).map((r, j) => ({
        item: str(r['item'], `${at}.cull[${j}].item`), view: str(r['view'], `${at}.cull[${j}].view`), batch: str(r['batch'], `${at}.cull[${j}].batch`),
        count: num(r['count'], `${at}.cull[${j}].count`), kept: str(r['kept'], `${at}.cull[${j}].kept`),
      })),
      items: f['kept_items'] === undefined ? null : objs(f['kept_items'], `${at}.kept_items`).map((r, j) => ({
        view: str(r['view'], `${at}.kept_items[${j}].view`), count: num(r['count'], `${at}.kept_items[${j}].count`), kept: str(r['kept'], `${at}.kept_items[${j}].kept`),
      })),
      gpuMs: optNum(f['gpu_ms']), passesMs: numMap(f['passes_ms'], `${at}.passes_ms`), declaredMs: numMap(f['declared_ms'], `${at}.declared_ms`),
    };
  });
}
/** The first drawn frame numbered `n`. */
export function frameAt(frames: Drawn[], n: number, what: string): Drawn {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

/**
 * What a pass kept, by name: each instancer element `<instancer>#<id>` from the frame's `cull` rows and each whole item
 * from its `kept_items` row, for one pass (`view`, `cascade<k>`, `probe:<item>`). Absent rows read as nothing kept.
 */
export function keptBy(out: string, f: Drawn, view: string, what: string): Set<string> {
  expect(f.cull, `${what}: frame ${f.frame} reports its instancers' culls (cull_report)`).not.toBeNull();
  expect(f.items, `${what}: frame ${f.frame} reports its passes' kept items (kept_items)`).not.toBeNull();
  const names = new Set<string>();
  for (const r of f.cull!.filter((x) => x.view === view)) {
    const ids = u32File(out, r.kept, `${what}: frame ${f.frame}, ${view}, ${r.item} batch ${r.batch}`);
    expect(ids.length, `${what}: frame ${f.frame}, ${view}, ${r.item} batch ${r.batch}: the file holds its count`).toBe(r.count);
    for (const id of ids) names.add(`${r.item}#${id}`);
  }
  for (const r of f.items!.filter((x) => x.view === view)) {
    const list = JSON.parse(namedFile(out, r.kept, 'json', `${what}: frame ${f.frame}, ${view}'s kept items`).toString('utf8')) as JsonValue;
    expect(Array.isArray(list) && list.length === r.count, `${what}: frame ${f.frame}, ${view}'s kept items are a list of ${r.count}`).toBe(true);
    for (const id of list as JsonValue[]) names.add(str(id, `${what}: frame ${f.frame}, ${view}'s kept item`));
  }
  return names;
}
/** The passes a frame reports a kept set for: views of its cull rows and of its kept-item rows. */
export const passesOf = (f: Drawn): string[] => [...new Set([...(f.cull ?? []).map((r) => r.view), ...(f.items ?? []).map((r) => r.view)])].sort();

/** The object-ID target (#378, #424): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: Drawn, what: string): Ids {
  const png = decodePng(namedFile(out, f.ids, 'png', `${what}: frame ${f.frame}'s object-ID target`));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: frame ${f.frame} names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array<string | null>(png.width * png.height);
  const count = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}

/**
 * The frame's check against the unculled frame (criteria 1 to 3): every element or item with a pixel in the unculled
 * frame's object-ID target is in the camera's kept set. Each sentence names the element and the frame.
 */
export function unkept(kept: Set<string>, ids: Ids, frame: number, what: string): string[] {
  const problems: string[] = [];
  for (const [name, px] of ids.count) if (!kept.has(name)) problems.push(`frame ${frame}: element ${name} has ${px} px in the unculled frame's object-ID target, but ${what} didn't keep it`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Documents

export type V3 = [number, number, number];
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` with tone map none at the exposure whose scale is 1 (#424's and #484's acceptance look). */
export const LOOK: JsonObject = {
  id: 'look-1637-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1637 acceptance look.',
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

/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it, in key order. */
export function sceneDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(6, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1637 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** Where world point `p` lands in the frame, px, and its view depth. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
/** mulberry32: a fixed-seed generator of u32 words. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// ---------------------------------------------------------------------------------------------------
// The city (every criterion)
//
// 200 × 100 blocks on a 32 m pitch: each block a 20 × 20 m building, one item `b<k>` (k = 200 j + i for block i along
// X and j along Z, 10 to 30 m tall), with 12 m streets between them (a 6 m road, a 3 m sidewalk each side). Streets
// along X run at z = 32 j (j = 0 to 100), streets along Z at x = 32 i (i = 0 to 200); block (i, j) spans x 32 i + 6 to
// 32 i + 26 and z 32 j + 6 to 32 j + 26. 100,000 street items in one instancer `street`, row r with ID r, of four
// prototypes (lamp, tree, bench, bin, so four batches), on the sidewalks 3.5 to 5.5 m from a street's centre line.
// The camera stands 1.7 m above the street, with a 60° field across 960 or 1920 px and its far plane at 3 km.

export const PITCH = 32;
export const STREET_ITEMS = 100_000;
export const EYE = 1.7;
export const FOV = 60;
export const FAR = 3000;
/** The walk's frame size for criteria 1 to 4, and the size criterion 5 times. */
export const SIZE: [number, number] = [960, 540];
export const HD: [number, number] = [1920, 1080];
/** The walk: along the street at z = 1,600 (j = 50), in its lane 1 m off the centre line, from mid-block, 1.4 m/s. */
export const WALK = { x0: 40 * PITCH + 16, z: 50 * PITCH + 1, speed: 1.4, ahead: 100 } as const;
/** Sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of 0 to 10 s (README: Readings). */
export const PLAY = { fps: 6, frames: 61 } as const;
/** The cut: on the street at z = 1,920 (j = 60), mid-block; facing the facade 7 m away, then, from 0.9 s, along the street. */
export const CUT = { x: 40 * PITCH + 16, z: 60 * PITCH + 1, at: 0.9, frame: 6, frames: 8 } as const;

/** Rows and items placed by hand (README: Fixtures). */
export const BIN = 31_416;
export const BENCH = 31_415;
export const REVEALED = 77_777;
export const KIOSK = 'kiosk';
export const STATUE = 'statue';
export const PROBE = 'probe';
const name = (r: number): string => `street#${r}`;
export const BIN_NAME = name(BIN);
export const BENCH_NAME = name(BENCH);
export const REVEALED_NAME = name(REVEALED);

/** The camera of the walk at time t, s. */
export const walkCam = (t: number, size: [number, number] = SIZE): Pinhole => {
  const x = WALK.x0 + WALK.speed * t;
  return { position: [x, EYE, WALK.z], target: [x + WALK.ahead, EYE, WALK.z], fov: FOV, size };
};
/** The cut's camera after the cut. */
export const cutCam = (size: [number, number] = SIZE): Pinhole => ({ position: [CUT.x, EYE, CUT.z], target: [CUT.x + 100, EYE, CUT.z], fov: FOV, size });

/** The bench's bounds: 1.8 m along Z, 0.5 m along X, 0.45 m tall, centred 10 m ahead of the walk's start and 2 m right. */
export const BENCH_BOX = { centre: [WALK.x0 + 10, 0.225, WALK.z + 2] as V3, half: [0.25, 0.225, 0.9] as V3 };
/** The bin: a lathe 1.02 m tall, at most 0.27 m in radius, 6 m ahead and 1.2 m right, on the line from the eye to the bench's centre. */
export const BIN_AT: V3 = [WALK.x0 + 6, 0, WALK.z + 1.2];
/** The kiosk (an item): 0.5 m along X, 2.5 m tall, 1.6 m along Z, 8 m ahead and 3 m left of the walk's start. */
export const KIOSK_BOX = { centre: [WALK.x0 + 8, 1.25, WALK.z - 3] as V3, half: [0.25, 1.25, 0.8] as V3 };
/** The statue (an item): 0.6 × 2.4 × 0.6 m, 12 m ahead and 4.5 m left, behind the kiosk from the walk's first frame. */
export const STATUE_BOX = { centre: [WALK.x0 + 12, 1.2, WALK.z - 4.5] as V3, half: [0.3, 1.2, 0.3] as V3 };
/** The revealed lamp: 25 m ahead and 3.5 m right of the cut's camera, on the sidewalk. */
export const REVEALED_AT: V3 = [CUT.x + 25, 0, CUT.z + 3.5];
/** The sun of criterion 4: 20° up, straight down the street ahead (`toward` is +X), so light runs back along −X. */
export const SUN_ROT: V3 = [-20, 90, 0];

/** Street items stay out of these, so the hand-placed ones stand clear (x0, x1, z0, z1). */
const CLEAR: [number, number, number, number][] = [
  [WALK.x0 - 10, WALK.x0 + 60, 50 * PITCH - 6, 50 * PITCH + 6],
  [CUT.x - 10, CUT.x + 60, 60 * PITCH - 6, 60 * PITCH + 6],
];

const LAMP = [[0.08, 0, false], [0.08, 3.8, false], [0.35, 3.9, true], [0.3, 4.1, true], [0.05, 4.2, false]];
const TREE = [[0.15, 0, false], [0.15, 2, false], [1.2, 2.5, true], [1.5, 3.5, true], [1, 4.8, true], [0.05, 5.5, false]];
const BIN_OUTLINE = [[0.22, 0, false], [0.25, 0.95, false], [0.27, 1, false], [0.05, 1.02, false]];
/** Prototype indices in `of`. */
const P = { lamp: 0, tree: 1, bench: 2, bin: 3 } as const;

export interface StreetRow { proto: number; pos: V3; yaw: number; scale: number }
let rowsMade: StreetRow[] | null = null;
/** The 100,000 street items, deterministic (seed 1637). */
export function streetRows(): StreetRow[] {
  if (rowsMade) return rowsMade;
  const r = rng(1637);
  const u = (): number => r() / 4294967296;
  const round = (x: number): number => Math.round(x * 1000) / 1000;
  const rows: StreetRow[] = [];
  while (rows.length < STREET_ITEMS) {
    const alongX = u() < 0.5;
    const line = alongX ? Math.floor(u() * 101) * PITCH : Math.floor(u() * 201) * PITCH;
    const along = alongX ? u() * 200 * PITCH : u() * 100 * PITCH;
    const off = (u() < 0.5 ? -1 : 1) * (3.5 + 2 * u());
    const k = u();
    const proto = k < 0.35 ? P.lamp : k < 0.6 ? P.tree : k < 0.8 ? P.bench : P.bin;
    const x = round(alongX ? along : line + off); const z = round(alongX ? line + off : along);
    const s = round(0.9 + 0.2 * u());
    if (CLEAR.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
    rows.push({ proto, pos: [x, proto === P.bench ? round(0.225 * s) : 0, z], yaw: alongX ? 0 : 90, scale: s });
  }
  rows[BIN] = { proto: P.bin, pos: BIN_AT, yaw: 0, scale: 1 };
  rows[BENCH] = { proto: P.bench, pos: BENCH_BOX.centre, yaw: 90, scale: 1 };
  rows[REVEALED] = { proto: P.lamp, pos: REVEALED_AT, yaw: 0, scale: 1 };
  rowsMade = rows;
  return rows;
}

export interface Building { id: string; centre: V3; size: V3 }
let buildingsMade: Building[] | null = null;
/** The 20,000 buildings (seed 1638). */
export function buildings(): Building[] {
  if (buildingsMade) return buildingsMade;
  const r = rng(1638);
  const out: Building[] = [];
  for (let j = 0; j < 100; j++) for (let i = 0; i < 200; i++) {
    const h = Math.round(100 + 200 * (r() / 4294967296)) / 10;
    out.push({ id: `b${String(j * 200 + i).padStart(5, '0')}`, centre: [i * PITCH + 16, h / 2, j * PITCH + 16], size: [20, h, 20] });
  }
  buildingsMade = out;
  return out;
}

const key = (t: number, value: number, interp: 'linear' | 'hold'): JsonObject => ({ t: `${t}s`, value, interp });
/** The walk's camera channels: position and target move together along +X, linear from 0 to 10 s. */
function walkChannels(): JsonObject {
  const at = (axis: 'position' | 'target', x: number): JsonObject =>
    ({ target: `items/cam/params/${axis}/0`, type: 'f32', keys: { k0: key(0, x, 'linear'), k1: key(10, x + WALK.speed * 10, 'linear') } });
  return { cam_x: at('position', WALK.x0), aim_x: at('target', WALK.x0 + WALK.ahead) };
}
/** The cut's: the camera stands still; its target holds on the facade until 0.9 s, then holds down the street. */
function cutChannels(): JsonObject {
  const hold = (path: string, before: number, after: number): JsonObject =>
    ({ target: path, type: 'f32', keys: { k0: key(0, before, 'hold'), k1: key(CUT.at, after, 'hold') } });
  return { aim_x: hold('items/cam/params/target/0', CUT.x, CUT.x + 100), aim_z: hold('items/cam/params/target/2', CUT.z - 10, CUT.z) };
}

export interface CityOptions {
  /** The camera: the walk (criteria 1 to 3 and 5) or the cut (criterion 2). */
  camera: 'walk' | 'cut';
  /** Criterion 4's sun casts 4 cascades; the walk's sun casts none (README: Readings). */
  shadows: boolean;
  /** Criterion 4's twin without the statue. */
  statue?: boolean;
  /** The frame size the document declares, SIZE unless given (criterion 5 draws at HD). */
  size?: [number, number];
}
/** The city as a document, with the camera and sun asked for. */
export function cityDoc(o: CityOptions): JsonObject {
  const rows = streetRows();
  const start = o.camera === 'walk' ? walkCam(0) : { ...cutCam(), target: [CUT.x, EYE, CUT.z - 10] as V3 };
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: start.position, target: start.target, fov: FOV, near: 0.1, far: FAR } },
    sky: { kind: 'sky@1', params: { top: [0.35, 0.5, 0.75, 1], low: [0.75, 0.82, 0.9, 1], ambient_top: [0.25, 0.3, 0.35], ambient_low: [0.1, 0.1, 0.1] } },
    key: {
      kind: 'light.sun@1', at: { rot: SUN_ROT },
      params: o.shadows ? { illuminance: Math.PI, color: [1, 1, 1], shadow: true, cascades: 4, split: 0.7, shadow_far: 300, fade: true } : { illuminance: Math.PI, color: [1, 1, 1], shadow: false },
    },
    ground_mat: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.95 }),
    wall0: material({ base_color: [0.62, 0.55, 0.48, 1], roughness: 0.9 }),
    wall1: material({ base_color: [0.5, 0.52, 0.56, 1], roughness: 0.9 }),
    wall2: material({ base_color: [0.7, 0.66, 0.6, 1], roughness: 0.9 }),
    lamp_mat: material({ base_color: [0.2, 0.2, 0.22, 1], metallic: 1, roughness: 0.4 }),
    tree_mat: material({ base_color: [0.12, 0.35, 0.12, 1], roughness: 0.85 }),
    bench_mat: material({ base_color: [0.45, 0.3, 0.15, 1], roughness: 0.8 }),
    bin_mat: material({ base_color: [0.1, 0.25, 0.15, 1], roughness: 0.6 }),
    kiosk_mat: material({ base_color: [0.6, 0.15, 0.1, 1], roughness: 0.7 }),
    statue_mat: material({ base_color: [0.8, 0.8, 0.78, 1], roughness: 0.5 }),
    ground: box([6420, 1, 3220], [3200, -0.5, 1600], { material: 'ground_mat' }),
    lamp: { kind: 'lathe@1', params: { outline: LAMP, segments: 48 }, material: 'lamp_mat', visible: false },
    tree: { kind: 'lathe@1', params: { outline: TREE, segments: 64 }, material: 'tree_mat', visible: false },
    bench: box([1.8, 0.45, 0.5], [0, 0, 0], { material: 'bench_mat', visible: false }),
    bin: { kind: 'lathe@1', params: { outline: BIN_OUTLINE, segments: 32 }, material: 'bin_mat', visible: false },
    street: {
      kind: 'instance@1',
      params: {
        of: ['lamp', 'tree', 'bench', 'bin'], ids: rows.map((_, i) => i), proto: rows.map((x) => x.proto),
        pos: rows.map((x) => x.pos), yaw: rows.map((x) => x.yaw), scale: rows.map((x) => x.scale),
      },
    },
    [KIOSK]: box([0.5, 2.5, 1.6], KIOSK_BOX.centre, { material: 'kiosk_mat' }),
    [PROBE]: { kind: 'light.probe@1', params: { type: 'reflection', size: [4, 3, 4] }, at: { pos: [WALK.x0 + 12, 1.5, WALK.z - 1] } },
  };
  if (o.statue !== false) items[STATUE] = box([0.6, 2.4, 0.6], STATUE_BOX.centre, { material: 'statue_mat' });
  buildings().forEach((b, k) => { items[b.id] = box(b.size, b.centre, { material: `wall${k % 3}` }); });
  const tag = `${o.camera}${o.shadows ? '-shadows' : ''}${o.statue === false ? '-no-statue' : ''}`;
  return sceneDoc(`city-1637-${tag}`, o.size ?? SIZE, items, { channels: o.camera === 'walk' ? walkChannels() : cutChannels() });
}

// ---------------------------------------------------------------------------------------------------
// Budgets: five runs after warm-up, judged by the perf lane's own judgeLimit in scripts/benchmark.mjs (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end); anywhere else
// INCONCLUSIVE, never PASS.

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** The nearest-rank p95. */
export function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]!;
}
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
