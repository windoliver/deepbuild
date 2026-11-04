// Test-side tools for the #1174 acceptance tests: `deep-gpu` (#377's binary) built once and driven by JSON lines
// through the calls the base already has (#378's `view3d` with #386's `surface`, #385's `layers`); the documents and
// the look the scenarios draw; PNG reading and writing; the reference-Mac gate (copied from #386's helpers, since
// suites don't import each other); and this suite's own measures: a glyph mask from an ink-on-paper picture, the
// shard view's label regions, and the screenshots the taste call is made on. Each check a criterion's wrong program
// must fail returns its failures as sentences naming what failed. Nothing here stands in for the label pass, the
// 2D path or the upscale under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1174 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

/** AC1 and AC3: "within 8 codes". */
export const MASK_CODES = 8;
/** AC2: "within 4 codes". */
export const INK_CODES = 4;
/** The look's ink and paper (#386's acceptance look, the one the Nov 3 audit drew: "against ink #16181d"). */
export const INK: Rgb = [0x16, 0x18, 0x1d];
export const PAPER: Rgb = [0xf7, 0xf6, 0xf2];

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

// ---------------------------------------------------------------------------------------------------
// The machine: the proof line's "on the reference Mac", through macOS's Metal device.

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The reference Macs (technical design: The reference Macs). */
export const REFERENCE_MODELS = ['Mac15,7', 'Mac15,12'];
export function machineModel(): string | null {
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
/** The proof runs on a reference Mac, on its Metal device; anywhere else INCONCLUSIVE. Power and load are not gated (the owner's rule). */
export function requireReferenceMac(): void {
  if (process.platform !== 'darwin') inconclusive(`the proof runs on the reference Mac's Metal device; this is ${process.platform}`);
  const model = machineModel();
  if (!model || !REFERENCE_MODELS.includes(model)) inconclusive(`not a reference Mac (Mac15,7 or Mac15,12): hw.model is ${model}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, the shipped feature set, built once per file.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds `deep-gpu` once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1174-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test (documents, targets), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1174-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The one wrong program this suite adds (README: Planted programs). */
export type Planted = 'labels_before_upscale';

/** One scenario `{out, calls}`, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
  const name = `${BIN} ${args.join(' ')}`;
  if (r.error) throw Error(`${name}: ${r.error.message}`);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((v, i) => obj(v, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Pictures

export type Rgb = [number, number, number];
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export interface Image { width: number; height: number; /** RGBA, row-major, straight alpha. */ rgba: Uint8Array }

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
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
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

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
/** An 8-bit RGB PNG of `image`'s color (no filter, zlib level 9), the same bytes for the same pixels. */
export function encodePng(image: Image): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

/** A file the binary wrote into `out`, named by its SHA-256, read as a PNG. */
export function readPng(out: string, hash: JsonValue | undefined, what: string): Image {
  const h = str(hash, `${what}: its file`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.png`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return decodePng(file);
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The largest per-channel difference, in 8-bit codes, between two colors. */
export const codes = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
/** A copy of the rectangle [x, y, w, h] of `image`. */
export function crop(image: Image, [x0, y0, w, h]: [number, number, number, number]): Image {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(image.rgba.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba: out };
}
/** Pictures set left to right on a mid-grey strip, `gap` px apart, each pixel drawn `zoom` × `zoom` (nearest). */
export function sideBySide(images: Image[], zoom = 1, gap = 8): Image {
  const width = images.reduce((s, im) => s + im.width * zoom, 0) + gap * (images.length + 1);
  const height = Math.max(...images.map((im) => im.height * zoom)) + 2 * gap;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([128, 128, 128, 255], i);
  let left = gap;
  for (const im of images) {
    for (let y = 0; y < im.height * zoom; y++) for (let x = 0; x < im.width * zoom; x++) {
      const s = (Math.floor(y / zoom) * im.width + Math.floor(x / zoom)) * 4;
      rgba.set([im.rgba[s]!, im.rgba[s + 1]!, im.rgba[s + 2]!, 255], ((gap + y) * width + left + x) * 4);
    }
    left += im.width * zoom + gap;
  }
  return { width, height, rgba };
}

/**
 * A glyph mask from an ink-on-paper picture, in 8-bit codes: at each pixel, how far it has gone from the picture's
 * own ground (its top-left pixel) toward the ink, summed over R, G and B, as a share of the whole way, times 255,
 * rounded and clamped to 0 … 255. Ink composited at coverage a over the ground in the space the picture is encoded in
 * reads a × 255; a pixel of the ground reads 0 and one of the ink 255.
 */
export function maskOf(image: Image, ink: Rgb = INK): Uint8Array {
  const ground = pixel(image, 0, 0);
  const whole = (ground[0] - ink[0]) + (ground[1] - ink[1]) + (ground[2] - ink[2]);
  expect(whole, `the picture's ground ${hex(ground)} is lighter than the ink ${hex(ink)}`).toBeGreaterThan(300);
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    const gone = (ground[0] - image.rgba[o]!) + (ground[1] - image.rgba[o + 1]!) + (ground[2] - image.rgba[o + 2]!);
    out[i] = Math.min(255, Math.max(0, Math.round((255 * gone) / whole)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The look: #386's acceptance look (`PLAIN_LOOK`), the ink and paper the audit measured, tone map none at the
// exposure whose scale is 1; for `layers`, the same roles as #391's role map.

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
export const LOOK: JsonObject = {
  id: 'plain-1174', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #1174 acceptance look: ink #16181d on paper #f7f6f2.',
  palette: { paper: hex(PAPER), ink: hex(INK) }, roles: { ground: 'paper', paper: 'paper', ink: 'ink' }, themes: { light: {}, dark: {} }, fonts: FONTS,
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
};
export const ROLE_MAP: JsonObject = { light: { ground: [...PAPER], paper: [...PAPER], ink: [...INK] } };

// ---------------------------------------------------------------------------------------------------
// Documents

export const WRITER = 'agent-a';
const MAIN: JsonObject = { main: { writer: WRITER, title: 'Main', order: 'a0' } };
const camera = (viewWidth: number): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: viewWidth } });
const label = (id: string, order: string, text: string, size: number, pos: [number, number, number]): JsonObject =>
  ({ id, kind: 'mark.text@1', name: text, order, layer: 'main', params: { text, size, font: 'body', paint: { fill: { role: 'ink' } } }, at: { pos } });
function scene(id: string, title: string, description: string, size: [number, number], items: JsonObject): JsonObject {
  return { format: 1, id, profile: 'scene', title, description, size, camera: 'cam', transport: { span: '1s' }, requires: { modules: { scene3d: '^1' } }, layers: MAIN, items };
}

/** AC1's text: the shard view's label, at text@1's default size. */
export const AC1_TEXT = 'Shard 7 lag 33.5 ms';
export const AC1_SIZE = 13;
/** AC1's view: 320 × 96 px under an orthographic camera 3.2 m across (100 px a metre). */
export const AC1_VIEW: [number, number] = [320, 96];
/**
 * AC1's label in depth: one screen-size `mark.text@1`, 13 px, in ink, its centre projected off the device grid at
 * (160.37, 48.61) px, so a label that isn't snapped to it lands between pixels.
 */
export function labelScene(): JsonObject {
  return scene('label-1174', 'One label in depth', 'One 13 px label in ink on paper, facing the camera.', AC1_VIEW, {
    cam: camera(3.2),
    label: label('label', 'b0', AC1_TEXT, AC1_SIZE, [0.0037, -0.0061, 0]),
  });
}
/** Where AC1's 2D text sits: its layout box's top left, on the device grid, near the label's place in depth. */
export const AC1_2D_AT: [number, number] = [100, 40];
/** AC1's 2D twin: the same text, font, size and paint as a text@1 in a 2D writer layer over a paper rect the view's size. */
export function labelBoard(): JsonObject {
  const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
  return {
    format: 1, id: 'label-1174-2d', profile: 'figure', title: 'One label in 2D', description: 'The same 13 px label as text in a 2D writer layer.', size: AC1_VIEW, layers: MAIN,
    items: {
      paper: item('paper', 'rect@1', 'a0', { box: [0, 0, AC1_VIEW[0], AC1_VIEW[1]], paint: { fill: { role: 'paper' } } }),
      label: item('label', 'text@1', 'a1', { text: AC1_TEXT, font: 'body', size: AC1_SIZE, paint: { fill: { role: 'ink' } } }, { at: { pos: [AC1_2D_AT[0], AC1_2D_AT[1], 0] } }),
    },
  };
}

/** The shard view (#386's 1080p frame of 12 px labels, the Nov 3 audit's): 1920 × 1080, 32 m across (60 px a metre). */
export const HD: [number, number] = [1920, 1080];
const WORDS = ['Throughput', 'Latency p95', 'Queue depth', 'Cache hits', 'Retries', 'Shard 7 lag', 'Writes/s', 'GC pause'];
export interface ShardLabel { id: string; text: string; /** Its centre in device px, from the camera. */ at: [number, number] }
/** The shard view's 48 labels on a 6 × 8 grid, #386's texts and places; `t-32` is "Shard 7 lag 33.5 ms". */
export const SHARD_LABELS: ShardLabel[] = Array.from({ length: 48 }, (_, k) => {
  const r = Math.floor(k / 6); const c = k % 6;
  const x = -13.5 + c * 5.4; const y = 7.2 - r * 2.05;
  return { id: `t-${r}${c}`, text: `${WORDS[(r + c) % WORDS.length]} ${(r * 37 + c * 11) % 100}.${(r + c) % 10} ms`, at: [HD[0] / 2 + 60 * x, HD[1] / 2 - 60 * y] };
});
export const SHARD_LABEL = 't-32';
/** The shard view's labels alone (no lines, no motion): 12 px, in ink, on paper. */
export function shardScene(): JsonObject {
  const items: JsonObject = { cam: camera(32) };
  for (const l of SHARD_LABELS) {
    const r = Number(l.id[2]); const c = Number(l.id[3]);
    items[l.id] = label(l.id, `b${r}${c}`, l.text, 12, [-13.5 + c * 5.4, 7.2 - r * 2.05, 0]);
  }
  return scene('shard-1174', 'The shard view\'s labels', 'Forty-eight 12 px labels in ink on paper.', HD, items);
}
/** A label's region in the shard view: 320 × 80 px about its centre (labels are 324 px and 123 px apart), clipped to the view. */
export function regionOf(l: ShardLabel): [number, number, number, number] {
  const x0 = Math.max(0, Math.round(l.at[0] - 160)); const y0 = Math.max(0, Math.round(l.at[1] - 40));
  const x1 = Math.min(HD[0], Math.round(l.at[0] + 160)); const y1 = Math.min(HD[1], Math.round(l.at[1] + 40));
  return [x0, y0, x1 - x0, y1 - y0];
}
/**
 * The shard view's regions read what they should, at scale 1 (fixture checks): every label's region holds ink
 * (at least 100 pixels of mask 32 or more), and no ink lies outside every region. Failures as sentences.
 */
export function regionProblems(frame: Image): string[] {
  const mask = maskOf(frame);
  const owned = new Uint8Array(mask.length);
  const p: string[] = [];
  for (const l of SHARD_LABELS) {
    const [x0, y0, w, h] = regionOf(l);
    let ink = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { owned[y * HD[0] + x] = 1; if (mask[y * HD[0] + x]! >= 32) ink++; }
    if (ink < 100) p.push(`${l.id} "${l.text}": only ${ink} ink pixels in its region at scale 1`);
  }
  let stray = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]! >= 32 && !owned[i]) stray++;
  if (stray > 0) p.push(`${stray} ink pixels at scale 1 lie outside every label's region`);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The calls

export interface SurfaceSpec { internal_scale: number; upscale?: 'edge_adaptive' | 'bilinear'; sharpen?: number }
/** #378's view3d, one frame, its final target written. */
export const view3dCall = (doc: string, size: [number, number], surface?: SurfaceSpec): JsonObject =>
  ({ call: 'view3d', doc, look: LOOK, size, from: 0, frames: 1, capture: [0], targets: ['final'], ...(surface ? { surface: surface as unknown as JsonObject } : {}) });
/** The frame a view3d reply drew: its final target, and the internal scale and upscale the view drew through. */
export function viewFrame(out: string, reply: JsonObject, what: string): { image: Image; scale: number; upscale: string } {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  expect(frames.length, `${what}: one frame`).toBe(1);
  const image = readPng(out, frames[0]!['final'], `${what}: the final target`);
  const s = obj(reply['surface'], `${what}: surface`);
  return { image, scale: num(s['internal_scale'], `${what}: surface.internal_scale`), upscale: str(s['upscale'], `${what}: surface.upscale`) };
}
/** #385's `layers`, the 2D writer layer drawn by GPUI and by Vello CPU. */
export const layersCall = (doc: JsonObject): JsonObject => ({ call: 'layers', doc, look: ROLE_MAP, by: ['gpui', 'vello_cpu'] });
/** The 2D path's picture of the board's one writer layer: the side drawn by the path the live view picks for it. */
export function twoD(out: string, reply: JsonObject, what: string): { path: string; image: Image } {
  answered(reply, what);
  const layers = arr(reply['layers'], `${what}: layers`).map((v, i) => obj(v, `${what}: layers[${i}]`));
  expect(layers.length, `${what}: one writer layer`).toBe(1);
  const path = layers[0]!['path'];
  if (path === undefined || typeof path !== 'string') expect.fail(`${what}: the live view draws the layer by no path: ${shown(path)}`);
  expect(['gpui', 'vello_cpu'], `${what}: the live view's path for the layer is one the call drew`).toContain(path);
  const side = obj(obj(layers[0]!['drawn'], `${what}: drawn`)[path], `${what}: drawn.${path}`);
  if (side['code'] === 'unsupported_platform') inconclusive(`${what}: ${path} answered unsupported_platform`);
  const image = readPng(out, side['png'], `${what}: the layer by ${path}`);
  let clear = 0;
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) clear++;
  expect(clear, `${what}: the paper rect covers the layer, so its picture is opaque`).toBe(0);
  return { path, image };
}
