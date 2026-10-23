// Test-side tools for the #387 acceptance tests: `deep-show` built per Cargo feature set (a build set
// plus the test canvas modules' features, as #305's suite builds it), driven by JSON lines; the
// scenario and its calls (deep_show, `registry`, `fixtures`, `eval`, `frames`, `panel`, `intern`,
// `resolve`, `batch`, `revisions`); the documents the tests draw; and the checks the criteria's
// planted programs must fail, each returning its failures as sentences that name what failed. The
// reference-Mac gate and the design's judge for timing results are #305's. Nothing here stands in for
// the scheduler, the content keys, epochs or render-back.

import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/387 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** Flicks per second (One clock). */
export const FLICKS = 705_600_000;
/** The scheduler's CPU budget per frame for a 10,000-item document whose read sets didn't change. */
export const SCHEDULER_BUDGET_MS = 0.1;
/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** The closed list of check phases, then the frame phases, in order (Phase). */
export const CHECK_PHASES = ['load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check'] as const;
export const FRAME_PHASES = ['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback'] as const;
export const PHASES: readonly string[] = [...CHECK_PHASES, ...FRAME_PHASES];
/** The view inputs an operator may read (Operator and read set: `view(…)`). */
export const VIEW_INPUTS = ['camera', 'viewport', 'pixel_scale', 'match.me', 'locale', 'reduced_motion'] as const;

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
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** A fixture file of this suite, parsed. */
export function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, `fixture ${path}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name (#305).

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** The test canvas modules' Cargo features (README: The test canvas modules). */
export type TestFeature =
  | 'test-accent' | 'test-peek' | 'test-up-1-0' | 'test-up-1-1' | 'test-nudge'
  | 'test-step' | 'test-step-renamed' | 'test-step-cycle' | 'test-scatter';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

function buildFeatures(features: string[]): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo build --bin ${SHOW_NAME} --no-default-features --features ${features.join(',')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-387-bins-'));
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

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 300_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** One scenario line given as text, for a document whose numbers JSON.stringify can't write (−0, 1e999). */
export interface RawScenario { raw: string; calls: number }

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject | RawScenario, sealPlanted?: string): JsonObject[] {
  const args = ['run', ...(sealPlanted ? ['--planted', sealPlanted] : [])];
  const raw = 'raw' in sc && typeof sc.raw === 'string';
  const s = start(bin, args, [raw ? (sc as RawScenario).raw : (sc as JsonObject)]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  const calls = raw ? (sc as RawScenario).calls : arr((sc as JsonObject)['calls'], 'the scenario\'s calls').length;
  expect(replies.length, 'run: one reply per call').toBe(calls);
  return replies;
}

export interface Refusal { reason: string; modules: string[]; arrays: string[]; raw: JsonObject }

/** A build the seal refuses: one `seal_refused` JSON line and exit 2 without reading a scenario (#305). */
export function startupRefusal(bin: string): Refusal {
  const s = start(bin, ['run'], [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply to the scenario: ${s.stdout.slice(0, 1000)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect(raw['code'], 'the refusal\'s code').toBe('seal_refused');
  return { reason: str(raw['reason'], 'the refusal\'s reason'), modules: strs(raw['modules'], 'the refusal\'s modules'), arrays: strs(raw['arrays'] ?? [], 'the refusal\'s arrays'), raw };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-387-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: scheduler', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Document IDs: `doc(n)`; DOC.a and DOC.b are the first two. Each sits in its own panel `p<n>`. */
export const doc = (n: number): string => ulid('01JB87D', n);
export const DOC = { a: doc(1), b: doc(2) } as const;
export const panelOf = (id: string): string => `p${Number(id.slice(7))}`;
export const MAX_DOCS = 64;

export interface ScenarioExtra { planted?: string; epoch_start?: number; shuffle?: number; record?: JsonObject }

/** A scenario with every document `doc(1)` … `doc(MAX_DOCS)` in its own visible panel. */
export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docs: JsonObject = {};
  const panels: JsonObject = {};
  for (let n = 1; n <= MAX_DOCS; n++) {
    docs[doc(n)] = { panel: `p${n}` };
    panels[`p${n}`] = { rect: [0, 0, 800, 600] };
  }
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels,
    docs,
    calls,
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}

export const SIZE: [number, number] = [320, 200];
export interface ShowOptions { doc?: string; pixels?: boolean; t?: string; removes?: string[] }
/** An agent's deep_show call: a whole revision of `document`; an item the last revision held and this one drops is named in `removes` (#393). */
export function show(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const include = options.pixels ? ['issues', 'pixels'] : ['issues'];
  return {
    call: 'deep_show', session: ALPHA.id, doc: options.doc ?? DOC.a, document, include,
    ...(options.pixels ? { size: SIZE } : {}), ...(options.t ? { t: options.t } : {}), ...(options.removes?.length ? { removes: options.removes } : {}),
  };
}
/** The items `before` holds and `after` doesn't: what a whole revision from one to the other removes. */
export const dropped = (before: JsonObject | null, after: JsonObject): string[] =>
  before ? Object.keys((before['items'] ?? {}) as JsonObject).filter((id) => !(id in ((after['items'] ?? {}) as JsonObject))) : [];
export const REGISTRY: JsonObject = { call: 'registry' };
export const FIXTURES: JsonObject = { call: 'fixtures' };
export const revisionsOf = (id: string = DOC.a): JsonObject => ({ call: 'revisions', doc: id });

export interface View { locale?: string; reduced_motion?: boolean }
export interface EvalOptions { t?: string; view?: View; clean?: boolean; perturb?: string; pixels?: boolean }
export function evalCall(id: string, options: EvalOptions = {}): JsonObject {
  const out: JsonObject = { call: 'eval', doc: id };
  if (options.t !== undefined) out['t'] = options.t;
  if (options.view !== undefined) out['view'] = options.view as JsonObject;
  if (options.clean) out['clean'] = true;
  if (options.perturb !== undefined) out['perturb'] = options.perturb;
  if (options.pixels) { out['pixels'] = true; out['size'] = SIZE; }
  return out;
}
export const framesCall = (id: string, count: number, from = '0s'): JsonObject => ({ call: 'frames', doc: id, count, from });
export const panelCall = (id: string, visible: boolean): JsonObject => ({ call: 'panel', panel: panelOf(id), visible });
export const internCall = (id: string, item: string): JsonObject => ({ call: 'intern', doc: id, id: item });
export const resolveCall = (id: string, handle: JsonValue): JsonObject => ({ call: 'resolve', doc: id, handle });

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; severity: string; ids: string[]; path?: string; module?: string; operator?: string; read?: string }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'] ?? [], `${what}: issues[${i}].ids`) } as Issue;
  });
}
export function snapshotOf(reply: JsonObject, what: string): string {
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what} carries one snapshot`).toBe(1);
  return str(obj(list[0], `${what}: snapshot`)['sha256'], `${what}: snapshot sha256`);
}
/** The current revision's hash from a `revisions` reply. */
export function currentHash(reply: JsonObject): string {
  const now = arr(reply['revisions'], 'revisions').map((v, i) => obj(v, `revisions[${i}]`)).filter((r) => r['state'] === 'current');
  expect(now.length, `exactly one revision is current: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return str(now[0]!['hash'], 'the current revision\'s hash');
}
/** A deep_show reply that presented its revision. */
export function presented(reply: JsonObject, what: string): void {
  expect(outcome(reply), `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// The registry, extended (README: The registry, extended)

export interface OperatorInfo { module: string; phase: string; reads: string[]; writes: string[] }
export interface Registry {
  modules: string[]; versions: Record<string, string>; digests: Record<string, string>;
  operators: Record<string, OperatorInfo>; arrays: Record<string, JsonObject>; plan: Record<string, string[]>; raw: JsonObject;
}
export function registry(reply: JsonObject): Registry {
  const operators: Record<string, OperatorInfo> = {};
  for (const [name, o] of Object.entries(obj(reply['operators'], 'registry: operators'))) {
    const op = obj(o, `registry: operators.${name}`);
    operators[name] = { module: str(op['module'], `operators.${name}.module`), phase: str(op['phase'], `operators.${name}.phase`), reads: strs(op['reads'], `operators.${name}.reads`), writes: strs(op['writes'], `operators.${name}.writes`) };
  }
  const arrays: Record<string, JsonObject> = {};
  for (const [name, a] of Object.entries(obj(reply['arrays'], 'registry: arrays'))) arrays[name] = obj(a, `registry: arrays.${name}`);
  const plan: Record<string, string[]> = {};
  for (const [phase, ops] of Object.entries(obj(reply['plan'], 'registry: plan'))) plan[phase] = strs(ops, `registry: plan.${phase}`);
  const record = (key: string): Record<string, string> => Object.fromEntries(Object.entries(obj(reply[key], `registry: ${key}`)).map(([k, v]) => [k, str(v, `registry: ${key}.${k}`)]));
  return { modules: strs(reply['modules'], 'registry: modules'), versions: record('versions'), digests: record('digests'), operators, arrays, plan, raw: reply };
}
export function sealed(bin: string, evidence: string): Registry {
  return registry(run(bin, scenario(evidence, [REGISTRY]))[0]!);
}

/**
 * An operator's read closure (README: Criteria to tests): its declared reads, the arrays contributed
 * toward one of them, and the closure of every operator that writes one of those arrays.
 */
export function readClosure(reg: Registry, operator: string): Set<string> {
  const writer = new Map<string, string>();
  for (const [name, op] of Object.entries(reg.operators)) for (const w of op.writes) writer.set(w, name);
  const contributors = new Map<string, string[]>();
  for (const [name, a] of Object.entries(reg.arrays)) {
    const to = a['contributes_to'];
    if (typeof to === 'string') contributors.set(to, [...(contributors.get(to) ?? []), name]);
  }
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const op = reg.operators[name];
    if (!op) return;
    const reads = [...op.reads];
    for (const r of op.reads) reads.push(...(contributors.get(r) ?? []));
    for (const r of reads) {
      out.add(r);
      const w = writer.get(r);
      if (w) visit(w);
    }
  };
  visit(operator);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// `eval` replies

export interface Node { operator: string; module: string; phase: string; item: string | null; key: string; result: string; run: string }
export interface Target { target: string; term: string }
export interface Step { module: string; t: number; count: number; read: number }
export interface Hashed { of: string; bytes: number }
export interface Access { operator: string; item: string | null; read: string }
export interface Evaluated { outcome: string; epoch: number; nodes: Node[]; targets: Target[]; steps: Step[]; hashes: Hashed[]; access: Access[] | null; issues: Issue[]; raw: JsonObject }

const KEY = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{64}$/;
export const nodeId = (n: { operator: string; item: string | null }): string => `${n.operator}@${n.item ?? '(document)'}`;

/** An `eval` reply that evaluated, its fields checked for form. */
export function evaluated(reply: JsonObject, what = 'the eval'): Evaluated {
  expect(outcome(reply), `${what} evaluated: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('evaluated');
  const nodes = arr(reply['nodes'], `${what}: nodes`).map((v, i): Node => {
    const n = obj(v, `${what}: nodes[${i}]`);
    const node: Node = {
      operator: str(n['operator'], `${what}: nodes[${i}].operator`), module: str(n['module'], `${what}: nodes[${i}].module`),
      phase: str(n['phase'], `${what}: nodes[${i}].phase`), item: n['item'] === null ? null : str(n['item'], `${what}: nodes[${i}].item`),
      key: str(n['key'], `${what}: nodes[${i}].key`), result: str(n['result'], `${what}: nodes[${i}].result`), run: str(n['run'], `${what}: nodes[${i}].run`),
    };
    expect(node.key, `${what}: ${nodeId(node)}'s key is 128 bits in lowercase hex`).toMatch(KEY);
    expect(node.result, `${what}: ${nodeId(node)}'s result is a SHA-256 in lowercase hex`).toMatch(SHA);
    expect(['ran', 'hit', 'kept'], `${what}: ${nodeId(node)}'s run`).toContain(node.run);
    expect(PHASES, `${what}: ${nodeId(node)}'s phase is one of the closed list`).toContain(node.phase);
    return node;
  });
  const ids = nodes.map(nodeId);
  expect(new Set(ids).size, `${what}: each (operator, item) is one node`).toBe(ids.length);
  const targets = arr(reply['targets'] ?? [], `${what}: targets`).map((v, i): Target => {
    const t = obj(v, `${what}: targets[${i}]`);
    return { target: str(t['target'], `${what}: targets[${i}].target`), term: str(t['term'], `${what}: targets[${i}].term`) };
  });
  const steps = arr(reply['steps'] ?? [], `${what}: steps`).map((v, i): Step => {
    const s = obj(v, `${what}: steps[${i}]`);
    return { module: str(s['module'], `${what}: steps[${i}].module`), t: num(s['t'], `${what}: steps[${i}].t`), count: num(s['count'], `${what}: steps[${i}].count`), read: num(s['read'], `${what}: steps[${i}].read`) };
  });
  const hashes = arr(reply['hashes'] ?? [], `${what}: hashes`).map((v, i): Hashed => {
    const h = obj(v, `${what}: hashes[${i}]`);
    return { of: str(h['of'], `${what}: hashes[${i}].of`), bytes: num(h['bytes'], `${what}: hashes[${i}].bytes`) };
  });
  const access = reply['access'] === undefined ? null : arr(reply['access'], `${what}: access`).map((v, i): Access => {
    const a = obj(v, `${what}: access[${i}]`);
    return { operator: str(a['operator'], `${what}: access[${i}].operator`), item: a['item'] === null ? null : str(a['item'], `${what}: access[${i}].item`), read: str(a['read'], `${what}: access[${i}].read`) };
  });
  const epoch = num(reply['epoch'], `${what}: epoch`);
  expect(Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffff_ffff, `${what}: epoch ${epoch} is a u32`).toBe(true);
  return { outcome: outcome(reply), epoch, nodes, targets, steps, hashes, access, issues: issues(reply, what), raw: reply };
}

export const byId = (e: Evaluated): Map<string, Node> => new Map(e.nodes.map((n) => [nodeId(n), n]));

/** Nodes present in both with another key or result, and nodes in one only; each failure names the node. */
export function sameNodes(a: Evaluated, b: Evaluated, what: string, compare: { key?: boolean; result?: boolean } = { key: true, result: true }): string[] {
  const failures: string[] = [];
  const left = byId(a);
  const right = byId(b);
  for (const [id, n] of left) {
    const m = right.get(id);
    if (!m) { failures.push(`${what}: node ${id} is missing from the second evaluation`); continue; }
    if (compare.key !== false && n.key !== m.key) failures.push(`${what}: node ${id} has key ${n.key} then ${m.key}`);
    if (compare.result !== false && n.result !== m.result) failures.push(`${what}: node ${id} has result ${n.result.slice(0, 16)}… then ${m.result.slice(0, 16)}…`);
  }
  for (const id of right.keys()) if (!left.has(id)) failures.push(`${what}: node ${id} is missing from the first evaluation`);
  return failures;
}

/** Equal keys always give byte-identical results: every key seen with two results, naming the operators. */
export function keyConflicts(evals: readonly Evaluated[], what: string): string[] {
  const seen = new Map<string, { result: string; id: string }>();
  const failures: string[] = [];
  for (const e of evals) {
    for (const n of e.nodes) {
      const was = seen.get(n.key);
      if (!was) seen.set(n.key, { result: n.result, id: nodeId(n) });
      else if (was.result !== n.result) failures.push(`${what}: key ${n.key} gave ${was.id} one result and ${nodeId(n)} another`);
    }
  }
  return failures;
}

/**
 * Criterion 1: under a clean evaluation with one target perturbed, every node whose operator's read
 * closure doesn't hold the target's term keeps its key and result byte-identical, and no node changes
 * its result under the same key; the writer of a perturbed array is left out of both. Each failure
 * names the operator, the item and the target.
 */
export function perturbationFailures(reg: Registry, base: Evaluated, perturbed: Evaluated, target: Target): { failures: string[]; outside: number } {
  const failures: string[] = [];
  let outside = 0;
  const after = byId(perturbed);
  for (const n of base.nodes) {
    const m = after.get(nodeId(n));
    if (!m) { failures.push(`${target.target}: node ${nodeId(n)} is missing under the perturbation`); continue; }
    // The perturbed array's own writer is neither inside nor outside: what it wrote is what was changed.
    if (reg.operators[n.operator]?.writes.includes(target.term)) continue;
    const closure = readClosure(reg, n.operator);
    if (!closure.has(target.term)) {
      outside++;
      if (m.key !== n.key) failures.push(`${target.target} (${target.term}), outside ${n.operator}'s read set, changed its key on ${n.item ?? 'the document'}`);
      if (m.result !== n.result) failures.push(`${target.target} (${target.term}), outside ${n.operator}'s read set, changed its result on ${n.item ?? 'the document'}`);
    } else if (m.key === n.key && m.result !== n.result) {
      failures.push(`${target.target} (${target.term}) changed ${n.operator}'s result on ${n.item ?? 'the document'} under the same key`);
    }
  }
  return { failures, outside };
}

/**
 * Criterion 6: the step log of a frame at `at` with a (`aMod`, 60 Hz) and b (`bMod`, 120 Hz): a's step
 * runs before b's at `at`; b's read is a's count from a's step at `at`; a's read is b's count from b's
 * step before `at`. Each failure names the step (module and time).
 */
export function stepOrderFailures(steps: readonly Step[], aMod: string, bMod: string, at: number): string[] {
  const failures: string[] = [];
  const ia = steps.findIndex((s) => s.module === aMod && s.t === at);
  const ib = steps.findIndex((s) => s.module === bMod && s.t === at);
  if (ia < 0) return [`no step of ${aMod} at ${at} in the log`];
  if (ib < 0) return [`no step of ${bMod} at ${at} in the log`];
  const a = steps[ia]!;
  const b = steps[ib]!;
  if (ib < ia) failures.push(`${bMod}'s step at ${at} ran before ${aMod}'s step at ${at}`);
  if (b.read !== a.count) failures.push(`${bMod}'s step at ${at} read ${aMod}'s count ${b.read}, not ${a.count} from ${aMod}'s step at ${at}`);
  const before = steps.filter((s) => s.module === bMod && s.t < at).sort((x, y) => x.t - y.t).at(-1);
  if (!before) failures.push(`no step of ${bMod} before ${at}`);
  else if (a.read !== before.count) failures.push(`${aMod}'s step at ${at} read ${bMod}'s count ${a.read}, not ${before.count} from ${bMod}'s step at ${before.t}`);
  return failures;
}

/** Steps of one module: in time order, its count one up per step. */
export function countFailures(steps: readonly Step[], module: string): string[] {
  const own = steps.filter((s) => s.module === module);
  const failures: string[] = [];
  if (own.length === 0) return [`${module} took no step`];
  for (let i = 1; i < own.length; i++) {
    if (!(own[i]!.t > own[i - 1]!.t)) failures.push(`${module}'s steps at ${own[i - 1]!.t} and ${own[i]!.t} are not in time order`);
    if (own[i]!.count !== own[i - 1]!.count + 1) failures.push(`${module}'s step at ${own[i]!.t} counts ${own[i]!.count} after ${own[i - 1]!.count}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them

export const rect = (id: string, box: number[], order: string, role = 'muted', extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra });
export const label = (id: string, text: string, pos: [number, number], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'text@1', name: `Label ${id}`, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] }, ...extra });
/**
 * Every test document names its seed: a document's seed defaults to a hash of its ID (Document
 * envelope), and the tests compare one document's keys under two doc IDs.
 */
export const SEED_OF_DOCS = 387;
export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', seed: SEED_OF_DOCS, title,
    description: `${title}, drawn by a test agent through deep_show for the #387 acceptance tests.`,
    size: SIZE, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const requires = (modules: Record<string, string>): JsonObject => ({ requires: { modules } });
/** A clip that slides the rect in `slot` along x from `from` to `to` over `span` seconds, placed at 0. */
export function slide(item: string, from: number, to: number, span = 2): JsonObject {
  return {
    clips: { slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } } } } },
    placements: { p: { clip: 'slide', slots: { target: item }, start: '0s' } },
  };
}

/** Sets `value` at `path` (`items/<id>/params/box/0`, slash-separated) in a copy of `document`; `null` deletes the member. */
export function edit(document: JsonObject, edits: Record<string, JsonValue>): JsonObject {
  const out = clone(document);
  for (const [path, value] of Object.entries(edits)) {
    const parts = path.split('/');
    let at: JsonValue = out;
    for (const part of parts.slice(0, -1)) {
      const next: JsonValue | undefined = Array.isArray(at) ? at[Number(part)] : (at as JsonObject)[part];
      if (next === undefined) throw Error(`edit: ${path} has no ${part}`);
      at = next;
    }
    const last = parts[parts.length - 1]!;
    if (Array.isArray(at)) at[Number(last)] = value;
    else if (value === null) delete (at as JsonObject)[last];
    else (at as JsonObject)[last] = value;
  }
  return out;
}

/** f64 values as the base64 of their little-endian bytes (a mark set column's `data`). */
export function f64Base64(values: readonly number[]): string {
  const buf = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
  return buf.toString('base64');
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/305).

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
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
