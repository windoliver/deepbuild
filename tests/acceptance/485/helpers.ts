// Test-side tools for the #485 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #421's shading core and light policy, #422's sky and the castle, #429's operators as items, #446's shadows), built once
// per file and driven by JSON lines, and the merge base's, exported and built apart; `deep-show` built per Cargo feature
// set, with its startup refusal and its `registry`, `registries`, `schedule` and `deep show` calls (#200's surfaces);
// the light responses, planted programs and fields this suite adds (README: Assumed surfaces); the fixtures the criteria
// name; and PNG reading. Copied in part from #486's, #446's, #422's and #200's helpers, since suites don't import each
// other. Nothing here stands in for the renderer, the light loop or the seal: every pixel read here is the renderer's,
// and the CPU references are `reference.ts`.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { towardSun, type Pinhole, type V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/485 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #485.6dd30866',
  2: 'AC2 #485.f339bc40',
  3: 'AC3 #485.ec6476de',
  4: 'AC4 #485.008d1e79',
  5: 'AC5 #485.d789e487',
  6: 'AC6 #485.8b6d2f45',
  7: 'AC7 #485.05404a40',
  8: 'AC8 #485.977f4f15',
} as const;

/** Generous: each file builds its binaries, and AC1's and AC7's build the merge base, in their first test. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${shown(value)}`).toBe('string');
  return value as string;
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}
/** Whether a value's JSON text holds `needle`. */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function readJson(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);
}

/** No failures; the message lists the first 40. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names` (each as a substring): what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
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
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: cargo in a checkout, the pinned toolchain added to PATH (as #166's and #486's suites do, for a shell that
// has rustup's toolchains but no cargo on its PATH), no incremental cache and no debug info unless the caller says.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));
function cargo(root: string, args: string[], extra: NodeJS.ProcessEnv = {}): string {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0', ...extra };
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const GPU_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];

/** Builds the candidate's deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-485-bin-'));
    error = cargo(REPO, GPU_ARGS);
    if (error === '') copyFileSync(join(targetOf(REPO, process.env), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${GPU_ARGS.join(' ')}`).toBe(''); return join(dir, exe('deep-gpu')); };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-485-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The merge base: `git merge-base HEAD origin/main`, the program before this change (#200's way). */
export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** The merge base exported whole by `git archive` into the (git-ignored) target folder, kept so later runs build warm. */
function baseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-485-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  return dir;
}
let base: { sha: string; root: string; bin: string } | null = null;
/** The merge base's deep-gpu, built once per process in its own checkout and target folder; `root` holds its files. */
export function baseGpu(): { sha: string; root: string; bin: string } {
  if (base) return base;
  const sha = mergeBase();
  const root = baseCheckout(sha);
  const target = join(root, 'target');
  const error = cargo(root, GPU_ARGS, { CARGO_TARGET_DIR: target });
  expect(error, `the merge base ${sha.slice(0, 12)}'s deep-gpu builds in ${root}`).toBe('');
  const bin = join(root, exe('deep-gpu-base'));
  copyFileSync(join(target, 'debug', exe('deep-gpu')), bin);
  base = { sha, root, bin };
  return base;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'light_drops_fresnel' | 'ambient_adds_nz' | 'loop_shadow_one' | 'loop_calls_cut_lights' | 'loop_world_normal' | 'loop_view_away';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], `${name}: replies`);
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378) as at the base: targets `final` (the frame's 8-bit PNG, the pixels `pixel_hash` hashes), `linear` (the 3D
// writer layers' linear target, before exposure and the tone map) and `ids` (the object-ID target, with `picks`); `packs`
// (#422); `light_cut` (#425: the shaded lights with their weights, and those left out). Frame n is drawn at t = n ÷ fps.

export type Target = 'final' | 'linear' | 'ids';
export interface View3d { doc: string; look: JsonObject; size: Size; targets: Target[]; frames?: number; fps?: number; packs?: string[]; light_cut?: boolean }
export function view3dCall(v: View3d): JsonObject {
  const frames = v.frames ?? 1;
  return { call: 'view3d', frames, capture: Array.from({ length: frames }, (_, i) => i), ...(v as unknown as JsonObject) };
}
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
function readLinear(out: string, hash: JsonValue | undefined, size: Size, what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}

export interface Image { width: number; height: number; rgba: Uint8Array }
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
  return { width, height, rgba };
}
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named through `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
function readIds(out: string, frame: JsonObject, what: string): Ids {
  const png = decodePng(readNamed(out, frame['ids'], 'png', `${what}: ids`));
  const picks = new Map(Object.entries(obj(frame['picks'], `${what}: picks, the item each pick ID stands for`)).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) (a (2r + 1)² block) shows `id`. */
export function within(ids: Ids, id: string, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

/** One drawn frame: what the call asked for, read and checked against its name. */
export interface Frame { frame: number; pixelHash: string; final: Buffer | null; linear: Linear | null; ids: Ids | null; notices: JsonObject[]; lightCut: JsonObject | null }
export function framesOf(out: string, reply: JsonObject, size: Size, what: string): Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i) => {
    const at = `${what}: frame ${String(f['frame'] ?? i)}`;
    return {
      frame: num(f['frame'], `${at}.frame`),
      pixelHash: str(f['pixel_hash'], `${at}.pixel_hash`),
      final: f['final'] === undefined ? null : readNamed(out, f['final'], 'png', `${at}: final`),
      linear: f['linear'] === undefined ? null : readLinear(out, f['linear'], size, `${at}: linear`),
      ids: f['ids'] === undefined ? null : readIds(out, f, at),
      notices: f['notices'] === undefined ? [] : objs(f['notices'], `${at}.notices`),
      lightCut: f['light_cut'] === undefined ? null : obj(f['light_cut'], `${at}.light_cut`),
    };
  });
}
/** Each call's frame 0, drawn in one process. */
export interface Doc { name: string; doc: JsonObject | string; look: JsonObject; size: Size; packs?: string[] }
export function drawFirst(bin: string, out: string, docs: Doc[], targets: Target[], planted?: Planted): Frame[] {
  const file = (d: Doc, i: number): string => (typeof d.doc === 'string' ? d.doc : writeJson(out, `${i}-${d.name.replace(/[^A-Za-z0-9_-]+/g, '-')}`, d.doc));
  const calls = docs.map((d, i) => view3dCall({ doc: file(d, i), look: d.look, size: d.size, targets, ...(d.packs ? { packs: d.packs } : {}) }));
  return runGpu(bin, out, calls, planted).map((r, i) => {
    const d = docs[i]!;
    const f = framesOf(out, r, d.size, d.name).find((x) => x.frame === 0);
    expect(f, `${d.name}: frame 0 is in the reply`).toBeDefined();
    return f!;
  });
}

const fmt = (c: readonly number[]): string => `[${c.map((x) => x.toFixed(5)).join(', ')}]`;
export const fmtRgb = fmt;
/** Two frames of one fixture against each other by pixel hash; a difference names the fixture and its first differing
 * pixel, in row order, from the final targets the hashes cover. */
export function hashFailures(fixture: string, got: Frame, want: Frame, what: string): string[] {
  if (got.pixelHash === want.pixelHash) return [];
  const head = `${fixture}: ${what}: pixel hash ${got.pixelHash.slice(0, 16)}… where ${want.pixelHash.slice(0, 16)}… is wanted`;
  if (!got.final || !want.final) return [`${head}; no final target to find the first differing pixel in`];
  const a = decodePng(got.final); const b = decodePng(want.final);
  if (a.width !== b.width || a.height !== b.height) return [`${head}; the frames are ${a.width} × ${a.height} and ${b.width} × ${b.height}`];
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    if (a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2] || a.rgba[o + 3] !== b.rgba[o + 3]) {
      const x = i % a.width; const y = Math.floor(i / a.width);
      const px = (im: Image): string => `rgba(${[...im.rgba.subarray(o, o + 4)].join(', ')})`;
      return [`${head}; its first differing pixel is pixel (${x}, ${y}): ${px(a)} where ${px(b)}`];
    }
  }
  return [`${head}; the final targets hold the same pixels`];
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

const STATUS: JsonObject = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape) with the tone map and exposure (EV100) given and the look's ao off. */
export function look(tone: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-485-${tone}-${exposure}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #485 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone, exposure, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1 (#378's and #421's acceptance look). */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));

export const WRITER = 'agent:sess-485';
const SCENE3D: JsonObject = { scene3d: '^1' };
const WITH_EFFECTS: JsonObject = { scene3d: '^1', effects: '^1' };
/** A scene document as a session holds it (#378): one writer layer, every item in it, the showpiece class (which takes
 * material operators and soft and local shadows). It requires scene3d, and effects when it holds a material operator. */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  const operators = Object.values(items).some((i) => i['kind'] === 'gpu.material@1');
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #485 acceptance fixture.`, size, camera: 'cam', transport: { span: '4s' },
    requires: { modules: operators ? { ...WITH_EFFECTS } : { ...SCENE3D } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** #378's pinhole `camera@1`: fov across the wider side, +Y up. */
export const camera = (position: V3, target: V3, fov: number, far = 30): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far } });
export const material = (params: JsonObject, op?: string): JsonObject => ({ kind: 'material@1', params: op ? { ...params, op } : params });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A smooth `ball@1` (Builder: `ball {radius, segments}`). */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 128 }, at: { pos }, material: mat });
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
export const sun = (illuminance: number, rot: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false, ...params }, at: { rot } });
export const point = (power: number, pos: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], ...params }, at: { pos } });
export const spot = (power: number, pos: V3, rot: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.spot@1', params: { power, color: [1, 1, 1], ...params }, at: { pos, rot } });
/** A black sky with no ambient and no environment: the document's lights are the only light. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };

// ---------------------------------------------------------------------------------------------------
// Light responses (README: Assumed surfaces 1): a material operator's `light` and `ambient`, each the name of a step
// function (`core.light@1`, `core.ambient@1`) or a graph `{steps, outputs: {radiance}}` whose steps read the response's
// inputs by name, as a step function's body reads its in ports.

export type Response = string | JsonObject;
/** A `gpu.material@1` item (#429's form) with its light responses, and any outputs of its own. */
export function responseOp(about: string, light: Response, ambient: Response, steps: JsonObject = {}, outputs: JsonObject = {}): JsonObject {
  return { kind: 'gpu.material@1', params: { origin: 'composed', about, inputs: {}, steps, outputs, cost: { ns_per_px: 50 }, light, ambient } };
}
const vec3 = (value: V3): JsonObject => ({ op: 'const@1', args: { value, type: 'vec3' } });
const step = (op: string, args: JsonObject): JsonObject => ({ op, args });
/** A response that returns `value` for every call. */
export const constant = (value: V3): JsonObject => ({ steps: { c: vec3(value) }, outputs: { radiance: 'c' } });
export const ZERO = constant([0, 0, 0]);
/** AC2's cel light: base_color × radiance × min(floor(3 × max(dot(n, l), 0) × shadow), 2) ÷ 2. */
export const CEL_LIGHT: JsonObject = {
  steps: {
    ndl: step('dot@1', { a: 'n', b: 'l' }), facing: step('max@1', { a: 'ndl', b: 0 }), shaded: step('mul@1', { a: 'facing', b: 'shadow' }),
    thrice: step('mul@1', { a: 'shaded', b: 3 }), floored: step('floor@1', { x: 'thrice' }), band: step('min@1', { a: 'floored', b: 2 }),
    halved: step('mul@1', { a: 'band', b: 0.5 }), tint: step('mul@1', { a: 'base_color', b: 'radiance' }), out: step('mul@1', { a: 'tint', b: 'halved' }),
  },
  outputs: { radiance: 'out' },
};
/** AC5's ambient: n × 0.5 + 0.5. */
export const NORMAL_AMBIENT: JsonObject = {
  steps: { half: vec3([0.5, 0.5, 0.5]), scaled: step('mul@1', { a: 'n', b: 'half' }), out: step('add@1', { a: 'scaled', b: 'half' }) },
  outputs: { radiance: 'out' },
};
/** AC6's ambient: max(dot(n, v), 0) in every channel. */
export const FACING_AMBIENT: JsonObject = {
  steps: { ndv: step('dot@1', { a: 'n', b: 'v' }), m: step('max@1', { a: 'ndv', b: 0 }), out: step('compose@1', { x: 'm', y: 'm', z: 'm' }) },
  outputs: { radiance: 'out' },
};
/** The defaults named on a material operator that writes nothing else (AC1, AC7). */
export const DEFAULTS_OP = (): JsonObject => responseOp('#485: the default responses, named.', 'core.light@1', 'core.ambient@1');
/** The operator AC2 and AC8 shade with: the cel light and an ambient of 0, writing `base_color` for the response to read. */
export const celOp = (base: V3): JsonObject => responseOp('#485: three cel bands under the scene\'s lights.', CEL_LIGHT, ZERO, { bc: vec3(base) }, { base_color: 'bc' });

/** `doc` with `core.light@1` and `core.ambient@1` set on every material: every `material@1` item names the operator
 * `responses`, which writes nothing else; the document then requires effects too. */
export function withDefaults(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const items = obj(out['items'], 'items');
  let materials = 0;
  for (const item of Object.values(items)) {
    const i = obj(item, 'an item');
    if (i['kind'] !== 'material@1') continue;
    obj(i['params'], 'a material\'s params')['op'] = 'responses';
    materials++;
  }
  expect(materials, 'the fixture has materials to set the responses on').toBeGreaterThan(0);
  const layer = isObject(out['layers']) ? Object.keys(out['layers'])[0] : undefined;
  items['responses'] = { id: 'responses', name: 'Default responses', order: 'zzz', ...(layer ? { layer } : {}), ...DEFAULTS_OP() };
  const requires = obj(out['requires'], 'requires');
  requires['modules'] = { ...obj(requires['modules'], 'requires.modules'), effects: '^1' };
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC1 and AC7: the castle as committed (#422), drawn in its own look with its recipes, at its own size.

export const CASTLE = { doc: 'packs/examples/castle.json', look: 'packs/examples/castle.look.json', packs: 'packs/composites-1.0.0' };
/** The castle of the checkout at `root` (this one, or the merge base's export), with no response or with the defaults. */
export function castle(root: string, out: string, responses: boolean): Doc {
  const doc = readJson(join(root, CASTLE.doc));
  const size = arr(doc['size'], 'the castle\'s size').map((v) => num(v, 'a size')) as Size;
  return {
    name: responses ? 'the castle with the default responses' : 'the castle', size, look: readJson(join(root, CASTLE.look)), packs: [join(root, CASTLE.packs)],
    doc: responses ? writeJson(out, `castle-defaults-${sha256(root).slice(0, 8)}`, withDefaults(doc)) : join(root, CASTLE.doc),
  };
}

// AC1 and AC4: the house, #446's at night (README: Readings): two rooms side by side under a roof, inside x ∈ [−5, 5],
// z ∈ [−4, 4], 2.7 m tall, a wall between them, two glazed windows in the south wall; two shadowed point lamps, two
// shadowed downlights and an unshadowed lamp that keeps to its room by receivers; seen from outside through the windows.
// Its walls, floors, tables and ground are plain dielectrics, so a wrong specular lobe shows (#446's were mattes with no
// specular).
export const HOUSE = { size: [800, 500] as Size, look: look('filmic', 1.5) };
export function houseDoc(): JsonObject {
  const h = 2.7; const wall = 'wall'; const floor = 'floor';
  const items: Record<string, JsonObject> = {
    cam: camera([9.5, 4.2, 14], [0, 1.1, 0], 40, 200),
    sky: { kind: 'sky@1', params: { top: [0.01, 0.015, 0.05, 1], low: [0.03, 0.04, 0.09, 1], ambient_top: [0.05, 0.07, 0.14], ambient_low: [0.02, 0.02, 0.03] } },
    wall: material({ base_color: [0.6, 0.58, 0.55, 1], roughness: 0.55 }), floor: material({ base_color: [0.55, 0.5, 0.45, 1], roughness: 0.45 }),
    wood: material({ base_color: [0.35, 0.24, 0.16, 1], roughness: 0.4 }), ground_mat: material({ base_color: [0.25, 0.27, 0.22, 1], roughness: 0.8 }),
    shade_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 0.6, emission: [1, 0.8, 0.55, 1], emission_strength: 6 }),
    glass: material({ base_color: [1, 1, 1, 1], roughness: 0.02, transmission: 1, ior: 1.5, shadow: 'auto' }),
    ground: box([60, 0.2, 60], [0, -0.3, 0], 'ground_mat'),
    floor_l: box([5, 0.2, 8], [-2.5, -0.1, 0], floor), floor_r: box([5, 0.2, 8], [2.5, -0.1, 0], floor),
    roof: box([10.8, 0.2, 8.8], [0, h + 0.1, 0], wall),
    wall_w: box([0.2, h, 8.4], [-5.1, h / 2, 0], wall), wall_e: box([0.2, h, 8.4], [5.1, h / 2, 0], wall),
    wall_n: box([10.4, h, 0.2], [0, h / 2, -4.1], wall), wall_m: box([0.2, h, 8], [0, h / 2, 0], wall),
    wall_s1: box([1.7, h, 0.2], [-4.35, h / 2, 4], wall), wall_s2: box([3, h, 0.2], [0, h / 2, 4], wall), wall_s3: box([1.7, h, 0.2], [4.35, h / 2, 4], wall),
    sill_l: box([2, 0.9, 0.2], [-2.5, 0.45, 4], wall), sill_r: box([2, 0.9, 0.2], [2.5, 0.45, 4], wall),
    head_l: box([2, 0.6, 0.2], [-2.5, 2.4, 4], wall), head_r: box([2, 0.6, 0.2], [2.5, 2.4, 4], wall),
    pane_l: box([2, 1.2, 0.02], [-2.5, 1.5, 4], 'glass'), pane_r: box([2, 1.2, 0.02], [2.5, 1.5, 4], 'glass'),
    table_l: box([1.4, 0.75, 0.8], [-3.6, 0.375, -2], 'wood'), table_r: box([1.4, 0.75, 0.8], [3.6, 0.375, -2], 'wood'),
    shade_l: box([0.3, 0.3, 0.3], [-2.5, 2.2, 0], 'shade_mat'), shade_r: box([0.3, 0.3, 0.3], [2.5, 2.2, 0], 'shade_mat'),
    lamp_l: point(900, [-2.5, 1.9, 0], { shadow: true, casters: 'furniture_l', radius: 0.05, range: 9 }),
    lamp_r: point(900, [2.5, 1.9, 0], { shadow: true, casters: 'furniture_r', radius: 0.05, range: 9 }),
    down_l: spot(1500, [-3.6, 2.6, -2], [-90, 0, 0], { shadow: true, inner: 25, outer: 35, range: 6 }),
    down_r: spot(1500, [3.6, 2.6, -2], [-90, 0, 0], { shadow: true, inner: 25, outer: 35, range: 6 }),
    wash: point(300, [-4.6, 2.3, 2], { receivers: 'living', range: 8 }),
  };
  const collections: JsonObject = {
    living: { members: ['floor_l', 'wall_w', 'wall_m', 'wall_s1', 'sill_l', 'head_l', 'table_l'] },
    furniture_l: { members: ['table_l'] }, furniture_r: { members: ['table_r'] },
  };
  return sessionDoc('house-night', HOUSE.size, items, {
    collections, light_policy: { soft: { method: 'pcss' }, contact: { length: 0.3, samples: 16 }, shadowed: { spots: 2, points: 2 } },
  });
}

// ---------------------------------------------------------------------------------------------------
// AC2 and AC8: the cel sphere. A 1 m sphere under one sun at 45° elevation (from the front right), shadows on, and a post
// 0.5 m square and 8 m tall standing 2.6 m from the sphere's centre toward the sun, whose shadow falls across the
// sphere's lit side; seen from the front, the post out of frame. The sphere's operator `cel` writes base_color and
// answers with the cel light and an ambient of 0; the sky is black.

export const CEL = {
  size: [512, 512] as Size,
  cam: { position: [0, 0.4, 7.5] as V3, target: [0, 0, 0] as V3, fov: 24 },
  sunRot: [-45, 60, 0] as V3, illuminance: 2, base: [0.8, 0.5, 0.3] as V3,
  post: { centre: [2.6 * Math.sin(Math.PI / 3), 2, 2.6 * Math.cos(Math.PI / 3)] as V3, size: [0.5, 8, 0.5] as V3 },
  /** Judged as in the post's shadow: the ray toward the sun meets the post shrunk by this much (m) on every side. */
  margin: 0.08,
  /** And lit enough there that, without the shadow, the cel light would put it in an upper band. */
  lit: 1 / 3 + 0.05,
};
export const celPinhole = (): Pinhole => ({ ...CEL.cam, size: CEL.size });
export const celToSun = (): V3 => towardSun(CEL.sunRot);
export function celDoc(name: string): JsonObject {
  return sessionDoc(name, CEL.size, {
    cam: camera(CEL.cam.position, CEL.cam.target, CEL.cam.fov), sky: DARK_SKY, sun: sun(CEL.illuminance, CEL.sunRot, { shadow: true }),
    cel: celOp(CEL.base), toon: material({ base_color: [...CEL.base, 1], roughness: 0.5 }, 'cel'),
    post_mat: material({ base_color: [0.5, 0.5, 0.5, 1], roughness: 0.8 }),
    ball: ball(1, [0, 0, 0], 'toon'), post: box(CEL.post.size, CEL.post.centre, 'post_mat'),
  });
}

// ---------------------------------------------------------------------------------------------------
// AC3 and AC8: the room. Five plaster boxes (back wall at z = −5, floor, ceiling and side walls) seen from inside at
// (0, 1.5, 4.5) toward the back wall's centre; 40 point lights on a grid of 8 × 5 at 2.6 m, between the eye and the
// back wall, each with a 40 m range, so every one reaches every pixel. 32 at 800 lm; the 8 whose index ≡ 3 (mod 5) at
// 2 lm, so the policy's score (power over distance squared from the view) puts them far below the cut and the 32 far
// above it: none within its 10% margin.

export const ROOM = {
  size: [480, 320] as Size, cam: { position: [0, 1.5, 4.5] as V3, target: [0, 1.5, -5] as V3, fov: 70 },
  /** The pixel read: the frame's centre, on the back wall at about (0, 1.5, −5). */
  pixel: [240, 160] as [number, number], range: 40,
};
export interface Lamp { id: string; pos: V3; power: number; cut: boolean }
export const LAMPS: Lamp[] = Array.from({ length: 40 }, (_, n) => {
  const cut = n % 5 === 3;
  return { id: `lamp_${String(n).padStart(2, '0')}`, pos: [-3.5 + (n % 8), 2.6, -4 + 1.5 * Math.floor(n / 8)] as V3, power: cut ? 2 : 800, cut };
});
/** The room with every surface under the operator `op` (its item given), its material `plaster`. */
export function roomDoc(name: string, op: string, opItem: JsonObject): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera(ROOM.cam.position, ROOM.cam.target, ROOM.cam.fov), sky: DARK_SKY,
    [op]: opItem, plaster: material({ base_color: [0.7, 0.7, 0.7, 1], roughness: 0.8 }, op),
    back: box([12, 4.2, 0.2], [0, 1.5, -5.1], 'plaster'), floor: box([12, 0.2, 10.4], [0, -0.6, 0.1], 'plaster'),
    ceiling: box([12, 0.2, 10.4], [0, 3.6, 0.1], 'plaster'), wall_l: box([0.2, 4.2, 10.4], [-6.1, 1.5, 0.1], 'plaster'),
    wall_r: box([0.2, 4.2, 10.4], [6.1, 1.5, 0.1], 'plaster'),
  };
  for (const l of LAMPS) items[l.id] = point(l.power, l.pos, { range: ROOM.range, shadow: false });
  return sessionDoc(name, ROOM.size, items);
}

// ---------------------------------------------------------------------------------------------------
// AC5 and AC6: a 1 m sphere at the origin seen from eight places on an orbit of radius 3.5 m in the horizontal plane,
// azimuth 0° on +Z and a quarter orbit (90°) on +X, the frame 513 px square so the centre pixel's centre lies on the
// axis to the sphere's centre. One unshadowed sun lights it, so the light loop runs, and the sky is black.

export const ORBIT = { size: [513, 513] as Size, distance: 3.5, fov: 40, centre: [256, 256] as [number, number], azimuths: [0, 45, 90, 135, 180, 225, 270, 315] };
export const orbitPosition = (az: number): V3 => [ORBIT.distance * Math.sin((az * Math.PI) / 180), 0, ORBIT.distance * Math.cos((az * Math.PI) / 180)];
export const orbitPinhole = (az: number): Pinhole => ({ position: orbitPosition(az), target: [0, 0, 0], fov: ORBIT.fov, size: ORBIT.size });
/** The sphere under the operator `op`, whose light returns 0 and whose ambient is `ambient`, from azimuth `az`. */
export function orbitDoc(name: string, az: number, op: string, ambient: JsonObject): JsonObject {
  return sessionDoc(name, ORBIT.size, {
    cam: camera(orbitPosition(az), [0, 0, 0], ORBIT.fov), sky: DARK_SKY, sun: sun(1, [-45, 60, 0]),
    [op]: responseOp(`#485: light 0, ambient from n and v.`, ZERO, ambient), chalk: material({ base_color: [0.5, 0.5, 0.5, 1], roughness: 0.5 }, op),
    ball: ball(1, [0, 0, 0], 'chalk'),
  });
}

// ---------------------------------------------------------------------------------------------------
// deep-show (#200's surfaces): one binary per feature set, `deep-show run [--planted <name>]`, the startup refusal line.

const SHOW = 'deep-show';
/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** Builds every listed feature set once, before the file's tests (`--no-default-features --features <set>`). */
export function useShows(sets: readonly string[]): (set: string) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-485-show-'));
    for (const set of sets) {
      const bin = join(dir, `${SHOW}-${set.replace(/[^a-z0-9.-]/g, '_')}`);
      const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', set];
      const error = cargo(REPO, args);
      if (error === '') copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(SHOW)), bin);
      made.set(set, { bin, error });
    }
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (set: string): string => {
    const entry = made.get(set);
    if (!entry) throw Error(`the file didn't list the build ${set} in useShows`);
    expect(entry.error, `the binary builds: ${SHOW} with features ${set}`).toBe('');
    return entry.bin;
  };
}
export interface Started { status: number | null; signal: string | null; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], input: JsonValue): Started {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW} ${args.join(' ')}: ${run.error.message}`);
  expect(timedOut, `${SHOW} ${args.join(' ')} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, lines, stdout, stderr: run.stderr ?? '' };
}
/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-485-ev-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
// The world a scenario holds (#393, #200): an agent's session, the process table, a panel, the documents on it.
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: light responses', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const DOC_A = '01JB485D000000000000000001';
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC_A]: { panel: 'main' } }, calls,
  };
}
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], sc);
  expect(s.status, `${SHOW} run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${shown(out)}`).toBe(true);
  const replies = objs(out['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}
/** One startup with a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export const startup = (bin: string): Started => start(bin, ['run'], { evidence: tmpdir(), calls: [{ call: 'registry' }] });
/** The build sealed: exit 0. A failure carries the refusal line, so it names what the seal named. */
export function sealFailures(s: Started, what: string): string[] {
  return s.status === 0 ? [] : [`${what} did not seal: exit ${s.status}; ${s.stdout.slice(0, 1200)} ${s.stderr.slice(-400)}`];
}
/** The seal's refusal line (#305, #200): `{ok: false, code: "seal_refused", reason, registry?, entries?, modules?, what}`. */
export function refusalOf(s: Started): JsonObject | string {
  if (s.status !== REFUSED_EXIT) return `the startup exited ${s.status} (${s.signal ?? 'no signal'}), not ${REFUSED_EXIT} with the seal's refusal; stdout: ${s.stdout.slice(0, 600)}`;
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return `the refusal is not one JSON line: ${s.stdout.slice(0, 600)}`;
  const raw = s.lines[0];
  return raw['ok'] === false && raw['code'] === 'seal_refused' ? raw : `the line is not the seal's refusal: ${shown(raw)}`;
}
/** A whole revision from your shell (`deep show`) with its issues and a snapshot of `size` px: the document as your shell
 * sends it, with no `id`, no `layers` and no item `layer` (#393's payload). */
export function present(document: JsonObject, size: Size): JsonObject {
  const doc = clone(document);
  delete doc['id'];
  delete doc['layers'];
  for (const item of Object.values(obj(doc['items'], 'items'))) delete (item as JsonObject)['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc: DOC_A, document: doc, include: ['issues', 'pixels'], size };
}
/** The snapshot's pixel hash, or null where this machine can't draw it. */
export function snapshotHash(reply: JsonObject, what: string): string | null {
  if (reply['code'] === 'unsupported_platform' || mentions(reply['issues'], 'unsupported_platform')) return null;
  expect(reply['outcome'], `${what} is presented: ${shown(reply)}`).toBe('presented');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBeGreaterThan(0);
  return str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
}
/** A registry's row in deep://registries (#200): its owner and its entries' names, modules and origins. */
export interface RegistryRow { name: string; owner: string; entries: { name: string; module: string | null; origin: string }[] }
export function registryRow(reply: JsonObject, name: string): RegistryRow {
  const rows = objs(reply['registries'], 'registries: registries').filter((r) => r['kind'] === 'registry' && r['name'] === name);
  expect(rows.length, `deep://registries lists the registry ${name} once`).toBe(1);
  const r = rows[0]!;
  return {
    name, owner: str(r['owner'], `${name}.owner`),
    entries: objs(r['entries'], `${name}.entries`).map((e, i) => ({
      name: str(e['name'], `${name}.entries[${i}].name`), module: typeof e['module'] === 'string' ? e['module'] : null, origin: str(e['origin'], `${name}.entries[${i}].origin`),
    })),
  };
}
