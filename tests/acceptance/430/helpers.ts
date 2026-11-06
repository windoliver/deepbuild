// Test-side tools for the #430 acceptance tests: the base's `deep-gpu` binary, built once per file and driven by JSON
// lines; the fields this suite adds to its `layers` and `film2d` calls and its planted programs (README: The surface
// under test); the documents the tests draw; and PNG, f32 and APNG reading and writing. Nothing here stands in for the
// renderer: the pixel answers come from reference.ts or from the fixture's own rectangles.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { Eleven, Field, Rgba } from './reference.ts';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/430 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #430.e93f3c0b',
  2: 'AC2 #430.618fe52c',
  3: 'AC3 #430.09804d01',
  4: 'AC4 #430.f859c44c',
  5: 'AC5 #430.9e7e049e',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-430-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, 'deep-gpu'); };
}
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-430-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377). Each runGpu is a fresh process.

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'group_pass_at_layer_end' | 'group_pass_reads_earlier' | 'group_pass_past_grow'
  | 'backdrop_reads_other_writer' | 'backdrop_reads_later_items' | 'backdrop_past_coverage' | 'backdrop_reads_status'
  | 'vivid_light_as_linear_light' | 'dissolve_reads_playback'
  | 'pass_linear_in_2d' | 'pass_encoded_in_3d';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Pictures: 8-bit PNG (straight alpha, as `layers` and `window2d` write them) and f32 files (premultiplied).

export interface Image { width: number; height: number; rgba: Uint8Array }
export interface Floats { width: number; height: number; data: Float32Array }
export const px = (im: Image, x: number, y: number): Rgba => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!]; };
export const fx = (im: Floats, x: number, y: number): Rgba => { const o = (y * im.width + x) * 4; return [im.data[o]!, im.data[o + 1]!, im.data[o + 2]!, im.data[o + 3]!]; };
export const diff = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
export const hasFile = (out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer => {
  const name = str(hash, `${what}: its file's SHA-256`);
  const bytes = readFileSync(join(out, `${name}.${ext}`));
  expect(sha256(bytes), `${what}: the file is named by its SHA-256`).toBe(name);
  return bytes;
};
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
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
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (pred === undefined) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export function readFloats(out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): Floats {
  const bytes = hasFile(out, hash, 'f32', what);
  const [width, height] = size;
  expect(bytes.length, `${what}: an f32 file holds width × height × 16 bytes`).toBe(width * height * 16);
  const data = new Float32Array(bytes.length / 4);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readFloatLE(i * 4);
  return { width, height, data };
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An animated PNG of equal-sized frames at `fps`, looping, written by the suite: the dancing dissolve's recording. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const r = y * (width * 3 + 1) + 1 + x * 3;
      raw[r] = f.rgba[o]!; raw[r + 1] = f.rgba[o + 1]!; raw[r + 2] = f.rgba[o + 2]!;
    }
    const data = deflateSync(raw, { level: 9 });
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// `layers` (#385's call, with `float` and `packs`: README) and `film2d` (#417's, with `from` and `hash`).

export const layersCall = (doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject => ({ call: 'layers', doc, look, by: ['gpu_layer'], ...extra });
export interface BlendInput { group: string; mode: string; backdrop: Floats; source: Floats }
export interface LayerDrawn { dim: string; path: JsonValue; image: Image; sha: string; floats: Floats | null; inputs: BlendInput[] }
/** One `layers` reply, each layer's GPU-layer side read; a refused side fails. */
export function readLayers(out: string, reply: JsonObject, size: readonly [number, number], what: string): Map<string, LayerDrawn> {
  answered(reply, what);
  const read = new Map<string, LayerDrawn>();
  for (const v of arr(reply['layers'], `${what}: layers`)) {
    const l = obj(v, `${what}: layers[]`);
    const name = str(l['layer'], `${what}: layer`);
    const side = answered(obj(obj(l['drawn'], `${name}: drawn`)['gpu_layer'], `${name}: drawn.gpu_layer`), `${what}: layer ${name} on the GPU layer`);
    const sha = str(side['png'], `${name}: png`);
    read.set(name, {
      dim: str(l['dim'], `${name}: dim`), path: l['path'] ?? null, sha,
      image: decodePng(hasFile(out, sha, 'png', `${what}: ${name}`)),
      floats: side['f32'] === undefined ? null : readFloats(out, side['f32'], size, `${what}: ${name}`),
      inputs: (side['blend_inputs'] === undefined ? [] : arr(side['blend_inputs'], `${name}: blend_inputs`)).map((e, i) => {
        const b = obj(e, `${name}: blend_inputs[${i}]`);
        return { group: str(b['group'], 'group'), mode: str(b['mode'], 'mode'), backdrop: readFloats(out, b['backdrop'], size, `${name}: backdrop`), source: readFloats(out, b['source'], size, `${name}: source`) };
      }),
    });
  }
  return read;
}
export function layerOf(read: Map<string, LayerDrawn>, name: string, what: string): LayerDrawn {
  const l = read.get(name);
  expect(l, `${what}: the reply lists layer ${name}; it lists ${[...read.keys()].join(', ')}`).toBeDefined();
  return l!;
}
export const floatsOf = (l: LayerDrawn, what: string): Floats => {
  expect(l.floats, `${what}: \`float: true\` answers the side's f32 file`).not.toBeNull();
  return l.floats!;
};
/** Frame `n`'s pixel hash in a `film2d` reply. */
export function hashAt(reply: JsonObject, n: number, what: string): string {
  answered(reply, what);
  const frame = arr(reply['frames'], `${what}: frames`).map((f) => obj(f, `${what}: frames[]`)).find((f) => f['frame'] === n);
  expect(frame, `${what}: frame ${n} is in the reply`).toBeDefined();
  return str(frame!['pixel_hash'], `${what}: frame ${n}'s pixel_hash`);
}

// ---------------------------------------------------------------------------------------------------
// Documents. Every color a pixel test reads comes from this role map (#391's form, no status map), so every answer is
// set here. Its 3D form has no tone map and unit exposure.

export const ROLES: Record<string, [number, number, number]> = {
  ground: [255, 255, 255], ink: [24, 26, 31], panel: [214, 218, 224], accent: [26, 163, 200], plate: [90, 160, 110],
  magenta: [255, 0, 255], yellow: [255, 255, 0], lime: [0, 255, 0], red: [255, 0, 0], fill200: [200, 200, 200],
  'wpt.pink': [255, 127, 255], 'wpt.green': [0, 128, 0],
  'ramp.0': [0, 0, 0], 'ramp.1': [200, 120, 40], 'ramp.2': [255, 255, 255],
  's.0': [30, 60, 225], 's.1': [225, 30, 200], 's.2': [225, 40, 30], 's.3': [225, 225, 30], 's.4': [30, 225, 40],
};
export const LOOK: JsonObject = { light: ROLES };

export type Box = readonly [number, number, number, number];
export interface Rect { box: Box; role: string }
const MAIN: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a1' } };
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const rect = (id: string, order: string, r: Rect, extra: JsonObject = {}): JsonObject => item(id, 'rect@1', order, { box: [...r.box], paint: { fill: { role: r.role } } }, extra);
function document(id: string, size: readonly [number, number], items: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: id, description: `${id}: a #430 acceptance fixture.`, size: [...size], transport: { span: '4s' },
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, layers: MAIN, ...extra, items,
  };
}
/** Whether (x, y) lies in `b`. */
export const inBox = (b: Box, x: number, y: number): boolean => x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3];
export const grown = (b: Box, by: number): Box => [b[0] - by, b[1] - by, b[2] + 2 * by, b[3] + 2 * by];
export const premultiplied = (role: string): Rgba => { const c = ROLES[role]!; return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; };
/** The fixture's own rectangles painted in order over transparent, premultiplied: the reference's input. */
export const painted = (rects: readonly Rect[]): Field => (x, y) => {
  for (let i = rects.length - 1; i >= 0; i--) if (inBox(rects[i]!.box, x, y)) return premultiplied(rects[i]!.role);
  return [0, 0, 0, 0];
};

// Composed pass operators, as items of the writer's layer (#429's form: kind `gpu.pass@1`, fields in `params`). The
// target a group's pass runs on is its `core` color input: README.
const TARGET: JsonObject = { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } };
function pass(id: string, steps: JsonObject): JsonObject {
  return item(id, 'gpu.pass@1', 'z0', {
    origin: 'composed', about: `The #430 fixture ${id}.`, inputs: { src: TARGET }, steps, outputs: { color: 'out', blend: 'replace' },
    resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
  });
}
/** The mean of 25 taps on a square grid `stride` px apart, of the target's premultiplied color (reference.ts: gridBlur). */
export function gridBlurPass(id: string, stride: number): JsonObject {
  const steps: JsonObject = { pix: { op: 'pixel@1' }, p: { op: 'convert@1', args: { x: 'pix', to: 'vec2<i32>' } } };
  let last = '';
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const k = `${i + 2}${j + 2}`;
    steps[`o${k}`] = { op: 'const@1', args: { value: [i * stride, j * stride], type: 'vec2<i32>' } };
    steps[`q${k}`] = { op: 'add@1', args: { a: 'p', b: `o${k}` } };
    steps[`c${k}`] = { op: 'load@1', args: { tex: 'src', ixy: `q${k}` } };
    steps[`s${k}`] = last === '' ? { op: 'mul@1', args: { a: `c${k}`, b: 1 } } : { op: 'add@1', args: { a: last, b: `c${k}` } };
    last = `s${k}`;
  }
  steps['out'] = { op: 'div@1', args: { a: last, b: 25 } };
  return pass(id, steps);
}
/** Halves r, g and b; alpha kept. */
export const halvePass = (id: string): JsonObject => pass(id, {
  uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, out: { op: 'mul@1', args: { a: 'c', b: [0.5, 0.5, 0.5, 1] } },
});
/** Premultiplied invert: rgb to alpha less itself; alpha kept. */
export const invertPass = (id: string): JsonObject => pass(id, {
  uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
  a: { op: 'split@1', args: { x: 'c', pick: 'w' } }, av: { op: 'compose@1', args: { x: 'a', y: 'a', z: 'a', w: 0 } },
  flipped: { op: 'mul@1', args: { a: 'c', b: [-1, -1, -1, 1] } }, out: { op: 'add@1', args: { a: 'flipped', b: 'av' } },
});

// Criterion 1's figure: 240 × 160, a panel, two items drawn before the group (a bar beside it and a bar under it, which
// its opacity lets show through), the group `soft` at opacity 0.75 around one square, and a bar drawn after it across it.
export const BLUR = { size: [240, 160] as const, stride: 3, radius: 6, grow: 3, opacity: 0.75 };
export const PANEL: Rect = { box: [0, 0, 240, 160], role: 'panel' };
export const BEFORE: readonly Rect[] = [{ box: [92, 24, 5, 112], role: 'ink' }, { box: [110, 30, 4, 100], role: 'plate' }];
export const SQUARE: Rect = { box: [100, 40, 60, 80], role: 'accent' };
export const AFTER: Rect = { box: [126, 20, 5, 120], role: 'magenta' };
/** `passes`: the group's; null leaves the group and its square out. */
export function groupDoc(id: string, passes: JsonValue[] | null, more: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  const items: JsonObject = {
    panel: rect('panel', 'a0', PANEL), b0: rect('b0', 'a1', BEFORE[0]!), b1: rect('b1', 'a2', BEFORE[1]!), after: rect('after', 'a5', AFTER), ...more,
  };
  if (passes !== null) {
    items['soft'] = item('soft', 'group@1', 'a3', { opacity: BLUR.opacity, passes });
    items['square'] = rect('square', 'a4', SQUARE, { parent: 'soft' });
  }
  return document(id, BLUR.size, items, extra);
}
export const blurDoc = (id = 'blur-430'): JsonObject => groupDoc(id, [{ op: 'blur', params: {}, grow: BLUR.grow }], { blur: gridBlurPass('blur', BLUR.stride) });

// Criterion 2's layer figure: 320 × 200. Writer b's layer `under` holds a plate and two stripes under everything. In
// `main`, a panel over the left of the figure and two bars are drawn before the backdrop group; its child, never drawn,
// shapes coverage across the panel's edge; a bar is drawn after it, inside its coverage (WPT's paint-order: what is
// painted after is no part of the backdrop).
export const BACK = {
  size: [320, 200] as const, stride: 3, radius: 6, grow: 6,
  under: [{ box: [0, 0, 320, 200], role: 'plate' }, { box: [200, 0, 8, 200], role: 'yellow' }, { box: [232, 0, 8, 200], role: 'yellow' }] as readonly Rect[],
  before: [{ box: [0, 0, 170, 200], role: 'panel' }, { box: [100, 0, 6, 200], role: 'ink' }, { box: [130, 0, 6, 200], role: 'red' }] as readonly Rect[],
  coverage: { box: [60, 40, 220, 120], role: 'lime' } as Rect,
  later: { box: [146, 30, 6, 140], role: 'magenta' } as Rect,
  /** Past here, plus the blur's reach, `main` drew nothing before the group. */
  panelEnd: 170,
};
const twoWriters = (under: JsonObject, main: JsonObject): JsonObject => {
  const items: JsonObject = {};
  for (const [k, v] of Object.entries(under)) items[k] = { ...(v as JsonObject), layer: 'under' };
  return { ...items, ...main };
};
const UNDER_MAIN: JsonObject = { under: { writer: 'agent-b', title: 'Under', order: 'a0' }, ...MAIN };
export function backdropDoc(id: string, group: boolean): JsonObject {
  const main: JsonObject = {
    p: rect('p', 'a0', BACK.before[0]!), bar0: rect('bar0', 'a1', BACK.before[1]!), bar1: rect('bar1', 'a2', BACK.before[2]!), later: rect('later', 'a5', BACK.later),
  };
  if (group) Object.assign(main, {
    adj: item('adj', 'group@1', 'a3', { backdrop: 'below', passes: [{ op: 'blur', params: {}, grow: BACK.grow }] }),
    cover: rect('cover', 'a4', BACK.coverage, { parent: 'adj' }),
    blur: gridBlurPass('blur', BACK.stride),
  });
  const under = { u0: rect('u0', 'a0', BACK.under[0]!), u1: rect('u1', 'a1', BACK.under[1]!), u2: rect('u2', 'a2', BACK.under[2]!) };
  return document(id, BACK.size, twoWriters(under, main), { layers: UNDER_MAIN });
}

// WPT's backdrop-filter-clipped.html: a rounded-corner clip around the filter forms no root. Its 100 px #ff7fff box
// under a filter box with invert(1) in a parent with overflow: hidden and a tiny radius: "Expected: A green box".
export const WPT_BOX: Box = [10, 50, 100, 100];
export function wptClippedDoc(): JsonObject {
  return document('wpt-clipped-430', [120, 160], {
    color: rect('color', 'a0', { box: WPT_BOX, role: 'wpt.pink' }),
    clipper: item('clipper', 'frame@1', 'a1', { box: [...WPT_BOX], radius: 1, overflow: 'mask' }),
    adj: item('adj', 'group@1', 'a2', { backdrop: 'below', passes: [{ op: 'invert', params: {} }] }, { parent: 'clipper' }),
    // Past the frame on every side, so the mask alone shapes it whether a child reads its box from the frame or the figure.
    cover: rect('cover', 'a3', { box: [0, 0, 120, 160], role: 'lime' }, { parent: 'adj' }),
    invert: invertPass('invert'),
  });
}
// WPT's backdrop-filter-isolation-isolate.html: `isolation: isolate` forms no root. Two green boxes, one outside the
// isolated parent and one in it, under a filter in that parent: "the overlapped region of BOTH green boxes should be
// inverted (pink)". Its box-model offsets are written here as the page lays them out.
export const WPT_ISOLATION = { outside: [10, 110, 100, 100] as Box, inside: [130, 110, 100, 100] as Box, cover: [40, 140, 160, 160] as Box };
export function wptIsolationDoc(): JsonObject {
  return document('wpt-isolation-430', [260, 320], {
    outside: rect('outside', 'a0', { box: WPT_ISOLATION.outside, role: 'wpt.green' }),
    iso: item('iso', 'group@1', 'a1', { isolate: true }),
    inside: rect('inside', 'a2', { box: WPT_ISOLATION.inside, role: 'wpt.green' }, { parent: 'iso' }),
    adj: item('adj', 'group@1', 'a3', { backdrop: 'below', passes: [{ op: 'invert', params: {} }] }, { parent: 'iso' }),
    cover: rect('cover', 'a4', { box: WPT_ISOLATION.cover, role: 'lime' }, { parent: 'adj' }),
    invert: invertPass('invert'),
  });
}

// Criterion 2's window figure, in the shipped clean look: 420 × 200. `under` holds a muted plate and two ink stripes;
// `main` a raised panel on the left with two bars and the status mark `gate`, then the backdrop group across all of it
// and the card's slot. Past x = 200 + the blur's reach, inside coverage, only the other writer's pixels show.
export const GATE = 'verdict:01JB4300000000000000000001';
export const GATE_BOX: Box = [40, 90, 120, 32];
export const CARD_RECT: Box = [260, 60, 140, 90];
export const WINDOW = { size: [420, 200] as const, coverage: [30, 40, 360, 130] as Box, panelEnd: 200, grow: 6, stride: 3 };
export const CARD: JsonObject = { ask: 'ask:01JB7A0000000000000000430', question: 'Keep the backdrop group?', options: [{ id: 'keep', label: 'Keep it' }, { id: 'drop', label: 'Drop it' }], rect: [...CARD_RECT] };
export function windowDoc(group: boolean): JsonObject {
  const under = {
    u0: rect('u0', 'a0', { box: [0, 0, 420, 200], role: 'muted' }), u1: rect('u1', 'a1', { box: [240, 0, 8, 200], role: 'ink' }), u2: rect('u2', 'a2', { box: [300, 0, 8, 200], role: 'ink' }),
  };
  const main: JsonObject = {
    p: rect('p', 'a0', { box: [0, 0, WINDOW.panelEnd, 200], role: 'raised' }), m0: rect('m0', 'a1', { box: [70, 0, 6, 200], role: 'ink' }), m1: rect('m1', 'a2', { box: [130, 0, 6, 200], role: 'accent' }),
    gate: item('gate', 'rect@1', 'a3', { box: [...GATE_BOX] }),
  };
  if (group) Object.assign(main, {
    adj: item('adj', 'group@1', 'a4', { backdrop: 'below', passes: [{ op: 'blur', params: {}, grow: WINDOW.grow }] }),
    cover: rect('cover', 'a5', { box: WINDOW.coverage, role: 'accent' }, { parent: 'adj' }),
    blur: gridBlurPass('blur', WINDOW.stride),
  });
  return document('window-430', WINDOW.size, twoWriters(under, main), { profile: 'board', layers: UNDER_MAIN, status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } } });
}
export const windowCall = (doc: JsonObject, state: 'pass' | 'fail'): JsonObject => ({ call: 'window2d', doc, look: 'clean', states: { [GATE]: state }, card: CARD });

// Criterion 3's figure, after #385's: 256 × 128, a ramp across the whole figure and a group in `mode` around a rect with
// a vertical five-stop gradient at alpha 0.86, inset so the backdrop alone shows around it. The source stops sit off 0
// and 1 so divide and vivid light meet no pole by way of the gradient's ends.
export const MIX = { size: [256, 128] as const, seed: 430, group: 'mix', opacity: 0.6 };
export const SOURCE_BOX: Box = [16, 8, 224, 112];
const SOURCE_STOPS: JsonValue = ['s.0', 's.1', 's.2', 's.3', 's.4'].map((role, i) => ({ at: i / 4, role, opacity: 0.86 }));
export type Mix = 'normal' | Eleven;
const mixItems = (opts: { group?: JsonObject | null; ramp?: boolean; rampStops?: string[]; source?: JsonValue }): JsonObject => {
  const stops = opts.rampStops ?? ['ramp.0', 'ramp.1', 'ramp.2'];
  const items: JsonObject = {};
  if (opts.ramp !== false) items['ramp'] = item('ramp', 'rect@1', 'a0', { box: [0, 0, 256, 128], paint: { fill: { gradient: { kind: 'linear', stops: stops.map((role, i) => ({ at: i / (stops.length - 1), role })) } } } });
  if (opts.group !== null) {
    items[MIX.group] = item(MIX.group, 'group@1', 'a1', opts.group ?? {});
    items['src'] = item('src', 'rect@1', 'a2', { box: [...SOURCE_BOX], paint: { fill: opts.source ?? { gradient: { kind: 'linear', from: [0.5, 0], to: [0.5, 1], stops: SOURCE_STOPS } } } }, { parent: MIX.group });
  }
  return items;
};
/** The group in `mode` over the ramp. Dissolve takes the fixture's opacity. */
export const mixDoc = (mode: Mix): JsonObject =>
  document(`mix-${mode}`, MIX.size, mixItems({ group: { blend: mode, ...(mode === 'dissolve' ? { opacity: MIX.opacity } : {}) } }), { seed: MIX.seed });
export const mixBackdropDoc = (): JsonObject => document('mix-backdrop', MIX.size, mixItems({ group: null }), { seed: MIX.seed });
export const mixSourceDoc = (): JsonObject => document('mix-source', MIX.size, mixItems({ ramp: false, group: { isolate: true } }), { seed: MIX.seed });
/** A dissolve for `film2d`, which takes a shipped look: ramp and source from the clean look's roles. */
export const FILM_LOOK = 'clean';
export const danceDoc = (dancing: boolean): JsonObject => document(dancing ? 'dance-430' : 'still-dissolve-430', MIX.size, mixItems({
  rampStops: ['raised', 'accent', 'ink'], source: { gradient: { kind: 'linear', from: [0.5, 0], to: [0.5, 1], stops: [{ at: 0, role: 'session_readout' }, { at: 1, role: 'session_line' }] } },
  group: { blend: 'dissolve', dancing, opacity: MIX.opacity },
}), { seed: MIX.seed });
const FLICKS_PER_SECOND = 705_600_000;
/** The flick of frame `n` at 60 fps; `n` may hold a fraction. */
export const flickOf = (n: number): number => Math.round((n * FLICKS_PER_SECOND) / 60);

// Criterion 4's figures: an opaque fill of sRGB 200, in a group with the halving pass or none, in a 2D writer layer or,
// with a camera, a box and a sun beside it, in a 3D writer layer.
export const FILL_BOX: Box = [40, 40, 120, 80];
export function fillDoc(three: boolean, halve: boolean): JsonObject {
  const items: JsonObject = {
    tint: item('tint', 'group@1', 'a1', { passes: halve ? [{ op: 'halve', params: {} }] : [], isolate: true }),
    fill: rect('fill', 'a2', { box: FILL_BOX, role: 'fill200' }, { parent: 'tint' }),
    halve: halvePass('halve'),
  };
  const doc = document(`fill-${three ? '3d' : '2d'}-${halve ? 'halved' : 'plain'}`, [240, 160], items);
  if (three) {
    doc['profile'] = 'scene'; doc['camera'] = 'cam'; doc['requires'] = { modules: { scene3d: '^1', effects: '^1' } };
    Object.assign(items, {
      cam: item('cam', 'camera@1', 'a0', { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 6 }, fov: 40, near: 0.1 }),
      cube: item('cube', 'mark.box@1', 'a5', { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, { at: { pos: [1.5, -0.8, 0] } }),
      sun: item('sun', 'light.sun@1', 'a6', { illuminance: Math.PI, shadow: false, angle: 0.53 }, { at: { rot: [-55, -40, 0] } }),
    });
  }
  return doc;
}
