// Test-side tools for the #200 acceptance tests: `deep-show` built per Cargo feature set (a build set plus this
// suite's test features, as #305's, #185's and #306's suites build it); the startup refusal line; the
// `registry`, `registries` (deep://registries/<core version>), `install_pack`, `packs`, `resolve`, `eval`,
// `fixtures`, `kit` and `verdict` calls and the fields this suite reads from them (README: The surface under
// test); the merge base exported and built apart; the contract step (#139) and the canvas closure lint run on
// scratch trees; and the reference-Mac gate with the design's judge for timing results. Nothing here stands in
// for the registry, the seal, a kit, the pack check, the closure lint or the contract diff: every verdict read
// here is the binary's or the script's own. The `...Failures` functions are the criteria's checks: each returns
// sentences naming what failed, so a test runs it on the right program (no failures) and on the criterion's
// planted program (a failure naming what the criterion says).

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/200 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** A d1 digest: 64 lowercase hex, with or without the contracts' `d1:` prefix. */
export const DIGEST = /^(d1:)?[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// Names this suite chooses (README: Names this suite chooses).

export const MARK = 'test.mark@1';
export const MARK2 = 'test.mark@2';
export const MARK_MODULE = 'test.mark';
export const MARK_OTHER_MODULE = 'test.mark.other';
export const MARK_RULE = 'size_at_most_64';
export const MODE = 'test.mode@1';
export const MODE_MODULE = 'test.mode';
export const SHAPE = 'test.shape@1';
export const PART = 'test.part@1';
export const FILL_A = 'test.fill.a';
export const FILL_B = 'test.fill.b';
export const FILL_C = 'test.fill.c';
export const GPUSTEP_MODULE = 'test.gpustep';
export const GPUSTEP = 'test.gpustep.mix@1';
export const RULES = 'test.rules@1';
export const RULES_MODULE = 'test.rules';
export const RULE_IDS = ['size_at_most_64', 'size_even', 'name_lowercase'] as const;
export const SLOT = 'check.kind@1';

/** The planted wrong entry each shipped registry's kit must refuse, by the name it is listed under (README). */
export const PLANTED: Record<string, string[]> = {
  'mark@1': ['bounds_miss_pixel'],
  'builder@1': ['count_not_from_params'],
  'modifier@1': ['deform_adds_vertices'],
  'check.kind.doc@1': ['uncatalogued_code'],
  'gpu.output@1': ['vec3_read_as_vec4'],
  'gpu.function@1': ['exact_takes_float_step'],
  'gpu.step@1': ['add_saturating'],
  'device.class@1': ['frame_rate_dependent', 'plugin_257_bytes'],
  'logic.service@1': ['answers_after_next_step'],
};

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
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** One canonical text per JSON value (keys sorted at every depth), so "the same bytes" is one string comparison. */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sorted(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Whether a value's JSON text holds `needle` (a name, or a fragment such as `"size":65`). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
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

export type BuildSet = 'core' | 'r2';
/** This suite's test features (README: Test features of deep-show). */
export type TestFeature =
  | 'test-mark' | 'test-mark-dot-9' | 'test-mark-no-planted' | 'test-mark-no-since' | 'test-mark-dot-twice' | 'test-mark-binds-author'
  | 'test-mark-schema-changed' | 'test-mark-v2'
  | 'test-mode-closed' | 'test-mode-registry' | 'test-mode-renumbered'
  | 'test-fill-a' | 'test-fill-b' | 'test-fill-b-part' | 'test-fill-c'
  | 'test-gpustep' | 'test-gpustep-no-fixture' | 'test-gpustep-no-twin'
  | 'test-leave-out-effects' | 'test-steps-in-effects'
  | 'test-rules-shared' | 'test-rules-isolated' | 'test-registries-load';
export interface Build { set: BuildSet; with?: TestFeature[] }

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

export interface Builds { bin: (build: Build) => string; dir: () => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-200-bins-'));
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
    dir: () => dir,
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-200-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// The world the scenarios share: an agent's session, the process table, panels, documents, packs.
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: registries', process: { pid: 4100, start: 1_000 } };
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
export const DOC = { a: ulid('01JB200D', 1), b: ulid('01JB200D', 2), c: ulid('01JB200D', 3) } as const;

export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
/** test/testpack@1.0.0: testpack.ring {size: 12} in test.mark@1. */
export const TESTPACK = pack('test/testpack', '1.0.0', 'testpack-1.0.0');
/** test/bigpack@1.0.0: bigpack.huge {size: 80} in test.mark@1, which the kit refuses. */
export const BIGPACK = pack('test/bigpack', '1.0.0', 'bigpack-1.0.0');
/** test/barepack@1.0.0: an entry named dot, without the pack's name, in test.mark@1. */
export const BAREPACK = pack('test/barepack', '1.0.0', 'barepack-1.0.0');
/** test/steppack@1.0.0: steppack.mul3 in gpu.step@1, which only canvas modules fill. */
export const STEPPACK = pack('test/steppack', '1.0.0', 'steppack-1.0.0');
/** alpha/agentpack@1.0.0: agentpack.tiny {size: 4} in test.mark@1, written by the working agent (session alpha). */
export const AGENTPACK = pack('alpha/agentpack', '1.0.0', 'agentpack-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

export interface Installed { slot: string; fill: string; kit: JsonObject }

/**
 * A scenario with your session, the process table and the panel; `docs` each on `main`; `packs` installed
 * before the first call (each `{id, dir}`, #306); `installed` the hub's installed slot fills with the kit result
 * the hub recorded at install (README: hub slots).
 */
export function scenario(evidence: string, calls: JsonObject[], extra: { packs?: readonly PackFixture[]; installed?: readonly Installed[]; claims?: JsonObject; docs?: string[] } = {}): JsonObject {
  const docs: JsonObject = {};
  for (const id of extra.docs ?? [DOC.a, DOC.b, DOC.c]) docs[id] = { panel: 'main' };
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs,
    ...(extra.packs ? { packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.installed ? { installed: extra.installed.map((i) => ({ slot: i.slot, fill: i.fill, kit: i.kit })) } : {}),
    ...(extra.claims ? { claims: extra.claims } : {}),
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

/**
 * A startup refusal: #305's `{"ok": false, "code": "seal_refused", "reason", "modules", "arrays", "what"}` with
 * #185's `interface`/`implementations`, and this suite's `registry` (name@major), `entries` (each an entry's name,
 * or a planted entry as `{name, value}`), `rules` (kit rule IDs) and `passes` (README: The startup refusal).
 */
export interface Refusal { reason: string; modules: string[]; registry: string | undefined; entries: JsonValue[]; rules: string[]; raw: JsonObject }
export function refusalOf(s: Started): Refusal | string {
  if (s.status !== REFUSED_EXIT) return `the startup exited ${s.status} (${s.signal ?? 'no signal'}), not ${REFUSED_EXIT} with the seal's refusal; stdout: ${s.stdout.slice(0, 600)}`;
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return `the refusal is not one JSON line: ${s.stdout.slice(0, 600)}`;
  const raw = s.lines[0];
  if (raw['ok'] !== false || raw['code'] !== 'seal_refused') return `the line is not the seal's refusal: ${show(raw)}`;
  return {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '',
    modules: Array.isArray(raw['modules']) ? raw['modules'].map(String) : [],
    registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined,
    entries: Array.isArray(raw['entries']) ? raw['entries'] : [],
    rules: Array.isArray(raw['rules']) ? raw['rules'].map(String) : [],
    raw,
  };
}
export interface Expected { reasons?: string[]; registry?: string; modules?: string[]; entries?: string[]; rules?: string[] }
/**
 * The seal refused the build as the criterion says: one of `reasons`, naming `registry` in its `registry`
 * field, each of `modules` in `modules`, each of `entries` in `entries` (a name, or a fragment of a planted
 * entry's JSON such as `"size":65`) and each of `rules` in `rules`. Each failure names what was missing.
 */
export function refusalFailures(s: Started, want: Expected): string[] {
  const r = refusalOf(s);
  if (typeof r === 'string') return [`${want.registry ?? want.entries?.join(', ') ?? 'the build'}: ${r}`];
  const failures: string[] = [];
  if (want.reasons && !want.reasons.includes(r.reason)) failures.push(`the refusal's reason is ${r.reason}, not ${want.reasons.join(' or ')}: ${show(r.raw)}`);
  if (want.registry !== undefined && r.registry !== want.registry) failures.push(`the refusal names the registry ${r.registry ?? 'none'}, not ${want.registry}: ${show(r.raw)}`);
  for (const m of want.modules ?? []) if (!r.modules.includes(m)) failures.push(`the refusal doesn't name the module ${m}: ${show(r.raw)}`);
  for (const e of want.entries ?? []) if (!mentions(r.entries, e)) failures.push(`the refusal doesn't name the entry ${e}: ${show(r.raw)}`);
  for (const rule of want.rules ?? []) if (!r.rules.includes(rule)) failures.push(`the refusal doesn't name the rule ${rule}: ${show(r.raw)}`);
  return failures;
}
/** The build sealed: exit 0 and a `registry` reply in state ready. */
export function sealFailures(s: Started, what: string): string[] {
  if (s.status === 0) return [];
  return [`${what} did not seal: exit ${s.status}; ${s.stdout.slice(0, 800)} ${s.stderr.slice(-400)}`];
}

/** The planted startup argument that gives `registry`'s kit a rule that admits every entry (README: Planted startup arguments). */
export const kitAdmitsAll = (registry: string): string => `kit_admits_all:${registry}`;

// ---------------------------------------------------------------------------------------------------
// The sealed set: `registry` (#305, #185) with `seal.registries`, and `passes[].steps`.

export interface Registry {
  build_set: string; modules: string[]; digests: Record<string, string>; passes: Record<string, JsonObject>;
  seal: { ms: number; runs: number }; raw: JsonObject;
}
export function registry(reply: JsonObject, what = 'registry'): Registry {
  const digests = obj(reply['digests'], `${what}: digests`);
  const seal = obj(reply['seal'], `${what}: seal`);
  const passes = isObject(reply['passes']) ? reply['passes'] : {};
  return {
    build_set: str(reply['build_set'], `${what}: build_set`),
    modules: strs(reply['modules'], `${what}: modules`),
    digests: Object.fromEntries(Object.entries(digests).map(([k, v]) => [k, str(v, `${what}: digests.${k}`)])),
    passes: Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, obj(v, `${what}: passes.${k}`)])),
    seal: { ms: num(seal['ms'], `${what}: seal.ms`), runs: num(seal['runs'], `${what}: seal.runs`) },
    raw: reply,
  };
}
/** `registry.seal.registries`: the seal's registry checks alone (kits on entries and planted entries), their time and how often they ran. */
export function registryChecks(r: Registry, what = 'registry'): { ms: number; runs: number } {
  const i = obj(obj(r.raw['seal'], `${what}: seal`)['registries'], `${what}: seal.registries (the seal's registry checks)`);
  return { ms: num(i['ms'], `${what}: seal.registries.ms`), runs: num(i['runs'], `${what}: seal.registries.runs`) };
}

// ---------------------------------------------------------------------------------------------------
// deep://registries/<core version>: the `registries` call.

export interface KitResult { verdict: string; rules: { rule: string; verdict: string; message: string }[]; raw: JsonObject }
export function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`), message: typeof ro['message'] === 'string' ? ro['message'] : '' };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface Entry { name: string; registry: string; origin: string; module: string | undefined; pack: string | undefined; value: JsonValue; since: string; digest: string; kit: KitResult; raw: JsonObject }
export interface Planted { name: string; value: JsonValue; result: KitResult; raw: JsonObject }
export interface Listed {
  kind: string; name: string; since: string | undefined; digest: string | undefined; raw: JsonObject;
  // a registry's
  owner?: string; fill?: string[]; binds?: string; kit?: { rule: string; message: string }[]; planted?: Planted[]; entries?: Entry[];
  // a slot's
  fills?: { name: string; kit: KitResult; raw: JsonObject }[];
}
function entryOf(v: JsonValue, what: string): Entry {
  const o = obj(v, what);
  return {
    name: str(o['name'], `${what}.name`), registry: str(o['registry'], `${what}.registry`), origin: str(o['origin'], `${what}.origin`),
    module: typeof o['module'] === 'string' ? o['module'] : undefined, pack: typeof o['pack'] === 'string' ? o['pack'] : undefined,
    value: o['value'] ?? null, since: str(o['since'], `${what}.since`), digest: str(o['digest'], `${what}.digest`), kit: kitResult(o['kit'], `${what}.kit`), raw: o,
  };
}
function listedOf(v: JsonValue, what: string): Listed {
  const o = obj(v, what);
  const kind = str(o['kind'], `${what}.kind (registry or slot)`);
  const name = str(o['name'], `${what}.name`);
  const at = `${what} (${name})`;
  const base: Listed = { kind, name, since: typeof o['since'] === 'string' ? o['since'] : undefined, digest: typeof o['digest'] === 'string' ? o['digest'] : undefined, raw: o };
  if (kind === 'registry') {
    return {
      ...base,
      owner: str(o['owner'], `${at}.owner`), fill: strs(o['fill'], `${at}.fill`), binds: str(o['binds'] ?? 'all', `${at}.binds`),
      kit: arr(o['kit'], `${at}.kit`).map((r, i) => { const ro = obj(r, `${at}.kit[${i}]`); return { rule: str(ro['rule'], `${at}.kit[${i}].rule`), message: str(ro['message'], `${at}.kit[${i}].message`) }; }),
      planted: arr(o['planted'], `${at}.planted`).map((p, i) => { const po = obj(p, `${at}.planted[${i}]`); return { name: str(po['name'], `${at}.planted[${i}].name`), value: po['value'] ?? null, result: kitResult(po['result'], `${at}.planted[${i}].result`), raw: po }; }),
      entries: arr(o['entries'], `${at}.entries`).map((e, i) => entryOf(e, `${at}.entries[${i}]`)),
    };
  }
  if (kind === 'slot') {
    return { ...base, fills: arr(o['fills'], `${at}.fills`).map((f, i) => { const fo = obj(f, `${at}.fills[${i}]`); return { name: str(fo['name'], `${at}.fills[${i}].name`), kit: kitResult(fo['kit'], `${at}.fills[${i}].kit`), raw: fo }; }) };
  }
  return base;
}
export interface Registries { uri: string; listed: Listed[]; raw: JsonObject }
export function registries(reply: JsonObject, what = 'registries'): Registries {
  const uri = str(reply['uri'], `${what}: uri`);
  expect(uri, `${what}: published at deep://registries/<core version>`).toMatch(/^deep:\/\/registries\/.+/);
  return { uri, listed: arr(reply['registries'], `${what}: registries`).map((v, i) => listedOf(v, `${what}: registries[${i}]`)), raw: reply };
}
export function theRegistry(r: Registries, name: string, what = 'deep://registries'): Listed {
  const l = r.listed.find((x) => x.kind === 'registry' && x.name === name);
  expect(l, `${what} lists the registry ${name}; it lists ${r.listed.map((x) => `${x.name} (${x.kind})`).join(', ') || 'nothing'}`).toBeDefined();
  return l!;
}
export function theEntry(l: Listed, name: string, what = l.name): Entry {
  const e = (l.entries ?? []).find((x) => x.name === name);
  expect(e, `${what} holds the entry ${name}; it holds ${(l.entries ?? []).map((x) => x.name).join(', ') || 'none'}`).toBeDefined();
  return e!;
}
export const REGISTRIES: JsonObject = { call: 'registries' };
/** One fresh process's `registries` listing. */
export function listing(bin: string, evidence: string, planted?: string, extra: Parameters<typeof scenario>[2] = {}): Registries {
  return registries(run(bin, scenario(evidence, [REGISTRIES], extra), planted)[0]!);
}

/** Every planted entry of the registry `l`, named in PLANTED, is refused by its kit, its result naming it. */
export function plantedRefusedFailures(l: Listed, names: readonly string[]): string[] {
  const failures: string[] = [];
  for (const name of names) {
    const p = (l.planted ?? []).find((x) => x.name === name);
    if (!p) { failures.push(`${l.name} lists no planted entry ${name}; it lists ${(l.planted ?? []).map((x) => x.name).join(', ') || 'none'}`); continue; }
    if (p.result.verdict !== 'FAIL') failures.push(`${l.name}'s kit admits its planted entry ${name}: ${show(p.raw)}`);
    else if (!mentions(p.result.raw, name)) failures.push(`${l.name}'s kit refuses ${name} without naming it: ${show(p.result.raw)}`);
    else if (!p.result.rules.some((r) => r.verdict === 'FAIL' && r.message !== '')) failures.push(`${l.name}'s kit refuses ${name} with no failing rule's message: ${show(p.result.raw)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Packs (#306) and the calls on documents.

export const PACKS: JsonObject = { call: 'packs' };
export const installPack = (p: PackFixture, session?: string): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir, ...(session ? { session } : {}) });
export interface PackRow { pack: string; version: string; state: string; checks: number; issues: JsonObject[] }
export function packRowOf(v: JsonValue, what: string): PackRow {
  const o = obj(v, what);
  return {
    pack: str(o['pack'], `${what}.pack`), version: str(o['version'], `${what}.version`), state: str(o['state'] ?? o['outcome'], `${what}.state`),
    checks: typeof o['checks'] === 'number' ? o['checks'] : 0, issues: arr(o['issues'] ?? [], `${what}.issues`).map((i, k) => obj(i, `${what}.issues[${k}]`)),
  };
}
export function packRow(reply: JsonObject, p: PackFixture): PackRow {
  const rows = arr(reply['packs'], 'packs: packs').map((v, i) => packRowOf(v, `packs[${i}]`)).filter((r) => r.pack === p.id && r.version === p.version);
  expect(rows.length, `the packs reply has one row for ${packAt(p)}`).toBe(1);
  return rows[0]!;
}
/** The pack `row` was refused at its pack check with an error that names each of `names`. Each failure names the pack. */
export function packRefusedFailures(row: PackRow, p: PackFixture, names: readonly string[]): string[] {
  const failures: string[] = [];
  if (row.state !== 'refused') failures.push(`${packAt(p)} was ${row.state} at its pack check, not refused`);
  const errors = row.issues.filter((i) => i['severity'] === 'error' || i['severity'] === undefined);
  for (const name of names) if (!errors.some((i) => mentions(i, name))) failures.push(`${packAt(p)}'s refusal names no ${name}: ${show(row.issues as JsonValue)}`);
  return failures;
}

/** A board as your shell sends it: no `id`, no `layers`; `packs` names each pack version it uses. */
export function board(title: string, packs: readonly string[], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #200 acceptance suite.`, size: [640, 360],
    ...(packs.length ? { packs: [...packs] } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const rect = (id: string, name: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } } });
export const SIZE: [number, number] = [320, 180];
/** A whole revision from your shell (`deep show`), with its issues and, with `pixels`, a snapshot of `size` px. */
export function present(doc: string, document: JsonObject, options: { pixels?: boolean; size?: [number, number]; t?: string } = {}): JsonObject {
  const include = ['issues', ...(options.pixels ? ['pixels'] : [])];
  return { call: 'deep show', peer: YOU_PEER, doc, document, include, ...(options.pixels ? { size: options.size ?? SIZE } : {}), ...(options.t ? { t: options.t } : {}) };
}
export const evalAt = (doc: string, t = 0): JsonObject => ({ call: 'eval', doc, t });
/** `resolve` (README): an entry of `reg` by name, through the document `doc`'s pinned packs; `runs` times the interned lookup. */
export const resolveCall = (doc: string, reg: string, name: string, runs?: number): JsonObject => ({ call: 'resolve', doc, registry: reg, name, ...(runs ? { runs } : {}) });
export function outcome(reply: JsonObject): string {
  return typeof reply['outcome'] === 'string' ? reply['outcome'] : '';
}
export function snapshotHash(reply: JsonObject, what: string): string {
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBeGreaterThan(0);
  return str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
}
/** An `eval` reply's nodes as `operator|item` → {key, result}. */
export function nodesOf(reply: JsonObject, what: string): Map<string, { key: string; result: string }> {
  const out = new Map<string, { key: string; result: string }>();
  for (const [i, n] of arr(reply['nodes'], `${what}: nodes`).entries()) {
    const o = obj(n, `${what}: nodes[${i}]`);
    out.set(`${str(o['operator'], `${what}: nodes[${i}].operator`)}|${o['item'] === null ? '-' : String(o['item'])}`, { key: str(o['key'], `${what}: nodes[${i}].key`), result: str(o['result'], `${what}: nodes[${i}].result`) });
  }
  return out;
}
/** Every node `before` has keeps its content key (and, with `results`, the bytes it wrote) in `after`. Each failure names the node's operator and item. */
export function keyFailures(before: Map<string, { key: string; result: string }>, after: Map<string, { key: string; result: string }>, what: string, results = true): string[] {
  const failures: string[] = [];
  if (before.size === 0) failures.push(`${what}: the earlier evaluation has no nodes to compare`);
  for (const [node, b] of before) {
    const a = after.get(node);
    if (!a) { failures.push(`${what}: node ${node} is gone`); continue; }
    if (a.key !== b.key) failures.push(`${what}: node ${node}'s content key changed from ${b.key} to ${a.key}`);
    else if (results && a.result !== b.result) failures.push(`${what}: node ${node} wrote other bytes (${b.result} → ${a.result})`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The kit (#138's `kit` call): only the fields this suite reads.

export interface KitPart { part: string; verdict: string; failures: JsonObject[] }
export function kitModule(reply: JsonObject, name: string): { verdict: string; parts: KitPart[]; failures: JsonObject[] } {
  const m = arr(reply['modules'], 'kit: modules').map((x, i) => obj(x, `kit: modules[${i}]`)).find((x) => x['module'] === name);
  expect(m, `the kit's report holds module ${name}`).toBeDefined();
  const failures = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  const parts = arr(m!['parts'], `${name}.parts`).map((p, j) => {
    const po = obj(p, `${name}.parts[${j}]`);
    const part = str(po['part'], `${name}.parts[${j}].part`);
    const cases = arr(po['cases'] ?? [], `${name}.${part}.cases`).flatMap((c) => (isObject(c) && isObject(c['failure']) ? [c['failure']] : []));
    return { part, verdict: str(po['verdict'], `${name}.${part}.verdict`), failures: [...failures(po['failures'], `${name}.${part}.failures`), ...cases] };
  });
  return { verdict: str(m!['verdict'], `${name}.verdict`), parts, failures: failures(m!['failures'], `${name}.failures`) };
}
export const kitCall = (modules: string[]): JsonObject => ({ call: 'kit', modules, sequences: 100, param_sets: 50 });

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
export function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-200-base', sha.slice(0, 12));
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
/** A file at the merge base, by path. */
export function baseFile(path: string): string {
  return execFileSync('git', ['show', `${mergeBase()}:${path}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
/** The op table at the merge base (crates/deep-canvas-effects/src/table.rs): every base step with its weight and exactness. */
export function baseOpTable(): { name: string; weight: number; exact: boolean }[] {
  const text = baseFile('crates/deep-canvas-effects/src/table.rs');
  const out: { name: string; weight: number; exact: boolean }[] = [];
  for (const m of text.matchAll(/\bd\("([a-z0-9_]+@\d+)",\s*(?:&\[[^\]]*\]|[A-Z_]+),\s*([0-9.]+),\s*(true|false)/g)) out.push({ name: m[1]!, weight: Number(m[2]), exact: m[3] === 'true' });
  for (const m of text.matchAll(/\btex\("([a-z0-9_]+@\d+)",\s*(?:&\[[^\]]*\]|[A-Z_]+),\s*(true|false)/g)) out.push({ name: m[1]!, weight: 1, exact: m[2] === 'true' });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Scripts: the contract step (#139) and the canvas closure lint, run on scratch trees.

export interface ScriptRun { code: number | null; out: string }
export function script(file: string, args: string[], env: NodeJS.ProcessEnv = {}): ScriptRun {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', file), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const CONTRACT_DATA = ['extension-api.json', 'hub-slots.json', 'digests.json', 'schemas', 'slots', 'rpc-methods.json', 'canvas-registries.json', 'canvas-schemas', 'canvas-closures.json'];
const dirs: string[] = [];
/** A scratch folder deleted after the file. */
export function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `deep-200-${tag}-`));
  dirs.push(d);
  return d;
}
export function useTempDirs(): void {
  afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
}
/**
 * A scratch tree for `--root`: packages/contracts' published data (or none of it, with `empty`), the repo's
 * contracts/ folder with no releases or breaks, and with `docs` the canvas reference.
 */
export function scratchTree(tag: string, options: { empty?: boolean; docs?: boolean } = {}): string {
  const root = tempDir(tag);
  mkdirSync(join(root, 'packages/contracts'), { recursive: true });
  if (!options.empty) {
    for (const name of CONTRACT_DATA) {
      const from = join(REPO, 'packages/contracts', name);
      if (existsSync(from)) cpSync(from, join(root, 'packages/contracts', name), { recursive: true });
    }
  }
  if (existsSync(join(REPO, 'contracts'))) cpSync(join(REPO, 'contracts'), join(root, 'contracts'), { recursive: true });
  for (const sub of ['releases', 'breaks']) rmSync(join(root, 'contracts', sub), { recursive: true, force: true });
  mkdirSync(join(root, 'contracts/releases'), { recursive: true });
  if (!existsSync(join(root, 'contracts/shipped.json'))) writeJson(join(root, 'contracts/shipped.json'), { pieces: [] });
  if (options.docs) {
    mkdirSync(join(root, 'docs'), { recursive: true });
    copyFileSync(join(REPO, 'docs/canvas-primitives.md'), join(root, 'docs/canvas-primitives.md'));
  }
  return root;
}
export const failLines = (r: ScriptRun, prefix: string): string[] => r.out.split('\n').filter((l) => l.startsWith(`FAIL ${prefix}`));
export const shown = (r: ScriptRun): string => `exit ${r.code}\n${r.out.slice(0, 3000)}`;

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/185).

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
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
