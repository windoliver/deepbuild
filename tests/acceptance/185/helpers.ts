// Test-side tools for the #185 acceptance tests: `deep-show` built per Cargo feature set (a build set
// plus this suite's test features, as #305's, #388's and #138's suites build it), debug or release with
// a kit ledger; the startup refusal line; the `registry`, `schedule` and `kit` calls and the fields this
// suite reads from them (README: The surface under test); the merge base exported and built apart; and
// the reference-Mac gate with the design's judge for timing results. Nothing here stands in for the
// registry, the seal, an interface's digest or the kit: every verdict read here is the binary's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/185 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
export const DIGEST = /^[0-9a-f]{64}$/;
export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
export const INTERFACE_NAME = /^[a-z0-9.]+@\d+$/;

/** The test interface and its two implementations (README: Names this suite chooses). */
export const SIM = 'test.sim@1';
export const SIM_MODULE = 'test.sim';
export const A = 'test.sim.a';
export const B = 'test.sim.b';
export const C_MODULE = 'test.c';
export const POS = 'test.sim.pos';
export const POS_RENAMED = 'test.sim.pos2';
export const SCRATCH = 'test.sim.scratch';
export const SCRATCH_RENAMED = 'test.sim.scratch2';

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

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** This suite's test features (README: Names this suite chooses). */
export type TestFeature =
  | 'test-sim-a' | 'test-sim-b' | 'test-sim-b-f64' | 'test-sim-b-false-bit' | 'test-sim-b-off'
  | 'test-sim-b-private-renamed' | 'test-sim-b-public-renamed' | 'test-sim-c' | 'test-sim-behavior'
  | 'test-gpu-second-backend';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

/** `cargo build --locked [--release] --bin deep-show --no-default-features --features …` in `root`; '' or cargo's error. */
export function cargoBuild(root: string, features: string[], release: boolean, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  return '';
}
/** Builds in `root` and copies the binary to `to`; '' or cargo's error. */
export function buildTo(root: string, features: string[], release: boolean, to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargoBuild(root, features, release, env);
  if (error === '') copyFileSync(join(targetOf(root, { ...process.env, ...env }), release ? 'release' : 'debug', exe(SHOW_NAME)), to);
  return error;
}

export interface Builds { bin: (build: Build) => string; dir: () => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-185-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      made.set(name, { bin, error: buildTo(REPO, featuresOf(build), false, bin) });
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
    dir: () => dir,
  };
}

/** A release build (`--release`) embedding the kit ledger at `ledger` (#138: DEEP_KIT_LEDGER at build time). */
export function releaseBuild(build: Build, ledger: string, dir: string): { bin: string; error: string } {
  const bin = join(dir, `${SHOW_NAME}-release-${buildName(build).replace(/[^a-z0-9+.-]/g, '_')}`);
  return { bin, error: buildTo(REPO, featuresOf(build), true, bin, { DEEP_KIT_LEDGER: ledger }) };
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-185-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: canvas interfaces', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
export const DOC = '01JB185000000000000000000A';

export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
}

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(0, 1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/**
 * A startup refusal (#305's line): `{"ok": false, "code": "seal_refused", "reason", "modules", "arrays",
 * "interface"?, "implementations"?}` and exit 2, with no reply to the scenario it was fed. `interface`
 * and `implementations` are this suite's additions (README: The startup refusal).
 */
export interface Refusal { reason: string; modules: string[]; arrays: string[]; interface: string | undefined; implementations: string[]; raw: JsonObject }
export function startupRefusal(bin: string, planted?: string): Refusal {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(0, 1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply to the scenario: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect([raw['ok'], raw['code']], `the refusal is the seal's: ${show(raw)}`).toEqual([false, 'seal_refused']);
  return {
    reason: str(raw['reason'], 'the refusal\'s reason'),
    modules: strs(raw['modules'] ?? [], 'the refusal\'s modules'),
    arrays: strs(raw['arrays'] ?? [], 'the refusal\'s arrays'),
    interface: typeof raw['interface'] === 'string' ? raw['interface'] : undefined,
    implementations: strs(raw['implementations'] ?? [], 'the refusal\'s implementations'),
    raw,
  };
}

// ---------------------------------------------------------------------------------------------------
// The sealed set: `registry` and `schedule` (deep://schedule/<core version>).

export interface Registry {
  build_set: string; state: string; modules: string[]; digests: Record<string, string>; arrays: Record<string, JsonObject>;
  seal: { ms: number; runs: number }; raw: JsonObject;
}
export function registry(reply: JsonObject, what = 'registry'): Registry {
  const digests = obj(reply['digests'], `${what}: digests`);
  const arrays = obj(reply['arrays'], `${what}: arrays`);
  const seal = obj(reply['seal'], `${what}: seal`);
  return {
    build_set: str(reply['build_set'], `${what}: build_set`), state: str(reply['state'], `${what}: state`),
    modules: strs(reply['modules'], `${what}: modules`),
    digests: Object.fromEntries(Object.entries(digests).map(([k, v]) => [k, str(v, `${what}: digests.${k}`)])),
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, obj(v, `${what}: arrays.${k}`)])),
    seal: { ms: num(seal['ms'], `${what}: seal.ms`), runs: num(seal['runs'], `${what}: seal.runs`) },
    raw: reply,
  };
}
/** `registry.seal.interfaces`: the seal's interface checks alone, their time and how often they ran (README). */
export function interfaceChecks(r: Registry, what = 'registry'): { ms: number; runs: number } {
  const i = obj(obj(r.raw['seal'], `${what}: seal`)['interfaces'], `${what}: seal.interfaces (the seal's interface checks)`);
  return { ms: num(i['ms'], `${what}: seal.interfaces.ms`), runs: num(i['runs'], `${what}: seal.interfaces.runs`) };
}

export interface Implementation { name: string; version: string; pins: Record<string, { version: string; features: string[] }>; equivalence: string; state: string }
export interface Interface { name: string; digest: string; reference: string; kit: string[]; behavior: string; module: string; implementation: Implementation }

/** The issue's `interface` and `implementation` fields, read strictly from one `schedule.interfaces` entry. */
function interfaceOf(name: string, v: JsonValue | undefined): Interface {
  const what = `schedule: interfaces["${name}"]`;
  expect(name, `${what}: its key is name@major`).toMatch(INTERFACE_NAME);
  const o = obj(v, what);
  const impl = obj(o['implementation'], `${what}.implementation`);
  const pins = obj(impl['pins'], `${what}.implementation.pins`);
  const out: Interface = {
    name,
    digest: str(o['digest'], `${what}.digest`),
    reference: str(o['reference'], `${what}.reference`),
    kit: strs(o['kit'], `${what}.kit`),
    behavior: str(o['behavior'], `${what}.behavior (a kit part, or "none")`),
    module: str(o['module'], `${what}.module`),
    implementation: {
      name: str(impl['name'], `${what}.implementation.name`),
      version: str(impl['version'], `${what}.implementation.version`),
      pins: Object.fromEntries(Object.entries(pins).map(([crate, p]) => {
        const po = obj(p, `${what}.implementation.pins.${crate}`);
        return [crate, { version: str(po['version'], `${what}.implementation.pins.${crate}.version`), features: strs(po['features'], `${what}.implementation.pins.${crate}.features`) }];
      })),
      equivalence: str(impl['equivalence'], `${what}.implementation.equivalence`),
      state: str(impl['state'], `${what}.implementation.state`),
    },
  };
  expect(out.digest, `${what}.digest is a d1 digest`).toMatch(DIGEST);
  expect(out.kit.length, `${what}.kit names its parts`).toBeGreaterThan(0);
  expect(out.implementation.version, `${what}.implementation.version is semver`).toMatch(SEMVER);
  expect(['bit', 'measured'], `${what}.implementation.equivalence`).toContain(out.implementation.equivalence);
  expect(['canonical', 'backend_bytes'], `${what}.implementation.state`).toContain(out.implementation.state);
  if (out.behavior !== 'none') expect(out.kit, `${what}: its behavior part is one of its kit's parts`).toContain(out.behavior);
  return out;
}
export function interfaces(schedule: JsonObject): Record<string, Interface> {
  const o = obj(schedule['interfaces'], 'schedule: interfaces (each interface with its digest and the implementation the build chose)');
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, interfaceOf(k, v)]));
}

export interface Published { registry: Registry; schedule: JsonObject; interfaces: Record<string, Interface> }
/** One fresh process: its `registry` and its published plan (`schedule`), with the plan's interfaces. */
export function published(bin: string, evidence: string): Published {
  const [reg, sch] = run(bin, scenario(evidence, [{ call: 'registry' }, { call: 'schedule' }]));
  const schedule = obj(sch, 'schedule');
  expect(str(schedule['uri'], 'schedule: uri'), 'the plan is published at deep://schedule/<core version>').toMatch(/^deep:\/\/schedule\//);
  return { registry: registry(reg!), schedule, interfaces: interfaces(schedule) };
}
export function theInterface(p: Published, name: string, what: string): Interface {
  const i = p.interfaces[name];
  expect(i, `${what}: deep://schedule names ${name}; it names ${Object.keys(p.interfaces).join(', ') || 'none'}`).toBeDefined();
  return i!;
}

// ---------------------------------------------------------------------------------------------------
// The kit (#138's `kit` call), read loosely: only the fields this suite's criteria name.

export interface KitFailure { [field: string]: JsonValue }
export interface KitCase { fixture?: string; verdict: string; raw: JsonObject }
export interface KitPart { part: string; verdict: string; cases: KitCase[]; failures: KitFailure[] }
export interface KitModule { module: string; verdict: string; parts: KitPart[]; failures: KitFailure[] }

export function kit(bin: string, evidence: string, options: { modules?: string[]; ledger?: string } = {}): { verdict: string; modules: KitModule[]; raw: JsonObject } {
  const call: JsonObject = { call: 'kit', sequences: KIT_SEQUENCES, param_sets: KIT_PARAM_SETS };
  if (options.modules) call['modules'] = options.modules;
  if (options.ledger) call['ledger'] = options.ledger;
  const [reply] = run(bin, scenario(evidence, [call]));
  const modules = arr(reply!['modules'], 'kit: modules').map((m, i) => {
    const o = obj(m, `kit: modules[${i}]`);
    const name = str(o['module'], `kit: modules[${i}].module`);
    const failures = (v: JsonValue | undefined, w: string): KitFailure[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
    return {
      module: name, verdict: str(o['verdict'], `${name}.verdict`), failures: failures(o['failures'], `${name}.failures`),
      parts: arr(o['parts'], `${name}.parts`).map((p, j) => {
        const po = obj(p, `${name}.parts[${j}]`);
        const part = str(po['part'], `${name}.parts[${j}].part`);
        return {
          part, verdict: str(po['verdict'], `${name}.${part}.verdict`), failures: failures(po['failures'], `${name}.${part}.failures`),
          cases: arr(po['cases'], `${name}.${part}.cases`).map((c, k) => {
            const co = obj(c, `${name}.${part}.cases[${k}]`);
            return { verdict: str(co['verdict'], `${name}.${part}.cases[${k}].verdict`), ...(typeof co['fixture'] === 'string' ? { fixture: co['fixture'] } : {}), raw: co };
          }),
        };
      }),
    };
  });
  return { verdict: str(reply!['verdict'], 'kit: verdict'), modules, raw: reply! };
}
/** Fuzzed patch sequences and seeded param sets per module: fewer than the kit's defaults, so the suite runs in minutes; the parts this suite reads don't depend on them. */
export const KIT_SEQUENCES = 100;
export const KIT_PARAM_SETS = 50;

export function kitModule(r: { modules: KitModule[] }, name: string): KitModule {
  const m = r.modules.find((x) => x.module === name);
  expect(m, `the kit's report holds module ${name}; it holds ${r.modules.map((x) => x.module).join(', ')}`).toBeDefined();
  return m!;
}
/** Every failure the module's result names: its own, each part's, and each case's `failure`. */
export function kitFailures(m: KitModule, part?: string): KitFailure[] {
  const parts = part ? m.parts.filter((p) => p.part === part) : m.parts;
  return [
    ...(part ? [] : m.failures),
    ...parts.flatMap((p) => [...p.failures, ...p.cases.flatMap((c) => (isObject(c.raw['failure']) ? [c.raw['failure'] as JsonObject] : []))]),
  ];
}

// ---------------------------------------------------------------------------------------------------
// A board the core draws in every build set, for frames.

export const SIZE: [number, number] = [320, 200];
const rect = (id: string, name: string, box: number[], order: string, role: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
export const CORE_BOARD: JsonObject = {
  format: 1,
  profile: 'board',
  title: 'Core only',
  description: 'A board of the core\'s kinds, drawn by a test agent through deep_show for the #185 acceptance tests.',
  size: SIZE,
  items: {
    back: rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
    bar: rect('bar', 'Progress bar', [16, 120, 200, 16], 'a1', 'muted'),
    caption: { id: 'caption', kind: 'text@1', name: 'Caption', order: 'a2', params: { text: 'Sealed and ready', font: 'body', size: 13, box: { w: 200, h: 20 } }, at: { pos: [16, 24, 0] } },
  },
};
/** An agent's deep_show call with a snapshot at `t`. */
export const frameAt = (t: string): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document: CORE_BOARD, include: ['issues', 'pixels'], size: SIZE, t });

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
export function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-185-base', sha.slice(0, 12));
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

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/305 and 140).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. */
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
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** The design's rule on five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit.toFixed(3)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shown}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
