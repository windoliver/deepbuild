// Test-side tools for the #276 match acceptance test (README: The surface under test), cut down from the #189 carry
// suite's helpers (builds, the assembler, `deep-logic`, record files) and #549's (`deep-show run`'s world and its
// clock, a copy's report); nothing is imported from another suite. Nothing here stands in for the logic module, the
// net module or a store: every hash, entry, record and report a test reads is the implementation's own, and every
// expected value comes from the issue, the design and fixtures.ts.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/276/match is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH); ~/.cargo/bin elsewhere. */
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every `it` passes this: a first build of deep-show takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;

/** The criterion's ID: `#276.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC4 = 'AC4 #276.fc1389e0';

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
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: the criterion's own judge fails it, and some failure matches `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the criterion's judge fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure matches ${named}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: cargo with the pinned toolchain's environment, this folder's assembler, deep-logic and deep-show.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const binsDir = mkdtempSync(join(tmpdir(), 'deep-276-match-bins-'));
afterAll(() => { rmSync(binsDir, { recursive: true, force: true }); }, TIMEOUT);
const built = new Map<string, { bin: string; error: string }>();
/** A binary built once per file and copied out of the target folder; a test that uses a build that failed fails with
 * cargo's error, and one where cargo can't run is BLOCKED, never a pass. */
function binary(name: string, args: string[], cwd: string, from: string, env: NodeJS.ProcessEnv = {}): string {
  let b = built.get(name);
  if (!b) {
    const bin = join(binsDir, name);
    const error = cargo(args, cwd, env);
    if (error === '') copyFileSync(from, bin);
    b = { bin, error };
    built.set(name, b);
  }
  if (b.error.startsWith('cargo could not run')) expect.fail(`BLOCKED: ${b.error}: this machine lacks the Rust toolchain; this is not a pass`);
  expect(b.error, `${name} builds on this host (cargo ${args.join(' ')})`).toBe('');
  return b.bin;
}
const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-276-match-wat');
const assemblerBin = (): string => binary('acceptance-276-match-wat', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR,
  join(WAT_TARGET, 'debug', 'acceptance-276-match-wat'), { CARGO_TARGET_DIR: WAT_TARGET });
/** `deep-logic`, the logic module's runner: the app's logic module, where a viewer's first session runs alone. */
const logicBin = (): string => binary('deep-logic', ['build', '--locked', '--bin', 'deep-logic'], REPO, join(TARGET, 'debug', 'deep-logic'));
/** `deep-show` with the full set, as #549's, #550's and #551's suites build it, for the match. Built on first use,
 * after the logic calls a test makes first, so a base without the logic module's surface fails before this long build. */
const showBin = (): string => binary('deep-show', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], REPO, join(TARGET, 'debug', 'deep-show'));

/** Fresh folders shared by a file's tests (saves folders, evidence stores), all deleted after the file. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-276-match-')); made.push(d); return d; };
}

/** Runs `make` once per file, the first time a test asks; a later test that asks gets the same result or error. */
export function once<T>(make: () => T): () => T {
  let done: { ok: true; v: T } | { ok: false; e: unknown } | null = null;
  return () => {
    if (!done) { try { done = { ok: true, v: make() }; } catch (e) { done = { ok: false, e }; } }
    if (!done.ok) throw done.e;
    return done.v;
  };
}

export interface Program { name: string; bytes: Buffer; sha: string }
const assembled = new Map<string, Program>();
/** WebAssembly text assembled into a Program by this folder's assembler, which validates it. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-276-match-wat-'));
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
// deep-logic (#531's JSON-lines protocol): one process per call list, one reply per line.

function logic(calls: JsonObject[], what: string): JsonObject[] {
  const r = spawnSync(logicBin(), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-logic exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call (stdout: ${stdout.slice(0, 600)})`).toBe(calls.length);
  return lines.map((l, i) => { let v: JsonValue; try { v = JSON.parse(l) as JsonValue; } catch { v = l; } return obj(v, `${what}: reply ${i}`); });
}

export interface Region { region: string; name: string; offset: number; size: number }
export interface Checked { program: string; hash: string; entries: Region[] }
/** `check` of a piece: each admitted item's program hashes and its region map (#531's reply). */
export function check(p: JsonObject, what: string): Record<string, Checked> {
  const [r] = logic([{ call: 'check', piece: p }], what);
  expect(r!['ok'], `${what} admits the piece (ok: true): ${show(r)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(r!['items'], `${what}.items`)).map(([id, v]) => {
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

/** `bake` (#531's call, with #534's `saves_dir`): one viewer's session of the piece in the app, alone, from step 0 to
 * `steps` − 1 on `track`, keeping what it writes in `saves_dir`. */
export function bake(p: JsonObject, steps: number, track: JsonObject[], savesDir: string, what: string): void {
  const [r] = logic([{ call: 'bake', piece: p, steps, track, saves_dir: savesDir }], what);
  expect(r!['ok'], `${what} bakes the piece (ok: true): ${show(r)}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Profile record files (README: Record files): `<saves_dir>/<sha256>.profile`, one JSON object with `arrays`.

export const RECORD_FILE = /^([0-9a-f]{64})\.profile$/;
export interface RecordFile { hash: string; arrays: Record<string, number[]>; whole: boolean }
/** Every profile record in a saves folder, by name, with its arrays and whether its bytes hash to its name. */
export function records(dir: string, what: string): RecordFile[] {
  return readdirSync(dir).sort().flatMap((f) => {
    const name = RECORD_FILE.exec(f);
    if (!name) return [];
    const bytes = readFileSync(join(dir, f));
    let v: JsonValue;
    try { v = JSON.parse(bytes.toString('utf8')) as JsonValue; } catch (e) { return expect.fail(`${what}: the record ${f} is one JSON object (README: Record files): ${String(e)}`); }
    const a = obj(obj(v, `${what}: the record ${f}`)['arrays'], `${what}: the record ${f}'s arrays`);
    const arrays = Object.fromEntries(Object.entries(a).map(([k, x]) => [k, arr(x, `${what}: ${f}: arrays.${k}`).map((n, i) => int(n, `${what}: ${f}: arrays.${k}[${i}]`))]));
    return [{ hash: name[1]!, arrays, whole: sha256(bytes) === name[1] }];
  });
}
/** A saves folder's files copied into another, so a second session starts from the same store. */
export function copyFolder(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) copyFileSync(join(from, f), join(to, f));
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393: one scenario line in, one answer line out), with #549's world and clock.

const FLICKS = 705_600_000;
const AGENT = { id: 'sess-276', thread: 'thread-276', name: 'Test agent: profiles in a match', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const PANEL = 'main';
/** The planted name (README: Planted twin), the scenario's own key, never an environment variable. */
export const PLANT = 'net_profile_from_own_store';

/** Keeps bytes in the scenario's evidence store under their SHA-256 (`<2 hex>/<62 hex>`), where an asset is read. */
function putEvidence(evidence: string, bytes: Uint8Array): void {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
}
/**
 * One `deep-show run`: the document shown from your shell and presented on panel `main` with no error issue, then
 * `more` calls, each on #549's virtual clock 50 ms after the last; their replies.
 */
export function withDoc(evidence: string, doc: JsonObject, programs: Program[], more: JsonObject[], what: string, planted?: string): JsonObject[] {
  for (const p of programs) putEvidence(evidence, p.bytes);
  const id = str(doc['id'], 'the document id');
  let t = Math.round(0.001 * FLICKS);
  const calls: JsonObject[] = [{ call: 'deep show', peer: YOU_PEER, doc: id, document: doc, include: ['issues'], at: t }];
  for (const c of more) { t += Math.round(0.05 * FLICKS); calls.push({ ...c, at: t }); }
  const sc: JsonObject = {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels: { [PANEL]: { rect: [0, 0, 640, 360] } }, docs: { [id]: { panel: PANEL } }, clock: { refresh_hz: 60, lead: 0, check: 0 },
    ...(planted ? { planted } : {}), calls,
  };
  const tag = planted ? `${what} (planted ${planted})` : what;
  const r = spawnSync(showBin(), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${tag}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${tag}: the answer`);
  expect(answer['ok'], `${tag}: deep-show run takes the scenario: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${tag}: replies`).map((v, i) => obj(v, `${tag}: replies[${i}]`));
  expect(replies.length, `${tag}: one reply per call`).toBe(calls.length);
  const shown = replies[0]!;
  const issues = Array.isArray(shown['issues']) ? shown['issues'].filter(isObject) : [];
  expect(shown['outcome'], `${tag}: the duel is presented: ${show(shown, 3000)}`).toBe('presented');
  expect(issues.filter((i) => i['severity'] === 'error').map((i) => show(i, 600)), `${tag}: the duel is presented with no error issue`).toEqual([]);
  return replies.slice(1);
}

// ---------------------------------------------------------------------------------------------------
// A copy's report in `match`'s `copies` (#549's, #550's and #551's fields; README: A copy's report)

export interface Copy {
  player: number;
  end: string | null;
  /** #550's net.desync once located, or null. */
  desync: JsonObject | null;
  /** The full-state hash at each hash interval it confirmed, by match step. */
  hashes: Map<number, string>;
  /** `record.confirmed`, `record.track`. */
  confirmed: number;
  track: JsonObject[];
  /** #551's `rolled_back`: every rollback, `from` the last step it had run, `to` the step it restored. */
  rolledBack: { from: number; to: number }[];
  /** #540's step rows: each step's arrays, `<item>.<array>` → values. */
  arrays: Map<number, JsonObject>;
}
export function copiesOf(reply: JsonObject | undefined, what: string): Copy[] {
  const m = obj(reply, what);
  expect(m['code'], `${what}: the match call answers, not refuses: ${show(m, 2500)}`).toBeUndefined();
  const copies = arr(m['copies'], `${what}: copies`).map((v, i) => {
    const c = obj(v, `${what}: copies[${i}]`);
    const w = `${what}: copies[${i}]`;
    const hashes = new Map(arr(c['hashes'], `${w}.hashes`).map((h, j) => {
      const x = obj(h, `${w}.hashes[${j}]`);
      return [int(x['step'], `${w}.hashes[${j}].step`), str(x['hash'], `${w}.hashes[${j}].hash`)] as const;
    }));
    const rec = obj(c['record'], `${w}.record`);
    const rolled = Array.isArray(c['rolled_back']) ? c['rolled_back'] : [];
    const arrays = new Map(arr(c['steps'], `${w}.steps (each step's row)`).map((s, j) => {
      const x = obj(s, `${w}.steps[${j}]`);
      return [int(x['step'], `${w}.steps[${j}].step`), obj(x['arrays'], `${w}.steps[${j}].arrays`)] as const;
    }));
    return {
      player: int(c['player'], `${w}.player`), end: typeof c['end'] === 'string' ? c['end'] : null, desync: isObject(c['desync']) ? c['desync'] : null,
      hashes, confirmed: int(rec['confirmed'], `${w}.record.confirmed`), track: arr(rec['track'], `${w}.record.track`).filter(isObject),
      rolledBack: rolled.filter(isObject).map((r, j) => ({ from: int(r['from'], `${w}.rolled_back[${j}].from`), to: int(r['to'], `${w}.rolled_back[${j}].to`) })), arrays,
    };
  }).sort((a, b) => a.player - b.player);
  expect(copies.map((c) => c.player), `${what}: one copy a player, 1 and 2`).toEqual([1, 2]);
  return copies;
}
/** The step a copy's net.desync names: #550's `first_step` (cause state), or `step` (cause entries). */
export const desyncStep = (d: JsonObject): number | null => (typeof d['first_step'] === 'number' ? d['first_step'] : typeof d['step'] === 'number' ? d['step'] : null);
