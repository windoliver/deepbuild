// Test-side tools for the #1958 acceptance tests: `deep-show` built once with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #306's, #403's, #1956's and #1957's suites drive
// it; the pack fixtures of `fixtures/packs/` and the ten-pack graph written at test time; the documents the criteria
// name (a reading room of 3 bookcases and 12 other items); the calls and the reply fields this suite reads (README: The
// surface under test); the merge base exported and built apart; and the reference-Mac gate with the design's judge for
// timings. Nothing here stands in for the store, the loader, the check or the draw: every result read here is the
// binary's. The `...Failures` functions are the criteria's checks: each returns sentences naming what failed, so a test
// runs it on the right program (no failures) and on the criterion's planted program (a failure naming what the
// criterion says). Helper code is copied from tests/acceptance/202, 306, 403, 1956 and 1957, never imported across
// suites.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1958 is three levels down). */
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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a pack ID, a version, a code). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** Canonical JSON: keys sorted at every depth, so equal values have equal text. */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** An item's bytes by hash: the SHA-256 of its canonical JSON. */
export const hashOf = (value: JsonValue | undefined): string => sha256(canon(value));

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one failure that names every one of `names` together: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: one failure names ${names.join(', ')} together; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` of `r1`, here once per file, and the merge base's apart.

/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** `cargo build --locked --bin deep-show --no-default-features --features r1` in `root`, copied to `to`; '' or cargo's error. */
function buildTo(root: string, to: string, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'r1'];
  const r = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  copyFileSync(join(targetOf(root, { ...process.env, ...env }), 'debug', exe(SHOW_NAME)), to);
  return '';
}

/** Builds the binary once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1958-bin-'));
    bin = join(dir, `${SHOW_NAME}-r1`);
    error = buildTo(REPO, bin);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} with features r1`).toBe('');
    return bin;
  };
}

/** The merge base of HEAD and origin/main. */
function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** The merge base exported whole by `git archive` into the (git-ignored) target folder, once. */
function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-1958-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  return dir;
}
let baseBin: string | undefined;
/** The merge base's `deep-show` of `r1`, built once per process in its own target folder (kept, so later runs build warm). */
export function baseBuild(): { sha: string; bin: string } {
  const sha = mergeBase();
  const dir = mergeBaseCheckout(sha);
  const bin = join(dir, 'deep-show-r1');
  if (!baseBin) {
    expect(buildTo(dir, bin, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s r1 build compiles in ${dir}`).toBe('');
    baseBin = bin;
  }
  return { sha, bin };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call, and the process's wall time in ms. */
export function runTimed(bin: string, sc: JsonObject): { replies: JsonObject[]; ms: number } {
  const started = performance.now();
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - started;
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  expect(r.status, `${SHOW_NAME} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((v, i) => obj(v, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return { replies, ms };
}
export const run = (bin: string, sc: JsonObject): JsonObject[] => runTimed(bin, sc).replies;

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1958-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const dirs: string[] = [];
/** A scratch folder deleted after the file. */
export function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `deep-1958-${tag}-`));
  dirs.push(d);
  return d;
}
export function useTempDirs(): void {
  afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the working agent's session, the process table, a panel, documents, claims.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: reading room', process: { pid: 4100, start: 1_000 } };
/** The writer the working agent's connection proves: a layer's `writer` holds it. */
export const ALPHA_WRITER = `agent:${ALPHA.thread}`;
export const YOU_WRITER = 'you:you';
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4102, ppid: 4100, start: 1_200 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** `deep show` from inside the working agent's process tree: it writes as the agent (#403). */
const IN_ALPHA: JsonObject = { pid: 4102, start: 1_200 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1958D', n);
export const DOC = { a: docId(1), b: docId(2), c: docId(3), d: docId(4) } as const;
export const patchId = (n: number): string => ulid('01JB1958P', n);
/** The working agent's claim, whose deliverable is DOC.d (README: A check that touches one). */
export const CLAIM = `claim:${ulid('01JB1958C', 1)}`;
const CLAIMS: JsonObject = { [CLAIM]: { session: ALPHA.id, deliverables: [DOC.d], requirements: [{ id: `req:${ulid('01JB1958Q', 1)}`, check: { kind: 'document.validate' } }] } };

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
/** acme/shelf@1.2.0: the recipe shelf.bookcase@2, two sides and a board per level (README: Fixtures). */
export const SHELF_12 = pack('acme/shelf', '1.2.0', 'shelf-1.2.0');
/** acme/shelf@1.0.0: the pack kind shelf.bookcase@1 {width, levels} (copied from #1956's suite, budgets). */
export const SHELF_10 = pack('acme/shelf', '1.0.0', 'shelf-1.0.0');
/** acme/shelf@2.0.0: shelf.bookcase@2, whose @1-to-@2 migration is data (copied from #1956's suite, budgets). */
export const SHELF_20 = pack('acme/shelf', '2.0.0', 'shelf-2.0.0');
/** The version a document from another machine names, which this build has never had. */
export const MISSING = { id: 'acme/shelf', version: '9.9.9' } as const;
export const packAt = (p: { id: string; version: string }): string => `${p.id}@${p.version}`;

export interface World { packs?: readonly PackFixture[]; docs?: readonly string[]; seeds?: Record<string, JsonObject>; planted?: string; claims?: boolean }
/**
 * A scenario with the working agent's session, the process table and the panel; DOC.a–d (and `docs`) on `main`, each of
 * `seeds` a stored document the hub opens at revision 0; `packs` offered to the store in order before the first call.
 */
export function scenario(evidence: string, calls: JsonObject[], w: World = {}): JsonObject {
  const ids = [...Object.values(DOC), ...(w.docs ?? [])];
  const docs: JsonObject = Object.fromEntries(ids.map((id) => [id, { panel: 'main', ...(w.seeds?.[id] ? { document: w.seeds[id] } : {}) }]));
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs,
    packs: (w.packs ?? []).map((p) => ({ id: p.id, dir: p.dir })),
    ...(w.planted ? { planted: w.planted } : {}),
    ...(w.claims ? { claims: CLAIMS } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents: the reading room, 3 bookcases and 12 other items.

export const BOOKCASE = 'shelf.bookcase@2';
export const BOOKCASES = ['b1', 'b2', 'b3'] as const;
export const OTHERS = Array.from({ length: 12 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
const ORDERS = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aA', 'aB', 'aC', 'aD', 'aE'];
export const SIZE: [number, number] = [640, 400];

export const bookcase = (id: string, params: JsonObject, order: string, pos: [number, number]): JsonObject =>
  ({ id, kind: BOOKCASE, name: `Bookcase ${id.slice(1)}`, order, params, at: { pos: [pos[0], pos[1], 0] } });
export const rect = (id: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: `Box ${id.slice(1)}`, order, params: { box, paint: { fill: { role: 'muted' } } } });

/** b1 {1.2 m, 3 levels}, b2 {0.8 m, 4 levels}, b3 {1.6 m, 2 levels} along the top; r01–r12, 40 u boxes along the bottom. */
const ROOM_BOOKCASES: JsonObject[] = [
  bookcase('b1', { width: 1.2, levels: 3 }, ORDERS[0]!, [20, 20]),
  bookcase('b2', { width: 0.8, levels: 4 }, ORDERS[1]!, [180, 20]),
  bookcase('b3', { width: 1.6, levels: 2 }, ORDERS[2]!, [300, 20]),
];
const ROOM_OTHERS: JsonObject[] = OTHERS.map((id, i) => rect(id, [20 + i * 50, 300, 40, 40], ORDERS[3 + i]!));

/** A board as your shell sends it: no `id`, no `layers`, no item `layer`; `packs` names each pack version it lists. */
export function board(title: string, packs: readonly string[], items: JsonObject[], size: [number, number] = SIZE): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #1958 acceptance suite.`, size,
    ...(packs.length ? { packs: [...packs] } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
/** The reading room naming `pack`: the 3 bookcases and the 12 other items. */
export const room = (pack: string): JsonObject => board('Reading room', [pack], [...ROOM_BOOKCASES, ...ROOM_OTHERS]);
/** The same room's 12 other items alone, naming no pack: what the room draws when its bookcases are skipped. */
export const othersOnly = (): JsonObject => board('Reading room', [], ROOM_OTHERS);

/**
 * A document as a store holds it (`docs[…].document`, opened as revision 0): `layers` and each item's `layer`. Each item
 * goes to the layer `layerOf` names: `you-main` (writer you) or `alpha-main` (writer the working agent).
 */
export function stored(document: JsonObject, layerOf: (id: string) => 'you-main' | 'alpha-main'): JsonObject {
  const items = obj(document['items'], 'the document\'s items');
  return {
    ...document,
    layers: { 'you-main': { writer: YOU_WRITER, title: 'You', order: 'a0' }, 'alpha-main': { writer: ALPHA_WRITER, title: 'Alpha', order: 'a1' } },
    items: Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...obj(item, id), layer: layerOf(id) }])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls

/** A whole revision from your shell (`deep show`), with its issues and, with `pixels`, one snapshot of SIZE. */
export function present(doc: string, document: JsonObject, o: { pixels?: boolean; check?: boolean; timing?: boolean } = {}): JsonObject {
  return {
    call: 'deep show', peer: YOU_PEER, doc, document, t: '0s', include: ['issues', ...(o.pixels ? ['pixels'] : []), ...(o.timing ? ['timing'] : [])],
    ...(o.pixels ? { size: SIZE } : {}), ...(o.check ? { check: true } : {}),
  };
}
/** `deep show --check --snap` from inside the working agent's tree, in its claim whose deliverable is DOC.d (#403). */
export const checkInClaim = (document: JsonObject): JsonObject =>
  ({ call: 'deep show', peer: IN_ALPHA, check: true, claim: CLAIM, doc: DOC.d, document, t: '0s', size: SIZE, include: ['issues', 'pixels'] });
/** Your patch from your shell. */
export const youPatch = (doc: string, n: number, base: number, reason: string, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, patch: { patch: patchId(n), doc, base, reason, ops } });
/** The working agent's patch through `deep_show`. */
export const alphaPatch = (doc: string, n: number, base: number, reason: string, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, patch: { patch: patchId(n), doc, base, reason, ops } });
/** `read`: the revision shown, with the stored document and what draws. */
export const readDoc = (doc: string): JsonObject => ({ call: 'read', doc });
export const PACKS: JsonObject = { call: 'packs' };
export const REGISTRY: JsonObject = { call: 'registry' };
/** README: `uninstall_pack`, this suite's invention, beside #306's `install_pack`. */
export const uninstall = (p: { id: string; version: string }): JsonObject => ({ call: 'uninstall_pack', id: p.id, version: p.version });
export const KINDS_LIST: JsonObject = { call: 'deep_kinds', op: 'list' };
export const evalAt = (doc: string): JsonObject => ({ call: 'eval', doc, t: 0 });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return { code: str(o['code'], `${what}.code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '', ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
}
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** Every `pack_missing` a reply carries, among its `notices` and its `issues`. */
export function packMissing(reply: JsonObject, what = 'the reply'): Issue[] {
  const notices = arr(reply['notices'] ?? [], `${what}: notices`).map((v, i) => issueOf(v, `${what}: notices[${i}]`));
  return [...notices, ...issues(reply, what)].filter((i) => i.code === 'pack_missing');
}
/** The one snapshot's sha256, or '' when the reply carries none. */
export function shot(reply: JsonObject, what: string): string {
  const shots = Array.isArray(reply['snapshots']) ? reply['snapshots'] : [];
  if (shots.length !== 1) return '';
  return str(obj(shots[0], `${what}: snapshots[0]`)['sha256'], `${what}: the snapshot's sha256`);
}
/** One recipe instance's expansion row (#306), if the reply has one. */
export function expansionRow(reply: JsonObject, instance: string): JsonObject | undefined {
  const rows = Array.isArray(reply['expansions']) ? reply['expansions'] : [];
  return rows.find((e) => isObject(e) && e['instance'] === instance) as JsonObject | undefined;
}
/** A `read` reply's stored items. */
export const storedItems = (reply: JsonObject, what: string): JsonObject => obj(obj(reply['document'], `${what}: document`)['items'], `${what}: document.items`);
/** A `read` reply's `draws`, sorted. */
export const drawsOf = (reply: JsonObject, what: string): string[] => sorted(arr(reply['draws'], `${what}: draws`).map((v, i) => str(v, `${what}: draws[${i}]`)));

/** One version's row of the `packs` reply, or undefined when the store lists none. */
export function packRow(reply: JsonObject, p: { id: string; version: string }): JsonObject | undefined {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => obj(v, `packs[${i}]`)).filter((r) => r['pack'] === p.id && String(r['version'] ?? '') === p.version);
  expect(rows.length, `the packs reply has at most one row for ${packAt(p)}: ${show(reply)}`).toBeLessThanOrEqual(1);
  return rows[0];
}
/** Each pack the store must hold for a clause to mean what it says, installed. */
export function installed(reply: JsonObject, packs: readonly PackFixture[]): void {
  for (const p of packs) {
    const row = packRow(reply, p);
    expect(row?.['state'], `${packAt(p)} installs: ${show(row ?? null)}`).toBe('installed');
  }
}

/** The design's frame phases (Phase: Frame), the phases whose work runs per frame. */
const FRAME_PHASES = ['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback'];
/** The `registry` reply's operators in frame phases. */
export function frameOperators(reply: JsonObject, what = 'registry'): string[] {
  const ops = obj(reply['operators'], `${what}: operators`);
  return sorted(Object.entries(ops).filter(([, o]) => isObject(o) && FRAME_PHASES.includes(String(o['phase']))).map(([k]) => k));
}
/** An `eval` reply's nodes in frame phases, as `operator|item`. */
export function frameNodes(reply: JsonObject, what = 'eval'): string[] {
  return sorted(arr(reply['nodes'], `${what}: nodes`).map((n, i) => obj(n, `${what}: nodes[${i}]`)).filter((n) => FRAME_PHASES.includes(String(n['phase'])))
    .map((n) => `${String(n['operator'])}|${n['item'] === null || n['item'] === undefined ? '-' : String(n['item'])}`));
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the store's fixture. A stored document DOC.b in your layer names acme/shelf@1.2.0; it is read and drawn
// (with its check), the version is uninstalled, and the store is read; the document is read and drawn again.

export const RETIRED_DOC = DOC.b;
/** The store's fixture's calls, in order (README: The store's fixture). */
export function retiredCalls(): JsonObject[] {
  return [
    readDoc(RETIRED_DOC),
    present(RETIRED_DOC, room(packAt(SHELF_12)), { pixels: true, check: true }),
    uninstall(SHELF_12),
    PACKS,
    readDoc(RETIRED_DOC),
    present(RETIRED_DOC, room(packAt(SHELF_12)), { pixels: true, check: true }),
  ];
}
export const retiredSeeds = (): Record<string, JsonObject> => ({ [RETIRED_DOC]: stored(room(packAt(SHELF_12)), () => 'you-main') });

/**
 * The store's fixture's check: after uninstalling, acme/shelf@1.2.0 is still in the store, retired and named, and the
 * document that names it reads to the same draws and draws to the same snapshot hash, its check PASS. Each failure names
 * the pack and the document.
 */
export function retiredFailures(replies: JsonObject[]): string[] {
  const [readBefore, drawnBefore, , packs, readAfter, drawnAfter] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
  const at = packAt(SHELF_12);
  const doc = `document ${RETIRED_DOC}, which names ${at},`;
  const failures: string[] = [];
  const row = packRow(packs, SHELF_12);
  if (!row) failures.push(`the store no longer lists ${at} after uninstalling, while ${doc} is in it: ${show(packs, 800)}`);
  else {
    if (row['state'] !== 'retired') failures.push(`${at} is ${show(row['state'] ?? null)} after uninstalling, not retired, while ${doc} is in the store: ${show(row)}`);
    if (!(typeof row['named_by'] === 'number' && row['named_by'] >= 1)) failures.push(`${at} counts named_by ${show(row['named_by'] ?? null)} after uninstalling, while ${doc} is in the store`);
  }
  const before = drawsOf(readBefore, 'read before uninstalling');
  const after = Array.isArray(readAfter['draws']) ? drawsOf(readAfter, 'read after uninstalling') : [];
  if (canon(before) !== canon(after)) failures.push(`${doc} no longer loads as it did after uninstalling: it drew ${show(before, 400)} and now ${show(after, 400)}; ${show(readAfter, 600)}`);
  const shotBefore = shot(drawnBefore, 'the draw before uninstalling');
  const shotAfter = shot(drawnAfter, 'the draw after uninstalling');
  if (outcome(drawnAfter) !== 'presented' || shotAfter === '' || shotAfter !== shotBefore) {
    failures.push(`${doc} no longer draws to its snapshot hash ${shotBefore} after uninstalling: ${outcome(drawnAfter)}, snapshot ${shotAfter || 'none'}; ${show(drawnAfter['issues'] ?? null, 800)}`);
  }
  if (drawnAfter['result'] !== 'PASS') failures.push(`${doc} no longer checks as before after uninstalling: its check is ${show(drawnAfter['result'] ?? null)}; ${show(drawnAfter['issues'] ?? null, 800)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the document from another machine naming acme/shelf@9.9.9, opened with acme/shelf@1.2.0 installed.

/**
 * The open's check: the room naming acme/shelf@9.9.9 is presented with no error; each bookcase is skipped with one
 * `pack_missing` naming acme/shelf and 9.9.9 whose `ids` are the 3 bookcases; no bookcase expands through any pack; and
 * its snapshot is the 12 other items' snapshot alone (`othersShot`). A bookcase drawn with another version is named with
 * the version the document names and the version it was drawn with.
 */
export function skippedFailures(opened: JsonObject, othersShot: string): string[] {
  const at = packAt(MISSING);
  if (outcome(opened) !== 'presented') return [`the document from another machine naming ${at} is ${outcome(opened)}, not opened: ${show(opened['issues'] ?? null, 1200)}`];
  const failures: string[] = [];
  const errs = errors(issues(opened, 'the open'));
  if (errs.length) failures.push(`the document naming ${at} opens with errors: ${show(errs.map((i) => i.raw), 1200)}`);
  for (const id of BOOKCASES) {
    const row = expansionRow(opened, id);
    if (row) failures.push(`${id}, an instance of ${at}, was drawn with ${show(row['pack'] ?? null)}: its expansion ${show(row, 600)}`);
  }
  const named = packMissing(opened, 'the open').filter((i) => mentions(i.raw, MISSING.id) && mentions(i.raw, MISSING.version));
  if (!named.some((i) => canon(sorted(i.ids)) === canon([...BOOKCASES]))) {
    failures.push(`${BOOKCASES.join(', ')} are not skipped with one pack_missing naming ${at} and those ids: ${show(packMissing(opened, 'the open').map((i) => i.raw), 1200)}`);
  }
  const drawn = shot(opened, 'the open');
  if (drawn === '' || drawn !== othersShot) failures.push(`the document naming ${at} does not draw as its 12 other items alone (snapshot ${drawn || 'none'}, the 12 alone ${othersShot}): its bookcases ${BOOKCASES.join(', ')} drew or its other items did not`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The ten-pack graph (budgets): acme/g01@1.0.0 requires g02@1.0.0, … g09 requires g10, each with one recipe.

export const GRAPH = 10;
const gName = (k: number): string => `g${String(k).padStart(2, '0')}`;
/** Writes the ten packs into `dir`, each `acme/gNN@1.0.0` with the recipe `gNN.tile@1` (one rect); g10 first, so each dependency is offered first. */
export function writeGraph(dir: string): PackFixture[] {
  const text = (v: JsonValue): string => `${JSON.stringify(v, null, 2)}\n`;
  const out: PackFixture[] = [];
  for (let k = GRAPH; k >= 1; k--) {
    const name = gName(k);
    const folder = join(dir, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${name}.tile@1.json`), text({
      id: `${name}.tile`, version: '1.0', title: `Tile ${k}`, license: 'MIT', author: 'the #1958 acceptance suite',
      description: 'One 2D rect, 20 u square.', inputs: {},
      steps: { face: { op: 'mark', kind: 'rect@1', params: { box: [0, 0, 20, 20], paint: { fill: { role: 'muted' } } } } },
      outputs: { parts: ['face'] },
    }));
    writeFileSync(join(folder, 'pack.json'), text({
      name, version: '1.0.0', license: 'MIT', description: 'A pack of the #1958 suite\'s ten-pack graph: one tile recipe.',
      requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' }, ...(k < GRAPH ? { packs: [`${gName(k + 1)}@1.0.0`] } : {}) },
      recipes: { [`${name}.tile@1`]: `${name}.tile@1.json` },
    }));
    out.push({ id: `acme/${name}`, version: '1.0.0', dir: folder });
  }
  return out;
}
/** A board listing only acme/g01@1.0.0, holding one tile of each of the ten packs. */
export const graphBoard = (): JsonObject => board('Ten packs', ['acme/g01@1.0.0'],
  Array.from({ length: GRAPH }, (_, i) => ({ id: `t${i + 1}`, kind: `${gName(i + 1)}.tile@1`, name: `Tile ${i + 1}`, order: ORDERS[i]!, params: {}, at: { pos: [20 + i * 30, 20, 0] } })));

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/200 and 202).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. Mains power never gates. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** The design's rule on five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const shownText = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit.toFixed(4)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shownText}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown: shownText };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: shownText };
  return { status: 'INCONCLUSIVE', shown: shownText };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
/** One warm-up, then five runs. */
export const five = (f: () => number): number[] => { f(); return [0, 1, 2, 3, 4].map(() => f()); };
