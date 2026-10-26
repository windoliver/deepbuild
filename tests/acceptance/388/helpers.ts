// Test-side tools for the #388 acceptance tests: `deep-show` built per Cargo feature set (a build set plus
// this suite's test features, as #305's and #387's suites build it), driven by JSON lines; the scenario and
// the calls the tests make (deep_show, `registry`, `schedule`, `fixtures`, `eval`); the startup refusal; the
// committed schedule snapshots; the clean look's status map; PNG reading from the evidence store; and the
// checks the criteria's wrong programs must fail, each returning its failures as sentences that name what
// failed. Nothing here stands in for the seal, the scheduler, the status marks or render-back.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/388 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** The closed list of check phases, then the frame phases, in order (Phase). */
export const PHASES: readonly string[] = [
  'load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check',
  'latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback',
];

/**
 * The build sets' lists, as the issue and Registry and seal write them: `core` is the core with text and
 * look; `r1` adds marks2d, data, graph, record, sheet and motion. Sorted by name, as `modules` is.
 */
export const SET_MODULES = {
  core: ['look', 'text'],
  r1: ['data', 'graph', 'look', 'marks2d', 'motion', 'record', 'sheet', 'text'],
} as const;

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
/** This suite's test features (README: Test builds). */
export type TestFeature = 'test-leave-out-look' | 'test-leave-out-text';
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
    dir = mkdtempSync(join(tmpdir(), 'deep-388-bins-'));
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

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 300_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, sealPlanted?: string): JsonObject[] {
  const args = ['run', ...(sealPlanted ? ['--planted', sealPlanted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
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
  expect(raw['code'], `the refusal's code: ${JSON.stringify(raw)}`).toBe('seal_refused');
  return { reason: str(raw['reason'], 'the refusal\'s reason'), modules: strs(raw['modules'], 'the refusal\'s modules'), arrays: strs(raw['arrays'] ?? [], 'the refusal\'s arrays'), raw };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-388-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: canvas modules', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** The one document every scenario of this suite shows, in its own visible panel. */
export const DOC = '01JB88D0000000000000000001';

export interface ScenarioExtra { shuffle?: number; record?: JsonObject }

export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1600, 1200] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}

/** The document's own size, so render-back draws one pixel per u and the snapshot's boxes are in its pixels. */
export function sizeOf(document: JsonObject): [number, number] {
  const s = arr(document['size'], 'the document\'s size');
  return [num(s[0], 'the document\'s width'), num(s[1], 'the document\'s height')];
}
/** An agent's deep_show call: a whole revision of `document`, with its issues and, with `pixels`, a render-back snapshot at its own size. */
export function show(document: JsonObject, pixels = false): JsonObject {
  return {
    call: 'deep_show', session: ALPHA.id, doc: DOC, document,
    include: pixels ? ['issues', 'pixels'] : ['issues'], ...(pixels ? { size: sizeOf(document) } : {}),
  };
}
export const REGISTRY: JsonObject = { call: 'registry' };
export const SCHEDULE: JsonObject = { call: 'schedule' };
export const FIXTURES: JsonObject = { call: 'fixtures' };
export const evalCall = (t: string, pixels = false): JsonObject => ({ call: 'eval', doc: DOC, t, ...(pixels ? { pixels: true } : {}) });

export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** A deep_show reply that presented its revision. */
export function presented(reply: JsonObject, what: string): void {
  expect(outcome(reply), `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// The registry and the published schedule

export interface OperatorInfo { module: string; phase: string; reads: string[]; writes: string[] }
export interface Registry { modules: string[]; buildSet: string; state: string; setDigest: string | null; operators: Record<string, OperatorInfo>; raw: JsonObject }
export function registry(reply: JsonObject): Registry {
  const operators: Record<string, OperatorInfo> = {};
  for (const [name, o] of Object.entries(obj(reply['operators'], 'registry: operators'))) {
    const op = obj(o, `registry: operators.${name}`);
    operators[name] = { module: str(op['module'], `operators.${name}.module`), phase: str(op['phase'], `operators.${name}.phase`), reads: strs(op['reads'], `operators.${name}.reads`), writes: strs(op['writes'], `operators.${name}.writes`) };
  }
  return {
    modules: strs(reply['modules'], 'registry: modules'), buildSet: str(reply['build_set'], 'registry: build_set'), state: str(reply['state'], 'registry: state'),
    setDigest: typeof reply['set_digest'] === 'string' ? reply['set_digest'] : null, operators, raw: reply,
  };
}

/**
 * Registry and seal: the build holds exactly the canvas modules its set's list names, sorted by name,
 * and its registry is sealed. Each failure names the build set and the module that is extra or missing.
 */
export function setFailures(reg: Registry, set: keyof typeof SET_MODULES): string[] {
  const failures: string[] = [];
  const want: readonly string[] = SET_MODULES[set];
  if (reg.buildSet !== set) failures.push(`the build's registry says build_set ${reg.buildSet}, not ${set}`);
  if (!['sealed', 'ready'].includes(reg.state)) failures.push(`the ${set} registry is ${reg.state}, not sealed or ready`);
  for (const m of reg.modules) if (!want.includes(m)) failures.push(`the ${set} build holds ${m}, which its list doesn't name`);
  for (const m of want) if (!reg.modules.includes(m)) failures.push(`the ${set} build lacks ${m}, which its list names`);
  if (JSON.stringify(reg.modules) !== JSON.stringify(sorted(reg.modules))) failures.push(`the ${set} registry's modules aren't sorted by name: ${reg.modules.join(', ')}`);
  if (new Set(reg.modules).size !== reg.modules.length) failures.push(`the ${set} registry names a module twice: ${reg.modules.join(', ')}`);
  return failures;
}

/** No failures; the message lists them, each naming what failed. `soft` records the failure and lets the test go on, so it reports every reason. */
export function none(failures: readonly string[], what: string, soft = false): void {
  (soft ? expect.soft : expect)(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** The committed snapshot of a build set's sealed plan, `crates/deep-show/schedule/<set>.json` (#387). */
export const SNAPSHOT_DIR = join(REPO, 'crates', 'deep-show', 'schedule');
export function committedSchedule(set: BuildSet): JsonObject {
  const path = join(SNAPSHOT_DIR, `${set}.json`);
  expect(existsSync(path), `the ${set} schedule's committed snapshot exists at crates/deep-show/schedule/${set}.json`).toBe(true);
  return obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `crates/deep-show/schedule/${set}.json`);
}

/** Every operator a schedule lists, as `phase/operator`, from its `phases`. */
function scheduleOperators(schedule: JsonObject, what: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [phase, list] of Object.entries(obj(schedule['phases'], `${what}: phases`))) {
    for (const [i, entry] of arr(list, `${what}: phases.${phase}`).entries()) {
      const e = obj(entry, `${what}: phases.${phase}[${i}]`);
      out.set(`${phase}/${String(e['operator'])}`, JSON.stringify(e));
    }
  }
  return out;
}

/**
 * The published plan against its committed snapshot: every field that differs, and every operator one
 * holds and the other doesn't or holds differently, each failure naming the field or the operator.
 */
export function scheduleDiff(published: JsonObject, committed: JsonObject, what: string): string[] {
  const failures: string[] = [];
  for (const key of sorted([...new Set([...Object.keys(published), ...Object.keys(committed)])])) {
    if (key === 'phases') continue;
    if (JSON.stringify(published[key]) !== JSON.stringify(committed[key])) failures.push(`${what}: ${key} is ${JSON.stringify(published[key])?.slice(0, 300)} published but ${JSON.stringify(committed[key])?.slice(0, 300)} committed`);
  }
  const a = scheduleOperators(published, `${what} (published)`);
  const b = scheduleOperators(committed, `${what} (committed)`);
  for (const [op, entry] of a) {
    if (!b.has(op)) failures.push(`${what}: operator ${op} is published but not in the snapshot`);
    else if (b.get(op) !== entry) failures.push(`${what}: operator ${op} is published as ${entry} but committed as ${b.get(op)}`);
  }
  for (const op of b.keys()) if (!a.has(op)) failures.push(`${what}: operator ${op} is in the snapshot but not published`);
  if (failures.length === 0) {
    const order = (s: JsonObject): string => JSON.stringify(Object.entries(obj(s['phases'], 'phases')).map(([p, l]) => [p, arr(l, p).map((e) => (e as JsonObject)['operator'])]));
    if (order(published) !== order(committed)) failures.push(`${what}: the plan's phase or operator order differs from the snapshot's`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures and `eval`

export interface Fixture { module: string; name: string; document: JsonObject; record?: JsonObject }
export function fixturesOf(reply: JsonObject): Fixture[] {
  return arr(reply['fixtures'], 'fixtures').map((v, i) => {
    const f = obj(v, `fixtures[${i}]`);
    const out: Fixture = { module: str(f['module'], `fixtures[${i}].module`), name: str(f['name'], `fixtures[${i}].name`), document: obj(f['document'], `fixtures[${i}].document`) };
    if (isObject(f['record'])) out.record = f['record'];
    return out;
  });
}
export const recordOf = (f: Fixture): ScenarioExtra => (f.record ? { record: f.record } : {});

export interface Node { operator: string; module: string; phase: string; item: string | null; key: string; result: string }
export interface Evaluated { nodes: Node[]; steps: JsonValue[]; snapshot: string | null; raw: JsonObject }
export const nodeId = (n: { operator: string; item: string | null }): string => `${n.operator}@${n.item ?? '(document)'}`;

/** An `eval` reply that evaluated (#387's shape): its nodes, step log and snapshot. */
export function evaluated(reply: JsonObject, what: string): Evaluated {
  expect(outcome(reply), `${what} evaluated: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('evaluated');
  const nodes = arr(reply['nodes'], `${what}: nodes`).map((v, i): Node => {
    const n = obj(v, `${what}: nodes[${i}]`);
    return {
      operator: str(n['operator'], `${what}: nodes[${i}].operator`), module: str(n['module'], `${what}: nodes[${i}].module`), phase: str(n['phase'], `${what}: nodes[${i}].phase`),
      item: n['item'] === null ? null : str(n['item'], `${what}: nodes[${i}].item`), key: str(n['key'], `${what}: nodes[${i}].key`), result: str(n['result'], `${what}: nodes[${i}].result`),
    };
  });
  const snaps = reply['snapshots'] === undefined ? [] : arr(reply['snapshots'], `${what}: snapshots`);
  const snapshot = snaps.length === 1 ? str(obj(snaps[0], `${what}: snapshot`)['sha256'], `${what}: snapshot sha256`) : null;
  return { nodes, steps: arr(reply['steps'] ?? [], `${what}: steps`), snapshot, raw: reply };
}

/** Every hash of one frame against another's: each node's key and result, the step log and the snapshot. Each failure names the node or the part. */
export function hashDiff(a: Evaluated, b: Evaluated, what: string): string[] {
  const failures: string[] = [];
  const right = new Map(b.nodes.map((n) => [nodeId(n), n]));
  for (const n of a.nodes) {
    const m = right.get(nodeId(n));
    if (!m) { failures.push(`${what}: node ${nodeId(n)} is missing`); continue; }
    if (n.key !== m.key) failures.push(`${what}: node ${nodeId(n)} has key ${n.key} then ${m.key}`);
    if (n.result !== m.result) failures.push(`${what}: node ${nodeId(n)} has result ${n.result.slice(0, 16)}… then ${m.result.slice(0, 16)}…`);
  }
  const left = new Set(a.nodes.map(nodeId));
  for (const id of right.keys()) if (!left.has(id)) failures.push(`${what}: node ${id} appears only under the shuffle`);
  if (JSON.stringify(a.steps) !== JSON.stringify(b.steps)) failures.push(`${what}: the step log differs`);
  if (a.snapshot === null || b.snapshot === null) failures.push(`${what}: a frame carries no snapshot`);
  else if (a.snapshot !== b.snapshot) failures.push(`${what}: the snapshot is ${a.snapshot.slice(0, 16)}… then ${b.snapshot.slice(0, 16)}…`);
  return failures;
}

/** A legal order (#387): phases in the closed order, and on each item a writer's node before its reader's in one phase. */
export function legalityFailures(reg: Registry, e: Evaluated, what: string): string[] {
  const failures: string[] = [];
  const index = new Map(e.nodes.map((n, i) => [nodeId(n), i]));
  for (let i = 1; i < e.nodes.length; i++) {
    const [p, q] = [PHASES.indexOf(e.nodes[i - 1]!.phase), PHASES.indexOf(e.nodes[i]!.phase)];
    if (q < p) failures.push(`${what}: ${nodeId(e.nodes[i]!)} (${e.nodes[i]!.phase}) runs after ${nodeId(e.nodes[i - 1]!)} (${e.nodes[i - 1]!.phase})`);
  }
  for (const reader of e.nodes) {
    for (const read of reg.operators[reader.operator]?.reads ?? []) {
      for (const writer of e.nodes) {
        if (writer.item !== reader.item || writer.phase !== reader.phase || writer === reader) continue;
        if (!(reg.operators[writer.operator]?.writes ?? []).includes(read)) continue;
        if (index.get(nodeId(writer))! > index.get(nodeId(reader))!) failures.push(`${what}: ${nodeId(reader)} reads ${read} before ${nodeId(writer)} writes it`);
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The clean look's status map (crates/deep-canvas-marks/looks/clean.json: render-back draws in the clean
// look, light), and the state words

export const STATES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export type Rgb = [number, number, number];
export interface StatusMap { color: Record<string, Rgb>; glyph: Record<string, string> }
export function cleanLook(): StatusMap {
  const look = obj(JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonValue, 'the clean look');
  const status = obj(look['status'], 'the clean look\'s status');
  const glyphs = obj(obj(look['status_treatment'], 'the clean look\'s status_treatment')['glyph'], 'the clean look\'s glyphs');
  const color: Record<string, Rgb> = {};
  const glyph: Record<string, string> = {};
  for (const s of STATES) {
    const hex = str(status[s], `the clean look's ${s} color`);
    expect(hex, `the clean look's ${s} color is #rrggbb`).toMatch(/^#[0-9a-fA-F]{6}$/);
    color[s] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    glyph[s] = str(glyphs[s], `the clean look's ${s} glyph`);
  }
  return { color, glyph };
}
/** A state's word: its name, read in words (`needs_you` is "needs you"), compared without case. */
export const wordOf = (state: string): string => state.replace(/_/g, ' ');

// ---------------------------------------------------------------------------------------------------
// The status text snapshot on a render-back snapshot (README: The status marks and the legend drawn)

export type Box = [number, number, number, number];
export interface Mark { item: string; binding: string; state: string; color: Rgb | null; bounds: Box; glyph: string | null; word: string | null; label: Box | null }
export interface Entry { state: string; glyph: string | null; word: string | null; color: Rgb | null; swatch: Box | null }
export interface Snapshot { sha256: string; w: number; h: number; marks: Mark[]; legend: Entry[] }

const rgbOf = (v: JsonValue | undefined): Rgb | null =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number') ? (v as number[]) as Rgb : null;
const boxOf = (v: JsonValue | undefined): Box | null =>
  Array.isArray(v) && v.length === 4 && v.every((c) => typeof c === 'number') ? (v as number[]) as Box : null;
const textOf = (v: JsonValue | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The reply's one render-back snapshot with its text snapshot of the status marks and the legend. */
export function snapshotOf(reply: JsonObject, what: string): Snapshot {
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what} carries one snapshot`).toBe(1);
  const s = obj(list[0], `${what}: snapshot`);
  const marks = arr(s['marks'], `${what}: snapshot.marks (the status marks drawn)`).map((v, i): Mark => {
    const m = obj(v, `${what}: marks[${i}]`);
    return {
      item: str(m['item'], `${what}: marks[${i}].item`), binding: str(m['binding'], `${what}: marks[${i}].binding`), state: str(m['state'], `${what}: marks[${i}].state`),
      color: rgbOf(m['color']), bounds: boxOf(m['bounds']) ?? [0, 0, 0, 0], glyph: textOf(m['glyph']), word: textOf(m['word']), label: boxOf(m['label']),
    };
  });
  const legend = arr(s['legend'], `${what}: snapshot.legend`).map((v, i): Entry => {
    const e = obj(v, `${what}: legend[${i}]`);
    return { state: str(e['state'], `${what}: legend[${i}].state`), glyph: textOf(e['glyph']), word: textOf(e['word']), color: rgbOf(e['color']), swatch: boxOf(e['swatch']) };
  });
  return { sha256: str(s['sha256'], `${what}: snapshot sha256`), w: num(s['w'], `${what}: snapshot w`), h: num(s['h'], `${what}: snapshot h`), marks, legend };
}

// ---------------------------------------------------------------------------------------------------
// PNGs from the evidence store (`<root>/<2 hex>/<62 hex>`, #305)

export interface Image { width: number; height: number; rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** The snapshot's PNG, read from the evidence store by its hash. */
export function stored(evidence: string, sha: string): Image {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `the snapshot ${sha} is in the evidence store at <root>/${sha.slice(0, 2)}/${sha.slice(2)}`).toBe(true);
  return decodePng(readFileSync(path));
}

const pixel = (img: Image, x: number, y: number): Rgb => {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
};
/** The most common pixel in a box (clipped to the image), or null for an empty box. */
export function modeIn(img: Image, b: Box): Rgb | null {
  const counts = new Map<string, number>();
  const [x0, y0] = [Math.max(0, Math.ceil(b[0])), Math.max(0, Math.ceil(b[1]))];
  const [x1, y1] = [Math.min(img.width, Math.floor(b[0] + b[2])), Math.min(img.height, Math.floor(b[1] + b[3]))];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = pixel(img, x, y).join(','); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best: string | null = null;
  for (const [k, n] of counts) if (best === null || n > counts.get(best)!) best = k;
  return best === null ? null : (best.split(',').map(Number) as Rgb);
}
const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** WCAG 2.x contrast ratio. */
export const contrast = (a: Rgb, b: Rgb): number => { const [l1, l2] = [luminance(a), luminance(b)]; return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
/** How many pixels in a box contrast with `behind` by at least `ratio`: what is drawn there. */
export function inkIn(img: Image, b: Box, behind: Rgb, ratio = 3): number {
  let n = 0;
  const [x0, y0] = [Math.max(0, Math.ceil(b[0])), Math.max(0, Math.ceil(b[1]))];
  const [x1, y1] = [Math.min(img.width, Math.floor(b[0] + b[2])), Math.min(img.height, Math.floor(b[1] + b[3]))];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (contrast(pixel(img, x, y), behind) >= ratio) n++;
  return n;
}
const near = (a: Rgb | null, b: Rgb | null, tolerance = 1): boolean => a !== null && b !== null && a.every((c, i) => Math.abs(c - b[i]!) <= tolerance);
const inside = (inner: Box, outer: Box): boolean => inner[0] >= outer[0] - 0.5 && inner[1] >= outer[1] - 0.5 && inner[0] + inner[2] <= outer[0] + outer[2] + 0.5 && inner[1] + inner[3] <= outer[1] + outer[3] + 0.5;
const apart = (a: Box, b: Box): number => {
  const dx = Math.max(0, b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
  const dy = Math.max(0, b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
  return Math.hypot(dx, dy);
};
const overlaps = (a: Box, b: Box): boolean => apart(a, b) === 0 && !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
/** "Beside its color": a label wholly inside the mark, or wholly outside it within this many pixels. */
export const BESIDE_PX = 16;

/** The status bindings of a document: binding ID → {item, source}. */
export function bindingsOf(document: JsonObject): Map<string, { item: string; source: string }> {
  const out = new Map<string, { item: string; source: string }>();
  const all = isObject(document['status_bindings']) ? document['status_bindings'] : {};
  for (const [id, b] of Object.entries(all)) {
    const binding = obj(b, `status_bindings.${id}`);
    const target = str(binding['target'], `status_bindings.${id}.target`);
    const m = /^items\/([^/]+)\//.exec(target);
    out.set(id, { item: m ? m[1]! : target, source: str(binding['source'], `status_bindings.${id}.source`) });
  }
  return out;
}

/**
 * The status-color rule on one drawn board: every status binding is one mark in its source's state (from
 * `states`), drawn in the look's color for that state, carrying the look's glyph for the state and the
 * state's word in a label beside its color, with ink drawn there; and a legend entry for each state on
 * screen shows that glyph, color and word, its swatch drawn in the color. Each failure names the mark (or
 * the legend's state).
 */
export function statusFailures(document: JsonObject, states: Record<string, string>, snap: Snapshot, img: Image, look: StatusMap, what: string): string[] {
  const failures: string[] = [];
  const bindings = bindingsOf(document);
  if (bindings.size === 0) failures.push(`${what}: the board has no status binding, so no status mark to check`);
  const ground = modeIn(img, [0, 0, img.width, img.height]);
  const onScreen = new Set<string>();
  for (const [id, b] of bindings) {
    const state = states[b.source];
    const name = `mark ${b.item}`;
    if (state === undefined) { failures.push(`${what}: ${name}: the record gives its source ${b.source} no state`); continue; }
    const marks = snap.marks.filter((m) => m.binding === id || (m.item === b.item && m.binding === ''));
    if (marks.length !== 1) { failures.push(`${what}: ${name} (binding ${id}) is ${marks.length} entries in the snapshot's marks, not one: ${JSON.stringify(snap.marks)}`); continue; }
    const m = marks[0]!;
    if (m.item !== b.item) failures.push(`${what}: ${name}: the snapshot names its item ${m.item}`);
    if (m.state !== state) failures.push(`${what}: ${name} draws state ${m.state}, not its source's ${state}`);
    onScreen.add(state);
    if (!near(m.color, look.color[state]!, 0)) failures.push(`${what}: ${name} (${state}) names color ${JSON.stringify(m.color)}, not the look's ${state} color ${JSON.stringify(look.color[state])}`);
    const fill = modeIn(img, m.bounds);
    if (!near(fill, look.color[state]!)) failures.push(`${what}: ${name} (${state}) draws ${JSON.stringify(fill)} inside its bounds ${JSON.stringify(m.bounds)}, not its color ${JSON.stringify(look.color[state])}`);
    if (m.glyph === null) failures.push(`${what}: ${name} (${state}) draws no glyph`);
    else if (m.glyph !== look.glyph[state]) failures.push(`${what}: ${name} (${state}) draws glyph ${JSON.stringify(m.glyph)}, not the look's ${JSON.stringify(look.glyph[state])}`);
    if (m.word === null) failures.push(`${what}: ${name} (${state}) draws no word`);
    else if (m.word.toLowerCase() !== wordOf(state)) failures.push(`${what}: ${name} (${state}) draws word ${JSON.stringify(m.word)}, not ${JSON.stringify(wordOf(state))}`);
    if (m.label === null) { failures.push(`${what}: ${name} (${state}) has no label box for its glyph and word`); continue; }
    const within = inside(m.label, m.bounds);
    if (!within && (overlaps(m.label, m.bounds) || apart(m.label, m.bounds) > BESIDE_PX)) failures.push(`${what}: ${name} (${state})'s label ${JSON.stringify(m.label)} isn't beside its color ${JSON.stringify(m.bounds)} (inside it, or outside within ${BESIDE_PX} px)`);
    const behind = within ? look.color[state]! : ground;
    if (behind === null || inkIn(img, m.label, behind) < 4) failures.push(`${what}: ${name} (${state}) draws nothing in its label box ${JSON.stringify(m.label)}: no glyph or word on screen`);
  }
  for (const state of onScreen) {
    const entries = snap.legend.filter((e) => e.state === state);
    if (entries.length !== 1) { failures.push(`${what}: the legend shows ${state}, on screen, ${entries.length} times, not once`); continue; }
    const e = entries[0]!;
    if (e.glyph !== look.glyph[state]) failures.push(`${what}: the legend's ${state} shows glyph ${JSON.stringify(e.glyph)}, not ${JSON.stringify(look.glyph[state])}`);
    if (e.word === null || e.word.toLowerCase() !== wordOf(state)) failures.push(`${what}: the legend's ${state} shows word ${JSON.stringify(e.word)}, not ${JSON.stringify(wordOf(state))}`);
    if (!near(e.color, look.color[state]!, 0)) failures.push(`${what}: the legend's ${state} names color ${JSON.stringify(e.color)}, not ${JSON.stringify(look.color[state])}`);
    if (e.swatch === null || !near(modeIn(img, e.swatch), look.color[state]!)) failures.push(`${what}: the legend's ${state} swatch ${JSON.stringify(e.swatch)} isn't drawn in ${JSON.stringify(look.color[state])}`);
  }
  for (const e of snap.legend) if (!onScreen.has(e.state)) failures.push(`${what}: the legend shows ${e.state}, which no mark on screen draws`);
  return failures;
}

/** The record's state for each handle, from a scenario record (`{handle → {state?}}`). */
export function statesOf(record: JsonObject | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [handle, r] of Object.entries(record ?? {})) if (isObject(r) && typeof r['state'] === 'string') out[handle] = r['state'];
  return out;
}
/** The same record with every state moved to the next of the nine, so a mark that ignores its state is caught. */
export function nextStates(record: JsonObject): JsonObject {
  const out = clone(record);
  for (const r of Object.values(out)) {
    if (isObject(r) && typeof r['state'] === 'string') r['state'] = STATES[(STATES.indexOf(r['state'] as (typeof STATES)[number]) + 1) % STATES.length]!;
  }
  return out;
}
