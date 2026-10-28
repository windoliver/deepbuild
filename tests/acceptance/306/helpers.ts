// Test-side tools for the #306 acceptance tests: `deep-show` built per build set (`r1`, a build without
// scene3d, and `full`, one with it, as #305's suite builds them) and driven by JSON lines; the scenario it
// runs (your session, the process table the peer check reads, panels, documents the hub stored, the packs
// installed in its store); the test packs of `fixtures/packs/`; the evidence store read through its public
// entry; and the checks the criteria's planted programs must fail, each returning its failures as sentences
// that name what failed. Nothing here stands in for the pack check, recipe expansion, the document check,
// patches or render-back.

import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/306 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The envelope's cost line: a full check at most 50 ms per 10,000 items (Document envelope; the issue's AC8). */
export const CHECK_BUDGET_MS = 50;

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
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Sorted copy, by code point. */
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** One canonical text per JSON value (keys sorted at every depth), so "the same bytes" is one string comparison. */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sorted(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** A fixture file of this suite, parsed. */
export function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, `fixture ${path}`);
}

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per build set, built once per file, each kept under its own name. No test
// canvas module: every pack this suite needs is data in `fixtures/packs/`.

/** `r1`: the build set without scene3d (text, look, marks2d, …); `full`: every canvas module, scene3d among them. */
export type BuildSet = 'r1' | 'full';
export interface Build { set: BuildSet }
export const R1: Build = { set: 'r1' };
export const FULL: Build = { set: 'full' };
const featuresOf = (build: Build): string[] => [build.set];
const nameOf = (build: Build): string => featuresOf(build).join('+');

function buildFeatures(features: string[]): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed build set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-306-bins-'));
    for (const build of builds) {
      const name = nameOf(build);
      if (made.has(name)) continue;
      const error = buildFeatures(featuresOf(build));
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(BUILT, bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(nameOf(build));
      if (!entry) throw Error(`the file didn't list the build ${nameOf(build)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(build).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW_NAME} run: ${run.error.message}`);
  expect(run.status, `${SHOW_NAME} run exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-306-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One piece of evidence, read by its hash through the evidence store's public entry and parsed as JSON. */
export async function readEvidenceJson(root: string, sha256: string): Promise<JsonValue> {
  const store = await openEvidenceStore({ root });
  return JSON.parse(Buffer.from(await store.read(sha256)).toString('utf8')) as JsonValue;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: an agent's session, the process table, panels, documents, packs.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1_000 } };
export const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };

/** The OS process table the peer check reads: `deep show` you ran, outside every agent's tree. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB73D', 1), b: ulid('01JB73D', 2), c: ulid('01JB73D', 3) } as const;
/** A patch's ULID. */
export const patchId = (n: number): string => ulid('01JB73P', n);

export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };

/** The test packs (README: Fixtures), each `{id: owner/name, dir}` as the scenario's `packs` and `install_pack` take them. */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(HERE, 'fixtures', 'packs', folder) });
export const CHART = pack('test/chart', '1.0.0', 'test-chart-1.0.0');
export const CHART_1_1 = pack('test/chart', '1.1.0', 'test-chart-1.1.0');
export const CHART_CHANGED = pack('test/chart', '1.0.0', 'test-chart-1.0.0-changed');
export const SOLID = pack('test/solid', '1.0.0', 'test-solid-1.0.0');
export const ALICE_FOLEY = pack('alice/foley', '1.0.0', 'alice-foley-1.0.0');
export const BOB_FOLEY = pack('bob/foley', '1.0.0', 'bob-foley-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;
export const packEntry = (p: PackFixture): JsonObject => ({ id: p.id, dir: p.dir });

/** A scenario with your session, the process table and the panel; each doc on `main` unless named; `packs` installed before the first call. */
export function scenario(evidence: string, docs: Record<string, string | JsonObject>, packs: readonly PackFixture[], calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const docsOut: JsonObject = {};
  for (const [id, d] of Object.entries(docs)) docsOut[id] = typeof d === 'string' ? { panel: d } : d;
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: docsOut, packs: packs.map(packEntry), ...extra, calls };
}

// ---------------------------------------------------------------------------------------------------
// Documents and calls

export const rect = (id: string, name: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } }, ...extra });
/** A recipe instance: its recipe's kind with the recipe's inputs as params. */
export const instance = (id: string, kind: string, params: JsonObject, order: string, pos: [number, number], extra: JsonObject = {}): JsonObject =>
  ({ id, kind, name: id, order, params, at: { pos: [pos[0], pos[1], 0] }, ...extra });

/** A board as an agent or your shell sends it: no `id`, no `layers`, no item `layer`; `packs` names each pack version it uses. */
export function board(title: string, packs: readonly string[], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #306 acceptance suite.`, size: [640, 360],
    packs: [...packs], items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

export const SIZE: [number, number] = [320, 180];
export interface ShowOptions { doc?: string; pixels?: boolean; t?: string; timing?: boolean }
/** A whole revision from your shell (`deep show`), with its issues and, with `pixels`, a snapshot of `SIZE` px. */
export function show(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const include = ['issues', ...(options.pixels ? ['pixels'] : []), ...(options.timing ? ['timing'] : [])];
  return { call: 'deep show', peer: YOU_PEER, doc: options.doc ?? DOC.a, document, include, ...(options.pixels ? { size: SIZE } : {}), ...(options.t ? { t: options.t } : {}) };
}
/** The same from the agent's session (`deep_show`). */
export function agentShow(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const { peer: _peer, ...rest } = show(document, options);
  return { ...rest, call: 'deep_show', session: ALPHA.id };
}
/** `deep show --check` from your shell: the document check's result. */
export function check(document: JsonObject, options: ShowOptions = {}): JsonObject {
  return { ...show(document, options), check: true };
}
/** A patch from your shell. */
export const patch = (doc: string, p: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, patch: p });
/** Your undo of patch `of`, as patch `id`. */
export const undo = (doc: string, id: string, of: string): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, undo: { patch: id, of } });
export const read = (doc: string): JsonObject => ({ call: 'read', doc, peer: YOU_PEER });
export const revisionsOf = (doc: string): JsonObject => ({ call: 'revisions', doc });
export const PACKS: JsonObject = { call: 'packs' };
export const installPack = (p: PackFixture): JsonObject => ({ call: 'install_pack', ...packEntry(p) });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; ids: string[]; path: string; what: string; raw: JsonObject }
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return {
    code: str(o['code'], `${what}.code`), severity: str(o['severity'], `${what}.severity`), ids: strs(o['ids'] ?? [], `${what}.ids`),
    path: typeof o['path'] === 'string' ? o['path'] : '', what: typeof o['what'] === 'string' ? o['what'] : '', raw: o,
  };
}
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** The issue's text, for "naming" checks: its code, IDs, path, what, and the pack fields a pack_missing carries. */
export const issueText = (i: Issue): string => canon(i.raw);
/** A name as a whole word in an issue's text (so `foley` doesn't match `alice/foley` alone). */
export const names = (i: Issue, name: string): boolean => issueText(i).includes(name);

export interface Snapshot { sha256: string; w: number; h: number }
export function snapshots(reply: JsonObject, what = 'the reply'): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const o = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(o['sha256'], `${what}: snapshots[${i}].sha256`), w: num(o['w'], `${what}: snapshots[${i}].w`), h: num(o['h'], `${what}: snapshots[${i}].h`) };
  });
}

export interface Revision { rev: number; hash: string; state: string }
export function revisions(reply: JsonObject): Revision[] {
  return arr(reply['revisions'], 'revisions').map((v, i) => {
    const o = obj(v, `revisions[${i}]`);
    return { rev: num(o['rev'], `revisions[${i}].rev`), hash: str(o['hash'], `revisions[${i}].hash`), state: str(o['state'], `revisions[${i}].state`) };
  });
}
/** The revisions of a document in the state `current`: one, or none when nothing was ever presented. */
export const currents = (reply: JsonObject): Revision[] => revisions(reply).filter((r) => r.state === 'current');

/** One recipe instance's expansion, as the reply's `expansions` row gives it (README: Reply fields added). */
export interface Expansion { instance: string; kind: string; pack: string; key: string; derived: Record<string, JsonObject>; seeds: Record<string, string> }
export function expansions(reply: JsonObject, what = 'the reply'): Expansion[] {
  return arr(reply['expansions'], `${what}: expansions`).map((v, i) => {
    const o = obj(v, `${what}: expansions[${i}]`);
    const derived = obj(o['derived'], `${what}: expansions[${i}].derived`);
    const seeds = obj(o['seeds'], `${what}: expansions[${i}].seeds`);
    return {
      instance: str(o['instance'], `${what}: expansions[${i}].instance`), kind: str(o['kind'], `${what}: expansions[${i}].kind`),
      pack: str(o['pack'], `${what}: expansions[${i}].pack`), key: str(o['key'], `${what}: expansions[${i}].key`),
      derived: Object.fromEntries(Object.entries(derived).map(([id, item]) => [id, obj(item, `${what}: derived ${id}`)])),
      seeds: Object.fromEntries(Object.entries(seeds).map(([id, seed]) => [id, str(seed, `${what}: seed of ${id}`)])),
    };
  });
}
/** The expansion of one instance. */
export function expansionOf(reply: JsonObject, instance: string, what = 'the reply'): Expansion {
  const rows = expansions(reply, what).filter((e) => e.instance === instance);
  expect(rows.length, `${what} has exactly one expansion of ${instance}; it has ${JSON.stringify(expansions(reply, what).map((e) => e.instance))}`).toBe(1);
  return rows[0]!;
}
/** The IDs the derived items `<instance>.<step>.<0..n-1>`. */
export const derivedIds = (instance: string, step: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${instance}.${step}.${i}`);

/** The instanced batches the snapshot's draw made, each with the items it draws (README: `batches`). */
export interface Batch { batch: string; items: string[] }
export function batches(reply: JsonObject, what = 'the reply'): Batch[] {
  return arr(reply['batches'], `${what}: batches`).map((v, i) => {
    const o = obj(v, `${what}: batches[${i}]`);
    return { batch: str(o['batch'], `${what}: batches[${i}].batch`), items: strs(o['items'], `${what}: batches[${i}].items`) };
  });
}

/** One row of the `packs` reply, or an `install_pack` reply. */
export interface PackRow { pack: string; version: string; state: string; checks: number; issues: Issue[] }
function packRowOf(v: JsonValue, what: string): PackRow {
  const o = obj(v, what);
  return { pack: str(o['pack'], `${what}.pack`), version: str(o['version'], `${what}.version`), state: str(o['state'] ?? o['outcome'], `${what}.state`), checks: num(o['checks'] ?? 0, `${what}.checks`), issues: issues(o, what) };
}
export function packRows(reply: JsonObject): PackRow[] {
  return arr(reply['packs'], 'packs: packs').map((v, i) => packRowOf(v, `packs[${i}]`));
}
export function packRow(reply: JsonObject, p: PackFixture): PackRow {
  const rows = packRows(reply).filter((r) => r.pack === p.id && r.version === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}; it has ${JSON.stringify(packRows(reply).map((r) => `${r.pack}@${r.version}`))}`).toBe(1);
  return rows[0]!;
}
export const installed = (reply: JsonObject, what = 'install_pack'): PackRow => packRowOf(reply, what);

/** The stored document a `read` reply carries, and its items. */
export function readItems(reply: JsonObject, what = 'read'): JsonObject {
  return obj(obj(reply['document'], `${what}: document`)['items'], `${what}: items`);
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

/**
 * AC4: the seeds of `instance`'s derived items come from (instance, step, index), so they are the same
 * whether the instance expands alone or beside `other`. Each failure names the derived item.
 */
export function seedFailures(alone: Expansion, together: Expansion, instance: string): string[] {
  const failures: string[] = [];
  const ids = sorted(Object.keys(together.seeds));
  if (ids.length === 0) failures.push(`${instance} reports no seeds for its derived items`);
  for (const id of ids) {
    if (!(id in alone.seeds)) { failures.push(`${id} has a seed when ${instance} expands beside another instance but none alone`); continue; }
    if (alone.seeds[id] !== together.seeds[id]) failures.push(`${id}'s seed is ${together.seeds[id]} beside another instance and ${alone.seeds[id]} alone: seeded by expansion order, not (instance, step, index)`);
  }
  return failures;
}

/**
 * AC5: after a change of inputs re-expands `instance`, the broken-out item `id` in the writer's layer keeps
 * the values it was expanded with (`before`), and is not among the instance's derived items. Each failure
 * names the item.
 */
export function brokenOutFailures(itemsAfter: JsonObject, expansionAfter: Expansion, id: string, before: JsonObject): string[] {
  const failures: string[] = [];
  const now = itemsAfter[id];
  if (!isObject(now)) failures.push(`${id} is no longer the writer's own item after the re-expansion`);
  else {
    for (const field of ['kind', 'params', 'at'] as const) {
      if (canon(now[field]) !== canon(before[field])) failures.push(`${id}'s ${field} was overwritten by the re-expansion: ${canon(now[field])}, expanded with ${canon(before[field])}`);
    }
  }
  if (id in expansionAfter.derived) failures.push(`${id} is among the instance's derived items again after the re-expansion, though it was broken out`);
  return failures;
}

/**
 * AC6: the pack `p`, whose requires.modules names `module`, is refused in a build without that module, with
 * `module_missing` naming the module. Each failure names the pack.
 */
export function packModuleFailures(row: PackRow, p: PackFixture, module: string): string[] {
  const failures: string[] = [];
  if (row.state !== 'refused') failures.push(`${packAt(p)} was ${row.state}, not refused, though its requires.modules names ${module}, which this build lacks`);
  const named = row.issues.filter((i) => i.code === 'module_missing' && names(i, module));
  if (named.length === 0) failures.push(`${packAt(p)}'s check has no module_missing issue naming ${module}; its issues: ${row.issues.map((i) => `${i.code} (${i.what})`).join('; ') || 'none'}`);
  return failures;
}

/**
 * AC7: `instance`, an entry `kind` of a pack name two owners publish, resolves through `expected` (the one
 * pack of that name the document names). Each failure names the entry.
 */
export function resolutionFailures(reply: JsonObject, instance: string, kind: string, expected: PackFixture): string[] {
  const rows = (Array.isArray(reply['expansions']) ? reply['expansions'] : []).filter((e) => isObject(e) && e['instance'] === instance) as JsonObject[];
  if (outcome(reply) === 'refused') return [`the document naming only ${packAt(expected)} was refused, so its entry ${kind} resolved through no pack: ${JSON.stringify(reply['issues']).slice(0, 600)}`];
  if (rows.length !== 1) return [`${kind}: the reply has ${rows.length} expansions of ${instance}, not one`];
  const got = String(rows[0]!['pack']);
  return got === packAt(expected) ? [] : [`${kind} resolved through ${got}, not ${packAt(expected)}, the one pack of that name the document names`];
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/305 and 14).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
