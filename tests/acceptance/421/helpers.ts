// Test-side tools for the #421 acceptance tests: the two binaries the base already has, `deep-gpu` (#377's GPU
// layer, with #378's `view3d`, #382/#386's status bindings and #379/#420's `live`) and `deep-show` (the canvas
// core's scenario binary, #393/#420), each built once per file and driven by JSON lines; the calls and fields this
// suite adds (README: Assumed surfaces); the documents the tests draw; and the reviewed CPU references the criteria
// are held to: the transform order of Units and axes, world bounds of a box, the pinhole of #378, a perspective
// frustum, the photometric closed forms, PNG and object-ID reading (copied from #386's and #420's helpers, since
// suites don't import each other). Nothing here stands in for the renderer, the light policy, the spatial index or
// the status colors under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/421 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #421.e43f3de1',
  2: 'AC2 #421.fcae3a3c',
  3: 'AC3 #421.c70cf9fb',
  4: 'AC4 #421.dc19b4bc',
  5: 'AC5 #421.d9173e82',
} as const;

/** The parity fixture the issue names, under this suite's fixtures (as #420's and #377's suites keep theirs). */
export const PARITY_SCENE = 'parity/scene/mirrored-instance-winding.scene';

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
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export function fixture(...parts: string[]): JsonObject {
  return obj(JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as JsonValue, `fixture ${parts.join('/')}`);
}

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The reference Macs (technical design: The reference Macs), as #386's suite lists them. */
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** AC3 is read back "on the reference Mac": off one, INCONCLUSIVE. Power and load are not gated. */
export function requireReferenceMac(): void {
  requireMetal();
  let model: string | null = null;
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { model = null; }
  if (!model || !REFERENCE_MACS.includes(model)) inconclusive(`not a reference Mac (${REFERENCE_MACS.join(' or ')}): hw.model is ${model}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder under its own name.

export type BinName = 'deep-gpu' | 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const cargoArgs = (name: BinName): string[] =>
  name === 'deep-show' ? ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'] : ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(name: BinName): string {
  const args = cargoArgs(name);
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export interface Bins { bin: (name: BinName) => string }
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-421-bins-'));
    for (const name of names) {
      const error = cargoBuild(name);
      const bin = join(dir, exe(name));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(name)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary builds: cargo ${cargoArgs(name).join(' ')}`).toBe('');
      return entry.bin;
    },
  };
}
/** A fresh temporary folder per test (documents, outputs, evidence), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-421-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Starting a binary: one JSON line in, one JSON line out (#377, #393).

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], input: JsonValue, timeoutMs = 1_800_000): Started {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}
function accepted(s: Started, name: string, calls: number): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: `view3d` (#378) and `live` (#379, #420).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type GpuPlanted = 'winding_ignores_determinant' | 'ties_by_submission' | 'spot_counts_cone' | 'status_before_tone_map';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  return accepted(start(bin, args, { out, calls }), `deep-gpu ${args.join(' ')}`, calls.length);
}

/** A physical-basis `look@1` (#386's shape): the clean look's status map, `tone_map` and `exposure` as given. */
export const STATUS: Record<string, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
export function look(tone: { tone_map: 'none' | 'filmic'; exposure: number }): JsonObject {
  return {
    id: `look-421-${tone.tone_map}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #421 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone.tone_map, exposure: tone.exposure, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale is 1 (#378's acceptance look): AC1–AC3. */
export const PLAIN_LOOK = look({ tone_map: 'none', exposure: -Math.log2(1.2) });
/** A filmic tone map one stop up: AC5's "after tone mapping". */
export const FILMIC_LOOK = look({ tone_map: 'filmic', exposure: 1 });

/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) {
    withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  }
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #421 acceptance fixture.`, size, camera: 'cam', transport: { span: '2s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The writer's payload of a session document, as `live` (#379) and `deep_show` (#393) take it: no `id`, no `layers`. */
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}

export type V3 = [number, number, number];
export const box = (size: V3, at: JsonObject, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at, ...extra });
export const camera = (position: V3, target: V3, fov = 40, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, ...extra } });
/** A `material@1` item (Material): the fields given over the design's defaults. */
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; states?: Record<string, string>;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });
export interface ViewFrame { frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    return { frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => [number, number, number] }
export function readLinear(out: string, hash: string | null, size: [number, number], what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export type Rgb = [number, number, number];
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw Error(`${h} is not #rrggbb`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
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
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
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

// live (#379), with #420's `fences` report.
export interface LiveView { frame: number; session: string; drawn: boolean }
export interface Fence { event: string; session: string | null; frame: number | null }
export interface Live { views: LiveView[]; fences: Fence[] }
export function liveOf(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const views: LiveView[] = [];
  for (const [i, v] of arr(reply['frames'], `${what}: frames`).entries()) {
    const f = obj(v, `${what}: frames[${i}]`);
    const frame = num(f['frame'], `${what}: frames[${i}].frame`);
    for (const [j, w] of arr(f['views'], `${what}: frame ${frame}: views`).entries()) {
      const o = obj(w, `${what}: frame ${frame}: views[${j}]`);
      expect(typeof o['drawn'], `${what}: frame ${frame}: views[${j}].drawn is a boolean`).toBe('boolean');
      views.push({ frame, session: str(o['session'], `${what}: frame ${frame}: views[${j}].session`), drawn: o['drawn'] as boolean });
    }
  }
  const fences = arr(reply['fences'], `${what}: fences`).map((v, i): Fence => {
    const o = obj(v, `${what}: fences[${i}]`);
    return { event: str(o['event'], `${what}: fences[${i}].event`), session: typeof o['session'] === 'string' ? o['session'] : null, frame: typeof o['frame'] === 'number' ? o['frame'] : null };
  });
  return { views, fences };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #420) and this suite's `spatial` call.

/** Scenario `planted` values this suite adds (README: Planted programs). */
export type ShowPlanted = 'cull_by_center' | 'bounds_children_only';
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: 3D renderer', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted. */
export const DOC = '01JB421D000000000000000001';
/** A scenario: the agent's session, the process table, one visible panel for `DOC`, an optional `planted`, and the calls. */
export function scenario(evidence: string, calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES, panels: { p1: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'p1' } }, calls,
    ...(planted ? { planted } : {}),
  };
}
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  return accepted(start(bin, ['run'], sc, 900_000), 'deep-show run', arr(sc['calls'], 'the scenario\'s calls').length);
}
/** The agent's `deep_show` of a whole revision (#393). */
export const show = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues'] });
/** Presented with no error issue and no item skipped as an unknown kind (#420's `admitted`). */
export function admitted(reply: JsonObject, what: string): void {
  const errors = arr(reply['issues'] ?? [], `${what}: issues`).map((v) => obj(v, `${what}: an issue`)).filter((i) => i['severity'] === 'error');
  expect(errors.map((e) => shown(e)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).map((n) => obj(n, `${what}: a notice`)).filter((n) => n['code'] === 'unknown_kind');
  expect(skipped.map((n) => shown(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

export type Query =
  | { view: string }
  | { box: { min: V3; max: V3 } }
  | { nearest: { point: V3; n: number } }
  | { radius: { point: V3; r: number } };
export interface Aabb { min: V3; max: V3 }
export interface SpatialItem { bounds: Aabb | null; subtree: Aabb | null; children: string[] }
export interface Spatial { items: Map<string, SpatialItem>; results: string[][] }
export const spatialCall = (queries: Query[], t = '0s'): JsonObject => ({ call: 'spatial', doc: DOC, t, queries: queries as unknown as JsonValue });
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} is [x, y, z]`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
const aabbOf = (v: JsonValue | undefined, what: string): Aabb | null => {
  if (v === null || v === undefined) return null;
  const o = obj(v, what);
  return { min: v3(o['min'], `${what}.min`), max: v3(o['max'], `${what}.max`) };
};
export function spatialOf(reply: JsonObject, what = 'the spatial call'): Spatial {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const items = new Map<string, SpatialItem>();
  for (const [id, v] of Object.entries(obj(reply['items'], `${what}: items`))) {
    const o = obj(v, `${what}: items.${id}`);
    items.set(id, {
      bounds: aabbOf(o['bounds'], `${what}: items.${id}.bounds`), subtree: aabbOf(o['subtree'], `${what}: items.${id}.subtree`),
      children: arr(o['children'] ?? [], `${what}: items.${id}.children`).map((c, i) => str(c, `${what}: items.${id}.children[${i}]`)),
    });
  }
  const results = arr(reply['results'], `${what}: results`).map((r, i) => arr(r, `${what}: results[${i}]`).map((x, j) => str(x, `${what}: results[${i}][${j}]`)));
  return { items, results };
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, the transform order (Units and axes), a box's world bounds, #378's pinhole.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** A 3 × 4 affine matrix, rows. */
export type M34 = [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
const rad = (d: number): number => (d * Math.PI) / 180;
/** An item's own `at`: scale, then R = Rz·Ry·Rx (degrees), then move to `pos` (Units and axes). */
export function localOf(pos: V3, rot: V3, sc: V3): M34 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const r = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  return [0, 1, 2].map((i) => [r[i]![0]! * sc[0], r[i]![1]! * sc[1], r[i]![2]! * sc[2], pos[i]!]) as M34;
}
/** a × b (world = parent world × local, Object). */
export function mul(a: M34, b: M34): M34 {
  return [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]! + (j === 3 ? a[i]![3]! : 0))) as M34;
}
export const apply = (m: M34, p: V3): V3 => [0, 1, 2].map((i) => m[i]![0]! * p[0] + m[i]![1]! * p[1] + m[i]![2]! * p[2] + m[i]![3]!) as V3;
/** The world AABB of a `size` box centred on its origin under world matrix `m`: its eight corners transformed. */
export function boxBounds(m: M34, size: V3): Aabb {
  const min: V3 = [Infinity, Infinity, Infinity]; const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const p = apply(m, [sx * size[0], sy * size[1], sz * size[2]]);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
  }
  return { min, max };
}
export function union(a: Aabb | null, b: Aabb | null): Aabb | null {
  if (!a) return b; if (!b) return a;
  return { min: [0, 1, 2].map((k) => Math.min(a.min[k]!, b.min[k]!)) as V3, max: [0, 1, 2].map((k) => Math.max(a.max[k]!, b.max[k]!)) as V3 };
}

/** #378's pinhole: position, target, +Y up, fov across the wider side; frame px of a world point, and back. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** Where the ray through pixel (px, py)'s centre meets the plane y = 0. */
export function onFloor(cam: Pinhole, px: number, py: number): V3 {
  const { f, r, u, focal } = basis(cam);
  const dir = add(add(f, scale(r, (px + 0.5 - cam.size[0] / 2) / focal)), scale(u, -(py + 0.5 - cam.size[1] / 2) / focal));
  return add(cam.position, scale(dir, -cam.position[1] / dir[1]));
}
/** The pinhole's view volume between `near` and `far`, as six planes (n, d): inside where n·p + d ≥ 0. */
export function frustum(cam: Pinhole, near: number, far: number): [V3, number][] {
  const { f, r, u, focal } = basis(cam);
  const hx = cam.size[0] / 2 / focal; const hy = cam.size[1] / 2 / focal;
  const planes: [V3, number][] = [];
  const through = (n: V3): [V3, number] => [n, -dot(n, cam.position)];
  planes.push(through(unit(sub(scale(f, hx), r))), through(unit(add(scale(f, hx), r))));
  planes.push(through(unit(sub(scale(f, hy), u))), through(unit(add(scale(f, hy), u))));
  planes.push([f, -dot(f, cam.position) - near], [scale(f, -1), dot(f, cam.position) + far]);
  return planes;
}
/** The cull's predicate the brute scan applies: kept unless all eight corners of the bounds lie outside one plane. */
export function passesCull(planes: [V3, number][], b: Aabb): boolean {
  for (const [n, d] of planes) {
    let outside = 0;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) if (dot(n, [x, y, z]) + d < 0) outside++;
    if (outside === 8) return false;
  }
  return true;
}
/** Distance from a point to a box, 0 inside. */
export function distanceTo(b: Aabb, p: V3): number {
  const d = [0, 1, 2].map((k) => Math.max(b.min[k]! - p[k]!, 0, p[k]! - b.max[k]!));
  return Math.hypot(d[0]!, d[1]!, d[2]!);
}
/** A seeded generator (mulberry32), so every run builds the same fixture. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The mask grown by `r` px (Chebyshev), as #386's suite grows its silhouettes. */
export function grow(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) { if (mask[y * width + x]) last = x; if (x - last <= r) rows[y * width + x] = 1; }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (mask[y * width + x]) last = x; if (last - x <= r) rows[y * width + x] = 1; }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) { if (rows[y * width + x]) last = y; if (y - last <= r) out[y * width + x] = 1; }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (rows[y * width + x]) last = y; if (last - y <= r) out[y * width + x] = 1; }
  }
  return out;
}
