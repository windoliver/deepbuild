// Test-side tools for the blind redraft of #2760's budget timing (README). `deep-gpu` (#377's binary, with #378's
// `view3d`) built once per file and driven by JSON lines; #544's assembler for the logic item's program; the document
// and look the test draws, generated here so every value is readable; the reply readers (PNG, the object-ID target);
// #378's pinhole; and the five-run budget judge, read from the perf lane's own scripts/benchmark.mjs in a child
// process with each run's load. Suites don't import each other, so what this file shares with #166's, #537's and
// #544's helpers is repeated here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this folder is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');

/** The criterion: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const ID = '#2760.6dfadd78';

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
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
const SHA = /^[0-9a-f]{64}$/;
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The machine, the load and the judge

/** Everything here draws on macOS's GPU device, the reference platform; off it, INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's GPU device; this is ${process.platform}`);
}
/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint` and `judgeLimit`), so the test
 * judges a budget exactly as the lane does without importing the lane. */
function lane(code: string, input: JsonValue): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** A run's one-minute load average, read at its start and at its end, as the lane's own runs read it. */
export interface Load { start: number; end: number }
export const loadNow = (): number => loadavg()[0]!;
/** The lane's `judgeLimit` on this machine's fingerprint, with one load per run in the runs' order. */
function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads: loads as unknown as JsonValue }), 'judgeLimit');
}
/** Why a timing can't count on this machine now (off the reference Macs, off mains, Low Power Mode, thermal state, or
 * loaded past its core count, as the lane's `judgeLimit` reads them), or '' when it can: the judge on five empty
 * readings, each with the load read now at its start and end. */
export function timingProblem(): string {
  const now = loadNow();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** One budget judged by the lane's rule on five runs after a warm-up, each with its load: PASS passes, FAIL fails, and
 * INCONCLUSIVE or BLOCKED fails `INCONCLUSIVE:` with its reason, never a pass. */
export function judge(name: string, limit: number, runs: number[], loads: Load[]): void {
  const v = judgeLimit(limit, runs, loads);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit}, the load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (v['status'] === 'PASS') return;
  expect(v['status'], `FAIL: ${line}`).not.toBe('FAIL');
  inconclusive(line);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu` built once per file and copied out of the target folder; #544's assembler, built in place.

const PINNED = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const path = existsSync(PINNED) ? `${process.env['PATH'] ?? ''}${delimiter}${PINNED}` : process.env['PATH'];
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...env } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const GPU_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
/** `deep-gpu`, built before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2760-ac8-bin-'));
    error = cargo(GPU_ARGS, REPO);
    if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(error, `deep-gpu builds: cargo ${GPU_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2760-ac8-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A logic item's program: its bytes and their SHA-256, which the item names. */
export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(HERE, '..', '544', 'wat');
/** Assembles WebAssembly text with #544's assembler (tests/acceptance/544/wat, read only: the `wat` crate, each module
 * validated before it is written), built under target/acceptance-2760-wat. */
export function assemble(name: string, text: string): Program {
  const target = join(TARGET, 'acceptance-2760-wat');
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: target });
  expect(error, '#544\'s assembler (tests/acceptance/544/wat) builds').toBe('');
  const dir = mkdtempSync(join(tmpdir(), 'deep-2760-ac8-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const r = spawnSync(join(target, 'debug', 'acceptance-544-wat'), [dir, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(r.status, `the assembler takes ${name}: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    return { name, bytes, sha: sha256(bytes) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A file `view3d` reads by SHA-256, written under `dir`: its entry in the call's `assets`. */
export function putAsset(dir: string, bytes: Uint8Array, ext: string): Record<string, string> {
  const h = sha256(bytes);
  const path = join(dir, `${h}.${ext}`);
  writeFileSync(path, bytes);
  return { [h]: path };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario in, one line out (#377), and `view3d`'s replies (#378).

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail('deep-gpu run did not finish within 3,000 s');
  if (r.error) throw Error(`deep-gpu run: ${r.error.message}`);
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one output line').toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`deep-gpu run: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, 'deep-gpu run: the answer');
  expect(a['ok'], `deep-gpu run accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], 'deep-gpu run: replies').map((x, i) => obj(x, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}

/** `view3d` (#378), the fields this test gives: the base's, with #166's `rings` and #537's `assets`. */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; from: number; frames: number; fps: number;
  capture?: number[]; targets?: ('final' | 'ids')[]; timings?: boolean; rings?: boolean; assets: Record<string, string>;
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame row of `view3d`: its index, pixel hash, and the row as given. */
export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
/** A reply the binary answered, not refused, as its frames; INCONCLUSIVE when it says the platform can't draw. */
export function framesOf(reply: JsonObject, what: string): Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    expect(hash, `${what}: frames[${i}].pixel_hash is a SHA-256`).toMatch(SHA);
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: hash, raw: f };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 20).map((x) => x.frame).join(', ')}…)`).toBeDefined();
  return f!;
}
/** Each frame's GPU time (`timings: true`). */
export const gpuMs = (frames: Frame[], what: string): number[] => frames.map((f) => num(f.raw['gpu_ms'], `${what}: frame ${f.frame}'s gpu_ms`));

// ---------------------------------------------------------------------------------------------------
// PNG in: the final picture and the object-ID target

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#418's reader). */
function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
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
/** A target of a captured frame, a PNG under `out` named by its SHA-256, of the call's size. */
export function readTarget(out: string, f: Frame, target: 'final' | 'ids', size: readonly [number, number], what: string): Image {
  const h = str(f.raw[target], `${what}: frame ${f.frame}'s ${target} (a file named by its SHA-256)`);
  expect(h, `${what}: frame ${f.frame}'s ${target} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.png`));
  expect(sha256(file), `${what}: frame ${f.frame}'s ${target} hashes to its name`).toBe(h);
  const image = decodePng(file);
  expect([image.width, image.height], `${what}: frame ${f.frame}'s ${target} has the call's size`).toEqual([...size]);
  return image;
}
/** The object-ID target (#378) as one pick ID a pixel, r + 2⁸ g + 2¹⁶ b + 2²⁴ a, 0 where nothing draws, and the pick
 * ID the frame's `picks` gives the item `id`. */
export function pickOf(f: Frame, id: string, what: string): number {
  const entry = Object.entries(obj(f.raw['picks'], `${what}: frame ${f.frame}'s picks`)).find(([, item]) => item === id);
  expect(entry, `${what}: frame ${f.frame}'s picks name ${id}: ${shown(f.raw['picks'])}`).toBeDefined();
  return Number(entry![0]);
}
export const pickAt = (ids: Image, x: number, y: number): number => {
  const o = (y * ids.width + x) * 4;
  return (ids.rgba[o]! + ids.rgba[o + 1]! * 256 + ids.rgba[o + 2]! * 65_536 + ids.rgba[o + 3]! * 16_777_216) >>> 0;
};
/** Whether pixel (x, y) differs between two pictures of one size, in any of red, green and blue. */
export const differs = (a: Image, b: Image, x: number, y: number): boolean => {
  const o = (y * a.width + x) * 4;
  return a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2];
};

// ---------------------------------------------------------------------------------------------------
// The look and the document (README: The fixture)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** The physical-basis `look@1` the base's water suites time in: filmic, as a film would be, with no bloom and no
 * finish, so a pixel's color is a function of that pixel alone. */
export const FILMIC: JsonObject = {
  id: 'filmic-2760', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #2760 budget look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
  themes: { light: {}, dark: {} }, fonts: FONTS,
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
};

/** A scene document as the issue's suite writes one (suite-surface: Documents): every item in the one writer layer
 * `main`, camera `cam`, seed 2760, 12 s at 60 frames a second, the scene3d and logic modules required. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #2760 acceptance fixture.`, size: [...size], camera: 'cam', seed: 2760,
    transport: { span: '12s', frame_rate: [60, 1], sample_rate: 48000 }, requires: { modules: { scene3d: '^1', logic: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, items: withIds,
  };
}
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle of `grid` cells in its own XZ plane at
 * y = 0, facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A day sky with a gray ambient gradient (#166's). */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A logic item as #537 and #544 write one: its program by SHA-256 at 60 steps a second, reading nothing, emitting
 * `emits` (Logic: occurrences). */
export const logicItem = (program: Program, emits: JsonObject): JsonObject =>
  ({ kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: [], emits } });

// ---------------------------------------------------------------------------------------------------
// #378's pinhole: position, target, +Y up, fov across the wider side; frame coordinates continuous, (0, 0) the top
// left corner of the top left pixel, so pixel (i, j)'s centre is (i + 0.5, j + 0.5).

export interface Cam { position: V3; target: V3; fov: number; size: [number, number] }
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const focal = (cam: Cam): number => Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
function basis(cam: Cam): { f: V3; r: V3; u: V3 } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}
/** Where the camera draws the world point `p`. */
export function project(cam: Cam, p: V3): [number, number] {
  const { f, r, u } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal(cam) * dot(d, r)) / z, cam.size[1] / 2 - (focal(cam) * dot(d, u)) / z];
}
/** Where pixel (i, j)'s centre ray meets the plane y = 0, as (x, z). */
export function onPlane(cam: Cam, i: number, j: number): [number, number] {
  const { f, r, u } = basis(cam);
  const a = (i + 0.5 - cam.size[0] / 2) / focal(cam); const b = (cam.size[1] / 2 - (j + 0.5)) / focal(cam);
  const ray: V3 = [f[0] + a * r[0] + b * u[0], f[1] + a * r[1] + b * u[1], f[2] + a * r[2] + b * u[2]];
  const s = -cam.position[1] / ray[1];
  return [cam.position[0] + s * ray[0], cam.position[2] + s * ray[2]];
}
export const camItem = (cam: Cam): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near: 0.1, far: 1000 } });
