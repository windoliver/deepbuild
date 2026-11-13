// Test-side tools for the #202 acceptance tests: `deep-show` built per Cargo feature set (`r1`, the build without
// scene3d that draws 2D rects, and `r1` with this suite's test canvas module `test.weight`), driven by one scenario
// line on stdin as #306's, #200's and #403's suites drive it; the pack fixtures of `fixtures/packs/` and the 20-kind
// bench pack written at test time; the `install_pack`, `packs`, `deep show`, `deep_show`, `deep_kinds`, `registry`,
// `eval` and `verdict` calls and the fields this suite reads from them (README: The surface under test); the merge
// base exported and built apart; and the reference-Mac gate with the design's judge for timings. Nothing here stands
// in for the pack check, the kind kit, kind_rules, expansion or the verdict: every result read here is the binary's.
// The `...Failures` functions are the criteria's checks: each returns sentences naming what failed, so a test runs it
// on the right program (no failures) and on the criterion's planted program (a failure naming what the criterion says).
// Helper code is copied from tests/acceptance/200 and 306, never imported across suites.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/202 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const SHOW_NAME = 'deep-show';
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
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a name, a code, a hash). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}
const text = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

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

/**
 * The numbers written in a text, leaving out 64-hex hashes and digests, the digits of a version (`1.0.0`), of a kind's
 * major (`@1`) and of a name (`x1`), so "naming the value" and "naming the cost" read the numbers a refusal states.
 */
export function numbersIn(t: string): number[] {
  const bare = t.replace(/[0-9a-f]{64}/g, '');
  return [...bare.matchAll(/(?<![\w.@])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w@]|\.\d)/g)].map((m) => Number(m[0]));
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** This suite's test feature (README: The test canvas module): `test.weight`, an item kind of 0.20 ms of CPU. */
export type TestFeature = 'test-weight';
export interface Build { set: 'r1'; with?: TestFeature[] }
/** `r1`: the build set without scene3d, which draws 2D rects (text, look, marks2d, …). */
export const R1: Build = { set: 'r1' };
/** `r1` and the test canvas module `test.weight`. */
export const WEIGHT: Build = { set: 'r1', with: ['test-weight'] };
export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** `cargo build --locked --bin deep-show --no-default-features --features …` in `root`; '' or cargo's error. */
export function cargoBuild(root: string, features: string[], env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  return '';
}
/** Builds in `root` and copies the binary to `to`; '' or cargo's error. */
export function buildTo(root: string, features: string[], to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargoBuild(root, features, env);
  if (error === '') copyFileSync(join(targetOf(root, { ...process.env, ...env }), 'debug', exe(SHOW_NAME)), to);
  return error;
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-202-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      made.set(name, { bin, error: buildTo(REPO, featuresOf(build), bin) });
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
  };
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-202-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const dirs: string[] = [];
/** A scratch folder deleted after the file. */
export function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `deep-202-${tag}-`));
  dirs.push(d);
  return d;
}
export function useTempDirs(): void {
  afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the working agent's session, the process table, panels, documents.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: bookcases', process: { pid: 4100, start: 1_000 } };
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
export const DOC = { a: ulid('01JB202D', 1), b: ulid('01JB202D', 2), c: ulid('01JB202D', 3) } as const;

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` and `install_pack` take it. */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
/** acme/shelf@1.0.0: the kind shelf.bookcase@1 with its rule shelf.span (README: Fixtures). */
export const SHELF = pack('acme/shelf', '1.0.0', 'shelf-1.0.0');
/** The same pack with shelf.span written `width <= 100` (criterion 3's planted rule). */
export const SHELF_RULE_100 = pack('acme/shelf', '1.0.0', 'shelf-1.0.0-rule-100');
/** The same pack with shelf.span written `width <= 0.95 * (dividers + 1)` (criterion 8's planted rule). */
export const SHELF_RULE_095 = pack('acme/shelf', '1.0.0', 'shelf-1.0.0-rule-095');
/** The same recipe and rule as a recipe-level rule, and no kinds: what the merge base installs (budgets). */
export const SHELF_RECIPE_ONLY = pack('acme/shelf', '1.0.0', 'shelf-1.0.0-recipe-only');
/** acme/shelf@1.0.1: shelf.panel@1 declares builder: slab. */
export const SHELF_BUILDER = pack('acme/shelf', '1.0.1', 'shelf-1.0.1-builder');
/** acme/shelf@1.0.2: shelf.grid@1 declares an array. */
export const SHELF_ARRAYS = pack('acme/shelf', '1.0.2', 'shelf-1.0.2-arrays');
/** acme/shelf@1.0.3: a kind named slab@1. */
export const SHELF_SLAB = pack('acme/shelf', '1.0.3', 'shelf-1.0.3-slab');
/** acme/shelf@1.0.4: a kind named puppet.rig@1. */
export const SHELF_PUPPET = pack('acme/shelf', '1.0.4', 'shelf-1.0.4-puppet');
/** acme/costly@1.0.0: costly.unit@1 declares 0.10 ms of CPU; it expands into one test.weight@1 item, 0.20 ms. */
export const COSTLY = pack('acme/costly', '1.0.0', 'costly-1.0.0');
/** acme/tower@1.0.0: tower.stack@1 makes levels² test.weight@1 items. */
export const TOWER = pack('acme/tower', '1.0.0', 'tower-1.0.0');
/** acme/rack@1.0.0: rack.unit@1's rule rack.span, on a recipe with its own rule rack.levels. */
export const RACK = pack('acme/rack', '1.0.0', 'rack-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

export const BOOKCASE = 'shelf.bookcase@1';
export const SPAN = 'shelf.span';

/** A pack fixture's manifest. */
export const manifestOf = (p: PackFixture): JsonObject => obj(readJson(join(p.dir, 'pack.json')), `${packAt(p)}'s pack.json`);
/** A kind as its pack declares it. */
export const declared = (p: PackFixture, kind: string): JsonObject => obj(obj(manifestOf(p)['kinds'], `${packAt(p)}: kinds`)[kind], `${packAt(p)}: kinds.${kind}`);
/** A rule as its kind declares it. */
export function declaredRule(p: PackFixture, kind: string, code: string): JsonObject {
  const r = arr(declared(p, kind)['rules'], `${kind}: rules`).find((x) => isObject(x) && x['code'] === code);
  expect(r, `${packAt(p)}'s ${kind} declares the rule ${code}`).toBeDefined();
  return r as JsonObject;
}
/** The sha256 of a pack's asset at `path`, as its manifest lists it (the loader checks it against the file). */
export function assetSha(p: PackFixture, path: string): string {
  const a = arr(manifestOf(p)['assets'], `${packAt(p)}: assets`).map((x, i) => obj(x, `${packAt(p)}: assets[${i}]`)).find((x) => x['path'] === path);
  expect(a, `${packAt(p)} lists the asset ${path}`).toBeDefined();
  return str(a!['sha256'], `${packAt(p)}: ${path}'s sha256`);
}
/** Every asset hash of a pack: its examples and its twins' examples. */
export const assetShas = (p: PackFixture): string[] => arr(manifestOf(p)['assets'], `${packAt(p)}: assets`).map((x, i) => str(obj(x, `assets[${i}]`)['sha256'], `assets[${i}].sha256`));

/** A scenario with your session, the process table and the panel; DOC.a–c on `main`; `packs` installed before the first call. */
export function scenario(evidence: string, calls: JsonObject[], extra: { packs?: readonly PackFixture[]; planted?: string | undefined; claims?: JsonObject } = {}): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' } },
    ...(extra.packs ? { packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    ...(extra.claims ? { claims: extra.claims } : {}),
    calls,
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents and calls

/** A board as your shell or an agent sends it: no `id`, no `layers`; `packs` names each pack version it uses. */
export function board(title: string, packs: readonly string[], items: JsonObject[], size: [number, number] = [640, 400]): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #202 acceptance suite.`, size,
    ...(packs.length ? { packs: [...packs] } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
/** An item of `kind` with `params`, its name its ID. */
export const item = (id: string, kind: string, params: JsonObject, order: string, pos: [number, number] = [20, 20]): JsonObject =>
  ({ id, kind, name: id, order, params, at: { pos: [pos[0], pos[1], 0] } });
export const rect = (id: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role: 'muted' } } } });

/** A whole revision from your shell (`deep show`), with its issues and, with `timing`, the binary's timings. */
export function present(doc: string, document: JsonObject, options: { timing?: boolean } = {}): JsonObject {
  return { call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues', ...(options.timing ? ['timing'] : [])] };
}
/** The same from the working agent's session (`deep_show`). */
export const agentShow = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
export const PACKS: JsonObject = { call: 'packs' };
export const REGISTRY: JsonObject = { call: 'registry' };
/** `install_pack` (#306), with `session` for a pack the working agent wrote (#200). */
export const installPack = (p: PackFixture, session?: string): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir, ...(session ? { session } : {}) });
export const verdictCall = (claim: string): JsonObject => ({ call: 'verdict', claim });
export const evalAt = (doc: string, t = 0): JsonObject => ({ call: 'eval', doc, t });
/** `deep_kinds` op list on the kind registry, from `cursor`. */
export const kindsList = (cursor?: string): JsonObject => ({ call: 'deep_kinds', op: 'list', registry: 'kind@1', ...(cursor ? { cursor } : {}) });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; ids: string[]; path: string; fix: string; raw: JsonObject }
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return {
    code: str(o['code'], `${what}.code`), severity: typeof o['severity'] === 'string' ? o['severity'] : '', ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [],
    path: typeof o['path'] === 'string' ? o['path'] : '', fix: typeof o['fix'] === 'string' ? o['fix'] : '', raw: o,
  };
}
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
export const outcome = (reply: JsonObject): string => String(reply['outcome']);

/** One recipe instance's expansion, as #306's `expansions` row gives it. */
export interface Expansion { instance: string; kind: string; pack: string; derived: Record<string, JsonObject> }
export function expansionOf(reply: JsonObject, instance: string, what = 'the reply'): Expansion {
  const rows = arr(reply['expansions'] ?? [], `${what}: expansions`).map((v, i) => obj(v, `${what}: expansions[${i}]`)).filter((e) => e['instance'] === instance);
  expect(rows.length, `${what} has exactly one expansion of ${instance}; the reply: ${show(reply, 1200)}`).toBe(1);
  const o = rows[0]!;
  const derived = obj(o['derived'], `${what}: ${instance}'s derived`);
  return {
    instance, kind: str(o['kind'], `${what}: ${instance}'s kind`), pack: str(o['pack'], `${what}: ${instance}'s pack`),
    derived: Object.fromEntries(Object.entries(derived).map(([id, it]) => [id, obj(it, `${what}: derived ${id}`)])),
  };
}
/** The IDs `<instance>.<step>.<0..n-1>`. */
export const derivedIds = (instance: string, step: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${instance}.${step}.${i}`);

/** One row of the `packs` reply, or an `install_pack` reply. */
export interface PackRow { pack: string; version: string; state: string; issues: Issue[] }
export function packRowOf(v: JsonValue, what: string): PackRow {
  const o = obj(v, what);
  return { pack: str(o['pack'], `${what}.pack`), version: String(o['version'] ?? ''), state: str(o['state'] ?? o['outcome'], `${what}.state`), issues: issues(o, what) };
}
export function packRow(reply: JsonObject, p: PackFixture): PackRow {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => packRowOf(v, `packs[${i}]`)).filter((r) => r.pack === p.id && r.version === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}: ${show(reply)}`).toBe(1);
  return rows[0]!;
}

/** The `registry` reply's module-set digest (stamped on every reply as `set_digest`), its seal count and its frame-phase operators. */
export interface Sealed { setDigest: string; state: string; sealRuns: number; frameOperators: string[] }
/** The design's frame phases (Phase: Frame), the phases whose work runs per frame. */
export const FRAME_PHASES = ['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback'];
export function sealedOf(reply: JsonObject, what = 'registry'): Sealed {
  const ops = obj(reply['operators'], `${what}: operators`);
  return {
    setDigest: str(reply['set_digest'], `${what}: set_digest`),
    state: str(reply['state'], `${what}: state`),
    sealRuns: num(obj(reply['seal'], `${what}: seal`)['runs'], `${what}: seal.runs`),
    frameOperators: sorted(Object.entries(ops).filter(([, o]) => isObject(o) && FRAME_PHASES.includes(String(o['phase']))).map(([k]) => k)),
  };
}
/** An `eval` reply's nodes in frame phases, as `operator|item`. */
export function frameNodes(reply: JsonObject, what = 'eval'): string[] {
  return sorted(arr(reply['nodes'], `${what}: nodes`).map((n, i) => obj(n, `${what}: nodes[${i}]`)).filter((n) => FRAME_PHASES.includes(String(n['phase'])))
    .map((n) => `${String(n['operator'])}|${n['item'] === null || n['item'] === undefined ? '-' : String(n['item'])}`));
}

/** The merge base's refusal of the whole `kinds` field: `unknown_field` at the path `kinds`, whose `actual` holds every name in it. */
const wholeKindsField = (i: Issue): boolean => i.path === 'kinds' && i.code === 'unknown_field';
/**
 * Every error of a refused pack but the merge base's refusal of the whole `kinds` field, and whether one of them names
 * each of `names` (and has `code`, when given). Each failure names the pack.
 */
export function refusalFailures(row: PackRow, p: PackFixture, names: readonly string[], code?: string): string[] {
  if (row.state !== 'refused') return [`${packAt(p)} was ${row.state} at its pack check, not refused naming ${names.join(' and ')}`];
  const own = errors(row.issues).filter((i) => !wholeKindsField(i) && (code === undefined || i.code === code));
  if (own.some((i) => names.every((n) => mentions(i.raw, n)))) return [];
  return [`${packAt(p)}'s refusal has no error${code ? ` ${code}` : ''} naming ${names.join(' and ')}: ${show(row.issues.map((i) => i.raw), 2000)}`];
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds: the kind registry kind@1, every page.

/** The kind@1 entry named `name` as `deep_kinds` lists it in a process whose store holds `extra.packs`, and the module-set digest its pages carry. */
export function kindEntry(bin: string, evidence: string, name: string, extra: Parameters<typeof scenario>[2] = {}): { moduleSet: string; entry: JsonObject | undefined } {
  let cursor: string | undefined;
  let moduleSet = '';
  for (let page = 0; page < 50; page++) {
    const [reply] = run(bin, scenario(evidence, [kindsList(cursor)], extra));
    if (page === 0) moduleSet = str(reply!['module_set'], 'deep_kinds list: module_set');
    for (const reg of arr(reply!['registries'], 'deep_kinds list: registries')) {
      if (!isObject(reg)) continue;
      const found = (Array.isArray(reg['entries']) ? reg['entries'] : []).find((e) => isObject(e) && e['name'] === name);
      if (found !== undefined) return { moduleSet, entry: found as JsonObject };
    }
    cursor = typeof reply!['next'] === 'string' && reply!['next'] !== '' ? reply!['next'] : undefined;
    if (!cursor) break;
  }
  return { moduleSet, entry: undefined };
}
/** The entry, which must be listed. */
export function listed(found: { entry: JsonObject | undefined }, name: string): JsonObject {
  expect(found.entry, `deep_kinds lists ${name} in kind@1`).toBeDefined();
  return found.entry!;
}

/**
 * A pack kind's kit result in #200's one KitResult shape, `{verdict, rules: [{rule, verdict}]}`, its rules being the
 * kit's parts (defaults, determinism, cost, rules, migration), plus `examples: [{example, raised}]` and `twins:
 * [{example, expect, raised}]` (README: The surface under test).
 */
export interface Kit { verdict: string; parts: Record<string, string>; examples: { example: string; raised: string[] }[]; twins: { example: string; expect: string; raised: string[] }[]; raw: JsonObject }
export function kitOf(entry: JsonObject, what: string): Kit {
  const k = obj(entry['kit'], `${what}: kit`);
  const parts: Record<string, string> = {};
  for (const [i, r] of arr(k['rules'] ?? [], `${what}: kit.rules`).entries()) {
    const o = obj(r, `${what}: kit.rules[${i}]`);
    parts[str(o['rule'], `${what}: kit.rules[${i}].rule`)] = str(o['verdict'], `${what}: kit.rules[${i}].verdict`);
  }
  return {
    verdict: str(k['verdict'], `${what}: kit.verdict`), parts,
    examples: arr(k['examples'] ?? [], `${what}: kit.examples`).map((e, i) => { const o = obj(e, `${what}: kit.examples[${i}]`); return { example: str(o['example'], `${what}: kit.examples[${i}].example`), raised: strs(o['raised'] ?? [], `${what}: kit.examples[${i}].raised`) }; }),
    twins: arr(k['twins'] ?? [], `${what}: kit.twins`).map((e, i) => { const o = obj(e, `${what}: kit.twins[${i}]`); return { example: str(o['example'], `${what}: kit.twins[${i}].example`), expect: str(o['expect'], `${what}: kit.twins[${i}].expect`), raised: strs(o['raised'] ?? [], `${what}: kit.twins[${i}].raised`) }; }),
    raw: k,
  };
}
/** A param of a listed schema: the recipe's input spelling (`min`, `max`, `default`) or JSON Schema's (`minimum`, `maximum`, `default`). */
export function schemaParam(schema: JsonValue | undefined, name: string): { min: JsonValue | undefined; max: JsonValue | undefined; default: JsonValue | undefined } | undefined {
  if (!isObject(schema)) return undefined;
  const props = isObject(schema['properties']) ? schema['properties'] : schema;
  const p = props[name];
  if (!isObject(p)) return undefined;
  return { min: p['minimum'] ?? p['min'], max: p['maximum'] ?? p['max'], default: p['default'] };
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

/**
 * Criterion 4: the pack's kit passed every example's determinism part, so the pack installed. A refused pack's failure
 * carries its refusal, which names the part and the example.
 */
export function determinismFailures(row: PackRow, p: PackFixture): string[] {
  if (row.state === 'installed') return [];
  return [`${packAt(p)} was ${row.state} at its pack check: ${show(row.issues.map((i) => i.raw), 3000)}`];
}

/** One requirement's row of a `verdict` reply (#403). */
export function requirementRow(verdict: JsonObject, id: string): JsonObject | undefined {
  return arr(verdict['requirements'] ?? [], 'verdict: requirements').map((r, i) => obj(r, `verdict: requirements[${i}]`)).find((r) => r['id'] === id);
}
/**
 * Criterion 5: a requirement whose only cover is the working agent's own rule `rule` is INCONCLUSIVE, never PASS, with
 * an approval ask naming it (#200's `asks: [{kind: "approval", requirement}]`, on the verdict or its row), and the
 * claim is not PASS. Each failure names the rule.
 */
export function bindingFailures(verdict: JsonObject, req: string, rule: string): string[] {
  const failures: string[] = [];
  const row = requirementRow(verdict, req);
  if (!row) return [`the verdict lists no requirement ${req}, whose only cover is the working agent's rule ${rule}: ${show(verdict)}`];
  if (row['result'] === 'PASS') failures.push(`requirement ${req}, whose only cover is the working agent's own rule ${rule}, is PASS`);
  else if (row['result'] !== 'INCONCLUSIVE') failures.push(`requirement ${req}, whose only cover is the working agent's own rule ${rule}, is ${String(row['result'])}, not INCONCLUSIVE: ${show(row)}`);
  if (verdict['result'] === 'PASS') failures.push(`the claim is PASS on the working agent's own rule ${rule} alone`);
  const asks = [...(Array.isArray(verdict['asks']) ? verdict['asks'] : []), ...(Array.isArray(row['asks']) ? row['asks'] : [])]
    .filter((a) => isObject(a) && a['kind'] === 'approval' && mentions(a, req));
  if (asks.length === 0) failures.push(`no approval ask names ${req}, whose only cover is the working agent's own rule ${rule}: ${show(verdict['asks'] ?? null)}`);
  return failures;
}

/**
 * Criterion 9: the pack `p` is refused at its pack check by an error naming `param`, its `value` and a cost of at least
 * `cost` (the levels² kind's 64 items at levels 8 cost 12.8 ms of CPU, 64 items or 128 triangles: any of these).
 */
export function extremesFailures(row: PackRow, p: PackFixture, kind: string, param: string, value: number, cost: number): string[] {
  if (row.state !== 'refused') return [`${packAt(p)} was ${row.state}: its kit passed ${kind}, whose expansion at ${param} ${value} is over its class`];
  const named = errors(row.issues).filter((i) => !wholeKindsField(i)).some((i) => {
    const t = JSON.stringify(i.raw);
    const ns = numbersIn(t);
    return t.includes(param) && ns.includes(value) && ns.some((n) => n >= cost);
  });
  return named ? [] : [`${packAt(p)}'s refusal names no ${param}, ${value} and a cost of at least ${cost} together: ${show(row.issues.map((i) => i.raw), 2000)}`];
}

/** Criterion 10: each of `codes` is raised exactly once on `instance`. Each failure names the rule. */
export function onceFailures(reply: JsonObject, instance: string, codes: readonly string[]): string[] {
  const all = issues(reply);
  return codes.flatMap((code) => {
    const n = all.filter((i) => i.code === code && i.ids.includes(instance)).length;
    return n === 1 ? [] : [`${code} is raised ${n} times on ${instance}, not once`];
  });
}

// ---------------------------------------------------------------------------------------------------
// The bench pack (budgets): acme/bench@1.0.0, 20 kinds, each the shelf's recipe with 4 rules at 10 times.

export const BENCH_KINDS = 20;
export const BENCH_TIMES = Array.from({ length: 10 }, (_, i) => `${i}s`);
/** Writes the bench pack into `dir`: kinds bench.k01@1 … bench.k20@1, each with an example at its defaults and a planted twin per rule. */
export function writeBench(dir: string): PackFixture {
  const at = 'acme/bench@1.0.0';
  const recipe = obj(readJson(join(SHELF.dir, 'shelf.bookcase@1.json')), 'the shelf recipe');
  const recipes: JsonObject = {};
  const kinds: JsonObject = {};
  const assets: JsonObject[] = [];
  const asset = (path: string, body: string): string => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
    const h = sha256(body);
    assets.push({ path, sha256: h, size: Buffer.byteLength(body), license: 'MIT' });
    return h;
  };
  const example = (kind: string, params: JsonObject, title: string): string => text({
    format: 1, profile: 'board', title, description: `${title}: one ${kind} item of the #202 suite's bench pack.`, size: [320, 360],
    packs: [at], items: { x1: { id: 'x1', kind, name: 'X1', order: 'a0', params } },
  });
  for (let k = 1; k <= BENCH_KINDS; k++) {
    const n = `k${String(k).padStart(2, '0')}`;
    const kind = `bench.${n}@1`;
    writeFileSync(join(dir, `${kind}.json`), text({ ...recipe, id: `bench.${n}`, title: `Bench ${n}` }));
    recipes[kind] = `${kind}.json`;
    const rules: [string, string, JsonObject][] = [
      ['span', 'width <= 0.9 * (dividers + 1)', { width: 2.0, dividers: 1 }],
      ['levels', 'levels <= 7', { levels: 8 }],
      ['dividers', 'dividers <= 2', { dividers: 3 }],
      ['width', 'width >= 0.5', { width: 0.45 }],
    ];
    kinds[kind] = {
      minor: 0, recipe: kind, children: [], capabilities: { pickable: true, snap: false },
      rules: rules.map(([r, expr]) => ({ code: `bench.${n}_${r}`, expr, at: BENCH_TIMES, fix: `Keep ${r} in its bound.` })),
      twins: rules.map(([r, , params]) => ({ example: asset(`examples/${n}-${r}.json`, example(kind, params, `${kind} breaking its ${r} rule`)), expect: `bench.${n}_${r}` })),
      migrate: {},
      examples: [asset(`examples/${n}-defaults.json`, example(kind, {}, `${kind} at its defaults`))],
      cost: { class: 'figure', at_defaults: { cpu_ms: 0.5, gpu_ms: 0.2, items: 7 } },
    };
  }
  writeFileSync(join(dir, 'pack.json'), text({
    name: 'bench', version: '1.0.0', license: 'MIT', description: 'The #202 suite\'s budget pack: 20 kinds, each the shelf recipe with 4 rules at 10 times.',
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' } }, recipes, kinds, assets,
  }));
  return { id: 'acme/bench', version: '1.0.0', dir };
}

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart (as #200's).

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-202-base', sha.slice(0, 12));
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
    expect(buildTo(dir, ['r1'], bin, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s r1 build compiles in ${dir}`).toBe('');
    baseBin = bin;
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
