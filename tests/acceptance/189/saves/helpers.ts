// Test-side tools for the #189 logic-saves acceptance tests (README: The surface under test), copied from #534's suite
// and cut down. They assemble this suite's WebAssembly programs with its own assembler (wat/), build and drive the logic
// module's runner `deep-logic`, and read the save files it writes. Nothing here stands in for the logic module: every
// hash, save, refusal, report and frame read here is the implementation's own; the expected values come from the
// issue's text and this suite's programs.

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
/** The checkout root (tests/acceptance/189/saves is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
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
/** The reference Mac's legs (the budgets): BLOCKED on any other host, never skipped. */
export function onReferenceMacOnly(leg: string): void {
  if (process.platform !== 'darwin') blocked(`${leg} is pinned to the reference Mac; this host is ${process.platform}/${process.arch}`);
}

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#189.d38f773c', 2: '#189.f77560ca', 3: '#189.b334c9c9', 4: '#189.318802ef', 5: '#189.43b8fb06',
  6: '#189.159eb39e', 11: '#189.9badbff7', 12: '#189.5c949f64', 13: '#189.8d6bb564',
} as const;

export const FLICKS = 705_600_000;
export const STEP_60 = FLICKS / 60;
export const MIB = 1024 * 1024;
export const PAGE = 65_536;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
/** A kept save's file name in the saves folder: its sha256 (#534's README: Save files). */
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
const hexMap = (v: JsonValue | undefined, what: string): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(HASH64); return [id, s]; }));
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
/** A fresh folder for one run's saves, removed after the file's tests. */
const dirs: string[] = [];
export function savesDir(): string { const d = mkdtempSync(join(tmpdir(), 'deep-189-saves-')); dirs.push(d); return d; }
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** A fresh saves folder holding a copy of one save file, by its name. */
export function folderWith(file: string): string {
  const d = savesDir();
  copyFileSync(file, join(d, file.split('/').at(-1)!));
  return d;
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
const WAT_TARGET = join(TARGET, 'acceptance-189-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/189/saves/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-189-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-189-wat-'));
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
/** Bytes as a WebAssembly text string, every byte escaped. */
export const watBytes = (b: Buffer): string => [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');

// ---------------------------------------------------------------------------------------------------
// The runner `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted = 'save_drops_a_page' | 'ended_keeps_earlier_save' | 'migration_runs_under_step_budget' | 'open_writes_new_segments' | 'refusal_names_first_field';
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
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-189-bins-'));
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
/** One call in its own process. */
export const one = (call: JsonObject, planted: Planted[] = []): JsonObject => run([call], planted)[0]!;

/** A long-lived `deep-logic` process: one call, one awaited reply. Stopped (and frozen) by its PID only. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; pid: number; signal: (s: NodeJS.Signals) => void; exited: Promise<string> }
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
  const call = async (c: JsonObject): Promise<JsonObject> => {
    const got = new Promise<string>((res) => waiting.push(res));
    child.stdin.write(`${JSON.stringify(c)}\n`);
    const text = await Promise.race([got, exited]);
    let parsed: JsonValue;
    try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
    return obj(parsed, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`);
  };
  return {
    call, pid, exited,
    signal: (s) => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(pid, s); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pieces and the calls.

export type WriteType = 'bool' | 'i32' | 'f64';
export type Writes = Record<string, { type: WriteType; count?: number }>;
export interface Migration { from: { layout: string; content: string; modules: string }; by: string; remap?: string }
export interface Saves { slots?: number; request: string; ends?: string; migrate?: Migration[] }
export interface ItemSpec {
  program: Program;
  reads?: string[];
  writes: Writes;
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
  saves?: Saves;
}
export interface PieceSpec {
  seed: number; items: Record<string, ItemSpec>; controls?: string[];
  /** Items of other canvas modules, as `{kind, params}`. */
  others?: Record<string, JsonObject>;
  /** Assets the piece carries beside its items' programs (a migration and its remap table, fixture saves, an earlier program). */
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
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.budget) params['budget'] = spec.budget as JsonObject;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    if (spec.saves) params['saves'] = spec.saves as unknown as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  Object.assign(items, p.others ?? {});
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry of yours on the input track at step `k` of a 60 Hz item (its flick exactly on the step). */
export const yours = (control: string, k: number, value: number, seq = 0): Entry => ({ t: k * STEP_60, seq, control, value, writer: 'you', player: 1 });

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
/** Frames to read (#534's README: Frames): `count` 60 Hz frames from flick `from`, each with the arrays named. */
export interface FrameSpan { from: number; count: number; arrays: string[] }
export interface BakeSpec { track?: Entry[]; steps: number; saves_dir?: string; adapter?: string }
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({
  call: 'bake', piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.saves_dir ? { saves_dir: b.saves_dir } : {}), ...(b.adapter ? { adapter: b.adapter } : {}),
});
/** `open_save` (#534's README): the viewer opens the slot's save from the app, then plays on to `steps`. */
export interface OpenSpec { saves_dir: string; slot?: number; track?: Entry[]; steps: number; frames?: FrameSpan[]; adapter?: string }
export const openSaveCall = (p: JsonObject, o: OpenSpec): JsonObject => ({
  call: 'open_save', piece: p, saves_dir: o.saves_dir, slot: o.slot ?? 1, track: (o.track ?? []) as unknown as JsonValue, steps: o.steps,
  ...(o.frames ? { frames: o.frames as unknown as JsonValue } : {}), ...(o.adapter ? { adapter: o.adapter } : {}),
});
/** `layout` (README: logic.layout): the check kind over fixture saves the piece carries as assets. */
export const layoutCall = (p: JsonObject, saves: string[], same: string[], steps = 60): JsonObject => ({ call: 'layout', piece: p, saves, steps, same });

// Replies.

export interface Checked { program: string; hash: string }
/** A `check` reply's admitted items: `{ok: true, items: {id: {program, hash, ...}}}`. */
export function admitted(reply: JsonObject, what: string): Record<string, Checked> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => {
    const o = obj(v, `${what}.items.${id}`);
    return [id, { program: str(o['program'], `${what}.items.${id}.program`), hash: str(o['hash'], `${what}.items.${id}.hash`) }];
  }));
}
/** Where an item's write region entry sits in its region, from `check`'s region map. */
export function writeOffsets(reply: JsonObject, id: string): Record<string, number> {
  const l = obj(obj(obj(reply['items'], 'check.items')[id], `check.items.${id}`)['layout'], `check.items.${id}.layout`);
  const out: Record<string, number> = {};
  for (const e of arr(l['entries'], 'layout.entries')) {
    const x = obj(e, 'layout entry');
    if (x['region'] === 'writes') out[str(x['name'], 'entry name')] = int(x['offset'], 'entry offset');
  }
  return out;
}
/** Where an item's read region entry sits, from `check`'s region map. */
export function readOffsets(reply: JsonObject, id: string): Record<string, number> {
  const l = obj(obj(obj(reply['items'], 'check.items')[id], `check.items.${id}`)['layout'], `check.items.${id}.layout`);
  const out: Record<string, number> = {};
  for (const e of arr(l['entries'], 'layout.entries')) {
    const x = obj(e, 'layout entry');
    if (x['region'] === 'reads') out[str(x['name'], 'entry name')] = int(x['offset'], 'entry offset');
  }
  return out;
}

export interface StepRecord { step: number; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface Frame { t: number; arrays: Record<string, JsonValue[]> }
export interface SaveWritten { item: string; slot: number; step: number; hash: string; file: string; ended: boolean; deep_hash: Record<string, string> }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; saves: SaveWritten[]; raw: JsonObject }

function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), arrays };
  });
}
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`) };
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
    };
  });
}
/** A `bake` reply: the fields this suite reads, typed. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  return { steps: stepsOf(reply['steps'], `${what}.steps`), checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`), saves: savesOf(reply['saves'], `${what}.saves`), raw: reply };
}

/** A Differ (#534's README, with this suite's additions: README: Refusals). */
export interface Differ { what: string; save: JsonValue; piece: JsonValue; segment: number | null; offset: number | null; global: number | null; module: string | null; fields: { name: string; class: string }[] | null; raw: JsonObject }
function differsOf(v: JsonValue | undefined, what: string): Differ[] {
  return arr(v ?? [], what).map((d, i) => {
    const o = obj(d, `${what}[${i}]`);
    const fields = o['fields'] === undefined || o['fields'] === null ? null
      : arr(o['fields'], `${what}[${i}].fields`).map((f, j) => { const x = obj(f, `${what}[${i}].fields[${j}]`); return { name: str(x['name'], `${what}[${i}].fields[${j}].name`), class: str(x['class'], `${what}[${i}].fields[${j}].class`) }; });
    return {
      what: str(o['what'], `${what}[${i}].what`), save: o['save'] ?? null, piece: o['piece'] ?? null,
      segment: typeof o['segment'] === 'number' ? o['segment'] : null, offset: typeof o['offset'] === 'number' ? o['offset'] : null,
      global: typeof o['global'] === 'number' ? o['global'] : null, module: typeof o['module'] === 'string' ? o['module'] : null, fields, raw: o,
    };
  });
}
export interface RefusedSave { hash: string; differs: Differ[] }
export interface MigrationRun { by: string; fuel: number; ns: number; budget: { fuel: number; memory: number; stack: number } }
/** An `open_save` that opened a save. */
export interface Opened {
  hash: string; file: string; step: number; via: string; from: string | null;
  damaged: { hash: string; file: string }[]; refused: RefusedSave[]; deep_hash: Record<string, string>;
  steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; frames: Frame[][]; raw: JsonObject;
}
function damagedOf(v: JsonValue | undefined, what: string): { hash: string; file: string }[] {
  return arr(v ?? [], what).map((d, i) => { const o = obj(d, `${what}[${i}]`); return { hash: str(o['hash'], `${what}[${i}].hash`), file: String(o['file'] ?? '') }; });
}
function refusedOf(v: JsonValue | undefined, what: string): RefusedSave[] {
  return arr(v ?? [], what).map((d, i) => { const o = obj(d, `${what}[${i}]`); return { hash: str(o['hash'], `${what}[${i}].hash`), differs: differsOf(o['differs'], `${what}[${i}].differs`) }; });
}
export function openedOf(reply: JsonObject, what: string): Opened {
  expect(reply['ok'], `${what} opened a save (ok: true): ${show(reply)}`).toBe(true);
  const o = obj(reply['opened'], `${what}.opened`);
  return {
    hash: str(o['hash'], `${what}.opened.hash`), file: String(o['file'] ?? ''), step: int(o['step'], `${what}.opened.step`),
    via: str(o['via'], `${what}.opened.via`), from: typeof o['from'] === 'string' ? o['from'] : null,
    damaged: damagedOf(reply['damaged'], `${what}.damaged`), refused: refusedOf(reply['refused'], `${what}.refused`), deep_hash: hexMap(reply['deep_hash'], `${what}.deep_hash`),
    steps: stepsOf(reply['steps'], `${what}.steps`), checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`), frames: framesOf(reply['frames'], `${what}.frames`), raw: reply,
  };
}
/** The migration an `open_save` ran (README: Migrations): its asset, the fuel it used, its time and its budget. */
export function migrationOf(reply: JsonObject, what: string): MigrationRun {
  const m = obj(reply['migration'], `${what}.migration`);
  const b = obj(m['budget'], `${what}.migration.budget`);
  return {
    by: str(m['by'], `${what}.migration.by`), fuel: int(m['fuel'], `${what}.migration.fuel`), ns: num(m['ns'], `${what}.migration.ns`),
    budget: { fuel: int(b['fuel'], `${what}.migration.budget.fuel`), memory: int(b['memory'], `${what}.migration.budget.memory`), stack: int(b['stack'], `${what}.migration.budget.stack`) },
  };
}
/** A refused `open_save`: `{ok: false, code, save, differs: [Differ], ...}`. */
export interface Refusal { code: string; save: string | null; differs: Differ[]; damaged: { hash: string; file: string }[]; raw: JsonObject }
export function refusalOf(reply: JsonObject, what: string): Refusal {
  expect(reply['ok'], `${what} is refused (ok: false): ${show(reply)}`).toBe(false);
  return { code: str(reply['code'], `${what}.code`), save: typeof reply['save'] === 'string' ? reply['save'] : null, differs: differsOf(reply['differs'], `${what}.differs`), damaged: damagedOf(reply['damaged'], `${what}.damaged`), raw: reply };
}

/** logic.layout's report (README: logic.layout). */
export interface LayoutRun { save: string; via: string; control: string; entries: JsonValue[]; from: number; current: StepRecord[]; old: StepRecord[] }
export interface LayoutFailure { save: string | null; array: string | null; element: number | null; step: number | null; field: string | null; raw: JsonObject }
export interface LayoutReport { verdict: string; failures: LayoutFailure[]; runs: LayoutRun[]; ask: string | null; raw: JsonObject }
export function layoutOf(reply: JsonObject, what: string): LayoutReport {
  expect([reply['ok'], reply['kind']], `${what} answers a logic.layout report: ${show(reply)}`).toEqual([true, 'logic.layout']);
  const failures = arr(reply['failures'] ?? [], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    return {
      save: typeof o['save'] === 'string' ? o['save'] : null, array: typeof o['array'] === 'string' ? o['array'] : null,
      element: typeof o['element'] === 'number' ? o['element'] : null, step: typeof o['step'] === 'number' ? o['step'] : null,
      field: typeof o['field'] === 'string' ? o['field'] : null, raw: o,
    };
  });
  const runs = arr(reply['runs'] ?? [], `${what}.runs`).map((r, i) => {
    const o = obj(r, `${what}.runs[${i}]`);
    return {
      save: str(o['save'], `${what}.runs[${i}].save`), via: str(o['via'], `${what}.runs[${i}].via`), control: str(o['control'], `${what}.runs[${i}].control`),
      entries: arr(o['entries'], `${what}.runs[${i}].entries`), from: int(o['from'], `${what}.runs[${i}].from`),
      current: stepsOf(o['current'], `${what}.runs[${i}].current`), old: stepsOf(o['old'], `${what}.runs[${i}].old`),
    };
  });
  return { verdict: str(reply['verdict'], `${what}.verdict`), failures, runs, ask: typeof reply['ask'] === 'string' ? reply['ask'] : null, raw: reply };
}

// ---------------------------------------------------------------------------------------------------
// Save files (#534's README: Save files): `<saves_dir>/<sha256>.save`, a JSON header line, a newline, then the state.

export interface SaveFile { hash: string; path: string; bytes: Buffer; header: JsonObject }
/** Reads one save file's header without its state: the bytes up to the first newline, as JSON. */
export function readSave(path: string): SaveFile {
  const bytes = readFileSync(path);
  const nl = bytes.indexOf(0x0a);
  expect(nl, `${path} holds a header line`).toBeGreaterThan(0);
  let header: JsonValue;
  try { header = JSON.parse(bytes.subarray(0, nl).toString('utf8')) as JsonValue; } catch (e) { throw Error(`${path}'s first line isn't JSON: ${String(e)}`); }
  const m = SAVE_FILE.exec(path.split('/').at(-1) ?? '');
  return { hash: m?.[1] ?? '', path, bytes, header: obj(header, `${path}'s header`) };
}
/** The kept saves in a folder, by file name. */
export function keptSaves(dir: string): string[] { return readdirSync(dir).filter((f) => SAVE_FILE.test(f)).sort(); }
/** A save's file in its folder. */
export const saveFile = (dir: string, hash: string): string => join(dir, `${hash}.save`);
/** The binding a migration is declared from: the save's layout, content and module set, as its header names them. */
export function bindingOf(path: string): Migration['from'] {
  const h = readSave(path).header;
  return { layout: str(h['layout'], 'header.layout'), content: str(h['content'], 'header.content'), modules: str(h['modules'], 'header.modules') };
}

// ---------------------------------------------------------------------------------------------------
// Comparisons.

/** An array's values at a step, by its name in a step record (`<item>.<name>`). */
export const valuesAt = (s: StepRecord | undefined, item: string, name: string): JsonValue[] | undefined => s?.arrays[`${item}.${name}`];
/** The first element at which two arrays differ, or null. */
export function firstElement(a: JsonValue[] | undefined, b: JsonValue[] | undefined): number | null {
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i++) if (JSON.stringify(a?.[i]) !== JSON.stringify(b?.[i])) return i;
  return null;
}
/** The first step (in order) and element at which two runs' `names` arrays differ, or null. */
export function firstStepDiff(a: StepRecord[], b: StepRecord[], item: string, names: string[]): { step: number; array: string; element: number } | null {
  const byStep = new Map(b.map((s) => [s.step, s]));
  for (const s of [...a].sort((x, y) => x.step - y.step)) {
    for (const name of names) {
      const e = firstElement(valuesAt(s, item, name), valuesAt(byStep.get(s.step), item, name));
      if (e !== null) return { step: s.step, array: name, element: e };
    }
  }
  return null;
}
/** An array name as a report names it: bare, or as `<item>.<name>`. */
export const names = (got: string | null, name: string): boolean => got !== null && (got === name || got.endsWith(`.${name}`));
