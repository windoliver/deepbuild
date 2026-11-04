// Test-side tools for the #1173 acceptance tests: `deep-gpu` (#377's binary) built once and driven by JSON lines
// through #378's `view3d` (with #380's effects, #386's `surface`) and #379's `canonical`, with the reply fields this
// suite adds (README: The surface under test); the documents and looks the scenarios draw, generated here so every
// item is readable; PNG reading and writing (copied from #1174's helpers, since suites don't import each other); and
// this suite's own measures: partial coverage along a box's edge, the surface's sample count against its targets', and
// 2 × 2 blocks of identical pixels inside a puff's soft edge. Each check a criterion's wrong program must fail returns
// its failures as sentences naming what failed. Nothing here stands in for the multisampling, the resolve or the
// upsample under test.

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
/** The checkout root (tests/acceptance/1173 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

/** C1: "drawn at 4× MSAA"; the count the surface reports on the reference platform's Metal device. */
export const MSAA = 4;

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

// ---------------------------------------------------------------------------------------------------
// The machine: these pixels come from the GPU layer on macOS's Metal device, the reference platform.

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const onMetal = (): boolean => process.platform === 'darwin';
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else INCONCLUSIVE. Power and load are not gated (the owner's rule). */
export function requireMetal(): void {
  if (!onMetal()) inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu`, the shipped feature set, built once per file (only where it can draw).

/** `cargo build --locked --bin deep-gpu` in `root`, into `targetDir` when given; '' or cargo's error. */
export function cargoBuild(root: string, targetDir?: string): string {
  const args = ['build', '--locked', '--bin', BIN];
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...(targetDir ? { CARGO_TARGET_DIR: targetDir } : {}) };
  const r = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} in ${root} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/**
 * Builds `deep-gpu` once, before the file's tests, and copies it out of `target/debug`; a test that uses a build that
 * failed fails with cargo's error. Off macOS nothing is built: every test there is INCONCLUSIVE before it draws.
 */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    if (!onMetal()) return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1173-bin-'));
    error = cargoBuild(REPO);
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), join(dir, BIN));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1173-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'single_sample_targets' | 'claims_msaa_over_single_sample' | 'puff_block_copy' | 'resolve_accumulates_frames';

/** One scenario `{out, calls}` in one process, accepted, with one reply per call. */
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
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

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
/** An 8-bit RGB PNG of `image`'s color (no filter, zlib level 9): the same bytes for the same pixels. */
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
/** The slot's bytes as `pixel_hash` hashes them (#377's): BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) { bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!; }
  return sha256(bgra);
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** A copy of the rectangle [x, y, w, h] of `image`, clamped inside it. */
export function crop(image: Image, [x, y, w, h]: [number, number, number, number]): Image {
  const x0 = Math.max(0, Math.min(image.width - w, x)); const y0 = Math.max(0, Math.min(image.height - h, y));
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(image.rgba.subarray(((y0 + r) * image.width + x0) * 4, ((y0 + r) * image.width + x0 + w) * 4), r * w * 4);
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

// ---------------------------------------------------------------------------------------------------
// Looks

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1` for a 3D writer layer: tone map none at the exposure whose scale is 1, the finish at identity. */
function look(id: string, palette: Record<string, string>, roles: Record<string, string>, extra: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #1173 acceptance look ${id}.`,
    palette, roles, themes: { light: {}, dark: {} }, fonts: FONTS,
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' }, ...extra,
  };
}
/** C1, C2, C4: a teal box on paper (#386's `PLAIN_LOOK` palette). */
export const BOX_LOOK = look('box-1173', { paper: '#f7f6f2', ink: '#16181d', teal: '#2a7f86' }, { ground: 'paper', ink: 'ink', accent: 'teal' });
/** C3: a near-white puff on a night ground. */
export const PUFF_LOOK = look('puff-1173', { night: '#101114', graphite: '#1b1d22', mist: '#f2f2f2', stone: '#6e6e6e' }, { ground: 'night', ink: 'graphite', puff: 'mist', src: 'stone' });
/** C5: #380's acceptance look (fixtures/look.json there), with its bloom and ground grid on, as #380's `all` scene draws. */
export const SCENE_LOOK = look('scene-1173', {
  graphite: '#1b1d22', slate: '#8b8f97', lagoon: '#1aa3c8', night: '#101114', stone: '#6e6e6e', 'warm-white': '#fff4e0', orange: '#ff8a1e',
  teal: '#20c0b0', 'grey-154': '#9a9a9a', 'grey-208': '#d0d0d0', blue: '#4080ff', amber: '#ffd040', ember: '#ff6020', violet: '#8a50ff', mist: '#f2f2f2',
}, {
  ground: 'night', ink: 'graphite', muted: 'slate', accent: 'lagoon', floor: 'stone', lamp: 'warm-white', block: 'orange', crate: 'teal', post: 'violet',
  'grid-minor': 'grey-154', 'grid-major': 'grey-208', 'grid-axis': 'blue', 'spark-a': 'amber', 'spark-b': 'ember', puff: 'mist',
}, {
  bloom: { intensity: 0.3, radius: 0.85 },
  ground_3d: { kind: 'grid', height: 0.001, spacing: 1, major_every: 5, width: 1, fade: 'auto', roles: { minor: 'grid-minor', major: 'grid-major', axis: 'grid-axis' } },
});

// ---------------------------------------------------------------------------------------------------
// Documents. view3d takes #378's shape (an `id`, writer layers, each item in a layer); `canonical` takes the writer's
// payload (#393's deep_show document: no `id`, no `layers`, no item `layer`), made by `payload`.

export const WRITER = 'agent-a';
export const LIVE_WRITER = 'agent:alpha';
function scene(id: string, title: string, size: [number, number], span: string, items: JsonObject, modules: string[] = ['scene3d'], extra: JsonObject = {}): JsonObject {
  for (const v of Object.values(items)) if (isObject(v)) v['layer'] = 'main';
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a #1173 acceptance fixture.`, size, camera: 'cam', transport: { span },
    requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items, ...extra,
  };
}
const box = (id: string, order: string, size: [number, number, number], pos: [number, number, number], role: string, rot?: [number, number, number]): JsonObject =>
  ({ id, kind: 'mark.box@1', name: id, order, params: { size, paint: { fill: { role } } }, at: { pos, ...(rot ? { rot } : {}) } });
const sun = (rot: [number, number, number], shadow = false): JsonObject =>
  ({ id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a9', params: { illuminance: Math.PI, shadow, angle: 0.53 }, at: { rot } });
const linear = (target: string, from: number, to: number, span: string): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: span, value: to, interp: 'linear' } } });

/** C1, C2, C4's view: 640 × 480. */
export const BOX_VIEW: [number, number] = [640, 480];
export const BOX_FPS = 30;
export const BOX_FRAMES = 30;
/**
 * The box: a 3 m teal box at the origin, seen face on by an orthographic camera looking along −Z, 8 m across the
 * 640 px view (80 px a metre, so its face is a 240 px square), lit face on by a sun shining along −Z, on the look's
 * paper ground. A channel rolls it about the view axis from 10° at t 0 to 40° at t 1 s, so every frame's silhouette
 * is a square turned off the pixel grid, and frames differ (a seek is a seek).
 */
export function boxDoc(): JsonObject {
  return scene('box-1173', 'A box turning face on', BOX_VIEW, '1s', {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: 8 } },
    box: box('box', 'a1', [3, 3, 3], [0, 0, 0], 'accent', [0, 0, 10]),
    sun: sun([0, 0, 0]),
  }, ['scene3d'], { channels: { roll: linear('items/box/at/rot/2', 10, 40, '1s') } });
}

/** C3's view: 640 × 480, and the frame it reads (t 1.5 s at 30 fps). */
export const PUFF_VIEW: [number, number] = [640, 480];
export const PUFF_FRAME = 45;
/** The emitter C3 reads; its failures name it. */
export const EMITTER = 'puffs';
/**
 * A half-resolution puff emitter (`particles@1`, `draw: puff`, `resolution: half`): a handful of large near-white
 * puffs (80 px across) drifting slowly around a small stone box, on a night ground, under a still perspective camera.
 * Without `puffs`, the same scene with the emitter left out (what the puffs add is read against it).
 */
export function puffDoc(puffs = true): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 10, distance: 9 }, fov: 45, near: 0.1 } },
    src: box('src', 'a1', [0.2, 0.2, 0.2], [0, 0, 0], 'src'),
  };
  if (puffs) {
    items[EMITTER] = {
      id: EMITTER, kind: 'particles@1', name: 'Puffs', order: 'b0',
      params: {
        count: 8, emit: { anchor: 'src', shape: 'sphere', radius: 1.6, rate: 4, span: 3 }, life: [3, 3],
        motion: { drift: { amplitude: 0.3, frequency: 0.3 } }, size: 80, opacity: 1,
        color: [{ at: 0, role: 'puff' }, { at: 1, role: 'puff' }], draw: 'puff', resolution: 'half',
      },
      at: { pos: [0, 0, 0] },
    };
  }
  return scene(`puff-1173${puffs ? '' : '-bare'}`, 'Half-resolution puffs', PUFF_VIEW, '3s', items, ['scene3d', 'effects'], { seed: 7 });
}

/** The writer's payload of a view3d document, as `canonical` takes it. */
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}

// C5's scenes, at 960 × 540: the screenshot audit's three (README: Fixtures).
export const SHOT_VIEW: [number, number] = [960, 540];
/** The city: #386's grid of boxes (`cityDoc` there), cut to 24 × 24 blocks of varied heights, under a sun, seen from above at an angle. */
export function cityDoc(): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 60 }, fov: 40, near: 0.1 } },
    sun: sun([-55, -40, 0]),
  };
  const side = 24;
  for (let i = 0; i < side * side; i++) {
    const id = `b-${String(i).padStart(3, '0')}`;
    items[id] = box(id, `b${String(i).padStart(4, '0')}`, [1, 1 + (i % 7) * 0.5, 1], [((i % side) - side / 2) * 1.5, (1 + (i % 7) * 0.5) / 2, (Math.floor(i / side) - side / 2) * 1.5], i % 3 === 0 ? 'accent' : 'muted');
  }
  return scene('city-1173', 'The city', SHOT_VIEW, '1s', items);
}
/** The effects scene: #380's `all` scene (a lamp box on a floor with two boxes, a casting sun, sparks, the lamp selected, bloom and the grid) with half-resolution puffs beside it. */
export function effectsDoc(puffs = true): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0.4, 0], orbit: { azimuth: 30, elevation: 25, distance: 7 }, fov: 40, near: 0.1 } },
    floor: box('floor', 'a1', [12, 0.1, 12], [0, -0.05, 0], 'floor'),
    lamp: box('lamp', 'a2', [1, 1, 1], [0, 0.5, 0], 'lamp'),
    block: box('block', 'a3', [0.6, 0.6, 0.6], [-1.6, 0.3, 0.8], 'block'),
    crate: box('crate', 'a4', [0.7, 0.7, 0.7], [1.4, 0.35, -0.6], 'crate'),
    sun: sun([-55, -40, 0], true),
    sparks: {
      id: 'sparks', kind: 'particles@1', name: 'Sparks', order: 'b0',
      params: { count: 2048, emit: { anchor: 'lamp', shape: 'point', rate: 1200, span: 10 }, life: [0.8, 1.6], motion: { ballistic: { v0: [2, 4], gravity: [0, -9.8, 0], drag: 0.2 } }, size: 3, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }], draw: 'dot' },
      at: { pos: [0, 1.05, 0] },
    },
  };
  if (puffs) {
    items['puffs'] = {
      id: 'puffs', kind: 'particles@1', name: 'Puffs', order: 'b1',
      params: { count: 8, emit: { anchor: 'block', shape: 'sphere', radius: 0.6, rate: 4, span: 3 }, life: [3, 3], motion: { drift: { amplitude: 0.2, frequency: 0.3 } }, size: 48, opacity: 1, color: [{ at: 0, role: 'puff' }, { at: 1, role: 'puff' }], draw: 'puff', resolution: 'half' },
      at: { pos: [-1.6, 1.4, 0.8] },
    };
  }
  return scene(`effects-1173${puffs ? '' : '-bare'}`, 'The effects scene', SHOT_VIEW, '3s', items, ['scene3d', 'effects'], { seed: 7 });
}
/** The house: #420's small house (two walls meeting at a corner, a door, a floor slab with the stair's well, a gable roof, a stair), under a sun. */
export function houseDoc(): JsonObject {
  const wall = (id: string, order: string, a: [number, number], b: [number, number]): JsonObject =>
    ({ id, kind: 'arch.wall@1', name: id, order, params: { a, b, thickness: 0.2, height: 2.7, justify: 'center', outside: 'left', cut_height: 1.2 } });
  return scene('house-1173', 'The house', SHOT_VIEW, '1s', {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [3, 1, 1.5], orbit: { azimuth: 35, elevation: 25, distance: 14 }, fov: 40, near: 0.1 } },
    sun: sun([-50, -30, 0], true),
    wa: wall('wa', 'a1', [0, 0], [4, 0]),
    wb: wall('wb', 'a2', [4, 0], [4, 3]),
    door: { id: 'door', kind: 'arch.opening@1', name: 'door', order: 'a3', parent: 'wa', params: { wall: 'wa', type: 'door', at_along: 1, width: 0.9, height: 2.1, sill: 0, swing: 'in', hinge: 'left', open: 0 } },
    floor: { id: 'floor', kind: 'arch.slab@1', name: 'floor', order: 'a4', params: { outline: [[-1, -1], [9, -1], [9, 7], [-1, 7]], holes: ['stair'], thickness: 0.2 }, at: { pos: [0, -0.2, 0] } },
    roof: { id: 'roof', kind: 'arch.roof@1', name: 'roof', order: 'a5', params: { type: 'gable', size: [4.4, 3.4], pitch: 30, overhang: 0.2 }, at: { pos: [2, 2.7, 1.5] } },
    stair: { id: 'stair', kind: 'arch.stair@1', name: 'stair', order: 'a6', params: { type: 'straight', rise: 2.6, width: 0.9 }, at: { pos: [5, 0, 1] } },
  }, ['scene3d', 'building']);
}

// ---------------------------------------------------------------------------------------------------
// The calls and their replies (README: The surface under test)

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'ids')[]; selection?: string[];
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });
/** #379's `canonical` call, with this suite's `targets: ["final"]`. */
export const canonicalCall = (doc: string, look: JsonObject, size: [number, number], frame: number, purpose: Purpose): JsonObject =>
  ({ call: 'canonical', look, writer: LIVE_WRITER, doc, size, frame, fps: BOX_FPS, purpose, targets: ['final'] });
export type Purpose = 'export' | 'render_back' | 'frame_budget';

/** A target scene3d made for the view's geometry pass, with its sample count. */
export interface Made { name: string; sample_count: number }
function madeOf(v: JsonValue | undefined, what: string): Made[] {
  return arr(v, `${what}: render_targets (the targets scene3d's geometry pass was made with)`).map((t, i) => {
    const o = obj(t, `${what}: render_targets[${i}]`);
    return { name: str(o['name'], `${what}: render_targets[${i}].name`), sample_count: num(o['sample_count'], `${what}: render_targets[${i}].sample_count`) };
  });
}
export interface ViewFrame { frame: number; pixel_hash: string | null; final: string | null; ids: string | null; picks: Map<number, string> | null }
export interface View { frames: ViewFrame[]; msaa: number; internal_scale: number; targets: Made[] }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
/** A view3d reply: its frames, the sample count its `surface` reports and the targets scene3d made. */
export function viewOf(reply: JsonObject, what: string): View {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), final: optStr(f['final'], `${at}.final`), ids: optStr(f['ids'], `${at}.ids`), picks };
  });
  const s = obj(reply['surface'], `${what}: surface`);
  return { frames, msaa: num(s['msaa'], `${what}: surface.msaa (the sample count the surface reports)`), internal_scale: num(s['internal_scale'], `${what}: surface.internal_scale`), targets: madeOf(reply['render_targets'], what) };
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).slice(0, 20).join(', ')})`).toBeDefined();
  return f!;
}
/** A frame's final target, read back and held to its pixel hash. */
export function finalOf(out: string, f: ViewFrame, what: string): Image {
  const image = readPng(out, f.final, `${what}: the final target`);
  expect(slotHashOf(image), `${what}: the PNG holds the slot's bytes`).toBe(f.pixel_hash);
  return image;
}
export interface Canonical { purpose: string; frame: number; pixel_hash: string; final: Image; msaa: number; targets: Made[] }
/** A canonical reply (#379's), with this suite's `msaa`, `render_targets` and `final`. */
export function canonicalOf(out: string, reply: JsonObject, what: string): Canonical {
  answered(reply, what);
  const hash = str(reply['pixel_hash'], `${what}: pixel_hash`);
  const final = readPng(out, reply['final'], `${what}: its final target`);
  expect(slotHashOf(final), `${what}: the PNG holds the bytes its pixel hash names`).toBe(hash);
  return { purpose: str(reply['purpose'], `${what}: purpose`), frame: num(reply['frame'], `${what}: frame`), pixel_hash: hash, final, msaa: num(reply['msaa'], `${what}: msaa`), targets: madeOf(reply['render_targets'], what) };
}

// ---------------------------------------------------------------------------------------------------
// The measures

/**
 * C2: the sample count a reply reports against the targets scene3d made: the geometry pass's `color` and `depth`
 * targets are listed, and every listed target was made with the count the reply reports. Failures as sentences naming
 * both: the reply's count and each target's.
 */
export function sampleProblems(where: string, msaa: number, targets: Made[]): string[] {
  const p: string[] = [];
  for (const name of ['color', 'depth']) if (!targets.some((t) => t.name === name)) p.push(`${where}: scene3d's ${name} target isn't among the targets it reports making (${targets.map((t) => t.name).join(', ') || 'none'})`);
  for (const t of targets) if (t.sample_count !== msaa) p.push(`${where}: the surface reply says msaa ${msaa}, but scene3d's ${t.name} target was made with ${t.sample_count} sample${t.sample_count === 1 ? '' : 's'}`);
  return p;
}

/** The share of the way a color has gone from `g` toward `f`, and how far it lies off that line (largest channel, codes). */
function along(p: Rgb, g: Rgb, f: Rgb): { t: number; off: number } {
  const d = [f[0] - g[0], f[1] - g[1], f[2] - g[2]];
  const t = ((p[0] - g[0]) * d[0]! + (p[1] - g[1]) * d[1]! + (p[2] - g[2]) * d[2]!) / (d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2);
  const off = Math.max(...[0, 1, 2].map((c) => Math.abs(p[c]! - (g[c]! + t * d[c]!))));
  return { t, off };
}
export interface Coverage { boundary: number; partial: number; near: number }
/**
 * C1: the box's edge in one picture. The ground is the corner pixel's color and the face the centre pixel's (a fixture
 * check holds they differ by at least 150 codes over R, G and B). A pixel is the box's when it has gone at least half
 * way from ground to face; the boundary is the box's pixels with a 4-neighbour that isn't. A pixel has partial
 * coverage when it lies between the two, 0.15 to 0.85 of the way, within 10 codes of the line between them: at 4×
 * MSAA an edge pixel resolves to 1, 2 or 3 quarters, and single-sample it is the ground or the face.
 */
export function coverageOf(image: Image): Coverage {
  const { width: w, height: h } = image;
  const g = pixel(image, 0, 0); const f = pixel(image, w >> 1, h >> 1);
  expect(Math.abs(f[0] - g[0]) + Math.abs(f[1] - g[1]) + Math.abs(f[2] - g[2]), `the box's face ${hex(f)} stands out from the ground ${hex(g)} (fixture)`).toBeGreaterThanOrEqual(150);
  const inBox = new Uint8Array(w * h); const partial = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const { t, off } = along(pixel(image, x, y), g, f);
    if (t >= 0.5) inBox[y * w + x] = 1;
    if (t >= 0.15 && t <= 0.85 && off <= 10) partial[y * w + x] = 1;
  }
  const edge = new Uint8Array(w * h);
  let boundary = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (inBox[i] && (!inBox[i - 1] || !inBox[i + 1] || !inBox[i - w] || !inBox[i + w])) { edge[i] = 1; boundary++; }
  }
  let count = 0; let near = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (!partial[y * w + x]) continue;
    count++;
    let close = false;
    for (let dy = -2; dy <= 2 && !close; dy++) for (let dx = -2; dx <= 2; dx++) if (edge[(y + dy) * w + x + dx]) { close = true; break; }
    if (close) near++;
  }
  return { boundary, partial: count, near };
}
/** C1's bounds: partial coverage on at least 40% as many pixels as the edge's boundary, and 90% of it within 2 px of that boundary. */
export const COVERAGE = { share: 0.4, near: 0.9 };
/**
 * C1: the box's edge in the picture `where` names has partial coverage along it. Failures as sentences naming the
 * picture and the target scene3d drew its color into, with that target's sample count.
 */
export function coverageProblems(where: string, image: Image, targets: Made[]): string[] {
  const c = coverageOf(image);
  expect(c.boundary, `${where}: the box's silhouette is on screen, about 240 px a side (fixture)`).toBeGreaterThan(500);
  expect(c.boundary, `${where}: the box's silhouette is about 240 px a side (fixture)`).toBeLessThan(1500);
  const color = targets.find((t) => t.name === 'color');
  const said = color ? `scene3d's color target was made with ${color.sample_count} sample${color.sample_count === 1 ? '' : 's'}` : 'scene3d reports no color target';
  const p: string[] = [];
  if (c.partial < COVERAGE.share * c.boundary) p.push(`${where}: the box's edge has ${c.partial} pixels of partial coverage for ${c.boundary} boundary pixels, under ${COVERAGE.share * 100}%; ${said}`);
  else if (c.near < COVERAGE.near * c.partial) p.push(`${where}: only ${c.near} of ${c.partial} pixels of partial coverage lie within 2 px of the box's edge; ${said}`);
  return p;
}

/** C3's soft edge: where the puffs add between 20% and 80% of the most they add anywhere in the frame. */
export const SOFT_EDGE = { lo: 0.2, hi: 0.8 };
export interface Blocks { band: number; windows: number; identical: number; first: [number, number] | null }
/**
 * C3: the 2 × 2 blocks of identical pixels inside the puffs' soft edge. What the puffs add at a pixel is the sum over
 * R, G and B of the frame with them less the same frame without them (clamped at 0); the soft edge is the pixels where
 * that lies within SOFT_EDGE of its largest value. Every 2 × 2 window (at every offset, not only the even grid) whose
 * four pixels are all in the soft edge is counted, and so is each one whose four pixels are identical in R, G and B.
 */
export function blocksOf(withPuffs: Image, bare: Image): Blocks {
  const { width: w, height: h } = withPuffs;
  expect([bare.width, bare.height], 'the two frames are the same size').toEqual([w, h]);
  const add = new Float64Array(w * h);
  let most = 0;
  for (let i = 0; i < add.length; i++) {
    const o = i * 4;
    const a = Math.max(0, withPuffs.rgba[o]! - bare.rgba[o]!) + Math.max(0, withPuffs.rgba[o + 1]! - bare.rgba[o + 1]!) + Math.max(0, withPuffs.rgba[o + 2]! - bare.rgba[o + 2]!);
    add[i] = a; if (a > most) most = a;
  }
  const soft = new Uint8Array(w * h);
  let band = 0;
  for (let i = 0; i < add.length; i++) if (add[i]! >= SOFT_EDGE.lo * most && add[i]! <= SOFT_EDGE.hi * most && most > 0) { soft[i] = 1; band++; }
  let windows = 0; let identical = 0; let first: [number, number] | null = null;
  const same = (i: number, j: number): boolean => withPuffs.rgba[i * 4] === withPuffs.rgba[j * 4] && withPuffs.rgba[i * 4 + 1] === withPuffs.rgba[j * 4 + 1] && withPuffs.rgba[i * 4 + 2] === withPuffs.rgba[j * 4 + 2];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    if (!(soft[i] && soft[i + 1] && soft[i + w] && soft[i + w + 1])) continue;
    windows++;
    if (same(i, i + 1) && same(i, i + w) && same(i, i + w + 1)) { identical++; first ??= [x, y]; }
  }
  return { band, windows, identical, first };
}
/** C3: no 2 × 2 block of identical pixels inside the soft edge; failures as sentences naming the emitter. */
export function blockProblems(emitter: string, withPuffs: Image, bare: Image): { problems: string[]; blocks: Blocks } {
  const b = blocksOf(withPuffs, bare);
  expect(b.band, `${emitter}: the puffs draw a soft edge of at least 2,000 px (fixture)`).toBeGreaterThanOrEqual(2000);
  expect(b.windows, `${emitter}: at least 1,000 2 × 2 windows lie inside it (fixture)`).toBeGreaterThanOrEqual(1000);
  const problems = b.identical > 0 ? [`${emitter}: ${b.identical} of the ${b.windows} 2 × 2 blocks inside the half-resolution puffs' soft edge are four identical pixels, the first at (${b.first![0]}, ${b.first![1]})`] : [];
  return { problems, blocks: b };
}

// ---------------------------------------------------------------------------------------------------
// C5: the merge base's build, for the "before" screenshots.

/** The commit this checkout's change starts from: its merge base with origin/main (or main). */
export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try { return execFileSync('git', ['-C', REPO, 'merge-base', 'HEAD', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* the next ref */ }
  }
  throw Error('no merge base with origin/main or main');
}
