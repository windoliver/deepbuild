// Test-side tools for the #276 profile record acceptance tests (README: The surface under test), after #189's carry
// suite and #534's (their helpers copied and cut down; nothing is imported from another suite). They assemble this
// suite's WebAssembly programs with its own assembler (wat/), drive the logic module's runner `deep-logic` (the app)
// one process per session, read the records it keeps in a saves folder, and run a process under a file-size limit so
// a record's write is cut short. Nothing here stands in for the logic module: every value a test compares comes from
// `deep-logic` or a file it wrote, and every expected value from the issue's text and this suite's programs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/276/record is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH); ~/.cargo/bin elsewhere. */
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every `it` and every hook passes this: a first build of deep-logic takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;

/** Each criterion's ID: `#276.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #276.ead11f27',
  2: 'AC2 #276.298725e9',
  3: 'AC3 #276.87ed7e10',
  5: 'AC5 #276.0d49208e',
  6: 'AC6 #276.e0857b1c',
} as const;

/** The planted twins this suite names (README: Planted twins), each run as `deep-logic --planted <name>`. */
export type Planted = 'profile_replay_reads_store' | 'profile_bound_to_content' | 'check_reads_viewer_profile';

// ---------------------------------------------------------------------------------------------------
// JSON and the failure rules

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
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
export const DIGEST = /^[0-9a-f]{64}$/;
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own check fails on it, and one failure names every one of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the check fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => f.includes(n))), `${what}: a failure names ${named.map((n) => `"${n}"`).join(' and ')}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: cargo with the pinned toolchain's environment, this suite's assembler and deep-logic.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const binsDir = mkdtempSync(join(tmpdir(), 'deep-276-record-bins-'));
afterAll(() => { rmSync(binsDir, { recursive: true, force: true }); }, TIMEOUT);
const built = new Map<string, { bin: string; error: string }>();
/** A binary built once per file and copied out of the target folder; a test that uses a build that failed fails
 * with cargo's error. */
function binary(name: string, args: string[], cwd: string, from: string, env: NodeJS.ProcessEnv = {}): string {
  let b = built.get(name);
  if (!b) {
    const bin = join(binsDir, name);
    const error = cargo(args, cwd, env);
    if (error === '') copyFileSync(from, bin);
    b = { bin, error };
    built.set(name, b);
  }
  expect(b.error, `${name} builds on this host (cargo ${args.join(' ')})`).toBe('');
  return b.bin;
}
const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-276-record-wat');
const assemblerBin = (): string => binary('acceptance-276-record-wat', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR,
  join(WAT_TARGET, 'debug', 'acceptance-276-record-wat'), { CARGO_TARGET_DIR: WAT_TARGET });
/** `deep-logic`, the logic module's runner: the app (README: The surface under test). */
export const logicBin = (): string => binary('deep-logic', ['build', '--locked', '--bin', 'deep-logic'], REPO, join(TARGET, 'debug', 'deep-logic'));
/** The assembler and deep-logic before a file's tests (the slow part); each test reports its own build failure. */
export function prebuild(): void {
  beforeAll(() => { try { assemblerBin(); logicBin(); } catch { /* reported by the test */ } }, TIMEOUT);
}

/** Fresh folders for a test (the saves folders the app keeps a piece's records in), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-276-record-')); made.push(d); return d; };
}

export interface Program { name: string; bytes: Buffer; sha: string }
const assembled = new Map<string, Program>();
/** WebAssembly text assembled into a Program by this suite's assembler, which validates it. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-276-record-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const r = spawnSync(assemblerBin(), [dir, file], { encoding: 'utf8' });
    if (r.status !== 0) throw Error(`the assembler refused ${name}: ${(r.stderr ?? '').slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// deep-logic: JSON lines in, one reply per line, one process per call of `logic`: a session of the app, which is
// closed (the process exits) before the next one starts.

const plantedArgs = (planted?: Planted): string[] => (planted ? ['--planted', planted] : []);
const describeRun = (planted?: Planted): string => `deep-logic${planted ? ` --planted ${planted}` : ''}`;
/** Runs `calls` through one `deep-logic` process, which then exits; its replies, one per call. */
export function logic(calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const r = spawnSync(logicBin(), plantedArgs(planted), { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: ${describeRun(planted)} exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call (stdout: ${stdout.slice(0, 600)})`).toBe(calls.length);
  return lines.map((l, i) => { let v: JsonValue; try { v = JSON.parse(l) as JsonValue; } catch { v = l; } return obj(v, `${what}: reply ${i}`); });
}
export const one = (call: JsonObject, what: string, planted?: Planted): JsonObject => logic([call], what, planted)[0]!;

/** A run under a file-size limit of one block (`ulimit -f 1`: 512 or 1,024 bytes as the shell counts; core files
 * off): any write of a regular file past it is cut short there, and the kernel stops the process (SIGXFSZ) or the
 * write fails. Its replies up to then, and how it ended. */
export interface Limited { replies: JsonObject[]; status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
export function limited(calls: JsonObject[]): Limited {
  const r = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; ulimit -f 1 && exec "$0"', logicBin()], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  const replies = stdout.split('\n').filter((l) => l !== '').map((l) => { let v: JsonValue; try { v = JSON.parse(l) as JsonValue; } catch { v = l; } return isObject(v) ? v : { unparsed: l }; });
  return { replies, status: r.status, signal: r.signal, stdout, stderr: r.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// Pieces, region maps, steps

export interface Region { region: string; name: string; offset: number; size: number }
export interface Checked { program: string; hash: string; entries: Region[] }
/** `check` of a piece: each admitted item's program hashes and its region map (#531's reply). */
export function check(p: JsonObject, what: string): Record<string, Checked> {
  const r = one({ call: 'check', piece: p }, what);
  expect(r['ok'], `${what} admits the piece (ok: true): ${show(r)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(r['items'], `${what}.items`)).map(([id, v]) => {
    const o = obj(v, `${what}.items.${id}`);
    const entries = arr(obj(o['layout'], `${what}.items.${id}.layout`)['entries'], `${what}.items.${id}.layout.entries`).map((e, i) => {
      const x = obj(e, `${what}: region entry ${i}`);
      return { region: str(x['region'], 'region'), name: str(x['name'], 'name'), offset: int(x['offset'], 'offset'), size: int(x['size'], 'size') };
    });
    return [id, { program: str(o['program'], `${what}.items.${id}.program`), hash: str(o['hash'], `${what}.items.${id}.hash`), entries }];
  }));
}
/** A region entry of an item's region map. */
export function entry(c: Checked, region: 'reads' | 'writes', name: string): Region {
  const e = c.entries.find((x) => x.region === region && x.name === name);
  expect(e, `the region map has the ${region} entry ${name}: ${JSON.stringify(c.entries)}`).toBeTruthy();
  return e!;
}

/** One step's record: its arrays (`<item>.<name>` → values) and each item's step hash. */
export interface StepRecord { step: number; arrays: Record<string, JsonValue[]>; hashes: Record<string, string> }
export function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    const hashes = Object.fromEntries(Object.entries(obj(o['items'] ?? {}, `${what}[${i}].items`)).map(([id, x]) => [id, String(isObject(x) ? x['hash'] : x)]));
    return { step: int(o['step'], `${what}[${i}].step`), arrays, hashes };
  });
}

/** A profile record a run wrote (README: `profiles`). */
export interface ProfileWritten { item: string; step: number; hash: string; file: string }
export function profilesOf(v: JsonValue | undefined, what: string): ProfileWritten[] {
  return arr(v ?? [], what).map((c, i) => {
    const x = obj(c, `${what}[${i}]`);
    expect(x['ok'], `${what}[${i}] is a record written whole, not a failed write: ${show(x)}`).not.toBe(false);
    const hash = str(x['hash'], `${what}[${i}].hash`);
    expect(hash, `${what}[${i}].hash is a sha256`).toMatch(DIGEST);
    return { item: str(x['item'], `${what}[${i}].item`), step: int(x['step'], `${what}[${i}].step`), hash, file: str(x['file'], `${what}[${i}].file`) };
  });
}

/** What a start reopened (README: `open`'s `profile`). */
export interface ProfileOpened { record: string | null; damaged: string[]; notices: JsonObject[] }
export function profileOpened(r: JsonObject, what: string): ProfileOpened {
  expect(r['ok'], `${what} opens the piece (ok: true): ${show(r)}`).toBe(true);
  const p = obj(r['profile'], `${what}: the reply's profile (what the start reopened)`);
  const record = p['record'] ?? null;
  expect(record === null || (typeof record === 'string' && DIGEST.test(record)), `${what}: profile.record is a record's sha256 or null, got ${show(record)}`).toBe(true);
  return {
    record: record as string | null,
    damaged: arr(p['damaged'] ?? [], `${what}: profile.damaged`).map((d, i) => str(obj(d, `${what}: profile.damaged[${i}]`)['hash'], `${what}: profile.damaged[${i}].hash`)),
    notices: arr(p['notices'] ?? [], `${what}: profile.notices`).map((n, i) => obj(n, `${what}: profile.notices[${i}]`)),
  };
}

/** A session's `step` reply: its steps, its track, the records its steps wrote. */
export interface Stepped { steps: StepRecord[]; track: JsonObject[]; profiles: ProfileWritten[] }
export function stepped(r: JsonObject, what: string): Stepped {
  expect(r['ok'], `${what} runs the steps (ok: true): ${show(r)}`).toBe(true);
  return { steps: stepsOf(r['steps'], `${what}.steps`), track: arr(r['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)), profiles: profilesOf(r['profiles'], `${what}.profiles`) };
}

/** A bake's reply: its steps and the records it wrote. */
export interface Bake { steps: StepRecord[]; profiles: ProfileWritten[] }
export function bakeOf(r: JsonObject, what: string): Bake {
  expect(r['ok'], `${what} bakes the piece (ok: true): ${show(r)}`).toBe(true);
  return { steps: stepsOf(r['steps'], `${what}.steps`), profiles: profilesOf(r['profiles'], `${what}.profiles`) };
}

// ---------------------------------------------------------------------------------------------------
// Record files (README: Record files): `<saves_dir>/<sha256>.profile`.

export const RECORD_FILE = /^([0-9a-f]{64})\.profile$/;
/** The records a saves folder keeps: each `<sha256>.profile` file's name and bytes, by name. */
export function kept(dir: string): Record<string, Buffer> {
  return Object.fromEntries(readdirSync(dir).filter((f) => RECORD_FILE.test(f)).sort().map((f) => [f, readFileSync(join(dir, f))]));
}
/** A record a run wrote: its file is in the folder, named by its sha256, and reads back whole. */
export function wroteWhole(dir: string, w: ProfileWritten, what: string): Buffer {
  expect(basename(w.file), `${what}: the record's file is <sha256>.profile in the saves folder`).toBe(`${w.hash}.profile`);
  const bytes = readFileSync(join(dir, `${w.hash}.profile`));
  expect(sha256(bytes), `${what}: the record's file reads back whole (its bytes hash to its name)`).toBe(w.hash);
  return bytes;
}
