// Test-side tools for the #855 acceptance tests: `deep-show` built per Cargo feature set, profile and
// target (#305's and #387's build helpers, with the release profile and the x86_64 target added), driven
// by JSON lines; the scenario and its calls (deep_show, `registry`, `fixtures`, `eval`, `frames`,
// `costs`, `migrate`, `keys`); the startup lines a refused seal or a refused coefficient file answers;
// the documents the tests draw; the base's committed coefficients; and the checks the criteria's planted
// programs must fail, each returning its failures as sentences that name what failed. The reference-Mac
// gate and the design's judge for timing results are #387's, with the machine's load added. Nothing here
// stands in for the seal, the scheduler, the content keys, the cost model or the hash.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/855 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
/** A startup the seal or the cost model refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** The closed list of check phases, then the frame phases, in order (Phase). */
export const CHECK_PHASES = ['load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check'] as const;
export const FRAME_PHASES = ['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback'] as const;
export const PHASES: readonly string[] = [...CHECK_PHASES, ...FRAME_PHASES];
export const isFramePhase = (phase: string): boolean => (FRAME_PHASES as readonly string[]).includes(phase);
/** The hash versions (Content key; this issue's scope). */
export const HASH1 = 'hash@1';
export const HASH2 = 'hash@2';

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
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** A fixture file of this suite: its absolute path. */
export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, profile and target, built once per file, each kept
// under its own name (#305, #387).

/** The test features this suite adds (README: The test builds). */
export type TestFeature = 'test-json' | 'test-debug-alt' | 'test-debug-digest';
export const X86 = 'x86_64-apple-darwin';
export interface Build { set: 'full'; with?: TestFeature[]; release?: boolean; target?: typeof X86 }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string =>
  [...featuresOf(build), ...(build.release ? ['release'] : []), ...(build.target ? [build.target] : [])].join('+');

const uplifted = (build: Build): string =>
  join(REPO, 'target', ...(build.target ? [build.target] : []), build.release ? 'release' : 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The targets rustup has installed for the checkout's pinned toolchain. */
function installedTargets(): string[] {
  const out = spawnSync('rustup', ['target', 'list', '--installed'], { cwd: REPO, encoding: 'utf8' });
  return out.status === 0 ? out.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

/** Why a build can't be made on this machine (a target that isn't installed, or no Rosetta), or null. */
function unavailable(build: Build): string | null {
  if (!build.target) return null;
  if (process.platform !== 'darwin') return `${build.target} runs only on macOS here; this is ${process.platform}`;
  if (!installedTargets().includes(build.target)) return `the ${build.target} target isn't installed for the pinned toolchain (rustup target add ${build.target})`;
  const rosetta = spawnSync('arch', ['-x86_64', '/usr/bin/true']);
  if (rosetta.status !== 0) return 'Rosetta 2 isn\'t available to run an x86_64 binary';
  return null;
}

function cargoBuild(build: Build): string {
  const args = ['build', '--locked', ...(build.release ? ['--release'] : []), ...(build.target ? ['--target', build.target] : []), '--bin', SHOW_NAME, '--no-default-features', '--features', featuresOf(build).join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds {
  /** The binary of a build; a test that asks for one that failed to build fails with cargo's error. */
  bin: (build: Build) => string;
  /** Why the build can't be made on this machine, or null. */
  unavailable: (build: Build) => string | null;
}

/** Builds every listed build once, before the file's tests, copying each binary out under its own name. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string; unavailable: string | null }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-855-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      const why = unavailable(build);
      if (why) { made.set(name, { bin, error: '', unavailable: why }); continue; }
      const error = cargoBuild(build);
      if (error === '') copyFileSync(uplifted(build), bin);
      made.set(name, { bin, error, unavailable: null });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(buildName(build));
      if (!entry) throw Error(`the file didn't list the build ${buildName(build)} in useBuilds`);
      expect(entry.unavailable, `the build ${buildName(build)} can be made here`).toBeNull();
      expect(entry.error, `the binary builds: ${SHOW_NAME} ${buildName(build)}`).toBe('');
      return entry.bin;
    },
    unavailable(build: Build): string | null {
      return made.get(buildName(build))?.unavailable ?? null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }
export interface StartOptions { env?: NodeJS.ProcessEnv; x86?: boolean; timeoutMs?: number }

/** Pipes the lines into one process of `deep-show <args>`; never throws on exit status. Stopped only by its own timeout. */
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], options: StartOptions = {}): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  const [cmd, argv] = options.x86 ? ['arch', ['-x86_64', bin, ...args]] : [bin, args];
  const run = spawnSync(cmd, argv, { cwd: REPO, env: options.env ?? process.env, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: options.timeoutMs ?? 600_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** `deep-show run [args…]`: one scenario, accepted, with one reply per call; the process exits 0. */
export function run(bin: string, sc: JsonObject, args: string[] = [], options: StartOptions = {}): JsonObject[] {
  const argv = ['run', ...args];
  const s = start(bin, argv, [sc], options);
  expect(s.timedOut, `${SHOW_NAME} ${argv.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${argv.join(' ')} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A startup refused before any scenario: one JSON line with `ok: false`, exit 2, no reply to the scenario it was fed. */
export function refusedStart(bin: string, args: string[]): JsonObject {
  const argv = ['run', ...args];
  const s = start(bin, argv, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${argv.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${argv.join(' ')} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply to the scenario: ${s.stdout.slice(0, 1000)}`).toBe(1);
  const line = obj(s.lines[0], 'the refusal line');
  expect(line['ok'], `the refusal says ok: false: ${JSON.stringify(line)}`).toBe(false);
  return line;
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls

/** A fresh folder per test, deleted after it: the evidence store root and anything else a test writes. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-855-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: typed values', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Document IDs: `doc(n)`, each in its own visible panel `p<n>`. */
export const doc = (n: number): string => ulid('01JB855D', n);
export const DOC = { a: doc(1), b: doc(2), c: doc(3) } as const;
const DOCS = 8;

export interface ScenarioExtra { hash?: string | undefined; record?: JsonObject | undefined; machine?: JsonObject | undefined }

export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docs: JsonObject = {};
  const panels: JsonObject = {};
  for (let n = 1; n <= DOCS; n++) {
    docs[doc(n)] = { panel: `p${n}` };
    panels[`p${n}`] = { rect: [0, 0, 1280, 720] };
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

/** An agent's deep_show call: a whole revision of `document`. */
export function show(document: JsonObject, id: string = DOC.a, removes: string[] = []): JsonObject {
  return { call: 'deep_show', session: ALPHA.id, doc: id, document, include: ['issues'], ...(removes.length ? { removes } : {}) };
}
export const REGISTRY: JsonObject = { call: 'registry' };
export const FIXTURES: JsonObject = { call: 'fixtures' };
export const COSTS: JsonObject = { call: 'costs' };
export const MIGRATE: JsonObject = { call: 'migrate', to: HASH2 };
export interface EvalOptions { t?: string; clean?: boolean; debug_text?: boolean }
export function evalCall(id: string, options: EvalOptions = {}): JsonObject {
  const out: JsonObject = { call: 'eval', doc: id };
  if (options.t !== undefined) out['t'] = options.t;
  if (options.clean) out['clean'] = true;
  if (options.debug_text) out['debug_text'] = true;
  return out;
}
export const framesCall = (id: string, count: number, from = '0s'): JsonObject => ({ call: 'frames', doc: id, count, from });
export const keysCall = (id: string, runs: number): JsonObject => ({ call: 'keys', doc: id, runs });

export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** A deep_show reply that presented its revision. */
export function presented(reply: JsonObject, what: string): void {
  expect(outcome(reply), `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// `registry` and `fixtures`

export interface OperatorInfo { module: string; phase: string; reads: string[]; writes: string[] }
export function operatorsOf(reply: JsonObject): Record<string, OperatorInfo> {
  const out: Record<string, OperatorInfo> = {};
  for (const [name, o] of Object.entries(obj(reply['operators'], 'registry: operators'))) {
    const op = obj(o, `registry: operators.${name}`);
    out[name] = { module: str(op['module'], `operators.${name}.module`), phase: str(op['phase'], `operators.${name}.phase`), reads: strs(op['reads'], `operators.${name}.reads`), writes: strs(op['writes'], `operators.${name}.writes`) };
  }
  return out;
}
/** Each operator's or pass's terms as the registry's `costs` reports them (#379). */
export function costTermsOf(reply: JsonObject): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [name, c] of Object.entries(obj(reply['costs'], 'registry: costs'))) {
    const terms = obj(obj(c, `registry: costs.${name}`)['terms'], `registry: costs.${name}.terms`);
    out[name] = Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, num(v, `registry: costs.${name}.terms.${k}`)]));
  }
  return out;
}

export interface Fixture { module: string; name: string; document: JsonObject; record?: JsonObject }
export function fixturesOf(reply: JsonObject): Fixture[] {
  const list = arr(reply['fixtures'], 'fixtures').map((v, i): Fixture => {
    const f = obj(v, `fixtures[${i}]`);
    const out: Fixture = { module: str(f['module'], `fixtures[${i}].module`), name: str(f['name'], `fixtures[${i}].name`), document: obj(f['document'], `fixtures[${i}].document`) };
    if (isObject(f['record'])) out.record = f['record'];
    return out;
  });
  expect(list.length, 'the build registers fixtures').toBeGreaterThan(0);
  return list;
}

// ---------------------------------------------------------------------------------------------------
// `eval` replies (#387's, with `hash` and `debug` added)

export interface Node { operator: string; module: string; phase: string; item: string | null; key: string; result: string; run: string; debug?: string | null }
export interface Evaluated { hash: string; nodes: Node[]; raw: JsonObject }

const KEY = /^[0-9a-f]{32}$/;
const DIGEST = /^[0-9a-f]{64}$/;
export const nodeId = (n: { operator: string; item: string | null }): string => `${n.operator}@${n.item ?? '(document)'}`;

/** An `eval` reply that evaluated: its hash version and its nodes, checked for form; with `debug`, each node's `debug` too. */
export function evaluated(reply: JsonObject, what: string, debug = false): Evaluated {
  expect(outcome(reply), `${what} evaluated: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('evaluated');
  const hash = str(reply['hash'], `${what}: hash, the hash version its keys and digests were computed with`);
  const nodes = arr(reply['nodes'], `${what}: nodes`).map((v, i): Node => {
    const n = obj(v, `${what}: nodes[${i}]`);
    const node: Node = {
      operator: str(n['operator'], `${what}: nodes[${i}].operator`), module: str(n['module'], `${what}: nodes[${i}].module`),
      phase: str(n['phase'], `${what}: nodes[${i}].phase`), item: n['item'] === null ? null : str(n['item'], `${what}: nodes[${i}].item`),
      key: str(n['key'], `${what}: nodes[${i}].key`), result: str(n['result'], `${what}: nodes[${i}].result`), run: str(n['run'], `${what}: nodes[${i}].run`),
    };
    expect(node.key, `${what}: ${nodeId(node)}'s key is 128 bits in lowercase hex`).toMatch(KEY);
    expect(node.result, `${what}: ${nodeId(node)}'s result digest is 256 bits in lowercase hex`).toMatch(DIGEST);
    expect(['ran', 'hit', 'kept'], `${what}: ${nodeId(node)}'s run`).toContain(node.run);
    if (debug) {
      expect('debug' in n, `${what}: ${nodeId(node)} carries debug (debug_text: true)`).toBe(true);
      const d = n['debug'];
      if (d !== null) expect(str(d, `${what}: ${nodeId(node)}.debug`), `${what}: ${nodeId(node)}'s debug is a SHA-256 in lowercase hex`).toMatch(DIGEST);
      node.debug = d as string | null;
    }
    return node;
  });
  const ids = nodes.map(nodeId);
  expect(new Set(ids).size, `${what}: each (operator, item) is one node`).toBe(ids.length);
  expect(nodes.length, `${what}: the evaluation lists its nodes`).toBeGreaterThan(0);
  return { hash, nodes, raw: reply };
}

export const byId = (e: Evaluated): Map<string, Node> => new Map(e.nodes.map((n) => [nodeId(n), n]));

/** Nodes in both with another key or result, and nodes in one only; each failure names the operator and its item. */
export function nodeDifferences(a: Evaluated, b: Evaluated, what: string): { failures: string[]; operators: string[] } {
  const failures: string[] = [];
  const operators = new Set<string>();
  const right = byId(b);
  const left = byId(a);
  for (const [id, n] of left) {
    const m = right.get(id);
    if (!m) { failures.push(`${what}: ${n.operator} on ${n.item ?? 'the document'} is missing from the second`); operators.add(n.operator); continue; }
    if (n.key !== m.key) { failures.push(`${what}: ${n.operator} on ${n.item ?? 'the document'} has key ${n.key} then ${m.key}`); operators.add(n.operator); }
    if (n.result !== m.result) { failures.push(`${what}: ${n.operator} on ${n.item ?? 'the document'} has result digest ${n.result.slice(0, 16)}… then ${m.result.slice(0, 16)}…`); operators.add(n.operator); }
  }
  for (const [id, m] of right) if (!left.has(id)) { failures.push(`${what}: ${m.operator} on ${m.item ?? 'the document'} is missing from the first`); operators.add(m.operator); }
  return { failures, operators: sorted([...operators]) };
}

// ---------------------------------------------------------------------------------------------------
// `frames` replies (#387's, with `json_values` added)

export interface Frame { t: number; ran: number; allocs: number; json_values: number }
export function framesOf(reply: JsonObject, what: string, count: number): Frame[] {
  const list = arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), ran: num(f['ran'], `${what}: frames[${i}].ran`), allocs: num(f['allocs'], `${what}: frames[${i}].allocs`), json_values: num(f['json_values'], `${what}: frames[${i}].json_values, the JSON values the frame allocated, counted by the allocator`) };
  });
  expect(list.length, `${what}: the frames call evaluates ${count} frames`).toBe(count);
  return list;
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them (the kinds the cost model's bench board draws, crates/deep-show/src/costs.rs)

export const SEED_OF_DOCS = 855;
export const order = (i: number): string => `a${String(i).padStart(6, '0')}`;
export const rect = (id: string, i: number, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order: order(i), params: { box: [0, 0, 2.4, 1.5], paint: { fill: { role: i % 7 === 0 ? 'ink' : 'muted' } } }, at: { pos: [(i % 100) * 12.8, Math.floor(i / 100) * 7.2, 0] }, ...extra });
export const circle = (id: string, i: number): JsonObject =>
  ({ id, kind: 'circle@1', name: `Circle ${id}`, order: order(i), params: { center: [(i % 100) * 12.8, Math.floor(i / 100) * 7.2], r: 3, paint: { fill: { role: 'muted' } } } });
export const path = (id: string, i: number): JsonObject => {
  const y = Math.floor(i / 100) * 7.2;
  return { id, kind: 'path@1', name: `Path ${id}`, order: order(i), params: { d: `M0 ${y} L40 ${y + 4} L80 ${y}`, paint: { stroke: { role: 'ink', width: 1 } } } };
};
/** `i` in letters (a text holding a digit is a number the check wants sourced). */
const letters = (i: number): string => [i % 26, Math.floor(i / 26) % 26, Math.floor(i / 676) % 26].map((d) => String.fromCharCode(97 + d)).join('');
export const text = (id: string, i: number, words = 'Label'): JsonObject =>
  ({ id, kind: 'text@1', name: `Text ${id}`, order: order(i), params: { text: `${words} ${letters(i)}`, font: 'body', size: 11, box: { w: 120, h: 16 } }, at: { pos: [(i % 100) * 12.8, Math.floor(i / 100) * 7.2, 0] } });
export const frame = (id: string, i: number): JsonObject =>
  ({ id, kind: 'frame@1', name: `Frame ${id}`, order: order(i), params: { box: [0, 0, 12, 6] }, at: { pos: [(i % 100) * 12.8, Math.floor(i / 100) * 7.2, 0] } });

export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', seed: SEED_OF_DOCS, title,
    description: `${title}, drawn by a test agent through deep_show for the #855 acceptance tests.`,
    size: [1280, 720], items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const requires = (modules: Record<string, string>): JsonObject => ({ requires: { modules } });

/** The five kinds of the mixed board, in turn: rect `r<i>`, circle `c<i>`, path `p<i>`, text `t<i>`, frame `f<i>`. */
export const KINDS = [['r', rect], ['c', circle], ['p', path], ['t', text], ['f', frame]] as const;
/** A board of `n` items, the five kinds in turn: what the 10,000-item criteria evaluate. */
export function mixed(title: string, n: number, extra: JsonObject = {}): JsonObject {
  return board(title, Array.from({ length: n }, (_, i) => { const [prefix, make] = KINDS[i % KINDS.length]!; return make(`${prefix}${i}`, i); }), extra);
}

/** A clip that slides `item` along x from `from` to `to` over `span` seconds, placed at 0 (#387). */
export function slide(item: string, kind: string, from: number, to: number, span = 2): JsonObject {
  return {
    clips: { slide: { slots: { target: { type: kind, required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } } } } },
    placements: { p: { clip: 'slide', slots: { target: item }, start: '0s' } },
  };
}

/** Sets `value` at `path` (`items/<id>/params/box/2`) in a copy of `document`. */
export function edit(document: JsonObject, edits: Record<string, JsonValue>): JsonObject {
  const out = clone(document);
  for (const [p, value] of Object.entries(edits)) {
    const parts = p.split('/');
    let at: JsonValue = out;
    for (const part of parts.slice(0, -1)) {
      const next: JsonValue | undefined = Array.isArray(at) ? at[Number(part)] : (at as JsonObject)[part];
      if (next === undefined) throw Error(`edit: ${p} has no ${part}`);
      at = next;
    }
    const last = parts[parts.length - 1]!;
    if (Array.isArray(at)) at[Number(last)] = value;
    else (at as JsonObject)[last] = value;
  }
  return out;
}

/** The same document spelled otherwise: every object's members, the items among them, in reverse order. Equal under the canonical form. */
export function respelled(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(respelled);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, respelled(v)]));
  return value;
}

// ---------------------------------------------------------------------------------------------------
// The cost model: today's debug-built coefficients (crates/deep-canvas/costs.json at the base), and
// the reference items each operator's cost is read at.

/** The base's committed terms for the criterion's three operators, measured from the debug build. */
export const BASE_TERMS: Record<string, Record<string, number>> = {
  'text.shape': { ns_per_item: 1, ns_per_glyph: 32503.37 },
  'text.status': { ns_per_item: 322833.0 },
  'marks2d.frame': { ns_per_item: 11818, ns_per_vertex: 327.37, ns_per_glyph: 19.15 },
};
/** The bench's fit floors a per-item term at 1 ns (costs.rs `max(1.0)`), so a term at the floor can't fall. */
export const TERM_FLOOR = 1;
/** Items each operator is costed at: its kinds' counts of vertices and glyphs (cost.rs `counts`). */
export const REFERENCE_ITEMS: Record<string, { what: string; vertices: number; glyphs: number }[]> = {
  'text.shape': [{ what: 'a 4-glyph text', vertices: 4, glyphs: 4 }, { what: 'a 13-glyph label', vertices: 4, glyphs: 13 }, { what: 'a 120-glyph text', vertices: 4, glyphs: 120 }],
  'text.status': [{ what: 'one status mark', vertices: 4, glyphs: 0 }],
  'marks2d.frame': [{ what: 'a rect', vertices: 4, glyphs: 0 }, { what: 'a 13-glyph label', vertices: 4, glyphs: 13 }, { what: 'a 400-segment path', vertices: 401, glyphs: 0 }, { what: 'a 120-glyph text', vertices: 4, glyphs: 120 }],
};
const costAt = (t: Record<string, number>, c: { vertices: number; glyphs: number }): number =>
  (t['ns_per_item'] ?? 0) + (t['ns_per_vertex'] ?? 0) * c.vertices + (t['ns_per_glyph'] ?? 0) * c.glyphs;

/**
 * Criterion 3: each of the three operators' coefficients is lower than the base's: every term the base
 * declares above the fit's floor, and its cost at each reference item. Each failure names the operator,
 * the term or item, and both values.
 */
export function notLower(terms: Record<string, Record<string, number> | undefined>, what: string): string[] {
  const failures: string[] = [];
  for (const [op, base] of Object.entries(BASE_TERMS)) {
    const now = terms[op];
    if (!now) { failures.push(`${what}: no terms for ${op}`); continue; }
    for (const [term, was] of Object.entries(base)) {
      if (was <= TERM_FLOOR) continue;
      const is = now[term] ?? 0;
      if (!(is < was)) failures.push(`${what}: ${op}'s ${term} is ${is}, not lower than the debug build's ${was}`);
    }
    for (const item of REFERENCE_ITEMS[op]!) {
      const was = costAt(base, item);
      const is = costAt(now, item);
      if (!(is < was)) failures.push(`${what}: ${op} costs ${is.toFixed(1)} ns for ${item.what}, not lower than the debug build's ${was.toFixed(1)} ns`);
    }
  }
  return failures;
}

/** Cargo's profiles that build unoptimized (opt-level 0): `dev` and `test`, which inherits it. */
const UNOPTIMIZED = ['dev', 'test'];
/**
 * True for a Cargo profile that optimizes: `release` or `bench`, or a custom profile of the workspace's
 * Cargo.toml that inherits one of them and doesn't set opt-level 0 itself.
 */
export function optimizedProfile(name: string): boolean {
  if (UNOPTIMIZED.includes(name)) return false;
  if (name === 'release' || name === 'bench') return true;
  const toml = readFileSync(join(REPO, 'Cargo.toml'), 'utf8');
  const section = new RegExp(`^\\[profile\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(toml);
  if (!section) return false;
  const body = section[1] ?? '';
  const inherits = /^\s*inherits\s*=\s*"([^"]+)"/m.exec(body)?.[1];
  if (/^\s*opt-level\s*=\s*0\s*$/m.test(body)) return false;
  return inherits === 'release' || inherits === 'bench';
}

/** `rustc -V` in the checkout, under its pinned toolchain. */
export function toolchain(): string {
  return execFileSync('rustc', ['-V'], { cwd: REPO, encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (#387's, with the load added).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing reading here can't pass or fail (not a reference Mac, on battery, Low Power Mode, a thermal warning, loaded), or null. */
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
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}
/** PASS when every run is under the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
