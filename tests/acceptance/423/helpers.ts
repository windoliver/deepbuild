// Test-side tools for the #423 acceptance tests: the `deep-gpu` binary the base already has (#377's GPU layer, with
// #378's `view3d` and #421's renderer), built once per file and driven by JSON lines; the calls and fields this suite
// adds (README: Assumed surfaces); the Khronos sample models, pinned by commit and SHA-256, fetched into an ignored
// cache on first use and never committed; the files the tests make (PNG maps, UASTC KTX2 maps); a reader of the
// glTF files' own JSON, which the import is held to; and the reviewed CPU references the criteria are held to (the
// pinhole and orthographic projections, a footprint filter). Copied where #421's helpers have the same tool, since
// suites don't import each other. Nothing here stands in for the importer, the decode worker or the renderer.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/423 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #423.1611056a',
  2: 'AC2 #423.5a4d9d3b',
  3: 'AC3 #423.57db7d87',
  4: 'AC4 #423.4c6dcf97',
  5: 'AC5 #423.4457ae69',
  6: 'AC6 #423.0f7c0f26',
  7: 'AC7 #423.35374578',
} as const;

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** Writes `bytes` under `dir` and returns their SHA-256 and the file's path. */
export function writeAsset(dir: string, name: string, bytes: Buffer): { sha: string; path: string } {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return { sha: sha256(bytes), path };
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose inputs can't be had here (the network for a first fetch) fails with this, never passes. */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}; to unblock: ${unblock}`);
}
/** The reference Macs (technical design: The reference Macs), as #386's and #421's suites list them. */
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** AC6 holds "on the reference Mac": off one, INCONCLUSIVE. Power and load are not gated. */
export function requireReferenceMac(): void {
  requireMetal();
  let model: string | null = null;
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { model = null; }
  if (!model || !REFERENCE_MACS.includes(model)) inconclusive(`not a reference Mac (${REFERENCE_MACS.join(' or ')}): hw.model is ${model}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-423-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs, stores), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-423-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type Planted = 'mr_from_srgb' | 'applies_image_gamma' | 'anisotropy_one' | 'normal_map_as_srgb';
export interface Run { replies: JsonObject[]; pid: number }
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): Run {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: its answer is not JSON: ${lines[0]!.slice(0, 600)}`); }
  const a = obj(answer, `${name}: the answer`);
  expect(a['ok'], `${name} refused the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return { replies, pid: run.pid ?? -1 };
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Documents: a physical-basis look, a session document, cameras, builders and materials.

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #421's acceptance look: tone map none at the exposure whose scale is 1, plus the fields given (Look: samples). */
export function look(extra: JsonObject = {}): JsonObject {
  return {
    id: 'look-423', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #423 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto', ...extra,
  };
}
export const PLAIN_LOOK = look();

/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) {
    withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  }
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #423 acceptance fixture.`, size, camera: 'cam', transport: { span: '2s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items: withIds,
  };
}

export type V3 = [number, number, number];
export const perspective = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov } });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame (Camera `camera@1`). */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth } });
/** A `slab@1` of `size` (Builder: centred across its plan, its thickness up from it) with uv0 and uv_scale (Builder: uv). */
export const slab = (size: V3, at: JsonObject, uvAxis: 'x' | 'y' | 'z', uvScale: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'slab@1', params: { size, uv0: { planar: { axis: uvAxis } }, uv_scale: uvScale }, at, ...extra });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A sun (#421): shines along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx). */
export const sun = (lux: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance: lux, color: [1, 1, 1] }, at: { rot } });
/** A glTF file's whole scene as one item (README: Assumed surfaces 3). */
export const sceneAsset = (sha: string, at: JsonObject = { pos: [0, 0, 0] }): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node: { scene: 0 } }, at });

export interface View3d {
  doc: string; look: JsonObject; size: [number, number];
  targets?: ('final' | 'linear' | 'ids')[];
  /** README: Assumed surfaces 1, 2, 4, 5, 8. */
  assets?: Record<string, string>; uris?: Record<string, Record<string, string>>; licenses?: Record<string, JsonObject>;
  store?: string; imports?: boolean; receipt?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface Frame { final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
/** Frame 0 of a view3d reply (#378). */
export function frame0(reply: JsonObject, what: string): Frame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  let picks: Map<number, string> | null = null;
  if (isObject(f!['picks'])) picks = new Map(Object.entries(f!['picks']).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  return { final: optStr(f!['final'], `${what}.final`), linear: optStr(f!['linear'], `${what}.linear`), ids: optStr(f!['ids'], `${what}.ids`), picks };
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => [number, number, number] }
export function readLinear(out: string, f: Frame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

// ---------------------------------------------------------------------------------------------------
// PNG: reading the renderer's 8-bit targets, and writing the maps the tests make.

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
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
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
export function pixel(image: Image, x: number, y: number): [number, number, number] {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG of `w × h` whose texel (x, y) is `at(x, y)`, with no gamma, sRGB or ICC chunk. */
export function encodePng(w: number, h: number, at: (x: number, y: number) => readonly number[]): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y); const o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = c[0]!; raw[o + 1] = c[1]!; raw[o + 2] = c[2]!; raw[o + 3] = c[3] ?? 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------------
// KTX2 in UASTC, written here (no encoder is available offline): every 4 × 4 block is UASTC's solid-color
// mode (mode 8: its 5-bit code 0x17, then R, G, B and A in 8 bits each, LSB first; the ETC1 hints left 0), over
// the full mip chain, with a Khronos Data Format descriptor of colour model UASTC (166). The bit layout is the one
// Basis Universal's transcoder reads (basisu_transcoder.cpp, `unpack_uastc`, UASTC_MODE_INDEX_SOLID_COLOR).

function uastcSolid(rgba: readonly number[]): Buffer {
  const block = Buffer.alloc(16);
  let bit = 0;
  const put = (value: number, bits: number): void => {
    for (let i = 0; i < bits; i++, bit++) if ((value >> i) & 1) block[bit >> 3]! |= 1 << (bit & 7);
  };
  put(0x17, 5);
  for (const c of rgba) put(c, 8);
  return block;
}
/** A `size` px square UASTC KTX2 file of one color, mips down to 1 × 1, tagged sRGB or linear. */
export function ktx2Uastc(size: number, rgba: readonly [number, number, number, number], transfer: 'srgb' | 'linear'): Buffer {
  const levels = Math.floor(Math.log2(size)) + 1;
  const block = uastcSolid(rgba);
  const data: Buffer[] = [];
  for (let l = 0; l < levels; l++) {
    const s = Math.max(1, size >> l); const blocks = Math.ceil(s / 4) ** 2;
    data.push(Buffer.concat(new Array<Buffer>(blocks).fill(block)));
  }
  const dfd = Buffer.alloc(44);
  dfd.writeUInt32LE(44, 0); // dfdTotalSize
  dfd.writeUInt32LE(0, 4); // vendorId 0, descriptorType 0
  dfd.writeUInt16LE(2, 8); dfd.writeUInt16LE(40, 10); // versionNumber 2, descriptorBlockSize 24 + 16
  dfd[12] = 166; dfd[13] = 1; dfd[14] = transfer === 'srgb' ? 2 : 1; dfd[15] = 0; // UASTC, BT.709, transfer, straight alpha
  dfd[16] = 3; dfd[17] = 3; dfd[18] = 0; dfd[19] = 0; // a 4 × 4 block
  dfd[20] = 16; // bytesPlane0
  dfd.writeUInt16LE(0, 28); dfd[30] = 127; dfd[31] = 3; // sample: bit 0, 128 bits, KHR_DF_CHANNEL_UASTC_RGBA
  dfd.writeUInt32LE(0, 36); dfd.writeUInt32LE(0xffffffff, 40);
  const head = 80 + 24 * levels;
  const dfdAt = head;
  let at = Math.ceil((dfdAt + dfd.length) / 16) * 16;
  const offsets = new Array<number>(levels);
  for (let l = levels - 1; l >= 0; l--) { offsets[l] = at; at = Math.ceil((at + data[l]!.length) / 16) * 16; }
  const out = Buffer.alloc(at);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
  [0, 1, size, size, 0, 0, 1, levels, 0].forEach((v, i) => out.writeUInt32LE(v, 12 + 4 * i));
  out.writeUInt32LE(dfdAt, 48); out.writeUInt32LE(dfd.length, 52); out.writeUInt32LE(0, 56); out.writeUInt32LE(0, 60);
  out.writeBigUInt64LE(0n, 64); out.writeBigUInt64LE(0n, 72);
  for (let l = 0; l < levels; l++) {
    out.writeBigUInt64LE(BigInt(offsets[l]!), 80 + 24 * l); out.writeBigUInt64LE(BigInt(data[l]!.length), 88 + 24 * l); out.writeBigUInt64LE(BigInt(data[l]!.length), 96 + 24 * l);
    data[l]!.copy(out, offsets[l]!);
  }
  dfd.copy(out, dfdAt);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The Khronos sample models (KhronosGroup/glTF-Sample-Assets), pinned by commit and SHA-256 per file, fetched on
// first use into the checkout's ignored `target/acceptance/423/khronos/` by hash, and never committed.

export const KHRONOS_COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
export interface Pin { path: string; sha256: string; size: number }
export interface License { id: string; terms: string; shareable: boolean; credit: string }
export interface Sample { name: string; main: Pin; files: Record<string, Pin>; license: License }
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
const CCBY = 'https://creativecommons.org/licenses/by/4.0/legalcode';
const lic = (id: 'CC0-1.0' | 'CC-BY-4.0', credit: string): License => ({ id, terms: id === 'CC0-1.0' ? CC0 : CCBY, shareable: true, credit });
const m = (name: string, rest: string): string => `Models/${name}/${rest}`;
export const SAMPLES = {
  TextureTransformTest: {
    name: 'TextureTransformTest',
    main: { path: m('TextureTransformTest', 'glTF/TextureTransformTest.gltf'), sha256: 'c22c8c6c96c0ea4bcbb9b47ea245a093c5ef59acc5fd425effa4c00da4cdf164', size: 9179 },
    files: {
      'TextureTransformTest.bin': { path: m('TextureTransformTest', 'glTF/TextureTransformTest.bin'), sha256: 'd0cdd23f2fa0996a0db99d4932fb9912a51a34e27c8bf832d072dc856ee9a7af', size: 136 },
      'UV.png': { path: m('TextureTransformTest', 'glTF/UV.png'), sha256: 'ac37ff52fe06a4c8c35ad4e1e7e8da039dfa8afc9b629d40a44ca8b8cfe9d03d', size: 12345 },
      'Arrow.png': { path: m('TextureTransformTest', 'glTF/Arrow.png'), sha256: '5df5b251fed0ac306cf859a30b59a4953d152483a4bed2b84e5bba1c667a1e64', size: 867 },
      'Correct.png': { path: m('TextureTransformTest', 'glTF/Correct.png'), sha256: '3a14b12635ebbcee3ea427fbdb4d20da73e4740ec7a51683d700a2d6b4b7861a', size: 2457 },
      'NotSupported.png': { path: m('TextureTransformTest', 'glTF/NotSupported.png'), sha256: '1fbdeca7e5c105d677a39578e4bab82b89c8aa9f406ee681ede05635ea0f8c74', size: 3291 },
      'Error.png': { path: m('TextureTransformTest', 'glTF/Error.png'), sha256: '8d1032ef535a5c379bf78f9f565d3180ee3fc2d1cfef6892dee6e567728b619c', size: 2273 },
    },
    license: lic('CC0-1.0', '© 2018 Microsoft (TextureTransformTest, CC0 1.0)'),
  },
  TextureSettingsTest: {
    name: 'TextureSettingsTest',
    main: { path: m('TextureSettingsTest', 'glTF-Binary/TextureSettingsTest.glb'), sha256: '44013a0602cbbdcaf703905ed47cc6b6fb49f067d7de0e1a0a568a5bbfa9d769', size: 42840 },
    files: {},
    license: lic('CC-BY-4.0', '© 2017 Analytical Graphics, Inc.; model and textures by Ed Mackey (TextureSettingsTest, CC BY 4.0)'),
  },
  TextureCoordinateTest: {
    name: 'TextureCoordinateTest',
    main: { path: m('TextureCoordinateTest', 'glTF-Binary/TextureCoordinateTest.glb'), sha256: 'fe75a63a0423c9a682bf46c3045b6328ae9c55abefc9a50adf3ec1d6dc6ea3b9', size: 14232 },
    files: {},
    license: lic('CC0-1.0', '© 2017 Analytical Graphics, Inc.; by Ed Mackey (TextureCoordinateTest, CC0 1.0)'),
  },
  AlphaBlendModeTest: {
    name: 'AlphaBlendModeTest',
    main: { path: m('AlphaBlendModeTest', 'glTF-Binary/AlphaBlendModeTest.glb'), sha256: '37c3577d143071b42dd46e9d942b157837eb25c6340112171d7faecaa987b14e', size: 2978812 },
    files: {},
    license: lic('CC-BY-4.0', '© 2018 Analytical Graphics, Inc.; model and textures by Ed Mackey (AlphaBlendModeTest, CC BY 4.0)'),
  },
  NegativeScaleTest: {
    name: 'NegativeScaleTest',
    main: { path: m('NegativeScaleTest', 'glTF-Binary/NegativeScaleTest.glb'), sha256: 'ea8c41fd0630f03adcf7a5c06bf86d7b850fa510b6f07cc51eb1fccc205a50f2', size: 62568 },
    files: {},
    license: lic('CC-BY-4.0', '© 2023 Analytical Graphics, Inc.; model and textures by Ed Mackey (NegativeScaleTest, CC BY 4.0)'),
  },
  TextureEncodingTest: {
    name: 'TextureEncodingTest',
    main: { path: m('TextureEncodingTest', 'glTF-Binary/TextureEncodingTest.glb'), sha256: 'c2f654bdf918e3cce93db3f8d8c1b008b90d3089e756c9b38149e9306b1338f4', size: 21612 },
    files: {},
    license: lic('CC0-1.0', '© 2017 lexaknyazev (TextureEncodingTest, CC0 1.0)'),
  },
  TextureTransformMultiTest: {
    name: 'TextureTransformMultiTest',
    main: { path: m('TextureTransformMultiTest', 'glTF-Binary/TextureTransformMultiTest.glb'), sha256: '569aedb53822d5721e7e06af5983348683d4b2ffb1d469338ad4f02bf6a74911', size: 388264 },
    files: {},
    license: lic('CC-BY-4.0', '© 2020 Analytical Graphics, Inc.; model and textures by Ed Mackey (TextureTransformMultiTest, CC BY 4.0)'),
  },
} satisfies Record<string, Sample>;
export type SampleName = keyof typeof SAMPLES;

const CACHE = join(REPO, 'target', 'acceptance', '423', 'khronos');
/** One pinned file's bytes: from the cache by hash, else fetched once from the pinned commit and checked. */
async function pinned(pin: Pin): Promise<Buffer> {
  const file = join(CACHE, pin.sha256);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    if (sha256(bytes) === pin.sha256) return bytes;
  }
  const url = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${KHRONOS_COMMIT}/${pin.path}`;
  let bytes: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) return blocked(`fetching ${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} answered HTTP ${response.status}`, `reach ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (e) {
    return blocked(`${pin.path} isn't cached and the network is unreachable (${(e as Error).message})`, `run once with the network, or place the file at ${file}`);
  }
  expect(sha256(bytes), `${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} has its pinned SHA-256`).toBe(pin.sha256);
  expect(bytes.length, `${pin.path} has its pinned size`).toBe(pin.size);
  mkdirSync(CACHE, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, file);
  return bytes;
}
/** git's blob ID of `bytes` (SHA-1 of "blob <length>\0" and the bytes). */
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
let tracked: Set<string> | null = null;
/** Every blob in HEAD's tree and in the index, by git's blob ID. */
function trackedBlobs(): Set<string> {
  if (tracked) return tracked;
  const ids = new Set<string>();
  const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of tree.split('\n')) { const id = line.split(/\s+/)[2]; if (id) ids.add(id); }
  const index = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of index.split('\n')) { const id = line.split(/\s+/)[1]; if (id) ids.add(id); }
  tracked = ids;
  return ids;
}
export interface Fetched {
  sample: Sample; sha: string; bytes: Buffer;
  /** The `view3d` fields that hand the product this sample by hash: its files, its URIs and its license. */
  assets: Record<string, string>; uris: Record<string, Record<string, string>>; licenses: Record<string, JsonObject>;
  gltf: Gltf;
}
/** The `view3d` fields that hand the product a fetched sample by hash. */
export const byHash = (f: Fetched): Pick<View3d, 'assets' | 'uris' | 'licenses'> => ({ assets: f.assets, uris: f.uris, licenses: f.licenses });
/** A sample, fetched by hash on first use, checked never committed, written under `dir` by hash for the product. */
export async function khronos(name: SampleName, dir: string): Promise<Fetched> {
  const sample: Sample = SAMPLES[name];
  const bytes = await pinned(sample.main);
  const files: Record<string, Buffer> = {};
  for (const [uri, pin] of Object.entries(sample.files)) files[uri] = await pinned(pin);
  const blobs = trackedBlobs();
  for (const [what, b] of [[sample.main.path, bytes], ...Object.entries(sample.files).map(([u, p]) => [p.path, files[u]!] as const)] as const) {
    expect(blobs.has(gitBlob(b)), `${what} is never committed: no blob in HEAD or the index has its bytes`).toBe(false);
  }
  const assets: Record<string, string> = {};
  const put = (b: Buffer): string => { const s = sha256(b); const p = join(dir, s); if (!existsSync(p)) writeFileSync(p, b); assets[s] = p; return s; };
  const sha = put(bytes);
  const uris: Record<string, Record<string, string>> = {};
  if (Object.keys(files).length) uris[sha] = Object.fromEntries(Object.entries(files).map(([u, b]) => [u, put(b)]));
  return { sample, sha, bytes, assets, uris, licenses: { [sha]: sample.license as unknown as JsonObject }, gltf: readGltf(bytes, files) };
}

// ---------------------------------------------------------------------------------------------------
// The glTF files' own JSON, read here to hold the import to what each file declares.

export interface Gltf { json: JsonObject; bin: Buffer; files: Record<string, Buffer> }
export function readGltf(bytes: Buffer, files: Record<string, Buffer> = {}): Gltf {
  if (bytes.subarray(0, 4).toString('latin1') !== 'glTF') return { json: JSON.parse(bytes.toString('utf8')) as JsonObject, bin: Buffer.alloc(0), files };
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as JsonObject;
  const at = 20 + jsonLen;
  const bin = at + 8 <= bytes.length ? bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at)) : Buffer.alloc(0);
  return { json, bin, files };
}
const list = (g: Gltf, key: string): JsonObject[] => ((g.json[key] as JsonValue[] | undefined) ?? []) as JsonObject[];
function bufferBytes(g: Gltf, i: number): Buffer {
  const b = list(g, 'buffers')[i]!;
  return typeof b['uri'] === 'string' ? g.files[b['uri']]! : g.bin;
}
function viewBytes(g: Gltf, i: number): Buffer {
  const v = list(g, 'bufferViews')[i]!;
  const off = (v['byteOffset'] as number | undefined) ?? 0;
  return bufferBytes(g, v['buffer'] as number).subarray(off, off + (v['byteLength'] as number));
}
/** Image `i`'s bytes as the file holds them: its buffer view's, or the file its URI names. */
export function imageBytes(g: Gltf, i: number): Buffer {
  const im = list(g, 'images')[i]!;
  return typeof im['uri'] === 'string' ? g.files[im['uri']]! : viewBytes(g, im['bufferView'] as number);
}
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
/** Accessor `i` as rows of numbers (float, or unsigned integers as stored). */
export function accessor(g: Gltf, i: number): number[][] {
  const a = list(g, 'accessors')[i]!;
  const view = list(g, 'bufferViews')[a['bufferView'] as number]!;
  const bytes = viewBytes(g, a['bufferView'] as number);
  const w = WIDTH[a['type'] as string]!; const ct = a['componentType'] as number;
  const size = ct === 5126 || ct === 5125 ? 4 : ct === 5123 ? 2 : 1;
  const stride = (view['byteStride'] as number | undefined) ?? w * size;
  const base = (a['byteOffset'] as number | undefined) ?? 0;
  const read = (o: number): number => (ct === 5126 ? bytes.readFloatLE(o) : ct === 5125 ? bytes.readUInt32LE(o) : ct === 5123 ? bytes.readUInt16LE(o) : bytes[o]!);
  const rows: number[][] = [];
  for (let r = 0; r < (a['count'] as number); r++) rows.push(Array.from({ length: w }, (_, k) => read(base + r * stride + k * size)));
  return rows;
}

/** A 3 × 4 affine matrix, rows. */
export type M34 = [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
const IDENTITY: M34 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
export function mul(a: M34, b: M34): M34 {
  return [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]! + (j === 3 ? a[i]![3]! : 0))) as M34;
}
export const apply = (mat: M34, p: readonly number[]): V3 => [0, 1, 2].map((i) => mat[i]![0]! * p[0]! + mat[i]![1]! * p[1]! + mat[i]![2]! * p[2]! + mat[i]![3]!) as V3;
export const det = (a: M34): number =>
  a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
/** A node's local matrix, glTF's T × R × S (or its `matrix`, column-major). */
function localOf(n: JsonObject): M34 {
  if (Array.isArray(n['matrix'])) { const c = n['matrix'] as number[]; return [[c[0]!, c[4]!, c[8]!, c[12]!], [c[1]!, c[5]!, c[9]!, c[13]!], [c[2]!, c[6]!, c[10]!, c[14]!]]; }
  const [x, y, z, w] = (n['rotation'] as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (n['scale'] as number[] | undefined) ?? [1, 1, 1];
  const [tx, ty, tz] = (n['translation'] as number[] | undefined) ?? [0, 0, 0];
  const r = [
    [1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)],
    [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)],
    [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)],
  ];
  const t = [tx!, ty!, tz!];
  return [0, 1, 2].map((i) => [r[i]![0]! * sx!, r[i]![1]! * sy!, r[i]![2]! * sz!, t[i]!]) as M34;
}
/** Every node of scene 0 with its world matrix (parent × local), as the file composes them. */
export function worlds(g: Gltf): Map<number, M34> {
  const nodes = list(g, 'nodes'); const out = new Map<number, M34>();
  const walk = (i: number, parent: M34): void => {
    const w = mul(parent, localOf(nodes[i]!)); out.set(i, w);
    for (const c of ((nodes[i]!['children'] as number[] | undefined) ?? [])) walk(c, w);
  };
  const scene = list(g, 'scenes')[(g.json['scene'] as number | undefined) ?? 0]!;
  for (const root of scene['nodes'] as number[]) walk(root, IDENTITY);
  return out;
}
export const nodeName = (g: Gltf, i: number): string => (list(g, 'nodes')[i]!['name'] as string | undefined) ?? String(i);
/** The pick name of node `i` drawn by a scene item `item` (README: Assumed surfaces 3). */
export const nodePick = (g: Gltf, item: string, i: number): string => `${item}#${nodeName(g, i)}`;
/** An orthographic view along −Z that frames scene 0 of `g` with a tenth to spare (from the accessors' bounds). */
export function framing(g: Gltf, size: [number, number]): { target: V3; viewWidth: number } {
  const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const accessors = list(g, 'accessors');
  for (const [i, w] of worlds(g)) {
    const mesh = list(g, 'nodes')[i]!['mesh'];
    if (typeof mesh !== 'number') continue;
    for (const p of list(g, 'meshes')[mesh]!['primitives'] as JsonObject[]) {
      const a = accessors[(p['attributes'] as JsonObject)['POSITION'] as number]!;
      const [mn, mx] = [a['min'] as number[], a['max'] as number[]];
      for (const x of [mn[0]!, mx[0]!]) for (const y of [mn[1]!, mx[1]!]) for (const z of [mn[2]!, mx[2]!]) {
        const q = apply(w, [x, y, z]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, q[k]!); hi[k] = Math.max(hi[k]!, q[k]!); }
      }
    }
  }
  const target: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { target, viewWidth: 1.1 * Math.max(hi[0] - lo[0], ((hi[1] - lo[1]) * size[0]) / size[1]) };
}
/** Positions and triangles of node `i`'s mesh in world metres. */
export function nodeTriangles(g: Gltf, i: number, world: M34): V3[][] {
  const mesh = list(g, 'meshes')[list(g, 'nodes')[i]!['mesh'] as number]!;
  const tris: V3[][] = [];
  for (const p of mesh['primitives'] as JsonObject[]) {
    const pos = accessor(g, (p['attributes'] as JsonObject)['POSITION'] as number).map((q) => apply(world, q));
    const idx = typeof p['indices'] === 'number' ? accessor(g, p['indices']).map((r) => r[0]!) : pos.map((_, k) => k);
    for (let t = 0; t + 2 < idx.length; t += 3) tris.push([pos[idx[t]!]!, pos[idx[t + 1]!]!, pos[idx[t + 2]!]!]);
  }
  return tris;
}

// ---------------------------------------------------------------------------------------------------
// The import report (README: Assumed surfaces 4) and the check that holds it to the file.

export interface MapRead { sha256: string; uv: string; offset: [number, number]; scale: [number, number]; rotation: number; wrap: [string, string] }
/** A map field as the import wrote it: a SHA-256, or `{sha256, uv, transform, wrap}` with the design's defaults. */
export function readMap(v: JsonValue | undefined, what: string): MapRead | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return { sha256: v, uv: 'uv0', offset: [0, 0], scale: [1, 1], rotation: 0, wrap: ['repeat', 'repeat'] };
  const o = obj(v, what);
  const t = isObject(o['transform']) ? o['transform'] : {};
  const w = o['wrap'] ?? 'repeat';
  const wrap: [string, string] = Array.isArray(w) ? [str(w[0], `${what}.wrap[0]`), str(w[1], `${what}.wrap[1]`)] : [str(w, `${what}.wrap`), str(w, `${what}.wrap`)];
  const pair = (x: JsonValue | undefined, d: [number, number], k: string): [number, number] => (x === undefined ? d : [num(arr(x, k)[0], k), num(arr(x, k)[1], k)]);
  return {
    sha256: str(o['sha256'], `${what}.sha256`), uv: o['uv'] === undefined ? 'uv0' : str(o['uv'], `${what}.uv`),
    offset: pair(t['offset'], [0, 0], `${what}.transform.offset`), scale: pair(t['scale'], [1, 1], `${what}.transform.scale`),
    rotation: t['rotation'] === undefined ? 0 : num(t['rotation'], `${what}.transform.rotation`), wrap,
  };
}
export interface Imported { item: string; sha256: string; materials: Map<number, { name: JsonValue; params: JsonObject }>; textures: JsonObject[]; dropped: JsonObject[] }
/** The `imports` entry a view3d reply holds for `item`. */
export function importOf(reply: JsonObject, item: string, what: string): Imported {
  answered(reply, what);
  const entries = arr(reply['imports'], `${what}: imports`).map((e, i) => obj(e, `${what}: imports[${i}]`));
  const e = entries.find((x) => x['item'] === item);
  expect(e, `${what}: imports has an entry for ${item}, got ${shown(reply['imports'])}`).toBeDefined();
  const materials = new Map<number, { name: JsonValue; params: JsonObject }>();
  for (const [i, v] of arr(e!['materials'], `${what}: materials`).entries()) {
    const m = obj(v, `${what}: materials[${i}]`);
    materials.set(num(m['index'], `${what}: materials[${i}].index`), { name: m['name'] ?? null, params: obj(m['params'], `${what}: materials[${i}].params`) });
  }
  return {
    item, sha256: str(e!['sha256'], `${what}: sha256`), materials,
    textures: arr(e!['textures'] ?? [], `${what}: textures`).map((t, i) => obj(t, `${what}: textures[${i}]`)),
    dropped: arr(e!['dropped'] ?? [], `${what}: dropped`).map((d, i) => obj(d, `${what}: dropped[${i}]`)),
  };
}
/** glTF's five core texture slots and the field each maps to (Material: texture maps). */
const SLOTS: [string, (m: JsonObject) => JsonValue | undefined, string][] = [
  ['baseColorTexture', (m) => (m['pbrMetallicRoughness'] as JsonObject | undefined)?.['baseColorTexture'], 'maps.base_color'],
  ['metallicRoughnessTexture', (m) => (m['pbrMetallicRoughness'] as JsonObject | undefined)?.['metallicRoughnessTexture'], 'maps.metallic_roughness'],
  ['emissiveTexture', (m) => m['emissiveTexture'], 'maps.emission'],
  ['occlusionTexture', (m) => m['occlusionTexture'], 'maps.occlusion'],
  ['normalTexture', (m) => m['normalTexture'], 'normal_map'],
];
const WRAP: Record<number, string> = { 10497: 'repeat', 33071: 'clamp', 33648: 'mirror' };
const field = (params: JsonObject, path: string): JsonValue | undefined => path.split('.').reduce<JsonValue | undefined>((v, k) => (isObject(v) ? v[k] : undefined), params);
const close = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
/** Every texture, sampler, texCoord set, UV transform and alpha mode the file declares, against the import. */
export function importProblems(g: Gltf, im: Imported, model: string): string[] {
  const problems: string[] = [];
  const textures = list(g, 'textures'); const samplers = list(g, 'samplers');
  for (const [i, mat] of list(g, 'materials').entries()) {
    const at = `${model} material ${i} (${(mat['name'] as string | undefined) ?? 'unnamed'})`;
    const got = im.materials.get(i);
    if (!got) { problems.push(`${at}: not in the import`); continue; }
    const p = got.params;
    const wantMode = ((mat['alphaMode'] as string | undefined) ?? 'OPAQUE').toLowerCase();
    if ((p['alpha_mode'] ?? 'opaque') !== wantMode) problems.push(`${at}: alpha_mode ${shown(p['alpha_mode'])}, the file declares ${wantMode}`);
    if (wantMode === 'mask') {
      const want = (mat['alphaCutoff'] as number | undefined) ?? 0.5; const cut = (p['alpha_cutoff'] as number | undefined) ?? 0.5;
      if (!close(cut, want, 1e-6)) problems.push(`${at}: alpha_cutoff ${cut}, the file declares ${want}`);
    }
    if ((p['double_sided'] ?? false) !== ((mat['doubleSided'] as boolean | undefined) ?? false)) problems.push(`${at}: double_sided ${shown(p['double_sided'])}, the file declares ${shown(mat['doubleSided'] ?? false)}`);
    for (const [slot, of, path] of SLOTS) {
      const info = of(mat);
      if (!isObject(info)) continue;
      const tex = textures[info['index'] as number]!;
      const want = sha256(imageBytes(g, tex['source'] as number));
      const tt = isObject(info['extensions']) && isObject(info['extensions']['KHR_texture_transform']) ? info['extensions']['KHR_texture_transform'] : {};
      const map = readMap(field(p, path), `${at}: ${path}`);
      if (!map) { problems.push(`${at}: its ${slot} isn't kept as ${path}`); continue; }
      if (map.sha256 !== want) problems.push(`${at}: ${path} is ${map.sha256}, the file's image hashes to ${want}`);
      const uv = `uv${(tt['texCoord'] as number | undefined) ?? (info['texCoord'] as number | undefined) ?? 0}`;
      if (map.uv !== uv) problems.push(`${at}: ${path} reads ${map.uv}, the file names texCoord ${uv}`);
      const off = (tt['offset'] as [number, number] | undefined) ?? [0, 0]; const sc = (tt['scale'] as [number, number] | undefined) ?? [1, 1];
      const rot = (((tt['rotation'] as number | undefined) ?? 0) * 180) / Math.PI;
      if (!close(map.offset[0], off[0], 1e-6) || !close(map.offset[1], off[1], 1e-6)) problems.push(`${at}: ${path} offset ${shown(map.offset)}, the file declares ${shown(off)}`);
      if (!close(map.scale[0], sc[0], 1e-6) || !close(map.scale[1], sc[1], 1e-6)) problems.push(`${at}: ${path} scale ${shown(map.scale)}, the file declares ${shown(sc)}`);
      if (Math.abs(map.rotation - rot) > 1e-4) problems.push(`${at}: ${path} rotation ${map.rotation}°, the file declares ${rot}°`);
      const s = typeof tex['sampler'] === 'number' ? samplers[tex['sampler']]! : {};
      const wrap = [WRAP[(s['wrapS'] as number | undefined) ?? 10497]!, WRAP[(s['wrapT'] as number | undefined) ?? 10497]!];
      if (map.wrap[0] !== wrap[0] || map.wrap[1] !== wrap[1]) problems.push(`${at}: ${path} wraps ${shown(map.wrap)}, the file's sampler declares ${shown(wrap)}`);
    }
    // A texture the maps can't hold (a lobe's own texture in an extension) is listed in `dropped`, never lost.
    for (const [ext, body] of Object.entries(isObject(mat['extensions']) ? mat['extensions'] : {})) {
      for (const [key, info] of Object.entries(isObject(body) ? body : {})) {
        if (!isObject(info) || typeof info['index'] !== 'number') continue;
        const listed = im.dropped.some((d) => (d['material'] === i || d['material'] === mat['name']) && typeof d['input'] === 'string' && d['input'].includes(key));
        if (!listed) problems.push(`${at}: ${ext}.${key} is neither kept nor listed in dropped`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, #378's pinhole, the orthographic view, the object-ID target.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
export const focalOf = (cam: Pinhole): number => basis(cam).focal;
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** Where the ray through frame point (px, py) (pixel corners at integers) meets the plane y = 0. */
export function onFloor(cam: Pinhole, px: number, py: number): V3 {
  const { f, r, u, focal } = basis(cam);
  const dir = add(add(f, scale(r, (px - cam.size[0] / 2) / focal)), scale(u, -(py - cam.size[1] / 2) / focal));
  return add(cam.position, scale(dir, -cam.position[1] / dir[1]));
}
/** The orthographic view `ortho()` makes: frame px of a world point. */
export function orthoProject(target: V3, viewWidth: number, size: [number, number], p: readonly number[]): [number, number] {
  const k = size[0] / viewWidth;
  return [size[0] / 2 + (p[0]! - target[0]) * k, size[1] / 2 - (p[1]! - target[1]) * k];
}

/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: Frame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
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
/** The pixels whose centres lie within `r` px of (cx, cy). */
export function disc(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures two files draw: AC5's stripes floor and AC6's KTX2 asset (AC7 screenshots both).

/** AC5's camera: 1 m up looking along −z, pitched 10° down, fov 40° on 512 × 512. */
export const STRIPES_CAM: Pinhole = { position: [0, 1, 0], target: [0, 0, -1 / Math.tan((10 * Math.PI) / 180)], fov: 40, size: [512, 512] };
export const STRIPE_TEXELS = 64;
/** One texel, m: one pixel's width where the centre ray meets the floor, 1 ÷ cos 80° m away. */
export const STRIPE_TEXEL = 1 / Math.cos((80 * Math.PI) / 180) / focalOf(STRIPES_CAM);
/** Texel rows alternate white and black every 2 texels: stripes 2 texels wide, across v, constant along u. */
export const stripeWhite = (row: number): boolean => ((row >> 1) & 1) === 0;
/** The stripes floor: an unlit material whose base color map is the stripes, on a slab with uv0 planar about y. */
export function stripesFloor(out: string): { doc: string; assets: Record<string, string> } {
  const map = writeAsset(out, 'stripes.png', encodePng(STRIPE_TEXELS, STRIPE_TEXELS, (_x, y) => (stripeWhite(y) ? [255, 255, 255, 255] : [0, 0, 0, 255])));
  const doc = sessionDoc('stripes-floor', STRIPES_CAM.size, {
    cam: perspective(STRIPES_CAM.position, STRIPES_CAM.target, STRIPES_CAM.fov),
    stripes: material({ base_color: [1, 1, 1, 1], unlit: true, maps: { base_color: map.sha } }),
    floor: slab([40, 0.02, 80], { pos: [0, -0.02, -35] }, 'y', STRIPE_TEXELS * STRIPE_TEXEL, { material: 'stripes' }),
  });
  return { doc: writeJson(out, 'stripes-floor', doc), assets: { [map.sha]: map.path } };
}

/** AC6's camera, on a wall facing +z from 4 m. */
export const PANEL_CAM: Pinhole = { position: [0, 2, 4], target: [0, 2, 0], fov: 40, size: [480, 360] };
/** A 4 × 4 m panel facing +z, its tangent (u) along +x, under the material `mat`, lit by a 100 lx sun 45° toward +x. */
export function panelDoc(id: string, mat: string, params: JsonObject, light: boolean): JsonObject {
  return sessionDoc(id, PANEL_CAM.size, {
    cam: perspective(PANEL_CAM.position, PANEL_CAM.target, PANEL_CAM.fov),
    [mat]: material(params),
    [`${mat}-panel`]: slab([4, 4, 0.02], { pos: [0, 0, 0] }, 'z', 1, { material: mat }),
    ...(light ? { sun: sun(100, [0, 45, 0]) } : {}),
  });
}
export interface AssetMaps { base: { sha: string; path: string }; normal: { sha: string; path: string }; orm: { sha: string; path: string }; emission: { sha: string; path: string } }
const MAP_COLORS = { base: [200, 120, 60, 255], normal: [140, 120, 250, 255], orm: [255, 140, 30, 255], emission: [40, 40, 10, 255] } as const;
/** The fixture asset's four 2,048 px maps: UASTC KTX2 (base color and emission tagged sRGB), or the same as PNG. */
export function assetMaps(out: string, as: 'ktx2' | 'png'): AssetMaps {
  const one = (name: keyof typeof MAP_COLORS, srgb: boolean): { sha: string; path: string } => {
    const c = MAP_COLORS[name];
    return writeAsset(out, `${name}.${as}`, as === 'ktx2' ? ktx2Uastc(2048, c, srgb ? 'srgb' : 'linear') : encodePng(2048, 2048, () => c));
  };
  return { base: one('base', true), normal: one('normal', false), orm: one('orm', false), emission: one('emission', true) };
}
/** The fixture asset's material: the ORM map as both metallic-roughness and occlusion. */
export const assetMaterial = (m: AssetMaps): JsonObject =>
  ({ base_color: [1, 1, 1, 1], maps: { base_color: m.base.sha, metallic_roughness: m.orm.sha, occlusion: m.orm.sha, emission: m.emission.sha }, normal_map: m.normal.sha });
export const assetsOf = (...maps: AssetMaps[]): Record<string, string> =>
  Object.fromEntries(maps.flatMap((m) => Object.values(m) as { sha: string; path: string }[]).map((a) => [a.sha, a.path]));
