// Test-side tools for the #1957 acceptance tests: `deep-show` built once with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #306's and #202's suites drive it; the pack
// fixtures of `fixtures/packs/`; the `packs` and `deep show` calls and the fields this suite reads from them (README:
// The surface under test). Nothing here stands in for the pack check, the pack graph, resolution or expansion: every
// result read here is the binary's. Helper code is copied from tests/acceptance/202 and 306, never imported across
// suites.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1957 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a pack name, a `name@version`, a code). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` of `r1`, built once per file.

/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** `cargo build --locked --bin deep-show --no-default-features --features r1` in the checkout, copied to `to`; '' or cargo's error. */
function buildTo(to: string): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'r1'];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(SHOW_NAME)), to);
  return '';
}

/** Builds the binary once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1957-bin-'));
    bin = join(dir, `${SHOW_NAME}-r1`);
    error = buildTo(bin);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} with features r1`).toBe('');
    return bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  expect(r.status, `${SHOW_NAME} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((v, i) => obj(v, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1957-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the process table, the panel, the documents, the packs.

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB1957D', 1) } as const;

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
/** acme/shelf@1.2.0: the recipe shelf.bookcase@2 (2 sides and a board per level, 3 levels by default). */
export const SHELF_12 = pack('acme/shelf', '1.2.0', 'shelf-1.2.0');
/** acme/shelf@1.3.0: shelf.bookcase@2 at its minor 1, which adds a `crown` step. */
export const SHELF_13 = pack('acme/shelf', '1.3.0', 'shelf-1.3.0');
/** acme/shelf@1.2.0 that also requires study@1.0.0. */
export const SHELF_12_CYCLIC = pack('acme/shelf', '1.2.0', 'shelf-1.2.0-cyclic');
/** acme/study@1.0.0, requires.packs [shelf@1.2.0]: the reading room study.room@1, whose step `shelves` names shelf.bookcase@2. */
export const STUDY_10 = pack('acme/study', '1.0.0', 'study-1.0.0');
/** acme/study@1.1.0, requires.packs [shelf@1.2.0]: the reading room with a step `light` that names lamp.desk@1. */
export const STUDY_11 = pack('acme/study', '1.1.0', 'study-1.1.0');
/** acme/lamp@1.0.0: the recipe lamp.desk@1. */
export const LAMP_10 = pack('acme/lamp', '1.0.0', 'lamp-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

export const ROOM = 'study.room@1';
export const BOOKCASE = 'shelf.bookcase@2';

/** A scenario with the process table and the panel; DOC.a on `main`; `packs` offered to the store in order before the first call. */
export function scenario(evidence: string, packs: readonly PackFixture[], calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: {},
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC.a]: { panel: 'main' } },
    packs: packs.map((p) => ({ id: p.id, dir: p.dir })),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents and calls

/** A board as your shell sends it, holding one reading room `r1`; `packs` names each pack version it lists. */
export function roomBoard(title: string, packs: readonly string[]): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #1957 acceptance suite.`, size: [640, 400],
    packs: [...packs],
    items: { r1: { id: 'r1', kind: ROOM, name: 'r1', order: 'a0', params: {}, at: { pos: [20, 20, 0] } } },
  };
}
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export const PACKS: JsonObject = { call: 'packs' };

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '', raw: o };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
export const outcome = (reply: JsonObject): string => String(reply['outcome']);

/** One recipe instance's expansion, as #306's `expansions` row gives it. */
export interface Expansion { kind: string; pack: string; derived: Record<string, JsonObject> }
export function expansionOf(reply: JsonObject, instance: string, what = 'the reply'): Expansion {
  const rows = arr(reply['expansions'] ?? [], `${what}: expansions`).map((v, i) => obj(v, `${what}: expansions[${i}]`)).filter((e) => e['instance'] === instance);
  expect(rows.length, `${what} has exactly one expansion of ${instance}; the reply: ${show(reply, 1500)}`).toBe(1);
  const o = rows[0]!;
  const derived = obj(o['derived'], `${what}: ${instance}'s derived`);
  return {
    kind: str(o['kind'], `${what}: ${instance}'s kind`), pack: str(o['pack'], `${what}: ${instance}'s pack`),
    derived: Object.fromEntries(Object.entries(derived).map(([id, it]) => [id, obj(it, `${what}: derived ${id}`)])),
  };
}
/** The IDs `<prefix>.<0..n-1>`. */
export const indexed = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}.${i}`);

/** One row of the `packs` reply. */
export interface PackRow { state: string; issues: Issue[]; raw: JsonObject }
export function packRow(reply: JsonObject, p: PackFixture): PackRow {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}: ${show(reply)}`).toBe(1);
  const o = rows[0]!;
  return { state: str(o['state'], `${packAt(p)}'s state`), issues: issues(o, `${packAt(p)}'s row`), raw: o };
}
/** Each pack the store must hold for a clause to mean what it says, installed. */
export function installed(reply: JsonObject, packs: readonly PackFixture[]): void {
  for (const p of packs) {
    const row = packRow(reply, p);
    expect(row.state, `${packAt(p)} installs: ${show(row.raw)}`).toBe('installed');
  }
}
