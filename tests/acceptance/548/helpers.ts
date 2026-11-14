// Test-side tools for the #548 acceptance tests (README: The surface under test), after #545's, #547's and #539's
// suites. They assemble this suite's WebAssembly programs with #544's assembler (read only), build this suite's Rust
// program (flock-rs/) for wasm32 against the bindings deep_kinds writes, build and drive the logic module's runner
// `deep-logic` (a batch of calls per process, or a long-lived process for a live view) and `deep-show run` / `deep-show
// screen`, and judge wall-clock readings with the perf lane's own rule (scripts/benchmark.mjs). Nothing here stands in
// for the logic module, deep_query, deep_kinds or the app: every hash, array, trap, region map, binding, frame and
// picture read here is the implementation's own; the expected values come from the issue's text, the design and this
// suite's own programs.

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeApng, encodeRgbaPng, type Image } from '../467/helpers.ts';

export { decodePng, encodeApng, encodeRgbaPng, type Image };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/548 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
export const MIB = 1024 * 1024;

/** Every test passes this timeout (90 minutes): a first build of deep-show, or of the merge base, takes many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#548.1e9cd89b', 2: '#548.9932c4df', 3: '#548.154ef157', 4: '#548.3c7384fe', 5: '#548.eec090d8', 6: '#548.d9cc61ff', 7: '#548.7c091366',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

export const FLICKS = 705_600_000;
/** One step at 60 Hz, in flicks. */
export const STEP = FLICKS / 60;
export const MS = FLICKS / 1000;
export const HASH64 = /^[0-9a-f]{16}$/;
/** A number as the issue writes it: 1,000. */
export const fmt = (n: number): string => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 800)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 800)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is an integer, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 800)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's judgement fails it, and some failure matches every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's judgement fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
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
/** `list` in a seeded order. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const r = seeded(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
export const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : Number.NaN; };

// ---------------------------------------------------------------------------------------------------
// Builds. cargo with rustup's PATH, CARGO_INCREMENTAL=0 and CARGO_PROFILE_DEV_DEBUG=0 unless set.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { error: string; stderr: string } {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return { error: `cargo could not run: ${run.error.message}`, stderr: '' };
  const stderr = run.stderr ?? '';
  if (run.status !== 0) return { error: `cargo ${args.join(' ')} failed:\n${stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used/.test(l)).join('\n').slice(-6000)}`, stderr };
  return { error: '', stderr };
}

let binsDir = '';
const dirOfBins = (): string => { if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-548-bins-')); return binsDir; };
const built = new Map<string, { bin: string; error: string }>();
/** `cargo build --locked --bin <name>` in the checkout (the dev build, as #545's and #547's suites), copied out, once per process. */
function binOf(name: 'deep-logic' | 'deep-show', release = false): string {
  const key = `${name}${release ? ' release' : ''}`;
  let b = built.get(key);
  if (!b) {
    const bin = join(dirOfBins(), exe(`${name}${release ? '-release' : ''}`));
    const { error } = cargo(['build', '--locked', ...(release ? ['--release'] : []), '--bin', name], REPO);
    if (error === '') copyFileSync(join(TARGET, release ? 'release' : 'debug', exe(name)), bin);
    b = { bin, error };
    built.set(key, b);
  }
  if (/cargo could not run/.test(b.error)) blocked(`${b.error}: this machine lacks the Rust toolchain`);
  expect(b.error, `${name} builds on this host (cargo build --locked${release ? ' --release' : ''} --bin ${name})`).toBe('');
  return b.bin;
}
export const logicBin = (release = false): string => binOf('deep-logic', release);
export const showBin = (): string => binOf('deep-show');
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-548-')); made.push(d); return d; };
}

// The merge base's `deep-logic` (criterion 3's "compared with the merge base"): `git archive` of the merge base with
// origin/main into target/acceptance-548-base/<sha>/, built there in its own target folder (kept, so later runs build warm).
export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
let baseLogic: { sha: string; bin: string; error: string } | undefined;
export function baseLogicBin(): { sha: string; bin: string } {
  if (!baseLogic) {
    const sha = mergeBase();
    const dir = join(TARGET, 'acceptance-548-base', sha.slice(0, 12));
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
    const { error } = cargo(['build', '--locked', '--bin', 'deep-logic'], dir, { CARGO_TARGET_DIR: join(dir, 'target') });
    baseLogic = { sha, bin: join(dir, 'target', 'debug', exe('deep-logic')), error };
  }
  expect(baseLogic.error, `the merge base ${baseLogic.sha.slice(0, 12)}'s deep-logic builds`).toBe('');
  return { sha: baseLogic.sha, bin: baseLogic.bin };
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (tests/acceptance/544/wat, read only), in its own target.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-548-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const { error } = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`#544's assembler (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-544-wat'));
  return watBin;
}
export const programOf = (name: string, bytes: Buffer): Program => ({ name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) });
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-548-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const p = programOf(name, readFileSync(join(dir, `${name}.wasm`)));
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The Rust program (flock-rs/, criterion 6): a copy of the crate under target/acceptance-548-flock/<tag>/ with the
// bindings deep_kinds wrote as src/regions.rs, built for wasm32-unknown-unknown with the toolchain rust-toolchain.toml
// pins (the copy sits inside the checkout, so its rust-toolchain.toml and .cargo/config.toml apply, as for #531's rules/).

const FLOCK_RS = join(HERE, 'flock-rs');
export interface RustBuild { ok: boolean; bytes: Buffer | null; stderr: string; lib: string }
export function buildRust(tag: string, regions: string, features: string[] = []): RustBuild {
  const dir = join(TARGET, 'acceptance-548-flock', tag);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(FLOCK_RS, dir, { recursive: true });
  writeFileSync(join(dir, 'src', 'regions.rs'), regions);
  const { error, stderr } = cargo(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', ...(features.length ? ['--features', features.join(',')] : [])], dir, { CARGO_TARGET_DIR: join(dir, 'target') });
  if (/cargo could not run/.test(error)) blocked(`${error}: this machine lacks the Rust toolchain`);
  const wasm = join(dir, 'target', 'wasm32-unknown-unknown', 'release', 'acceptance_548_flock.wasm');
  return { ok: error === '', bytes: error === '' && existsSync(wasm) ? readFileSync(wasm) : null, stderr: error || stderr, lib: readFileSync(join(FLOCK_RS, 'src', 'lib.rs'), 'utf8') };
}
/**
 * A module's exported `regions_digest` as 16 hex digits (README: regions_digest): an immutable i64 global holding the
 * digest, or, as a Rust `#[no_mangle] static` exports it, an immutable i32 global holding the address of its 8 bytes,
 * little-endian, in the module's own memory once instantiated. Null when it exports none.
 */
export async function exportedDigest(bytes: Buffer): Promise<string | null> {
  const module = await WebAssembly.compile(new Uint8Array(bytes));
  if (!WebAssembly.Module.exports(module).some((e) => e.name === 'regions_digest' && e.kind === 'global')) return null;
  const instance = await WebAssembly.instantiate(module, {});
  const g = instance.exports['regions_digest'] as WebAssembly.Global;
  const v: unknown = g.value;
  if (typeof v === 'bigint') return BigInt.asUintN(64, v).toString(16).padStart(16, '0');
  const memory = instance.exports['memory'] as WebAssembly.Memory;
  const at = Number(v);
  return new DataView(memory.buffer).getBigUint64(at, true).toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------------------------------------------
// `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

/** `deep-logic --planted <name>` (README: Planted twins). */
export type LogicPlanted = 'preview_writes_item_memory' | 'preview_runs_on_hover_only';
const plantedArgs = (planted: readonly string[]): string[] => planted.flatMap((p) => ['--planted', p]);

interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
const parseLines = (stdout: string): JsonValue[] => stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
function replies(s: Started, count: number, what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(count);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i}`));
}
/** Runs `calls` through one `deep-logic [--planted p]...` process (the merge base's when `bin` is given). */
export function logic(calls: JsonObject[], planted: LogicPlanted[] = [], bin?: string): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(bin ?? logicBin(), args, calls), calls.length, `deep-logic ${args.join(' ')}`.trim());
}

/** A long-lived `deep-logic` process: one call, one awaited reply, timed on this test's clock. Stopped by its PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; timed: (c: JsonObject) => Promise<{ reply: JsonObject; ms: number }>; stop: () => void }
export function live(planted: LogicPlanted[] = [], bin?: string): Live {
  const child: ChildProcessWithoutNullStreams = spawn(bin ?? logicBin(), plantedArgs(planted), { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let stderr = '';
  const waiting: ((line: string) => void)[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); waiting.shift()?.(line); }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => { stderr += d; if (stderr.length > 100_000) stderr = stderr.slice(-50_000); });
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error('deep-logic didn\'t start');
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', (code) => res(`{"ok":false,"code":"exited","status":${JSON.stringify(code)},"stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  const timed = async (c: JsonObject): Promise<{ reply: JsonObject; ms: number }> => {
    const got = new Promise<string>((res) => waiting.push(res));
    const started = performance.now();
    child.stdin.write(`${JSON.stringify(c)}\n`);
    const text = await Promise.race([got, exited]);
    const ms = performance.now() - started;
    let parsed: JsonValue;
    try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
    return { reply: obj(parsed, `deep-logic's reply to ${show(c, 160)}`), ms };
  };
  return {
    timed,
    call: async (c) => (await timed(c)).reply,
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// Pieces (#531's README: Piece), with this issue's fields passed as the item's params.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface WriteSpec { type: WriteType; count?: number; interpolate?: 'linear' | 'hold' }
export interface PreviewSpec { reads: string[]; writes: Record<string, { type: WriteType; count?: number }> }
export type WritesSpec = Record<string, WriteSpec>;
export type EmitsSpec = Record<string, { fields: Record<string, WriteType>; max_per_step?: number }>;
export interface ItemSpec {
  program: Program;
  step_rate?: number;
  reads?: string[];
  writes: WritesSpec;
  emits?: EmitsSpec;
  preview?: PreviewSpec;
  clock?: 'fixed' | 'on_input';
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
}
/** A logic item's params as the document and the piece both write them. */
export function params(spec: ItemSpec): JsonObject {
  const p: JsonObject = { program: spec.program.sha };
  if (spec.step_rate !== undefined) p['step_rate'] = spec.step_rate;
  if (spec.reads) p['reads'] = spec.reads;
  p['writes'] = spec.writes as unknown as JsonObject;
  if (spec.emits) p['emits'] = spec.emits as unknown as JsonObject;
  if (spec.preview) p['preview'] = spec.preview as unknown as JsonObject;
  if (spec.clock) p['clock'] = spec.clock;
  if (spec.budget) p['budget'] = spec.budget as JsonObject;
  if (spec.checkpoint) p['checkpoint'] = spec.checkpoint as JsonObject;
  return p;
}
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: Record<string, string>; class?: string }
/** A piece as `deep-logic` takes it: the document's seed, its controls by kind, its logic items and their programs. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    items[id] = { kind: 'logic@1', params: params(spec) };
  }
  return {
    seed: p.seed,
    ...(p.class ? { class: p.class } : {}),
    ...(p.controls ? { controls: Object.fromEntries(Object.entries(p.controls).map(([c, kind]) => [c, { kind }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you'; player: number }
/** An entry of yours at step `k` of a 60 Hz item (its flick exactly on the step). */
export const entryAt = (control: string, k: number, value: number, seq = 0): Entry => ({ t: k * STEP, seq, control, value, writer: 'you', player: 1 });
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export const bakeCall = (p: JsonObject, steps: number, track: Entry[] = []): JsonObject => ({ call: 'bake', piece: p, track: track as unknown as JsonValue, steps });

/** A layout (region map) as `check` reports it (#531's README: Layout). */
export interface RegionEntry { region: string; name: string; offset: number; size: number; type: string }
export interface Layout { digest: string; entries: RegionEntry[] }
export function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const digest = str(o['digest'], `${what}.digest`);
  expect(digest, `${what}.digest is 16 hex digits`).toMatch(HASH64);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    const w = `${what}.entries[${i}]`;
    return { region: str(x['region'], `${w}.region`), name: str(x['name'], `${w}.name`), offset: int(x['offset'], `${w}.offset`), size: int(x['size'], `${w}.size`), type: str(x['type'], `${w}.type`) };
  });
  return { digest, entries };
}
/** The layouts a `check` reply admitted, by item. */
export function admitted(reply: JsonObject, what: string): Record<string, Layout> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, layoutOf(obj(v, `${what}.items.${id}`)['layout'], `${what}.items.${id}.layout`)]));
}
export function offsetIn(l: Layout, region: string, name: string): number {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return e.offset;
}
export const entryText = (e: RegionEntry): string => `${e.region} ${e.name} (offset ${e.offset}, size ${e.size}, type ${e.type})`;

/** A `bake` reply's step records, checkpoints, traps and occurrence lists. */
export interface StepRecord { step: number; items: Record<string, { hash: string | null; fuel: number | null }>; arrays: Record<string, JsonValue[]> }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, { step: number; deep_hash: string }[]>; traps: JsonObject[]; occurrences: Record<string, JsonObject[]>; raw: JsonObject }
export function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'] ?? {}, `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      return [id, { hash: typeof it['hash'] === 'string' ? it['hash'] : null, fuel: typeof it['fuel'] === 'number' ? it['fuel'] : null }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
export function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, { step: number; deep_hash: string }[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`) };
  })]));
}
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  const occ = isObject(reply['occurrences']) ? reply['occurrences'] : {};
  return {
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => obj(t, `${what}.traps[${i}]`)),
    occurrences: Object.fromEntries(Object.entries(occ).map(([id, l]) => [id, Array.isArray(l) ? l.filter(isObject) : []])),
    raw: reply,
  };
}
/** Two JSON values equal within 1e-9 a number (arrays of numbers, vectors, bools, integers). */
export function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return JSON.stringify(a) === JSON.stringify(b);
}
/** The first index two lists differ at, with both values, or null. */
export function firstDiff(a: readonly JsonValue[], b: readonly JsonValue[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (!same(a[i], b[i])) return `element ${i}: ${show(a[i] ?? '(none)', 200)} against ${show(b[i] ?? '(none)', 200)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Live views (#532's and #545's `view` and `frame`, with this suite's `hover`, `previews`, `blends` and `traps`) and the
// session's bake (`baked`): README, deep-logic.

export interface Act { play?: number | true; seek?: number; hover?: Record<string, [number, number] | null> }
export const frameCall = (session: string, act: Act = {}): JsonObject => ({
  call: 'frame', session,
  ...(act.play !== undefined ? { play: act.play } : {}),
  ...(act.seek !== undefined ? { seek: act.seek } : {}),
  ...(act.hover !== undefined ? { hover: act.hover as unknown as JsonObject } : {}),
});
export interface Frame {
  frame: number; t: number; at: number; steps: number; stale: boolean; deep_hash: Record<string, string>;
  draws: Record<string, JsonValue[]>; previews: number | null; blends: number | null; traps: JsonObject[] | null; raw: JsonObject;
}
export function frameOf(reply: JsonObject, what: string): Frame {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply, 800)}`).toBe(true);
  const deep = obj(reply['deep_hash'], `${what}.deep_hash`);
  const draws = isObject(reply['draws']) ? reply['draws'] : {};
  return {
    frame: int(reply['frame'], `${what}.frame`), t: int(reply['t'], `${what}.t`), at: int(reply['at'], `${what}.at`), steps: int(reply['steps'], `${what}.steps`),
    stale: reply['stale'] === true,
    deep_hash: Object.fromEntries(Object.entries(deep).map(([id, h]) => [id, str(h, `${what}.deep_hash.${id}`)])),
    draws: Object.fromEntries(Object.entries(draws).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v as JsonValue[]])),
    previews: typeof reply['previews'] === 'number' ? reply['previews'] : null,
    blends: typeof reply['blends'] === 'number' ? reply['blends'] : null,
    traps: Array.isArray(reply['traps']) ? reply['traps'].filter(isObject) : null,
    raw: reply,
  };
}
const LAND_CAP = 10_000;
/** A frame and the frames with no input after it until one lands (#545's README). */
export interface View { session: string; frame: (act?: Act) => Promise<{ landed: Frame; frames: Frame[] }> }
export async function openView(l: Live, p: JsonObject, span: number, track: Entry[] = []): Promise<View> {
  const v = await l.call({ call: 'view', piece: p, track: track as unknown as JsonValue, span });
  expect(v['ok'], `view opened the piece: ${show(v, 1500)}`).toBe(true);
  const session = str(v['session'], 'view.session');
  let n = 0;
  return {
    session,
    frame: async (act = {}) => {
      const frames = [frameOf(await l.call(frameCall(session, act)), `frame ${++n} (${show(act, 120)})`)];
      while (frames[frames.length - 1]!.stale && frames.length < LAND_CAP) frames.push(frameOf(await l.call(frameCall(session)), `frame ${++n}`));
      const landed = frames[frames.length - 1]!;
      expect(landed.stale, `the frame after ${show(act, 120)} lands within ${LAND_CAP} frames`).toBe(false);
      return { landed, frames };
    },
  };
}
/** The session's bake (README: `baked`): its input track, step hashes, checkpoints and bake bytes. */
export interface Baked { track: JsonObject[]; steps: StepRecord[]; checkpoints: Record<string, { step: number; deep_hash: string }[]>; bytes: Buffer }
export function bakedOf(reply: JsonObject, what: string): Baked {
  expect(reply['ok'], `${what} answered (ok: true): ${show(reply, 1500)}`).toBe(true);
  return {
    track: arr(reply['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)),
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    bytes: Buffer.from(str(reply['bake'], `${what}.bake (base64)`), 'base64'),
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (one JSON scenario on stdin, one answer `{ok, replies}`) and `deep-show screen` (#1162's window), as
// #539's suite drives them, on the scope's virtual clock.

/** The scenario's `planted` this suite adds (deep_query's twin) and `deep-show run --planted` (deep_kinds' twin). */
export type ShowPlanted = 'region_map_reads_by_name';
export type KindsPlanted = 'bindings_fields_by_name';
export const SESSION = 'sess-548';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-548', name: 'Claude Code: logic for games', process: { pid: 4800, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4800, ppid: 1, start: 1_000 }];
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB548D${String(n).padStart(18, '0')}`;
export type Rect = [number, number, number, number];
/** The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256). */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export interface ScenarioOptions { planted?: ShowPlanted; rect?: Rect; window?: [number, number] }
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: ScenarioOptions = {}): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: o.rect ?? [0, 0, 1600, 1040] }; docMap[d] = { panel: `p${i + 1}` }; });
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, clock: CLOCK, display: o.window ? [1728, 1117] : [2560, 1600],
    ...(o.window ? { window: o.window } : {}), ...(o.planted ? { planted: o.planted } : {}), calls,
  };
}
/** `deep-show run [--planted p]` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(sc: JsonObject, what: string, kindsPlanted?: KindsPlanted): JsonObject[] {
  const args = ['run', ...(kindsPlanted ? ['--planted', kindsPlanted] : [])];
  const tag = [what, typeof sc['planted'] === 'string' ? `(planted ${sc['planted']})` : '', kindsPlanted ? `(--planted ${kindsPlanted})` : ''].filter(Boolean).join(' ');
  const r = spawnSync(showBin(), args, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show ${args.join(' ')} exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
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
/** `deep-show screen` (#1162): the scenario's calls run, then the app's window drawn at `t` flicks at `scale`, written to `out`. */
export function runScreen(sc: JsonObject, out: string, t: number, scale: number, what: string): Image {
  const r = spawnSync(showBin(), ['screen'], { cwd: REPO, input: `${JSON.stringify({ ...sc, out, t, scale })}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = (r.stdout ?? '').trim();
  let reply: JsonValue;
  try { reply = JSON.parse(stdout.split('\n').pop() ?? '') as JsonValue; } catch { reply = stdout; }
  if (isObject(reply) && reply['code'] === 'unsupported_platform') inconclusive(`${what}: the app's window draws on macOS; this is ${process.platform}`);
  const o = obj(reply, `${what}: deep-show screen's answer (stderr ${(r.stderr ?? '').slice(-800)})`);
  expect(o['ok'], `${what}: deep-show screen draws the window: ${show(o)}`).toBe(true);
  expect(existsSync(out), `${what}: the window's PNG is written`).toBe(true);
  return decodePng(readFileSync(out));
}
/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject, at: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'], at });
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** A `deep_show` reply that presented its document with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  expect(issuesOf(reply).filter((i) => i['severity'] === 'error'), `${what} is presented with no error`).toEqual([]);
}

/** README: deep_query's logic read. */
export const queryLogic = (doc: string, items: string[], steps: number[], track: Entry[] = [], at = 0): JsonObject =>
  ({ call: 'deep_query', session: SESSION, doc, what: 'logic', items, steps, ...(track.length ? { track: track as unknown as JsonValue } : {}), at });
export interface LogicRead { region_map: Layout; steps: { step: number; arrays: Record<string, JsonValue[]>; fuel: number }[]; trap: JsonObject | null }
export function logicReadOf(reply: JsonObject, item: string, what: string): LogicRead {
  expect(reply['error'] ?? reply['code'], `${what}: deep_query answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const it = obj(obj(reply['logic'], `${what}: logic (${show(reply, 600)})`)[item], `${what}: logic.${item}`);
  const steps = arr(it['steps'], `${what}: logic.${item}.steps`).map((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    return {
      step: int(o['step'], `${what}: steps[${i}].step`),
      arrays: Object.fromEntries(Object.entries(obj(o['arrays'], `${what}: steps[${i}].arrays`)).map(([k, v]) => [k, arr(v, `${what}: steps[${i}].arrays.${k}`)])),
      fuel: int(o['fuel'], `${what}: steps[${i}].fuel`),
    };
  });
  return { region_map: layoutOf(it['region_map'], `${what}: logic.${item}.region_map`), steps, trap: isObject(it['trap']) ? it['trap'] : null };
}
/** README: deep_kinds' bindings. */
export const bindingsCall = (doc: string, item: string, at = 0): JsonObject => ({ call: 'deep_kinds', op: 'bindings', doc, item, language: 'rust', at });
export interface Bindings { language: string; item: string; digest: string; file: string; source: string; fields: RegionEntry[] }
export function bindingsOf(reply: JsonObject, what: string): Bindings {
  expect(reply['error'], `${what}: deep_kinds answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const b = obj(reply['bindings'], `${what}: bindings (${show(reply, 600)})`);
  const l = layoutOf({ digest: b['digest'] ?? null, entries: b['fields'] ?? null }, `${what}: bindings`);
  return { language: str(b['language'], `${what}: bindings.language`), item: str(b['item'], `${what}: bindings.item`), digest: l.digest, file: str(b['file'], `${what}: bindings.file`), source: str(b['source'], `${what}: bindings.source`), fields: l.entries };
}

// ---------------------------------------------------------------------------------------------------
// The scope (#383) and panel points: a page point (u) to panel px through the camera the scope shows.

export interface Cam { target: number[]; width: number; rect: number[] }
export function camOf(reply: JsonObject, what: string): Cam {
  const state = obj(reply['state'], `${what}: state`);
  const cam = obj(state['camera'], `${what}: state.camera`);
  return {
    target: arr(cam['target'], `${what}: camera.target`).map((v, i) => num(v, `${what}: camera.target[${i}]`)),
    width: num(cam['view_width'], `${what}: camera.view_width`),
    rect: arr(state['rect'], `${what}: state.rect`).map((v, i) => num(v, `${what}: state.rect[${i}]`)),
  };
}
export function toPanel(v: Cam, [x, y]: [number, number]): [number, number] {
  const k = v.width / v.rect[2]!;
  return [v.rect[0]! + v.rect[2]! / 2 + (x - v.target[0]!) / k, v.rect[1]! + v.rect[3]! / 2 + (y - v.target[1]!) / k];
}
/** Re-encodes a decoded picture so the same pixels always give the same bytes (criterion 7's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});

// ---------------------------------------------------------------------------------------------------
// Wall-clock readings, judged by the perf lane's own rule: `judgeLimit` on `fingerprint()` in scripts/benchmark.mjs,
// imported, not copied: PASS when all five readings are within the limit, FAIL when all five are over it by more than
// the margin, and INCONCLUSIVE off a reference Mac at rest (README: Criterion 3's timings).

export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[]; limit: number; margin?: number }
export interface Bench {
  fingerprint: () => JsonObject;
  judgeLimit: (o: unknown) => Judged;
  validateBudgets: (current: unknown, base: unknown) => void;
}
export async function bench(): Promise<Bench> {
  return (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
}
export const load = (): number => loadavg()[0] ?? Number.NaN;
export const cores = (): number => availableParallelism();
