// Test-side tools for the #1960 acceptance tests: `deep-show` built with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #1956's, #1959's and #1961's suites drive it;
// the shelf pack fixtures of `fixtures/packs/` and their corpus records; `fixtures/mixed-versions.scene` and the values
// recorded for it; the `packs`, `read`, `deep_query`, patch and undo calls and the fields this suite reads from them
// (README: The surface under test). Nothing here stands in for the migrator, the check, the evaluator or the store:
// every result read here is the binary's. The `...Failures` functions are the criteria's checks: each returns sentences
// naming what failed, so a test runs it on the right program (no failures) and on the criterion's planted program (a
// failure naming what the criterion says). Helper code is copied from tests/acceptance/1959, never imported across
// suites.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1960 is three levels down). */
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

/** Whether a sentence names an ID as a whole word (`a1`, never inside `a10` or `tag-a1x`). */
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1960-bins-'));
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

/**
 * Fresh folders for each test: `evidence()` gives a new evidence store root for each process, so no process sees
 * another's store; `state()` a hub state folder, the one thing a restart shares with the run before it. All deleted
 * after the test.
 */
export function useFolders(): { evidence: () => string; state: () => string } {
  let root = '';
  let n = 0;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'deep-1960-')); n = 0; });
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
  const fresh = (what: string) => (): string => {
    const dir = join(root, `${what}-${++n}`);
    mkdirSync(dir);
    return dir;
  };
  return { evidence: fresh('evidence'), state: fresh('state') };
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: writer A's and writer B's sessions, the process table, a panel, documents.

interface Session { id: string; thread: string; name: string; process: { pid: number; start: number } }
/** Writer A: the agent whose layer `writer-a` holds a1 to a6. */
export const ALPHA: Session = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Bookcases A', process: { pid: 4100, start: 1_000 } };
/** Writer B: the agent whose layer `writer-b` holds b1 to b6. */
export const BETA: Session = { id: 'sess-beta', thread: 'thread-beta', name: 'Bookcases B', process: { pid: 4200, start: 1_200 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4200, ppid: 3001, start: 1_200 },
];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** DOC: the shared document a test opens under the pack version it tests. */
export const DOC = ulid('01JB1960D', 1);
/** DOC_SAVED: the same corpus document under the release that saved it. */
export const DOC_SAVED = ulid('01JB1960D', 2);
export const patchId = (n: number): string => ulid('01JB1960P', n);
/** The reading the scene's bound value shows: the record holds it for no session, so every writer may read it. */
export const READING = `reading:${ulid('01JB1960R', 1)}`;

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string; folder: string }
const pack = (version: string, folder: string): PackFixture => ({ id: 'acme/shelf', version, dir: join(FIXTURES, 'packs', folder), folder });
/** acme/shelf@1.0.0: shelf.bookcase@1 {width, levels, dividers}, no migration (README: Fixtures). */
export const V1 = pack('1.0.0', 'shelf-1.0.0');
/** acme/shelf@2.0.0: shelf.bookcase@2 {width, shelves, depth, dividers}, the @1-to-@2 step; its @1 corpus holds the channel document. */
export const V2 = pack('2.0.0', 'shelf-2.0.0');
/** acme/shelf@3.0.0: shelf.bookcase@3 {span, shelves, depth, partitions}, keeping the @1-to-@2 step and adding @2-to-@3. */
export const V3 = pack('3.0.0', 'shelf-3.0.0');
/** A planted acme/shelf@2.0.0 whose @1-to-@2 step drops dividers, which a driver of its @1 corpus document reads. */
export const V2_DROPS_READ = pack('2.0.0', 'shelf-2.0.0-drops-read');
/** Its control: the same step and kind, and a corpus document whose driver reads width, which the step keeps. */
export const V2_DROPS_UNREAD = pack('2.0.0', 'shelf-2.0.0-drops-unread');
/** The versions a run installs unless it says otherwise, earlier ones first. */
export const ALL_VERSIONS: readonly PackFixture[] = [V1, V2, V3];
export const named = (p: PackFixture): string => `${p.id}@${p.version}`;
export const where = (p: PackFixture): string => `${named(p)} (fixtures/packs/${p.folder})`;

export const KIND = (major: number): string => `shelf.bookcase@${major}`;

export const manifestOf = (p: PackFixture): JsonObject => obj(readJson(join(p.dir, 'pack.json')), `${where(p)}: pack.json`);
/** The recipe file of a pack's kind at `major`: its `inputs` are the kind's params. */
export const recipeOf = (p: PackFixture, major: number): JsonObject => obj(readJson(join(p.dir, `${KIND(major)}.json`)), `${where(p)}: ${KIND(major)}.json`);
/** A pack's migration step from `from`, `{rename, set, drop}`, of its kind at `major`. */
export const stepOf = (p: PackFixture, major: number, from: number): JsonObject =>
  obj(at(manifestOf(p), 'kinds', KIND(major), 'migrate', String(from)), `${where(p)}: the step from major ${from}`);

/**
 * A pack's corpus records of a major (README: Fixtures): each `corpus[major][i]`, an asset holding `{document,
 * values}`, the document as the release of that major saved it and the values it recorded for its expansion; the
 * channel document's record also holds `sampled`, its evaluated values at its sampled times.
 */
export interface CorpusRecord { sha: string; document: JsonObject; values: JsonObject; sampled: JsonObject | undefined }
export function corpusRecords(p: PackFixture, major: number): CorpusRecord[] {
  const m = manifestOf(p);
  const assets = arr(m['assets'], `${where(p)}: assets`).map((a, i) => obj(a, `${where(p)}: assets[${i}]`));
  return arr(obj(m['corpus'], `${where(p)}: corpus`)[String(major)], `${where(p)}: corpus.${major}`).map((h, i) => {
    const sha = str(h, `${where(p)}: corpus.${major}[${i}]`);
    const asset = assets.find((a) => a['sha256'] === sha);
    expect(asset, `${where(p)} lists its corpus document ${sha} among its assets`).toBeDefined();
    const record = obj(readJson(join(p.dir, str(asset!['path'], `${where(p)}: the corpus asset's path`))), `${where(p)}: corpus record ${sha}`);
    const sampled = record['sampled'];
    return { sha, document: obj(record['document'], 'the corpus record\'s document'), values: obj(record['values'], 'the corpus record\'s values'), sampled: isObject(sampled) ? sampled : undefined };
  });
}
/**
 * A corpus document as a shared document stores it under `p` (README: Opening a corpus document): its `packs` entry
 * naming `p`, as the patch that takes that pack version writes it, and every item in one layer, `main`, writer A's,
 * as the hub stamps a shown revision. Nothing else changes: each item stays at the major it was saved at.
 */
export function stored(document: JsonObject, p: PackFixture): JsonObject {
  const items = Object.entries(obj(document['items'], 'the corpus document\'s items')).map(([id, item]) => [id, { ...obj(item, id), layer: 'main' }]);
  return { ...document, packs: [named(p)], layers: { main: { writer: `agent:${ALPHA.thread}`, title: 'Main', order: 'a0' } }, items: Object.fromEntries(items) as JsonObject };
}

/** `fixtures/mixed-versions.scene`, the lifecycle fixture: a stored board in JSON (README: Fixtures). */
export const scene = (): JsonObject => obj(readJson(join(FIXTURES, 'mixed-versions.scene')), 'fixtures/mixed-versions.scene');
/** `fixtures/mixed-versions.recorded.json`: the values recorded for the scene's channel and driver at the 101 times. */
export const recorded = (): JsonObject => obj(readJson(join(FIXTURES, 'mixed-versions.recorded.json')), 'fixtures/mixed-versions.recorded.json');
/** The 101 times: every 0.1 s from 0 to 10 s, as time literals. */
export const TIMES_101: readonly string[] = Array.from({ length: 101 }, (_, i) => `${(i / 10).toFixed(1)}s`);

/**
 * A scenario with writer A's and writer B's sessions, the process table, a panel and the record's one reading; each
 * document of `seeds` a shared document seeded as stored; `packs` installed in order (the three versions unless
 * given); `state` and `planted` when given.
 */
export function scenario(evidence: string, calls: JsonObject[], extra: { seeds?: Record<string, JsonObject>; packs?: readonly PackFixture[]; state?: string; planted?: string } = {}): JsonObject {
  return {
    evidence,
    ...(extra.state ? { state: extra.state } : {}),
    sessions: Object.fromEntries([ALPHA, BETA].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }])),
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    record: { [READING]: { session: null, value: 1.6, as_of: 0 } },
    docs: Object.fromEntries(Object.entries(extra.seeds ?? {}).map(([doc, document]) => [doc, { panel: 'main', document }])),
    packs: (extra.packs ?? ALL_VERSIONS).map((p) => ({ id: p.id, dir: p.dir })),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls

export const PACKS: JsonObject = { call: 'packs' };
/** `read`: the revision shown, with the stored document, its issues, `expansions`, `notices`, `files` and (new) `opened`. */
export const readDoc = (doc: string): JsonObject => ({ call: 'read', doc });
/** `deep_query` from writer A's session: the evaluated value at each path at each time, and no rows. */
export const valuesAt = (doc: string, paths: readonly string[], times: readonly string[]): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, items: [], paths: [...paths], at: [...times] });
/** Writer `s`'s patch `n` on revision `base` of a shared document: one `set` of `path` to `value`. */
export const sets = (s: Session, doc: string, n: number, base: number, id: string, path: string, value: JsonValue, reason: string): JsonObject => ({
  call: 'deep_show', session: s.id, doc, patch: { patch: patchId(n), doc, base, reason, ops: [{ op: 'set', id, path, value }] },
});
/** Writer `s`'s undo of its patch `of`, as patch `n`. */
export const undoes = (s: Session, doc: string, n: number, of: number): JsonObject => ({ call: 'deep_show', session: s.id, doc, undo: { patch: patchId(n), of: patchId(of) } });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '', path: typeof o['path'] === 'string' ? o['path'] : '', raw: o };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');

/** One `migrated` step for one item: the notice's `ids` each give one. */
export interface Step { id: string; from: number; to: number; kind: string }
/** Every `migrated` step a reply's `notices` raise, one per ID per notice. */
export function migratedSteps(reply: JsonObject): Step[] {
  return arr(reply['notices'] ?? [], 'the reply: notices').map((n, i) => obj(n, `notices[${i}]`))
    .filter((n) => n['code'] === 'migrated')
    .flatMap((n) => (Array.isArray(n['ids']) ? n['ids'] : []).map((id) => ({ id: String(id), from: Number(n['from']), to: Number(n['to']), kind: String(n['kind'] ?? '') })));
}

/** One recipe instance's expansion, as #306's `expansions` row gives it; undefined when the reply has none. */
export interface Expansion { kind: string; derived: JsonObject }
export function expansionOf(reply: JsonObject, instance: string): Expansion | undefined {
  const rows = (Array.isArray(reply['expansions']) ? reply['expansions'] : []).filter((e) => isObject(e) && e['instance'] === instance) as JsonObject[];
  if (rows.length !== 1) return undefined;
  return { kind: String(rows[0]!['kind']), derived: isObject(rows[0]!['derived']) ? rows[0]!['derived'] : {} };
}
/**
 * The shelves an instance opens with, read off its expansion: each major's recipe draws the sides `shelves * 40` u
 * tall (README: Fixtures), so it is the height of `<id>.sides.0` ÷ 40; undefined when the expansion draws none.
 */
export function shelvesOf(reply: JsonObject, id: string): number | undefined {
  const box = at(expansionOf(reply, id)?.derived, `${id}.sides.0`, 'params', 'box');
  return Array.isArray(box) && typeof box[3] === 'number' ? box[3] / 40 : undefined;
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
// The criteria's checks on paths and evaluated values

/**
 * One path a document holds that names a param a migration renames: where it sits (`map`, `id` and the `field` of the
 * entry that holds it), the path as saved and the path it must name after the load.
 */
export interface PathEntry { what: string; map: string; id: string; field: readonly string[]; saved: string; opens: string }
/** Where an entry's path sits, as an issue's `path` names it: `channels/<id>/target`, `drivers/<id>/vars/<name>`, … */
export const sits = (e: PathEntry): string => [e.map, e.id, ...e.field].join('/');

/** The path an entry names in a document, saved or opened; undefined where it holds none. */
export function pathIn(document: JsonValue | undefined, e: PathEntry): JsonValue | undefined {
  return at(document, e.map, e.id, ...e.field);
}

/** Whether an issue is `ref_unresolved` about an entry: its `path` is the entry's place or under its entry, or its JSON holds the path the entry names, saved or opened. */
function about(i: Issue, e: PathEntry): boolean {
  const under = `${e.map}/${e.id}`;
  const text = JSON.stringify(i.raw);
  return i.code === 'ref_unresolved' && (i.path === under || i.path.startsWith(`${under}/`) || text.includes(e.saved) || text.includes(e.opens));
}
/** The `ref_unresolved` errors a `read` raises about an entry. */
export const unresolved = (reply: JsonObject, e: PathEntry): Issue[] => errors(issues(reply)).filter((i) => about(i, e));

/**
 * What a load must do for each path: `read`'s `opened` document names the renamed param at the entry's place, and no
 * error is raised. Each failure names the entry, its place and the path it must name; an error about no entry is a
 * failure too.
 */
export function pathFailures(reply: JsonObject, entries: readonly PathEntry[]): string[] {
  const failures: string[] = [];
  const opened = reply['opened'];
  const raised = errors(issues(reply));
  if (!isObject(opened)) failures.push(`read carries no opened document, so no path reads as the load left it (${entries.map((e) => `${e.what} ${e.id}: ${e.opens} at ${sits(e)}`).join('; ')}); read's fields: ${Object.keys(reply).join(', ')}`);
  for (const e of entries) {
    const got = isObject(opened) ? pathIn(opened, e) : undefined;
    if (isObject(opened) && got !== e.opens) failures.push(`${e.what} ${e.id} names ${show(got ?? null)} at ${sits(e)} after the load, not ${e.opens}`);
    for (const i of raised.filter((x) => about(x, e))) failures.push(`${e.what} ${e.id} (${sits(e)}) is left ref_unresolved, where it must name ${e.opens}: ${show(i.raw, 500)}`);
  }
  for (const i of raised.filter((x) => !entries.some((e) => about(x, e)))) failures.push(`an error is raised: ${show(i.raw, 600)}`);
  return failures;
}

/**
 * The values `got` against those `want`, one per time: each a number equal to the one wanted (within 1e-9). The first
 * three differences are spelled out, each naming `what` and the time; the rest are counted.
 */
export function valueFailures(what: string, times: readonly string[], got: readonly JsonValue[], want: readonly JsonValue[]): string[] {
  if (got.length !== times.length) return [`${what} gives ${got.length} values for ${times.length} times: ${show([...got], 300)}`];
  const off = times.flatMap((t, i) => (typeof got[i] === 'number' && sameJson(got[i], want[i]) ? [] : [`${what} gives ${show(got[i] ?? null)} at ${t}, not ${show(want[i] ?? null)}`]));
  return off.length > 3 ? [...off.slice(0, 3), `${what} differs at ${off.length} of the ${times.length} times`] : off;
}

// ---------------------------------------------------------------------------------------------------
// mixed-versions.scene: what criteria 2 and 3 name in it, and the fixture's own check

export const A_IDS: readonly string[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
export const B_IDS: readonly string[] = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
/** The channel keyed on a1's levels: after the load it is on a1's shelves. */
export const CHANNEL: PathEntry = { what: 'the channel', map: 'channels', id: 'rise', field: ['target'], saved: 'items/a1/params/levels', opens: 'items/a1/params/shelves' };
/** The driver that reads a2's width: after the load it reads a2's span. */
export const DRIVER: PathEntry = { what: 'the driver', map: 'drivers', id: 'reach', field: ['vars', 'w'], saved: 'items/a2/params/width', opens: 'items/a2/params/span' };
/** The bound value that targets b1's width: after the load it targets b1's span. */
export const BOUND: PathEntry = { what: 'the bound value', map: 'bound_values', id: 'stock', field: ['target'], saved: 'items/b1/params/width', opens: 'items/b1/params/span' };
/** The constraint whose path names b2's width: after the load it names b2's span. */
export const CONSTRAINT: PathEntry = { what: 'the constraint', map: 'constraints', id: 'slide', field: ['fraction', 'path'], saved: 'items/b2/params/width', opens: 'items/b2/params/span' };
export const SCENE_PATHS: readonly PathEntry[] = [CHANNEL, DRIVER, BOUND, CONSTRAINT];
/** The path the driver writes: its evaluated value is read there. The channel's is read at the path it is on. */
export const DRIVER_WRITES = 'items/gauge-a/at/pos/0';
/** The two paths whose evaluated values the criteria compare at the 101 times: the channel's and the driver's. */
export const EVALUATED: readonly string[] = [CHANNEL.opens, DRIVER_WRITES];

/** `min`, `max` and `default` of one input of a recipe. */
const range = (recipe: JsonObject, input: string): JsonValue[] => ['min', 'max', 'default'].map((k) => at(recipe, 'inputs', input, k) ?? null);

/**
 * The scene, checked to be what the Scope and criteria 2 and 3 say: acme/shelf@3.0.0 named, whose shelf.bookcase@3
 * keeps the @1-to-@2 step and renames width to span and dividers to partitions (span 0.4 to 3.0, default 1.2;
 * partitions 0 to 3, default 1); 12 instances in two writers' layers, a1 to a6 saved at @1 in writer A's and b1 to b6
 * saved at @2 in writer B's; a3 saved with levels 4; and the four paths, each where its criterion says.
 */
export function checkedScene(): JsonObject {
  const doc = scene();
  const layers = obj(doc['layers'], 'the scene\'s layers');
  const items = obj(doc['items'], 'the scene\'s items');
  const writerOf = (layer: string): string => str(obj(layers[layer], `layer ${layer}`)['writer'], `layer ${layer}'s writer`);
  expect(Object.keys(layers).sort(), 'the scene has two writers\' layers').toEqual(['writer-a', 'writer-b']);
  expect(writerOf('writer-a'), 'writer-a is writer A\'s layer').toBe(`agent:${ALPHA.thread}`);
  expect(writerOf('writer-b'), 'writer-b is writer B\'s layer').toBe(`agent:${BETA.thread}`);
  const instances = Object.entries(items).filter(([, v]) => isObject(v) && String(v['kind']).startsWith('shelf.bookcase@'));
  expect(instances.map(([id]) => id).sort(), 'the scene holds exactly 12 instances, a1 to a6 and b1 to b6').toEqual([...A_IDS, ...B_IDS].sort());
  const fields = (id: string): JsonValue[] => { const i = obj(items[id], id); return [i['layer'] ?? null, i['kind'] ?? null, Object.keys(obj(i['params'], `${id}'s params`)).sort()]; };
  for (const id of A_IDS) expect(fields(id), `${id}, writer A's, saved at @1 with its width and levels`).toEqual(['writer-a', KIND(1), ['levels', 'width']]);
  for (const id of B_IDS) expect(fields(id), `${id}, writer B's, saved at @2 with its width, shelves and depth`).toEqual(['writer-b', KIND(2), ['depth', 'shelves', 'width']]);
  expect(at(items, 'a3', 'params', 'levels'), 'a3 is saved with levels 4, so it opens with shelves 4').toBe(4);
  expect(doc['packs'], 'the scene names acme/shelf@3.0.0').toEqual([named(V3)]);
  expect([at(stepOf(V3, 3, 1), 'rename'), at(stepOf(V3, 3, 2), 'rename')], 'acme/shelf@3.0.0 keeps the @1-to-@2 step and adds @2-to-@3, renaming width to span and dividers to partitions')
    .toEqual([{ levels: 'shelves' }, { width: 'span', dividers: 'partitions' }]);
  expect([range(recipeOf(V3, 3), 'span'), range(recipeOf(V3, 3), 'partitions')], 'span 0.4 to 3.0 m, default 1.2, and partitions 0 to 3, default 1').toEqual([[0.4, 3, 1.2], [0, 3, 1]]);
  for (const e of SCENE_PATHS) expect(pathIn(doc, e), `the scene: ${e.what} ${e.id} names ${e.saved} at ${sits(e)}`).toBe(e.saved);
  expect(at(doc, 'drivers', DRIVER.id, 'target'), `the driver writes ${DRIVER_WRITES}`).toBe(DRIVER_WRITES);
  return doc;
}

/**
 * The values recorded for the scene's channel and driver, checked: at the 101 times, every 0.1 s from 0 to 10 s, one
 * number each; the channel's change over the times and the driver's rise at every step, so neither is a constant a
 * program that evaluates nothing would also give.
 */
export function checkedRecorded(): { channel: number[]; driver: number[] } {
  const rec = recorded();
  expect(rec['times'], 'the recorded times are the 101 times, every 0.1 s from 0 to 10 s').toEqual([...TIMES_101]);
  const numbers = (who: string, id: string): number[] => {
    expect(at(rec, who, 'id'), `the recorded ${who} is ${id}`).toBe(id);
    const list = arr(at(rec, who, 'values'), `the recorded ${who}'s values`);
    expect(list.length === 101 && list.every((v) => typeof v === 'number'), `the recorded ${who} has 101 numbers`).toBe(true);
    return list as number[];
  };
  const channel = numbers('channel', CHANNEL.id);
  const driver = numbers('driver', DRIVER.id);
  expect(new Set(channel).size, 'the recorded channel changes over the 101 times').toBeGreaterThan(1);
  expect(driver.every((v, i) => i === 0 || v > driver[i - 1]!), 'the recorded driver rises at every step').toBe(true);
  return { channel, driver };
}

/** The channel's and the driver's values in a `deep_query` reply against those wanted, at the 101 times. */
export function evaluatedFailures(reply: JsonObject, want: { channel: readonly JsonValue[]; driver: readonly JsonValue[] }, than: string): string[] {
  return [
    ...valueFailures(`the channel ${CHANNEL.id}, read at ${CHANNEL.opens} against ${than},`, TIMES_101, valuesOf(reply, CHANNEL.opens), want.channel),
    ...valueFailures(`the driver ${DRIVER.id}, read at ${DRIVER_WRITES} against ${than},`, TIMES_101, valuesOf(reply, DRIVER_WRITES), want.driver),
  ];
}
