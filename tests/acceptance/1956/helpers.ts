// Test-side tools for the #1956 acceptance tests: `deep-show` built with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #306's, #202's and #393's suites drive it; the
// shelf pack fixtures of `fixtures/packs/` and their corpus records; the `packs`, `deep show`, `read` and `deep_show`
// patch calls and the fields this suite reads from them (README: The surface under test). Nothing here stands in for
// the pack check, the migrator, expansion or the store: every result read here is the binary's. The `...Failures`
// functions are the criteria's checks: each returns sentences naming what failed, so a test runs it on the right
// program (no failures) and on the criterion's planted program (a failure naming what the criterion says).
// Helper code is copied from tests/acceptance/202, never imported across suites.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1956 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');
const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a name, a code, a hash). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/**
 * The numbers written in a text, leaving out 64-hex hashes and digests, the digits of a version (`1.0.0`), of a kind's
 * major (`@1`) and of a name (`case1`), so "gives 5.0 m" reads the numbers a refusal states.
 */
export function numbersIn(t: string): number[] {
  const bare = t.replace(/[0-9a-f]{64}/g, '');
  return [...bare.matchAll(/(?<![\w.@])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w@]|\.\d)/g)].map((m) => Number(m[0]));
}

/** Two JSON values equal, numbers as numbers (160 and 160.0 alike, within 1e-9). */
export function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(a[k], b[k]));
  }
  return a === b;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` of `r1`, built once per file.

/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const FEATURES = ['r1'];

/** `cargo build --locked --bin deep-show --no-default-features --features r1` in the checkout, copied to `to`; '' or cargo's error. */
function buildTo(to: string): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', FEATURES.join(',')];
  const env = { ...process.env, ...CARGO_ENV };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  copyFileSync(join(targetOf(REPO, env), 'debug', exe(SHOW_NAME)), to);
  return '';
}

/** Builds `deep-show` of `r1` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBinary(): () => string {
  let dir = '';
  let built = { bin: '', error: '' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1956-bins-'));
    const bin = join(dir, `${SHOW_NAME}-r1`);
    built = { bin, error: buildTo(bin) };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(built.error, `the binary builds: ${SHOW_NAME} with features ${FEATURES.join(',')}`).toBe('');
    return built.bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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

/** A fresh evidence store root for each process a test runs, so no process sees another's store; all deleted after the test. */
export function useEvidence(): () => string {
  let root = '';
  let n = 0;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'deep-1956-')); n = 0; });
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
  return () => {
    const dir = join(root, `run-${++n}`);
    mkdirSync(dir);
    return dir;
  };
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the working agent's session, the process table, a panel, documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: bookcases', process: { pid: 4100, start: 1_000 } };
/** The writer the working agent's connection proves: a layer's `writer` holds it. */
export const ALPHA_WRITER = `agent:${ALPHA.thread}`;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB1956D', 1), b: ulid('01JB1956D', 2) } as const;

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string; folder: string }
const pack = (version: string, folder: string): PackFixture => ({ id: 'acme/shelf', version, dir: join(FIXTURES, 'packs', folder), folder });
/** acme/shelf@1.0.0: shelf.bookcase@1 {width 0.5–3.0, levels 1–8}, no migration (README: Fixtures). */
export const V1 = pack('1.0.0', 'shelf-1.0.0');
/** acme/shelf@2.0.0: shelf.bookcase@2, the @1-to-@2 step renaming levels to shelves and setting depth = old.width * 0.25. */
export const V2 = pack('2.0.0', 'shelf-2.0.0');
/** Planted: the @1-to-@2 step sets depth = old.width * 2.5. */
export const V2_DEPTH_25 = pack('2.0.0', 'shelf-2.0.0-depth-25');
/** Planted: the @1-to-@2 step sets depth with `lerp`, which the closed function list lacks. */
export const V2_LERP = pack('2.0.0', 'shelf-2.0.0-lerp');
/** Planted: the @1-to-@2 step sets depth from old.height, which @1 doesn't declare. */
export const V2_HEIGHT = pack('2.0.0', 'shelf-2.0.0-height');
/** Planted: the @1-to-@2 step with three faults, width by lerp, shelves from old.height and depth = old.width * 2.5. */
export const V2_THREE_FAULTS = pack('2.0.0', 'shelf-2.0.0-three-faults');
/** acme/shelf@3.0.0: shelf.bookcase@3 keeping the @1-to-@2 step and adding @2-to-@3 (height = old.shelves * 0.4). */
export const V3 = pack('3.0.0', 'shelf-3.0.0');
/** acme/shelf@3.0.0 shipping only the @2-to-@3 step. */
export const V3_DROP = pack('3.0.0', 'shelf-3.0.0-drop');
const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;
export const at = (p: PackFixture): string => `${packAt(p)} (fixtures/packs/${p.folder})`;

export const ITEM = 'case1';
export const KIND = (major: number): string => `shelf.bookcase@${major}`;

const manifestOf = (p: PackFixture): JsonObject => obj(readJson(join(p.dir, 'pack.json')), `${at(p)}: pack.json`);

/**
 * A corpus record of a pack (README: The surface under test): `corpus[major][0]`, an asset holding `{document, values}`,
 * the document as the release of that major saved it and the values it recorded for its expansion.
 */
export interface CorpusRecord { sha: string; document: JsonObject; values: JsonObject }
export function corpusRecord(p: PackFixture, major: number): CorpusRecord {
  const m = manifestOf(p);
  const sha = str(arr(obj(m['corpus'], `${at(p)}: corpus`)[String(major)], `${at(p)}: corpus.${major}`)[0], `${at(p)}: corpus.${major}[0]`);
  const asset = arr(m['assets'], `${at(p)}: assets`).map((a, i) => obj(a, `${at(p)}: assets[${i}]`)).find((a) => a['sha256'] === sha);
  expect(asset, `${at(p)} lists its corpus document ${sha} among its assets`).toBeDefined();
  const record = obj(readJson(join(p.dir, str(asset!['path'], `${at(p)}: the corpus asset's path`))), `${at(p)}: corpus record ${sha}`);
  return { sha, document: obj(record['document'], 'the corpus record\'s document'), values: obj(record['values'], 'the corpus record\'s values') };
}
/** A document with its `packs` entry naming `p`, as the patch that takes that pack version writes it. */
export const pinned = (document: JsonObject, p: PackFixture): JsonObject => ({ ...document, packs: [packAt(p)] });

/** A scenario with the working agent's session, the process table and a panel; DOC.a on it, DOC.b too, seeded as `seed` when given. */
export function scenario(evidence: string, calls: JsonObject[], extra: { packs: readonly PackFixture[]; planted?: string; seed?: JsonObject }): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main', ...(extra.seed ? { document: extra.seed } : {}) } },
    packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls

export const PACKS: JsonObject = { call: 'packs' };
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** `read`: the revision shown, with the stored document. */
export const readDoc = (doc: string): JsonObject => ({ call: 'read', doc });
/** The working agent's patch on a shared document: one rect added beside what is there. */
export const alphaAddsBox = (doc: string, base: number): JsonObject => ({
  call: 'deep_show', session: ALPHA.id, doc, patch: {
    patch: ulid('01JB1956P', base + 1), doc, base, reason: 'adds a label box beside the bookcase',
    ops: [{ op: 'create', item: { id: '~1', kind: 'rect@1', name: 'Label box', order: 'a5', params: { box: [240, 0, 40, 20] } } }],
  },
});

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; path: string; fix: string; raw: JsonObject }
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return {
    code: str(o['code'], `${what}.code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '',
    path: typeof o['path'] === 'string' ? o['path'] : '', fix: typeof o['fix'] === 'string' ? o['fix'] : '', raw: o,
  };
}
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');

/** The `migrated` notices of a reply that name `item`: `{from, to}` each, as the core's notice carries them. */
export function migratedOf(reply: JsonObject, item: string): { from: number; to: number; raw: JsonObject }[] {
  return arr(reply['notices'] ?? [], 'the reply: notices').map((n, i) => obj(n, `notices[${i}]`))
    .filter((n) => n['code'] === 'migrated' && Array.isArray(n['ids']) && n['ids'].includes(item))
    .map((n) => ({ from: Number(n['from']), to: Number(n['to']), raw: n }));
}

/** One recipe instance's expansion, as #306's `expansions` row gives it. */
export interface Expansion { kind: string; derived: JsonObject }
export function expansionOf(reply: JsonObject, instance: string, what = 'the reply'): Expansion {
  const rows = arr(reply['expansions'] ?? [], `${what}: expansions`).map((v, i) => obj(v, `${what}: expansions[${i}]`)).filter((e) => e['instance'] === instance);
  expect(rows.length, `${what} has exactly one expansion of ${instance}; the reply: ${show(reply, 1500)}`).toBe(1);
  return { kind: str(rows[0]!['kind'], `${what}: ${instance}'s kind`), derived: obj(rows[0]!['derived'], `${what}: ${instance}'s derived`) };
}

/**
 * The values an expansion gives against those a corpus record holds: each recorded derived item by ID, its `kind`,
 * `params` and `at` equal (numbers as numbers), and no derived item the record lacks. Each failure names the item and
 * the field.
 */
export function valuesFailures(derived: JsonObject, recorded: JsonObject): string[] {
  const failures: string[] = [];
  for (const [id, want] of Object.entries(recorded)) {
    const got = derived[id];
    if (!isObject(got)) {
      failures.push(`${id} is recorded and the expansion doesn't write it`);
      continue;
    }
    for (const field of ['kind', 'params', 'at']) {
      const w = obj(want, `the recorded ${id}`)[field];
      if (!sameJson(got[field], w)) failures.push(`${id}.${field} is ${show(got[field], 300)}, recorded ${show(w, 300)}`);
    }
  }
  for (const id of Object.keys(derived)) if (!(id in recorded)) failures.push(`the expansion writes ${id}, which the record doesn't hold`);
  return failures;
}

/** One row of the `packs` reply. */
export interface PackRow { state: string; issues: Issue[] }
export function packRow(reply: JsonObject, p: PackFixture): PackRow {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}: ${show(reply)}`).toBe(1);
  const o = rows[0]!;
  return { state: str(o['state'], `${packAt(p)}'s row: state`), issues: issues(o, `${packAt(p)}'s row`) };
}

/**
 * The base's refusals of whole fields, which no criterion credits: `unknown_field` at the path `corpus`, and the
 * `kinds/<kind>/migrate` refusal of any migration or major past 1, whose `actual` is `{kind, field: "migrate"}`.
 */
const baseRefusal = (i: Issue): boolean =>
  (i.code === 'unknown_field' && i.path === 'corpus')
  || (/^kinds\/[^/]+\/migrate$/.test(i.path) && isObject(i.raw['actual']) && i.raw['actual']['field'] === 'migrate' && Object.keys(i.raw['actual']).length === 2);
/** A refused row's errors, less the base's refusals of whole fields. */
export const ownErrors = (row: PackRow): Issue[] => errors(row.issues).filter((i) => !baseRefusal(i));

/** A field of an issue, at its top level or in its `actual`. */
export const field = (i: Issue, key: string): JsonValue | undefined => i.raw[key] ?? (isObject(i.raw['actual']) ? i.raw['actual'][key] : undefined);
/** Whether an issue is about the migration's `param`: at its own `set` entry's path, or naming it as `param` or `field`. */
const about = (i: Issue, param: string): boolean => i.path.endsWith(`/set/${param}`) || field(i, 'param') === param || field(i, 'field') === param;

/** A failing param as a refusal must name it: the param, and a test of its reason on the issue about it. */
export interface Fault { param: string; reason: string; holds: (i: Issue) => boolean }
/**
 * Criteria 2 and 4: the pack `p` is refused, and for each fault an error about its param (README: Replies read) holds
 * its reason. Each failure names the param it misses.
 */
export function faultFailures(row: PackRow, p: PackFixture, faults: readonly Fault[]): string[] {
  if (row.state !== 'refused') return [`${at(p)} was ${row.state} at its pack check, not refused naming ${faults.map((f) => f.param).join(', ')}`];
  const own = ownErrors(row);
  return faults
    .filter((f) => !own.some((i) => about(i, f.param) && f.holds(i)))
    .map((f) => `${at(p)}'s refusal names no ${f.param} with its reason (${f.reason}): ${show(own.map((i) => i.raw), 2500)}`);
}
