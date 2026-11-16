// Test-side tools for the #534 acceptance tests (README: The surface under test), after #532's suite. They assemble
// this suite's WebAssembly programs with its own assembler (wat/), build and drive the logic module's runner
// `deep-logic`, and read the save files it writes. Nothing here stands in for the logic module: every hash, save,
// refusal and frame read here is the implementation's own; the expected values come from the issue's text and this
// suite's programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/534 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH); ~/.cargo/bin elsewhere. */
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: a first build of deep-logic takes many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** The reference Mac's legs (frames bit for bit, the budgets): BLOCKED on any other host, never skipped. */
export function onReferenceMacOnly(leg: string): void {
  if (process.platform !== 'darwin') blocked(`${leg} is pinned to the reference Mac; this host is ${process.platform}/${process.arch}`);
}

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#534.facb3458', 2: '#534.a644d162', 3: '#534.8e544563', 4: '#534.e281f3dd',
  5: '#534.e4ecebfc', 6: '#534.73983bd0', 7: '#534.023b4bfb', 8: '#534.8a234a6f',
} as const;

export const FLICKS = 705_600_000;
/** One step's flicks at `hz`. */
export const stepOf = (hz: number): number => FLICKS / hz;
export const STEP_60 = stepOf(60);
export const MIB = 1024 * 1024;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
/** A kept save's file name in the saves folder: its sha256 (README: Save files). */
export const SAVE_FILE = /^([0-9a-f]{64})\.save$/;

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
const hexMap = (v: JsonValue | undefined, what: string, re = HASH64): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(re); return [id, s]; }));
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
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
/** `n` seeded bytes. */
export function bytesOf(seed: number, n: number): Buffer {
  const r = seeded(seed);
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}
/** A fresh folder for one run's saves (README: saves_dir), removed after the file's tests. */
const dirs: string[] = [];
export function savesDir(): string { const d = mkdtempSync(join(tmpdir(), 'deep-534-saves-')); dirs.push(d); return d; }
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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
const WAT_TARGET = join(TARGET, 'acceptance-534-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/534/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-534-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-534-wat-'));
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
export type Planted = 'save_drops_globals' | 'save_drops_input_position' | 'open_reapplies_segments' | 'save_drops_linear_previous';
const plantedArgs = (planted: Planted[]): string[] => planted.flatMap((p) => ['--planted', p]);

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0. */
export function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

let binsDir = '';
let builtLogic: { bin: string; error: string } | undefined;
/** `cargo build --locked --bin deep-logic` in the checkout, copied out, once per process. */
export function logicBin(): string {
  if (!builtLogic) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-534-bins-'));
    const bin = join(binsDir, exe(LOGIC_BIN));
    const error = cargo(['build', '--locked', '--bin', LOGIC_BIN], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(LOGIC_BIN)), bin);
    builtLogic = { bin, error };
  }
  expect(builtLogic.error, `${LOGIC_BIN} builds on this host (cargo build --locked --bin ${LOGIC_BIN})`).toBe('');
  return builtLogic.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; builtLogic = undefined; });

/**
 * Runs `calls` through one `deep-logic [--planted p]...` process, which then exits: one session of the app, so a
 * save written by one call of `run` and opened by another was written by an app that quit since.
 */
export function run(calls: JsonObject[], planted: Planted[] = []): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')} on ${process.platform}/${process.arch}`);
}

/** A long-lived `deep-logic` process: one call, one awaited reply. Stopped (and frozen) by its PID only. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; send: (c: JsonObject) => Promise<JsonObject>; pid: number; signal: (s: NodeJS.Signals) => void; exited: Promise<string> }
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
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error(`${LOGIC_BIN} didn't start`);
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', (code, sig) => res(`{"ok":false,"code":"exited","status":${JSON.stringify(code)},"signal":${JSON.stringify(sig)},"stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  const send = async (c: JsonObject): Promise<JsonObject> => {
    const got = new Promise<string>((res) => waiting.push(res));
    child.stdin.write(`${JSON.stringify(c)}\n`);
    const text = await Promise.race([got, exited]);
    let parsed: JsonValue;
    try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
    return obj(parsed, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`);
  };
  return {
    call: send, send, pid, exited,
    signal: (s) => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(pid, s); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Piece) and the calls.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface Saves { slots?: number; request: string; ends?: string; migrate?: { from: { layout: string; content: string; modules: string }; by: string; remap?: string }[] }
export interface ItemSpec {
  program: Program;
  step_rate?: number;
  reads?: string[];
  writes: Record<string, { type: WriteType; count?: number; interpolate?: 'linear' | 'hold' }>;
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
  saves?: Saves;
  /** logic@1 fields the base doesn't build (pages, services, mirrors), as the design writes them. */
  more?: JsonObject;
}
export interface PieceSpec {
  seed: number; items: Record<string, ItemSpec>; controls?: string[]; class?: string;
  /** Items of other canvas modules, as `{kind, params}`. */
  others?: Record<string, JsonObject>;
  /** Assets the piece carries beside its programs (a migration's program). */
  assets?: Buffer[];
}
/** A piece as `deep-logic` takes it: the document's seed, its controls, its items and the assets they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const b of p.assets ?? []) assets[sha256(b)] = b.toString('base64');
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.step_rate !== undefined) params['step_rate'] = spec.step_rate;
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.budget) params['budget'] = spec.budget as JsonObject;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    if (spec.saves) params['saves'] = spec.saves as unknown as JsonObject;
    Object.assign(params, spec.more ?? {});
    items[id] = { kind: 'logic@1', params };
  }
  Object.assign(items, p.others ?? {});
  return {
    seed: p.seed,
    ...(p.class ? { class: p.class } : {}),
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry of yours on the input track at step `k` of an item at `hz` (its flick exactly on the step). */
export const yours = (control: string, k: number, value: number, seq = 0, hz = 60): Entry => ({ t: k * stepOf(hz), seq, control, value, writer: 'you', player: 1 });

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
/** Frames to read (README: Frames): `count` 60 Hz frames from flick `from`, each with the arrays named. */
export interface FrameSpan { from: number; count: number; arrays: string[] }
export interface BakeSpec { track?: Entry[]; steps: number; saves_dir?: string; frames?: FrameSpan[]; adapter?: string }
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({
  call: 'bake', piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.saves_dir ? { saves_dir: b.saves_dir } : {}),
  ...(b.frames ? { frames: b.frames as unknown as JsonValue } : {}),
  ...(b.adapter ? { adapter: b.adapter } : {}),
});
/** `open_save` (README): the viewer opens the slot's save from the app, then plays on to `steps`. */
export interface OpenSpec { saves_dir: string; slot: number; track?: Entry[]; steps: number; frames?: FrameSpan[]; adapter?: string }
export const openSaveCall = (p: JsonObject, o: OpenSpec): JsonObject => ({
  call: 'open_save', piece: p, saves_dir: o.saves_dir, slot: o.slot, track: (o.track ?? []) as unknown as JsonValue, steps: o.steps,
  ...(o.frames ? { frames: o.frames as unknown as JsonValue } : {}),
  ...(o.adapter ? { adapter: o.adapter } : {}),
});

// Replies.

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number }[] }
export interface Checked { program: string; hash: string; layout: Layout }
function checkedOf(v: JsonValue | undefined, what: string): Checked {
  const o = obj(v, what);
  const l = obj(o['layout'], `${what}.layout`);
  const entries = arr(l['entries'], `${what}.layout.entries`).map((e, i) => {
    const x = obj(e, `${what}.layout.entries[${i}]`);
    return { region: str(x['region'], 'region'), name: str(x['name'], 'name'), offset: int(x['offset'], 'offset'), size: int(x['size'], 'size') };
  });
  return { program: str(o['program'], `${what}.program`), hash: str(o['hash'], `${what}.hash`), layout: { digest: str(l['digest'], `${what}.layout.digest`), entries } };
}
/** A `check` reply's admitted items: `{ok: true, items: {id: {program, hash, layout}}}`. */
export function admitted(reply: JsonObject, what: string): Record<string, Checked> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, checkedOf(v, `${what}.items.${id}`)]));
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): number {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return e.offset;
}
/** The layout `check` gives an item with these reads and writes, built from the layout probe (programs.ts). */
export function layoutFor(probe: Program, reads: string[], writes: ItemSpec['writes'], step_rate?: number): Layout {
  const [reply] = run([checkCall(piece({ seed: 534, controls: reads, items: { probe: { program: probe, reads, writes, ...(step_rate ? { step_rate } : {}) } } }))]);
  return admitted(reply!, 'check of the layout probe')['probe']!.layout;
}

export interface ItemStep { hash: string | null; fuel: number; failed: boolean }
export interface StepRecord { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string; ns: number | null }
export interface Frame { t: number; arrays: Record<string, JsonValue[]> }
export interface SaveWritten { item: string; slot: number; step: number; hash: string; file: string; ended: boolean; deep_hash: Record<string, string>; write_ns: number | null; on_ui_thread: boolean | null }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; saves: SaveWritten[]; frames: Frame[][]; raw: JsonObject }

function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      const hash = it['hash'] === null || it['hash'] === undefined ? null : str(it['hash'], `${what}[${i}].items.${id}.hash`);
      return [id, { hash, fuel: int(it['fuel'], `${what}[${i}].items.${id}.fuel`), failed: it['failed'] === true }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    const deep = str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`);
    expect(deep, `${what}.${id}[${i}].deep_hash is 16 hex digits`).toMatch(HASH64);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: deep, ns: typeof o['ns'] === 'number' ? o['ns'] : null };
  })]));
}
function framesOf(v: JsonValue | undefined, what: string): Frame[][] {
  return arr(v ?? [], what).map((span, i) => arr(span, `${what}[${i}]`).map((f, j) => {
    const o = obj(f, `${what}[${i}][${j}]`);
    return { t: int(o['t'], `${what}[${i}][${j}].t`), arrays: Object.fromEntries(Object.entries(obj(o['arrays'], `${what}[${i}][${j}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}][${j}].arrays.${k}`)])) };
  }));
}
export function savesOf(v: JsonValue | undefined, what: string): SaveWritten[] {
  return arr(v ?? [], what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const w = `${what}[${i}]`;
    const hash = str(o['hash'], `${w}.hash`);
    expect(hash, `${w}.hash is a sha256`).toMatch(DIGEST);
    return {
      item: str(o['item'], `${w}.item`), slot: int(o['slot'], `${w}.slot`), step: int(o['step'], `${w}.step`), hash, file: str(o['file'], `${w}.file`),
      ended: o['ended'] === true, deep_hash: hexMap(o['deep_hash'], `${w}.deep_hash`),
      write_ns: typeof o['write_ns'] === 'number' ? o['write_ns'] : null, on_ui_thread: typeof o['on_ui_thread'] === 'boolean' ? o['on_ui_thread'] : null,
    };
  });
}
/** A `bake` reply: the fields this suite reads, typed. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  return { steps: stepsOf(reply['steps'], `${what}.steps`), checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`), saves: savesOf(reply['saves'], `${what}.saves`), frames: framesOf(reply['frames'], `${what}.frames`), raw: reply };
}

/** An `open_save` that opened a save. */
export interface Opened {
  hash: string; file: string; step: number; via: string; from: string | null;
  damaged: { hash: string; file: string }[]; deep_hash: Record<string, string>;
  steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; frames: Frame[][]; raw: JsonObject;
}
function damagedOf(v: JsonValue | undefined, what: string): { hash: string; file: string }[] {
  return arr(v ?? [], what).map((d, i) => { const o = obj(d, `${what}[${i}]`); return { hash: str(o['hash'], `${what}[${i}].hash`), file: str(o['file'], `${what}[${i}].file`) }; });
}
export function openedOf(reply: JsonObject, what: string): Opened {
  expect(reply['ok'], `${what} opened a save (ok: true): ${show(reply)}`).toBe(true);
  const o = obj(reply['opened'], `${what}.opened`);
  return {
    hash: str(o['hash'], `${what}.opened.hash`), file: str(o['file'], `${what}.opened.file`), step: int(o['step'], `${what}.opened.step`),
    via: str(o['via'], `${what}.opened.via`), from: typeof o['from'] === 'string' ? o['from'] : null,
    damaged: damagedOf(reply['damaged'], `${what}.damaged`), deep_hash: hexMap(reply['deep_hash'], `${what}.deep_hash`),
    steps: stepsOf(reply['steps'], `${what}.steps`), checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`), frames: framesOf(reply['frames'], `${what}.frames`), raw: reply,
  };
}
/** A refused `open_save`: `{ok: false, code, save, differs: [Differ], ...}`. */
export interface Differ { what: string; save: JsonValue; piece: JsonValue; segment: number | null; offset: number | null }
export interface Refusal { code: string; save: string | null; differs: Differ[]; damaged: { hash: string; file: string }[]; raw: JsonObject }
export function refusalOf(reply: JsonObject, what: string): Refusal {
  expect(reply['ok'], `${what} is refused (ok: false): ${show(reply)}`).toBe(false);
  const differs = arr(reply['differs'] ?? [], `${what}.differs`).map((d, i) => {
    const o = obj(d, `${what}.differs[${i}]`);
    return { what: str(o['what'], `${what}.differs[${i}].what`), save: o['save'] ?? null, piece: o['piece'] ?? null, segment: typeof o['segment'] === 'number' ? o['segment'] : null, offset: typeof o['offset'] === 'number' ? o['offset'] : null };
  });
  return { code: str(reply['code'], `${what}.code`), save: typeof reply['save'] === 'string' ? reply['save'] : null, differs, damaged: damagedOf(reply['damaged'], `${what}.damaged`), raw: reply };
}

// ---------------------------------------------------------------------------------------------------
// Save files (README: Save files): `<saves_dir>/<sha256>.save`, a JSON header line, a newline, then the state.

export const BINDING = ['slot', 'layout', 'content', 'modules', 'runtime', 'document', 'program', 'step', 'input_at', 'track', 'ended'] as const;
export interface SaveFile { hash: string; path: string; bytes: Buffer; header: JsonObject; state: Buffer }
/** Reads one save file's header without its state: the bytes up to the first newline, as JSON. */
export function readSave(path: string): SaveFile {
  const bytes = readFileSync(path);
  const nl = bytes.indexOf(0x0a);
  expect(nl, `${path} holds a header line`).toBeGreaterThan(0);
  let header: JsonValue;
  try { header = JSON.parse(bytes.subarray(0, nl).toString('utf8')) as JsonValue; } catch (e) { throw Error(`${path}'s first line isn't JSON: ${String(e)}`); }
  const m = SAVE_FILE.exec(path.split('/').at(-1) ?? '');
  return { hash: m?.[1] ?? '', path, bytes, header: obj(header, `${path}'s header`), state: bytes.subarray(nl + 1) };
}
/** The kept saves in a folder, by file name. */
export function keptSaves(dir: string): string[] { return readdirSync(dir).filter((f) => SAVE_FILE.test(f)).sort(); }

// ---------------------------------------------------------------------------------------------------
// Comparisons.

/** One line per step: its hashes and every array, for comparing runs. */
export const rows = (steps: StepRecord[]): string[] => steps.map((s) => JSON.stringify([s.step, Object.entries(s.items).sort().map(([id, x]) => [id, x.hash]), Object.entries(s.arrays).sort()]));
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${(a[i] ?? '(none)').slice(0, 300)} against ${(b[i] ?? '(none)').slice(0, 300)}`;
  return null;
}
/**
 * The never-quit comparison of full-state hashes: every checkpoint the opened run reports at or after `from` against
 * the never-quit run's checkpoint at the same step. Returns the first checkpoint that differs, or null; a checkpoint the
 * never-quit run lacks (other than the opened state itself) counts as differing.
 */
export function firstCheckpointDiff(opened: Record<string, Checkpoint[]>, neverQuit: Record<string, Checkpoint[]>, from: number): { step: number; item: string; got: string; want: string | undefined } | null {
  const steps = new Set<number>();
  for (const list of Object.values(opened)) for (const c of list) if (c.step >= from) steps.add(c.step);
  for (const step of [...steps].sort((a, b) => a - b)) {
    for (const [item, list] of Object.entries(opened).sort()) {
      const got = list.find((c) => c.step === step)?.deep_hash;
      const want = neverQuit[item]?.find((c) => c.step === step)?.deep_hash;
      if (got === undefined) continue;
      if (want === undefined && step === from) continue;
      if (got !== want) return { step, item, got, want };
    }
  }
  return null;
}
/** The first frame (by its index from the span's start) and array whose values differ, bit for bit, or null. */
export function firstFrameDiff(a: Frame[], b: Frame[]): { frame: number; t: number; array: string } | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]; const y = b[i];
    if (!x || !y || x.t !== y.t) return { frame: i, t: x?.t ?? y?.t ?? -1, array: '(the frame itself)' };
    for (const name of [...new Set([...Object.keys(x.arrays), ...Object.keys(y.arrays)])].sort()) {
      if (!bitEqual(x.arrays[name], y.arrays[name])) return { frame: i, t: x.t, array: name };
    }
  }
  return null;
}
/** Two values equal bit for bit: numbers by their f64 bits (so -0 and 0 differ, and NaN equals only itself). */
export function bitEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const x = Buffer.alloc(8); const y = Buffer.alloc(8);
    x.writeDoubleLE(a); y.writeDoubleLE(b);
    return x.equals(y);
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => bitEqual(v, b[i]));
  return JSON.stringify(a) === JSON.stringify(b);
}
