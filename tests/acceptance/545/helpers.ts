// Test-side tools for the #545 acceptance tests (README: The surface under test), after #532's suite. They assemble
// this suite's WebAssembly programs with its own assembler (wat/), build and drive the logic module's runner
// `deep-logic` (one process per batch of calls, or a long-lived one for a live view), and, for criterion 4's export
// half, `deep-show run` with the `full` feature set, built only when a test reaches it. Nothing here stands in for the
// logic module, deep-show or a check: every step, array, draw, hash, issue, refusal and receipt read here is the
// implementation's own; the expected values come from the issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/545 is three levels down). */
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

/** Every test passes this timeout: a first build of deep-logic, or of deep-show, takes many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#545.f3d39699', 2: '#545.f3b004c6', 3: '#545.10859a3c', 4: '#545.ef12c43a', 5: '#545.fd1e802b', 6: '#545.c54e53c9', 7: '#545.f348ec28',
} as const;

export const FLICKS = 705_600_000;
/** One step at 60 Hz and at 10 Hz, in flicks. */
export const STEP_60 = FLICKS / 60;
export const STEP_10 = FLICKS / 10;
/** checkpoint.every's default (Logic `logic@1`). */
export const EVERY = 60;
export const MIB = 1024 * 1024;
export const HASH64 = /^[0-9a-f]{16}$/;
/** A number as the issue writes it: 1,801. */
export const fmt = (n: number): string => n.toLocaleString('en-US');
/** Flicks as seconds, for messages. */
export const secs = (flicks: number): string => `${fmt(flicks / FLICKS)} s`;

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
const hexMap = (v: JsonValue | undefined, what: string): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(HASH64); return [id, s]; }));
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: the criterion's judgement fails it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the criterion fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
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
/** Two vectors (or numbers) equal within 1e-9 a component. */
export function near(a: JsonValue | undefined, b: readonly number[]): boolean {
  const xs = typeof a === 'number' ? [a] : Array.isArray(a) ? a : null;
  return xs !== null && xs.length === b.length && xs.every((x, i) => typeof x === 'number' && Math.abs(x - b[i]!) <= 1e-9);
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/: the `wat` crate, outside the workspace).

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-545-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) expect.fail(`BLOCKED: this suite's assembler (tests/acceptance/545/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-545-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-545-wat-'));
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
// The runner `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted =
  | 'turn_runs_at_frame_boundary' | 'turn_ignores_due' | 'linear_blends_forward'
  | 'open_span_reads_zero' | 'seek_restores_arrays_only' | 'judder_checks_shots_only';
const plantedArgs = (planted: Planted[]): string[] => planted.flatMap((p) => ['--planted', p]);

interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0. */
function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

let binsDir = '';
const dirOfBins = (): string => { if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-545-bins-')); return binsDir; };
let builtLogic: { bin: string; error: string } | undefined;
/** `cargo build --locked --bin deep-logic` in the checkout, copied out, once per process. */
export function logicBin(): string {
  if (!builtLogic) {
    const bin = join(dirOfBins(), exe(LOGIC_BIN));
    const error = cargo(['build', '--locked', '--bin', LOGIC_BIN], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(LOGIC_BIN)), bin);
    builtLogic = { bin, error };
  }
  expect(builtLogic.error, `${LOGIC_BIN} builds on this host (cargo build --locked --bin ${LOGIC_BIN})`).toBe('');
  return builtLogic.bin;
}
let builtShow: { bin: string; error: string } | undefined;
/** `cargo build --locked --bin deep-show --no-default-features --features full`, copied out, once per process: built
 * only when a test reaches deep-show (criterion 4's export half). */
export function showBin(): string {
  if (!builtShow) {
    const bin = join(dirOfBins(), exe('deep-show'));
    const error = cargo(['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe('deep-show')), bin);
    builtShow = { bin, error };
  }
  expect(builtShow.error, 'deep-show builds on this host (cargo build --locked --bin deep-show --no-default-features --features full)').toBe('');
  return builtShow.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; builtLogic = undefined; builtShow = undefined; });

/** Runs `calls` through one `deep-logic [--planted p]...` process. */
export function logic(calls: JsonObject[], planted: Planted[] = []): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')}`.trim());
}

/** A long-lived `deep-logic` process: one call, one awaited reply, so a test drives a view frame by frame. Stopped by its PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; stop: () => void }
export function live(planted: Planted[] = []): Live {
  const child: ChildProcessWithoutNullStreams = spawn(logicBin(), plantedArgs(planted), { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
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
  // A process that has exited (an unknown --planted name) answers as `exited` below, not as a write error.
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error(`${LOGIC_BIN} didn't start`);
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', () => res(`{"ok":false,"code":"exited","stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  return {
    call: async (c) => {
      const got = new Promise<string>((res) => waiting.push(res));
      child.stdin.write(`${JSON.stringify(c)}\n`);
      const text = await Promise.race([got, exited]);
      let parsed: JsonValue;
      try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
      return obj(parsed, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`);
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Piece) and the calls.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface WriteSpec { type: WriteType; count?: number; interpolate?: 'linear' | 'hold' }
export interface ItemSpec {
  program: Program;
  step_rate?: number;
  reads?: string[];
  writes: Record<string, WriteSpec>;
  clock?: 'fixed' | 'on_input';
  due?: string;
  checkpoint?: { every?: number };
}
export interface PieceSpec {
  seed: number;
  items: Record<string, ItemSpec>;
  /** Control ID → its kind. */
  controls?: Record<string, string>;
  /** Criterion 6: a piece played live, the document's items that read logic arrays, and the brief's hold list. */
  live?: boolean;
  readers?: Record<string, JsonObject>;
  brief?: { hold?: string[] };
}
/** A piece as `deep-logic` takes it: the document's seed, its controls, its logic items and the programs they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.step_rate !== undefined) params['step_rate'] = spec.step_rate;
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.clock) params['clock'] = spec.clock;
    if (spec.due) params['due'] = spec.due;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(Object.entries(p.controls).map(([c, kind]) => [c, { kind }])) } : {}),
    ...(p.live !== undefined ? { live: p.live } : {}),
    ...(p.readers ? { readers: p.readers } : {}),
    ...(p.brief ? { brief: p.brief as JsonObject } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry of yours on the input track at flick `t`. */
export const entry = (control: string, t: number, value: number, seq = 0): Entry => ({ t, seq, control, value, writer: 'you', player: 1 });

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface Restore { from: number; steps: number }
export interface SeekSpec { to: number }
export interface BakeSpec { track?: Entry[]; steps: number; restores?: Restore[]; seeks?: SeekSpec[] }
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({
  call: 'bake', piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.restores ? { restores: b.restores as unknown as JsonValue } : {}),
  ...(b.seeks ? { seeks: b.seeks as unknown as JsonValue } : {}),
});

// Replies.

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number }[] }
function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    return { region: str(x['region'], `${what}.entries[${i}].region`), name: str(x['name'], `${what}.entries[${i}].name`), offset: int(x['offset'], `${what}.entries[${i}].offset`), size: int(x['size'], `${what}.entries[${i}].size`) };
  });
  return { digest: str(o['digest'], `${what}.digest`), entries };
}
/** A `check` reply's admitted items' layouts: `{ok: true, items: {id: {program, hash, layout}}}`. */
export function admitted(reply: JsonObject, what: string): Record<string, Layout> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, layoutOf(obj(v, `${what}.items.${id}`)['layout'], `${what}.items.${id}.layout`)]));
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): number {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return e.offset;
}
/** The layout `check` gives an item of these reads and writes (its program is the layout probe; no clock fields, which the
 * layout doesn't depend on). */
export function layoutFor(probe: Program, reads: string[], writes: Record<string, WriteSpec>, controls: Record<string, string> = {}, others: Record<string, ItemSpec> = {}): Layout {
  const [reply] = logic([checkCall(piece({ seed: 545, controls, items: { ...others, probe: { program: probe, reads, writes } } }))]);
  return admitted(reply!, 'check of the layout probe')['probe']!;
}

/** The logic.judder issues of a check that admitted the piece (README: check issues). */
export interface Judder { item: string; array: string; reader: string; step_rate: number; frame_rate: number }
export function judderOf(reply: JsonObject, what: string): Judder[] {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return arr(reply['issues'], `${what}.issues`).map((v, i) => obj(v, `${what}.issues[${i}]`)).filter((o) => o['kind'] === 'logic.judder').map((o, i) => ({
    item: str(o['item'], `${what} judder[${i}].item`), array: str(o['array'], `${what} judder[${i}].array`), reader: str(o['reader'], `${what} judder[${i}].reader`),
    step_rate: num(o['step_rate'], `${what} judder[${i}].step_rate`), frame_rate: num(o['frame_rate'], `${what} judder[${i}].frame_rate`),
  }));
}
/** The writes a `logic_refused` reply names. */
export function refusedWrites(reply: JsonObject, what: string): { item: string; writes: string[] } {
  expect([reply['ok'], reply['code']], `${what} is refused by the logic module's check: ${show(reply)}`).toEqual([false, 'logic_refused']);
  const writes = arr(reply['refusals'], `${what}.refusals`).map((r, i) => obj(r, `${what}.refusals[${i}]`)['write']).filter((w): w is string => typeof w === 'string');
  return { item: str(reply['item'], `${what}.item`), writes };
}

export interface StepRecord { step: number; items: Record<string, { hash: string | null }>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface Range { step: number; array: string; start: number; end: number; values: JsonValue[] }
export interface RestoreResult { from: number; checkpoints: Record<string, Checkpoint[]>; steps: StepRecord[] }
export interface SeekResult { to: number; from: number; hashes: Record<string, string[]>; checkpoint: { step: number; deep_hash: Record<string, string> } }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; ranges: Record<string, Range[]> | null; restores: RestoreResult[]; seeks: SeekResult[]; raw: JsonObject }
function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const h = obj(x, `${what}[${i}].items.${id}`)['hash'];
      return [id, { hash: typeof h === 'string' ? h : null }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`) };
  })]));
}
/** A `bake` reply: the fields this suite reads, typed (`ranges` is null when the reply has none). */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  const ranges = reply['ranges'] === undefined ? null : Object.fromEntries(Object.entries(obj(reply['ranges'], `${what}.ranges`)).map(([id, list]) => [id, arr(list, `${what}.ranges.${id}`).map((r, i) => {
    const o = obj(r, `${what}.ranges.${id}[${i}]`);
    const w = `${what}.ranges.${id}[${i}]`;
    return { step: int(o['step'], `${w}.step`), array: str(o['array'], `${w}.array`), start: int(o['start'], `${w}.start`), end: int(o['end'], `${w}.end`), values: arr(o['values'], `${w}.values`) };
  })]));
  return {
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    ranges,
    restores: arr(reply['restores'] ?? [], `${what}.restores`).map((r, i) => {
      const o = obj(r, `${what}.restores[${i}]`);
      return { from: int(o['from'], `${what}.restores[${i}].from`), checkpoints: checkpointsOf(o['checkpoints'], `${what}.restores[${i}].checkpoints`), steps: stepsOf(o['steps'], `${what}.restores[${i}].steps`) };
    }),
    seeks: arr(reply['seeks'] ?? [], `${what}.seeks`).map((s, i) => {
      const o = obj(s, `${what}.seeks[${i}]`);
      const c = obj(o['checkpoint'], `${what}.seeks[${i}].checkpoint`);
      const hashes = Object.fromEntries(Object.entries(obj(o['hashes'], `${what}.seeks[${i}].hashes`)).map(([id, l]) => [id, arr(l, `${what}.seeks[${i}].hashes.${id}`).map((h) => String(h))]));
      return { to: int(o['to'], `${what}.seeks[${i}].to`), from: int(o['from'], `${what}.seeks[${i}].from`), hashes, checkpoint: { step: int(c['step'], `${what}.seeks[${i}].checkpoint.step`), deep_hash: hexMap(c['deep_hash'], `${what}.seeks[${i}].checkpoint.deep_hash`) } };
    }),
    raw: reply,
  };
}
/** The steps an item ran, in order: the records that hold it. */
export const ranSteps = (steps: StepRecord[], id: string): StepRecord[] => steps.filter((s) => s.items[id] !== undefined);
/** One line per step an item ran: its number, its hash and its arrays, for comparing runs. */
export const rows = (steps: StepRecord[], id: string): string[] =>
  ranSteps(steps, id).map((s) => JSON.stringify([s.step, s.items[id]!.hash, Object.entries(s.arrays).filter(([k]) => k.startsWith(`${id}.`)).sort()]));
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${(a[i] ?? '(none)').slice(0, 300)} against ${(b[i] ?? '(none)').slice(0, 300)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Live views (README: view and frame): `view` opens one, `frame` runs one live frame; a frame that doesn't land is
// followed by frames with no input until it does.

export const viewCall = (p: JsonObject, track: Entry[], span: number | 'open'): JsonObject => ({ call: 'view', piece: p, track: track as unknown as JsonValue, span });
export interface Act { seek?: number; play?: number }
export const frameCall = (session: string, act: Act = {}): JsonObject =>
  ({ call: 'frame', session, ...(act.seek !== undefined ? { seek: act.seek } : {}), ...(act.play !== undefined ? { play: act.play } : {}) });

export interface Frame { frame: number; t: number; steps: number; stale: boolean; deep_hash: Record<string, string>; draws: Record<string, JsonValue[]> | null; valid_until: number | null | undefined; raw: JsonObject }
export function frameOf(reply: JsonObject, what: string): Frame {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  const v = reply['valid_until'];
  return {
    frame: int(reply['frame'], `${what}.frame`), t: int(reply['t'], `${what}.t`), steps: int(reply['steps'], `${what}.steps`), stale: reply['stale'] === true,
    deep_hash: hexMap(reply['deep_hash'], `${what}.deep_hash`),
    draws: reply['draws'] === undefined ? null : Object.fromEntries(Object.entries(obj(reply['draws'], `${what}.draws`)).map(([k, x]) => [k, arr(x, `${what}.draws.${k}`)])),
    valid_until: v === undefined ? undefined : v === null ? null : int(v, `${what}.valid_until`),
    raw: reply,
  };
}
/** The values drawing reads of an array at a frame's t (README: draws). */
export function drawn(f: Frame, path: string, what: string): JsonValue[] {
  expect(f.draws, `${what}: the frame reports what drawing reads (draws): ${show(f.raw).slice(0, 600)}`).not.toBeNull();
  return arr(f.draws![path], `${what}: draws["${path}"]`);
}
/** A frame and the frames after it until one lands: the landed frame and the steps they ran. */
export interface Landed { landed: Frame; frames: Frame[]; steps: number }
const LAND_CAP = 10_000;
export interface View { session: string; frame: (act?: Act) => Promise<Landed> }
export async function openView(l: Live, p: JsonObject, track: Entry[], span: number | 'open'): Promise<View> {
  const v = await l.call(viewCall(p, track, span));
  expect(v['ok'], `view opened the piece (span ${span}): ${show(v).slice(0, 600)}`).toBe(true);
  const session = str(v['session'], 'view.session');
  let n = 0;
  return {
    session,
    frame: async (act = {}) => {
      const frames = [frameOf(await l.call(frameCall(session, act)), `frame ${++n} (${JSON.stringify(act)})`)];
      while (frames[frames.length - 1]!.stale && frames.length < LAND_CAP) frames.push(frameOf(await l.call(frameCall(session)), `frame ${++n}`));
      const landed = frames[frames.length - 1]!;
      expect(landed.stale, `the frame after ${JSON.stringify(act)} lands within ${LAND_CAP} frames`).toBe(false);
      return { landed, frames, steps: frames.reduce((s, f) => s + f.steps, 0) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show (criterion 4's export half): `deep-show run`, one JSON scenario on stdin and one answer line
// `{"ok": true, "replies": [...]}`, as #501's suite drives it.

export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(showBin(), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-show run: ${r.error.message}`);
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = parseLines(r.stdout ?? '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(lines[0], `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(list.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
const ulid = (k: number): string => `01JB545E${String(k).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, document a on the main panel and b beside it, the calls. */
export function showScenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence, sessions: {}, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] }, side: { rect: [0, 720, 640, 360] } },
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'side' } },
    calls,
  };
}
/** `deep show` of a whole document from your shell; the hub stamps the writer layer, so the payload has none. */
export function present(doc: string, document: JsonObject): JsonObject {
  const payload = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
/** The figure criterion 4 exports (README: The export document): 64 × 64 at 8 fps, `span: open`, a block sliding across
 * over 600 s; `loop` set when given. */
export const FIGURE = { size: [64, 64] as [number, number], rate: [8, 1] as [number, number] } as const;
export function openFigure(loop?: 'wrap'): JsonObject {
  const rect = (id: string, box: number[], role: string, order: string): JsonObject => ({ id, kind: 'rect@1', layer: 'main', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  return {
    format: 1, id: 'open', profile: 'figure', title: '#545 open span', description: 'The #545 acceptance tests\' figure with an open span.', size: FIGURE.size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: { back: rect('back', [0, 0, 64, 64], 'ground', 'a1'), dot: rect('dot', [0, 24, 8, 16], 'accent', 'a2') },
    transport: { span: 'open', frame_rate: FIGURE.rate, ...(loop ? { loop } : {}) },
    channels: { slide: { target: 'items/dot/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '600s', value: 56, interp: 'linear' } } } },
  };
}
export interface Issue { code: string; severity: string; path: string | undefined; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : undefined, raw: o };
  });
}
