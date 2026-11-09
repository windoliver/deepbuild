// Test-side tools for the #531 acceptance tests (README: The surface under test). They assemble this suite's
// WebAssembly programs with its own assembler (wat/), build its Rust program (rules/) for wasm32 with debug info,
// build and drive the logic module's runner `deep-logic` on this Mac and, through Docker, on Linux x86_64, drive
// sandbox@1's runner `deep-sandbox` (#238) for the reports a logic item's check must match, and run the logic
// module's web runner in headless Chrome. Nothing here stands in for the check, the rewrite, the steps, the
// checkpoints, the trap mapper or the budget report: every verdict, hash, array, trap and line read here is the
// implementation's own; the expected values come from the issue's text and from this suite's own programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/531 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));
const TARGET = targetOf(REPO, process.env);
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
/** Debug builds as the other suites make them, unless the caller set these. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: a first build of deep-logic, and its Linux build under emulation, take many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#531.024523a2', 2: '#531.7cbe85cc', 3: '#531.cbdb60cc', 4: '#531.f2a68f95', 5: '#531.50a7adee', 6: '#531.8f04cd7e',
  7: '#531.8b2a1747', 8: '#531.95fffd8f', 9: '#531.9a08f4d0', 10: '#531.1b30f7a8', 11: '#531.6b6fc913', 12: '#531.ff4975c5',
} as const;

export const FLICKS = 705_600_000;
/** A step's length in flicks at `hz` (the valid-rates rule: 705,600,000 ÷ hz is whole). */
export const stepLength = (hz: number): number => FLICKS / hz;
export const STEP_60 = stepLength(60);
export const MIB = 1024 * 1024;
export const FOUR_MIB = 4 * MIB;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isSafeInteger(value), `${what} is an integer, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A seeded generator (mulberry32), so a failing run replays. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/, the `wat` and `wasmparser` crates,
// outside the workspace), which also lists each function body's operators with their module offsets, the
// exports and the start function. The Rust program (rules/) is built for wasm32 and listed the same way.

export interface Fn { index: number; start: number; end: number; ops: [number, string][] }
export interface Program { name: string; bytes: Buffer; b64: string; sha: string; functions: Fn[]; exports: [string, string, number][]; start: number | null }

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-531-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/531/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-531-wat'));
  return watBin;
}
function listed(dir: string, name: string): Program {
  const bytes = readFileSync(join(dir, `${name}.wasm`));
  const listing = JSON.parse(readFileSync(join(dir, `${name}.ops.json`), 'utf8')) as { functions?: Fn[]; exports?: [string, string, number][]; start?: number | null; error?: string };
  if (listing.error) throw Error(`the assembler couldn't list ${name}: ${listing.error}`);
  return { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes), functions: listing.functions ?? [], exports: listing.exports ?? [], start: listing.start ?? null };
}
const assembledText = new Map<string, Program>();
/** Assembles WebAssembly text (or lists a binary module given as bytes) into a Program. */
export function assemble(name: string, text: string | Buffer): Program {
  const key = `${name}\n${typeof text === 'string' ? text : sha256(text)}`;
  const known = assembledText.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-531-wat-'));
  try {
    const file = join(dir, typeof text === 'string' ? `${name}.wat` : `${name}.wasm`);
    writeFileSync(file, text);
    const out = join(dir, 'out');
    mkdirSync(out);
    const run = spawnSync(assembler(), [out, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const p = listed(out, name);
    assembledText.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A program from bytes this test changed (padded), keeping the listing it had. */
export const programOf = (name: string, bytes: Buffer, like?: Program): Program =>
  ({ name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes), functions: like?.functions ?? [], exports: like?.exports ?? [], start: like?.start ?? null });
export function fn(p: Program, index: number): Fn {
  const f = p.functions.find((x) => x.index === index);
  if (!f) throw Error(`${p.name} has no function ${index} in its listing`);
  return f;
}
/** The module offset of the first operator `op` (wasmparser's name, e.g. `I32DivU`) in function `index`. */
export function opAt(p: Program, index: number, op: string): number {
  const hit = fn(p, index).ops.find(([, name]) => name === op);
  if (!hit) throw Error(`${p.name}'s function ${index} has no ${op}`);
  return hit[0];
}
/** The index of the exported function `name`. */
export function exported(p: Program, name: string): number {
  const e = p.exports.find(([n, kind]) => n === name && kind === 'Func');
  if (!e) throw Error(`${p.name} exports no function ${name}`);
  return e[2];
}
export const inBody = (p: Program, index: number, offset: number): boolean => { const f = fn(p, index); return offset >= f.start && offset < f.end; };
/** `base` with a custom section appended so the whole program is exactly `total` bytes (as #238's suite pads). */
export function padded(base: Buffer, total: number, name = 'pad'): Buffer {
  const leb = (n: number): Buffer => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
  const label = Buffer.concat([leb(name.length), Buffer.from(name)]);
  for (let payload = Math.max(0, total - base.length - 1 - 5 - label.length); payload <= total; payload++) {
    const body = label.length + payload;
    const section = Buffer.concat([Buffer.from([0]), leb(body), label, Buffer.alloc(payload)]);
    if (base.length + section.length === total) return Buffer.concat([base, section]);
    if (base.length + section.length > total) break;
  }
  throw Error(`can't pad ${base.length} bytes to exactly ${total}`);
}

/** sandbox@1's own kit fixtures (crates/deep-canvas-sandbox/kit at this checkout), its refusal fixtures by name. */
export function kitRefusalFixtures(): { fixture: string; program: Program }[] {
  const dir = join(REPO, 'crates', 'deep-canvas-sandbox', 'kit');
  const kit = JSON.parse(readFileSync(join(dir, 'kit.json'), 'utf8')) as { fixtures: { fixture: string; program: string }[] };
  return kit.fixtures.filter((f) => f.fixture.startsWith('refuse.')).map((f) => {
    const p = assemble(f.program.replace(/\.wat$/, ''), readFileSync(join(dir, f.program), 'utf8'));
    // sandbox@1's kit pads pass_subset.wat to one byte over 4 MiB for refuse.over_4mib (the #238 README: Fixtures).
    return { fixture: f.fixture, program: f.fixture === 'refuse.over_4mib' ? programOf('over_4mib', padded(p.bytes, FOUR_MIB + 1), p) : p };
  });
}

// The Rust program (rules/): built once per process for wasm32-unknown-unknown with debug info; the agent's
// program is the built module with its `.debug_*` custom sections taken out, and the sidecar holds them.
const RULES_DIR = join(HERE, 'rules');
const RULES_TARGET = join(TARGET, 'acceptance-531-rules');
export interface Rules { built: Buffer; program: Program; sidecar: Buffer; judge: number; divide: number; work: number }
let rules: Rules | undefined;
/** Splits a module into the module without its `.debug_*` custom sections and a sidecar module holding only them. */
export function splitDebug(bytes: Buffer): { program: Buffer; sidecar: Buffer } {
  const header = bytes.subarray(0, 8);
  const keep: Buffer[] = [header];
  const debug: Buffer[] = [header];
  let at = 8;
  while (at < bytes.length) {
    const start = at;
    const id = bytes[at++]!;
    let size = 0; let shift = 0; let b: number;
    do { b = bytes[at++]!; size += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    const end = at + size;
    let isDebug = false;
    if (id === 0) {
      let n = 0; let s = 0; let p = at; let c: number;
      do { c = bytes[p++]!; n += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80);
      isDebug = bytes.subarray(p, p + n).toString('utf8').startsWith('.debug_');
    }
    (isDebug ? debug : keep).push(bytes.subarray(start, end));
    at = end;
  }
  return { program: Buffer.concat(keep), sidecar: Buffer.concat(debug) };
}
export function rulesProgram(): Rules {
  if (rules) return rules;
  const error = cargo(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(RULES_DIR, 'Cargo.toml')], RULES_DIR, { CARGO_TARGET_DIR: RULES_TARGET });
  if (error) blocked(`this suite's Rust program (tests/acceptance/531/rules) didn't build for wasm32-unknown-unknown (rust-toolchain.toml installs that target): ${error}`);
  const built = readFileSync(join(RULES_TARGET, 'wasm32-unknown-unknown', 'release', 'acceptance_531_rules.wasm'));
  const { program, sidecar } = splitDebug(built);
  expect(sidecar.length, 'the Rust program was built with debug info (.debug_* sections)').toBeGreaterThan(1000);
  const p = assemble('rules', program);
  // The division at rules.rs:42 is the one i32.div_u in the module; `judge` is the function that holds it.
  const divs = p.functions.flatMap((f) => f.ops.filter(([, op]) => op === 'I32DivU').map(([o]) => ({ f: f.index, o })));
  expect(divs.length, `the Rust program holds one unsigned division (rules.rs:42), found ${JSON.stringify(divs)}`).toBe(1);
  // `work` is the function with the loops: the one whose body holds Loop operators.
  const work = p.functions.find((f) => f.ops.some(([, op]) => op === 'Loop'));
  if (!work) throw Error('the Rust program has no function with a loop (rules.rs:10, 20, 30)');
  rules = { built, program: p, sidecar, judge: divs[0]!.f, divide: divs[0]!.o, work: work.index };
  return rules;
}

// ---------------------------------------------------------------------------------------------------
// The runners: `deep-logic` (README: deep-logic) and `deep-sandbox` (#238), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
export const SANDBOX_BIN = 'deep-sandbox';
/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type LogicPlanted =
  | 'tracker_skips_memory_copy' | 'runs_unchecked' | 'digest_compares_total_sizes' | 'mapper_ignores_fuel_shift' | 'budget_charges_function_first_line';

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0; each failure names the host. */
export function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

let binsDir = '';
function bins(): string {
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-531-bins-'));
  return binsDir;
}
const built = new Map<string, { bin: string; error: string }>();
/** `cargo build --locked --bin <name>` in the checkout, copied out under its own name, once per process. */
function native(name: string): string {
  let made = built.get(name);
  if (!made) {
    const bin = join(bins(), exe(name));
    const error = cargo(['build', '--locked', '--bin', name], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(name)), bin);
    made = { bin, error };
    built.set(name, made);
  }
  expect(made.error, `${name} builds on this host (cargo build --locked --bin ${name})`).toBe('');
  return made.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });
export const logicBin = (): string => native(LOGIC_BIN);
export const sandboxBin = (): string => native(SANDBOX_BIN);

/** Runs `calls` through one `deep-logic [--planted p]` process on this Mac. */
export function onMac(calls: JsonObject[], planted?: LogicPlanted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')} on ${process.platform}/${process.arch}`);
}
/** Runs `calls` through one `deep-sandbox` process on this Mac (#238's runner, as it is at this checkout plus #531's role). */
export function onSandbox(calls: JsonObject[]): JsonObject[] {
  return replies(start(sandboxBin(), [], calls), calls, `${SANDBOX_BIN} on ${process.platform}/${process.arch}`);
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker, with the rust image of the toolchain
// rust-toolchain.toml names, its target and cargo caches kept under target/acceptance-531-linux/ so later runs
// build warm. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(TARGET, 'acceptance-531-linux');
export function linuxImage(): string {
  const toml = readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8');
  const channel = /channel\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
const toolchain = (): string => linuxImage().replace(/^rust:/, '').replace(/-slim-bookworm$/, '');
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
/** Whether Docker holds the image for linux/amd64 (a tag that names a multi-platform index is read per platform). */
function hasAmd64(image: string): boolean {
  const perPlatform = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (perPlatform.status === 0 && perPlatform.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
let linuxBuilt: string | undefined;
/** Builds `deep-logic` for linux/amd64 once per process; BLOCKED without Docker or the image, FAIL when cargo fails. */
export function linuxLogic(): void {
  if (linuxBuilt === '') return;
  if (linuxBuilt !== undefined) expect(linuxBuilt, `${LOGIC_BIN} builds for Linux x86_64`).toBe('');
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
  const image = linuxImage();
  if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const build = docker([
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${toolchain()}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
    image, 'cargo', 'build', '--locked', '--bin', LOGIC_BIN,
  ], undefined, TIMEOUT - 600_000);
  linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin ${LOGIC_BIN} in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  expect(linuxBuilt, `${LOGIC_BIN} builds for Linux x86_64`).toBe('');
}
/** Runs `calls` through one `deep-logic` process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxLogic();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), `/target/debug/${LOGIC_BIN}`], text, 1_800_000);
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr };
  return replies(s, calls, `${LOGIC_BIN} on linux/amd64`);
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Piece) and the calls.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface ItemSpec {
  program: Program;
  /** The sidecar's bytes: named on the item as `debug` by its sha256 and carried in `assets`. */
  debug?: Buffer;
  step_rate?: number;
  reads?: string[];
  writes: Record<string, { type: WriteType; count?: number }>;
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
}
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: string[]; tour?: JsonObject }
/** A piece as `deep-logic` takes it: the document's seed, its controls, its tour, its logic items and the assets they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.debug) { const s = sha256(spec.debug); assets[s] = spec.debug.toString('base64'); params['debug'] = s; }
    if (spec.step_rate !== undefined) params['step_rate'] = spec.step_rate;
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.budget) params['budget'] = spec.budget as JsonObject;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    ...(p.tour ? { tour: p.tour } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry of yours on the input track, at step `k` of a `hz` item (its flick exactly on the step). */
export const yours = (control: string, k: number, value: number, seq = 0, hz = 60): Entry => ({ t: k * stepLength(hz), seq, control, value, writer: 'you', player: 1 });

export const ABOUT: JsonObject = { call: 'about' };
export const WEB_RUNNER: JsonObject = { call: 'web_runner' };
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface Restore { from: number; steps: number; probe?: { entries: Entry[]; steps: number } }
export interface Probe { at: number; entries: Entry[]; steps: number }
export interface BakeSpec { track?: Entry[]; steps: number; restores?: Restore[]; probes?: Probe[]; peek?: { item: string; at: number; len: number }[] }
const bakeFields = (p: JsonObject, b: BakeSpec): JsonObject => ({
  piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.restores ? { restores: b.restores as unknown as JsonValue } : {}),
  ...(b.probes ? { probes: b.probes as unknown as JsonValue } : {}),
  ...(b.peek ? { peek: b.peek as unknown as JsonValue } : {}),
});
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'bake', ...bakeFields(p, b) });
export const webPlanCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'web_plan', ...bakeFields(p, b) });

// Replies.

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number; type: string }[] }
export interface Checked { program: string; hash: string; layout: Layout }
export function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const digest = str(o['digest'], `${what}.digest`);
  expect(digest, `${what}.digest is 16 lowercase hex digits (a u64)`).toMatch(HASH64);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    return { region: str(x['region'], `${what}.entries[${i}].region`), name: str(x['name'], `${what}.entries[${i}].name`), offset: int(x['offset'], `${what}.entries[${i}].offset`), size: int(x['size'], `${what}.entries[${i}].size`), type: String(x['type'] ?? '') };
  });
  return { digest, entries };
}
/** A `check` (or `bake`) reply's admitted items: `{ok: true, items: {id: {program, hash, layout}}}`. */
export function admitted(reply: JsonObject, what: string): Record<string, Checked> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  const items = obj(reply['items'], `${what}.items`);
  return Object.fromEntries(Object.entries(items).map(([id, v]) => {
    const o = obj(v, `${what}.items.${id}`);
    const program = str(o['program'], `${what}.items.${id}.program`);
    const hash = str(o['hash'], `${what}.items.${id}.hash`);
    expect(program, `${what}.items.${id}.program is a sha256`).toMatch(DIGEST);
    expect(hash, `${what}.items.${id}.hash is a sha256`).toMatch(DIGEST);
    return [id, { program, hash, layout: layoutOf(o['layout'], `${what}.items.${id}.layout`) }];
  }));
}
export interface Refused { code: string; item: string; refusals: JsonObject[]; raw: JsonObject }
/** A refusal: `{ok: false, code: "subset_refused" | "logic_refused", item, refusals: [...]}`. */
export function refusedOf(reply: JsonObject, what: string): Refused {
  expect(reply['ok'], `${what} is refused at check (ok: false): ${show(reply)}`).toBe(false);
  const code = str(reply['code'], `${what}.code`);
  expect(['subset_refused', 'logic_refused'], `${what}.code is a check refusal: ${show(reply)}`).toContain(code);
  const refusals = arr(reply['refusals'], `${what}.refusals`).map((r, i) => obj(r, `${what}.refusals[${i}]`));
  expect(refusals.length, `${what} names at least one refusal`).toBeGreaterThan(0);
  return { code, item: str(reply['item'], `${what}.item`), refusals, raw: reply };
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): { offset: number; size: number } {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return { offset: e.offset, size: e.size };
}
export const regionSize = (l: Layout, region: 'reads' | 'writes'): number => Math.max(0, ...l.entries.filter((e) => e.region === region).map((e) => e.offset + e.size));

export interface ItemStep { hash: string | null; fuel: number; failed: boolean; pages: number[] | null }
export interface StepRecord { step: number; t: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface Trap { item: string; step: number | null; t: number | null; kind: string; function: number; offset: number; inputs: JsonObject[]; source: string | null }
export interface Budget { item: string; step: number; fuel: number; lines: { source: string; fuel: number }[] }
export interface ProbeResult { at: number; steps: StepRecord[]; deep_hash: Record<string, string> }
export interface RestoreResult { from: number; checkpoints: Record<string, Checkpoint[]>; steps: StepRecord[]; probe: ProbeResult | null }
export interface Bake {
  items: Record<string, Checked> | null; steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; traps: Trap[]; budgets: Budget[];
  restores: RestoreResult[]; probes: ProbeResult[]; peeks: { item: string; at: number; hex: string }[]; track: JsonObject[]; raw: JsonObject;
}
function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      const hash = it['hash'] === null || it['hash'] === undefined ? null : str(it['hash'], `${what}[${i}].items.${id}.hash`);
      if (hash !== null) expect(hash, `${what}[${i}].items.${id}.hash is 16 hex digits`).toMatch(HASH64);
      const pages = Array.isArray(it['pages']) ? it['pages'].map((p, j) => int(p, `${what}[${i}].items.${id}.pages[${j}]`)) : null;
      return [id, { hash, fuel: int(it['fuel'], `${what}[${i}].items.${id}.fuel`), failed: it['failed'] === true, pages }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), t: int(o['t'], `${what}[${i}].t`), items, arrays };
  });
}
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    const deep = str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`);
    expect(deep, `${what}.${id}[${i}].deep_hash is 16 hex digits`).toMatch(HASH64);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: deep };
  })]));
}
function probeOf(v: JsonValue | undefined, what: string): ProbeResult {
  const o = obj(v, what);
  return { at: int(o['at'], `${what}.at`), steps: stepsOf(o['steps'], `${what}.steps`), deep_hash: Object.fromEntries(Object.entries(obj(o['deep_hash'], `${what}.deep_hash`)).map(([id, h]) => [id, str(h, `${what}.deep_hash.${id}`)])) };
}
export function trapOf(v: JsonValue, what: string): Trap {
  const o = obj(v, what);
  return {
    item: str(o['item'], `${what}.item`), step: o['step'] === null ? null : int(o['step'], `${what}.step`), t: o['t'] === null || o['t'] === undefined ? null : int(o['t'], `${what}.t`),
    kind: str(o['kind'], `${what}.kind`), function: int(o['function'], `${what}.function`), offset: int(o['offset'], `${what}.offset`),
    inputs: arr(o['inputs'] ?? [], `${what}.inputs`).map((e, i) => obj(e, `${what}.inputs[${i}]`)),
    source: typeof o['source'] === 'string' ? o['source'] : null,
  };
}
/** A `bake` reply (or the web runner's `bake`): every field it holds, typed. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  return {
    items: isObject(reply['items']) ? admitted(reply, what) : null,
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => trapOf(t, `${what}.traps[${i}]`)),
    budgets: arr(reply['budgets'] ?? [], `${what}.budgets`).map((b, i) => {
      const o = obj(b, `${what}.budgets[${i}]`);
      return {
        item: str(o['item'], `${what}.budgets[${i}].item`), step: int(o['step'], `${what}.budgets[${i}].step`), fuel: int(o['fuel'], `${what}.budgets[${i}].fuel`),
        lines: arr(o['lines'], `${what}.budgets[${i}].lines`).map((l, j) => { const x = obj(l, `${what}.budgets[${i}].lines[${j}]`); return { source: str(x['source'], `${what}.budgets[${i}].lines[${j}].source`), fuel: int(x['fuel'], `${what}.budgets[${i}].lines[${j}].fuel`) }; }),
      };
    }),
    restores: arr(reply['restores'] ?? [], `${what}.restores`).map((r, i) => {
      const o = obj(r, `${what}.restores[${i}]`);
      return { from: int(o['from'], `${what}.restores[${i}].from`), checkpoints: checkpointsOf(o['checkpoints'], `${what}.restores[${i}].checkpoints`), steps: stepsOf(o['steps'], `${what}.restores[${i}].steps`), probe: o['probe'] ? probeOf(o['probe'], `${what}.restores[${i}].probe`) : null };
    }),
    probes: arr(reply['probes'] ?? [], `${what}.probes`).map((p, i) => probeOf(p, `${what}.probes[${i}]`)),
    peeks: arr(reply['peeks'] ?? [], `${what}.peeks`).map((p, i) => { const o = obj(p, `${what}.peeks[${i}]`); return { item: str(o['item'], `${what}.peeks[${i}].item`), at: int(o['at'], `${what}.peeks[${i}].at`), hex: str(o['hex'], `${what}.peeks[${i}].hex`) }; }),
    track: arr(reply['track'] ?? [], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)),
    raw: reply,
  };
}
/** The step record of step `k`. */
export function at(steps: StepRecord[], k: number, what: string): StepRecord {
  const s = steps.find((x) => x.step === k);
  expect(s, `${what} holds step ${k} (it holds ${steps.length} steps from ${steps[0]?.step ?? 'none'})`).toBeDefined();
  return s!;
}
/** An array's values at a step, read as `<logic ID>.<name>`. */
export function arrayAt(steps: StepRecord[], k: number, path: string, what: string): JsonValue[] {
  const s = at(steps, k, what);
  const v = s.arrays[path];
  expect(v, `${what}: step ${k} holds the array ${path} (it holds ${Object.keys(s.arrays).join(', ') || 'none'})`).toBeDefined();
  return v!;
}
/** Each step's hash per item, as `step:item=hash` lines, for comparing runs. */
export const stepHashes = (steps: StepRecord[]): string[] => steps.flatMap((s) => Object.entries(s.items).map(([id, x]) => `${s.step}:${id}=${x.hash}`));
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${a[i] ?? '(none)'} against ${b[i] ?? '(none)'}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// A long-lived `deep-logic` process (criterion 12): calls in, replies awaited one by one, so a test can look at
// the process between and during calls. Stopped by its PID at the end.

export interface Live { pid: number; call: (c: JsonObject, during?: () => void) => Promise<JsonObject>; stop: () => void }
export function live(planted?: LogicPlanted): Live {
  const child: ChildProcessWithoutNullStreams = spawn(logicBin(), planted ? ['--planted', planted] : [], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let stderr = '';
  const waiting: ((line: string) => void)[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); waiting.shift()?.(line); }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => { stderr += d; });
  if (child.pid === undefined) throw Error(`${LOGIC_BIN} didn't start`);
  const pid = child.pid;
  return {
    pid,
    call: async (c, during) => {
      let line: string | undefined;
      const got = new Promise<string>((res) => waiting.push((l) => { line = l; res(l); }));
      child.stdin.write(`${JSON.stringify(c)}\n`);
      if (during) while (line === undefined && child.exitCode === null) { during(); await new Promise((r) => setImmediate(r)); }
      const text = await Promise.race([got, new Promise<string>((res) => child.once('exit', () => res(`{"ok":false,"code":"exited","stderr":${JSON.stringify(stderr.slice(-1500))}}`)))]);
      return obj(JSON.parse(text) as JsonValue, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`);
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}
/** The number of threads process `pid` has now (macOS `ps -M`: a header, then one line per thread; Linux /proc). */
export function threadsOf(pid: number): number {
  if (process.platform === 'linux') {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    return Number(/^Threads:\s+(\d+)/m.exec(status)?.[1] ?? NaN);
  }
  const ps = spawnSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' });
  if (ps.status !== 0) return NaN;
  return ps.stdout.split('\n').filter((l) => l.trim() !== '').length - 1;
}

// ---------------------------------------------------------------------------------------------------
// Headless Chrome: a page this test serves imports the logic module's web runner (`web_runner`'s source) and runs
// each request through its `bake` in Chrome's own WebAssembly engine, posting the replies back.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = `<!doctype html><meta charset="utf-8"><title>#531 web runner</title><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
try {
  const runner = await import('/runner.mjs');
  const requests = await (await fetch('/requests.json')).json();
  const replies = [];
  for (const request of requests) {
    try { replies.push(await runner.bake(request)); }
    catch (e) { replies.push({ ok: false, code: 'runner_threw', message: String((e && e.stack) || e) }); }
  }
  await post({ userAgent: navigator.userAgent, replies });
} catch (e) { await post({ userAgent: navigator.userAgent, error: String((e && e.stack) || e) }); }
</script>`;
export interface InChrome { userAgent: string; replies: JsonValue[] }
/** Runs `requests` through the web runner `source` in headless Chrome; BLOCKED without Chrome. */
export async function inChrome(source: string, requests: JsonValue[], timeoutMs = 1_200_000): Promise<InChrome> {
  if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the web player's engine runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-531-chrome-'));
  let settle: (v: JsonObject) => void = () => {};
  const posted = new Promise<JsonObject>((res) => { settle = res; });
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/results') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c: string) => { body += c; });
      req.on('end', () => { res.end('ok'); try { settle(JSON.parse(body) as JsonObject); } catch { settle({ error: `unreadable post: ${body.slice(0, 500)}` }); } });
      return;
    }
    const send = (type: string, text: string): void => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(text); };
    if (url === '/' || url === '/index.html') send('text/html', PAGE);
    else if (url === '/runner.mjs') send('text/javascript', source);
    else if (url === '/requests.json') send('application/json', JSON.stringify(requests));
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as AddressInfo).port;
  // The mock keychain and no background networking keep a fresh profile from waiting on the keychain and on
  // policy and component fetches (#238's suite found a minute's wait without them).
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([posted, new Promise<JsonObject>((res) => { timer = setTimeout(() => res({ error: `no reply from the page within ${timeoutMs} ms` }), timeoutMs); })]);
    if (typeof out['error'] === 'string') expect.fail(`headless Chrome: the web runner page failed: ${out['error']}`);
    return { userAgent: str(out['userAgent'], 'the page\'s userAgent'), replies: arr(out['replies'], 'the page\'s replies') };
  } finally {
    if (timer) clearTimeout(timer);
    // Chrome and its helpers are this test's own process group (a detached child): stopped by its PID.
    if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
    await new Promise<void>((res) => server.close(() => res()));
    rmSync(profile, { recursive: true, force: true });
  }
}
/** The logic module's web runner from this Mac's `deep-logic`, checked to drive the browser's own WebAssembly. */
export function webRunnerSource(): string {
  const [reply] = onMac([WEB_RUNNER]);
  const source = str(reply!['source'], 'web_runner: source');
  expect(/WebAssembly\.(instantiate|Module|Instance|compile)/.test(source), 'the web runner runs the rewritten bytes in the browser\'s own WebAssembly engine').toBe(true);
  return source;
}
/** The web runner requests `web_plan` gives for these bakes, run on this Mac's `deep-logic`. */
export function webPlans(calls: JsonObject[]): JsonValue[] {
  return onMac(calls).map((r, i) => {
    expect(r['ok'], `web_plan ${i} gave a request: ${show(r)}`).toBe(true);
    expect(r['request'], `web_plan ${i}.request`).toBeDefined();
    return r['request']!;
  });
}
