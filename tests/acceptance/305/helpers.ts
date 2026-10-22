// Test-side tools for the #305 acceptance tests: `deep-show` built per build set (a Cargo feature
// set: `core`, `r1`, `r2` or `full`, plus the test canvas modules' features), driven by JSON lines;
// a scenario's calls (deep_show, `deep show --check`, `registry`, `revisions`); the startup refusal
// a failed seal answers; the documents the test canvas modules draw; the module_missing and
// reply-schema checks the criteria's planted programs must fail; and the reference-Mac gate with
// the design's judge for timing results. Nothing here stands in for the registry, the seal, the
// document check or render-back.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/305 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
/** Where cargo uplifts the binary; each build set's copy is taken from here right after its build. */
const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** Registration and the seal at startup: under 50 ms (Registry and seal: Cost; the issue's budget). */
export const SEAL_BUDGET_MS = 50;
/** A startup the seal refuses exits with this status, after one JSON line (README: Startup refusal). */
export const REFUSED_EXIT = 2;

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
export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/** Sorted copy, by code point. */
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ---------------------------------------------------------------------------------------------------
// Build sets: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** The test canvas modules' Cargo features (README: The test canvas modules). */
export type TestFeature =
  | 'test-a' | 'test-b' | 'test-b-requires-a'
  | 'test-two-writers' | 'test-later-phase' | 'test-cycle' | 'test-missing-dep';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

/** `cargo build --locked --bin deep-show --no-default-features --features <set>[,<test feature>…]`; '' or the error text. */
function buildFeatures(features: string[]): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo build --bin ${SHOW_NAME} --no-default-features --features ${features.join(',')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/**
 * Builds every listed build set once, before the file's tests, and copies each binary out of
 * target/debug under its own name, so a later build doesn't replace it. A test that asks for a
 * build that failed fails with cargo's error.
 */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-305-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const error = buildFeatures(featuresOf(build));
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(UPLIFTED, bin);
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

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }

/** Pipes the lines into one process of `deep-show <args>`, timing the whole process. Never throws on exit status. */
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 90_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const started = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - started;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

export interface Run { replies: JsonObject[]; ms: number; out: JsonObject }

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call; the process exits 0. */
export function run(bin: string, scenario: JsonObject, sealPlanted?: string): Run {
  const args = ['run', ...(sealPlanted ? ['--planted', sealPlanted] : [])];
  const s = start(bin, args, [scenario]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies, ms: s.ms, out };
}

export interface Refusal { reason: string; modules: string[]; arrays: string[]; raw: JsonObject }

/**
 * A build the seal refuses: `deep-show run` writes one JSON line, `{"ok": false, "code":
 * "seal_refused", "reason", "modules", "arrays"}`, and exits 2 without reading a scenario. Fed
 * one scenario line, it answers no reply to it.
 */
export function startupRefusal(bin: string, sealPlanted?: string): Refusal {
  const args = ['run', ...(sealPlanted ? ['--planted', sealPlanted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply to the scenario: ${s.stdout.slice(0, 1000)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect(raw['ok'], 'the refusal says ok: false').toBe(false);
  expect(raw['code'], 'the refusal\'s code').toBe('seal_refused');
  return { reason: str(raw['reason'], 'the refusal\'s reason'), modules: strs(raw['modules'], 'the refusal\'s modules'), arrays: strs(raw['arrays'], 'the refusal\'s arrays'), raw };
}

/** The sentence a test reads when a build that should start was refused, or one that should be refused started. */
export function startOutcome(bin: string, sealPlanted?: string): { started: boolean; status: number | null; line: JsonValue | undefined } {
  const args = ['run', ...(sealPlanted ? ['--planted', sealPlanted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  const line = s.lines[0];
  const started = s.status === 0 && isObject(line) && line['ok'] === true;
  return { started, status: s.status, line };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios, calls and replies

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-305-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The one agent's session every scenario binds deep_show to. */
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: registry', process: { pid: 4100, start: 1_000 } };
/** A minimal process table: `deep show` run from your own shell, outside every agent's tree. */
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
export const IN_YOURS: JsonObject = { pid: 3002, start: 3_000 };
export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB7D', 1), b: ulid('01JB7D', 2) } as const;

export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: PANELS,
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' } },
    calls,
    ...(planted ? { planted } : {}),
  };
}

export const SIZE: [number, number] = [320, 200];
export interface ShowOptions { doc?: string; pixels?: boolean; t?: string }
/** An agent's deep_show call, with its issues and, with `pixels`, a snapshot of `SIZE` px at `t`. */
export function show(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const include = options.pixels ? ['issues', 'pixels'] : ['issues'];
  return { call: 'deep_show', session: ALPHA.id, doc: options.doc ?? DOC.a, document, include, ...(options.pixels ? { size: SIZE } : {}), ...(options.t ? { t: options.t } : {}) };
}
/** `deep show --check` from your shell: the document check's result. */
export function check(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const include = options.pixels ? ['issues', 'pixels'] : ['issues'];
  return { call: 'deep show', peer: IN_YOURS, doc: options.doc ?? DOC.a, document, include, check: true, ...(options.pixels ? { size: SIZE } : {}) };
}
export const REGISTRY: JsonObject = { call: 'registry' };
export const revisionsOf = (doc: string = DOC.a): JsonObject => ({ call: 'revisions', doc });

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { check?: string; code: string; severity: string; ids: string[]; path?: string; actual?: JsonValue; what?: string }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'], `${what}: issues[${i}].ids`) } as Issue;
  });
}
export interface Snapshot { sha256: string; w: number; h: number }
export function snapshots(reply: JsonObject, what = 'the reply'): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const o = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(o['sha256'], `${what}: snapshots[${i}].sha256`), w: num(o['w'], 'w'), h: num(o['h'], 'h') };
  });
}
/** The one snapshot a presented reply with `pixels` carries. */
export function theSnapshot(reply: JsonObject, what = 'the reply'): Snapshot {
  expect(outcome(reply), `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
  const list = snapshots(reply, what);
  expect(list.length, `${what} carries one snapshot`).toBe(1);
  expect([list[0]!.w, list[0]!.h], `${what}'s snapshot is ${SIZE.join(' × ')} px`).toEqual(SIZE);
  return list[0]!;
}
/** The current revision's hash from a `revisions` reply. */
export function currentHash(reply: JsonObject): string {
  const now = arr(reply['revisions'], 'revisions').map((v, i) => obj(v, `revisions[${i}]`)).filter((r) => r['state'] === 'current');
  expect(now.length, `exactly one revision is current: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return str(now[0]!['hash'], 'the current revision\'s hash');
}

export interface Registry { core: string; set_digest: string; build_set: string; state: string; modules: string[]; plan: Record<string, string[]>; arrays: Record<string, JsonObject>; seal: { ms: number; runs: number }; raw: JsonObject }
/** The `registry` reply: the sealed set as the build holds it. */
export function registry(reply: JsonObject): Registry {
  const plan: Record<string, string[]> = {};
  for (const [phase, ops] of Object.entries(obj(reply['plan'], 'registry: plan'))) plan[phase] = strs(ops, `registry: plan.${phase}`);
  const arrays: Record<string, JsonObject> = {};
  for (const [name, a] of Object.entries(obj(reply['arrays'], 'registry: arrays'))) arrays[name] = obj(a, `registry: arrays.${name}`);
  const seal = obj(reply['seal'], 'registry: seal');
  return {
    core: str(reply['core'], 'registry: core'), set_digest: str(reply['set_digest'], 'registry: set_digest'),
    build_set: str(reply['build_set'], 'registry: build_set'), state: str(reply['state'], 'registry: state'),
    modules: strs(reply['modules'], 'registry: modules'), plan, arrays,
    seal: { ms: num(seal['ms'], 'registry: seal.ms'), runs: num(seal['runs'], 'registry: seal.runs') }, raw: reply,
  };
}
/** Every operator in the plan, over every phase. */
export const operators = (r: Registry): string[] => sorted(Object.values(r.plan).flat());

/** `deep-show run` with one `registry` call, in a fresh process. */
export function sealed(bin: string, evidence: string): Registry {
  return registry(run(bin, scenario(evidence, [REGISTRY])).replies[0]!);
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them: no `id`, no `layers`, no item `layer`.

export const rect = (id: string, name: string, box: number[], order: string, role = 'muted'): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
export const label = (id: string, name: string, text: string, pos: [number, number], order: string): JsonObject =>
  ({ id, kind: 'text@1', name, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
/** Module `test.a`'s kind: a filled box with a number its array `test.a.value` carries. */
export const aItem = (id: string, box: number[], order: string, value = 1): JsonObject =>
  ({ id, kind: 'test.a@1', name: `A ${id}`, order, params: { box, value } });
/** Module `test.b`'s kind: a filled box; `echo` set is the feature its operator `test.b.echo`, which reads `test.a.value`, evaluates. */
export const bItem = (id: string, box: number[], order: string, echo?: number): JsonObject =>
  ({ id, kind: 'test.b@1', name: `B ${id}`, order, params: { box, ...(echo === undefined ? {} : { echo }) } });
/** The logic module's kind: a WebAssembly program by hash (Logic `logic@1`). */
export const logicItem = (id: string, program: string): JsonObject =>
  ({ id, kind: 'logic@1', name: `Logic ${id}`, order: 'z0', params: { program, step_rate: 60, writes: { score: { type: 'i32' } } } });

export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1,
    profile: 'board',
    title,
    description: `${title}, drawn by a test agent through deep_show for the #305 acceptance tests.`,
    size: SIZE,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    ...extra,
  };
}
/** A board of the core's kinds alone: what every build set draws. */
export const CORE_ONLY = board('Core only', [
  rect('panel-back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  rect('bar', 'Progress bar', [16, 120, 200, 16], 'a1'),
  label('caption', 'Caption', 'Sealed and ready', [16, 24], 'a2'),
]);
/** The same board with one label's text changed: a document change and nothing else. */
export const CORE_ONLY_EDITED = (() => {
  const out = clone(CORE_ONLY);
  (((out['items'] as JsonObject)['caption'] as JsonObject)['params'] as JsonObject)['text'] = 'Sealed, revised';
  return out;
})();
/** An empty board of the same size: what a board whose items draw nothing looks like. */
export const EMPTY = board('Empty', []);
export const requires = (modules: Record<string, string>): JsonObject => ({ requires: { modules } });

// ---------------------------------------------------------------------------------------------------
// The checks the criteria's planted programs must fail. Each returns its failures as sentences;
// an empty list is a pass.

export const CORE_VERSION = /^core@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Criterion 5: every deep_show reply and every document check result carries `core` (`core@<semver>`)
 * and `set_digest` (a d1 digest, 64 lowercase hex). Each failure names the field.
 */
export function replySchemaFailures(reply: JsonObject, what = 'the reply'): string[] {
  const failures: string[] = [];
  const core = reply['core'];
  if (typeof core !== 'string') failures.push(`${what} has no core field (core@<semver>); got ${JSON.stringify(core)}`);
  else if (!CORE_VERSION.test(core)) failures.push(`${what}'s core field is ${JSON.stringify(core)}, not core@<semver>`);
  const digest = reply['set_digest'];
  if (typeof digest !== 'string') failures.push(`${what} has no set_digest field (the module-set digest); got ${JSON.stringify(digest)}`);
  else if (!DIGEST.test(digest)) failures.push(`${what}'s set_digest field is ${JSON.stringify(digest)}, not a d1 digest of 64 lowercase hex characters`);
  return failures;
}
/** `core` and `set_digest` of a reply that passes the schema. */
export function stamp(reply: JsonObject, what = 'the reply'): { core: string; set_digest: string } {
  expect(replySchemaFailures(reply, what), `${what} carries core@version and the module-set digest`).toEqual([]);
  return { core: reply['core'] as string, set_digest: reply['set_digest'] as string };
}

const word = (name: string): RegExp => new RegExp(`(^|[^a-z0-9.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9.])`);
/** The module_missing issues that name `module` in `what`. */
export function moduleMissing(reply: JsonObject, module: string): Issue[] {
  return issues(reply).filter((i) => i.code === 'module_missing' && typeof i.what === 'string' && word(module).test(i.what));
}
/**
 * Criteria 2, 3 and 4: a document that needs a canvas module this build lacks is refused with
 * `module_missing` naming the module; a check that needs it is BLOCKED. Each failure names what is
 * wrong.
 */
export function moduleMissingFailures(reply: JsonObject, module: string, checked: boolean, what = 'the reply'): string[] {
  const failures: string[] = [];
  if (outcome(reply) !== 'refused') failures.push(`${what} is ${outcome(reply)}, not refused, for a document that needs the ${module} module this build lacks`);
  const named = moduleMissing(reply, module);
  if (named.length === 0) {
    const codes = issues(reply).map((i) => `${i.code} (${i.what ?? ''})`).join('; ') || 'none';
    failures.push(`${what} has no module_missing issue naming ${module}; its issues: ${codes}`);
  }
  if (named.some((i) => i.severity !== 'error')) failures.push(`${what}'s module_missing naming ${module} is not an error`);
  if (snapshots(reply).length > 0) failures.push(`${what} carries a snapshot of a refused document`);
  if (checked && reply['result'] !== 'BLOCKED') failures.push(`${what}'s check result is ${JSON.stringify(reply['result'])}, not BLOCKED, though the check needs the ${module} module`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The program whose bytes must never be read: a FIFO where the evidence store would keep them.

/** The sha256 the document names its program by: of bytes the test never writes anywhere. */
export const PROGRAM_SHA256 = 'c0ffee0305' + '0'.repeat(54);
/**
 * Puts a FIFO at the store's file for `PROGRAM_SHA256` (`<root>/<2 hex>/<62 hex>`). Nothing ever
 * writes to it, so a process that opens it to read the program's bytes blocks until spawnSync's
 * timeout kills it; a process that never reads them finishes. POSIX only (mkfifo).
 */
export function plantProgramFifo(root: string): string {
  const dir = join(root, PROGRAM_SHA256.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PROGRAM_SHA256.slice(2));
  execFileSync('mkfifo', [path]);
  return path;
}
/** Fails with an INCONCLUSIVE message where mkfifo isn't there: never a pass. */
export function requireFifo(): void {
  expect(process.platform !== 'win32', 'INCONCLUSIVE: the never-read proof plants a FIFO with mkfifo, POSIX only; this is not a pass').toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/14, 62 and 393).

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
