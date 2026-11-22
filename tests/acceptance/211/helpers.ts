// Test-side tools for the #211 acceptance tests (README: The surface under test). They build and drive the binaries that
// hold the modules the criteria name: `deep-logic` (#531's JSON-lines runner, with #532's, #534's, #546's and #547's
// calls) for the page store, its checkpoints, saves, traps, checks and the web player's logic runtime (its web runner,
// run in headless Chrome as #532's suite runs it), and `deep-show run` (the full set) for a provider's `out: pages` at a
// document's check and for the web export. Programs are WebAssembly text (programs.ts) assembled by #544's assembler
// (tests/acceptance/544/wat, read only). Nothing here stands in for a module: every slot table, page map, hash, trap,
// fuel count, save, refusal, verdict and time read here is the implementation's own; every expected value comes from the
// issue's text, the design and this suite's programs, computed here.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const MIB = 1024 * 1024;
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** cargo on PATH: the pinned toolchain's folder, and Homebrew's rustup, first when they are there. */
for (const dir of ['/opt/homebrew/opt/rustup/bin', join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin')]) {
  if (existsSync(dir) && !(process.env['PATH'] ?? '').split(':').includes(dir)) process.env['PATH'] = `${dir}:${process.env['PATH'] ?? ''}`;
}
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};

/** Each test's own timeout; the builds in `beforeAll` have their own. */
export const TIMEOUT = 3_600_000;
/** A build's timeout: a cold deep-show takes about 25 minutes on a loaded Mac. */
const BUILD_TIMEOUT = 5_400_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#211.53478a94',
  2: '#211.4818ef34',
  3: '#211.aee9d8a7',
  4: '#211.c8b345d9',
  5: '#211.0993eba9',
  6: '#211.aaf0f08b',
  7: '#211.0a8cf256',
  8: '#211.c0b6687b',
  9: '#211.4d368ad6',
  10: '#211.15f6aeb8',
} as const;
/** A test title's prefix: the criterion's number and its ID. */
export const AC = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** A reading this machine can't judge: the test fails with this message, never passes. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const ints = (v: JsonValue[] | undefined, what: string): number[] => arr(v, what).map((x, i) => int(x, `${what}[${i}]`));
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const DIGEST = /^[0-9a-f]{64}$/;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** Whether some object anywhere in `v` holds `key` with exactly `want` (a naming field; prose is never read). */
export function holds(v: JsonValue | undefined, key: string, want: JsonValue): boolean {
  if (Array.isArray(v)) return v.some((x) => holds(x, key, want));
  if (!isObject(v)) return false;
  if (key in v && JSON.stringify(v[key]) === JSON.stringify(want)) return true;
  return Object.values(v).some((x) => holds(x, key, want));
}
/** mulberry32: a fixed-seed generator of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** macOS arm64, where the criteria's app runs: elsewhere the test fails INCONCLUSIVE before it runs. */
export function onMacArm64(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') inconclusive(`this criterion names macOS arm64; this host is ${process.platform}/${process.arch}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, in `beforeAll`, copied out of the target folder (README: Run them).

export type Build = 'logic' | 'logic-release' | 'show';
const CARGO_ARGS: Record<Build, string[]> = {
  logic: ['build', '--locked', '--bin', 'deep-logic'],
  'logic-release': ['build', '--locked', '--release', '--bin', 'deep-logic'],
  show: ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'],
};
const OUT: Record<Build, [string, string]> = { logic: ['debug', 'deep-logic'], 'logic-release': ['release', 'deep-logic'], show: ['debug', 'deep-show'] };
function cargoError(args: string[], env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked('cargo isn\'t on this machine (looked on PATH, in Homebrew\'s rustup and in the pinned toolchain)');
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
const built = new Map<Build, { bin: string; error: string }>();
function build(b: Build): { bin: string; error: string } {
  const known = built.get(b);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-211-bins-'));
  const [profile, name] = OUT[b];
  const bin = join(binsDir, `${name}-${b}`);
  const error = cargoError(CARGO_ARGS[b]);
  if (error === '') copyFileSync(join(TARGET, profile, name), bin);
  const out = { bin, error };
  built.set(b, out);
  return out;
}
/** Builds `list` before a file's tests (the slow part), so each test's own time is its own. */
export function useBuilds(list: Build[]): void {
  beforeAll(() => { for (const b of list) { try { build(b); } catch { /* the test that uses it reports it */ } } }, BUILD_TIMEOUT * Math.max(1, list.length));
  afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });
}
/** The built binary; a test that uses a build that failed fails here, naming cargo's command and error. */
export function binOf(b: Build): string {
  const out = build(b);
  expect(out.error, `${b} builds on this host (cargo ${CARGO_ARGS[b].join(' ')})`).toBe('');
  return out.bin;
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (tests/acceptance/544/wat, read only), into its own target.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-544-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargoError(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`the assembler this suite uses (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', 'acceptance-544-wat');
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program (its bytes, base64 and SHA-256). */
export function assemble(name: string, text: string): Program {
  const key = sha256(`${name}\n${text}`);
  const known = assembled.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-211-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${(run.stderr ?? '').slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh folder per call (a saves folder, a page store's disk, an evidence store, a pack), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-211-')); made.push(d); return d; };
}
export const filesIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
export const sizeOf = (path: string): number => statSync(path).size;

// ---------------------------------------------------------------------------------------------------
// World pages (README: The page region). Little-endian. pages_at is 65,536 in every program here.

export const PAGE = 65_536;
export const PAGES_AT = 65_536;
/** Request i, `{page: u32, slot: u32}`, from pages_at. */
export const requestAt = (i: number): number => PAGES_AT + 8 * i;
/** Slot s's entry of the slot table, `{page: u32, fresh: u32}`, after `moves` requests. */
export const tableAt = (moves: number, s: number): number => PAGES_AT + 8 * moves + 8 * s;
/** Page slot s: the memory page at pages_at + 65,536 × (1 + s) (README: where the slots start). */
export const slotAt = (s: number): number => PAGES_AT + PAGE * (1 + s);
/** A page region of `slots` slots after pages_at's first page: the program's memory in 64 KiB pages. */
export const memoryPages = (slots: number): number => 2 + slots;
/** The page fields of a logic item (Logic: world pages), every key given. */
export interface Pages { max: number; slots: number; moves: number; lead: number; init: JsonValue; written_max: number; web_max: number }
export const pagesOf = (p: Partial<Pages> & { max: number; slots: number }): Pages =>
  ({ moves: 8, lead: 4, init: 'zero', written_max: 256, web_max: 256, ...p });
/** A pages@1 asset (Logic: data layouts; #415's bytes): `PAGS`, version 1, the page count, then each page's number and its 64 KiB. */
export function pagesAsset(pages: { number: number; bytes?: Buffer }[]): Buffer {
  const b = Buffer.alloc(12 + pages.length * (4 + PAGE));
  b.write('PAGS', 0, 'latin1');
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(pages.length, 8);
  pages.forEach((p, i) => {
    b.writeUInt32LE(p.number, 12 + i * (4 + PAGE));
    p.bytes?.copy(b, 16 + i * (4 + PAGE));
  });
  return b;
}

// ---------------------------------------------------------------------------------------------------
// deep-logic (#531's runner, JSON lines in, one reply per line), its pieces and replies.

/** `deep-logic --planted <name>` (README: Planted twins), each one criterion's wrong program. */
export type LogicPlanted = 'pager_restores_without_queue' | 'pager_skips_dirty_write_back' | 'pager_applies_moves_as_reads_finish'
  | 'save_drops_page_map' | 'store_keeps_one_copy_per_page';
export function logic(calls: JsonObject[], o: { planted?: LogicPlanted[]; bin?: string } = {}): JsonObject[] {
  const bin = o.bin ?? binOf('logic');
  const args = (o.planted ?? []).flatMap((p) => ['--planted', p]);
  const what = `deep-logic${args.length ? ` ${args.join(' ')}` : ''}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i], 120)})`));
}

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export type Writes = Record<string, { type: WriteType; count?: number }>;
const SIZE: Record<WriteType, number> = { bool: 4, i32: 4, f64: 8, vec2: 16, vec3: 24, quat: 32 };
/** The write region at writes_at (4,096 here), #531's rule: each array in declaration order on an 8-byte boundary. */
export function writeAddresses(w: Writes): Record<string, number> {
  const out: Record<string, number> = {};
  let off = 0;
  for (const [name, x] of Object.entries(w)) {
    out[name] = 4096 + off;
    off = Math.ceil((off + SIZE[x.type] * (x.count ?? 1)) / 8) * 8;
  }
  return out;
}
export interface ItemSpec {
  program: Program;
  reads?: string[];
  writes: Writes;
  pages?: Pages;
  budget?: { fuel?: number; memory?: number };
  checkpoint?: { every?: number; budget?: number };
  saves?: JsonObject;
}
/** A piece as `deep-logic` takes it (#531's README: Piece), with this suite's `pages`; `data` are data assets by their bytes. */
export function piece(p: { seed: number; items: Record<string, ItemSpec>; controls?: string[]; class?: string; data?: Buffer[] }): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, s] of Object.entries(p.items)) {
    assets[s.program.sha] = s.program.b64;
    const params: JsonObject = { program: s.program.sha, step_rate: 60, writes: s.writes as unknown as JsonObject };
    if (s.reads) params['reads'] = s.reads;
    if (s.pages) params['pages'] = s.pages as unknown as JsonObject;
    if (s.budget) params['budget'] = s.budget as JsonObject;
    if (s.checkpoint) params['checkpoint'] = s.checkpoint as JsonObject;
    if (s.saves) params['saves'] = s.saves;
    items[id] = { kind: 'logic@1', params };
  }
  for (const d of p.data ?? []) assets[sha256(d)] = d.toString('base64');
  return {
    seed: p.seed, ...(p.class ? { class: p.class } : {}),
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}), items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you'; player: number }
export const FLICKS = 705_600_000;
/** An entry on the input track exactly at step `k` of a 60 Hz item. */
export const entryAt = (control: string, k: number, value: number, seq = 0): Entry => ({ t: (k * FLICKS) / 60, seq, control, value, writer: 'you', player: 1 });
/** A sampled time that names step k under ⌊t × 60⌋ with no rounding doubt. */
export const timeOf = (k: number): number => (k + 0.5) / 60;

export interface Store { dir: string; memory: number; read_delay_ms: number }
export interface BakeOptions { track?: Entry[]; restores?: { from: number; steps: number }[]; store?: Store; saves_dir?: string }
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
const bakeFields = (p: JsonObject, steps: number, o: BakeOptions): JsonObject => ({
  piece: p, steps, track: (o.track ?? []) as unknown as JsonValue,
  ...(o.restores ? { restores: o.restores as unknown as JsonValue } : {}),
  ...(o.store ? { store: o.store as unknown as JsonValue } : {}),
  ...(o.saves_dir ? { saves_dir: o.saves_dir } : {}),
});
export const bakeCall = (p: JsonObject, steps: number, o: BakeOptions = {}): JsonObject => ({ call: 'bake', ...bakeFields(p, steps, o) });
export const webPlanCall = (p: JsonObject, steps: number, o: BakeOptions = {}): JsonObject => ({ call: 'web_plan', ...bakeFields(p, steps, o) });
/** #532's logic.determinism, `at_times` in seconds; `orders` (this suite's): the input tracks it also plays from step 0. */
export const determinismCall = (p: JsonObject, steps: number, atTimes: number[], o: BakeOptions & { orders?: Entry[][] } = {}): JsonObject => ({
  call: 'determinism', ...bakeFields(p, steps, o), at_times: atTimes, compare: 'same_machine',
  ...(o.orders ? { orders: o.orders as unknown as JsonValue } : {}),
});
/** #532's and #546's logic.budget (`fuel_share: 1`, as #546's suite always passes it). */
export const budgetCall = (p: JsonObject, steps: number, on: ('app' | 'web')[] = ['app']): JsonObject =>
  ({ call: 'budget', ...bakeFields(p, steps, {}), on, fuel_share: 1 });
export const openSaveCall = (p: JsonObject, o: { saves_dir: string; slot: number; steps: number; track?: Entry[] }): JsonObject =>
  ({ call: 'open_save', piece: p, saves_dir: o.saves_dir, slot: o.slot, steps: o.steps, track: (o.track ?? []) as unknown as JsonValue });
export const WEB_RUNNER: JsonObject = { call: 'web_runner' };

export interface ItemStep { hash: string | null; fuel: number; failed: boolean; raw: JsonObject }
export interface LogicStep { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export function stepsOf(v: JsonValue | undefined, what: string): LogicStep[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      return [id, { hash: typeof it['hash'] === 'string' ? it['hash'] : null, fuel: int(it['fuel'], `${what}[${i}].items.${id}.fuel`), failed: it['failed'] === true, raw: it }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'], `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
/** A checkpoint (#531's `{step, deep_hash}`) with this suite's page fields for an item with pages (README: Checkpoints). */
export interface Checkpoint { step: number; deep_hash: string; map: Record<string, string> | null; raw: JsonObject }
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    const map = isObject(o['map']) ? Object.fromEntries(Object.entries(o['map']).map(([p, h]) => [p, str(h, `${what}.${id}[${i}].map.${p}`)])) : null;
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`), map, raw: o };
  })]));
}
export interface Restored { from: number; steps: LogicStep[]; checkpoints: Record<string, Checkpoint[]> }
export interface Bake {
  steps: LogicStep[]; checkpoints: Record<string, Checkpoint[]>; traps: JsonObject[]; restores: Restored[];
  meters: Record<string, JsonObject>; saves: JsonObject[]; raw: JsonObject;
}
/** A bake that ran: its step records, checked to run 0 … n − 1 in order, and the rest of its reply. */
export function bakeOf(reply: JsonObject, n: number, what: string): Bake {
  expect(reply['ok'], `${what}: the bake ran (ok: true): ${show(reply)}`).toBe(true);
  const steps = stepsOf(reply['steps'], `${what}: steps`);
  expect(steps.map((s) => s.step), `${what}: step records 0 … ${n - 1}`).toEqual(Array.from({ length: n }, (_, k) => k));
  const restores = arr(reply['restores'] ?? [], `${what}: restores`).map((r, i) => {
    const o = obj(r, `${what}: restores[${i}]`);
    return { from: int(o['from'], `${what}: restores[${i}].from`), steps: stepsOf(o['steps'], `${what}: restores[${i}].steps`), checkpoints: checkpointsOf(o['checkpoints'], `${what}: restores[${i}].checkpoints`) };
  });
  const meters = isObject(reply['meters']) ? Object.fromEntries(Object.entries(reply['meters']).map(([id, m]) => [id, obj(m, `${what}: meters.${id}`)])) : {};
  return {
    steps, checkpoints: checkpointsOf(reply['checkpoints'], `${what}: checkpoints`), traps: arr(reply['traps'] ?? [], `${what}: traps`).map((t, i) => obj(t, `${what}: traps[${i}]`)),
    restores, meters, saves: arr(reply['saves'] ?? [], `${what}: saves`).map((s, i) => obj(s, `${what}: saves[${i}]`)), raw: reply,
  };
}
/** An array of a step record (`<item>.<name>`) as numbers. */
export const arrayOf = (s: LogicStep, path: string, what: string): number[] => ints(s.arrays[path], `${what}: step ${s.step}'s ${path}`);
/** The first step from which two runs' records of `item` (step hash and every array) part, or null. */
export function firstStepDiff(a: LogicStep[], b: LogicStep[], item: string): number | null {
  const theirs = new Map(b.map((s) => [s.step, s]));
  for (const s of a) {
    const t = theirs.get(s.step);
    if (!t) return s.step;
    if ((s.items[item]?.hash ?? null) !== (t.items[item]?.hash ?? null) || (s.items[item]?.failed ?? false) !== (t.items[item]?.failed ?? false)) return s.step;
    const mine = Object.entries(s.arrays).filter(([k]) => k.startsWith(`${item}.`)).sort();
    const other = Object.entries(t.arrays).filter(([k]) => k.startsWith(`${item}.`)).sort();
    if (JSON.stringify(mine) !== JSON.stringify(other)) return s.step;
  }
  return null;
}
/** The first checkpoint of `item` whose full-state hash differs between two runs, or null. */
export function firstCheckpointDiff(a: Checkpoint[], b: Checkpoint[]): number | null {
  const theirs = new Map(b.map((c) => [c.step, c.deep_hash]));
  for (const c of a) if (theirs.get(c.step) !== c.deep_hash) return c.step;
  return null;
}

/** A logic.determinism reply: its verdict and its failures (#532's DetFailure, with #213's `region` and this suite's fields). */
export interface Det { verdict: string; failures: JsonObject[]; raw: JsonObject }
export function detOf(reply: JsonObject, what: string): Det {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.determinism`).toBe('logic.determinism');
  return { verdict: str(reply['verdict'], `${what}.verdict`), failures: arr(reply['failures'], `${what}.failures`).map((f, i) => obj(f, `${what}.failures[${i}]`)), raw: reply };
}
/** A logic.budget reply: its verdict, failures and report (#532's, #546's). */
export interface Budget { verdict: string; failures: JsonObject[]; report: JsonObject; raw: JsonObject }
export function budgetOf(reply: JsonObject, what: string): Budget {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.budget`).toBe('logic.budget');
  return { verdict: str(reply['verdict'], `${what}.verdict`), failures: arr(reply['failures'], `${what}.failures`).map((f, i) => obj(f, `${what}.failures[${i}]`)), report: obj(reply['report'], `${what}.report`), raw: reply };
}

// ---------------------------------------------------------------------------------------------------
// Headless Chrome: a page this test serves imports the logic module's web runner (`web_runner`'s source, the web
// player's logic runtime) and runs each request through its `bake` in Chrome's own WebAssembly engine (#532's way).

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>#211 web runner</title><script type="module">
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
/** Runs `requests` through the web runner `source` in headless Chrome; BLOCKED without Chrome. */
export async function inChrome(source: string, requests: JsonValue[], timeoutMs = 1_800_000): Promise<JsonObject[]> {
  if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the web player's logic runtime runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-211-chrome-'));
  let settle: (v: JsonObject) => void = () => {};
  const posted = new Promise<JsonObject>((res) => { settle = res; });
  const body = JSON.stringify(requests);
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/results') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => { chunks.push(c); });
      req.on('end', () => { res.end('ok'); const text = Buffer.concat(chunks).toString('utf8'); try { settle(JSON.parse(text) as JsonObject); } catch { settle({ error: `unreadable post: ${text.slice(0, 500)}` }); } });
      return;
    }
    const send = (type: string, text: string): void => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(text); };
    if (url === '/' || url === '/index.html') send('text/html', PAGE_HTML);
    else if (url === '/runner.mjs') send('text/javascript', source);
    else if (url === '/requests.json') send('application/json', body);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as AddressInfo).port;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([posted, new Promise<JsonObject>((res) => { timer = setTimeout(() => res({ error: `no reply from the page within ${timeoutMs} ms` }), timeoutMs); })]);
    if (typeof out['error'] === 'string') expect.fail(`headless Chrome: the web runner page failed: ${out['error']}`);
    return arr(out['replies'], 'the page\'s replies').map((r, i) => obj(r, `Chrome's reply ${i}`));
  } finally {
    if (timer) clearTimeout(timer);
    // Chrome and its helpers are this test's own process group (a detached child): stopped by its PID.
    if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
    await new Promise<void>((res) => server.close(() => res()));
    rmSync(profile, { recursive: true, force: true });
  }
}
/** A bake in the web player: `web_plan`'s request for the same bake, run by the web runner in headless Chrome. */
export async function webBake(p: JsonObject, steps: number, what: string): Promise<Bake> {
  const [plan, runner] = logic([webPlanCall(p, steps), WEB_RUNNER]);
  expect(plan?.['ok'], `${what}: web_plan gives the web runner's request (ok: true): ${show(plan)}`).toBe(true);
  const [reply] = await inChrome(str(runner?.['source'], 'web_runner.source'), [plan!['request']!]);
  return bakeOf(reply!, steps, `${what} (the web runner in headless Chrome)`);
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393's convention): one scenario line on stdin, one answer `{ok, replies}`.

export const SESSION = 'sess-211';
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB211D${String(n).padStart(18, '0')}`;
export function scenario(evidence: string, docs: string[], calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-211', name: 'Claude Code: world pages', process: { pid: 4211, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4211, ppid: 1, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(planted ? { planted } : {}),
    calls,
  };
}
export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(binOf('show'), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run takes the scenario; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** The evidence store (`<2 hex>/<62 hex>`), where a document's programs are found by SHA-256. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  const errors = arr(reply?.['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors.map((e) => show(e, 600)), `${what} raises no error at check`).toEqual([]);
  expect(reply?.['outcome'], `${what} is presented: ${show(reply, 2000)}`).toBe('presented');
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #211 acceptance tests.' };
/**
 * A 2D figure (#169's and #172's form) holding one logic item at 60 Hz, `id`, whose program goes into the evidence
 * store and the document's `assets`; `extra` its other sections (`packs`).
 */
export function figureDoc(evidence: string, o: { title: string; seed: number; id: string; program: Program; params: JsonObject; extra?: JsonObject }): JsonObject {
  const sha = putEvidence(evidence, o.program.bytes);
  const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
  return {
    format: 1, profile: 'figure', title: o.title, description: `${o.title}: a #211 acceptance fixture.`, size: [320, 180], camera: 'cam', seed: o.seed,
    transport: { span: '10s', frame_rate: [60, 1] }, requires: { modules: { logic: '^1' } }, ...(o.extra ?? {}),
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: order(0), params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
      back: { id: 'back', kind: 'rect@1', name: 'Backdrop', role: 'decoration', order: order(1), params: { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } }, at: { pos: [0, 0, 0] } },
      [o.id]: { id: o.id, kind: 'logic@1', name: o.id, order: order(2), params: { program: sha, step_rate: 60, ...o.params } },
    },
    assets: { [`${o.id}_program`]: { sha256: sha, license: LICENSE } },
  };
}
/** Writes a pack folder: `pack.json` with `assets` listed by sha256 and size, and the asset files (#192's form). */
export function writePack(root: string, manifest: JsonObject, assets: Record<string, Buffer>): { id: string; version: string; dir: string } {
  const name = str(manifest['name'], 'pack name');
  const version = str(manifest['version'], 'pack version');
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  const listed: JsonObject[] = [];
  for (const [path, bytes] of Object.entries(assets)) {
    writeFileSync(join(dir, path), bytes);
    listed.push({ path, sha256: sha256(bytes), size: bytes.length, license: 'MIT' });
  }
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ ...manifest, assets: listed }, null, 2)}\n`);
  return { id: `test/${name}`, version, dir };
}

// ---------------------------------------------------------------------------------------------------
// Timing, judged by the perf lane's own rule (scripts/benchmark.mjs: judgeLimit on fingerprint()), imported, not copied.

export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[] }
export interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => Judged; validateBudgets: (c: unknown, b: unknown) => void }
export async function bench(): Promise<Bench> {
  return (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
}
export const load = (): number => loadavg()[0] ?? Number.NaN;
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
