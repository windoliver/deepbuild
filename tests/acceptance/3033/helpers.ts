// Test-side tools for the #3033 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`), built once per file
// and driven by JSON lines, on its `--backend noop` for the wave table (no GPU) and on Metal for everything drawn; the
// documents and looks the tests draw, generated here so every value is readable; the reader of a receipt's wave table;
// the closed form the table's measures are evaluated through in f64 (heights at seeded points and times, the
// significant height, the correlation along the wind, the deep-water speed) and each criterion's check of them, which
// returns its failures as sentences naming what failed, so a planted table fails the same check; the readers of a
// frame's hashes and float targets; what a run keeps and the merge base's recorded readings; the five-run budget judge,
// read from the perf lane's own scripts/benchmark.mjs in a child process; PNG reading and writing for the still.
// Suites don't import each other, so what this file shares with #166's, #968's and #2760's helpers is repeated here.
// Nothing here stands in for the water: every table, hash, depth and time read is the program's own, and every
// expected value is the issue's, or the issue's closed form evaluated on the program's table.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3033 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#3033.b7819eb1', 2: '#3033.dbde0e46', 3: '#3033.2b265ebd', 4: '#3033.485e37d6', 5: '#3033.88aca207',
  6: '#3033.49bf9e99', 7: '#3033.5c2dc7ad',
} as const;

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
/** A test whose GPU isn't there fails with this, never passes: the issue's word for the pixel hashes and the time
 * without a GPU (its Runs on line). */
export function blocked(reason: string): never {
  throw Error(`BLOCKED: ${reason}; this is not a pass`);
}
/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A planted program's check: it found failures, and every one names what the criterion says it names. */
export function failsNaming(failures: readonly string[], names: RegExp, what: string): void {
  expect(failures.length, `${what} fails the check`).toBeGreaterThan(0);
  expect(failures.filter((f) => !names.test(f)), `every failure of ${what} names ${String(names)}`).toEqual([]);
}
/** A 32-bit linear congruential generator, x ← 1664525 x + 1013904223 mod 2³², uniform in [0, 1). */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The machine

/** Whatever a criterion draws or hashes is drawn on macOS's Metal device, the reference platform; off it, BLOCKED. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') blocked(`the GPU layer draws these pixels on macOS's Metal device and this is ${process.platform}; without a GPU the pixel hashes and the time are not read`);
}
/** Where the run keeps what a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-3033-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}
/** The machine a hash holds on: pixel hashes are one machine's (the design's same-machine determinism), by its model,
 * its chip and its macOS build, as scripts/benchmark.mjs's fingerprint reads them. */
export interface Machine { model: string | null; chip: string | null; macosBuild: string | null }
export function machine(): Machine {
  const read = (command: string, ...args: string[]): string | null => {
    try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || null; } catch { return null; }
  };
  return { model: read('sysctl', '-n', 'hw.model'), chip: read('sysctl', '-n', 'machdep.cpu.brand_string'), macosBuild: read('sw_vers', '-buildVersion') };
}
/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and
 * `validateBudgets`), so the suite judges a budget exactly as the lane does without importing the lane. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** A run's one-minute load average, read at its start and at its end, as the lane's own runs read it. */
export type Load = { start: number; end: number };
export const loadNow = (): number => loadavg()[0]!;
/** The lane's `judgeLimit` in a child process, on this machine's fingerprint, with one load per run. */
function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads }), 'judgeLimit');
}
/** Why a timing can't count on this machine now, or '' when it can: the lane's judge on five empty readings, each with
 * the load read now, so the fingerprint (a reference Mac, mains power, Low Power Mode off, thermal state nominal) and
 * the load are read as a run's would be. */
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
// Builds: deep-gpu built once per file and copied out of the target folder.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
const PINNED = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
function cargoBuild(): string {
  const env = { ...process.env, ...(existsSync(PINNED) ? { PATH: `${PINNED}${delimiter}${process.env['PATH'] ?? ''}` } : {}), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error: string | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3033-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3033-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'water_sea_amplitudes_halved' | 'water_sea_speed_of_longest' | 'water_sea_draws_four_longest';
/** How a run starts: on the noop backend (no GPU: nothing is drawn, the check still runs), and with which plant. */
export interface Start { backend?: 'noop'; planted?: Planted | undefined }

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], start: Start = {}): JsonObject[] {
  const args = ['run', ...(start.backend ? ['--backend', start.backend] : []), ...(start.planted ? ['--planted', start.planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  // A machine with no GPU device to draw on: the binary says so and exits 1.
  if (!start.backend && /"code":"(no_device|missing_feature)"/.test(r.stdout ?? '')) blocked(`${label} found no GPU device to draw on: ${(r.stdout ?? '').slice(0, 500)}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused (any `code`); BLOCKED when it says the platform has no GPU to draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') blocked(`${what} reports ${String(reply['code'])}`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** The targets this suite reads: the base's `final` (a PNG), `depth` (#166's linear depth readback) and `reflection`. */
export type Target = 'final' | 'depth' | 'reflection';
/** `view3d` (#378) as the base has it; `receipt: true` (#423's field) asks for the receipt, which this suite reads the
 * water's wave table from (README: Surface choices). */
export interface View3d {
  doc: string; look: JsonObject; size: Size; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; timings?: boolean; receipt?: boolean;
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
/** Each frame's GPU time (`timings: true`). */
export const gpuMs = (frames: Frame[], what: string): number[] => frames.map((f) => num(f.raw['gpu_ms'], `${what}: frame ${f.frame}'s gpu_ms`));
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}
/** A captured frame's final target: the PNG the renderer wrote, byte for byte. */
export const finalOf = (out: string, f: Frame, what: string): Buffer => readNamed(out, f.raw['final'], 'png', `${what}: frame ${f.frame}'s final PNG`);
/** A captured frame's `depth` target (#166): f32 little-endian, one a pixel, rows top-down: the distance in metres
 * along the view axis from the eye to the nearest surface drawn at the pixel's centre, +∞ where nothing is drawn. */
export function depthOf(out: string, f: Frame, size: Size, what: string): Float32Array {
  const file = readNamed(out, f.raw['depth'], 'f32', `${what}: frame ${f.frame}'s depth`);
  expect(file.length, `${what}: frame ${f.frame}'s depth holds ${size[0]} × ${size[1]} f32`).toBe(size[0] * size[1] * 4);
  const v = new Float32Array(size[0] * size[1]);
  for (let i = 0; i < v.length; i++) v[i] = file.readFloatLE(i * 4);
  return v;
}

// ---------------------------------------------------------------------------------------------------
// PNG in and out: the still is two of the renderer's pictures side by side, pixel for pixel.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#418's reader). */
export function decodePng(file: Buffer): Image {
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
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** Two pictures of one size side by side, `left` then `right`, as an 8-bit RGB PNG: every pixel one of theirs. */
export function sideBySide(left: Image, right: Image): Buffer {
  expect([right.width, right.height], 'the two pictures have one size').toEqual([left.width, left.height]);
  const { width, height } = left;
  const raw = Buffer.alloc((width * 2 * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 2; x++) {
    const from = x < width ? left : right;
    const o = (y * width + (x % width)) * 4; const r = y * (width * 2 * 3 + 1) + 1 + x * 3;
    raw[r] = from.rgba[o]!; raw[r + 1] = from.rgba[o + 1]!; raw[r + 2] = from.rgba[o + 2]!;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width * 2, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: Surface choices), as #166's, #968's and #2760's suites write them. `issue` is the
// suite a document is of: its seed and the number in its descriptions.

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1`. With no change it maps the scene through tone map none at the exposure whose scale is 1,
 * bloom off and no finish. */
export function look3d(issue: number, id: string, change: JsonObject = {}): JsonObject {
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
/** A suite's filmic look: the one its stills and timings draw in, as a film would. */
export const filmic = (issue: number): JsonObject => look3d(issue, `filmic-${issue}`, { tone_map: 'filmic', exposure: 0 });
/** This suite's looks. */
export const LOOK = look3d(3033, 'sea-3033');
export const FILMIC = filmic(3033);

export const WRITER = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`, its seed
 * its suite's number. */
export function sceneDoc(issue: number, id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #${issue} acceptance fixture.`, size: [...size], camera: 'cam', seed: issue,
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number, far = 1000): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A box `size` (x, y, z) centred on `pos`. */
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` (x) × `size[1]` (z) rectangle of `grid` cells in its own XZ
 * plane at y = 0, facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });

// ---------------------------------------------------------------------------------------------------
// The sea (README: Surface choices)

/** The issue's `sea {wind: m/s, direction: deg = 0, spread: deg = 30, seed}`, written as the wind form is: the
 * one-key object `{"sea": {…}}` under `waves`. */
export interface Sea { sea: { wind: number; direction: number; spread: number; seed: number } }
/** The base's wind form: `{"wind": {speed, direction}}`, from which a fixed table picks four waves. */
export interface Wind { wind: { speed: number; direction: number } }
/** The heading every fixture's wind blows along, in degrees: 90°, so along +x (a heading d runs along (sin d, cos d)
 * in (x, z), as the base reads a wave's `direction`). */
export const DIRECTION = 90;
/** A sea from a wind of `wind` m/s along DIRECTION, at the issue's default spread, by this suite's seed. */
export const sea = (wind: number): Sea => ({ sea: { wind, direction: DIRECTION, spread: 30, seed: 3033 } });
/** The same wind's four waves: `waves: wind`. */
export const fourWaves = (speed: number): Wind => ({ wind: { speed, direction: DIRECTION } });
/** The water's material item and the plate that carries it. */
export const WATER = 'sea-water';
export const PLATE = 'sea';
/** A plate of `size` m (never under 100 m on its shorter side: the issue refuses a sea on one) of `grid` cells, centred
 * on the origin at y = 0, whose material `sea-water` carries `water: {waves}` and every other field its default, under
 * a day sky and a sun, with `more` items beside it. */
export function seaDoc(id: string, size: Size, cam: JsonObject, waves: Sea | Wind, plateSize: [number, number], grid: [number, number], more: Record<string, JsonObject> = {}): JsonObject {
  return sceneDoc(3033, id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    [WATER]: material({ roughness: 0.05, water: { waves: waves as unknown as JsonObject } }),
    [PLATE]: plate(plateSize, grid, [0, 0, 0], WATER),
    ...more,
  });
}
/** A white tower standing in the water 60 m off the origin, 22 m out of it: something for the sea to stand around and
 * to mirror. */
export const TOWER: Record<string, JsonObject> = {
  'tower-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.5 }),
  tower: box([4, 24, 4], [-40, 10, -45], 'tower-white'),
};

/** The plate the wave table's measures are read on: 2 km × 2 km, so both ends of every lag up to 1 km lie on it. It
 * is never drawn (the table is read on the noop backend), so its grid is coarse. */
export const WIDE: [number, number] = [2000, 2000];
/** A `view3d` of the wide plate that asks for the receipt: one frame at a small size, which the noop backend doesn't draw. */
export function tableCall(dir: string, name: string, waves: Sea | Wind): JsonObject {
  const size: Size = [64, 36];
  const doc = seaDoc(name, size, camera([0, 20, 60], [0, 0, 0], 50), waves, WIDE, [8, 8]);
  return view3d({ doc: writeJson(dir, name, doc), look: LOOK, size, frames: 1, fps: 30, receipt: true });
}

// ---------------------------------------------------------------------------------------------------
// The wave table the receipt lists (README: Surface choices)

/** One row of a water's wave table: its heading in degrees (as a wave's `direction`), its length and amplitude in m,
 * its phase in radians, its speed in m/s, and whether the vertex stage sums it (null when the row doesn't say). */
export interface Wave { direction: number; length: number; amplitude: number; phase: number; speed: number; vertex: boolean | null }
/** The wave table a `view3d` reply's receipt lists for its water, `receipt.water.waves`, or null when the receipt
 * lists none. A refused call fails here; a listed table is held to its shape. */
export function waveTable(reply: JsonObject, what: string): Wave[] | null {
  answered(reply, what);
  const receipt = reply['receipt'];
  const water = isObject(receipt) ? receipt['water'] : undefined;
  const rows = isObject(water) ? water['waves'] : undefined;
  if (!isObject(water) || !Array.isArray(rows)) return null;
  expect(water['material'], `${what}: receipt.water.material is the water's material item`).toBe(WATER);
  return rows.map((v, i): Wave => {
    const w = `${what}: receipt.water.waves[${i}]`;
    const r = obj(v, w);
    const row = { direction: num(r['direction'], `${w}.direction`), length: num(r['length'], `${w}.length`), amplitude: num(r['amplitude'], `${w}.amplitude`), phase: num(r['phase'], `${w}.phase`), speed: num(r['speed'], `${w}.speed`), vertex: typeof r['vertex'] === 'boolean' ? r['vertex'] : null };
    expect(row.length, `${w}.length is a length in m`).toBeGreaterThan(0);
    expect(row.amplitude, `${w}.amplitude is an amplitude in m`).toBeGreaterThanOrEqual(0);
    return row;
  });
}
/** The wave table of the wide plate under each `waves`, read in one process on the noop backend, so on any machine:
 * each `[name, waves]`'s table as its receipt lists it, or null where the receipt lists none. */
export function tablesOf(bin: string, dir: string, waters: [string, Sea | Wind][], planted?: Planted): (Wave[] | null)[] {
  const replies = runGpu(bin, dir, waters.map(([name, waves]) => tableCall(dir, name, waves)), { backend: 'noop', planted });
  return replies.map((r, i) => waveTable(r, `the wide plate with ${waters[i]![0]}`));
}

// ---------------------------------------------------------------------------------------------------
// The table's measures, evaluated in f64 from its rows (README: The closed form and the measures)

/** g, m/s²: the water's own (crates/deep-canvas-scene3d/src/water.rs: `G`), under which the issue's 0.21 × wind² ÷ g
 * is 2.14 m at 10 m/s and 0.54 m at 5 m/s. */
export const G = 9.81;
/** The deep-water speed of a wave `length` m long: √(g × length ÷ 2π). */
export const deepWaterSpeed = (length: number): number => Math.sqrt((G * length) / (2 * Math.PI));
/** A point of the water at rest and a time. */
export interface Sample { x: number; z: number; t: number }
/** The issue's "4,096 seeded points over 600 s": 4,096 samples, each a point uniform over `x` × `z` (m) at a time
 * uniform over [0, 600) s, drawn x, z, t in turn from one generator seeded 3033. */
export function samples(x: [number, number], z: [number, number]): Sample[] {
  const rng = new Lcg(3033);
  return Array.from({ length: 4096 }, () => ({ x: x[0] + rng.next() * (x[1] - x[0]), z: z[0] + rng.next() * (z[1] - z[0]), t: rng.next() * 600 }));
}
/** The samples of the significant height: over the whole wide plate. */
export const everywhere = (): Sample[] => samples([-WIDE[0] / 2, WIDE[0] / 2], [-WIDE[1] / 2, WIDE[1] / 2]);
/** The samples of the correlation along the wind: over the plate's upwind half, so a point 1 km downwind of any of
 * them is still on the plate (DIRECTION runs along +x). */
export const upwind = (): Sample[] => samples([-WIDE[0] / 2, 0], [-WIDE[1] / 2, WIDE[1] / 2]);
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** A wave's phase angle at a sample: k (D · (x, z)) − k × speed × t + phase, k = 2π ÷ length, D = (sin d, cos d). */
function angle(w: Wave, s: Sample): number {
  const k = (2 * Math.PI) / w.length; const d = rad(w.direction);
  return k * (Math.sin(d) * s.x + Math.cos(d) * s.z) - k * w.speed * s.t + w.phase;
}
/** The height of the water at a sample: the sum of its waves, each amplitude × cos(its phase angle). */
export const height = (rows: Wave[], s: Sample): number => rows.reduce((h, w) => h + w.amplitude * Math.cos(angle(w, s)), 0);
/** Four times the standard deviation of the height over the samples. */
export function significantHeight(rows: Wave[], at: Sample[]): number {
  const hs = at.map((s) => height(rows, s));
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  return 4 * Math.sqrt(hs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / hs.length);
}
/** The lags of the issue's range, in m: every whole metre from 200 m to 1 km. */
export const LAGS: number[] = Array.from({ length: 801 }, (_, i) => 200 + i);
/** The height's correlation with itself along the wind at each lag: the correlation coefficient, over the samples, of
 * the height at a sample's point and the height `lag` m downwind of it (along the heading `direction`) at the same
 * time. A wave's phase angle `lag` m downwind is its angle at the point plus k × lag × cos(its heading − the wind's). */
export function correlation(rows: Wave[], direction: number, at: Sample[], lags: number[]): number[] {
  const cos = at.map((s) => rows.map((w) => w.amplitude * Math.cos(angle(w, s))));
  const sin = at.map((s) => rows.map((w) => w.amplitude * Math.sin(angle(w, s))));
  const here = cos.map((row) => row.reduce((a, b) => a + b, 0));
  const n = at.length;
  const mean = here.reduce((a, b) => a + b, 0) / n;
  const variance = here.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const along = rows.map((w) => ((2 * Math.PI) / w.length) * Math.cos(rad(w.direction - direction)));
  return lags.map((lag) => {
    const c = along.map((k) => Math.cos(k * lag)); const s = along.map((k) => Math.sin(k * lag));
    let sum = 0; let squares = 0; let product = 0;
    for (let i = 0; i < n; i++) {
      let there = 0;
      const ci = cos[i]!; const si = sin[i]!;
      for (let j = 0; j < rows.length; j++) there += ci[j]! * c[j]! - si[j]! * s[j]!;
      sum += there; squares += there * there; product += there * here[i]!;
    }
    const m = sum / n;
    return (product / n - mean * m) / Math.sqrt(variance * (squares / n - m * m));
  });
}

/** Criterion 1's check of a sea's table from a wind of `wind` m/s: its significant height over the samples is within
 * 5% of `expected` m. A failure names the wind. */
export function heightProblems(wind: number, rows: Wave[], expected: number): { reading: number; failures: string[] } {
  const reading = significantHeight(rows, everywhere());
  const off = Math.abs(reading - expected) / expected;
  return { reading, failures: off <= 0.05 ? [] : [`a sea from a wind of ${wind} m/s: its significant height reads ${reading.toFixed(3)} m, ${(off * 100).toFixed(1)}% from ${expected} m, not within 5%`] };
}
/** Criterion 2's check of a table: every row's speed is √(g × length ÷ 2π) within 1e-9. A failure names the row. */
export function speedProblems(rows: Wave[]): string[] {
  return rows.flatMap((w, i) => {
    const want = deepWaterSpeed(w.length);
    return Math.abs(w.speed - want) <= 1e-9 ? [] : [`row ${i} of the wave table (${w.length.toFixed(3)} m long): its speed is ${w.speed} m/s, not √(g × length ÷ 2π) = ${want} m/s within 1e-9`];
  });
}
/** Criterion 3's check of a sea's table: along the wind, the height's correlation with itself stays under 0.3 at every
 * lag. A failure names the lag. */
export function repeatProblems(rows: Wave[]): { curve: number[]; failures: string[] } {
  const curve = correlation(rows, DIRECTION, upwind(), LAGS);
  return { curve, failures: curve.flatMap((c, i) => (c < 0.3 ? [] : [`at a lag of ${LAGS[i]} m along the wind the height's correlation with itself is ${c.toFixed(3)}, not under 0.3`])) };
}
/** A correlation curve's highest value and the lag it is at. */
export function peak(curve: number[]): { value: number; lag: number } {
  const value = Math.max(...curve);
  return { value, lag: LAGS[curve.indexOf(value)]! };
}

// ---------------------------------------------------------------------------------------------------
// What each run keeps, and the merge base's readings (criterion 5; README: The merge base's readings)

/** The base commit this suite was written against, whose readings fixtures/base/ holds. */
export const BASE_SHA = 'c7dc0edc3690706adb84d678806301c3d14456ca';
const git = (...args: string[]): string => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout?.trim() ?? '';
/** Where each run keeps its own readings. */
export const KEPT = join(REPO, 'target', 'acceptance', '3033');
/** Keeps `value` as target/acceptance/3033/<name>.json under a header: the commit and the machine it was read on, the
 * binary, and the paths the work tree held changed outside this folder and docs/evidence/3033/ (a reading of the merge
 * base has none). Answers that path from the checkout's root. */
export function keep(name: string, value: JsonObject): string {
  mkdirSync(KEPT, { recursive: true });
  const changed = git('status', '--porcelain').split('\n').map((l) => l.slice(3)).filter((p) => p !== '' && !p.startsWith('tests/acceptance/3033/') && !p.startsWith('docs/evidence/3033/'));
  const header: JsonObject = { issue: 3033, commit: git('rev-parse', 'HEAD'), changed, machine: machine() as unknown as JsonObject, binary: `cargo ${CARGO_ARGS.join(' ')}` };
  writeFileSync(join(KEPT, `${name}.json`), `${JSON.stringify({ ...header, ...value }, null, 2)}\n`);
  return `target/acceptance/3033/${name}.json`;
}
/** The merge base's reading `name`: fixtures/base/<name>.json, the file this suite's run on the unchanged base kept.
 * It must be a reading of the base's unchanged tree; with none kept, or on another machine than the one it was read
 * on, the test that needs it is INCONCLUSIVE. */
export function mergeBase(name: string): JsonObject {
  const path = join(HERE, 'fixtures', 'base', `${name}.json`);
  if (!existsSync(path)) inconclusive(`no reading of the merge base is kept as tests/acceptance/3033/fixtures/base/${name}.json`);
  const base = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `fixtures/base/${name}.json`);
  expect(base['commit'], `fixtures/base/${name}.json was read on the merge base ${BASE_SHA}`).toBe(BASE_SHA);
  expect(base['changed'], `fixtures/base/${name}.json was read on the merge base's unchanged tree`).toEqual([]);
  const [there, here] = [JSON.stringify(base['machine']), JSON.stringify(machine())];
  if (there !== here) inconclusive(`the merge base's ${name} reading was taken on ${there} and this machine is ${here}; pixel hashes hold on one machine`);
  return base;
}
