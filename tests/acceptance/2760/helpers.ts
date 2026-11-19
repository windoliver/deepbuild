// Test-side tools for the #2760 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`) and, for the Spawn of
// criterion 7, `deep-show` (#393's scenario binary, with #500's `media_mix`), each built once per file and driven by JSON
// lines; the logic programs that write the occurrence lists, generated here as WebAssembly text from a table of touches
// and assembled by #544's assembler; the pond the tests draw; the readers of a frame's `rings` rows and the criterion's
// judgement of them; the check refusals; the mix's voices and samples; the five-run budget judge, read from the perf
// lane's own scripts/benchmark.mjs in a child process; PNG and animated PNG writing for the taste call. Suites don't
// import each other, so what this file shares with #166's, #537's and #544's helpers is repeated here. Nothing here
// stands in for the logic module, the water or the mixer: every ring, pixel, voice and refusal read is the program's
// own, and every expected value comes from the issue and this suite's tables of touches. Each check a planted twin must
// fail returns its failures as sentences naming what failed.

import { spawnSync } from 'node:child_process';
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

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2760 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#2760.a4531c1e', 2: '#2760.c3014951', 3: '#2760.dc56f46c', 4: '#2760.f7241c9f', 5: '#2760.ee433725',
  6: '#2760.1524f8e9', 7: '#2760.9c74b517', 8: '#2760.6dfadd78', 9: '#2760.3bd24233',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; a 60 Hz logic step is 11,760,000 and a 48 kHz sample 14,700.

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;
export const SAMPLE_RATE = 48_000;
export const SAMPLE = FLICKS / SAMPLE_RATE;
/** Seconds as whole flicks. */
export const secs = (s: number): number => Math.round(s * FLICKS);

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
/** A tool the suite needs that isn't there fails with this, never passes. */
export function blocked(reason: string): never {
  throw Error(`BLOCKED: ${reason}; this is not a pass`);
}
/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A planted twin's check: it found failures, and they name what the criterion says they name. */
export function failsNaming(failures: readonly string[], names: string[], what: string): void {
  expect(failures.length, `${what} fails`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) expect(text, `${what}'s failure names ${n}`).toContain(n);
}
/** `word` stands as a whole name in `text`: no letter, digit, `_` or `-` touches it. */
export const namesWord = (text: string, word: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_-]|$)`).test(text);
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The machine

/** Everything here draws on macOS's GPU device, the reference platform; off it, INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's GPU device; this is ${process.platform}`);
}
/** Where the run keeps what a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-2760-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
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
// Builds: each binary built once per file and copied out of the target folder under its own name.

export type BinName = 'deep-gpu' | 'deep-show';
const cargoArgs = (name: BinName): string[] => ['build', '--locked', '--bin', name];
const PINNED = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const cargoEnv = (more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env, ...(existsSync(PINNED) ? { PATH: `${PINNED}${delimiter}${process.env['PATH'] ?? ''}` } : {}),
  CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...more,
});
function cargo(args: string[], cwd: string, more: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv(more) });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): (name: BinName) => string {
  let dir = '';
  const made = new Map<BinName, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2760-bin-'));
    for (const name of names) {
      const error = cargo(cargoArgs(name), REPO);
      if (error === '') copyFileSync(join(targetDir(), 'debug', name), join(dir, name));
      made.set(name, error);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name: BinName): string => {
    const error = made.get(name);
    if (error === undefined) throw Error(`the file didn't list ${name} in useBins`);
    expect(error, `${name} builds: cargo ${cargoArgs(name).join(' ')}`).toBe('');
    return join(dir, name);
  };
}
/** deep-gpu alone, built once per file. */
export function useGpu(): () => string {
  const bins = useBins(['deep-gpu']);
  return () => bins('deep-gpu');
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2760-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Logic programs: WebAssembly text generated from a table of touches, assembled by #544's assembler (../544/wat, read
// only, outside the workspace) into its own target folder. Each program exports `memory` (one page, its maximum its
// minimum), `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` (0), `writes_at` (4096) and
// `emits_at` (8192), reads and writes nothing, and at each step that holds touches writes their rows into its emit
// region as the design lays it out (Logic: occurrences): for each kind in declaration order a u32 count, then
// `max_per_step` rows of {a: u32, b: u32, its fields in declaration order}, little-endian, each field at its type's
// size (i32 4, f64 8, vec3 three f64), with nothing between.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const target = join(targetDir(), 'acceptance-2760-wat');
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: target });
  if (error) blocked(`#544's assembler (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(target, 'debug', 'acceptance-544-wat');
  return watBin;
}
const assembled = new Map<string, Program>();
function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-2760-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${(run.stderr ?? '').slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type FieldType = 'i32' | 'f64' | 'vec3';
const FIELD_BYTES: Record<FieldType, number> = { i32: 4, f64: 8, vec3: 24 };
/** A kind a logic item declares in `emits`: its fields in declaration order, and its cap per step (16 when absent). */
export interface Kind { kind: string; fields: [string, FieldType][]; max?: number }
/** One row a program writes: at logic step `step` (60 Hz), of `kind`, with `a` (b is 0) and its fields' values. */
export interface Touch { step: number; kind: string; a: number; fields: Record<string, number | V3> }
/** A row of the occurrence list a program must leave: its index in list order, its flick, and its point, if its kind
 * declares the field `point` (Spawn: "whose field named `point`, if any, is its point"). */
export interface Row { index: number; step: number; t: number; kind: string; a: number; point: V3 | null }
/** A logic program with the `emits` its item declares and the list it must leave. */
export interface Emitter { program: Program; emits: JsonObject; rows: Row[] }

const READS_AT = 0;
const WRITES_AT = 4096;
const EMITS_AT = 8192;
const MEMORY = 65_536;

/**
 * The program that writes `touches`, and the list they make: rows in list order, sorted by (step, kind in declaration
 * order, a) with ties in the order written (Occurrence list). The tables here never put two kinds on one step.
 */
export function emitter(name: string, kinds: Kind[], touches: Touch[]): Emitter {
  const rowBytes = (k: Kind): number => 8 + k.fields.reduce((n, [, t]) => n + FIELD_BYTES[t], 0);
  const blocks: number[] = [];
  let at = EMITS_AT;
  for (const k of kinds) { blocks.push(at); at += 4 + (k.max ?? 16) * rowBytes(k); }
  if (at > MEMORY) throw Error(`${name}: its emit region ends at ${at}, past its one page`);
  const zero = blocks.map((b) => `(i32.store (i32.const ${b}) (i32.const 0))`).join(' ');
  const steps = [...new Set(touches.map((t) => t.step))].sort((x, y) => x - y);
  const bodies = steps.map((step) => {
    const writes: string[] = [];
    kinds.forEach((k, j) => {
      const mine = touches.filter((t) => t.step === step && t.kind === k.kind);
      if (!mine.length) return;
      if (mine.length > (k.max ?? 16)) throw Error(`${name}: ${mine.length} ${k.kind} rows at step ${step}, past its cap`);
      mine.forEach((t, i) => {
        let o = blocks[j]! + 4 + i * rowBytes(k);
        writes.push(`(i32.store (i32.const ${o}) (i32.const ${t.a})) (i32.store (i32.const ${o + 4}) (i32.const 0))`);
        o += 8;
        for (const [field, type] of k.fields) {
          const v = t.fields[field];
          if (v === undefined) throw Error(`${name}: a ${k.kind} row at step ${step} has no ${field}`);
          if (type === 'i32') writes.push(`(i32.store (i32.const ${o}) (i32.const ${v as number}))`);
          else for (const [c, x] of (type === 'vec3' ? (v as V3) : [v as number]).entries()) writes.push(`(f64.store (i32.const ${o + 8 * c}) (f64.const ${x}))`);
          o += FIELD_BYTES[type];
        }
      });
      writes.push(`(i32.store (i32.const ${blocks[j]}) (i32.const ${mine.length}))`);
    });
    return `    (if (i64.eq (local.get $k) (i64.const ${step})) (then\n      ${writes.join('\n      ')}))`;
  });
  const text = `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "emits_at") i32 (i32.const ${EMITS_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    ${zero}
${bodies.join('\n')}))`;
  const order = (t: Touch): number => kinds.findIndex((k) => k.kind === t.kind);
  const sorted = touches.map((t, written) => ({ t, written })).sort((x, y) => x.t.step - y.t.step || order(x.t) - order(y.t) || x.t.a - y.t.a || x.written - y.written);
  const rows = sorted.map(({ t }, index): Row => {
    const p = t.fields['point'];
    return { index, step: t.step, t: t.step * STEP, kind: t.kind, a: t.a, point: Array.isArray(p) ? p : null };
  });
  const emits = Object.fromEntries(kinds.map((k) => [k.kind, { fields: Object.fromEntries(k.fields), ...(k.max === undefined ? {} : { max_per_step: k.max }) }]));
  return { program: assemble(name, text), emits, rows };
}
/** A logic item (Logic `logic@1`) running `e`'s program at 60 steps a second and declaring its `emits`. */
export const logicItem = (e: Emitter): JsonObject => ({ kind: 'logic@1', params: { program: e.program.sha, step_rate: 60, reads: [], emits: e.emits } });
/** A file `view3d` reads by SHA-256 (a program), written under `dir`: its `assets` entry. */
export function putAsset(dir: string, p: Program): Record<string, string> {
  const path = join(dir, `${p.sha}.wasm`);
  writeFileSync(path, p.bytes);
  return { [p.sha]: path };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'water_rings_at_rain_hash' | 'water_rings_start_on_drawn_frame';

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
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
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') inconclusive(`${what} reports ${String(reply['code'])}`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** `view3d` (#378) as the base has it: `seeks` jumps the session to frame `to` right after frame `after` draws (#484),
 * `rings: true` lists each captured frame's rings (#166), `assets` holds each logic program by its SHA-256 (#537). */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  seeks?: { after: number; to: number }[]; capture?: 'every' | number[]; targets?: 'final'[]; timings?: boolean; rings?: boolean;
  assets?: Record<string, string>;
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
/** The last row of frame `n` in a reply (a session that seeks back may draw a frame twice). */
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = [...frames].reverse().find((x) => x.frame === n);
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

// ---------------------------------------------------------------------------------------------------
// Rings: a captured frame's `rings` rows (README: The surface under test) and the criterion's judgement of them.

/** One ring an occurrence started, as a captured frame lists it: the water part it is on, its occurrence's index in the
 * list its `on` names, its centre in world x and z on the water at rest, its birth in s and its radius in m. */
export interface Ring { part: string; occurrence: number; x: number; z: number; born: number; radius: number }
/** Frame `f`'s rings. These fixtures have no rain, so every row is an occurrence's ring and carries `occurrence`. */
export function ringsOf(f: Frame, what: string): Ring[] {
  return arr(f.raw['rings'], `${what}: frame ${f.frame}'s rings (the call asked with rings: true)`).map((v, i) => {
    const w = `${what}: frame ${f.frame}: rings[${i}]`;
    const r = obj(v, w);
    const at = arr(r['at'], `${w}.at`);
    return {
      part: str(r['part'], `${w}.part`), occurrence: int(r['occurrence'], `${w}.occurrence (the row's index in the list the rings read)`),
      x: num(at[0], `${w}.at[0]`), z: num(at[1], `${w}.at[1]`), born: num(r['born'], `${w}.born`), radius: num(r['radius'], `${w}.radius`),
    };
  });
}

/** The pond's plate (the part), its water's material, its centre in the world and its size along x and z. */
export const POND = 'pond';
export const WATER = 'rings-water';
export const CENTRE: V3 = [1, 0, -0.5];
export const POND_SIZE: [number, number] = [4, 4];
/** The design's defaults of `water.rings` (the issue's Fields). */
export const SPEED = 0.3;
export const SPAN = 2;
/** The most rings alive at one time on one part (the issue's cap, a starting value). */
export const CAP = 64;
const onPlate = (p: V3): boolean => Math.abs(p[0] - CENTRE[0]) <= POND_SIZE[0] / 2 && Math.abs(p[2] - CENTRE[2]) <= POND_SIZE[1] / 2;
/** The rows of a list that have a ring alive at `t` s: those `keep` passes whose point lies on the pond, from their
 * flick until `span` s after it. */
export function alive(rows: Row[], t: number, keep: (r: Row) => boolean = () => true, span = SPAN): Row[] {
  return rows.filter((r) => keep(r) && r.point !== null && onPlate(r.point) && t >= r.t / FLICKS && t - r.t / FLICKS < span);
}
const fx = (x: number): string => x.toFixed(4);
/**
 * The criterion's reading of the rings a frame at `t` s lists against the rows `want` that must have one alive then:
 * each is listed once, on the pond, centred within 1 mm of its occurrence's point dropped onto the plate, born at its
 * occurrence's flick, its radius within 1 mm of speed × age; and no other ring is listed. Each failure names the
 * occurrence by its index in `list`.
 */
export function ringFailures(got: Ring[], want: Row[], t: number, list: string, speed = SPEED): string[] {
  const failures: string[] = [];
  for (const r of want) {
    const name = `occurrence ${r.index} of ${list} (${r.kind} at ${fx(r.t / FLICKS)} s)`;
    const rings = got.filter((g) => g.occurrence === r.index);
    if (rings.length !== 1) { failures.push(`${name}: ${rings.length} rings are listed for it at ${fx(t)} s, not one`); continue; }
    const g = rings[0]!; const p = r.point!; const age = t - r.t / FLICKS;
    if (g.part !== POND) failures.push(`${name}: its ring is on the part ${g.part}, not ${POND}`);
    const off = Math.hypot(g.x - p[0], g.z - p[2]);
    if (!(off <= 0.001)) failures.push(`${name}: its ring is centred at (${fx(g.x)}, ${fx(g.z)}), ${fx(off)} m from its point (${fx(p[0])}, ${fx(p[2])})`);
    if (!(Math.abs(g.born - r.t / FLICKS) <= 1e-6)) failures.push(`${name}: its ring is born at ${g.born} s, not at its flick`);
    if (!(Math.abs(g.radius - speed * age) <= 0.001)) failures.push(`${name}: its ring's radius is ${fx(g.radius)} m at ${fx(t)} s, not speed × age = ${fx(speed * age)} m`);
  }
  for (const g of got) {
    if (!want.some((r) => r.index === g.occurrence)) failures.push(`occurrence ${g.occurrence} of ${list}: a ring is listed for it at ${fx(t)} s, at (${fx(g.x)}, ${fx(g.z)}) with radius ${fx(g.radius)} m, and it starts none then`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Check refusals: `view3d` answers a document its check refuses with `{code: "refused", issues: [Issue]}`, each Issue
// the canvas core's `{code, severity, ids, path, actual, what, fix}` (as #431's, #506's and #508's refusals are).

/** The error issues of a `view3d` reply that refused its document at check. */
export function refusedIssues(reply: JsonObject, what: string): JsonObject[] {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') inconclusive(`${what} reports ${String(reply['code'])}`);
  expect(reply['code'], `${what} is refused at check ({code: "refused", issues}): ${shown(reply, 600)}`).toBe('refused');
  const errors = arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['severity'] === 'error');
  expect(errors.length, `${what}: the refusal holds an error issue: ${shown(reply, 600)}`).toBeGreaterThan(0);
  return errors;
}

// ---------------------------------------------------------------------------------------------------
// PNG in and out, for the taste call's recording

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
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
/** An animated PNG of equal-sized frames at `fps`, looping (#422's encoder): the recording, from the renderer's frames. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22); fctl[24] = 0; fctl[25] = 0;
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
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
 * exposure whose scale is 1, bloom off and no finish, so the final target carries the scene's own values. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #2760 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the screenshots, the recording and the timings draw in: filmic, as a film would. */
export const FILMIC = look3d('filmic-2760', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
export const SEED = 2760;
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`; it requires
 * the scene3d and the logic module, as #537's scenes do. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #2760 acceptance fixture.`, size: [...size], camera: 'cam', seed: SEED,
    transport: { span: '12s', frame_rate: [60, 1], sample_rate: SAMPLE_RATE }, requires: { modules: { scene3d: '^1', logic: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 1000 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle of `grid` cells in its own XZ plane,
 * facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });

// ---------------------------------------------------------------------------------------------------
// Material: water, with the field this issue adds

/** `on`, as Spawn takes it (Spawn; #449's bursts, #544's Spawn and start_on): a baked occurrence list by its form and a
 * filter by kind, tags and `where`, an expression over the occurrence's fields that keeps a row when it isn't 0. */
export interface On { list: string; kinds?: string[]; tags?: string[]; where?: string }
/** `water.rings` (the issue's Fields): a field left out takes its default (speed 0.3 m/s, span 2 s, strength 0.2). */
export interface Rings { on: On; speed?: number; span?: number; strength?: number }
/** The `water` field, as #166 wrote it, with `rings`. Fields left out take the design's defaults. */
export interface Water {
  waves?: { wind: { speed?: number; direction?: number } } | { direction: number; length: number; amplitude: number; steepness: number }[];
  ripples?: { scale?: number; strength?: number };
  rain?: number;
  rings?: Rings | 'none';
}
/** Still water (#166's STILL): one wave of amplitude 0, no ripples, no rain, so only a ring bends the surface's normal. */
export const STILL: Water = { waves: [{ direction: 0, length: 10, amplitude: 0, steepness: 0 }], ripples: { strength: 0 }, rain: 0 };

/** The pond's camera: low and oblique, 4.5 m from the pond's centre, so the water mirrors the posts and the sky at a
 * grazing angle and a ring's bent normal moves the mirror's lookup and its Fresnel share (README: The pond). */
export const POND_CAM: JsonObject = camera([CENTRE[0], 1.5, CENTRE[2] + 4.2], [CENTRE[0], 0, CENTRE[2] - 0.3], 45);
/**
 * The pond: the plate `pond`, 4 m × 4 m of 64 × 64 cells centred on (1, 0, −0.5) m, whose material `rings-water`
 * carries `water` over its own sharp mirror (roughness 0); a sand bed 0.6 m down; eight posts, red and white in turn,
 * 0.25 m wide and 1.6 m tall, half a metre apart along the far bank, for the water to mirror; a day sky and a sun. Its
 * logic items are `logic`, by ID.
 */
export function pondDoc(id: string, size: readonly [number, number], water: Water, logic: Record<string, JsonObject> = {}, opts: { cam?: JsonObject; extra?: JsonObject } = {}): JsonObject {
  const [cx, , cz] = CENTRE;
  const items: Record<string, JsonObject> = {
    cam: opts.cam ?? POND_CAM, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    [WATER]: material({ roughness: 0, water: water as unknown as JsonObject }),
    'post-red': material({ base_color: [0.85, 0.08, 0.06, 1], roughness: 0.5 }),
    'post-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.5 }),
    'bed-sand': material({ base_color: [0.62, 0.52, 0.34, 1], roughness: 0.9 }),
    [POND]: plate(POND_SIZE, [64, 64], CENTRE, WATER),
    bed: box([4.4, 0.2, 4.4], [cx, -0.7, cz], 'bed-sand'),
    ...logic,
  };
  for (let k = 0; k < 8; k++) items[`post${k}`] = box([0.25, 1.6, 0.25], [cx - 1.75 + 0.5 * k, 0.8, cz - 2.3], k % 2 ? 'post-white' : 'post-red');
  return sceneDoc(id, size, items, opts.extra ?? {});
}

/** The logic item `taps` of criteria 1, 2, 3 and 7, and its kind. */
export const TAPS = 'taps';
export const TAPS_LIST = `${TAPS}.occurrences`;
/** A touch: its point in world metres and its number, counted from 1. */
export const TOUCH: Kind = { kind: 'touch', fields: [['point', 'vec3'], ['n', 'i32']] };
/** Three touches at the plate's centre, 0.5 s apart from t = 1 s: steps 60, 90 and 120 at 60 Hz, n = 1, 2, 3. */
export const threeTouches = (): Emitter => emitter('three-touches', [TOUCH], [60, 90, 120].map((step, i) => ({ step, kind: 'touch', a: i + 1, fields: { point: CENTRE, n: i + 1 } })));
/** Rings on every touch of `taps`, each field at its default. */
export const TAP_RINGS: Rings = { on: { list: TAPS_LIST, kinds: ['touch'] } };

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's scenario binary) and `media_mix` (#499, #500), as #544's suite drives them: a Spawn's voices.

/** `deep-show run` on one scenario with an evidence store and no session: exit 0, one answer line, one reply per call. */
export function runShow(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  const sc: JsonObject = { evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }], panels: {}, docs: {}, calls };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail('deep-show run did not finish within 3,000 s');
  if (r.error) throw Error(`deep-show run: ${r.error.message}`);
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(answer['ok'], `deep-show run accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-show run: replies').map((x, i) => obj(x, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies;
}
/** Puts a file into an evidence store (#15's layout: `<2 hex>/<62 hex>`, named by its bytes' SHA-256). */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A mono 16-bit 48 kHz WAV of a cosine tone: its first sample is its peak, so a voice is audible from its first sample. */
export function toneWav(hz: number, frames: number, amp: number): Buffer {
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(amp * Math.cos((2 * Math.PI * hz * i) / SAMPLE_RATE) * 32767), 44 + 2 * i);
  return b;
}
/** `media_mix` of a document over [from, to) flicks, its samples written as a float WAV into the evidence store. */
export const mediaMix = (doc: JsonObject, from: number, to: number): JsonObject => ({ call: 'media_mix', doc, track: [], segments: [{ from, to, write: true }] });
/** A voice a spawn started (#500's `voices`): its spawn, its occurrence's index in the list, and its first sample's flick. */
export interface Voice { spawn: string; occurrence: number; start: number }
/** The mix's samples from absolute sample `first`, each channel on its own. */
export interface Pcm { first: number; channels: Float32Array[] }
/** A `media_mix` reply: every voice its spawns started, and its one segment's samples read back from the float WAV. */
export function mixOf(reply: JsonObject, evidence: string, what: string): { voices: Voice[]; pcm: Pcm } {
  const m = obj(reply['mix'], `${what}: mix (the reply was ${shown(reply, 600)})`);
  expect(int(m['sample_rate'], `${what}: mix.sample_rate`), `${what}: the mix is at 48,000 Hz`).toBe(SAMPLE_RATE);
  const voices = arr(m['voices'], `${what}: mix.voices`).map((v, i): Voice => {
    const o = obj(v, `${what}: mix.voices[${i}]`);
    return { spawn: str(o['spawn'], `${what}: mix.voices[${i}].spawn`), occurrence: int(o['occurrence'], `${what}: mix.voices[${i}].occurrence`), start: int(o['start'], `${what}: mix.voices[${i}].start`) };
  });
  const seg = obj(arr(m['segments'], `${what}: mix.segments`)[0], `${what}: mix.segments[0]`);
  const name = str(seg['wav'], `${what}: mix.segments[0].wav`);
  const bytes = readFileSync(join(evidence, name.slice(0, 2), name.slice(2)));
  expect(sha256(bytes), `${what}: the WAV hashes to its name`).toBe(name);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null && fmt.tag === 3 && fmt.bits === 32 && fmt.rate === SAMPLE_RATE, `${what}: the WAV is IEEE float 32-bit at 48 kHz, the mix's own samples`).toBe(true);
  const frames = int(seg['frames'], `${what}: mix.segments[0].frames`);
  expect(data!.length, `${what}: the WAV holds the segment's frames`).toBe(frames * fmt!.nch * 4);
  const channels = Array.from({ length: fmt!.nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt!.nch; c++) channels[c]![i] = data!.readFloatLE((i * fmt!.nch + c) * 4);
  return { voices, pcm: { first: int(seg['first'], `${what}: mix.segments[0].first`), channels } };
}
/** The loudest sample over absolute samples [from, to), every channel. */
export function peak(p: Pcm, from: number, to: number): number {
  let m = 0;
  for (const c of p.channels) for (let n = from; n < to; n++) m = Math.max(m, Math.abs(c[n - p.first] ?? 0));
  return m;
}
/** A sample at or under this magnitude is silence (−120 dBFS). */
export const SILENCE = 2 ** -20;
