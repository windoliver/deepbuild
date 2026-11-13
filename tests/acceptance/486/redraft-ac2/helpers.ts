// Test-side tools for the blind redraft of #486's AC2: the base's `deep-gpu` binary (#377's GPU layer with #378's
// `view3d`, #421's shading, #422's sky and environment, #427's light probes, #429's material operators), built once
// per file and driven by JSON lines; the occlusion plate's four documents; and the check the criterion states.
// Copied in part from #481's suite (the build, the run, the targets, PNG reading), since suites don't import each
// other's helpers. Nothing here stands in for the renderer: every value judged is a pixel it drew.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/486/redraft-ac2 is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** AC2's ID: the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed (README). */
export const AC2 = 'AC2 #486.f7c1ed7f';

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists the first 40. */
export function none(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(0);
}
function writeJson(dir: string, name: string, value: JsonValue): string {
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
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder (the pinned toolchain added to PATH
// for a shell that has rustup's toolchains but no cargo on its PATH, as #481's suite does).

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests (on macOS only); a test that uses a build that failed fails with cargo's
 * error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-486-ac2-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, exe('deep-gpu')); };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-486-ac2-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong program this redraft plants, reachable only through `--planted` (README: Assumed surfaces, 4): the
 * `occlusion` output scales the whole shaded color, the direct light and the emission with the ambient term. */
export type GpuPlanted = 'occlusion_scales_direct';
function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(run.error === undefined || timedOut, `${name} started: ${run.error?.message ?? ''}`).toBe(true);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue = null;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { expect.fail(`${name}: its answer is JSON, got ${lines[0]!.slice(0, 600)}`); }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents

const STATUS: JsonObject = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape): tone map none at the exposure whose scale is 1, no bloom, no deband, and
 * the criterion's "the look's ao off": `ao: "none"` (Look `look@1`: ao). */
export const LOOK: JsonObject = {
  id: 'look-486-ac2', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #486 AC2 redraft look: ao off.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** A scene document as a session holds it (#378): one writer layer, every item in it; the effects module for the
 * operator (#429) and class showpiece, which allows light probes (Light probe `light.probe@1`: Cost). */
function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #486 AC2 redraft fixture.`, size, camera: 'cam', transport: { span: '4s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent:sess-486', title: 'Main', order: 'a0' } }, items: withIds,
  };
}
/** #378's pinhole `camera@1`: fov across the wider side, +Y up. */
const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 50 } });
const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A `mark.box@1` of `size` centred on `pos`. */
const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A black sky with no ambient and no environment: the document's lights and emission are its only light. */
const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** The same black sky with the shipped studio environment (Sky `sky@1`: environment): the environment is the only
 * ambient light, and the background stays the sky's own black. */
const STUDIO_SKY: JsonObject = { kind: 'sky@1', params: { ...(DARK_SKY['params'] as JsonObject), environment: { from: 'studio', intensity: 1 } } };
/** A material operator (#429) whose only output is `occlusion`, a constant `value` on every pixel. */
export function occlusionOp(value: 0 | 1): JsonObject {
  return {
    kind: 'gpu.material@1',
    params: {
      origin: 'composed', about: `Writes occlusion ${value} on every pixel and nothing else.`, inputs: {},
      steps: { occ: { op: 'const@1', args: { value, type: 'f32' } } }, outputs: { occlusion: 'occ' }, cost: { ns_per_px: 50 },
    },
  };
}

/** The occlusion plate (README: The fixture): a 60 cm plate facing +Z, its front face at z = 0, with a 20 cm emissive
 * square 1 mm proud of it, seen straight on from 1.2 m; one π lx sun about 25° off the plate's normal, unshadowed. */
export const SIZE: [number, number] = [480, 480];
export const PLATE_ID = 'plate';
export const SQUARE_ID = 'square';
const PLATE_BASE: JsonObject = { base_color: [0.55, 0.5, 0.45, 1], metallic: 0, roughness: 0.6 };
const SQUARE_BASE: JsonObject = { base_color: [0.05, 0.05, 0.05, 1], metallic: 0, roughness: 0.6, emission: [0.8, 0.4, 0.1] };
export type Variant = 'occlusion_0' | 'occlusion_1' | 'no_operator' | 'no_environment';
/** One of the four documents: with the environment and the probe, under an operator writing 0 or 1 or under none;
 * or with the environment's lighting and the probe removed, under no operator. */
export function plateDoc(variant: Variant): JsonObject {
  const op = variant === 'occlusion_0' ? occlusionOp(0) : variant === 'occlusion_1' ? occlusionOp(1) : null;
  const lit = variant !== 'no_environment';
  const items: Record<string, JsonObject> = {
    cam: camera([0, 0, 1.2], [0, 0, 0], 32),
    sky: lit ? STUDIO_SKY : DARK_SKY,
    sun: sun(Math.PI, [-20, 15, 0]),
    plate_mat: material(op ? { ...PLATE_BASE, op: 'occ_op' } : PLATE_BASE),
    square_mat: material(op ? { ...SQUARE_BASE, op: 'occ_op' } : SQUARE_BASE),
    [PLATE_ID]: box([0.6, 0.6, 0.02], [0, 0, -0.01], 'plate_mat'),
    [SQUARE_ID]: box([0.2, 0.2, 0.004], [0, 0, 0.003], 'square_mat'),
  };
  // A reflection probe whose box (1 m on each side, centred 30 cm in front of the plate) holds the plate and the square.
  if (lit) items['probe'] = { kind: 'light.probe@1', params: { type: 'reflection', size: [1, 1, 1] }, at: { pos: [0, 0, 0.3] } };
  if (op) items['occ_op'] = op;
  return sessionDoc(`occlusion-plate-${variant.replace('_', '-')}`, SIZE, items);
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378): the base's call, unchanged

interface ViewFrame { final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
function frame0(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  let picks: Map<number, string> | null = null;
  if (isObject(f!['picks'])) picks = new Map(Object.entries(f!['picks']).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  return { final: optStr(f!['final'], `${what}.final`), linear: optStr(f!['linear'], `${what}.linear`), ids: optStr(f!['ids'], `${what}.ids`), picks };
}
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
function readLinear(out: string, hash: string | null, size: [number, number], what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
function decodePng(file: Buffer, what: string): Image {
  expect(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at + 8 <= file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  expect(depth === 8 && (color === 2 || color === 6) && interlace === 0, `${what} is an 8-bit RGB or RGBA PNG with no interlace (depth ${depth}, color type ${color}, interlace ${interlace})`).toBe(true);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  expect(raw.length, `${what}: its data holds ${height} rows`).toBeGreaterThanOrEqual(height * (stride + 1));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    expect(filter <= 4, `${what}: row ${y}'s filter ${filter} is one of PNG's five`).toBe(true);
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
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
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws; each pick named by the
 * frame's `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what), what);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
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
/** Whether every pixel within `r` px of (x, y) shows `id`: away from its silhouette, where MSAA mixes parts. */
function insideAt(ids: Ids, id: string, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

/** One document drawn at its size, its linear and ID targets read. */
export interface Drawn { name: string; linear: Linear; ids: Ids }
/** The four documents drawn in one `deep-gpu run`, under the planted program when one is named. */
export function drawPlates(bin: string, out: string, planted?: GpuPlanted): Record<Variant, Drawn> {
  const variants: Variant[] = ['occlusion_0', 'occlusion_1', 'no_operator', 'no_environment'];
  const docs = variants.map((v) => ({ name: `${v}${planted ? ` (--planted ${planted})` : ''}`, doc: plateDoc(v) }));
  const calls = docs.map((d, i) => ({ call: 'view3d', frames: 1, capture: [0], doc: writeJson(out, variants[i]!, d.doc), look: LOOK, size: SIZE, targets: ['final', 'linear', 'ids'] } as JsonObject));
  const replies = runGpu(bin, out, calls, planted);
  const drawn = replies.map((r, i): Drawn => {
    const { name } = docs[i]!;
    const f = frame0(r, name);
    return { name, linear: readLinear(out, f.linear, SIZE, `${name}: linear`), ids: readIds(out, f, `${name}: ids`) };
  });
  return { occlusion_0: drawn[0]!, occlusion_1: drawn[1]!, no_operator: drawn[2]!, no_environment: drawn[3]! };
}

// ---------------------------------------------------------------------------------------------------
// The check

/** How many 10-bit code values `got` is from `want`: 1/1023 of max(1, |want|) per code, on linear values (#429's,
 * #431's and #432's reading). A non-finite value is infinitely far unless both are the same. */
export function codes10(got: number, want: number): number {
  if (!Number.isFinite(got) || !Number.isFinite(want)) return Object.is(got, want) ? 0 : Infinity;
  return (Math.abs(got - want) * 1023) / Math.max(1, Math.abs(want));
}

/** The fixture holds before anything is judged, so no comparison can pass on a part that isn't there or isn't lit
 * (README: Readings). Every value read from the frames without an operator, which no planted occlusion touches. */
export function fixtureFailures(d: Record<Variant, Drawn>): string[] {
  const out: string[] = [];
  const mean = (dr: Drawn, part: string): { n: number; lum: number } => {
    let n = 0; let sum = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      if (!insideAt(dr.ids, part, x, y, 1)) continue;
      n++; sum += lum(dr.linear.at(x, y));
    }
    return { n, lum: n ? sum / n : 0 };
  };
  const plateLit = mean(d.no_operator, PLATE_ID); const plateSun = mean(d.no_environment, PLATE_ID);
  const squareSun = mean(d.no_environment, SQUARE_ID);
  if (plateSun.n < 20_000) out.push(`${d.no_environment.name}: only ${plateSun.n} interior plate pixels drawn (20,000 needed)`);
  if (plateLit.n < 20_000) out.push(`${d.no_operator.name}: only ${plateLit.n} interior plate pixels drawn (20,000 needed)`);
  if (squareSun.n < 2_000) out.push(`${d.no_environment.name}: only ${squareSun.n} interior square pixels drawn (2,000 needed)`);
  if (plateSun.lum < 0.1) out.push(`${d.no_environment.name}: the sun barely lights the plate, mean luminance ${plateSun.lum.toFixed(4)} (at least 0.1 needed)`);
  if (plateLit.lum - plateSun.lum < 0.05) {
    out.push(`the environment and the probe add only ${(plateLit.lum - plateSun.lum).toFixed(4)} to the plate's mean luminance (${d.no_operator.name} ${plateLit.lum.toFixed(4)}, ${d.no_environment.name} ${plateSun.lum.toFixed(4)}; at least 0.05 needed)`);
  }
  if (squareSun.lum < 0.3) out.push(`${d.no_environment.name}: the square's mean luminance is ${squareSun.lum.toFixed(4)}, so its emission barely shows (at least 0.3 needed)`);
  return out;
}

/** A pixel more than one code off: its worst channel. */
export interface Miss { x: number; y: number; channel: 'R' | 'G' | 'B'; got: number; want: number; codes: number }
/** One part of one pair: how many of its interior pixels were compared, how many are off, the worst darker and the
 * worst brighter pixel, and the first few off. Bounded whatever the count, so a program wrong on every pixel fails at
 * the assertion, not in the harness. */
export interface Matched { pair: string; part: string; compared: number; over: number; darker: Miss | null; brighter: Miss | null; first: Miss[] }
function match(pair: string, got: Drawn, want: Drawn, part: string): Matched {
  const m: Matched = { pair, part, compared: 0, over: 0, darker: null, brighter: null, first: [] };
  const channels = ['R', 'G', 'B'] as const;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    if (!insideAt(got.ids, part, x, y, 1) || !insideAt(want.ids, part, x, y, 1)) continue;
    m.compared++;
    const a = got.linear.at(x, y); const b = want.linear.at(x, y);
    let worst: Miss | null = null;
    for (let c = 0; c < 3; c++) {
      const k = codes10(a[c]!, b[c]!);
      if (k > 1 && (worst === null || k > worst.codes)) worst = { x, y, channel: channels[c]!, got: a[c]!, want: b[c]!, codes: k };
    }
    if (worst === null) continue;
    m.over++;
    if (m.first.length < 3) m.first.push(worst);
    if (worst.got < worst.want) { if (m.darker === null || worst.codes > m.darker.codes) m.darker = worst; }
    else if (m.brighter === null || worst.codes > m.brighter.codes) m.brighter = worst;
  }
  return m;
}
/** A miss as a failure line, naming the pixel. */
export function missLine(m: Matched, miss: Miss): string {
  const way = miss.got < miss.want ? 'darker' : 'brighter';
  return `${m.pair}: ${m.part} pixel (${miss.x}, ${miss.y}) ${miss.channel} reads ${miss.got.toFixed(5)} where the reference reads ${miss.want.toFixed(5)}, ${miss.codes.toFixed(1)} 10-bit codes off (${way})`;
}

/** The criterion's check: the plate and the square under the occlusion-0 operator match, within one 10-bit code value
 * on every interior pixel and channel, the same plate with the environment and the probe removed and no operator;
 * under the occlusion-1 operator they match the plate with no operator. */
export interface Checked { results: Matched[]; over: number; failures: string[] }
export function occlusionCheck(d: Record<Variant, Drawn>): Checked {
  const pairs: [string, Drawn, Drawn][] = [
    [`${d.occlusion_0.name} against ${d.no_environment.name}`, d.occlusion_0, d.no_environment],
    [`${d.occlusion_1.name} against ${d.no_operator.name}`, d.occlusion_1, d.no_operator],
  ];
  const results = pairs.flatMap(([pair, got, want]) => [PLATE_ID, SQUARE_ID].map((part) => match(pair, got, want, part)));
  const failures: string[] = [];
  for (const m of results) {
    if (m.over === 0) continue;
    failures.push(`${m.pair}: ${m.over} of ${m.compared} interior ${m.part} pixels are more than one 10-bit code value off`);
    if (m.darker) failures.push(`  the most darkened: ${missLine(m, m.darker)}`);
    if (m.brighter) failures.push(`  the most brightened: ${missLine(m, m.brighter)}`);
    for (const miss of m.first) failures.push(`  in reading order: ${missLine(m, miss)}`);
  }
  return { results, over: results.reduce((s, m) => s + m.over, 0), failures };
}
/** Each pair compares at least this many interior pixels of each part, so neither match can pass on a part left out. */
export const MIN_COMPARED: Record<string, number> = { [PLATE_ID]: 20_000, [SQUARE_ID]: 2_000 };
