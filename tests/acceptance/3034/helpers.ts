// Test-side tools for the #3034 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`), built once per file
// and driven by JSON lines; the machine the criteria run on (the issue's `Runs on:` line); the documents and looks the
// tests draw, generated here so every value is readable; the reply readers (frames, float targets, a check's refusal);
// #378's pinhole and the geometry the criteria rest on (an angle off the view axis, a point mirrored in the water's
// plane, an angle off the vertical), each with its derivation. Suites don't import each other, so what this file
// shares with #166's and #2760's helpers is repeated here. Nothing here stands in for the water or the camera: every
// pixel, hash and refusal read is the program's own, and every expected value comes from the issue's numbers and the
// fixtures' own. Each check a planted twin must fail returns its failures as sentences naming what failed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3034 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed, `- [ ] `
 * dropped (`scripts/proof-change.mjs`: `criterionId`), from the issue's body. */
export const ID = {
  1: '#3034.e507438d', 2: '#3034.b073da51', 3: '#3034.f0c06eee', 4: '#3034.311508f3', 5: '#3034.dd678c04', 6: '#3034.20ebe811',
} as const;
/** What every `describe` and test title starts with. */
export const AC = {
  1: `AC1 ${ID[1]}`, 2: `AC2 ${ID[2]}`, 3: `AC3 ${ID[3]}`, 4: `AC4 ${ID[4]}`, 5: `AC5 ${ID[5]}`, 6: `AC6 ${ID[6]}`,
} as const;

// ---------------------------------------------------------------------------------------------------
// The issue's numbers. Every threshold a test holds is one of these.

/** Criterion 1: the bright disk's edge lies 48.8° off the axis (asin(1 ÷ 1.33), the scope's cone), within 0.5°. */
export const CONE_DEG = 48.8;
export const CONE_WITHIN_DEG = 0.5;
/** Criterion 2: the card's share of its value in air at 3 m and at 6 m from the eye in water of `depth` 3 m (the
 * scope's exp(−d ÷ depth)), each within 2% of the share. */
export const SHARE_AT = { 3: 0.368, 6: 0.135 } as const;
export const SHARE_WITHIN = 0.02;
/** Criterion 3: the mirrored ball's centroid lies within 2 px of the mirrored point. */
export const MIRROR_WITHIN_PX = 2;
/** Criterion 5: a shot that crosses the surface is compared at 20 sampled times. */
export const SAMPLED_TIMES = 20;
/** 705,600,000 flicks a second (Time and the flick): the unit a check's issue names a time in. */
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
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
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isInteger(v), `${what} is a whole number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test that is missing something outside the code (a GPU, a file of the suite's own) fails with this, never passes:
 * the word the issue's `Runs on:` line asks for where there is no GPU. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A planted twin's check: it found failures, and they name what the criterion says they name. */
export function failsNaming(failures: readonly string[], names: string[], what: string): void {
  expect(failures.length, `${what} fails the check its shipped twin passes`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) expect(text, `${what}'s failure names ${n}`).toContain(n);
}
/** `word` stands as a whole name in `text`: no letter, digit, `_` or `-` touches it. */
export const namesWord = (text: string, word: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_-]|$)`).test(text);
/** A 32-bit linear congruential generator, uniform in [0, 1): the suite's seeded samples. */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}
/** `count` of `from`, drawn without putting back, in rising order. */
export function sample(rng: Lcg, from: readonly number[], count: number): number[] {
  const pool = [...from]; const picked: number[] = [];
  while (picked.length < count && pool.length > 0) picked.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!);
  return picked.sort((a, b) => a - b);
}
export const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
export const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;

// ---------------------------------------------------------------------------------------------------
// The machine (the issue's `Runs on:` line: "A Mac of a reference model: the criteria read one machine's pixels. Without
// a GPU they read BLOCKED, never PASS").

/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint` and its `references`), so the
 * suite reads the machine exactly as the lane does without importing the lane. */
function lane(code: string): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** The machine a run's pixels are of, as the lane's `fingerprint` names it. */
export interface Machine { model: string | null; chip: string | null; memoryBytes: number | null; macosBuild: string | null }
let read: { machine: Machine; reference: boolean; names: string } | undefined;
function readMachine(): { machine: Machine; reference: boolean; names: string } {
  if (read) return read;
  const v = obj(lane('return { fingerprint: b.fingerprint(), references: b.references };'), 'the machine');
  const f = obj(v['fingerprint'], 'the machine\'s fingerprint');
  const text = (x: JsonValue | undefined): string | null => (typeof x === 'string' ? x : null);
  const machine: Machine = { model: text(f['model']), chip: text(f['chip']), memoryBytes: typeof f['memoryBytes'] === 'number' ? f['memoryBytes'] : null, macosBuild: text(f['macosBuild']) };
  const references = arr(v['references'], 'the lane\'s reference Macs').map((r, i) => obj(r, `references[${i}]`));
  const reference = references.some((r) => r['model'] === machine.model && r['chip'] === machine.chip && r['memoryBytes'] === machine.memoryBytes);
  read = { machine, reference, names: references.map((r) => String(r['name'])).join(' or ') };
  return read;
}
/** The machine this run draws on. */
export const machine = (): Machine => readMachine().machine;
/**
 * Every test starts here. The criteria read the pixels of a reference Mac's GPU: off macOS there is none, and the test
 * fails `BLOCKED:`; on a Mac that isn't one of the lane's reference models (`scripts/benchmark.mjs`: `references`, by
 * model, chip and memory) what it draws is a reading, and the test fails `INCONCLUSIVE:`. Neither is a pass. A Mac whose
 * `deep-gpu` finds no device is `BLOCKED:` too (`runGpu`, `answered`).
 */
export function requireMachine(): void {
  if (process.platform !== 'darwin') blocked(`the criteria read the pixels of a reference Mac's GPU, and this is ${process.platform}, which has none`);
  const { machine: m, reference, names } = readMachine();
  if (!reference) inconclusive(`the criteria read the pixels of a Mac of a reference model (${names}); this is ${m.model ?? 'an unnamed model'}, ${m.chip ?? 'an unnamed chip'}, ${m.memoryBytes ?? 'unknown'} bytes of memory, so what it draws is a reading`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu` built once per file and copied out of the target folder.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds `deep-gpu` before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3034-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3034-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The three wrong programs the criteria name, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'water_below_ior_one' | 'water_below_tint_by_depth' | 'water_below_sky_at_every_angle';

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  // A machine with no GPU answers `no_device` and exits 1 (main.rs): BLOCKED, since nothing was drawn.
  let first: JsonValue | undefined;
  try { first = lines[0] === undefined ? undefined : (JSON.parse(lines[0]) as JsonValue); } catch { first = undefined; }
  if (isObject(first) && first['code'] === 'no_device') blocked(`${label} found no GPU device here: ${shown(first['reason'])}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(lines.length, `${label}: one output line`).toBe(1);
  const a = obj(first, `${label}: the answer (${lines[0]!.slice(0, 600)})`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** BLOCKED when a reply says this machine has no GPU to draw it on. */
function drawable(reply: JsonObject, what: string): void {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') blocked(`${what} reports ${String(reply['code'])}: no GPU draws it here`);
}
/** A reply the binary answered, not refused (any `code`); BLOCKED when it says no GPU draws it here. A tree that holds
 * the issue's refusal and not yet its view refuses every camera under water at check, and fails here saying so. */
export function answered(reply: JsonObject, what: string): JsonObject {
  drawable(reply, what);
  const atCheck = reply['code'] === 'refused' ? ' (refused at check: where the refusal has landed and the view hasn\'t, a camera under water draws nothing)' : '';
  expect(reply['code'], `${what} was answered, not refused${atCheck}: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** The targets this suite reads, all the base's: `final` (the 8-bit PNG), `linear` (the 3D writer layers' linear target,
 * before exposure and the tone map: criterion 1's "the linear target"), and, for #166's fixtures, `pre_tone`, `depth`
 * and `reflection` as #166's suite reads them. */
export type Target = 'final' | 'linear' | 'pre_tone' | 'depth' | 'reflection';
/** `view3d` (#378) as the base has it: `from` opens the session at a frame (a cold seek), `capture` and `targets`
 * read back the frames named, `rings` is #166's (asked only where #166's own call asks it). */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; rings?: boolean;
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame row of `view3d`: its index, pixel hash, and the row as given. */
export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
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
/** The pixel hash of frame `n` of a reply. */
export const hashAt = (reply: JsonObject, n: number, what: string): string => frameAt(framesOf(reply, what), n, what).pixel_hash;
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}
/** A float target: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, as `<sha256>.f32` under `out` (#378). */
export interface Floats { width: number; height: number; v: Float32Array }
/** A captured frame's `linear` target. */
export function readLinear(out: string, f: Frame, size: readonly [number, number], what: string): Floats {
  const file = readNamed(out, f.raw['linear'], 'f32', `${what}: the linear target`);
  expect(file.length, `${what}: the linear target holds ${size[0]} × ${size[1]} pixels of four f32`).toBe(size[0] * size[1] * 16);
  const v = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < v.length; i++) v[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], v };
}
/** Rec. 709 luminance of pixel (i, j) of a linear target. */
export const lumAt = (t: Floats, i: number, j: number): number => {
  const o = (j * t.width + i) * 4;
  return 0.2126 * t.v[o]! + 0.7152 * t.v[o + 1]! + 0.0722 * t.v[o + 2]!;
};
/** The mean luminance of the (2 × half + 1)² pixels about pixel (i, j). */
export function patch(t: Floats, i: number, j: number, half: number): number {
  let s = 0;
  for (let y = j - half; y <= j + half; y++) for (let x = i - half; x <= i + half; x++) s += lumAt(t, x, y);
  return s / (2 * half + 1) ** 2;
}
/** Luminance at a continuous frame point (x, y), (0, 0) the top left corner of the top left pixel, so pixel (i, j)'s
 * centre is (i + 0.5, j + 0.5): bilinear between the four pixel centres around it, clamped at the frame's edge. */
export function lumAtPoint(t: Floats, x: number, y: number): number {
  const u = Math.min(Math.max(x - 0.5, 0), t.width - 1); const w = Math.min(Math.max(y - 0.5, 0), t.height - 1);
  const i = Math.min(Math.floor(u), t.width - 2); const j = Math.min(Math.floor(w), t.height - 2);
  const a = u - i; const b = w - j;
  return (1 - b) * ((1 - a) * lumAt(t, i, j) + a * lumAt(t, i + 1, j)) + b * ((1 - a) * lumAt(t, i, j + 1) + a * lumAt(t, i + 1, j + 1));
}

// ---------------------------------------------------------------------------------------------------
// A check's refusal: `view3d` answers a document its check refuses with `{code: "refused", issues: [Issue]}`, each
// Issue the canvas core's `{code, severity, ids, path, actual, what, fix}` (as #2760's suite reads the water's).

/** Whether a `view3d` reply is the document check's refusal; BLOCKED when it says no GPU draws it here. */
export function refusedAtCheck(reply: JsonObject, what: string): boolean {
  drawable(reply, what);
  return reply['code'] === 'refused';
}
/** The error issues of a reply the document check refused. */
export function errorIssues(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['code'], `${what} is refused at check ({code: "refused", issues}): ${shown(reply, 600)}`).toBe('refused');
  const errors = arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['severity'] === 'error');
  expect(errors.length, `${what}: the refusal holds an error issue: ${shown(reply, 600)}`).toBeGreaterThan(0);
  return errors;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: The surface under test)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1` (#421's, #166's shape). With no change it maps the scene through tone map none at the
 * exposure whose scale is 1, bloom off and no finish, so the targets carry the scene's own linear values. `issue` is
 * the suite the look is of: #166's fixtures are drawn in #166's own looks (base166.ts). */
export function look3d(id: string, change: JsonObject = {}, issue = 3034): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #${issue} acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the taste call's pictures draw in: filmic, as a film would. */
export const FILMIC = look3d('filmic-3034', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, its camera the item
 * `cam` unless `extra` names another, seeded by its suite's issue number. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}, issue = 3034): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #${issue} acceptance fixture.`, size: [...size], camera: 'cam', seed: issue,
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 1000 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A paint that shows its own color whatever the light: `unlit`, as #166's bed and post are. */
export const paint = (rgb: V3): JsonObject => material({ base_color: [...rgb, 1], unlit: true });
/** `mark.box@1`: a unit box centred on `pos`, scaled by `size`. */
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** `mark.sphere@1`: a unit sphere (1 m across) centred on `pos`, scaled by `size`: a ball `diameter` m across. */
export const ball = (diameter: number, pos: V3, mat: string): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [diameter, diameter, diameter] }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle of `grid` cells in its own XZ plane,
 * facing +Y, centred on `pos`, unturned: the water part, its surface at rest at `pos[1]`. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A black sky with no ambient: nothing but the scene's own lights and unlit parts (#166's). */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A day sky with a gray ambient gradient (#166's). */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
/** The white sky of criterion 1: white from the zenith to the horizon, lighting nothing (no ambient), so every part
 * here that shows a color is `unlit` and shows its own. */
export const WHITE_SKY: JsonObject = { kind: 'sky@1', params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A linear f32 channel on an item's path, keyed at seconds (`[t s, value]`). */
export function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}

// ---------------------------------------------------------------------------------------------------
// Material: water, with the field this issue adds (`ior`)

/** One trochoidal wave as #166 lists it. */
export interface Wave { direction: number; length: number; amplitude: number; steepness: number }
/** The `water` field, as #166 wrote it, with `ior` (the issue's Scope: "`water` gains `ior: f32 = 1.33`"). A field left
 * out takes the design's default. */
export interface Water {
  waves?: { wind: { speed?: number; direction?: number } } | Wave[];
  ripples?: { scale?: number; strength?: number };
  rain?: number;
  absorption?: { color?: V3; depth?: number };
  distort?: number;
  foam?: { threshold?: number };
  wake?: { item: string; span?: number } | 'none';
  ior?: number;
}
/** A `material@1` carrying `water` over its own mirror. */
export const waterMaterial = (water: Water, extra: JsonObject = {}): JsonObject => material({ ...extra, water: water as unknown as JsonObject });
/** Still water (#166's STILL): one wave of amplitude 0, no ripples, no rain, so the surface is the plate at rest. */
export const STILL: Water = { waves: [{ direction: 0, length: 10, amplitude: 0, steepness: 0 }], ripples: { strength: 0 }, rain: 0 };
/** Still, clear water: an absorption depth of 10 km and a black absorption color, so over the few metres a fixture
 * spans a surface keeps over 99.5% of its own color and the rest adds nothing (criteria 1 and 3 read where a thing
 * shows, criterion 2 how much it dims). */
export const CLEAR: Water = { ...STILL, absorption: { color: [0, 0, 0], depth: 10_000 } };

// ---------------------------------------------------------------------------------------------------
// #378's pinhole, as the base's camera projects (crates/deep-canvas/src/camera.rs, `Projector`): the view axis runs
// from `position` to `target`; screen right is axis × +Y (and +X where the axis is vertical, straight up or down);
// screen up is right × axis; `fov` spans the wider side of the frame, so the focal length in px is (wider ÷ 2) ÷
// tan(fov ÷ 2). Frame coordinates are continuous, (0, 0) the top left corner of the top left pixel, y down, so pixel
// (i, j)'s centre is (i + 0.5, j + 0.5) and the view axis meets the frame at its centre (w ÷ 2, h ÷ 2).

export interface Cam { position: V3; target: V3; fov: number; size: [number, number] }
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = norm(a); return [a[0] / l, a[1] / l, a[2] / l]; };
/** The focal length in px. */
export const focal = (cam: Cam): number => Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2);
function basis(cam: Cam): { f: V3; r: V3; u: V3 } {
  const f = unit(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  r = norm(r) < 1e-12 ? [1, 0, 0] : unit(r);
  return { f, r, u: cross(r, f) };
}
/** Where the world point `p` lands on the frame: with d = p − position, (w ÷ 2 + focal · (d · right) ÷ (d · axis),
 * h ÷ 2 − focal · (d · up) ÷ (d · axis)). */
export function project(cam: Cam, p: V3): [number, number] {
  const { f, r, u } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal(cam) * dot(d, r)) / z, cam.size[1] / 2 - (focal(cam) * dot(d, u)) / z];
}
export const camItem = (cam: Cam): JsonObject => camera(cam.position, cam.target, cam.fov);
/** The angle, in degrees, between the view axis and the ray through the frame point (x, y): the point lies
 * r = hypot(x − w ÷ 2, y − h ÷ 2) px from where the axis meets the frame, on a plane `focal` px from the eye, so the
 * angle is atan(r ÷ focal). */
export const offAxisDeg = (cam: Cam, x: number, y: number): number => deg(Math.atan(Math.hypot(x - cam.size[0] / 2, y - cam.size[1] / 2) / focal(cam)));
/** The distance in px from the frame's centre at which a ray `degrees` off the view axis lands: focal · tan(degrees). */
export const radiusAtDeg = (cam: Cam, degrees: number): number => focal(cam) * Math.tan(rad(degrees));

// ---------------------------------------------------------------------------------------------------
// The water's plane as a mirror, and the cone about the vertical

/** `p` mirrored in the horizontal plane y = `level` (still water's surface): its height above the plane becomes the
 * same depth below it and the reverse, x and z kept. An eye below the plane sees the mirror image of a thing below it
 * along the straight line to that point: the reflected ray's two legs, eye to surface and surface to thing, unfold
 * into it. */
export const mirrorIn = (p: V3, level: number): V3 => [p[0], 2 * level - p[1], p[2]];
/** The angle, in degrees, between the vertical (+Y) and the ray from `from` to `to`: acos of the ray's upward share.
 * A ray from an eye under still water meets the surface at this angle off its normal, so it lies inside the scope's
 * cone when the angle is under asin(1 ÷ ior), 48.8° at 1.33, and outside it when over. */
export const offVerticalDeg = (from: V3, to: V3): number => { const d = sub(to, from); return deg(Math.acos(d[1] / norm(d))); };

// ---------------------------------------------------------------------------------------------------
// The lake of criteria 4, 5 and 6: one lake, seen from above and from below by a camera keyed through its surface.

/** The lake's camera, its water part and its water's material, by ID. */
export const DIVER = 'diver';
export const LAKE = 'lake';
export const LAKE_WATER = 'lake-water';
/** The lake's waves: three trochoidal waves a few centimetres high, with the default ripples. */
export const GENTLE: Wave[] = [
  { direction: 20, length: 9, amplitude: 0.06, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.04, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.025, steepness: 0.4 },
];
/** The dive: the camera's height in m, keyed linearly from 2.0078125 m (2 m and 1/128 m) above the water's surface at
 * rest (y = 0) at 0 s to 1.9921875 m below it at 4 s, 1 m a second. Its eye is at the surface at 2.0078125 s and below
 * it at every time after, so the first time its eye is below is 2.0078125 s: `DIVE_CROSSES`, 1,416,712,500 flicks.
 * That time falls between two frames at 30 and at 60 frames a second, so no frame is drawn with the eye in the surface
 * itself (a lens half in the water isn't in this task). Every number here is exact in binary and in flicks. */
export const DIVE: [number, number][] = [[0, 2.0078125], [4, -1.9921875]];
export const DIVE_SPAN = 4;
export const DIVE_CROSSES = 2.0078125 * FLICKS;
/** The document's frame interval in flicks: its `transport.frame_rate` is 60 a second. */
export const DIVE_FRAME = FLICKS / 60;
/** The eye's height above the surface at `t` s, from the keys: negative below it. */
export const diveHeight = (t: number): number => DIVE[0]![1] + ((DIVE[1]![1] - DIVE[0]![1]) * (t - DIVE[0]![0])) / (DIVE[1]![0] - DIVE[0]![0]);
/**
 * The lake: the plate `lake`, 200 m × 200 m of 128 × 128 cells at y = 0, whose material `lake-water` carries the water
 * (three gentle waves, ripples at 0.3, an absorption depth of 8 m; `ior` only when given, so the default is the
 * design's); a sand bed 5 m down; five posts, red and white in turn, 4 m tall, standing through the surface across the
 * lake's middle; a red buoy 1.2 m under the surface and a rock on the bed; a day sky and a sun. The camera `diver` (a
 * 90° lens) stands 8 m back from the posts, aimed at a point 3 m above the water 2 m behind them, and its height is
 * keyed through the surface (`DIVE`). Above, it looks across the lake at the posts and the sky. Below, it looks up at
 * the surface from under it: its view axis climbs from 16.7° above the horizontal at 2 s to 26.6° at 4 s, and the
 * upper edge of a 16:9 frame looks 29.4° above the axis, so the cone's edge (41.2° above the horizontal at `ior`
 * 1.33, 48.2° at 1.5) crosses the upper part of the frame at every time from 2.5 s on. The document's span is the
 * dive's 4 s at 60 frames a second, and its `camera` is `diver`.
 */
export function lakeDoc(id: string, size: readonly [number, number], ior?: number): JsonObject {
  const items: Record<string, JsonObject> = {
    [DIVER]: camera([0, DIVE[0]![1], 8], [0, 3, -2], 90), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    [LAKE_WATER]: waterMaterial({ waves: GENTLE, ripples: { strength: 0.3 }, absorption: { depth: 8 }, ...(ior === undefined ? {} : { ior }) }, { roughness: 0.05 }),
    'post-red': material({ base_color: [0.85, 0.08, 0.06, 1], roughness: 0.5 }),
    'post-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.5 }),
    'bed-sand': material({ base_color: [0.62, 0.52, 0.34, 1], roughness: 0.9 }),
    'rock-grey': material({ base_color: [0.35, 0.36, 0.38, 1], roughness: 0.8 }),
    [LAKE]: plate([200, 200], [128, 128], [0, 0, 0], LAKE_WATER),
    bed: box([200, 0.4, 200], [0, -5.2, 0], 'bed-sand'),
    buoy: ball(0.8, [-1.5, -1.2, 4], 'post-red'),
    rock: box([1.5, 1, 1.2], [2, -4.5, 3], 'rock-grey'),
  };
  for (let k = 0; k < 5; k++) items[`post${k}`] = box([0.3, 4, 0.3], [-3 + 1.5 * k, 0, 0], k % 2 ? 'post-white' : 'post-red');
  return sceneDoc(id, size, items, {
    camera: DIVER, transport: { span: `${DIVE_SPAN}s`, frame_rate: [60, 1] },
    channels: { dive: channel(`items/${DIVER}/params/position/1`, DIVE) },
  });
}
/** Another `ior` than the default 1.33, whose cone (41.8° off the vertical) ends 7° inside the default's: a frame from
 * below that holds both cones' edges, as the dive's do from 2.5 s on, can't be the same picture at both. */
export const OTHER_IOR = 1.5;
/** The dive's frame at 3.5 s, with the eye 1.49 m under the surface, and at 0.5 s, 1.51 m above it, at `fps`. */
export const belowFrame = (fps: number): number => 3.5 * fps;
export const aboveFrame = (fps: number): number => 0.5 * fps;
