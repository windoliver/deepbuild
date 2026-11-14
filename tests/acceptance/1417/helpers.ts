// Test-side tools for the #1417 acceptance tests: `deep-show` (debug, per Cargo feature set; and the merge base's)
// and `deep-graph` (release) built once per file and driven by JSON lines; the layered graphs these tests send,
// generated here; reading the check's `over_budget` refusal; the kit's report; and the reference-Mac gate for the
// timing readings. Nothing here stands in for the layout, its cost, the estimate, the check or the kit under test.
// Copied in part from tests/acceptance/399/helpers.ts and 379's (suites don't import each other).

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1417 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 1_800_000;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] || join(REPO, 'target');

// ---------------------------------------------------------------------------------------------------
// JSON

export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value, 600)}`).toBe('string');
  return value as string;
}
export function readJson(name: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, name), 'utf8')) as JsonValue, name);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, copied out under its own name; a failed build fails each test that uses it.

function cargo(args: string[], root = REPO): string {
  const r = spawnSync('cargo', args, { cwd: root, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const lines = r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(0, 4000)}`;
}

export const SHOW = 'deep-show';
/** Debug builds of `deep-show --no-default-features --features <set>`, made before the file's tests. */
export function useShowBuilds(sets: string[][]): (features: string[]) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1417-show-'));
    for (const f of sets) {
      const bin = join(dir, `${SHOW}-${f.join('+')}`);
      const error = cargo(['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', f.join(',')]);
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(SHOW)), bin);
      made.set(f.join(','), { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (features) => {
    const m = made.get(features.join(','));
    if (!m) throw Error(`the file didn't build ${features.join(',')}`);
    expect(m.error, `the binary builds: ${SHOW} with features ${features.join(',')}`).toBe('');
    return m.bin;
  };
}

/** `deep-graph` built in `profile` (`release` is the profile the cost coefficients are measured in), before the file's tests. */
export function useGraph(profile: 'debug' | 'release'): () => string {
  let dir = '';
  let error = '';
  const args = ['build', '--locked', ...(profile === 'release' ? ['--release'] : []), '--bin', 'deep-graph'];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1417-graph-'));
    error = cargo(args);
    if (error === '') copyFileSync(join(targetDir(), profile, exe('deep-graph')), join(dir, 'deep-graph'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, 'deep-graph');
  };
}

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/**
 * The merge base exported whole by `git archive` into the (git-ignored) target folder, and its `deep-show` (the
 * shipped `full` set, debug) built there with `--target-dir` (never CARGO_TARGET_DIR, so sccache can hit).
 */
export function mergeBaseShow(sha: string): { path: string; error: string } {
  const dir = join(REPO, 'target', 'acceptance-1417-base', sha.slice(0, 12));
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
  const target = join(dir, 'target');
  const r = spawnSync('cargo', ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full', '--target-dir', target], {
    cwd: dir, env: { ...CARGO_ENV, CARGO_TARGET_DIR: '' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const error = r.error ? r.error.message : r.status === 0 ? '' : (r.stderr ?? '').slice(-4000);
  return { path: join(target, 'debug', exe(SHOW)), error };
}

// ---------------------------------------------------------------------------------------------------
// Running: JSON lines in, one line out per line in.

export interface Ran { status: number | null; stdout: string; stderr: string; ms: number }
export function spawn(bin: string, args: string[], input: string, timeout = 7_200_000): Ran {
  const t0 = performance.now();
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin.split('/').pop()} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: performance.now() - t0 };
}
/** One run of `bin args`, the inputs as JSON lines on stdin: one JSON line out per line in, in order, exit 0. */
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  const r = spawn(bin, args, `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`);
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  expect(r.status, `${name} exits 0: ${r.stderr.slice(0, 2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${name}: answer ${i}`));
}

/** The session and panel the scenarios use. */
export const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: graphs', process: { pid: 4100, start: 1000 } } };
export const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };

/** `deep-show run`: one scenario, accepted, one reply per call, exit 0. */
export function showRun(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawn(bin, ['run'], `${JSON.stringify(scenario)}\n`);
  expect(r.status, `${SHOW} run starts and exits 0; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${SHOW} run: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

/** A temporary evidence folder per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1417-ev-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The check of one document through `deep_show`, its doc on the panel `main` (as #379's scenarios): its reply. */
export function checked(bin: string, evidence: string, doc: string, document: JsonObject): JsonObject {
  const [reply] = showRun(bin, {
    evidence, sessions: SESSIONS, panels: PANELS, docs: { [doc]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc, document, include: ['issues'] }],
  });
  return reply!;
}

// ---------------------------------------------------------------------------------------------------
// Graphs: `ranks` ranks of `width` nodes, each fed from the node above it and odd ones also from the one above-left.

export const LAYOUT: JsonObject = { algo: 'layered', direction: 'down', seed: 1417 };
export function layeredGraph(ranks: number, width: number): { nodes: JsonObject[]; edges: JsonObject[] } {
  const nodes: JsonObject[] = [];
  const edges: JsonObject[] = [];
  for (let r = 0; r < ranks; r++) for (let j = 0; j < width; j++) {
    nodes.push({ id: `v${r}x${j}`, w: 40 + 8 * ((r + j) % 5), h: 30 });
    if (r > 0) {
      edges.push({ id: `e${r}x${j}`, a: `v${r - 1}x${j}`, b: `v${r}x${j}` });
      if (j % 2 === 1) edges.push({ id: `f${r}x${j}`, a: `v${r - 1}x${j - 1}`, b: `v${r}x${j}` });
    }
  }
  return { nodes, edges };
}
/** The sizes the tests send, as ranks × width. */
export const SIZES = {
  100: [10, 10], 1000: [20, 50], 10000: [40, 250], 100000: [100, 1000],
} as const satisfies Record<number, readonly [number, number]>;

/** A board holding one graph@1 item `g`, under `budget`. */
export function graphDoc(nodes: keyof typeof SIZES, budget: JsonObject): JsonObject {
  const [ranks, width] = SIZES[nodes];
  return {
    format: 1, profile: 'board', seed: 1417, title: `A ${nodes}-node graph`,
    description: `A layered graph of ${nodes} nodes in ${ranks} ranks of ${width}.`, size: [1280, 720], budget,
    items: { g: { id: 'g', kind: 'graph@1', name: 'Graph', order: 'a0', params: { graph: layeredGraph(ranks, width), layout: LAYOUT } } },
  };
}

/** The data view's Frame CPU cap in ms (the budget class table; graphs are data views). */
export const CLASS_CPU_MS = 2;
/** The layout operator's key, as the registry and costs.json name it. */
export const OPERATOR = 'graph.layout';

export function issuesOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((i, k) => obj(i, `${what}: issues[${k}]`));
}
/** The one error `over_budget` issue of a reply the check refused. */
export function overBudget(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what}: refused at check: ${show(reply, 2000)}`).toBe('refused');
  const over = issuesOf(reply, what).filter((i) => i['code'] === 'over_budget' && i['severity'] === 'error');
  expect(over.length, `${what}: one over_budget error: ${show(reply['issues'], 2000)}`).toBe(1);
  return over[0]!;
}
/** The layout operator's estimate an over_budget issue carries: `actual.operators["graph.layout"]`, ms of CPU a frame. */
export function layoutEstimate(issue: JsonObject, what: string): number {
  const actual = obj(issue['actual'], `${what}: over_budget's actual (the estimate)`);
  const ops = obj(actual['operators'], `${what}: actual.operators (each operator's estimate, ms)`);
  return num(ops[OPERATOR], `${what}: actual.operators["${OPERATOR}"]`);
}

// ---------------------------------------------------------------------------------------------------
// The kit (#138): its report per module.

export const kitCall = (modules: string[]): JsonObject => ({ call: 'kit', sequences: 100, param_sets: 50, modules });
export interface KitPart { part: string; verdict: string; cases: JsonObject[]; failures: JsonObject[] }
export interface KitModule { module: string; verdict: string; parts: KitPart[]; failures: JsonObject[] }
export function kitModule(reply: JsonObject, name: string): KitModule {
  const list = arr(reply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const o = list.find((m) => m['module'] === name);
  expect(o, `the kit's report holds module ${name}; it holds ${list.map((m) => String(m['module'])).join(', ')}`).toBeDefined();
  const objs = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  return {
    module: name, verdict: str(o!['verdict'], `${name}.verdict`), failures: objs(o!['failures'], `${name}.failures`),
    parts: arr(o!['parts'], `${name}.parts`).map((p, j) => {
      const po = obj(p, `${name}.parts[${j}]`);
      const part = str(po['part'], `${name}.parts[${j}].part`);
      return { part, verdict: str(po['verdict'], `${name}.${part}.verdict`), cases: objs(po['cases'], `${name}.${part}.cases`), failures: objs(po['failures'], `${name}.${part}.failures`) };
    }),
  };
}
/** Every failure a module's result carries, with the part it came from: the module's, each part's and each case's. */
export const kitFailures = (m: KitModule): { part: string; failure: JsonObject }[] => [
  ...m.failures.map((failure) => ({ part: '', failure })),
  ...m.parts.flatMap((p) => [...p.failures, ...p.cases.flatMap((c) => (isObject(c['failure']) ? [c['failure']] : []))].map((failure) => ({ part: p.part, failure }))),
];

// ---------------------------------------------------------------------------------------------------
// Readings: the reference Mac the coefficients were measured on (costs.json's fingerprint).

const sh = (cmd: string, ...args: string[]): string => spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim() ?? '';
/** Why this machine can't take a timing reading now, or null: not costs.json's reference Mac, Low Power Mode, heat or load. */
export function environmentProblem(): string | null {
  const fp = obj(readJsonAt(join(REPO, 'crates', 'deep-canvas', 'costs.json'))['fingerprint'], 'costs.json: fingerprint');
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = sh('sysctl', '-n', 'hw.model');
  const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
  const bytes = Number(sh('sysctl', '-n', 'hw.memsize'));
  if (model !== fp['model'] || chip !== fp['chip'] || bytes !== fp['memoryBytes']) return `not the reference Mac ${show(fp)}: ${model} / ${chip} / ${bytes} bytes`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const therm = sh('pmset', '-g', 'therm');
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}
function readJsonAt(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
