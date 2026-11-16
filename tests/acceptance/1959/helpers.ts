// Test-side tools for the #1959 acceptance tests: `deep-show` built with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #306's, #1956's and #1961's suites drive it; the
// shelf pack fixtures of `fixtures/packs/` and their corpus records; `fixtures/mixed-versions.scene`; the `packs`,
// `deep show`, `read`, patch and undo calls and the fields this suite reads from them (README: The surface under test).
// Nothing here stands in for the migrator, expansion or the store: every result read here is the binary's. The
// `...Failures` functions are the criteria's checks: each returns sentences naming what failed, so a test runs it on
// the right program (no failures) and on the criterion's planted program (a failure naming what the criterion says).
// Helper code is copied from tests/acceptance/1956, never imported across suites.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1959 is three levels down). */
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

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** Whether a sentence names an ID as a whole word (`b1`, never inside `b10` or `tag-b1x`). */
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1959-bins-'));
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
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'deep-1959-')); n = 0; });
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
export const ALPHA: Session = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: bookcases A', process: { pid: 4100, start: 1_000 } };
/** Writer B: the agent whose layer `writer-b` holds b1 to b6. */
export const BETA: Session = { id: 'sess-beta', thread: 'thread-beta', name: 'Claude Code: bookcases B', process: { pid: 4200, start: 1_200 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4200, ppid: 3001, start: 1_200 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** DOC: the shared document seeded with a scenario's `seed`. */
export const DOC = ulid('01JB1959D', 1);
/** Four boards you present the four corpus documents of #1959.fd45405b on, one each. */
export const CASE_DOCS: readonly string[] = [1, 2, 3, 4].map((n) => ulid('01JB1959E', n));
export const patchId = (n: number): string => ulid('01JB1959P', n);

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string; folder: string }
const pack = (version: string, folder: string): PackFixture => ({ id: 'acme/shelf', version, dir: join(FIXTURES, 'packs', folder), folder });
/** acme/shelf@1.0.0: shelf.bookcase@1 {width, levels, dividers}, no migration (README: Fixtures). */
export const V1 = pack('1.0.0', 'shelf-1.0.0');
/** acme/shelf@2.0.0: shelf.bookcase@2 {width, shelves, depth, dividers}, the @1-to-@2 step. */
export const V2 = pack('2.0.0', 'shelf-2.0.0');
/** acme/shelf@3.0.0: shelf.bookcase@3 {span, shelves, depth, partitions}, keeping the @1-to-@2 step and adding @2-to-@3. */
export const V3 = pack('3.0.0', 'shelf-3.0.0');
/** Every run installs the three versions, earlier ones first. */
export const ALL_VERSIONS: readonly PackFixture[] = [V1, V2, V3];
const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;
export const at = (p: PackFixture): string => `${packAt(p)} (fixtures/packs/${p.folder})`;

export const KIND = (major: number): string => `shelf.bookcase@${major}`;

const manifestOf = (p: PackFixture): JsonObject => obj(readJson(join(p.dir, 'pack.json')), `${at(p)}: pack.json`);

/**
 * A pack's corpus records of a major (README: Fixtures): each `corpus[major][i]`, an asset holding `{document, values}`,
 * the document as the release of that major saved it and the values it recorded for its expansion.
 */
export interface CorpusRecord { sha: string; document: JsonObject; values: JsonObject }
export function corpusRecords(p: PackFixture, major: number): CorpusRecord[] {
  const m = manifestOf(p);
  const assets = arr(m['assets'], `${at(p)}: assets`).map((a, i) => obj(a, `${at(p)}: assets[${i}]`));
  return arr(obj(m['corpus'], `${at(p)}: corpus`)[String(major)], `${at(p)}: corpus.${major}`).map((h, i) => {
    const sha = str(h, `${at(p)}: corpus.${major}[${i}]`);
    const asset = assets.find((a) => a['sha256'] === sha);
    expect(asset, `${at(p)} lists its corpus document ${sha} among its assets`).toBeDefined();
    const record = obj(readJson(join(p.dir, str(asset!['path'], `${at(p)}: the corpus asset's path`))), `${at(p)}: corpus record ${sha}`);
    return { sha, document: obj(record['document'], 'the corpus record\'s document'), values: obj(record['values'], 'the corpus record\'s values') };
  });
}
/** A document with its `packs` entry naming `p`, as the patch that takes that pack version writes it. */
export const pinned = (document: JsonObject, p: PackFixture): JsonObject => ({ ...document, packs: [packAt(p)] });
/** The one item of a corpus document: its ID and the item. */
export function soleItem(document: JsonObject, what: string): [string, JsonObject] {
  const items = Object.entries(obj(document['items'], `${what}: items`));
  expect(items.length, `${what} holds one item`).toBe(1);
  return [items[0]![0], obj(items[0]![1], `${what}: its item`)];
}

/** `fixtures/mixed-versions.scene`, the lifecycle fixture: a stored board in JSON (README: Fixtures). */
export const scene = (): JsonObject => obj(readJson(join(FIXTURES, 'mixed-versions.scene')), 'fixtures/mixed-versions.scene');

/**
 * A scenario with writer A's and writer B's sessions, the process table and a panel; CASE_DOCS on it, DOC too, seeded
 * as `seed` when given; the three pack versions; `state` and `planted` when given.
 */
export function scenario(evidence: string, calls: JsonObject[], extra: { seed?: JsonObject; state?: string; planted?: string } = {}): JsonObject {
  return {
    evidence,
    ...(extra.state ? { state: extra.state } : {}),
    sessions: Object.fromEntries([ALPHA, BETA].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }])),
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: {
      [DOC]: { panel: 'main', ...(extra.seed ? { document: extra.seed } : {}) },
      ...Object.fromEntries(CASE_DOCS.map((d) => [d, { panel: 'main' }])),
    },
    packs: ALL_VERSIONS.map((p) => ({ id: p.id, dir: p.dir })),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls

export const PACKS: JsonObject = { call: 'packs' };
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** `read`: the revision shown, with the stored document, its issues, `expansions` and (new) `notices`. */
export const readDoc = (doc: string): JsonObject => ({ call: 'read', doc });
/** Writer `s`'s patch `n` on revision `base` of a shared document: one rect added in its layer. */
export const addsBox = (s: Session, doc: string, n: number, base: number): JsonObject => ({
  call: 'deep_show', session: s.id, doc, patch: {
    patch: patchId(n), doc, base, reason: 'adds a label box beside the bookcases',
    ops: [{ op: 'create', item: { id: '~1', kind: 'rect@1', name: 'Label box', order: 'd1', params: { box: [240, 0, 40, 20] } } }],
  },
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

/** A corpus record's values for its item `from`, written for an instance `to` (each derived ID's prefix swapped). */
export const valuesFor = (values: JsonObject, from: string, to: string): JsonObject =>
  Object.fromEntries(Object.entries(values).map(([id, v]) => [id.startsWith(`${from}.`) ? `${to}${id.slice(from.length)}` : id, v]));

/**
 * The values an expansion gives against those recorded: each recorded derived item by ID, its `kind`, `params` and
 * `at` equal (numbers as numbers), and no derived item the record lacks. Each failure names the derived item and field.
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
export function packState(reply: JsonObject, p: PackFixture): { state: string; issues: JsonValue } {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}: ${show(reply)}`).toBe(1);
  return { state: String(rows[0]!['state']), issues: rows[0]!['issues'] ?? null };
}
/** Every version installs: the fixtures are well formed under the build. */
export function allInstalled(reply: JsonObject): void {
  for (const p of ALL_VERSIONS) {
    const row = packState(reply, p);
    expect(row.state, `${at(p)} installs: ${show(row.issues, 3000)}`).toBe('installed');
  }
}
