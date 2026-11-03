// Test-side tools for the #412 acceptance tests: `deep-show` built per Cargo feature set (a build set plus this
// suite's test features, as #200's, #185's and #411's suites build it); the `deep_kinds` call of `deep-show run`
// and the fields this suite reads from its replies (README: The surface under test); `deep-show kinds --dump` and
// `--diff`; `deep-canvas parse`, the grammars' parser and printer; `deep mcp`'s tool list; a gallery folder written
// for a test; a `deep-show run` kept open for timings; the merge base exported and built apart; and the
// reference-Mac gate with the design's judge for timing results. Nothing here stands in for deep_kinds, the
// validator, the seal, a kit, the sheet, the dump, the diff or the grammars: every answer read here is the
// binary's own. The `...Failures` functions are the criteria's checks: each returns sentences naming what failed,
// so a test runs it on the right program (no failures) and on the criterion's planted program (a failure naming
// what the criterion says).

import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/412 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const SHOW_NAME = 'deep-show';
export const CANVAS_NAME = 'deep-canvas';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** A d1 digest: 64 lowercase hex, with or without the contracts' `d1:` prefix. */
export const DIGEST = /^(d1:)?[0-9a-f]{64}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
/** AC10: no reply passes 64 KB without a cursor. */
export const REPLY_CAP = 65_536;
/** AC15: the sheet's cap. */
export const SHEET_CAP = 32_768;

// ---------------------------------------------------------------------------------------------------
// Names this suite chooses (README: The surface under test).

export const MARK = 'test.mark@1';
export const SLOT = 'check.kind@1';
export const SIM = 'test.sim@1';
export const SIM_B = 'test.sim.b';
export const SIM_A = 'test.sim.a';
export const PREVIEW_KIND = 'test.preview.blob@1';
export const PREVIEW_TRACKING = '#412';
export const CUE_REGISTRY = 'test.cue.kind@1';
export const POP_IN = 'pop_in';
export const CUE_LIST = 'test.cue.list@1';
/** The pop-in's spring and default spans, as the README fixes them for the test features. */
export const POP_SPRING = { frequency: 4, damping_ratio: 0.3 };
export const POP_SPAN = { 'test-cue': 0.5, 'test-cue-span': 0.8 } as const;
export const WORDY = 'test.wordy.long@1';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
/** Whether a value's JSON text holds `needle`. */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const bytesOf = (value: JsonValue | undefined): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
export const sha256Of = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}
export function writeJson(path: string, value: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** No failures; the message lists them. */
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
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

export type BuildSet = 'core' | 'full';
/** This suite's test features (README: Test features), and the ones #185 and #200 left. */
export type TestFeature = 'test-sim-b' | 'test-mark' | 'test-preview' | 'test-cue' | 'test-cue-span' | 'test-ring-a' | 'test-ring-b' | 'test-sheet-wordy';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const CORE: Build = { set: 'core' };
export const FULL: Build = { set: 'full' };
export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

function cargo(root: string, args: string[], env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** `cargo build --locked --bin deep-show --no-default-features --features …` in `root`, the binary copied to `to`; '' or cargo's error. */
export function buildTo(root: string, features: string[], to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargo(root, ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')], env);
  if (error === '') copyFileSync(join(targetOf(root, { ...process.env, ...env }), 'debug', exe(SHOW_NAME)), to);
  return error;
}

export interface Builds { bin: (build: Build) => string; parser: () => string }

/**
 * Builds every listed feature set once, before the file's tests (and, with `parser`, `deep-canvas`, the grammars'
 * command); a test that asks for a build that failed fails with cargo's error.
 */
export function useBuilds(builds: readonly Build[], options: { parser?: boolean } = {}): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  let parser = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-412-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      made.set(name, { bin, error: buildTo(REPO, featuresOf(build), bin) });
    }
    if (options.parser) {
      const bin = join(dir, CANVAS_NAME);
      const error = cargo(REPO, ['build', '--locked', '-p', 'deep-canvas', '--bin', CANVAS_NAME], {});
      if (error === '') copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(CANVAS_NAME)), bin);
      parser = { bin, error };
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(buildName(build));
      if (!entry) throw Error(`the file didn't list the build ${buildName(build)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(build).join(',')}`).toBe('');
      return entry.bin;
    },
    parser(): string {
      expect(parser.error, `the binary builds: ${CANVAS_NAME}`).toBe('');
      return parser.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-412-ev-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const dirs: string[] = [];
/** A scratch folder deleted after the file. */
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `deep-412-${tag}-`)));
  dirs.push(d);
  return d;
}
export function useTempDirs(): void {
  afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
}

// The world the scenarios share: two agents' sessions, the process table, a panel, minted documents.
export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: kinds', process: { pid: 4100, start: 1_000 } };
export const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 4100, ppid: 3000, start: 1_000 },
];
export const PANELS: JsonObject = { main: { rect: [0, 0, 1200, 800] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JD412D', 1), b: ulid('01JD412D', 2), c: ulid('01JD412D', 3), d: ulid('01JD412D', 4) } as const;

export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
/** test/testpack@1.0.0: testpack.ring {size: 12} in test.mark@1 (#200's fixture, copied). */
export const TESTPACK = pack('test/testpack', '1.0.0', 'testpack-1.0.0');
/** test/words@1.0.0: a tool-word pack whose aliases map Circle and Rectangle, each with its stated conversion. */
export const WORDS = pack('test/words', '1.0.0', 'words-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

export interface Installed { slot: string; fill: string; kit: JsonObject }
/** A plug-in's entry in a registry, with the kit result the hub recorded for it on this core (README: plugin_entries). */
export interface PluginEntry { plugin: string; registry: string; entry: JsonObject; kit: JsonObject }

export interface World {
  packs?: readonly PackFixture[]; installed?: readonly Installed[]; plugin_entries?: readonly PluginEntry[];
  gallery?: string; corpus_runs?: readonly JsonObject[]; docs?: readonly string[];
}
/** A scenario with the sessions, the process table and the panel; `docs` each on `main`; the rest as README says. */
export function scenario(evidence: string, calls: JsonObject[], world: World = {}): JsonObject {
  const docs: JsonObject = {};
  for (const id of world.docs ?? Object.values(DOC)) docs[id] = { panel: 'main' };
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs,
    ...(world.packs ? { packs: world.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(world.installed ? { installed: world.installed.map((i) => ({ slot: i.slot, fill: i.fill, kit: i.kit })) } : {}),
    ...(world.plugin_entries ? { plugin_entries: world.plugin_entries.map((p) => ({ plugin: p.plugin, registry: p.registry, entry: p.entry, kit: p.kit })) } : {}),
    ...(world.gallery ? { gallery: world.gallery } : {}),
    ...(world.corpus_runs ? { corpus_runs: [...world.corpus_runs] } : {}),
    calls,
  };
}

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** One startup and a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Documents and deep_show (#393, #411).

export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, drawn by a test agent for the #412 suite.`, size: [640, 360],
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const rect = (id: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Box ${id}`, order, params: { box, paint: { fill: { role: 'muted' } } }, ...extra });
export const circle = (id: string, kind: string, params: JsonObject, order = 'a1'): JsonObject => ({ id, kind, name: `Circle ${id}`, order, params });
/** Alpha's deep_show of a whole revision, with its issues. */
export const showDoc = (doc: string, document: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'], ...extra });
/** Alpha's deep_query (#411). */
export const query = (doc: string, fields: JsonObject): JsonObject => ({ call: 'deep_query', session: ALPHA.id, doc, ...fields });

/** Every issue and notice a deep_show reply carries, with its code, path, ids and close names. */
export interface Flagged { code: string; path: string; ids: string[]; close: JsonObject[]; raw: JsonObject }
export function flagged(reply: JsonObject): Flagged[] {
  const out: Flagged[] = [];
  for (const key of ['issues', 'notices']) {
    const list = reply[key];
    if (!Array.isArray(list)) continue;
    for (const i of list) {
      if (!isObject(i)) continue;
      out.push({
        code: typeof i['code'] === 'string' ? i['code'] : '',
        path: typeof i['path'] === 'string' ? i['path'] : '',
        ids: Array.isArray(i['ids']) ? i['ids'].map(String) : [],
        close: Array.isArray(i['close']) ? i['close'].filter(isObject) : [],
        raw: i,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds (README: deep_kinds).

/** One deep_kinds call: `op` and its fields. */
export const kinds = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
/** A deep_kinds refusal: `{"error": error@2}`; undefined for an answer. */
export const errorOf = (reply: JsonObject): JsonObject | undefined => (isObject(reply['error']) ? reply['error'] : undefined);
/** A deep_kinds answer, never a refusal. */
export function answer(reply: JsonObject, what: string): JsonObject {
  expect(errorOf(reply), `${what} answers, not refuses: ${show(reply)}`).toBeUndefined();
  expect(reply['code'], `${what} is a deep_kinds answer, not the call refused as input: ${show(reply)}`).not.toBe('bad_input');
  return reply;
}

export interface KitResult { verdict: string; raw: JsonObject }
export interface Entry {
  name: string; registry: string; origin: string; available: boolean | undefined; stability: string | undefined;
  example: string | null | undefined; kit: KitResult | undefined; raw: JsonObject;
}
export interface Listed { kind: string; name: string; entries: Entry[]; raw: JsonObject }
export interface Listing {
  core_version: string; module_set: string; modules: JsonObject[]; interfaces: JsonObject[]; listed: Listed[];
  pages: JsonObject[];
}
function entryOf(v: JsonValue, what: string): Entry {
  const o = obj(v, what);
  return {
    name: str(o['name'], `${what}.name`),
    registry: typeof o['registry'] === 'string' ? o['registry'] : '',
    origin: typeof o['origin'] === 'string' ? o['origin'] : '',
    available: typeof o['available'] === 'boolean' ? o['available'] : undefined,
    stability: typeof o['stability'] === 'string' ? o['stability'] : undefined,
    example: typeof o['example'] === 'string' ? o['example'] : o['example'] === null ? null : undefined,
    kit: isObject(o['kit']) ? { verdict: String(o['kit']['verdict']), raw: o['kit'] } : undefined,
    raw: o,
  };
}
/**
 * deep_kinds `list`, every page followed by its cursor until none is left; a registry split across pages is one
 * row with its entries in order. Each page must be under the reply cap or carry a cursor (AC10).
 */
export function listAll(bin: string, evidence: string, world: World = {}, planted?: string, filter: JsonObject = {}): Listing {
  const pages: JsonObject[] = [];
  let cursor: string | undefined;
  for (let k = 0; k < 200; k++) {
    const [reply] = run(bin, scenario(evidence, [kinds('list', { ...filter, ...(cursor ? { cursor } : {}) })], world), planted);
    const page = answer(reply!, `deep_kinds list, page ${k + 1}`);
    pages.push(page);
    cursor = typeof page['next'] === 'string' && page['next'] !== '' ? page['next'] : undefined;
    if (!cursor) break;
  }
  expect(cursor, 'deep_kinds list ends within 200 pages').toBeUndefined();
  const first = pages[0]!;
  const listed: Listed[] = [];
  for (const [p, page] of pages.entries()) {
    for (const [i, v] of arr(page['registries'], `deep_kinds list page ${p + 1}: registries`).entries()) {
      const o = obj(v, `page ${p + 1}: registries[${i}]`);
      const kind = str(o['kind'], `page ${p + 1}: registries[${i}].kind (registry or slot)`);
      const name = str(o['name'], `page ${p + 1}: registries[${i}].name`);
      const entries = Array.isArray(o['entries']) ? o['entries'].map((e, j) => entryOf(e, `${name}.entries[${j}]`)) : [];
      const had = listed.find((l) => l.kind === kind && l.name === name);
      if (had) had.entries.push(...entries);
      else listed.push({ kind, name, entries, raw: o });
    }
  }
  return {
    core_version: str(first['core_version'], 'deep_kinds list: core_version'),
    module_set: str(first['module_set'], 'deep_kinds list: module_set'),
    modules: arr(first['modules'], 'deep_kinds list: modules').map((m, i) => obj(m, `modules[${i}]`)),
    interfaces: arr(first['interfaces'], 'deep_kinds list: interfaces').map((m, i) => obj(m, `interfaces[${i}]`)),
    listed, pages,
  };
}
export function theListed(l: Listing, name: string, kind = 'registry'): Listed {
  const found = l.listed.find((x) => x.kind === kind && x.name === name);
  expect(found, `deep_kinds lists the ${kind} ${name}; it lists ${l.listed.map((x) => `${x.name} (${x.kind})`).join(', ') || 'nothing'}`).toBeDefined();
  return found!;
}
export function theEntry(l: Listed, name: string): Entry {
  const e = l.entries.find((x) => x.name === name);
  expect(e, `${l.name} holds the entry ${name}; it holds ${l.entries.map((x) => x.name).join(', ') || 'none'}`).toBeDefined();
  return e!;
}
/** Every entry the listing holds, across its registries. */
export const allEntries = (l: Listing): Entry[] => l.listed.flatMap((x) => x.entries);
/** The one entry named `name` anywhere in the listing. */
export function entryNamed(l: Listing, name: string): Entry {
  const found = allEntries(l).filter((e) => e.name === name);
  expect(found.length, `deep_kinds lists one entry ${name}; found ${found.length}`).toBe(1);
  return found[0]!;
}

/** The fields every entry carries, in the one shape (README: The one shape). */
export const ONE_SHAPE = ['name', 'registry', 'origin', 'binds', 'schema', 'example', 'since', 'digest', 'kit', 'cost', 'stability', 'available'] as const;
export const ORIGINS = ['first_party', 'pack', 'plugin', 'agent'];
/** An entry in the one shape: each field present, origin one of four, a digest, a kit result. */
export function oneShapeFailures(e: Entry): string[] {
  const failures: string[] = [];
  for (const k of ONE_SHAPE) if (!(k in e.raw)) failures.push(`${e.name}: no ${k} in the one shape: ${show(e.raw, 800)}`);
  if (!ORIGINS.includes(e.origin)) failures.push(`${e.name}: origin ${e.origin} is not one of ${ORIGINS.join(', ')}`);
  if (typeof e.raw['digest'] !== 'string' || !DIGEST.test(e.raw['digest'])) failures.push(`${e.name}: digest ${show(e.raw['digest'])} is not a d1 digest`);
  if (!e.kit || !['PASS', 'FAIL'].includes(e.kit.verdict)) failures.push(`${e.name}: no kit result: ${show(e.raw['kit'])}`);
  if (e.example !== null && e.example !== undefined && !SHA256.test(e.example)) failures.push(`${e.name}: example ${e.example} is not a sha256`);
  return failures;
}
/** An entry whose kit hasn't passed on this core is listed unavailable; one whose kit passed may be available. */
export function availabilityFailures(entries: readonly Entry[]): string[] {
  return entries.filter((e) => e.kit?.verdict !== 'PASS' && e.available !== false).map((e) => `${e.name}: its kit result is ${e.kit?.verdict ?? 'missing'} on this core, yet it is listed ${e.available === true ? 'available' : 'without available: false'}`);
}

// ---------------------------------------------------------------------------------------------------
// The include fixture (AC4, AC8, AC15): names that must and must not appear for a query, a word or a registry.

export interface IncludeCase { word?: string; query?: string; registry?: string; include?: string[]; exclude?: string[]; no_match?: boolean }
export const INCLUDE_FIXTURE = join(FIXTURES, 'kinds-catalog-include-exclude.json');
export function includeCases(): IncludeCase[] {
  return arr(obj(readJson(INCLUDE_FIXTURE), 'the include fixture')['cases'], 'the include fixture: cases') as unknown as IncludeCase[];
}
/** The names an answer gives: a word's target, each hit's name and title, each listed entry's name. */
export function namesOf(reply: JsonObject): string[] {
  const out: string[] = [];
  if (typeof reply['target'] === 'string') out.push(reply['target']);
  for (const h of Array.isArray(reply['hits']) ? reply['hits'] : []) {
    if (!isObject(h)) continue;
    for (const k of ['name', 'title']) if (typeof h[k] === 'string') out.push(h[k] as string);
  }
  for (const r of Array.isArray(reply['registries']) ? reply['registries'] : []) {
    if (isObject(r) && Array.isArray(r['entries'])) for (const e of r['entries']) if (isObject(e) && typeof e['name'] === 'string') out.push(e['name']);
  }
  return out;
}
/** One case of the include fixture held to its answer; each failure names the case's word, query or registry and the name. */
export function includeFailures(c: IncludeCase, reply: JsonObject): string[] {
  const label = c.word !== undefined ? `word ${c.word}` : c.query !== undefined ? `query ${c.query}` : `registry ${c.registry ?? '?'}`;
  if (errorOf(reply)) return [`${label}: refused: ${show(reply)}`];
  const names = namesOf(reply).map((n) => n.toLowerCase());
  const failures: string[] = [];
  if (c.no_match) {
    if (reply['code'] !== 'no_match') failures.push(`${label}: answered ${show(reply, 400)}, not no_match`);
    if (names.length) failures.push(`${label}: no_match, yet names ${names.join(', ')}`);
  }
  for (const n of c.include ?? []) if (!names.some((x) => x.includes(n.toLowerCase()))) failures.push(`${label}: ${n} must appear; the answer names ${names.join(', ') || 'nothing'}`);
  for (const n of c.exclude ?? []) if (names.some((x) => x === n.toLowerCase())) failures.push(`${label}: ${n} must not appear, yet it does`);
  return failures;
}
/** The call one case asks deep_kinds. */
export function includeCall(c: IncludeCase): JsonObject {
  if (c.word !== undefined) return kinds('word', { word: c.word });
  if (c.query !== undefined) return kinds('search', { query: c.query });
  return kinds('list', { registry: c.registry ?? '' });
}

// ---------------------------------------------------------------------------------------------------
// Hub slots beside the registries (AC9), as #200's check reads deep://registries, on the merged listing.

export const KIT_COMMAND: JsonObject = { verdict: 'PASS', rules: [{ rule: 'catalogue', verdict: 'PASS' }, { rule: 'deadline', verdict: 'PASS' }] };
export const KIT_JOURNEY: JsonObject = { verdict: 'PASS', rules: [{ rule: 'catalogue', verdict: 'PASS' }, { rule: 'output', verdict: 'PASS' }, { rule: 'assertion', verdict: 'PASS' }] };
export const INSTALLED: Installed[] = [{ slot: SLOT, fill: 'command', kit: KIT_COMMAND }, { slot: SLOT, fill: 'journey', kit: KIT_JOURNEY }];
/** The listing holds `slot` beside the registries, marked as a slot, with each installed fill and its own kit result, and no registry lists a fill as an entry. Each failure names the slot. */
export function slotListingFailures(l: Listing, slot: string, kits: Record<string, JsonObject>): string[] {
  const failures: string[] = [];
  const row = l.listed.find((x) => x.name === slot);
  if (!row) failures.push(`${slot}: deep_kinds leaves the hub slot out`);
  else if (row.kind !== 'slot') failures.push(`${slot}: listed as ${row.kind}, not marked as a slot`);
  else {
    const fills = Array.isArray(row.raw['fills']) ? row.raw['fills'].filter(isObject) : [];
    for (const [name, kit] of Object.entries(kits)) {
      const f = fills.find((x) => x['name'] === name);
      if (!f) failures.push(`${slot}: its installed fill ${name} isn't listed`);
      else {
        const rules = (Array.isArray(kit['rules']) ? kit['rules'] : []).filter(isObject).map((r) => String(r['rule']));
        const own = mentions(f['kit'], `"verdict":"${String(kit['verdict'])}"`) && rules.every((rule) => mentions(f['kit'], `"rule":"${rule}"`));
        if (!own) failures.push(`${slot}: its fill ${name} is listed without its own kit result: ${show(f['kit'])}`);
      }
    }
  }
  for (const x of l.listed.filter((y) => y.kind !== 'slot')) {
    for (const name of Object.keys(kits)) if (x.entries.some((e) => e.name === name)) failures.push(`${slot}: its fill ${name} is listed as an entry of the registry ${x.name}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Interfaces (AC7): deep_kinds against deep://schedule.

/** deep_kinds names `iface` with the digest and the implementation deep://schedule gives it. Each failure names the interface. */
export function interfaceFailures(l: Listing, schedule: JsonObject, iface: string): string[] {
  const planned = isObject(schedule['interfaces']) && isObject(schedule['interfaces'][iface]) ? schedule['interfaces'][iface] : undefined;
  if (!planned) return [`${iface}: deep://schedule doesn't name it: ${show(schedule['interfaces'])}`];
  const impl = isObject(planned['implementation']) ? planned['implementation']['name'] : undefined;
  const row = l.interfaces.find((i) => i['name'] === iface);
  if (!row) return [`${iface}: deep_kinds doesn't list it beside the canvas modules; it lists ${l.interfaces.map((i) => String(i['name'])).join(', ') || 'no interface'}`];
  const failures: string[] = [];
  if (row['digest'] !== planned['digest']) failures.push(`${iface}: deep_kinds gives the digest ${show(row['digest'])}, deep://schedule ${show(planned['digest'])}`);
  if (row['implementation'] !== impl) failures.push(`${iface}: deep_kinds names the implementation ${show(row['implementation'])}, deep://schedule ${show(impl ?? null)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Literal fields (AC12): every field that takes a literal lists the forms its grammar accepts.

export interface FieldRow { entry: string; name: string; unit: string; grammar: string; forms: string[]; raw: JsonObject }
/** Every field of every entry: `fields` in the one shape. */
export function fieldsOf(l: Listing): FieldRow[] {
  const out: FieldRow[] = [];
  for (const e of allEntries(l)) {
    for (const f of Array.isArray(e.raw['fields']) ? e.raw['fields'].filter(isObject) : []) {
      out.push({
        entry: e.name, name: String(f['name']), unit: typeof f['unit'] === 'string' ? f['unit'] : '',
        grammar: typeof f['grammar'] === 'string' ? f['grammar'] : '',
        forms: Array.isArray(f['forms']) ? f['forms'].map(String) : [], raw: f,
      });
    }
  }
  return out;
}
/** `deep-canvas parse <grammar>` on each line: the parser's verdict and its printer's text. */
export function parseAll(parser: string, grammar: string, inputs: JsonObject[]): JsonObject[] {
  const s = start(parser, ['parse', grammar], inputs, 120_000);
  expect(s.status, `${CANVAS_NAME} parse ${grammar} exits 0: ${s.stderr.slice(-800)}`).toBe(0);
  expect(s.lines.length, `${CANVAS_NAME} parse ${grammar}: one line per input`).toBe(inputs.length);
  return s.lines.map((l, i) => obj(l, `${CANVAS_NAME} parse ${grammar}: line ${i + 1}`));
}
/**
 * Each listed form parses in its field's grammar to the field's unit and prints back as itself; a field with a unit
 * lists its grammar and at least one form. Each failure names the entry, the field and the form.
 */
export function formFailures(fields: readonly FieldRow[], parser: string): string[] {
  const failures: string[] = [];
  for (const f of fields.filter((x) => x.unit !== '' && (x.grammar === '' || x.forms.length === 0))) failures.push(`${f.entry}/${f.name}: takes a literal in ${f.unit} but lists no grammar and forms: ${show(f.raw, 400)}`);
  const withForms = fields.filter((x) => x.forms.length > 0);
  for (const grammar of [...new Set(withForms.map((x) => x.grammar))]) {
    const rows = withForms.filter((x) => x.grammar === grammar).flatMap((f) => f.forms.map((form) => ({ f, form })));
    if (!['unit', 'time'].includes(grammar)) { failures.push(...rows.map(({ f, form }) => `${f.entry}/${f.name}: form ${form} names the grammar ${grammar || '(none)'}, not unit or time`)); continue; }
    const answers = parseAll(parser, grammar, rows.map(({ f, form }) => (grammar === 'unit' ? { text: form, unit: f.unit } : { text: form })));
    rows.forEach(({ f, form }, i) => {
      const a = answers[i]!;
      if (a['ok'] !== true) failures.push(`${f.entry}/${f.name}: offers the form ${form}, which the ${grammar} grammar refuses (${show(a['code'] ?? null)}) for ${f.unit || 'its unit'}`);
      else if (a['printed'] !== form) failures.push(`${f.entry}/${f.name}: offers the form ${form}, which the grammar's printer prints as ${show(a['printed'] ?? null)}`);
    });
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Stability (AC13).

export const STABILITIES = ['stable', 'preview', 'retired'];
/** Every entry lists its stability, and a preview entry the issue that tracks it. Each failure names the entry. */
export function stabilityFailures(entries: readonly Entry[]): string[] {
  const failures: string[] = [];
  for (const e of entries) {
    if (!e.stability || !STABILITIES.includes(e.stability)) failures.push(`${e.name}: no stability (${show(e.raw['stability'] ?? null)})`);
    else if (e.stability === 'preview' && !(typeof e.raw['tracking'] === 'string' && e.raw['tracking'] !== '')) failures.push(`${e.name}: a preview entry with no tracking issue`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Moves at defaults (AC14), against the expansion's own values read through deep_query.

export const FLICKS_PER_SECOND = 705_600_000;
/** The finest time the time grammar writes as a decimal of seconds: 441 flicks, 1/1,600,000 s. */
const GRID = 1_600_000;
/** `t` seconds on the grid, written in the time grammar (a whole number of flicks). */
export function timeText(seconds: number): { text: string; seconds: number } {
  const k = Math.round(seconds * GRID);
  const ns = (BigInt(k) * 625n).toString().padStart(10, '0');
  return { text: `${ns.slice(0, -9)}.${ns.slice(-9)}s`, seconds: k / GRID };
}
/** A damped spring's displacement released from rest at 1 after `u` seconds (ω0 = 2π f, ζ). */
export function springFromRest(f: number, z: number, u: number): number {
  const w = 2 * Math.PI * f;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return Math.exp(-z * w * u) * (Math.cos(wd * u) + ((z * w) / wd) * Math.sin(wd * u));
  }
  if (z === 1) return Math.exp(-w * u) * (1 + w * u);
  const root = Math.sqrt(z * z - 1);
  const r1 = -w * (z - root);
  const r2 = -w * (z + root);
  const c2 = -r1 / (r2 - r1);
  return (1 - c2) * Math.exp(r1 * u) + c2 * Math.exp(r2 * u);
}
export interface Move { path: string; from: number; to: number; start: number; span: number; frequency: number; damping: number; decay: number; peakAt: number; peakValue: number; raw: JsonObject }
/** The entry's one scale move, read loosely, so a wrong listing's shape names what it lacks instead of throwing. */
export function scaleMove(e: Entry): Move | string {
  const moves = Array.isArray(e.raw['moves']) ? e.raw['moves'].filter(isObject) : [];
  const scale = moves.filter((m) => typeof m['path'] === 'string' && /scale$/.test(m['path']));
  if (scale.length !== 1) return `${e.name}: lists ${scale.length} scale moves, not one: ${show(e.raw['moves'] ?? null)}`;
  const m = scale[0]!;
  const spring = isObject(m['ease']) && isObject(m['ease']['spring']) ? m['ease']['spring'] : {};
  const peak = isObject(spring['peak']) ? spring['peak'] : {};
  const n = (v: JsonValue | undefined): number => (typeof v === 'number' ? v : Number.NaN);
  return {
    path: String(m['path']), from: n(m['from']), to: n(m['to']), start: n(m['start']), span: n(m['span']),
    frequency: n(spring['frequency']), damping: n(spring['damping_ratio']), decay: n(spring['decay']),
    peakAt: n(peak['at']), peakValue: n(peak['value']), raw: m,
  };
}
export const EPS = 1e-9;
const off = (a: number, b: number): boolean => !(Math.abs(a - b) <= EPS);
/** The value a deep_query `values` entry holds at time index i: a number, or every component of a vector the same number. */
function scalarOf(v: JsonValue | undefined): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && x === v[0])) return v[0] as number;
  return Number.NaN;
}
/** The sample times the expansion is read at: start, the peak, the end and eight between, each on the time grammar's grid. */
export function sampleTimes(m: Move): { text: string; seconds: number }[] {
  const at = [m.start, m.start + m.peakAt, m.start + m.span, ...[1, 2, 3, 4, 5, 6, 7].map((i) => m.start + (m.span * i) / 8.5)];
  return at.map((t) => timeText(Number.isFinite(t) ? t : 0));
}
/**
 * The listed move against the expansion's values at the sample times (deep_query `values` of the target's path):
 * from at start, to at the end, the listed peak at the peak, the spring's closed form with the listed frequency
 * and damping ratio between, and the decay its frequency and damping give; each within 1e-9. Each failure names
 * the entry and the field.
 */
export function moveFailures(entry: string, m: Move, values: readonly JsonValue[]): string[] {
  const failures: string[] = [];
  for (const k of ['from', 'to', 'start', 'span', 'frequency', 'damping', 'decay', 'peakAt', 'peakValue'] as const) {
    if (!Number.isFinite(m[k])) failures.push(`${entry}: ${k === 'peakAt' || k === 'peakValue' ? 'peak' : k}: not listed as a number`);
  }
  if (failures.length) return failures;
  const times = sampleTimes(m);
  const v = times.map((_, i) => scalarOf(values[i]));
  if (v.some((x) => !Number.isFinite(x))) return [`${entry}: the expansion's values at the sample times aren't numbers: ${show(values as JsonValue[])}`];
  if (off(v[0]!, m.from)) failures.push(`${entry}: from: the listing says ${m.from}, the expansion holds ${v[0]} at its start`);
  if (off(v[2]!, m.to)) failures.push(`${entry}: span: the listing ends at ${m.start + m.span} s with ${m.to}, the expansion holds ${v[2]} there`);
  if (off(v[1]!, m.peakValue)) failures.push(`${entry}: peak: the listing says ${m.peakValue} at ${m.peakAt} s, the expansion holds ${v[1]} there`);
  if (off(m.decay, 2 * Math.PI * m.frequency * m.damping)) failures.push(`${entry}: decay: the listing says ${m.decay}, its frequency and damping ratio give ${2 * Math.PI * m.frequency * m.damping}`);
  for (let i = 3; i < times.length; i++) {
    const u = times[i]!.seconds - m.start;
    const want = m.to + (m.from - m.to) * springFromRest(m.frequency, m.damping, u);
    if (off(v[i]!, want)) failures.push(`${entry}: frequency: the expansion holds ${v[i]} at ${times[i]!.seconds} s, the listed spring (${m.frequency} Hz, ζ ${m.damping}) gives ${want}`);
    if (v[i]! > m.peakValue + EPS) failures.push(`${entry}: peak: the expansion reaches ${v[i]} at ${times[i]!.seconds} s, past the listed peak ${m.peakValue}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The sheet (AC15).

/** Every available entry of the listing is named in the sheet. Each failure names the entry. */
export function sheetIncludeFailures(sheet: string, l: Listing): string[] {
  return allEntries(l).filter((e) => e.available !== false).filter((e) => !sheet.includes(e.name)).map((e) => `${e.name}: available in the listing, missing from the sheet`);
}

// ---------------------------------------------------------------------------------------------------
// The dump and the diff (AC16).

export const DUMP_SCHEMA = join(REPO, 'packages/contracts/canvas-schemas/kinds.dump@1.json');
/** `deep-show kinds <args> [--planted <name>]`: its one JSON line. */
export function kindsCommand(bin: string, args: string[], planted?: string): JsonObject {
  const all = ['kinds', ...args, ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, all, [], 600_000);
  expect(s.status, `${SHOW_NAME} ${all.join(' ')} exits 0: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-800)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} ${all.join(' ')}: one JSON line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} ${all.join(' ')}: its line`);
  expect(out['ok'], `${SHOW_NAME} ${all.join(' ')} answers ok: ${show(out)}`).toBe(true);
  return out;
}
/** Every object in a JSON value whose `name` is `name`. */
export function objectsNamed(v: JsonValue | undefined, name: string, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(v)) for (const x of v) objectsNamed(x, name, out);
  else if (isObject(v)) {
    if (v['name'] === name) out.push(v);
    for (const x of Object.values(v)) objectsNamed(x, name, out);
  }
  return out;
}
export interface Change { entry: string; field: string; change: string; raw: JsonObject }
/** B's ring@2 against A's ring@1: exactly thick renamed to stroke_width, dash retired, segments' default 32 → 64. Each failure names the field. */
export function diffFailures(changes: readonly JsonValue[]): string[] {
  const rows: Change[] = changes.filter(isObject).map((c) => ({ entry: String(c['entry'] ?? ''), field: String(c['field'] ?? ''), change: String(c['change'] ?? ''), raw: c }));
  const failures: string[] = [];
  const ring = (c: Change): boolean => /^ring@[12]$/.test(c.entry);
  const thick = rows.filter((c) => ring(c) && c.field === 'thick');
  if (!(thick.length === 1 && thick[0]!.change === 'renamed' && thick[0]!.raw['to'] === 'stroke_width')) failures.push(`thick: the diff gives ${show(thick.map((c) => c.raw))}, not one change renaming it to stroke_width`);
  if (rows.some((c) => ring(c) && c.field === 'stroke_width')) failures.push(`thick: the diff lists stroke_width on its own (${show(rows.filter((c) => c.field === 'stroke_width').map((c) => c.raw))}), so it read the rename by spelling`);
  const dash = rows.filter((c) => ring(c) && c.field === 'dash');
  if (!(dash.length === 1 && dash[0]!.change === 'retired')) failures.push(`dash: the diff gives ${show(dash.map((c) => c.raw))}, not one change retiring it`);
  const segments = rows.filter((c) => ring(c) && c.field === 'segments');
  if (!(segments.length === 1 && segments[0]!.change === 'default' && segments[0]!.raw['from'] === 32 && segments[0]!.raw['to'] === 64)) failures.push(`segments: the diff gives ${show(segments.map((c) => c.raw))}, not its default changed from 32 to 64`);
  if (rows.length !== 3) failures.push(`the diff lists ${rows.length} changes, not exactly 3: ${show(rows.map((c) => c.raw), 3000)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Close names (AC11, AC17).

/** The reply flags `code` at a path ending in `/${at}` on item `id`, naming `name` among at most three close names (first, with `first`). Each failure names `subject`. */
export function closeNameFailures(reply: JsonObject, want: { code: string; id: string; at: string; name: string; subject: string; first?: boolean; renamed_in?: string }): string[] {
  const hits = flagged(reply).filter((f) => f.code === want.code && (f.ids.includes(want.id) || f.path.includes(`/${want.id}/`)) && f.path.endsWith(`/${want.at}`));
  if (!hits.length) return [`${want.subject}: the reply flags no ${want.code} at …/${want.at} on ${want.id}: ${show(flagged(reply).map((f) => f.raw) as JsonValue[])}`];
  const failures: string[] = [];
  for (const h of hits) {
    const names = h.close.map((c) => String(c['name']));
    if (names.length === 0) failures.push(`${want.subject}: ${want.code} names no close name: ${show(h.raw)}`);
    if (names.length > 3) failures.push(`${want.subject}: ${want.code} names ${names.length} close names, more than three: ${names.join(', ')}`);
    if (!names.includes(want.name)) failures.push(`${want.subject}: ${want.code} doesn't name ${want.name} among its close names (${names.join(', ') || 'none'})`);
    if (want.first && names[0] !== want.name) failures.push(`${want.subject}: ${want.code}'s first name is ${names[0] ?? 'none'}, not ${want.name}`);
    if (want.renamed_in && h.close[0]?.['renamed_in'] !== want.renamed_in) failures.push(`${want.subject}: ${want.code}'s first name carries renamed_in ${show(h.close[0]?.['renamed_in'] ?? null)}, not ${want.renamed_in}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The gallery (AC5, AC18): a folder written for a test, used in place of the installed one.

export interface GalleryExample { file: string; title: string; steps: number; words: string[]; document: JsonObject; hash: string }
export interface Gallery { dir: string; examples: GalleryExample[]; guide: { name: string; text: string } }
const exampleDoc = (title: string, n: number): JsonObject => board(title, Array.from({ length: n }, (_, i) => rect(`box-${i}`, [20 + 40 * i, 40, 30, 30], `a${i}`)));
/** A gallery folder (README: The gallery folder): three examples and one guide of about 80 KB, ASCII only. */
export function writeGallery(tag: string): Gallery {
  const dir = tempDir(`gallery-${tag}`);
  const specs = [
    { file: 'six-hundred.json', title: 'Six hundred steps', steps: 600, words: ['steps', 'long run'], n: 3 },
    { file: 'never-here.json', title: 'Never run here', steps: 120, words: ['elsewhere'], n: 2 },
    { file: 'played-out.json', title: 'Played out', steps: 120, words: ['played'], n: 1 },
  ];
  const examples = specs.map((s) => {
    const document = exampleDoc(s.title, s.n);
    const text = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(join(dir, s.file), text);
    return { file: s.file, title: s.title, steps: s.steps, words: s.words, document, hash: sha256Of(text) };
  });
  const paragraph = (i: number): string => `Paragraph ${i}. A guide long enough to need more than one page: start from a piece recipe or a kind, check before you render, render small and read the issues, fix by patch, and render in full last.\n`;
  let text = '# A long guide\n\n';
  for (let i = 0; Buffer.byteLength(text) < 80_000; i++) text += paragraph(i);
  writeFileSync(join(dir, 'long-guide.md'), text);
  writeJson(join(dir, 'gallery.json'), {
    examples: examples.map((e) => ({ file: e.file, hash: e.hash, title: e.title, steps: e.steps, words: e.words })),
    guides: [{ file: 'long-guide.md', name: 'long-guide', title: 'A long guide' }],
  });
  return { dir, examples, guide: { name: 'long-guide', text } };
}
/** A gallery listing's row for an example, by hash. */
export function galleryRow(reply: JsonObject, hash: string, what: string): JsonObject {
  const row = arr(reply['examples'], `${what}: examples`).filter(isObject).find((e) => e['hash'] === hash);
  return obj(row, `${what}: the row of example ${hash}`);
}
/** An example is listed verified only when its last run on this digest played at least its declared steps; else unverified with the steps played, or not run. Each failure names the example. */
export function verifiedFailures(reply: JsonObject, runs: readonly JsonObject[], moduleSet: string, gallery: Gallery): string[] {
  const failures: string[] = [];
  const rows = Array.isArray(reply['examples']) ? reply['examples'].filter(isObject) : [];
  for (const ex of gallery.examples) {
    const row = rows.find((r) => r['hash'] === ex.hash);
    const label = `${ex.title} (${ex.hash})`;
    if (!row) { failures.push(`${label}: not listed in the gallery`); continue; }
    const run = [...runs].reverse().find((r) => r['example'] === ex.hash && r['module_set'] === moduleSet);
    const status = row['status'];
    if (!run) { if (status !== 'not_run') failures.push(`${label}: no run on this digest, listed ${show(status ?? null)}, not not_run`); continue; }
    const played = Number(run['played']);
    if (played >= ex.steps) { if (status !== 'verified') failures.push(`${label}: played ${played} of ${ex.steps} steps, listed ${show(status ?? null)}, not verified`); continue; }
    if (status === 'verified') failures.push(`${label}: listed verified, yet its last run played ${played} of ${ex.steps} steps`);
    else if (status !== 'unverified') failures.push(`${label}: listed ${show(status ?? null)}, not unverified`);
    if (row['played'] !== played || row['steps'] !== ex.steps) failures.push(`${label}: listed with ${show(row['played'] ?? null)} of ${show(row['steps'] ?? null)} steps, not ${played} of ${ex.steps}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// `deep mcp` (#26): its tool list, as an agent's MCP client reads it.

export interface Tool { name: string; description: string; inputSchema: JsonObject }
/** `deep mcp`'s tools/list, from a process started with a scratch HOME (tools/list needs no hub). */
export function toolList(): Tool[] {
  const cli = join(REPO, 'packages/cli/dist/main.js');
  expect(existsSync(cli), `the CLI is built at ${cli} (npm run build --workspaces)`).toBe(true);
  const home = tempDir('home');
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-412', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  const r = spawnSync(process.execPath, [cli, 'mcp'], { cwd: home, env: { ...process.env, HOME: home }, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  const replies = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as JsonObject; } catch { return {}; } });
  const listed = replies.find((m) => m['id'] === 2);
  const result = isObject(listed?.['result']) ? listed['result'] : {};
  const tools = arr(result['tools'], `deep mcp tools/list's tools (stdout ${(r.stdout ?? '').slice(0, 800)}; stderr ${(r.stderr ?? '').slice(-800)})`);
  return tools.map((t, i) => {
    const o = obj(t, `tools[${i}]`);
    return { name: str(o['name'], `tools[${i}].name`), description: str(o['description'], `tools[${i}].description`), inputSchema: obj(o['inputSchema'], `tools[${i}].inputSchema`) };
  });
}
/** The tools the merge base's deep mcp describes (packages/hub/tools.json there): every other listed tool is new. */
export function baseToolNames(): string[] {
  const text = execFileSync('git', ['show', `${mergeBase()}:packages/hub/tools.json`], { cwd: REPO, encoding: 'utf8' });
  return Object.keys(JSON.parse(text) as Record<string, string>);
}
/** A description says what its result does not prove (#26's reading). */
export const SAYS_NOT_PROVEN = /does not prove|doesn't prove|do not prove|don't prove|never proves|proves nothing/i;
export function propertyNames(schema: JsonValue | undefined, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const s of schema) propertyNames(s, into);
  else if (isObject(schema)) {
    if (isObject(schema['properties'])) for (const k of Object.keys(schema['properties'])) into.add(k);
    for (const v of Object.values(schema)) propertyNames(v, into);
  }
  return into;
}
const ANNOTATIONS = ['description', 'title'];
/** The string formats both strict validators take. */
const FORMATS = new Set(['date-time', 'date', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);
/**
 * What keeps a tool's input schema out of the strict subset the model APIs' strict validators take (#26's check,
 * README: Strict schemas), one line each, naming the tool and the JSON Pointer.
 */
export function strictProblems(tool: string, schema: unknown, at = '', root = true): string[] {
  const out: string[] = [];
  const say = (why: string) => out.push(`${tool} ${at || '/'}: ${why}`);
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(schema)) { say('not a schema object'); return out; }
  const types: unknown[] = Array.isArray(schema['type']) ? schema['type'] : schema['type'] === undefined ? [] : [schema['type']];
  const others = types.filter((t) => t !== 'null');
  const allowed = new Set<string>([...ANNOTATIONS, 'type']);
  if (root && !(types.length === 1 && types[0] === 'object')) say('the root must be {"type": "object"}');
  if (others.length !== 1) say(`type ${JSON.stringify(schema['type'])}: one type, with null only beside it`);
  const type = others[0];
  const nullable = types.includes('null');
  if (schema['const'] !== undefined) allowed.add('const');
  switch (type) {
    case 'object': {
      for (const k of ['properties', 'required', 'additionalProperties']) allowed.add(k);
      if (schema['additionalProperties'] !== false) say('additionalProperties must be false');
      const props = isObj(schema['properties']) ? schema['properties'] : undefined;
      if (!props) { say('an object lists its properties'); break; }
      const required = Array.isArray(schema['required']) ? schema['required'] : [];
      const keys = Object.keys(props);
      const missing = keys.filter((k) => !required.includes(k));
      if (missing.length) say(`every property is required (an optional one is nullable): ${missing.join(', ')} not in required`);
      for (const k of keys) out.push(...strictProblems(tool, props[k], `${at}/properties/${k}`, false));
      break;
    }
    case 'array':
      allowed.add('items');
      allowed.add('minItems');
      if (!isObj(schema['items'])) say('an array has one item schema');
      else out.push(...strictProblems(tool, schema['items'], `${at}/items`, false));
      if (schema['minItems'] !== undefined && schema['minItems'] !== 0 && schema['minItems'] !== 1) say('minItems may only be 0 or 1');
      break;
    case 'string':
      for (const k of ['enum', 'pattern', 'format']) allowed.add(k);
      if (schema['format'] !== undefined && !FORMATS.has(String(schema['format']))) say(`format ${String(schema['format'])} is not one both validators take`);
      if (schema['pattern'] !== undefined) {
        const p = String(schema['pattern']);
        try { new RegExp(p, 'u'); } catch { say(`pattern ${p} doesn't compile`); }
        if (/\(\?[=!<]|\\[bB1-9]/.test(p)) say(`pattern ${p} uses lookaround, a backreference or a word boundary`);
      }
      break;
    case 'integer':
    case 'number':
    case 'boolean':
      allowed.add('enum');
      break;
    default:
      say(`type ${String(type)} is outside the closed list`);
  }
  if (Array.isArray(schema['enum'])) {
    if (!schema['enum'].length) say('an empty enum');
    if (nullable && !schema['enum'].includes(null)) say('a nullable enum lists null');
  } else if (schema['enum'] !== undefined) say('enum is not a list');
  for (const key of Object.keys(schema)) if (!allowed.has(key)) say(`keyword ${key} is outside the strict subset`);
  return out;
}

/** AC3's words: a tool named for answering, deciding or overruling; for running code; for driving a live editor or the app. */
export const ANSWERING = /answer|approve|decide|decision|overrule|resolve|respond|reply|waive|grant/i;
export const RUNS_CODE = /exec|eval|script|shell|wasm|_code|validate|render|bake|cost/i;
export const DRIVES_LIVE = /editor|unreal|blender|godot|unity|maya|houdini|_app\b|live/i;
/** The issue's list of tools never added. */
export const NOT_ADDED = ['deep_validate', 'deep_cost', 'deep_render', 'deep_bake'];
const ANSWER_FIELDS = new Set(['answer', 'option', 'decision', 'overrule', 'approve', 'approval', 'verdict', 'waiver']);
const CODE_FIELDS = new Set(['code', 'script', 'program', 'wasm', 'source', 'command', 'cmd', 'shell', 'argv', 'exec', 'eval', 'module_bytes']);
/** The tool list holds no tool that runs code outside the sandbox, drives a live editor or app, or answers, decides or overrules, and no second search tool. Each failure names the tool. */
export function toolListFailures(tools: readonly Tool[]): string[] {
  const failures: string[] = [];
  const names = tools.map((t) => t.name);
  for (const n of NOT_ADDED) if (names.includes(n)) failures.push(`${n}: the issue adds no such tool`);
  const search = names.filter((n) => /search|find/.test(n) && n !== 'find_actions');
  if (search.length > 1) failures.push(`${search.join(', ')}: a second search tool`);
  for (const t of tools) {
    if (ANSWERING.test(t.name)) failures.push(`${t.name}: named for answering, deciding or overruling`);
    if (t.name !== 'deep_run' && RUNS_CODE.test(t.name)) failures.push(`${t.name}: named for running code or rendering outside deep_show`);
    if (DRIVES_LIVE.test(t.name)) failures.push(`${t.name}: named for driving a live editor or the app`);
    const props = [...propertyNames(t.inputSchema)];
    for (const p of props.filter((x) => ANSWER_FIELDS.has(x))) failures.push(`${t.name}: takes ${p}, which would carry an answer, a decision or an overrule`);
    for (const p of props.filter((x) => CODE_FIELDS.has(x))) failures.push(`${t.name}: takes ${p}, which would carry code to run`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The skill (AC6).

export const SKILL = join(REPO, 'skills/deepbuild/SKILL.md');
/** The canvas working order, in order (README: The skill). */
export const WORKING_ORDER: [string, RegExp][] = [
  ['a piece recipe or a kind deep_kinds lists', /piece recipe/i],
  ['a check before any render', /check[^.]*before[^.]*render/i],
  ['a small render and its issues', /render[^.]*small|small render/i],
  ['fixes by patch', /patch/i],
  ['a full render last', /render[^.]*in full|full render/i],
];
const bodyOf = (skill: string): string => (skill.startsWith('---\n') ? skill.slice(skill.indexOf('\n---', 4) + 4) : skill);
/**
 * The skill states the working order and names deep_open_item for a missing kind or field; it names no tool
 * parameter and no `name@major` deep_kinds doesn't list. Each failure names what it found.
 */
export function skillFailures(skill: string, tools: readonly Tool[], listed: ReadonlySet<string>): string[] {
  const failures: string[] = [];
  const body = bodyOf(skill);
  let from = 0;
  for (const [step, re] of WORKING_ORDER) {
    const m = re.exec(body.slice(from));
    if (!m) failures.push(`the working order: the skill doesn't state ${step} after the step before it`);
    else from += m.index + m[0].length;
  }
  if (!/deep_kinds/.test(body)) failures.push('the working order: the skill doesn\'t name deep_kinds as where kinds come from');
  const sentences = body.split(/(?<=[.!?])\s+/);
  if (!sentences.some((s) => /deep_open_item/.test(s) && /kind/i.test(s) && /field/i.test(s) && /missing|doesn't exist|does not exist|no kind/i.test(s))) failures.push('deep_open_item: the skill doesn\'t name it for a missing kind or field');
  for (const t of tools) {
    for (const p of propertyNames(t.inputSchema)) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\`${esc}\`|"${esc}"|(^|[\\s(])${esc}\\s*[:=]`, 'm').test(body)) failures.push(`${p}: the skill names ${t.name}'s parameter ${p}`);
    }
  }
  for (const m of body.matchAll(/(?<![\w./-])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*@\d+)(?![\w.])/g)) {
    if (!listed.has(m[1]!)) failures.push(`${m[1]}: the skill names ${m[1]}, which deep_kinds doesn't list`);
  }
  return [...new Set(failures)];
}

// ---------------------------------------------------------------------------------------------------
// A `deep-show run` kept open, one scenario line at a time, for timings (each line gets one reply line).

export class Streamed {
  private child: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => void)[] = [];
  private constructor(bin: string) {
    this.child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.waiting.shift()?.(line));
    this.child.stderr.resume();
  }
  static open(bin: string): Streamed { return new Streamed(bin); }
  /** One scenario: its replies, and the wall time from writing the line to reading its answer, in ms. */
  async send(sc: JsonObject): Promise<{ replies: JsonObject[]; ms: number; bytes: number[] }> {
    const line = new Promise<string>((resolve) => this.waiting.push(resolve));
    const t0 = process.hrtime.bigint();
    this.child.stdin.write(`${JSON.stringify(sc)}\n`);
    const text = await line;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const out = JSON.parse(text) as JsonObject;
    expect(out['ok'], `${SHOW_NAME} run answers the scenario: ${text.slice(0, 1500)}`).toBe(true);
    const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `replies[${i}]`));
    return { replies, ms, bytes: replies.map((r) => bytesOf(r)) };
  }
  /** Stops the process this test started, by its PID. */
  close(): void {
    this.child.stdin.end();
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}
export const p95 = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;
export const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
/** No reply passes 64 KB without a cursor (AC10): each failure names the reply and its size. */
export function capFailures(what: string, reply: JsonObject): string[] {
  const size = bytesOf(reply);
  const cursor = typeof reply['next'] === 'string' && reply['next'] !== '';
  return size > REPLY_CAP && !cursor ? [`${what}: ${size} bytes, past 64 KB, with no cursor`] : [];
}

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-412-base', sha.slice(0, 12));
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
const baseBins = new Map<string, string>();
/** The merge base's `deep-show` of `set`, built once per process in its own target folder (kept, so later runs build warm). */
export function baseBuild(set: BuildSet): { sha: string; bin: string } {
  const sha = mergeBase();
  const dir = mergeBaseCheckout(sha);
  const bin = join(dir, `deep-show-${set}`);
  if (!baseBins.has(set)) {
    expect(buildTo(dir, [set], bin, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s ${set} build compiles in ${dir}`).toBe('');
    baseBins.set(set, bin);
  }
  return { sha, bin };
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/200).

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
  const text = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit.toFixed(4)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${text}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown: text };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: text };
  return { status: 'INCONCLUSIVE', shown: text };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
