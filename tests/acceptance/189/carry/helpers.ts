// Test-side tools for the #189 carry acceptance tests (README: The surface under test), after #534's and #1041's
// suites (their helpers copied and cut down; nothing is imported from another suite). They assemble this suite's
// WebAssembly programs with its own assembler (wat/), drive the logic module's runner `deep-logic` (the app), read
// the carry records it keeps, drive `deep-show run` for the web export and the app's replay of a document, serve a
// folder over HTTP from a child process, and drive Google Chrome, headless with WebGPU on, over its DevTools protocol
// by this file alone. Nothing here stands in for the logic module, the export, the bundle or the player: every value
// a test compares comes from them, the browser or a file the player exported, and every expected value from the
// issue's text, the design and this suite's programs.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/189/carry is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH); ~/.cargo/bin elsewhere. */
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every `it` and every hook passes this: a first build of deep-show takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;

/** Each criterion's ID: `#189.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  7: 'AC7 #189.316a5672',
  9: 'AC9 #189.ddd81069',
} as const;

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
export const HASH16 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own check fails on it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the check fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names "${named}"; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** A platform need is missing here: never a pass (AGENTS.md: the four invariants). */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: cargo with the pinned toolchain's environment, this suite's assembler, deep-logic and deep-show.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const binsDir = mkdtempSync(join(tmpdir(), 'deep-189-carry-bins-'));
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
const WAT_TARGET = join(TARGET, 'acceptance-189-carry-wat');
const assemblerBin = (): string => binary('acceptance-189-carry-wat', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR,
  join(WAT_TARGET, 'debug', 'acceptance-189-carry-wat'), { CARGO_TARGET_DIR: WAT_TARGET });
/** `deep-logic`, the logic module's runner: the app (README: deep-logic). */
export const logicBin = (): string => binary('deep-logic', ['build', '--locked', '--bin', 'deep-logic'], REPO, join(TARGET, 'debug', 'deep-logic'));
/** `deep-show` with the full set, as #172's and #1041's suites build it, for the web export. Built on first use, after
 * the logic calls a test makes first, so a base without the logic module's surface fails before this long build. */
export const showBin = (): string => binary('deep-show', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], REPO, join(TARGET, 'debug', 'deep-show'));
/** The assembler and deep-logic before a file's tests (the slow part); each test reports its own build failure. */
export function prebuild(): void {
  beforeAll(() => { try { assemblerBin(); logicBin(); } catch { /* reported by the test */ } }, TIMEOUT);
}

/** Fresh folders for a test (saves folders, evidence stores, bundles, exported files), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-189-carry-')); made.push(d); return d; };
}

export interface Program { name: string; bytes: Buffer; sha: string }
const assembled = new Map<string, Program>();
/** WebAssembly text assembled into a Program by this suite's assembler, which validates it. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-189-carry-wat-'));
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
// deep-logic (README: deep-logic): JSON lines in, one reply per line, one process per `run`.

/** Runs `calls` through one `deep-logic` process, which then exits: one session of the app. */
export function logic(calls: JsonObject[], what: string): JsonObject[] {
  const r = spawnSync(logicBin(), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-logic exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call (stdout: ${stdout.slice(0, 600)})`).toBe(calls.length);
  return lines.map((l, i) => { let v: JsonValue; try { v = JSON.parse(l) as JsonValue; } catch { v = l; } return obj(v, `${what}: reply ${i}`); });
}
export const one = (call: JsonObject, what: string): JsonObject => logic([call], what)[0]!;

export type Writes = Record<string, { type: 'i32'; count?: number }>;
export interface ItemSpec { program: Program; writes: Writes; checkpoint?: { every: number }; more?: JsonObject }
/** A piece as `deep-logic` takes it: the document's seed, its items and the programs they name, by sha256. */
export function piece(seed: number, items: Record<string, ItemSpec>): JsonObject {
  const assets: JsonObject = {};
  const out: JsonObject = {};
  for (const [id, spec] of Object.entries(items)) {
    assets[spec.program.sha] = spec.program.bytes.toString('base64');
    out[id] = { kind: 'logic@1', params: { program: spec.program.sha, writes: spec.writes as unknown as JsonObject, ...(spec.checkpoint ? { checkpoint: spec.checkpoint } : {}), ...(spec.more ?? {}) } };
  }
  return { seed, items: out, assets };
}

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

export interface StepRecord { step: number; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
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
    const deep = str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`);
    expect(deep, `${what}.${id}[${i}].deep_hash is a full-state hash, 16 hex digits`).toMatch(HASH16);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: deep };
  })]));
}

/** A carry record a bake wrote (README: `carries`). */
export interface CarryWritten { item: string; step: number; hash: string; file: string }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; carries: CarryWritten[] }
/** `bake` (#531's call, with #534's `saves_dir`): the piece from step 0 to `steps` − 1 on `track`. */
export function bake(p: JsonObject, steps: number, what: string, o: { saves_dir?: string; track?: JsonValue[] } = {}): Bake {
  const r = one({ call: 'bake', piece: p, steps, track: o.track ?? [], ...(o.saves_dir ? { saves_dir: o.saves_dir } : {}) }, what);
  expect(r['ok'], `${what} bakes the piece (ok: true): ${show(r)}`).toBe(true);
  const carries = arr(r['carries'] ?? [], `${what}.carries`).map((c, i) => {
    const x = obj(c, `${what}.carries[${i}]`);
    const hash = str(x['hash'], `${what}.carries[${i}].hash`);
    expect(hash, `${what}.carries[${i}].hash is a sha256`).toMatch(DIGEST);
    return { item: str(x['item'], `${what}.carries[${i}].item`), step: int(x['step'], `${what}.carries[${i}].step`), hash, file: str(x['file'], `${what}.carries[${i}].file`) };
  });
  return { steps: stepsOf(r['steps'], `${what}.steps`), checkpoints: checkpointsOf(r['checkpoints'], `${what}.checkpoints`), carries };
}

/** `open_carry` (README): the viewer opens a record into the taking piece from the app. */
export interface CarryOpened { record: string; track: JsonObject[]; steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]> }
export function openCarryCall(p: JsonObject, saves_dir: string, record: string, steps: number): JsonObject {
  return { call: 'open_carry', piece: p, saves_dir, record, track: [], steps };
}
export function carryOpened(r: JsonObject, what: string): CarryOpened {
  expect(r['ok'], `${what} opens the record (ok: true): ${show(r)}`).toBe(true);
  return {
    record: str(r['record'], `${what}.record`), track: arr(r['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)),
    steps: stepsOf(r['steps'], `${what}.steps`), checkpoints: checkpointsOf(r['checkpoints'], `${what}.checkpoints`),
  };
}
/** A refused `open_carry`: `{ok: false, code: "carry_refused", record, differs: [...]}` (README). */
export interface CarryRefused { code: string; record: string | null; differs: JsonObject[] }
export function carryRefused(r: JsonObject, what: string): CarryRefused {
  expect(r['ok'], `${what} is refused (ok: false): ${show(r)}`).toBe(false);
  return { code: str(r['code'], `${what}.code`), record: typeof r['record'] === 'string' ? r['record'] : null, differs: arr(r['differs'] ?? [], `${what}.differs`).map((d, i) => obj(d, `${what}.differs[${i}]`)) };
}

// ---------------------------------------------------------------------------------------------------
// Record files (README: Record files): `<saves_dir>/<sha256>.carry`, one JSON object `{from, step, arrays}`.

export const RECORD_FILE = /^([0-9a-f]{64})\.carry$/;
export interface RecordFile { hash: string; bytes: Buffer; from: JsonObject; step: number; arrays: Record<string, number[]> }
/** A record file read whole: the hash its name gives, its bytes and its fields. */
export function readRecord(path: string, what: string): RecordFile {
  const name = RECORD_FILE.exec(basename(path));
  expect(name, `${what}: the record's file is named <sha256>.carry: ${basename(path)}`).toBeTruthy();
  const bytes = readFileSync(path);
  let v: JsonValue;
  try { v = JSON.parse(bytes.toString('utf8')) as JsonValue; } catch (e) { return expect.fail(`${what}: the record's bytes are one JSON object (README: Record files): ${String(e)}`); }
  const o = obj(v, `${what}: the record`);
  const arrays = Object.fromEntries(Object.entries(obj(o['arrays'], `${what}: the record's arrays`)).map(([k, x]) => [k, arr(x, `${what}: arrays.${k}`).map((n, i) => int(n, `${what}: arrays.${k}[${i}]`))]));
  return { hash: name![1]!, bytes, from: obj(o['from'], `${what}: the record's from`), step: int(o['step'], `${what}: the record's step`), arrays };
}
/** The record's bytes with one byte changed: the first digit of gold's value, so the copy is still a record of the
 * same shape, layout and step whose gold differs, and only its hash gives it away. */
export function oneByteChanged(bytes: Buffer, what: string): Buffer {
  const text = bytes.toString('utf8');
  const key = text.indexOf('"gold"', text.indexOf('"arrays"'));
  expect(key, `${what}: the record holds gold among its arrays`).toBeGreaterThan(0);
  const at = [...text.slice(key + 6)].findIndex((c) => c >= '0' && c <= '9') + key + 6;
  const d = Number(text[at]);
  const out = Buffer.from(bytes);
  out[Buffer.byteLength(text.slice(0, at))] = 0x30 + (d === 9 ? 8 : d + 1);
  const was = JSON.parse(text) as JsonObject;
  const now = JSON.parse(out.toString('utf8')) as JsonObject;
  const gold = (o: JsonObject): string => JSON.stringify(obj(o['arrays'], 'arrays')['gold'] ?? null);
  expect([gold(now) !== gold(was),JSON.stringify({ ...now, arrays: { ...obj(now['arrays'], 'arrays'), gold: null } }) === JSON.stringify({ ...was, arrays: { ...obj(was['arrays'], 'arrays'), gold: null } })],
    `${what}: the copy differs from the record in one byte of gold's value and nothing else`).toEqual([true, true]);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (one scenario line in, one answer line out, exit 0), as #172's and #1041's suites drive it.

export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(showBin(), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${what}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}
/** The scenario's world, as #1041's: an agent's session, the process table, one panel and the document on it;
 * `planted` is the scenario's own key for a wrong program (never an environment variable). */
const SESSION = { id: 'sess-189', thread: 'thread-189', name: 'Test agent: carry records in the web player', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
function scenario(evidence: string, doc: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: { ...SESSION.process } } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } }, ...(planted ? { planted } : {}), calls,
  };
}
/** Keeps bytes in the scenario's evidence store under their SHA-256 (`<2 hex>/<62 hex>`), where an asset is read. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** One document for deep-show: its ID, its JSON, and the programs it names, kept in the evidence store. */
export interface Doc { id: string; title: string; document: JsonObject; programs: Program[] }
/** One `deep-show run`: the document shown from your shell and presented, then `more` calls; their replies. */
export function withDoc(evidence: string, d: Doc, more: JsonObject[], what: string, planted?: string): JsonObject[] {
  for (const p of d.programs) putEvidence(evidence, p.bytes);
  const r = runShow(scenario(evidence, d.id, [{ call: 'deep show', peer: YOU_PEER, doc: d.id, document: d.document, include: ['issues'] }, ...more], planted), what);
  const shown = r[0]!;
  const notes = [...(Array.isArray(shown['notices']) ? shown['notices'] : []), ...(Array.isArray(shown['issues']) ? shown['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(shown['outcome'], `${what}: ${d.title} is presented: ${show(shown, 3000)}`).toBe('presented');
  return r.slice(1);
}
/** The web export (Export: web player) of `d` on an empty recorded track into `out`, the bundle's folder. */
export function exportDoc(evidence: string, d: Doc, out: string, planted?: string): void {
  const what = `${d.title} exported to the web${planted ? ` (planted ${planted})` : ''}`;
  const [r] = withDoc(evidence, d, [{ call: 'export', doc: d.id, out, video: { codec: 'web' }, track: [] }], what, planted);
  expect(r!['outcome'], `${what}: ${show(r, 3000)}`).toBe('exported');
  expect(existsSync(join(out, 'index.html')), `${what}: the bundle has its index page`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// A folder served over HTTP from a child process of its own, as #1041's: index pages with `no-cache`, every other
// file with a max-age of a year, WebAssembly as `application/wasm`.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path');
const [root] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png' };
const s = http.createServer((q, r) => {
  let rel = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]).replace(/^\\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', path.basename(file) === 'index.html' ? 'no-cache' : 'max-age=31536000');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

class Server {
  private child: ChildProcess | null = null;
  async start(root: string): Promise<string> {
    const child = spawn(process.execPath, ['-e', SERVER, root], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    return `http://127.0.0.1:${port}`;
  }
  /** Stops the listener this object started, by its PID. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
  }
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on, over its DevTools protocol in flat sessions, as #1041's. Chrome runs in a
// process group of its own and is stopped by that PID; its profile and its download folder are fresh folders.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];

type Params = Record<string, unknown>;
type Message = { id?: number; method?: string; params?: Params; result?: Params; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Params) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Params) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Params = {}, session = '', timeoutMs = 60_000): Promise<Params> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Params) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** The player's own controls, by the names the page shows (README: The player's own controls). */
export const OPEN_SAVE = 'Open save';
export const EXPORT_RECORD = 'Export record';
export const IMPORT_RECORD = 'Import record';
/** The kind of the notice an imported record's refusal shows (README: Notices). */
export const CARRY_REFUSED = 'carry_refused';
/** A notice the page shows: its kind (the value of `data-deep-notice`) and its text. */
export interface Notice { kind: string; text: string }
/** Page-side: every element of the document and of the open shadow roots under it; a control by its name. */
const FIND = `const all = (root, out = []) => { for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) all(e.shadowRoot, out); } return out; };
  const named = (e) => (e.getAttribute('aria-label') ?? (e.tagName === 'INPUT' ? e.value : e.textContent) ?? '').replace(/\\s+/g, ' ').trim();
  const control = (name) => all(document).find((e) => e.matches('button, [role="button"], input, label, a') && named(e) === name);`;

/** One page in the browser (a target in a flat session). */
export class Page {
  readonly errors: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, private readonly target: string, private readonly browser: Browser) {}
  /** A script's value in the page (its own JavaScript, as text), awaited; with `gesture`, as a user's. */
  async evaluate<T>(expression: string, timeoutMs = 60_000, gesture = false): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, this.session, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** The notices the page shows: every element marked `data-deep-notice`, in document order. */
  notices(): Promise<Notice[]> {
    return this.evaluate<Notice[]>(`(() => { ${FIND} return all(document).filter((e) => e.hasAttribute('data-deep-notice')).map((e) => ({ kind: e.getAttribute('data-deep-notice') || '', text: (e.textContent || '').trim() })); })()`);
  }
  /** `ready` within `ms`, or the test fails naming the notices; BLOCKED when the browser offers no WebGPU adapter. */
  async mustBeReady(what: string, ms = 300_000): Promise<void> {
    const until = Date.now() + ms;
    let s = { ready: false, player: false };
    while (Date.now() < until && !s.ready) {
      s = await this.evaluate<typeof s>(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true) }; })()`).catch(() => s);
      if (!s.ready) await sleep(100);
    }
    if (!s.ready) {
      const gpu = await this.evaluate<string>(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e: Error) => e.message);
      if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the pieces play live on WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    }
    const notices = s.ready ? [] : await this.notices().catch(() => []);
    expect(s.ready, `${what}: the player (<deep-player>) is ready within ${ms} ms; it shows ${s.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(notices)}, page errors ${JSON.stringify(this.errors.slice(0, 5))}`).toBe(true);
  }
  /** probe(), as JSON. */
  async probe(what: string): Promise<JsonObject> {
    return obj(await this.evaluate<JsonValue>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v ?? null)); })()`), `${what}: probe()`);
  }
  /** A click on the player's own control named `name`, as a user's gesture. */
  async click(name: string, what: string): Promise<void> {
    const r = await this.evaluate<string>(`(() => { ${FIND} const e = control(${JSON.stringify(name)}); if (!e) return 'the page shows no control named "' + ${JSON.stringify(name)} + '"'; if (e.disabled) return 'the control "' + ${JSON.stringify(name)} + '" is disabled'; e.click(); return ''; })()`, 60_000, true);
    expect(r, `${what}: a click on the player's own control "${name}"`).toBe('');
  }
  /** play() as a user's gesture, when the player is paused; pause(). */
  async play(): Promise<void> { await this.evaluate(`(() => { const p = document.querySelector('deep-player'); if (p.paused) p.play(); })()`, 60_000, true); }
  async pause(): Promise<void> { await this.evaluate(`(() => { document.querySelector('deep-player').pause(); })()`); }
  /** A click on `name`: the file the browser saves (a download), written into `dir` under the name it was given. */
  async exportFile(name: string, dir: string, what: string): Promise<string> {
    const before = this.browser.downloadCount();
    await this.click(name, what);
    const got = await this.browser.download(before, `${what}: "${name}"`);
    expect(got.bytes.length, `${what}: the file "${name}" gives holds something`).toBeGreaterThan(0);
    const file = join(dir, basename(got.name) || 'download');
    writeFileSync(file, got.bytes);
    return file;
  }
  /** A click on `name`, and `file` handed to the browser's file chooser it opens. */
  async importFile(name: string, file: string, what: string): Promise<void> {
    const opened = new Promise<Params | null>((done) => { const t = setTimeout(() => done(null), 30_000); this.cdp.on(this.session, 'Page.fileChooserOpened', (p) => { clearTimeout(t); done(p); }); });
    await this.click(name, what);
    const chooser = await opened;
    expect(chooser !== null, `${what}: "${name}" opens the browser's file chooser within 30 s`).toBe(true);
    const node = chooser!['backendNodeId'];
    expect(typeof node, `${what}: "${name}" takes its file from a file input's chooser (README: The player's own controls)`).toBe('number');
    await this.cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: node }, this.session);
  }
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}

/** One browser with one profile, a fresh folder. `useBrowsers` closes it after the test. */
export class Browser {
  private readonly downloads: { guid: string; name: string; state: string }[] = [];
  private closed = false;
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string, private readonly files: string) {}
  static async open(): Promise<Browser> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-189-carry-chrome-'));
    const files = mkdtempSync(join(tmpdir(), 'deep-189-carry-downloads-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const stopNow = (): Promise<void> => stop(chrome, [profile, files], 0);
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 180_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { await stopNow(); blocked(`${CHROME} opened no DevTools port within 180 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts, on a machine with room for it`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { await stopNow(); return blocked((e as Error).message); }
    try {
      const browser = new Browser(chrome, cdp, profile, files);
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: files, eventsEnabled: true });
      cdp.on('', 'Browser.downloadWillBegin', (p) => { browser.downloads.push({ guid: String(p['guid']), name: String(p['suggestedFilename'] ?? ''), state: 'inProgress' }); });
      cdp.on('', 'Browser.downloadProgress', (p) => { const d = browser.downloads.find((x) => x.guid === p['guid']); if (d) d.state = String(p['state']); });
      return browser;
    } catch (e) { cdp.close(); await stopNow(); throw e; }
  }
  /** Opens `url` in a new page of this profile, 1280 x 720 at device scale 1. */
  async page(url: string): Promise<Page> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const page = new Page(this.cdp, sessionId, targetId, this);
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => page.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
    await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => undefined);
    return page;
  }
  downloadCount(): number { return this.downloads.length; }
  /** The first download begun after `before` others, once saved whole: the name the page gave it and its bytes. */
  async download(before: number, what: string): Promise<{ name: string; bytes: Buffer }> {
    const until = Date.now() + 60_000;
    while (Date.now() < until && this.downloads[before]?.state !== 'completed' && this.downloads[before]?.state !== 'canceled') await sleep(100);
    const d = this.downloads[before];
    expect(d?.state, `${what} gives the browser a file to save within 60 s (a download, README: The player's own controls)`).toBe('completed');
    return { name: d!.name, bytes: readFileSync(join(this.files, d!.guid)) };
  }
  /** Closes the browser this object started and removes its folders; a second call does nothing. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    await stop(this.chrome, [this.profile, this.files], 5_000);
  }
}
function ended(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((done) => { const t = setTimeout(() => done(false), ms); child.once('exit', () => { clearTimeout(t); done(true); }); });
}
/** Stops the Chrome this file started and removes its folders. A Chrome still running after `grace` ms is stopped by
 * its own process group's PID; one that has ended is never signalled, so no other process can be. */
async function stop(chrome: ChildProcess, folders: string[], grace: number): Promise<void> {
  if (!(await ended(chrome, grace)) && chrome.pid) {
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
    await ended(chrome, 5_000);
  }
  for (const f of folders) rmSync(f, { recursive: true, force: true, maxRetries: 3 });
}

/** The servers and browsers a test opens, closed after it whether it passed or not. */
export function useBrowsers(): { serve: (root: string) => Promise<string>; browser: () => Promise<Browser> } {
  const servers: Server[] = [];
  const browsers: Browser[] = [];
  afterEach(async () => {
    for (const b of browsers.splice(0)) await b.close();
    for (const s of servers.splice(0)) await s.stop();
  }, TIMEOUT);
  return {
    serve: async (root) => { const s = new Server(); servers.push(s); return s.start(root); },
    browser: async () => { const b = await Browser.open(); browsers.push(b); return b; },
  };
}

// ---------------------------------------------------------------------------------------------------
// What the tests read of a page (README: probe())

/** The time a play of `steps` steps may take: its own length at 60 steps a second and two minutes more. */
export const playMs = (steps: number): number => Math.ceil(steps / 60) * 1000 + 120_000;
/** A page of `url`, ready, on WebGPU: the first thing every test asks of a page. */
export async function openPiece(browser: Browser, url: string, what: string): Promise<Page> {
  const page = await browser.page(url);
  await page.mustBeReady(what);
  const backend = str((await page.probe(`${what}, once ready`))['backend'], `${what}: probe().backend`);
  expect(/webgpu/i.test(backend), `${what}: the player runs on WebGPU: probe().backend is ${backend}`).toBe(true);
  return page;
}
/** probe().step. */
export const stepOf = (p: JsonObject, what: string): number => int(p['step'], `${what}: probe().step`);
/** probe().records (README): the carry records the origin's storage holds, `{hash, step}` read. */
export function recordsOf(p: JsonObject, what: string): { hash: string; step: number }[] {
  return arr(p['records'], `${what}: probe().records`).map((v, i) => {
    const r = obj(v, `${what}: probe().records[${i}]`);
    const hash = str(r['hash'], `${what}: probe().records[${i}].hash`);
    expect(hash, `${what}: probe().records[${i}].hash is a sha256`).toMatch(DIGEST);
    return { hash, step: int(r['step'], `${what}: probe().records[${i}].step`) };
  });
}
/** probe().values: a logic array of one element, `<logic ID>.<name>`, as its value (#172's probe). */
export const valuesOf = (p: JsonObject, what: string): JsonObject => obj(p['values'], `${what}: probe().values`);
/** probe().saves (#1041's): each slot's save the viewer's open would open, with `item`'s recorded full-state hash. */
export interface StoredSave { slot: number; step: number; hash: string }
export function savesOf(p: JsonObject, item: string, what: string): StoredSave[] {
  return arr(p['saves'], `${what}: probe().saves`).map((v, i) => {
    const s = obj(v, `${what}: probe().saves[${i}]`);
    const hash = str(obj(s['deep_hash'], `${what}: probe().saves[${i}].deep_hash`)[item], `${what}: probe().saves[${i}].deep_hash.${item}`);
    expect(hash, `${what}: probe().saves[${i}].deep_hash.${item} is a full-state hash`).toMatch(HASH16);
    return { slot: int(s['slot'], `${what}: probe().saves[${i}].slot`), step: int(s['step'], `${what}: probe().saves[${i}].step`), hash };
  });
}
/** `item`'s full-state hash at checkpoint `step` in a probe (probe().checkpoint_hashes), if it holds one. */
export function checkpointAt(p: JsonObject, item: string, step: number): string | undefined {
  const list = obj(p['checkpoint_hashes'], 'probe().checkpoint_hashes')[item];
  return Array.isArray(list) ? list.filter(isObject).find((c) => c['step'] === step)?.['hash'] as string | undefined : undefined;
}
/** Waits, at most `ms`, until `ok` holds of a probe; the last probe read. */
export async function until(page: Page, ok: (p: JsonObject) => boolean, ms: number, what: string): Promise<JsonObject> {
  const end = Date.now() + ms;
  let p = await page.probe(what);
  while (!ok(p) && Date.now() < end) { await sleep(100); p = await page.probe(what); }
  return p;
}
