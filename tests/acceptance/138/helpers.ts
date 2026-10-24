// Test-side tools for the #138 acceptance tests: `deep-show` built per Cargo feature set (a build set plus
// the test canvas modules' features, as #305's and #387's suites build it), driven by JSON lines; the
// scenario and its calls (#393's, #96's and #387's, plus this suite's `kit`, `manifest`, `catalog`,
// `golden`, `record`, `goldens`, `decide`, `corpus_record` and `compare_images`); the kit's report read
// into types; the reference-Mac gates; and an 8-bit RGBA PNG writer for the comparator's images. Nothing
// here stands in for the kit, a part, a comparison, a golden store or a decision.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/138 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** Flicks per second (One clock). */
export const FLICKS = 705_600_000;
/** One frame at 60 fps, in flicks. */
export const FRAME_60 = FLICKS / 60;
/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;

/** The kit's parts (README: The kit's parts), a closed list. */
export const PARTS = [
  'fixtures', 'clean_rebuild', 'patch_fuzz', 'read_set', 'order', 'schedule', 'repair_loop',
  'carried_state', 'late_entry', 'time_order', 'contribution', 'catalog', 'migration',
] as const;
export type Part = (typeof PARTS)[number];
/** The parts every canvas module runs, whatever it registers. */
export const EVERY_MODULE_PARTS: readonly Part[] = ['fixtures', 'clean_rebuild', 'patch_fuzz', 'read_set', 'order', 'schedule', 'repair_loop', 'time_order'];
export const VERDICTS = ['PASS', 'FAIL', 'INVALID', 'BLOCKED'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const BACKENDS = ['vello_cpu', 'noop', 'gpu'] as const;
export type Backend = (typeof BACKENDS)[number];

/** The issue's numbers. */
export const SEQUENCES = 10_000;
export const SHUFFLED_ORDERS = 8;
export const SEEDED_TIMES = 100;
export const PARAM_SETS = 1_000;
export const ROLLBACK_WINDOW = 8;
export const KIT_BUDGET_MS = 5 * 60 * 1000;

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
export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);

/** A fixture file of this suite, parsed. */
export function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, `fixture ${path}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name (#305).

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** The test canvas modules' Cargo features (README: The test canvas modules). */
export type TestFeature =
  | 'test-kit-crash'
  | 'test-kit-blind' | 'test-kit-blind-fixed'
  | 'test-kit-noisy' | 'test-kit-noisy-fixed'
  | 'test-kit-fixer' | 'test-kit-fixer-dangles' | 'test-kit-fixer-unproved'
  | 'test-kit-rogue' | 'test-kit-rogue-listed'
  | 'test-kit-carry' | 'test-kit-carry-drops-hits'
  | 'test-kit-tally' | 'test-kit-tally-keeps-occurrence' | 'test-kit-tally-skips-restored'
  | 'test-kit-cover' | 'test-kit-cover-fixed'
  | 'test-kit-snap' | 'test-kit-snap-off'
  | 'test-kit-glyphs' | 'test-kit-glyphs-no-box'
  | 'test-kit-keys' | 'test-kit-keys-kept-index'
  | 'test-kit-formula'
  | 'test-kit-gpu-pass' | 'test-kit-gpu-pass-shifted' | 'test-kit-gpu-pass-cpu-ref-fails'
  | 'test-kit-sneak' | 'test-kit-order'
  | 'test-kit-mig-1' | 'test-kit-mig-2' | 'test-kit-mig-2-moves' | 'test-kit-mig-2-overflow'
  | 'test-kit-loose'
  | 'test-kit-selfish' | 'test-kit-selfish-analytic';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

function cargoBuild(features: string[], release: boolean, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-138-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const error = cargoBuild(featuresOf(build), false);
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_NAME)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
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

/**
 * A release build (`cargo build --release`) of one feature set, with the kit ledger it embeds named by
 * `DEEP_KIT_LEDGER` at build time (README: A release build refuses what failed the kit); the binary is
 * copied into `dir`. Returns the copy's path, or cargo's error.
 */
export function releaseBuild(build: Build, ledger: string, dir: string): { bin: string; error: string } {
  const error = cargoBuild(featuresOf(build), true, { DEEP_KIT_LEDGER: ledger });
  const bin = join(dir, `${SHOW_NAME}-release-${buildName(build).replace(/[^a-z0-9+.-]/g, '_')}`);
  if (error === '') copyFileSync(join(REPO, 'target', 'release', exe(SHOW_NAME)), bin);
  return { bin, error };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, timeoutMs = 1_800_000): JsonObject[] {
  const s = start(bin, ['run'], [sc], timeoutMs);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: two agents' sessions, the process table, panels, documents (#96's).

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: kit', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: kit', process: { pid: 5200, start: 2_000 } };
export const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
/** The OS process table the peer check reads: `deep show` run in each agent's tree, and in yours. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 }, // your terminal
  { pid: 3001, ppid: 3000, start: 110 }, // your shell
  { pid: 3002, ppid: 3001, start: 3_000 }, // `deep show` you ran
  { pid: 4100, ppid: 3001, start: 1_000 }, // agent alpha
  { pid: 4101, ppid: 4100, start: 1_100 },
  { pid: 4102, ppid: 4101, start: 1_200 }, // `deep show` alpha ran
  { pid: 5200, ppid: 3001, start: 2_000 }, // agent bravo
  { pid: 5201, ppid: 5200, start: 2_100 },
  { pid: 5202, ppid: 5201, start: 2_200 }, // `deep show` bravo ran
];
export const IN_YOURS: JsonObject = { pid: 3002, start: 3_000 };
export const IN_ALPHA: JsonObject = { pid: 4102, start: 1_200 };

/** Who a call acts as: an agent's MCP session, or `deep show` from a process tree (#96's). */
export type Who = JsonObject;
export const AS_ALPHA: Who = { session: ALPHA.id };
export const AS_BRAVO: Who = { session: BRAVO.id };
export const AS_YOU: Who = { peer: IN_YOURS };
export const AS_ALPHA_CLI: Who = { peer: IN_ALPHA };
export const WRITER = { you: { kind: 'you', id: 'you' }, alpha: { kind: 'agent', id: ALPHA.thread }, bravo: { kind: 'agent', id: BRAVO.thread } } as const;

export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB138D', 1), b: ulid('01JB138D', 2) } as const;
export const P = (n: number): string => ulid('01JB138P', n);

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-138-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface ScenarioExtra {
  planted?: string; goldens?: string; environment?: JsonObject; commit?: string; docs?: JsonObject; shuffle?: number;
}

/** A scenario: the two agents, the process table, one panel per document in `docs` (DOC.a and DOC.b by default). */
export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docs: JsonObject = extra.docs ?? { [DOC.a]: { panel: 'p1' }, [DOC.b]: { panel: 'p2' } };
  const panels: JsonObject = {};
  for (const d of Object.values(docs)) panels[str(obj(d, 'docs entry')['panel'], 'panel')] = { rect: [0, 0, 800, 600] };
  const out: JsonObject = { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs, calls };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && k !== 'docs') out[k] = v as JsonValue;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The kit call and its report (README: The kit)

export interface KitOptions {
  modules?: string[]; parts?: Part[]; backends?: Backend[]; seed?: number; sequences?: number; param_sets?: number;
  patch_seed?: number; replay?: string; corpus?: string; ledger?: string;
}
export const kitCall = (o: KitOptions = {}): JsonObject => {
  const out: JsonObject = { call: 'kit' };
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
};

export interface Coverage { kinds: string[]; fields: string[]; modules: string[] }
export interface Failure { code: string; [field: string]: JsonValue }
export interface Case {
  case: string; verdict: Verdict; fixture?: string; backend?: string; probe?: string;
  declares?: Coverage; reached?: Coverage; expected_codes?: string[]; raised_codes?: string[];
  twin?: { verdict: string }; failure?: Failure; raw: JsonObject;
}
export interface PartResult { part: string; verdict: Verdict; declared: number; ran: number; exit: number; cases: Case[]; failures: Failure[]; raw: JsonObject }
export interface ModuleResult { module: string; version: string; digest: string; verdict: Verdict; parts: PartResult[]; failures: Failure[]; raw: JsonObject }
export interface Report { verdict: Verdict; seed: number; backends: string[]; lease: JsonObject; modules: ModuleResult[]; corpus: string[]; criteria: Record<string, string>; raw: JsonObject }

function verdictOf(v: JsonValue | undefined, what: string): Verdict {
  const s = str(v, what);
  expect(VERDICTS as readonly string[], `${what} is one of ${VERDICTS.join(', ')}`).toContain(s);
  return s as Verdict;
}
function coverage(v: JsonValue | undefined, what: string): Coverage | undefined {
  if (v === undefined) return undefined;
  const o = obj(v, what);
  return { kinds: strs(o['kinds'] ?? [], `${what}.kinds`), fields: strs(o['fields'] ?? [], `${what}.fields`), modules: strs(o['modules'] ?? [], `${what}.modules`) };
}
function failure(v: JsonValue | undefined, what: string): Failure {
  const o = obj(v, what);
  str(o['code'], `${what}.code`);
  return o as Failure;
}
function caseOf(v: JsonValue, what: string): Case {
  const o = obj(v, what);
  const c: Case = { case: str(o['case'], `${what}.case`), verdict: verdictOf(o['verdict'], `${what}.verdict`), raw: o };
  if (o['fixture'] !== undefined) c.fixture = str(o['fixture'], `${what}.fixture`);
  if (o['backend'] !== undefined) c.backend = str(o['backend'], `${what}.backend`);
  if (o['probe'] !== undefined) c.probe = str(o['probe'], `${what}.probe`);
  const d = coverage(o['declares'], `${what}.declares`);
  if (d) c.declares = d;
  const r = coverage(o['reached'], `${what}.reached`);
  if (r) c.reached = r;
  if (o['expected_codes'] !== undefined) c.expected_codes = strs(o['expected_codes'], `${what}.expected_codes`);
  if (o['raised_codes'] !== undefined) c.raised_codes = strs(o['raised_codes'], `${what}.raised_codes`);
  if (o['twin'] !== undefined) c.twin = { verdict: str(obj(o['twin'], `${what}.twin`)['verdict'], `${what}.twin.verdict`) };
  if (o['failure'] !== undefined) c.failure = failure(o['failure'], `${what}.failure`);
  return c;
}
function partOf(v: JsonValue, what: string): PartResult {
  const o = obj(v, what);
  return {
    part: str(o['part'], `${what}.part`), verdict: verdictOf(o['verdict'], `${what}.verdict`),
    declared: num(o['declared'], `${what}.declared`), ran: num(o['ran'], `${what}.ran`), exit: num(o['exit'], `${what}.exit`),
    cases: arr(o['cases'], `${what}.cases`).map((c, i) => caseOf(c, `${what}.cases[${i}]`)),
    failures: arr(o['failures'] ?? [], `${what}.failures`).map((f, i) => failure(f, `${what}.failures[${i}]`)),
    raw: o,
  };
}
/** A `kit` call's reply, read strictly. */
export function report(reply: JsonObject, what = 'the kit'): Report {
  const modules = arr(reply['modules'], `${what}: modules`).map((m, i) => {
    const o = obj(m, `${what}: modules[${i}]`);
    const name = str(o['module'], `${what}: modules[${i}].module`);
    return {
      module: name, version: str(o['version'], `${name}.version`), digest: str(o['digest'], `${name}.digest`),
      verdict: verdictOf(o['verdict'], `${name}.verdict`),
      parts: arr(o['parts'], `${name}.parts`).map((p, j) => partOf(p, `${name}.parts[${j}]`)),
      failures: arr(o['failures'] ?? [], `${name}.failures`).map((f, j) => failure(f, `${name}.failures[${j}]`)),
      raw: o,
    };
  });
  const criteria = obj(reply['criteria'] ?? {}, `${what}: criteria`);
  return {
    verdict: verdictOf(reply['verdict'], `${what}: verdict`), seed: num(reply['seed'], `${what}: seed`),
    backends: strs(reply['backends'], `${what}: backends`), lease: obj(reply['lease'], `${what}: lease`),
    modules, corpus: strs(reply['corpus'] ?? [], `${what}: corpus`),
    criteria: Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, str(v, `${what}: criteria.${k}`)])),
    raw: reply,
  };
}
/** One `kit` call in its own scenario. */
export function kit(bin: string, evidence: string, options: KitOptions = {}, extra: ScenarioExtra = {}): Report {
  const [reply] = run(bin, scenario(evidence, [kitCall(options)], extra));
  return report(reply!);
}

export function moduleOf(r: Report, name: string): ModuleResult {
  const m = r.modules.find((x) => x.module === name);
  expect(m, `the kit's report holds module ${name}; it holds ${r.modules.map((x) => x.module).join(', ')}`).toBeDefined();
  return m!;
}
export function partIn(m: ModuleResult, part: Part): PartResult {
  const p = m.parts.find((x) => x.part === part);
  expect(p, `${m.module} ran the ${part} part; it ran ${m.parts.map((x) => x.part).join(', ')}`).toBeDefined();
  return p!;
}
/** Every failure a module's result names: the module's own, each part's, and each case's. */
export function failuresIn(m: ModuleResult, part?: Part): Failure[] {
  const parts = part ? m.parts.filter((p) => p.part === part) : m.parts;
  return [
    ...(part ? [] : m.failures),
    ...parts.flatMap((p) => [...p.failures, ...p.cases.flatMap((c) => (c.failure ? [c.failure] : []))]),
  ];
}
/** The failures with this code whose fields include every given field's value. */
export function matching(list: readonly Failure[], code: string, fields: JsonObject = {}): Failure[] {
  return list.filter((f) => f.code === code && Object.entries(fields).every(([k, v]) => JSON.stringify(f[k]) === JSON.stringify(v)));
}
export function expectFailure(list: readonly Failure[], code: string, fields: JsonObject, what: string): Failure {
  const found = matching(list, code, fields);
  expect(found.length, `${what}: a failure ${code} naming ${show(fields, 400)}; the failures are ${show(list, 3000)}`).toBeGreaterThan(0);
  return found[0]!;
}
/** Every part a module ran ran every case it declared, at least one, and lists each case it ran. */
export function fullRuns(m: ModuleResult): string[] {
  const out: string[] = [];
  for (const p of m.parts) {
    if (p.declared < 1) out.push(`${m.module}: ${p.part} declares ${p.declared} cases`);
    if (p.ran !== p.declared) out.push(`${m.module}: ${p.part} ran ${p.ran} of the ${p.declared} cases it declares`);
    if (p.cases.length !== p.ran) out.push(`${m.module}: ${p.part} lists ${p.cases.length} cases but ran ${p.ran}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The other calls (README: Calls added)

export const MANIFEST: JsonObject = { call: 'manifest' };
export const CATALOG: JsonObject = { call: 'catalog' };
export const REGISTRY: JsonObject = { call: 'registry' };
export const FIXTURES: JsonObject = { call: 'fixtures' };
export const goldenCall = (fixtureName: string, backend: Backend): JsonObject => ({ call: 'golden', fixture: fixtureName, backend });
export const recordCall = (who: Who, fixtureName: string, backend: Backend): JsonObject => ({ call: 'record', ...who, fixture: fixtureName, backend });
export const goldensCall = (fixtureName: string): JsonObject => ({ call: 'goldens', fixture: fixtureName });
export const decide = (who: Who, decision: JsonObject): JsonObject => ({ call: 'decide', ...who, decision });

export interface Golden {
  verdict: Verdict; digest: string | null; environment: string; fingerprint: string; commit: string;
  match: JsonObject | null; reason: string | null; criterion: string | null; probe: string | null; ask: JsonObject | null; raw: JsonObject;
}
export function golden(reply: JsonObject, what: string): Golden {
  const opt = (k: string): string | null => (reply[k] === undefined || reply[k] === null ? null : str(reply[k], `${what}.${k}`));
  return {
    verdict: verdictOf(reply['verdict'], `${what}.verdict`),
    digest: reply['digest'] === null ? null : str(reply['digest'], `${what}.digest`),
    environment: str(reply['environment'], `${what}.environment`), fingerprint: str(reply['fingerprint'], `${what}.fingerprint`),
    commit: str(reply['commit'], `${what}.commit`),
    match: reply['match'] === undefined || reply['match'] === null ? null : obj(reply['match'], `${what}.match`),
    reason: opt('reason'), criterion: opt('criterion'), probe: opt('probe'),
    ask: reply['ask'] === undefined || reply['ask'] === null ? null : obj(reply['ask'], `${what}.ask`),
    raw: reply,
  };
}
export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** A decision the hub took, from you. */
export function decided(reply: JsonObject, what: string): void {
  expect(outcome(reply), `${what} is decided: ${show(reply)}`).toBe('decided');
  str(reply['decision'], `${what}.decision`);
}
/** A decision the hub refused, as an agent's: `not_your_decision`, naming the writer. */
export function refusedAsAgent(reply: JsonObject, what: string, writer: JsonObject): void {
  expect(outcome(reply), `${what} is refused: ${show(reply)}`).toBe('refused');
  expect(reply['code'], `${what} is refused as not_your_decision`).toBe('not_your_decision');
  expect(reply['writer'], `${what} names the writer who tried`).toEqual(writer);
}

// Patches (#96's)
export const patch = (id: string, doc: string, base: number, ops: JsonObject[], extra: JsonObject = {}): JsonObject => ({ patch: id, doc, base, reason: 'a test patch', ops, ...extra });
export const send = (who: Who, p: JsonObject): JsonObject => ({ call: who['session'] !== undefined ? 'deep_show' : 'deep show', ...who, doc: p['doc']!, patch: p });
export const read = (doc: string): JsonObject => ({ call: 'read', doc });
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path, value });
export const del = (id: string): JsonObject => ({ op: 'delete', id, cascade: false });

export interface Issue { code: string; severity: string; ids: string[]; path: string; fix: string; fix_ops: JsonObject[] | null; raw: JsonObject }
export function issuesOf(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`),
      ids: strs(o['ids'] ?? [], `${what}: issues[${i}].ids`), path: String(o['path'] ?? ''), fix: String(o['fix'] ?? ''),
      fix_ops: o['fix_ops'] === undefined || o['fix_ops'] === null ? null : arr(o['fix_ops'], `${what}: issues[${i}].fix_ops`).map((x, j) => obj(x, `fix_ops[${j}]`)),
      raw: o,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Gates: the reference Mac, and its fitness for a budget (#305's and #387's).

export const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine is not a reference Mac, or null when it is one (its GPU is the one GPU cases run on). */
export function gpuProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  return null;
}
/** Why this machine can't give a budget reading, or null: a reference Mac on mains, Low Power Mode off, no thermal warning. */
export function environmentProblem(): string | null {
  const gpu = gpuProblem();
  if (gpu) return gpu;
  let batt: string, power: string, therm: string;
  try {
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine's power state: ${(e as Error).message}`;
  }
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

// ---------------------------------------------------------------------------------------------------
// Images: 8-bit RGBA PNGs for the comparator (criterion 24), written here, never read here.

export interface Image { w: number; h: number; data: Uint8Array }
export function image(w: number, h: number, rgba: [number, number, number, number]): Image {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}
export const cloneImage = (im: Image): Image => ({ w: im.w, h: im.h, data: new Uint8Array(im.data) });
/** Adds `delta` code values to the red channel of pixel (x, y). */
export function nudge(im: Image, x: number, y: number, delta: number): void {
  const i = (y * im.w + x) * 4;
  im.data[i] = Math.max(0, Math.min(255, im.data[i]! + delta));
}
function chunk(type: string, body: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(body)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb) >>> 0);
  return Buffer.concat([len, tb, crc]);
}
export function writePng(path: string, im: Image): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(im.w, 0);
  ihdr.writeUInt32BE(im.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((im.w * 4 + 1) * im.h);
  for (let y = 0; y < im.h; y++) {
    raw[y * (im.w * 4 + 1)] = 0;
    Buffer.from(im.data.buffer, im.data.byteOffset + y * im.w * 4, im.w * 4).copy(raw, y * (im.w * 4 + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0)),
  ]);
  writeFileSync(path, png);
}
