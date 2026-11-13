// Test-side tools for the #238 acceptance tests (README: The surface under test). They assemble this suite's
// WebAssembly fixtures with its own assembler (wat/), build and drive the sandbox module's runner `deep-sandbox`
// on macOS and, through Docker, on Linux x86_64, run rewritten programs in headless Chrome through the web
// runner the implementation serves, and build and drive `deep-show run` per Cargo feature set (as #185's and
// #200's suites do). Nothing here stands in for the subset check, the rewrite, the runner, the trap mapper, the
// kit, the seal or the pack check: every verdict, trap, hash and byte read here is the implementation's own.

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/238 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));
/** Debug builds as the other deep-show suites make them, unless the caller set these. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

export const DIGEST = /^[0-9a-f]{64}$/;
export const PATCH = /^=?\d+\.\d+\.\d+$/;
export const WASMTIME = '49.0.5';
export const MIB = 1024 * 1024;
export const FOUR_MIB = 4 * MIB;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** Lowercase hex of little-endian bytes: `le32(10)` is `0a000000`. */
export const le32 = (n: number): string => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b.toString('hex'); };
export const hexOf = (bits: bigint, bytes: 4 | 8): string => {
  const b = Buffer.alloc(bytes);
  if (bytes === 4) b.writeUInt32LE(Number(bits)); else b.writeBigUInt64LE(bits);
  return b.toString('hex');
};

// ---------------------------------------------------------------------------------------------------
// Fixtures: fixtures/*.wat assembled by this suite's own assembler (wat/, the `wat` and `wasmparser` crates,
// outside the workspace), which also lists every function body's operators with their module offsets.

export interface Fn { index: number; start: number; end: number; ops: [number, string][] }
export interface Fixture { name: string; bytes: Buffer; b64: string; functions: Fn[] }

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(REPO, 'target', 'acceptance-238-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], {
    cwd: WAT_DIR, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, CARGO_TARGET_DIR: WAT_TARGET },
  });
  if (run.status !== 0) blocked(`this suite's fixture assembler (tests/acceptance/238/wat) didn't build: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-238-wat'));
  return watBin;
}
function loadAssembled(dir: string, name: string): Fixture {
  const bytes = readFileSync(join(dir, `${name}.wasm`));
  const listing = JSON.parse(readFileSync(join(dir, `${name}.ops.json`), 'utf8')) as { functions?: Fn[]; error?: string };
  return { name, bytes, b64: bytes.toString('base64'), functions: listing.functions ?? [] };
}
/** Assembles WebAssembly text written by a test (the 1 MB program) into a fixture. */
export function assembleText(name: string, text: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'deep-238-wat-'));
  try {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler(), [dir, join(dir, `${name}.wat`)], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) blocked(`the assembler refused the generated ${name}.wat: ${run.stderr.slice(-2000)}`);
    return loadAssembled(dir, name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
let assembled: Map<string, Fixture> | undefined;
/** Every fixtures/*.wat, assembled once per process. */
export function fixtures(): Map<string, Fixture> {
  if (assembled) return assembled;
  const dir = mkdtempSync(join(tmpdir(), 'deep-238-fixtures-'));
  try {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.wat')).sort();
    const run = spawnSync(assembler(), [dir, ...files.map((f) => join(FIXTURES, f))], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) blocked(`the assembler refused a fixture: ${run.stderr.slice(-3000)}`);
    assembled = new Map(files.map((f) => { const name = f.slice(0, -4); return [name, loadAssembled(dir, name)]; }));
    return assembled;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export function fixture(name: string): Fixture {
  const fx = fixtures().get(name);
  if (!fx) throw Error(`no fixture ${name}.wat in ${FIXTURES}`);
  return fx;
}
export const bin = (name: string): Buffer => readFileSync(join(FIXTURES, name));
export function fn(fx: Fixture, index: number): Fn {
  const f = fx.functions.find((x) => x.index === index);
  if (!f) throw Error(`${fx.name} has no function ${index} in its listing`);
  return f;
}
/** The module offset of the first (or last) operator `op` (wasmparser's name, e.g. `I32DivS`) in function `index`. */
export function opAt(fx: Fixture, index: number, op: string, which: 'first' | 'last' = 'first'): number {
  const hits = fn(fx, index).ops.filter(([, name]) => name === op);
  const hit = which === 'first' ? hits[0] : hits[hits.length - 1];
  if (!hit) throw Error(`${fx.name}'s function ${index} has no ${op}`);
  return hit[0];
}
/** `base` with a custom section appended so the whole program is exactly `total` bytes. */
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
export const sized = (base: Fixture, total: number, name: string): Fixture => {
  const bytes = padded(base.bytes, total);
  return { name, bytes, b64: bytes.toString('base64'), functions: base.functions };
};

// ---------------------------------------------------------------------------------------------------
// The sandbox runner `deep-sandbox` (README: deep-sandbox): JSON lines in, one reply per line, exit 0.

export const SANDBOX_BIN = 'deep-sandbox';
/** Its startup `--planted <name>` values, each one criterion's wrong program (README: Planted twins). */
export type SandboxPlanted =
  | 'rewriter_skips_back_edge_fuel' | 'meters_with_wasmtime_fuel' | 'runner_skips_nan' | 'rewriter_no_call_overhead'
  | 'check_parser_defaults' | 'mapper_reports_unreachable' | 'rewrite_grow_returns_minus_one';

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000, cwd = REPO): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
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
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** `cargo build --locked [--release] --bin <bin> [features]` in `root`; '' or cargo's error. */
export function cargoBuild(root: string, binName: string, features: string[] | null, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', binName, ...(features ? ['--no-default-features', '--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
function buildTo(root: string, binName: string, features: string[] | null, to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargoBuild(root, binName, features, env);
  if (error === '') copyFileSync(join(targetOf(root, { ...process.env, ...env }), 'debug', exe(binName)), to);
  return error;
}

let nativeSandbox: { bin: string; error: string } | undefined;
let binsDir = '';
function bins(): string {
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-238-bins-'));
  return binsDir;
}
/** The macOS (this host's) `deep-sandbox`, built once per process; a test that uses it fails with cargo's error when it didn't build. */
export function macSandbox(): string {
  nativeSandbox ??= (() => { const b = join(bins(), exe(SANDBOX_BIN)); return { bin: b, error: buildTo(REPO, SANDBOX_BIN, null, b) }; })();
  expect(nativeSandbox.error, `${SANDBOX_BIN} builds on this host (cargo build --locked --bin ${SANDBOX_BIN})`).toBe('');
  return nativeSandbox.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; nativeSandbox = undefined; deepShows.clear(); });

/** Runs `calls` through one `deep-sandbox [--planted p]` process on this host. */
export function onMac(calls: JsonObject[], planted?: SandboxPlanted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  return replies(start(macSandbox(), args, calls), calls, `${SANDBOX_BIN} ${args.join(' ')} on ${process.platform}/${process.arch}`);
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker (OrbStack's Rosetta on this Mac), with the
// rust image of the toolchain rust-toolchain.toml names, its target and cargo caches kept under
// target/acceptance-238-linux/ so later runs build warm. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(REPO, 'target', 'acceptance-238-linux');
export function linuxImage(): string {
  const toml = readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8');
  const channel = /channel\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
const toolchain = (): string => linuxImage().replace(/^rust:/, '').replace(/-slim-bookworm$/, '');
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
let linuxBuilt: string | undefined;
/** Builds `deep-sandbox` for linux/amd64 once per process; BLOCKED without Docker or the image, FAIL when cargo fails. */
export function linuxSandbox(): void {
  if (linuxBuilt === '') return;
  if (linuxBuilt !== undefined) expect(linuxBuilt, `${SANDBOX_BIN} builds for Linux x86_64`).toBe('');
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
  const image = linuxImage();
  if (docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() !== 'amd64') {
    blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
  }
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const build = docker([
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${toolchain()}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
    image, 'cargo', 'build', '--locked', '--bin', SANDBOX_BIN,
  ], undefined, 5_400_000);
  linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin ${SANDBOX_BIN} in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  expect(linuxBuilt, `${SANDBOX_BIN} builds for Linux x86_64`).toBe('');
}
/** Runs `calls` through one `deep-sandbox [--planted p]` process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[], planted?: SandboxPlanted): JsonObject[] {
  linuxSandbox();
  const args = planted ? ['--planted', planted] : [];
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), `/target/debug/${SANDBOX_BIN}`, ...args], text, 1_800_000);
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr };
  return replies(s, calls, `${SANDBOX_BIN} ${args.join(' ')} on linux/amd64`);
}

// The calls (README: deep-sandbox).
export type Role = 'provider' | 'validator';
export interface Budget { fuel: number; stack?: number; memory_mib?: number }
export interface Read { at: number; len: number }
export const about: JsonObject = { call: 'about' };
export const checkCall = (fx: Fixture, role: Role = 'provider'): JsonObject => ({ call: 'check', program: fx.b64, role });
export const rewriteCall = (fx: Fixture, role: Role = 'provider', budget?: Budget): JsonObject =>
  ({ call: 'rewrite', program: fx.b64, role, ...(budget ? { budget: { ...budget } } : {}) });
export const runCall = (fx: Fixture, budget: Budget, read: Read[], role: Role = 'provider'): JsonObject =>
  ({ call: 'run', program: fx.b64, role, seed: 0, budget: { ...budget }, read: read.map((r) => ({ ...r })) });
/** The web runner's request: the rewritten bytes the native rewrite gave, never the program as written. */
export const webRun = (rewritten: string, budget: Budget, read: Read[], role: Role = 'provider'): JsonObject =>
  ({ rewritten, role, seed: 0, budget: { ...budget }, read: read.map((r) => ({ ...r })) });
export const KIT: JsonObject = { call: 'kit' };
export const KIT_PLAN: JsonObject = { call: 'kit_plan' };
export const WEB_RUNNER: JsonObject = { call: 'web_runner' };

export interface Trap { kind: string; function: number; offset: number }
export interface Ran { trap: Trap | null; result: number | null; reads: Map<string, string>; hash: string | undefined; raw: JsonObject }
export const readKey = (r: Read): string => `${r.at}+${r.len}`;
export function trapOf(v: JsonValue | undefined, what: string): Trap | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, what);
  return { kind: str(o['kind'], `${what}.kind`), function: num(o['function'], `${what}.function`), offset: num(o['offset'], `${what}.offset`) };
}
/** A `run` reply (native or web): `{ok: true, trap, result, reads: [{at, len, hex}], hash?}`. */
export function ran(reply: JsonValue | undefined, what: string): Ran {
  const o = obj(reply, what);
  expect(o['ok'], `${what} ran (ok: true): ${show(o)}`).toBe(true);
  const reads = new Map<string, string>();
  for (const [i, r] of arr(o['reads'], `${what}.reads`).entries()) {
    const ro = obj(r, `${what}.reads[${i}]`);
    reads.set(readKey({ at: num(ro['at'], `${what}.reads[${i}].at`), len: num(ro['len'], `${what}.reads[${i}].len`) }), str(ro['hex'], `${what}.reads[${i}].hex`).toLowerCase());
  }
  const result = o['result'] === null || o['result'] === undefined ? null : num(o['result'], `${what}.result`);
  return { trap: trapOf(o['trap'], `${what}.trap`), result, reads, hash: typeof o['hash'] === 'string' ? o['hash'] : undefined, raw: o };
}
export const sameRun = (a: Ran, b: Ran): boolean =>
  JSON.stringify([a.trap, a.result, [...a.reads].sort()]) === JSON.stringify([b.trap, b.result, [...b.reads].sort()]);
export const runShown = (r: Ran): string => JSON.stringify({ trap: r.trap, result: r.result, reads: Object.fromEntries(r.reads) }).slice(0, 800);
/** A `rewrite` reply: `{ok: true, rewritten: base64, hash: sha256 of those bytes, ms}`. */
export function rewritten(reply: JsonObject, what: string): { b64: string; hash: string; ms: number } {
  expect(reply['ok'], `${what} rewrote the program (ok: true): ${show(reply)}`).toBe(true);
  const b64 = str(reply['rewritten'], `${what}.rewritten`);
  const hash = str(reply['hash'], `${what}.hash`);
  expect(hash, `${what}.hash is the sha256 of the rewritten bytes`).toBe(sha256(Buffer.from(b64, 'base64')));
  return { b64, hash, ms: num(reply['ms'], `${what}.ms`) };
}

export interface Refusal { [key: string]: JsonValue | undefined; import?: JsonObject; instruction?: string; function?: number; segment?: JsonObject; global?: number; limit?: JsonObject; proposal?: string }
/** A `check` reply's refusals: `[]` when admitted (`ok: true`), else `{ok: false, code: "subset_refused", refusals}`. */
export function refusals(reply: JsonObject, what: string): Refusal[] {
  if (reply['ok'] === true) return [];
  expect(reply['code'], `${what} is a subset refusal: ${show(reply)}`).toBe('subset_refused');
  const list = arr(reply['refusals'], `${what}.refusals`).map((r, i) => obj(r, `${what}.refusals[${i}]`) as Refusal);
  expect(list.length, `${what} names at least one refusal`).toBeGreaterThan(0);
  return list;
}
/** Whether a refusal holds every field of `want` (objects compared field by field, deep). */
export function holds(r: Refusal, want: JsonObject): boolean {
  return Object.entries(want).every(([k, v]) => JSON.stringify(isObject(v) && isObject(r[k]) ? pick(r[k] as JsonObject, Object.keys(v)) : r[k]) === JSON.stringify(v));
}
const pick = (o: JsonObject, keys: string[]): JsonObject => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));

// The kit (README: The kit): `deep-sandbox`'s `kit` and deep-show's `sandbox` part give one Case per fixture.
export const KIT_FIXTURES = {
  refusals: ['refuse.import', 'refuse.vector', 'refuse.atomic', 'refuse.memory_grows', 'refuse.table_set', 'refuse.data_drop', 'refuse.mutable_funcref_global', 'refuse.over_4mib', 'refuse.table_65537'],
  proposals: ['refuse.tail_call', 'refuse.exceptions', 'refuse.multi_memory', 'refuse.memory64', 'refuse.gc', 'refuse.extended_const'],
  runs: ['nan.f32', 'nan.f64', 'fuel.loop', 'fuel.fill', 'stack.recursion', 'stack.small.65536', 'stack.small.262144', 'stack.large.65536', 'stack.large.262144',
    'trap.unreachable', 'trap.divide', 'trap.overflow', 'trap.conversion', 'trap.bounds', 'trap.call', 'trap.grow', 'pass.subset', 'pass.table_call'],
} as const;
export interface Case { fixture: string; verdict: string; hash: string | null; expected_hash: string | null; refusals: JsonValue[]; trap: Trap | null; result: number | null; reads: JsonValue[]; failure: JsonObject | null; raw: JsonObject }
export interface Kit { verdict: string; cases: Case[]; failures: JsonObject[]; raw: JsonObject }
export function caseOf(v: JsonValue, what: string): Case {
  const o = obj(v, what);
  const fixtureName = str(o['fixture'] ?? o['case'], `${what}.fixture`);
  return {
    fixture: fixtureName, verdict: str(o['verdict'], `${what}.verdict`),
    hash: typeof o['hash'] === 'string' ? o['hash'] : null, expected_hash: typeof o['expected_hash'] === 'string' ? o['expected_hash'] : null,
    refusals: Array.isArray(o['refusals']) ? o['refusals'] : [], trap: trapOf(o['trap'], `${what}.trap`),
    result: typeof o['result'] === 'number' ? o['result'] : null, reads: Array.isArray(o['reads']) ? o['reads'] : [],
    failure: isObject(o['failure']) ? o['failure'] : null, raw: o,
  };
}
/** `deep-sandbox`'s `kit` reply: `{interface: "sandbox@1", verdict, cases, failures}`. */
export function kitOf(reply: JsonObject, what: string): Kit {
  expect(reply['interface'], `${what} is sandbox@1's kit`).toBe('sandbox@1');
  const cases = arr(reply['cases'], `${what}.cases`).map((c, i) => caseOf(c, `${what}.cases[${i}]`));
  const failures = [...arr(reply['failures'] ?? [], `${what}.failures`).map((f, i) => obj(f, `${what}.failures[${i}]`)), ...cases.flatMap((c) => (c.failure ? [c.failure] : []))];
  return { verdict: str(reply['verdict'], `${what}.verdict`), cases, failures, raw: reply };
}
export function theCase(kit: Kit, name: string, what: string): Case {
  const c = kit.cases.find((x) => x.fixture === name);
  expect(c, `${what} holds the fixture ${name}; it holds ${kit.cases.map((x) => x.fixture).join(', ') || 'none'}`).toBeDefined();
  return c!;
}
/** What two hosts must agree on for one case: its verdict, hash, refusals, trap, result and reads. */
export const caseKey = (c: Case): string => JSON.stringify([c.verdict, c.hash, c.refusals, c.trap, c.result, c.reads]);
/** The failures that name `fixture` (in `fixture`, or anywhere in the failure's JSON). */
export const failuresNaming = (kit: Kit, fixtureName: string): JsonObject[] =>
  kit.failures.filter((f) => f['fixture'] === fixtureName || mentions(f, `"${fixtureName}"`));

// ---------------------------------------------------------------------------------------------------
// Headless Chrome: a page this test serves imports the implementation's web runner (`web_runner`'s source) and
// runs each request through it in Chrome's own WebAssembly engine, posting the replies back.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = `<!doctype html><meta charset="utf-8"><title>#238 web runner</title><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
try {
  const runner = await import('/runner.mjs');
  const requests = await (await fetch('/requests.json')).json();
  const replies = [];
  for (const request of requests) {
    try { replies.push(await runner.run(request)); }
    catch (e) { replies.push({ ok: false, code: 'runner_threw', message: String((e && e.stack) || e) }); }
  }
  await post({ userAgent: navigator.userAgent, replies });
} catch (e) { await post({ userAgent: navigator.userAgent, error: String((e && e.stack) || e) }); }
</script>`;
export interface InChrome { userAgent: string; replies: JsonValue[] }
/** Runs `requests` through the web runner `source` in headless Chrome; BLOCKED without Chrome. */
export async function inChrome(source: string, requests: JsonObject[], timeoutMs = 600_000): Promise<InChrome> {
  if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the web player's engine runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-238-chrome-'));
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
  // policy and component fetches (a minute without them on this Mac).
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
    // Chrome and its helpers are this test's own process group (detached child): stopped by its PID.
    if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
    await new Promise<void>((res) => server.close(() => res()));
    rmSync(profile, { recursive: true, force: true });
  }
}
/** The web runner's source from this host's `deep-sandbox`, checked to drive the browser's own WebAssembly. */
export function webRunnerSource(): string {
  const [reply] = onMac([WEB_RUNNER]);
  const source = str(reply!['source'], 'web_runner: source');
  expect(/WebAssembly\.(instantiate|Module|Instance|compile)/.test(source), 'the web runner runs the rewritten bytes in the browser\'s own WebAssembly engine').toBe(true);
  return source;
}

// ---------------------------------------------------------------------------------------------------
// deep-show (as #185's and #200's suites drive it): builds per feature set, `run` scenarios, startup refusals.

export const SHOW_NAME = 'deep-show';
export const REFUSED_EXIT = 2;
/** This suite's test features of deep-show (README: Test builds). */
export type ShowFeature =
  | 'full' | 'test-leave-out-logic' | 'test-leave-out-sandbox' | 'test-mesh-item' | 'test-prog-registry' | 'test-sandbox-needs-logic' | 'test-sandbox-alt';
const deepShows = new Map<string, { bin: string; error: string }>();
/** deep-show of `features`, built once per process and kept under its own name; fails with cargo's error. */
export function deepShow(features: ShowFeature[]): string {
  const name = features.join('+');
  let made = deepShows.get(name);
  if (!made) {
    const b = join(bins(), `${SHOW_NAME}-${name}`);
    made = { bin: b, error: buildTo(REPO, SHOW_NAME, features, b) };
    deepShows.set(name, made);
  }
  expect(made.error, `deep-show builds with --features ${features.join(',')}`).toBe('');
  return made.bin;
}

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB238D', 1), b: ulid('01JB238D', 2), c: ulid('01JB238D', 3) } as const;
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: sandbox', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
export interface PackDir { id: string; version: string; dir: string }
export const packAt = (p: PackDir): string => `${p.id}@${p.version}`;
/** A scenario as #200's: your session, the process table, a panel, documents on it, and packs installed before the first call. */
export function scenario(evidence: string, calls: JsonObject[], packs: readonly PackDir[] = []): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' } },
    ...(packs.length ? { packs: packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    calls,
  };
}
/** `deep-show run [--planted p]`: one scenario, accepted, one reply per call. */
export function runShow(binPath: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(binPath, args, [sc]);
  const [out] = replies(s, [sc], `${SHOW_NAME} ${args.join(' ')}`);
  expect(out!['ok'], `${SHOW_NAME} run took the scenario: ${show(out)}`).toBe(true);
  const rs = arr(out!['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(rs.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return rs;
}
/** One startup and a `registry` call: exit 0 with the scenario answered, or exit 2 with the seal's one refusal line. */
export function startup(binPath: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(binPath, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}
/** The seal's refusal line (#305, #185): `{ok: false, code: "seal_refused", reason, modules, arrays, interface?, ...}`. */
export function refusalLine(s: Started, what: string): JsonObject {
  expect(s.status, `${what} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(-1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `${what}: the refusal is one line`).toBe(1);
  const line = obj(s.lines[0], `${what}: the refusal line`);
  expect([line['ok'], line['code']], `${what}: the seal's refusal`).toEqual([false, 'seal_refused']);
  return line;
}
export const started = (s: Started): boolean => s.status === 0 && isObject(s.lines[0]) && s.lines[0]['ok'] === true;
export const REGISTRY: JsonObject = { call: 'registry' };
export const SCHEDULE: JsonObject = { call: 'schedule' };
export const REGISTRIES: JsonObject = { call: 'registries' };
export const PACKS: JsonObject = { call: 'packs' };
export const SANDBOX_COUNTS: JsonObject = { call: 'sandbox' };
export const installPack = (p: PackDir): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
export const provided = (doc: string): JsonObject => ({ call: 'provided', doc });
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export const evalAt = (doc: string, t = 0): JsonObject => ({ call: 'eval', doc, t });
export const framesOf = (doc: string, count: number): JsonObject => ({ call: 'frames', doc, count });
/** A board as your shell sends it (#200's form). */
export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #238 acceptance suite.`, size: [640, 360],
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const rect = (id: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role: 'muted' } } } });
export interface Issue { code: string; severity: string; what: string; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), what: typeof o['what'] === 'string' ? o['what'] : '', raw: o };
  });
}
/** `name` as a whole word (module names hold dots). */
export const word = (name: string): RegExp => new RegExp(`(^|[^a-z0-9.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9.])`);
/** The pack rows of a `packs` reply for `p`. */
export function packRow(reply: JsonObject, p: PackDir): JsonObject {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && r['version'] === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}: ${show(reply)}`).toBe(1);
  return rows[0]!;
}
export const stateOf = (row: JsonObject): string => String(row['state'] ?? row['outcome']);

/** Writes a pack folder: `pack.json` with `assets` listed by sha256 and size, and the asset files. Returns its sha256s. */
export function writePack(root: string, owner: string, manifest: JsonObject, assets: Record<string, Buffer>): { pack: PackDir; sha: Record<string, string> } {
  const name = str(manifest['name'], 'pack name');
  const version = str(manifest['version'], 'pack version');
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  const sha: Record<string, string> = {};
  const listed: JsonObject[] = [];
  for (const [path, bytes] of Object.entries(assets)) {
    writeFileSync(join(dir, path), bytes);
    sha[path] = sha256(bytes);
    listed.push({ path, sha256: sha[path]!, size: bytes.length, license: 'MIT' });
  }
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ ...manifest, assets: listed }, null, 2)}\n`);
  return { pack: { id: `${owner}/${name}`, version, dir }, sha };
}

/** A fresh folder per test (evidence store, packs), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-238-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** Builds what a file needs before its tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, 3_600_000); }

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** The merge base's full deep-show, built in its own export and target folder (kept, so later runs build warm). */
export function baseDeepShow(): { sha: string; bin: string } {
  const sha = mergeBase();
  const dir = join(REPO, 'target', 'acceptance-238-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), sha);
  }
  const binPath = join(dir, `${SHOW_NAME}-full`);
  if (!existsSync(binPath)) expect(buildTo(dir, SHOW_NAME, ['full'], binPath, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s full deep-show builds`).toBe('');
  return { sha, bin: binPath };
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timings (as #185's and #200's suites; mains never gates).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (lpm && lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** Five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit.toFixed(3)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shown}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
