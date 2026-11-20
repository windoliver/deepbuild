// Test-side tools for the #1962 acceptance tests: `deep-show` built with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #1956's, #1958's and #1960's suites drive it;
// the shelf and furniture pack fixtures of `fixtures/packs/` and the corpus records of acme/shelf@1.2.0; the `packs`,
// `deep show`, `read` and `deep_query` calls and the fields this suite reads from them (README: The surface under
// test). Nothing here stands in for the pack check, the loader, the migrator, expansion, the draw or the evaluator:
// every result read here is the binary's. The `...Failures` functions are the criteria's checks: each returns
// sentences naming what failed, so a test runs it on the right program (no failures) and on the criterion's planted
// program (a failure naming what the criterion says). Helper code is copied from tests/acceptance/1956, 1958 and 1960,
// never imported across suites.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1962 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');
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
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
/** The JSON at `keys` under `value`; undefined where a step reaches nothing. */
export function at(value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined {
  let cursor = value;
  for (const key of keys) {
    if (!isObject(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** Whether a sentence names an ID as a whole word (`b1`, or `b1.sides.0`, never inside `b10` or `ab1`). */
export const namesId = (sentence: string, id: string): boolean =>
  new RegExp(`(^|[^\\w.-])${id.replace(/[-.]/g, (c) => `\\${c}`)}(?![\\w-])`).test(sentence);

/** Two JSON values equal, numbers as numbers (within 1e-9). */
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1962-bins-'));
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
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'deep-1962-')); n = 0; });
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
  return () => {
    const dir = join(root, `run-${++n}`);
    mkdirSync(dir);
    return dir;
  };
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: writer A's session, the process table, a panel, documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Bookcases A', process: { pid: 4100, start: 1_000 } };
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
/** DOC.a and DOC.b take whole revisions from your shell; DOC.c and DOC.d are shared documents seeded as stored. */
export const DOC = { a: ulid('01JB1962D', 1), b: ulid('01JB1962D', 2), c: ulid('01JB1962D', 3), d: ulid('01JB1962D', 4) } as const;

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string; folder: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder), folder });
/** acme/shelf@1.2.0: the pack kind shelf.bookcase@2 {width, shelves, depth}; its corpus holds the room and the lift. */
export const SHELF_12 = pack('acme/shelf', '1.2.0', 'shelf-1.2.0');
/** acme/furniture@1.0.0: the pack kind furniture.case@1 {width, shelves, depth}, drawn as the bookcase is. */
export const FURNITURE_10 = pack('acme/furniture', '1.0.0', 'furniture-1.0.0');
/** acme/furniture@2.0.0: furniture.case@2 {width, tiers, depth}, its @1-to-@2 step renaming shelves to tiers. */
export const FURNITURE_20 = pack('acme/furniture', '2.0.0', 'furniture-2.0.0');
/** acme/furniture@3.0.0: furniture.cabinet@1, and `moved: {furniture.case@1: furniture/cabinet@1}`. */
export const FURNITURE_30 = pack('acme/furniture', '3.0.0', 'furniture-3.0.0');
/** acme/shelf@2.0.0: `moved: {shelf.bookcase@2: furniture/case@1}`, `requires.packs [furniture@1.0.0]` (criterion 1). */
export const SHELF_20 = pack('acme/shelf', '2.0.0', 'shelf-2.0.0');
/** Planted: `moved: {shelf.bookcase@2: furniture/case@1}` requiring furniture@3.0.0, which moved its case on. */
export const SHELF_20_CHAIN = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-chain');
/** Planted: `moved: {shelf.bookcase@2: shelf/bookcase@2}`, a move back to its own source. */
export const SHELF_20_LOOP = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-loop');
/** Planted: `moved: {shelf.bookcase@2: furniture/case@1}` with no `requires.packs`. */
export const SHELF_20_UNDECLARED = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-undeclared');
/** Planted: no shelf.bookcase, no `moved` entry and no `removed` entry. */
export const SHELF_20_DROPPED = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-dropped');
/** acme/shelf@2.0.0 with `removed: {shelf.bookcase@2: "superseded"}`. */
export const SHELF_20_REMOVED = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-removed');
/** acme/shelf@2.0.0: `moved: {shelf.bookcase@2: furniture/case@1}`, `requires.packs [furniture@2.0.0]` (criterion 4). */
export const SHELF_20_TIERS = pack('acme/shelf', '2.0.0', 'shelf-2.0.0-tiers');
export const named = (p: PackFixture): string => `${p.id}@${p.version}`;
export const where = (p: PackFixture): string => `${named(p)} (fixtures/packs/${p.folder})`;

/** The moved kind, as the issue names it, and the kind its items open as under each furniture version. */
export const OLD_KIND = 'shelf.bookcase@2';
export const CASE_1 = 'furniture.case@1';
export const CASE_2 = 'furniture.case@2';
/** The corpus room's three bookcases. */
export const BOOKCASES: readonly string[] = ['b1', 'b2', 'b3'];

export const manifestOf = (p: PackFixture): JsonObject => obj(readJson(join(p.dir, 'pack.json')), `${where(p)}: pack.json`);

/**
 * A corpus record of acme/shelf@1.2.0 (README: Fixtures): an asset its `corpus` lists, holding `{document, values}`,
 * the document as that release saved it and the values its expansion gave; the room's record also holds `snapshot`,
 * the lift's `sampled`.
 */
export interface CorpusRecord { sha: string; document: JsonObject; values: JsonObject; snapshot: JsonObject | undefined; sampled: JsonObject | undefined }
export function corpusRecords(p: PackFixture, major: number): CorpusRecord[] {
  const m = manifestOf(p);
  const assets = arr(m['assets'], `${where(p)}: assets`).map((a, i) => obj(a, `${where(p)}: assets[${i}]`));
  return arr(obj(m['corpus'], `${where(p)}: corpus`)[String(major)], `${where(p)}: corpus.${major}`).map((h, i) => {
    const sha = str(h, `${where(p)}: corpus.${major}[${i}]`);
    const asset = assets.find((a) => a['sha256'] === sha);
    expect(asset, `${where(p)} lists its corpus document ${sha} among its assets`).toBeDefined();
    const record = obj(readJson(join(p.dir, str(asset!['path'], `${where(p)}: the corpus asset's path`))), `${where(p)}: corpus record ${sha}`);
    const opt = (k: string): JsonObject | undefined => (isObject(record[k]) ? record[k] : undefined);
    return { sha, document: obj(record['document'], 'the corpus record\'s document'), values: obj(record['values'], 'the corpus record\'s values'), snapshot: opt('snapshot'), sampled: opt('sampled') };
  });
}

/** A document with its `packs` entry naming `p`, as the patch that takes that pack version writes it. */
export const pinned = (document: JsonObject, p: PackFixture): JsonObject => ({ ...document, packs: [named(p)] });
/**
 * A corpus document as a shared document stores it under `p` (README: Opening a corpus document): pinned to `p`, and
 * every item in one layer, `main`, writer A's, as the hub stamps a shown revision. Each item stays as it was saved.
 */
export function stored(document: JsonObject, p: PackFixture): JsonObject {
  const items = Object.entries(obj(document['items'], 'the corpus document\'s items')).map(([id, item]) => [id, { ...obj(item, id), layer: 'main' }]);
  return { ...pinned(document, p), layers: { main: { writer: `agent:${ALPHA.thread}`, title: 'Main', order: 'a0' } }, items: Object.fromEntries(items) as JsonObject };
}

/** A scenario with writer A's session, the process table and a panel; DOC.a–d on it, each of `seeds` seeded as stored; `packs` offered in order. */
export function scenario(evidence: string, calls: JsonObject[], w: { packs: readonly PackFixture[]; seeds?: Record<string, JsonObject>; planted?: string }): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: Object.fromEntries(Object.values(DOC).map((d) => [d, { panel: 'main', ...(w.seeds?.[d] ? { document: w.seeds[d] } : {}) }])),
    packs: w.packs.map((p) => ({ id: p.id, dir: p.dir })),
    ...(w.planted ? { planted: w.planted } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls

export const PACKS: JsonObject = { call: 'packs' };
/** A whole revision from your shell (`deep show`), with its issues and one snapshot of `snapshot.size` at `snapshot.t`. */
export const present = (doc: string, document: JsonObject, snapshot: JsonObject): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document, t: snapshot['t'] ?? null, size: snapshot['size'] ?? null, include: ['issues', 'pixels'] });
/** `read`: the revision shown, with its issues, `expansions`, `notices` and `opened`. */
export const readDoc = (doc: string): JsonObject => ({ call: 'read', doc });
/** `deep_query` from writer A's session: the evaluated value at each path at each time, and no rows. */
export const valuesAt = (doc: string, paths: readonly string[], times: readonly string[]): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, items: [], paths: [...paths], at: [...times] });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; path: string; ids: string[]; fix: string; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: str(o['code'], `${what}: issues[${i}].code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '',
      path: typeof o['path'] === 'string' ? o['path'] : '', ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [],
      fix: typeof o['fix'] === 'string' ? o['fix'] : '', raw: o,
    };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
/** A field of an issue, in its `actual` or at its top level. */
export const field = (i: Issue, key: string): JsonValue | undefined => (isObject(i.raw['actual']) ? i.raw['actual'][key] : undefined) ?? i.raw[key];
export const outcome = (reply: JsonObject): string => String(reply['outcome'] ?? null);

/** One `migrated` step for one item: the notice's `ids` each give one. */
export interface Step { id: string; raw: JsonObject }
/** Every `migrated` step a reply's `notices` raise, one per ID per notice. */
export function migratedSteps(reply: JsonObject): Step[] {
  return arr(reply['notices'] ?? [], 'the reply: notices').map((n, i) => obj(n, `notices[${i}]`))
    .filter((n) => n['code'] === 'migrated')
    .flatMap((n) => (Array.isArray(n['ids']) ? n['ids'] : []).map((id) => ({ id: String(id), raw: n })));
}

/** One recipe instance's expansion, as #306's `expansions` row gives it; undefined when the reply has none. */
export interface Expansion { kind: string; derived: JsonObject }
export function expansionOf(reply: JsonObject, instance: string): Expansion | undefined {
  const rows = (Array.isArray(reply['expansions']) ? reply['expansions'] : []).filter((e) => isObject(e) && e['instance'] === instance) as JsonObject[];
  if (rows.length !== 1) return undefined;
  return { kind: String(rows[0]!['kind']), derived: isObject(rows[0]!['derived']) ? rows[0]!['derived'] : {} };
}

/** The one snapshot's sha256, or '' when the reply carries none. */
export function shot(reply: JsonObject): string {
  const shots = Array.isArray(reply['snapshots']) ? reply['snapshots'] : [];
  return shots.length === 1 && isObject(shots[0]) && typeof shots[0]['sha256'] === 'string' ? shots[0]['sha256'] : '';
}

/** One row of the `packs` reply: its state and its error issues. */
export function packRow(reply: JsonObject, p: PackFixture): { state: string; errors: Issue[] } {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has one row for ${named(p)}: ${show(reply)}`).toBe(1);
  return { state: String(rows[0]!['state']), errors: errors(issues(rows[0]!, `${named(p)}'s row`)) };
}
/** A failure for each of `versions` the store didn't install, with what refused it. */
export function installFailures(reply: JsonObject, versions: readonly PackFixture[]): string[] {
  return versions.flatMap((p) => {
    const row = packRow(reply, p);
    return row.state === 'installed' ? [] : [`${where(p)} is ${row.state}, not installed: ${show(row.errors.map((i) => i.raw), 2500)}`];
  });
}

/** The evaluated values a `deep_query` reply gives for a path, one per time asked; [] when it gives none. */
export function valuesOf(reply: JsonObject, path: string): JsonValue[] {
  const list = at(reply['values'], path);
  return Array.isArray(list) ? list : [];
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks

/**
 * The values an instance's expansion gives against those its record holds: each recorded derived item of the instance
 * (`<id>.…`) by ID, its `kind`, `params` and `at` equal (numbers as numbers), and no derived item the record lacks.
 * Each failure names the derived item, so it names the instance.
 */
export function valuesFailures(id: string, derived: JsonObject, recorded: JsonObject): string[] {
  const failures: string[] = [];
  const mine = Object.entries(recorded).filter(([d]) => d.startsWith(`${id}.`));
  if (!mine.length) return [`the record holds no derived item of ${id}`];
  for (const [d, want] of mine) {
    const got = derived[d];
    if (!isObject(got)) {
      failures.push(`${d} is recorded and ${id}'s expansion doesn't write it`);
      continue;
    }
    for (const f of ['kind', 'params', 'at']) {
      const w = obj(want, `the recorded ${d}`)[f];
      if (!sameJson(got[f], w)) failures.push(`${d}.${f} is ${show(got[f], 300)}, recorded ${show(w, 300)}`);
    }
  }
  for (const d of Object.keys(derived)) if (!(d in recorded)) failures.push(`${id}'s expansion writes ${d}, which the record doesn't hold`);
  return failures;
}

/** The recorded snapshot of a corpus record: its time, its size and its sha256. */
export function snapshotOf(rec: CorpusRecord): { sha256: string; raw: JsonObject } {
  const s = obj(rec.snapshot, 'the room\'s recorded snapshot');
  str(s['t'], 'the recorded snapshot\'s time');
  arr(s['size'], 'the recorded snapshot\'s size');
  return { sha256: str(s['sha256'], 'the recorded snapshot\'s sha256'), raw: s };
}

/**
 * The room: acme/shelf@1.2.0's corpus document of major 2 that records a snapshot (README: Fixtures), checked against
 * criteria 1 and 3 first: its 3 bookcases and nothing else, each saved at shelf.bookcase@2, the document naming
 * acme/shelf@1.2.0, which saved it; values recorded for each bookcase; and the snapshot hash recorded for it.
 */
export function roomRecord(): CorpusRecord {
  const found = corpusRecords(SHELF_12, 2).filter((r) => r.snapshot !== undefined);
  expect(found.length, 'the fixture: acme/shelf@1.2.0\'s corpus of major 2 holds one document with a recorded snapshot, the room').toBe(1);
  const rec = found[0]!;
  const items = obj(rec.document['items'], 'the room\'s items');
  expect(Object.keys(items).sort(), 'the fixture: the room holds its 3 bookcases and nothing else').toEqual([...BOOKCASES]);
  for (const id of BOOKCASES) {
    expect(at(items, id, 'kind'), `the fixture: ${id} is saved at ${OLD_KIND}`).toBe(OLD_KIND);
    expect(Object.keys(rec.values).some((d) => d.startsWith(`${id}.`)), `the fixture: the record holds values for ${id}'s derived items`).toBe(true);
  }
  expect(rec.document['packs'], 'the fixture: the room names acme/shelf@1.2.0, the release that saved it').toEqual([named(SHELF_12)]);
  snapshotOf(rec);
  return rec;
}

/**
 * What a whole revision of the room must give when it opens its bookcases as `kind`: presented with no error; each of
 * the 3 bookcases expanded as `kind` to exactly the values recorded for it and named by exactly `steps` `migrated`
 * notices; and one snapshot, the hash recorded for the room. Every failure about a bookcase names it.
 */
export function openedFailures(reply: JsonObject, rec: CorpusRecord, kind: string, steps: number, what: string): string[] {
  const failures: string[] = [];
  if (outcome(reply) !== 'presented') failures.push(`${what} is ${outcome(reply)}, not opened: ${show(reply['issues'] ?? null, 1200)}`);
  for (const i of errors(issues(reply, what))) failures.push(`${what} raises an error: ${show(i.raw, 600)}`);
  const raised = migratedSteps(reply);
  for (const id of BOOKCASES) {
    const e = expansionOf(reply, id);
    if (e?.kind !== kind) failures.push(`${id} opens as ${e ? e.kind : 'nothing (no expansion)'}, not ${kind}`);
    if (e) failures.push(...valuesFailures(id, e.derived, rec.values));
    else failures.push(`${id} expands to none of the values recorded for it`);
    const mine = raised.filter((s) => s.id === id);
    if (mine.length !== steps) failures.push(`${mine.length} migrated notices name ${id}, not ${steps}: ${show(mine.map((s) => s.raw), 600)}`);
  }
  const want = snapshotOf(rec).sha256;
  const got = shot(reply);
  if (got !== want) failures.push(`${what} draws to ${got || 'no snapshot'}, not the snapshot hash recorded for it, ${want}`);
  return failures;
}

/** Each refused `moved` entry's reason (README: Choices). */
export interface Refusal { p: PackFixture; reason: string; code: string }
/** The place of the one `moved` entry each planted version declares. */
export const ENTRY = `moved/${OLD_KIND}`;
/**
 * Criterion 2: the version `r.p` is refused at its pack check with an error at `moved/shelf.bookcase@2`, the entry's
 * place, whose code and `reason` are the refusal's. Each failure names the version and the reason it misses.
 */
export function refusalFailures(packs: JsonObject, r: Refusal): string[] {
  const row = packRow(packs, r.p);
  const want = `an error ${r.code} at ${ENTRY} with the reason ${r.reason}`;
  if (row.state !== 'refused') return [`${where(r.p)} is ${row.state} at its pack check, not refused with ${want}`];
  const named = row.errors.filter((i) => i.path === ENTRY && i.code === r.code && field(i, 'reason') === r.reason);
  return named.length ? [] : [`${where(r.p)} is refused without ${want}: ${show(row.errors.map((i) => i.raw), 2500)}`];
}

/** The channel keyed on b1's shelves: after the move to furniture.case@2 it is on b1's tiers. */
export const LIFT = { id: 'lift', place: 'channels/lift/target', saved: 'items/b1/params/shelves', opens: 'items/b1/params/tiers' } as const;

/** Whether an error is `ref_unresolved` about the channel: at its place, under its entry, or naming its path as saved or as it must open. */
const aboutLift = (i: Issue): boolean => i.code === 'ref_unresolved'
  && (i.path === LIFT.place || i.path.startsWith('channels/lift') || JSON.stringify(i.raw).includes(LIFT.saved) || JSON.stringify(i.raw).includes(LIFT.opens));
/** The `ref_unresolved` errors a `read` raises about the channel. */
export const unresolvedLift = (reply: JsonObject): Issue[] => errors(issues(reply)).filter(aboutLift);

/**
 * The values `got` against those `want`, one per time: each a number equal to the one wanted (within 1e-9). The first
 * three differences are spelled out, each naming `what` and the time; the rest are counted.
 */
export function valueFailures(what: string, times: readonly string[], got: readonly JsonValue[], want: readonly JsonValue[]): string[] {
  if (got.length !== times.length) return [`${what} gives ${got.length} values for ${times.length} times: ${show([...got], 300)}`];
  const off = times.flatMap((t, i) => (typeof got[i] === 'number' && sameJson(got[i], want[i]) ? [] : [`${what} gives ${show(got[i] ?? null)} at ${t}, not ${show(want[i] ?? null)}`]));
  return off.length > 3 ? [...off.slice(0, 3), `${what} differs at ${off.length} of the ${times.length} times`] : off;
}

/**
 * Criterion 4, on the lift opened under acme/shelf@2.0.0 that requires furniture@2.0.0: the four versions install; b1
 * opens as furniture.case@2; `read`'s `opened` holds the channel on items/b1/params/tiers and no error is raised; and
 * `deep_query` gives, at items/b1/params/tiers, the value recorded at each sampled time. Each failure about the channel
 * names it.
 */
export function liftFailures(packs: JsonObject, read: JsonObject, query: JsonObject, rec: { times: string[]; values: JsonValue[] }): string[] {
  const failures = installFailures(packs, [SHELF_12, FURNITURE_10, FURNITURE_20, SHELF_20_TIERS]);
  const opensAs = expansionOf(read, 'b1')?.kind;
  if (opensAs !== CASE_2) failures.push(`b1 opens as ${show(opensAs ?? null)}, not ${CASE_2}`);
  const opened = read['opened'];
  const target = at(opened, 'channels', LIFT.id, 'target');
  if (!isObject(opened)) failures.push(`read carries no opened document, so the channel ${LIFT.id} reads as no path after the upgrade; read's fields: ${Object.keys(read).join(', ')}`);
  else if (target !== LIFT.opens) failures.push(`the channel ${LIFT.id} is on ${show(target ?? null)} after the upgrade, not ${LIFT.opens}`);
  for (const i of errors(issues(read))) {
    failures.push(aboutLift(i) ? `the channel ${LIFT.id} (${LIFT.place}) is left ref_unresolved, where it must be on ${LIFT.opens}: ${show(i.raw, 500)}` : `an error is raised: ${show(i.raw, 600)}`);
  }
  failures.push(...valueFailures(`the channel ${LIFT.id}, read at ${LIFT.opens} against the values recorded for it,`, rec.times, valuesOf(query, LIFT.opens), rec.values));
  return failures;
}
