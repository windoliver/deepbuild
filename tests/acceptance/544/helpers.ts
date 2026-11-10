// Test-side tools for the #544 acceptance tests (README: The surface under test). They assemble this suite's
// WebAssembly programs with its own assembler (wat/, #532's copied), build and drive the logic module's runner
// `deep-logic` on this Mac and, through Docker, on Linux x86_64 (#532's pattern), and build and drive `deep-show run`
// (#500's and #501's pattern: one JSON scenario on stdin, one answer line) for the readers: a Spawn played through
// `media_mix` and a video `export`, a placement's `start_on` through `eval` and `determinism`, and the document check
// through `deep show`. Nothing here stands in for the logic module, a reader, the mixer or the check: every row, trap,
// verdict, voice, sample, frame and issue read here is the implementation's own; the expected values come from the
// issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/544 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Every test passes this timeout (90 minutes): a first build of deep-show, and deep-logic's Linux build under
 * emulation, take many minutes. */
export const TIMEOUT = 5_400_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #544.090a698b',
  2: 'AC2 #544.c031896f',
  3: 'AC3 #544.35794d75',
  4: 'AC4 #544.3039445f',
  5: 'AC5 #544.e6e1fd57',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; a 60 Hz step is 11,760,000; a 48 kHz sample is 14,700.

export const FLICKS = 705_600_000;
export const STEP_60 = FLICKS / 60;
export const RATE = 48_000;
/** Whole seconds (or a fraction that is a whole number of flicks) as flicks. */
export function secs(s: number): number {
  const f = Math.round(s * FLICKS);
  if (Math.abs(f - s * FLICKS) > 1e-3) throw Error(`${s} s is not a whole number of flicks`);
  return f;
}
/** A time in flicks as seconds to the millisecond, for messages. */
export const sOf = (t: number): string => `${(t / FLICKS).toFixed(3)} s`;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <name>` in the checkout, once per file, copied out of the target folder.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

export type Bin = 'deep-logic' | 'deep-show';
let binsDir = '';
const built = new Map<Bin, { bin: string; error: string }>();
function build(name: Bin): { bin: string; error: string } {
  const known = built.get(name);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-544-bins-'));
  const bin = join(binsDir, exe(name));
  const error = cargo(['build', '--locked', '--bin', name], REPO, {});
  if (error === '') copyFileSync(join(TARGET, 'debug', exe(name)), bin);
  const b = { bin, error };
  built.set(name, b);
  return b;
}
/** The built binary; a test that uses a build that failed fails, naming cargo's error. */
function binOf(name: Bin): string {
  const b = build(name);
  expect(b.error, `${name} builds on this host (cargo build --locked --bin ${name})`).toBe('');
  return b.bin;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(names: Bin[]): void {
  beforeAll(() => { for (const n of names) build(n); }, TIMEOUT);
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/: the `wat` crate, outside the workspace).

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-544-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-544-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-544-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The logic module's runner `deep-logic` (#531's and #532's JSON lines, README: deep-logic), one reply per line.

/** `deep-logic --planted <name>` (README: Planted twins). */
export type LogicPlanted = 'seek_repeats_occurrences' | 'occurrences_keep_cap' | 'occurrences_sort_ties_by_payload';
const LOGIC = 'deep-logic';

interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
function startLogic(args: string[], inputs: JsonValue[]): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(binOf(LOGIC), args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${LOGIC} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}
/** Runs `calls` through one `deep-logic [--planted p]` process on this Mac. */
export function onMac(calls: JsonObject[], planted?: LogicPlanted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  return replies(startLogic(args, calls), calls, `${LOGIC}${planted ? ` --planted ${planted}` : ''} on ${process.platform}/${process.arch}`);
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of the toolchain
// rust-toolchain.toml names, its caches under target/acceptance-544-linux/. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(TARGET, 'acceptance-544-linux');
function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
function hasAmd64(image: string): boolean {
  const perPlatform = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (perPlatform.status === 0 && perPlatform.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
let linuxBuilt: string | undefined;
/** Builds `deep-logic` for linux/amd64 once per process; BLOCKED without Docker or the image, FAIL when cargo fails. */
function linuxLogic(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    const image = linuxImage();
    if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const build = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
      image, 'cargo', 'build', '--locked', '--bin', LOGIC,
    ], undefined, TIMEOUT - 600_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin ${LOGIC} in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, `${LOGIC} builds for Linux x86_64`).toBe('');
}
/** Runs `calls` through one `deep-logic` process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxLogic();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), `/target/debug/${LOGIC}`], text, 1_800_000);
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr };
  return replies(s, calls, `${LOGIC} on linux/amd64`);
}

// Pieces (#531's form, README: deep-logic) and the calls.

export type FieldType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3';
/** A logic item's `emits` (Logic: occurrences): kind → its fields, and its cap per step (16 when absent). */
export type Emits = Record<string, { fields: Record<string, FieldType>; max_per_step?: number }>;
export interface ItemSpec {
  program: Program;
  reads?: string[];
  writes?: Record<string, { type: 'bool' | 'i32' | 'f64'; count?: number }>;
  emits?: Emits;
}
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: string[] }
/** A piece as `deep-logic` takes it: the document's seed, its controls, its logic items at 60 Hz and their programs. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, step_rate: 60 };
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.writes) params['writes'] = spec.writes as unknown as JsonObject;
    if (spec.emits) params['emits'] = spec.emits as unknown as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'press' }])) } : {}),
    items, assets,
  };
}
/** An entry of the input track (Input track: entries), as stamped. */
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you'; player: number }
/** A press of `control` stamped at step `k` of a 60 Hz item: its flick exactly on the step. */
export const press = (control: string, k: number, seq = 0): Entry => ({ t: k * STEP_60, seq, control, value: 1, writer: 'you', player: 1 });

export interface Seek { to: number }
export interface BakeSpec { track?: Entry[]; steps: number; seeks?: Seek[] }
const bakeFields = (p: JsonObject, b: BakeSpec): JsonObject => ({
  piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.seeks ? { seeks: b.seeks as unknown as JsonValue } : {}),
});
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'bake', ...bakeFields(p, b) });
/** logic.determinism (Check input: logic kinds; #532): sampled times in seconds, on this machine. */
export const determinismCall = (p: JsonObject, b: BakeSpec, atTimes: number[]): JsonObject =>
  ({ call: 'determinism', ...bakeFields(p, b), at_times: atTimes, compare: 'same_machine' });

// Replies.

/** One row of an occurrence list (README: Row): its step, its flick, its kind, its two stable IDs and its fields. */
export interface Row { step: number; t: number; kind: string; a: number; b: number; fields: JsonObject }
function rowsOf(v: JsonValue | undefined, what: string): Row[] {
  return arr(v, what).map((x, i) => {
    const o = obj(x, `${what}[${i}]`);
    return {
      step: int(o['step'], `${what}[${i}].step`), t: int(o['t'], `${what}[${i}].t`), kind: str(o['kind'], `${what}[${i}].kind`),
      a: int(o['a'], `${what}[${i}].a`), b: int(o['b'], `${what}[${i}].b`), fields: obj(o['fields'], `${what}[${i}].fields`),
    };
  });
}
/** A row as one line, for messages and for comparing lists. */
export const rowText = (r: Row): string => `step ${r.step} t ${r.t} ${r.kind} a ${r.a} b ${r.b} ${JSON.stringify(r.fields)}`;

export interface ItemStep { hash: string | null; failed: boolean }
export interface StepRecord { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface SeekResult { to: number; from: number; occurrences: Record<string, Row[]> }
export interface Bake { steps: StepRecord[]; traps: JsonObject[]; occurrences: Record<string, Row[]>; seeks: SeekResult[]; raw: JsonObject }
function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      return [id, { hash: typeof it['hash'] === 'string' ? it['hash'] : null, failed: it['failed'] === true }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
/** Each logic item's list by ID (an item that declares no `emits` may be left out, or given as null). */
const listsOf = (v: JsonValue | undefined, what: string): Record<string, Row[]> =>
  Object.fromEntries(Object.entries(obj(v, what)).filter(([, list]) => list !== null).map(([id, list]) => [id, rowsOf(list, `${what}.${id}`)]));
/** A `bake` reply: the fields this suite reads, typed; a missing field fails, naming it. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  return {
    steps: stepsOf(reply['steps'], `${what}.steps`),
    traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => obj(t, `${what}.traps[${i}]`)),
    occurrences: listsOf(reply['occurrences'], `${what}.occurrences (each logic item's occurrence list)`),
    seeks: arr(reply['seeks'] ?? [], `${what}.seeks`).map((s, i) => {
      const o = obj(s, `${what}.seeks[${i}]`);
      return { to: int(o['to'], `${what}.seeks[${i}].to`), from: int(o['from'], `${what}.seeks[${i}].from`), occurrences: listsOf(o['occurrences'], `${what}.seeks[${i}].occurrences (the list after the seek)`) };
    }),
    raw: reply,
  };
}

/** A logic.determinism failure (#532's, README: determinism). */
export interface DetFailure { item: string; run: string; from: number | null; at: number | null; checkpoint: number | null; step: number | null; field: string }
export function determinismOf(reply: JsonObject, what: string): { verdict: string; failures: DetFailure[] } {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.determinism`).toBe('logic.determinism');
  const verdict = str(reply['verdict'], `${what}.verdict`);
  const n = (v: JsonValue | undefined, w: string): number | null => (v === null || v === undefined ? null : int(v, w));
  const failures = arr(reply['failures'], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    const w = `${what}.failures[${i}]`;
    return { item: str(o['item'], `${w}.item`), run: str(o['run'], `${w}.run`), from: n(o['from'], `${w}.from`), at: n(o['at'], `${w}.at`), checkpoint: n(o['checkpoint'], `${w}.checkpoint`), step: n(o['step'], `${w}.step`), field: str(o['field'], `${w}.field`) };
  });
  return { verdict, failures };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's convention, as #500's and #501's suites drive it): one scenario line on stdin, one answer.

/** The scenario's `planted` (#500's form for a module's wrong program; README: Planted twins). */
export type ShowPlanted = 'start_on_at_first_frame' | 'undeclared_kind_accepted' | 'undeclared_field_reads_zero';
const SHOW = 'deep-show';

const ulid = (k: number): string => `01JB544E${String(k).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, each document in a visible panel of its own, the calls. */
export function scenario(evidence: string, calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  const docs: JsonObject = {};
  const panels: JsonObject = {};
  for (const [k, id] of Object.entries(DOC)) { docs[id] = { panel: `p-${k}` }; panels[`p-${k}`] = { rect: [0, 0, 800, 600] }; }
  return { evidence, sessions: {}, processes: PROCESSES, panels, docs, ...(planted ? { planted } : {}), calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(binOf(SHOW), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** `deep show` of a whole document from your shell (#501's `present`): the hub stamps the writer layer. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** Why a `deep show` reply didn't present its document, or null when it did. */
export const notPresented = (reply: JsonObject, what: string): string | null =>
  (reply['outcome'] === 'presented' ? null : `${what} is not presented (outcome ${show(reply['outcome'] ?? null)}): ${show(reply, 1200)}`);

/** `eval` at `t` (flicks) with a render-back snapshot (#387): the canonical render, a PNG in the evidence store. */
export const evalCall = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, pixels: true });
/** An `eval` reply's snapshot SHA-256, or why it has none. */
export function snapshotOf(reply: JsonObject): { sha: string } | { why: string } {
  if (reply['outcome'] !== 'evaluated') return { why: `not evaluated: ${show(reply, 800)}` };
  const list = reply['snapshots'];
  if (!Array.isArray(list) || list.length !== 1 || !isObject(list[0]) || typeof list[0]['sha256'] !== 'string') return { why: `no one snapshot: ${show(reply, 800)}` };
  return { sha: list[0]['sha256'] };
}
/** `determinism` (#488, #1897): the frame reached by playing every display frame from 0 to `t` against the frame
 * reached by seeking there, each on a fresh session, at a 60 Hz display. */
export const showDeterminismCall = (doc: string, t: number): JsonObject => ({ call: 'determinism', doc, display_hz: 60, at_times: [t] });
/** The two sides' canonical renders at the one time asked, or why the reply has none. */
export function sidesOf(reply: JsonObject, t: number): { play: string; seek: string } | { why: string } {
  if (reply['outcome'] !== 'compared') return { why: `not compared: ${show(reply, 800)}` };
  const frames = reply['frames'];
  const f = Array.isArray(frames) ? frames.find((x) => isObject(x) && x['t'] === t) : undefined;
  if (!isObject(f) || !isObject(f['play']) || !isObject(f['seek'])) return { why: `no frame at ${t}: ${show(reply, 800)}` };
  const play = f['play']['pixels']; const seek = f['seek']['pixels'];
  if (typeof play !== 'string' || typeof seek !== 'string') return { why: `no pixels at ${t}: ${show(f, 800)}` };
  return { play, seek };
}

/** One segment of `media_mix` (#499): [from, to) in flicks, written as a float WAV with `write`. */
export interface Segment { from: number; to: number; write?: boolean }
/** `media_mix` of a document (#499, #500) with its input track (README: `track`). */
export const mediaMixCall = (doc: JsonObject, track: Entry[], segments: Segment[]): JsonObject =>
  ({ call: 'media_mix', doc, track: track as unknown as JsonValue, segments: segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })) });
export interface SegmentReply { from: number; to: number; first: number; frames: number; channels: number; sha256: string; wav: string | null }
/** A voice a spawn started (#500's `voices`). */
export interface Voice { spawn: string; occurrence: number; pair: JsonValue[]; start: number; end: number; stolen_by: JsonValue }
export interface Mix { segments: SegmentReply[]; voices: Voice[] }
/** A `media_mix` reply: its segments, as asked, and every voice its spawns started; a missing field fails, naming it. */
export function mixOf(reply: JsonObject, segments: Segment[], what: string): Mix {
  const m = obj(reply['mix'], `${what}: mix (the sound of the document, its spawn reading the logic item's occurrences; the reply was ${show(reply, 600)})`);
  expect(int(m['sample_rate'], `${what}: mix.sample_rate`), `${what}: mix.sample_rate is 48,000 Hz`).toBe(RATE);
  const segs = arr(m['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment reply per segment asked`).toBe(segments.length);
  return {
    segments: segs.map((v, i) => {
      const g = obj(v, `${what}: mix.segments[${i}]`);
      const w = `${what}: mix.segments[${i}]`;
      expect([g['from'], g['to']], `${w}: the segment asked`).toEqual([segments[i]!.from, segments[i]!.to]);
      const s = str(g['sha256'], `${w}.sha256`);
      return { from: int(g['from'], `${w}.from`), to: int(g['to'], `${w}.to`), first: int(g['first'], `${w}.first`), frames: int(g['frames'], `${w}.frames`), channels: int(g['channels'], `${w}.channels`), sha256: s, wav: segments[i]!.write ? str(g['wav'], `${w}.wav (asked with write: true)`) : null };
    }),
    voices: arr(m['voices'], `${what}: mix.voices`).map((v, i) => {
      const o = obj(v, `${what}: mix.voices[${i}]`);
      const w = `${what}: mix.voices[${i}]`;
      return { spawn: str(o['spawn'], `${w}.spawn`), occurrence: int(o['occurrence'], `${w}.occurrence`), pair: arr(o['pair'], `${w}.pair`), start: int(o['start'], `${w}.start`), end: int(o['end'], `${w}.end`), stolen_by: o['stolen_by'] ?? null };
    }),
  };
}

/** `export` with an `out` (#501's delivery form), with its input track (README: `track`). */
export interface ExportAsk { doc: string; out: string; frame_rate: [number, number]; video: JsonObject; audio: JsonObject; track: Entry[] }
export const exportCall = (e: ExportAsk): JsonObject => ({ call: 'export', ...(e as unknown as JsonObject) });
export interface Receipt { frame_rate: JsonValue; duration: number; pcm_hashes: string[]; raw: JsonObject }
export function receiptOf(reply: JsonObject, what: string): Receipt {
  expect(reply['outcome'], `${what} is exported: ${show(reply)}`).toBe('exported');
  const r = obj(reply['receipt'], `${what}: receipt`);
  return {
    frame_rate: r['frame_rate'] ?? null, duration: int(r['duration'], `${what}: receipt.duration (flicks)`),
    pcm_hashes: arr(r['pcm_hashes'], `${what}: receipt.pcm_hashes (each frame's samples)`).map((h, i) => str(h, `${what}: receipt.pcm_hashes[${i}]`)),
    raw: r,
  };
}

/** Every issue a `deep show` reply carries. */
function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** A whole word of `text`, as a reader's ID or a name is written in an issue. */
const names = (text: string, word: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${word}([^A-Za-z0-9_]|$)`).test(text);
/**
 * The check's refusal of a reader of a logic item's occurrences that names what the item doesn't declare
 * (`occurrence.undeclared`, Logic: occurrences): the document is refused, and an error issue of that code names the
 * reader (by its ID among the issue's `ids` or in its `path`), the name it read and, among at most three close names
 * (`close`, as the canvas gives them for an unknown kind), the declared one. Each failure names the reader.
 */
export function undeclaredFailures(reply: JsonObject, want: { reader: string; wrong: string; declared: string }, what: string): string[] {
  const r = want.reader;
  if (reply['outcome'] === 'presented') return [`${r}: ${what} was presented, not refused at check with occurrence.undeclared for ${want.wrong}`];
  if (reply['outcome'] !== 'refused') return [`${r}: ${what} was not refused at check: ${show(reply, 1200)}`];
  const hits = issuesOf(reply).filter((i) => i['code'] === 'occurrence.undeclared');
  if (!hits.length) return [`${r}: ${what} is refused, but with no occurrence.undeclared issue: ${show(issuesOf(reply) as JsonValue, 1500)}`];
  const failures: string[] = [];
  const named = hits.filter((i) => {
    const ids = Array.isArray(i['ids']) ? i['ids'].map(String) : [];
    return ids.includes(r) || names(typeof i['path'] === 'string' ? i['path'] : '', r);
  });
  if (!named.length) return [`${r}: no occurrence.undeclared issue names the reader ${r} among its ids or in its path: ${show(hits as JsonValue, 1500)}`];
  const issue = named[0]!;
  if (issue['severity'] !== 'error') failures.push(`${r}: the occurrence.undeclared issue is not an error: ${show(issue)}`);
  const { close, ...rest } = issue;
  if (!names(JSON.stringify(rest), want.wrong)) failures.push(`${r}: the occurrence.undeclared issue doesn't name ${want.wrong}: ${show(issue)}`);
  const closeNames = (Array.isArray(close) ? close : []).map((c) => (isObject(c) ? String(c['name']) : String(c)));
  if (!closeNames.includes(want.declared)) failures.push(`${r}: the occurrence.undeclared issue doesn't name ${want.declared} among its close names (${closeNames.join(', ') || 'none'})`);
  if (closeNames.length > 3) failures.push(`${r}: the occurrence.undeclared issue names ${closeNames.length} close names, more than three`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(h);
  return bytes;
}
/** A fresh folder per call (an evidence store, an export's folder), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-544-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Sound: a 16-bit WAV asset written here; the mix's float WAVs read back and tied to the reply's hash.

/** A cosine tone (its first sample is its peak, so a voice is audible from its first sample). */
export function tone(hz: number, frames: number, amp: number): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.cos((2 * Math.PI * hz * i) / RATE);
  return x;
}
function encodeWav16(channels: Float32Array[]): Buffer {
  const nch = channels.length; const frames = channels[0]!.length; const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), o); o += 2; }
  return b;
}
interface Wav { rate: number; channels: Float32Array[]; float: boolean }
function decodeWav(bytes: Buffer, what: string): Wav {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect((tag === 3 && bits === 32) || (tag === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const o = (i * nch + c) * width; channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; }
  return { rate, channels, float: tag === 3 };
}
/** Writes a mono 16-bit WAV asset; returns its hash and its samples as decoded from those bytes. */
export function asset(evidence: string, samples: Float32Array): { sha: string; samples: Float32Array } {
  const bytes = encodeWav16([samples]);
  return { sha: putEvidence(evidence, bytes), samples: decodeWav(bytes, 'the test asset').channels[0]! };
}
/** A segment's samples from its float WAV, starting at absolute sample `first`. */
export interface Pcm { first: number; frames: number; channels: Float32Array[] }
/** Interleaved f32le bytes of samples [from, to) (absolute), as the mix and the export hash them. */
export function f32le(p: Pcm, from: number, to: number): Buffer {
  const b = Buffer.alloc((to - from) * p.channels.length * 4);
  let o = 0;
  for (let n = from; n < to; n++) for (const c of p.channels) { b.writeFloatLE(c[n - p.first]!, o); o += 4; }
  return b;
}
/** A segment's WAV: IEEE float at 48 kHz, its channels and length the reply's, its samples hashing to its sha256. */
export function pcmOf(evidence: string, g: SegmentReply, what: string): Pcm {
  expect(g.wav, `${what}: a WAV was written (write: true)`).not.toBeNull();
  const wav = decodeWav(getEvidence(evidence, g.wav!, `${what}: the WAV`), `${what}: the WAV ${g.wav}`);
  expect(wav.float, `${what}: the WAV is IEEE float 32-bit, the mix's own samples`).toBe(true);
  expect(wav.rate, `${what}: the WAV's sample rate`).toBe(RATE);
  expect(wav.channels.length, `${what}: the WAV's channel count is the reply's`).toBe(g.channels);
  expect(wav.channels[0]!.length, `${what}: the WAV holds the reply's frames`).toBe(g.frames);
  const p = { first: g.first, frames: g.frames, channels: wav.channels };
  expect(sha256(f32le(p, g.first, g.first + g.frames)), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  return p;
}
/** A sample at or under this magnitude is silence (−120 dBFS). */
export const SILENCE = 2 ** -20;
/** The least-squares gain k of y ≈ k·x over absolute samples [from, to) of one channel, and the residual's RMS relative
 * to y's (0 when y is exactly k·x). `model(n)` gives x at absolute sample n. */
export function fit(p: Pcm, ch: number, from: number, to: number, model: (n: number) => number): { k: number; residual: number } {
  let xy = 0, xx = 0, yy = 0;
  for (let n = from; n < to; n++) { const y = p.channels[ch]![n - p.first]!; const x = model(n); xy += x * y; xx += x * x; yy += y * y; }
  const k = xx > 0 ? xy / xx : 0;
  let rr = 0;
  for (let n = from; n < to; n++) { const e = p.channels[ch]![n - p.first]! - k * model(n); rr += e * e; }
  return { k, residual: yy > 0 ? Math.sqrt(rr / yy) : (rr > 0 ? Infinity : 0) };
}
/** The loudest sample over absolute samples [from, to), every channel. */
export function peak(p: Pcm, from: number, to: number): number {
  let m = 0;
  for (const c of p.channels) for (let n = from; n < to; n++) m = Math.max(m, Math.abs(c[n - p.first]!));
  return m;
}
