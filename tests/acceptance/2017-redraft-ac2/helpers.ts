// Test-side tools for the blind redraft of #2017's AC2 (README). They drive the binary as the sibling suites do:
// `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378): its `look`, `size`, `frames`, `capture`, `targets`
// (`final` and #166's `depth`) and #425's `lod`, plus the terrain rows `tests/acceptance/2017/` already assumes (README:
// Surfaces). Copied, since suites never import each other: the JSON-lines runner, #166's look shape and #425's PNG
// reading. Every number the test judges comes from the binary; the only things computed here are the fixture, the
// ground a pixel sees through the fixture's camera, and the statistics over the pictures, each one pass in bounded
// memory, whatever the number of pixels.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2017-redraft-ac2 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** `#2017.` and the first 8 hex digits of SHA-256 of the criterion's text (scripts/proof-change.mjs). */
export const ID = '#2017.e778fe83';
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function whole(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isInteger(v) && v >= 0, `${what} is a whole number ≥ 0, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS the test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: debug deep-gpu, once per file, debug info and incremental builds off, copied out of the target folder.

const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const CARGO = ['build', '--locked', '--bin', 'deep-gpu'];

function build(dir: string): { path: string; error: string } {
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', CARGO, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${CARGO.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
  const path = join(dir, 'deep-gpu');
  copyFileSync(join(target, 'debug', 'deep-gpu'), path);
  return { path, error: '' };
}
/** Builds deep-gpu before the file's tests; a test whose build failed fails with cargo's error. */
export function useDeepGpu(): () => string {
  let dir = '';
  let made = { path: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2017-ac2-bin-'));
    made = build(dir);
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(made.error, `deep-gpu builds: cargo ${CARGO.join(' ')}`).toBe('');
    return made.path;
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2017-ac2-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

/** The wrong program the criterion names, reachable only through `--planted` (README: The planted program). */
export const PLANT = 'terrain_shades_own_level_normals';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A binary that refuses its arguments (an unknown --planted) exits before reading its input: its exit is judged below.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A one-frame `view3d` reply's frame; INCONCLUSIVE where the binary says the platform can't draw. */
export function onlyFrame(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.map((f) => f['frame']), `${what}: one frame, frame 0`).toEqual([0]);
  return frames[0]!;
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(createHash('sha256').update(file).digest('hex'), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The look (#166's shape): physical basis, tone map none at the exposure whose scale is 1, nothing after it, so the
// final target's code values are the sun's light on the shading normal, encoded.

export const PLAIN: JsonObject = {
  id: 'plain-2017-ac2', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #2017 AC2 redraft look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
};

// ---------------------------------------------------------------------------------------------------
// The fixture (README: The fixture). Metres, +Y up. A terrain plate (#2014's form, `plate@1` with `params.terrain`, no
// `at`, so its own space is the world's), 4 × 4 tiles of 64 m. Tile [i, j] covers x from −128 + 64 i to −64 + 64 i and z
// likewise with j (Assumed surfaces 1 of tests/acceptance/2017/README.md).

export const PLATE_ID = 'ground';
/** The ripple: 8 cm high, 8 m long, along x. Every level from 2 up keeps samples 4 m apart or more, on its zeros, so
 * the ripple is gone from those levels' heights, and its slope of up to 3.6° must come from full detail. */
export const RIPPLE_M = 0.08;
export const RIPPLE_K = Math.PI / 4;
export const TERRAIN = {
  height: `${RIPPLE_M} * sin(position.x * ${RIPPLE_K}) + 1.5 * sin(position.x * 0.029) * cos(position.z * 0.023)`,
  size: [256, 256], spacing: 1, tile: 64, lod_levels: 6,
} as const;
const HALF = TERRAIN.size[0] / 2;
/** The picture: 960 × 540 through an orthographic camera 120 m wide, 8 px a metre. */
export const SIZE: [number, number] = [960, 540];
export const VIEW_WIDTH = 120;
const PX_PER_M = SIZE[0] / VIEW_WIDTH;
/** The document's `budget.lod_px` that puts every tile at full detail (a document may only lower the class's 1 px). */
export const LOWERED_LOD_PX = 0.01;

/** The scene: the plate in one matte grey, a sun 10° above the horizon on the +x side with no shadow, a black sky with
 * no ambient, and the camera straight down. `lowered`: the same with `budget.lod_px` lowered. */
export function plateDoc(lowered: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 100, 0], target: [0, 0, 0], view_width: VIEW_WIDTH, near: 1, far: 200 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    // A light shines along its local −Z (Rz·Ry·Rx): rot [−10, 90, 0] sends it toward −x, 10° downward.
    sun: { kind: 'light.sun@1', params: { illuminance: 12, color: [1, 1, 1], shadow: false }, at: { rot: [-10, 90, 0] } },
    grey: { kind: 'material@1', params: { base_color: [0.6, 0.6, 0.6, 1], roughness: 1, metallic: 0 } },
    [PLATE_ID]: { kind: 'plate@1', params: { terrain: { ...TERRAIN, size: [...TERRAIN.size] } }, material: 'grey' },
  };
  const withIds: JsonObject = {};
  Object.entries(items).forEach(([key, item], k) => { withIds[key] = { id: key, name: key, order: `a${String(k).padStart(4, '0')}`, layer: 'main', ...item }; });
  const id = `shaded-2017-ac2${lowered ? '-full' : ''}`;
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: the #2017 AC2 redraft's plate.`, size: [...SIZE], camera: 'cam', seed: 2017,
    requires: { modules: { scene3d: '^1' } },
    budget: lowered ? { class: 'work_product', lod_px: LOWERED_LOD_PX } : { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items: withIds,
  };
}
/** The ground (x, z) a pixel's centre sees: screen right +X, screen down +Z (the base's `screen_basis` looking down). */
export const groundX = (px: number): number => (px + 0.5 - SIZE[0] / 2) / PX_PER_M;
export const groundZ = (py: number): number => (py + 0.5 - SIZE[1] / 2) / PX_PER_M;
const tileIndex = (v: number): number => Math.floor((v + HALF) / TERRAIN.tile);
export const tileName = (i: number, j: number): string => `tile [${i}, ${j}]`;
/** The tiles the picture shows: [1, 1], [2, 1], [1, 2] and [2, 2]. No pixel centre lies on a tile's edge. */
export const TILES_IN_VIEW: string[] = (() => {
  const out: string[] = [];
  for (let j = tileIndex(groundZ(0)); j <= tileIndex(groundZ(SIZE[1] - 1)); j++) {
    for (let i = tileIndex(groundX(0)); i <= tileIndex(groundX(SIZE[0] - 1)); i++) out.push(tileName(i, j));
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------------
// One draw: the frame's tile levels, its final picture and its depth.

export interface Image { width: number; height: number; rgba: Uint8Array }
export interface Draw { levels: Map<string, number>; image: Image; depth: Float32Array }

/** Each tile's level in the frame's `lod` row for the plate (tests/acceptance/2017/README.md, Assumed surfaces 1). */
export function levelsOf(frame: JsonObject, what: string): Map<string, number> {
  const rows = arr(frame['lod'], `${what}: the frame's \`lod\``);
  const row = rows.find((r) => isObject(r) && r['item'] === PLATE_ID);
  expect(row, `${what}: the frame's \`lod\` has a row for the terrain plate ${PLATE_ID}, with its tiles (tests/acceptance/2017/README.md, Assumed surfaces 1)`).toBeDefined();
  const levels = new Map<string, number>();
  arr(obj(row, `${what}: ${PLATE_ID}'s row`)['tiles'], `${what}: ${PLATE_ID}'s tiles`).forEach((v, k) => {
    const at = `${what}: ${PLATE_ID}'s tiles[${k}]`;
    const o = obj(v, at);
    const t = arr(o['tile'], `${at}.tile`);
    expect(t.length, `${at}.tile is [i, j]`).toBe(2);
    const name = tileName(whole(t[0], `${at}.tile[0]`), whole(t[1], `${at}.tile[1]`));
    const level = whole(o['level'], `${at}.level`);
    expect(level, `${at}: ${name}'s level is one of its ${TERRAIN.lod_levels}`).toBeLessThan(TERRAIN.lod_levels);
    expect(levels.has(name), `${what}: ${name} has one row, not two`).toBe(false);
    levels.set(name, level);
  });
  for (const name of TILES_IN_VIEW) expect(levels.has(name), `${what}: the plate's row has ${name}, which the picture shows`).toBe(true);
  return levels;
}
/** `view3d`'s `depth` target (#166): f32 a pixel, rows top-down, the distance in m along the view axis. */
export function decodeDepth(file: Buffer, what: string): Float32Array {
  expect(file.length, `${what}: one f32 a pixel`).toBe(SIZE[0] * SIZE[1] * 4);
  const out = new Float32Array(SIZE[0] * SIZE[1]);
  for (let k = 0; k < out.length; k++) out[k] = file.readFloatLE(4 * k);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The comparison: one pass over the pixels, holding a fixed number of sums and one record per tile in view.

export interface TileChange {
  tile: string; from: number; to: number;
  /** Its pixels; those whose color moves by more than one code value in a channel; the worst move and where. */
  pixels: number; over: number; worst: number; at: [number, number];
  /** The largest change of its drawn depth between the two draws, in m. */
  moved: number;
}
export interface Comparison {
  /** The tiles in view whose level differs between the two draws, in TILES_IN_VIEW's order. */
  changed: TileChange[];
  /** Their pixels, and of them those with a channel at 0 or 255 in either draw. */
  compared: number; clipped: number;
  /** Mean green of draw B where the ripple's slope faces the sun (cos(k x) ≤ −0.7) and where it faces away (≥ 0.7). */
  facing: number; away: number;
}

export function compare(a: Draw, b: Draw): Comparison {
  const tiles = new Map<string, TileChange>();
  for (const tile of TILES_IN_VIEW) {
    const from = a.levels.get(tile)!; const to = b.levels.get(tile)!;
    if (from !== to) tiles.set(tile, { tile, from, to, pixels: 0, over: 0, worst: 0, at: [0, 0], moved: 0 });
  }
  let compared = 0; let clipped = 0;
  let facingSum = 0; let facingN = 0; let awaySum = 0; let awayN = 0;
  const { width, height } = a.image;
  for (let py = 0; py < height; py++) {
    const j = tileIndex(groundZ(py));
    for (let px = 0; px < width; px++) {
      const x = groundX(px);
      const t = tiles.get(tileName(tileIndex(x), j));
      if (!t) continue;
      const k = py * width + px; const o = 4 * k;
      let d = 0; let clip = false;
      for (let c = 0; c < 3; c++) {
        const u = a.image.rgba[o + c]!; const v = b.image.rgba[o + c]!;
        d = Math.max(d, Math.abs(u - v));
        if (u === 0 || u === 255 || v === 0 || v === 255) clip = true;
      }
      compared++; t.pixels++;
      if (clip) clipped++;
      if (d > 1) { t.over++; if (d > t.worst) { t.worst = d; t.at = [px, py]; } }
      const dz = Math.abs(a.depth[k]! - b.depth[k]!);
      if (Number.isFinite(dz) && dz > t.moved) t.moved = dz;
      const phase = Math.cos(RIPPLE_K * x); const g = b.image.rgba[o + 1]!;
      if (phase <= -0.7) { facingSum += g; facingN++; } else if (phase >= 0.7) { awaySum += g; awayN++; }
    }
  }
  return { changed: [...tiles.values()], compared, clipped, facing: facingSum / Math.max(1, facingN), away: awaySum / Math.max(1, awayN) };
}
/** The criterion's judge: each tile that changed level whose pixels' lit color moved by more than one code value in a
 * channel, named, with its levels, how many pixels moved and the worst. */
export function lightFailures(c: Comparison): string[] {
  return c.changed.filter((t) => t.over > 0).map((t) =>
    `${t.tile} (level ${t.from} → ${t.to}): ${t.over} of its ${t.pixels} pixels change their lit color by more than one code value, the worst by ${t.worst} at pixel (${t.at[0]}, ${t.at[1]})`);
}

// ---------------------------------------------------------------------------------------------------
// PNG reading (#425's): 8-bit RGB or RGBA, no interlace.

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
  return { width, height, rgba };
}
