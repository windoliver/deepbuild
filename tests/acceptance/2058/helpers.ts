// Test-side tools for the #2058 acceptance tests: `deep-show` built once with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #1957's, #306's and #202's suites drive it; the
// fixture documents of `fixtures/documents/` and the fixture pack of `fixtures/packs/`, each stamped with a core read
// from the build; the `registry`, `packs` and `deep show` calls and the fields this suite reads from them (README: The
// surface under test). Nothing here stands in for the document check, the pack check or the load: every result read
// here is the binary's. Helper code is copied from tests/acceptance/1957, never imported across suites.

import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2058 is three levels down). */
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
export const show = (v: JsonValue | undefined, max = 3000): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a pack name, a range). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/**
 * Whether `text` holds the version `version` as a whole: not as the head or the tail of a longer one (0.0.1 is not
 * held by 0.0.10 or 10.0.1).
 */
export function holdsVersion(text: string, version: string): boolean {
  const literal = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9.])${literal}(?![0-9]|\\.[0-9])`).test(text);
}

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
    dir = mkdtempSync(join(tmpdir(), 'deep-2058-bin-'));
    bin = join(dir, `${SHOW_NAME}-r1`);
    error = buildTo(bin);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} with features r1`).toBe('');
    return bin;
  };
}

/** Fresh temporary folders (an evidence store root, a stamped pack), each deleted after the test that made it. */
export function useTemp(): (what: string) => string {
  let dirs: string[] = [];
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
  return (what) => {
    const dir = mkdtempSync(join(tmpdir(), `deep-2058-${what}-`));
    dirs.push(dir);
    return dir;
  };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 240_000, killSignal: 'SIGKILL' });
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

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the process table, the panel, the document.

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB2058D', 1);

/** A pack as the scenario's `packs` takes it: `{id: owner/name, dir}`. */
export interface PackAt { id: string; version: string; dir: string }

/** A scenario with the process table and the panel; DOC on `main`; `packs` offered to the store in order before the first call. */
export function scenario(evidence: string, packs: readonly PackAt[], calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: {},
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    packs: packs.map((p) => ({ id: p.id, dir: p.dir })),
    calls,
  };
}
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc: DOC, document, include: ['issues'] });
export const PACKS: JsonObject = { call: 'packs' };
const REGISTRY: JsonObject = { call: 'registry' };

// ---------------------------------------------------------------------------------------------------
// The build's own core, read from the build.

/** A core version `major.minor.patch`. */
export interface Core { text: string; above: string }

/**
 * The build's own core as its `registry` reply gives it (`core`: `core@<major>.<minor>.<patch>`), and the version one
 * patch above it: 0.0.0 and 0.0.1 today.
 */
export function coreOf(bin: string, evidence: string): Core {
  const [registry] = run(bin, scenario(evidence, [], [REGISTRY]));
  const core = str(registry!['core'], 'registry: core');
  const m = /^core@(\d+)\.(\d+)\.(\d+)$/.exec(core);
  expect(m !== null, `the build's core is core@<major>.<minor>.<patch>, got ${JSON.stringify(core)}`).toBe(true);
  const [major, minor, patch] = [Number(m![1]), Number(m![2]), Number(m![3])];
  return { text: `${major}.${minor}.${patch}`, above: `${major}.${minor}.${patch + 1}` };
}

// ---------------------------------------------------------------------------------------------------
// Fixtures, stamped with a core read from the build.

function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as JsonValue, `fixtures/${path}`);
}
/** `fixtures/documents/board.json` with its `requires.core` set to `core`, or left out when `core` is null. */
export function boardRequiring(core: string | null): JsonObject {
  const doc = fixture('documents/board.json');
  const requires = { ...obj(doc['requires'], 'board.json: requires') };
  if (core === null) delete requires['core'];
  else requires['core'] = core;
  return { ...doc, requires };
}
/** The fixture pack's ID, version and name, as its `pack.json` and the document that lists it spell them. */
export const AHEAD = { id: 'acme/ahead', version: '1.0.0', name: 'ahead' } as const;
/** `fixtures/packs/ahead-1.0.0` copied to `dir` with its `requires.core` set to `range`. */
export function aheadRequiring(range: string, dir: string): PackAt {
  const to = join(dir, 'ahead-1.0.0');
  cpSync(join(FIXTURES, 'packs', 'ahead-1.0.0'), to, { recursive: true });
  const manifest = fixture('packs/ahead-1.0.0/pack.json');
  expect([manifest['name'], manifest['version']], 'the fixture pack is ahead@1.0.0').toEqual([AHEAD.name, AHEAD.version]);
  manifest['requires'] = { ...obj(manifest['requires'], 'pack.json: requires'), core: range };
  writeFileSync(join(to, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { id: AHEAD.id, version: AHEAD.version, dir: to };
}
/** `fixtures/documents/lists-pack.json`, which lists acme/ahead@1.0.0 and holds one tile of it. */
export function boardListingAhead(): JsonObject {
  const doc = fixture('documents/lists-pack.json');
  expect(doc['packs'], 'lists-pack.json lists the fixture pack').toEqual([`${AHEAD.id}@${AHEAD.version}`]);
  return doc;
}

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; path: string; what: string; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: str(o['code'], `${what}: issues[${i}].code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '',
      path: typeof o['path'] === 'string' ? o['path'] : '', what: typeof o['what'] === 'string' ? o['what'] : '', raw: o,
    };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
/** What a `deep show` reply says of the document check: its outcome and its error issues. */
export function checked(reply: JsonObject): { outcome: string; errors: JsonObject[] } {
  return { outcome: String(reply['outcome']), errors: errors(issues(reply)).map((i) => i.raw) };
}
/** A document that checks clean: presented, with no error issue. */
export const CLEAN = { outcome: 'presented', errors: [] as JsonObject[] };

/** One row of the `packs` reply. */
export interface PackRow { state: string; issues: Issue[]; raw: JsonObject }
export function packRow(reply: JsonObject, p: PackAt): PackRow {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has one row for ${p.id}@${p.version}: ${show(reply)}`).toBe(1);
  const o = rows[0]!;
  return { state: str(o['state'], `${p.id}@${p.version}'s state`), issues: issues(o, `${p.id}@${p.version}'s row`), raw: o };
}
