// Test-side tools for the #2085 acceptance tests: `deep-show` built once with `--features full` (#305's,
// #387's and #855's way, copied here), driven by JSON lines; the scenario, the `fixtures`, `deep_show` and
// `kit` calls; and what the base registers as #429's planted documents. Nothing here stands in for the
// `fixtures` call, the check or the kit.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2085 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';

/** The criteria's IDs: scripts/proof-change.mjs's criterionId over each criterion's text as this job received it. */
export const AC1 = '#2085.a93c4567';
export const AC2 = '#2085.353d4030';
export const AC3 = '#2085.688e488c';

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show --no-default-features --features full`, built once per file and copied out of
// target/debug under its own name (#305, #387, #855).

const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);
export const FULL = ['full'];

function cargoBuild(features: string[]): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

/** Builds `full` once before the file's tests; a test that asks for the binary fails with cargo's error if it didn't build. */
export function useFull(): () => string {
  let dir = '';
  let error = '';
  let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2085-bins-'));
    error = cargoBuild(FULL);
    bin = join(dir, `${SHOW_NAME}-full`);
    if (error === '') copyFileSync(UPLIFTED, bin);
  }, 5_400_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} --no-default-features --features ${FULL.join(',')}`).toBe('');
    return bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// Running it: one scenario line in, one answer line out (#305's `deep-show run`).

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, scenarioLine: JsonObject, timeoutMs = 1_800_000): Started {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenarioLine)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** `deep-show run`: one scenario, accepted, with one reply per call. `what` names the scenario in a failure. */
export function run(bin: string, sc: JsonObject, what = 'the scenario'): JsonObject[] {
  const s = start(bin, sc);
  expect(s.timedOut, `${SHOW_NAME} run (${what}) finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run (${what}) exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(-2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run (${what}): one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run (${what}): the answer`);
  expect(out['ok'], `${SHOW_NAME} run accepts ${what}: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2085-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls (#387's: one agent session, each document in its own visible panel)

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: fixtures', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** Document IDs: `doc(n)`, each in its own visible panel `p<n>`. */
export const doc = (n: number): string => `01JB2085D${String(n).padStart(17, '0')}`;

export interface ScenarioExtra { planted?: string; record?: JsonObject }

/** A scenario with the documents doc(1) … doc(docs) each in its own visible panel. */
export function scenario(evidence: string, calls: JsonObject[], docs = 1, extra: ScenarioExtra = {}): JsonObject {
  const docMap: JsonObject = {};
  const panels: JsonObject = {};
  for (let n = 1; n <= Math.max(1, docs); n++) {
    docMap[doc(n)] = { panel: `p${n}` };
    panels[`p${n}`] = { rect: [0, 0, 800, 600] };
  }
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels,
    docs: docMap,
    calls,
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}

export const FIXTURES: JsonObject = { call: 'fixtures' };

/** An agent's deep_show call: a whole revision of `document`, its issues asked for, no pixels (#387's `show`). */
export function show(document: JsonObject, id: string): JsonObject {
  return { call: 'deep_show', session: ALPHA.id, doc: id, document, include: ['issues'] };
}

/** A fixture as the `fixtures` call lists it (#387 README: Fixtures). */
export interface Fixture { module: string; name: string; document: JsonObject; record?: JsonObject }
export const fixtureName = (f: Fixture): string => `${f.module}/${f.name}`;

export function fixturesOf(reply: JsonObject): Fixture[] {
  return arr(reply['fixtures'], 'fixtures').map((v, i): Fixture => {
    const f = obj(v, `fixtures[${i}]`);
    const out: Fixture = { module: str(f['module'], `fixtures[${i}].module`), name: str(f['name'], `fixtures[${i}].name`), document: obj(f['document'], `fixtures[${i}].document`) };
    if (isObject(f['record'])) out.record = f['record'];
    return out;
  });
}

/** What a deep_show reply says when it didn't present: its outcome and each issue's code, severity and path. */
export function notPresented(reply: JsonObject): string {
  const issues = Array.isArray(reply['issues']) ? reply['issues'] : [];
  const said = issues.filter(isObject).map((i) => `${String(i['code'])} (${String(i['severity'])}${i['path'] ? ` at ${String(i['path'])}` : ''})`);
  return `${String(reply['outcome'])}${said.length ? `: ${said.join(', ')}` : ''}${reply['code'] ? ` [${String(reply['code'])}]` : ''}`;
}

export interface Shown { fixture: Fixture; reply: JsonObject }

/**
 * The `fixtures` call and every fixture it lists shown by deep_show in the same build: the call, then each
 * fixture without a record in one process, each to its own document; a fixture with a record (the readings its
 * bound values read) in a process of its own with that record as the scenario's, as #387's and #855's suites show it.
 */
export function listAndShow(bin: string, evidence: string): { fixtures: Fixture[]; shown: Shown[] } {
  const [listing] = run(bin, scenario(evidence, [FIXTURES]), 'the fixtures call');
  const fixtures = fixturesOf(listing!);
  const plain = fixtures.filter((f) => !f.record);
  const shown: Shown[] = [];
  if (plain.length) {
    const replies = run(bin, scenario(evidence, plain.map((f, i) => show(f.document, doc(i + 1))), plain.length), 'every listed fixture without a record, shown by deep_show');
    plain.forEach((fixture, i) => shown.push({ fixture, reply: replies[i]! }));
  }
  for (const fixture of fixtures.filter((f) => f.record)) {
    const [reply] = run(bin, scenario(evidence, [show(fixture.document, doc(1))], 1, { record: fixture.record! }), `${fixtureName(fixture)} with its record, shown by deep_show`);
    shown.push({ fixture, reply: reply! });
  }
  // In the listing's order, so the first failure is the first fixture a suite that walks the listing reaches.
  const order = new Map(fixtures.map((f, i) => [f, i]));
  shown.sort((a, b) => order.get(a.fixture)! - order.get(b.fixture)!);
  return { fixtures, shown };
}

/** Each listed fixture deep_show didn't present, as `<module>/<name>: <outcome>: <codes>`, in the listing's order. */
export const unpresented = (shown: Shown[]): string[] =>
  shown.filter((s) => s.reply['outcome'] !== 'presented').map((s) => `${fixtureName(s.fixture)}: ${notPresented(s.reply)}`);

// ---------------------------------------------------------------------------------------------------
// The conformance kit (#138's `kit` call): the effects module's fixtures and catalog parts.

export const KIT_EFFECTS: JsonObject = { call: 'kit', modules: ['effects'], parts: ['fixtures', 'catalog'] };

/**
 * #429's planted documents, as the base registers them in crates/deep-canvas-effects/src/module.rs: each fixture
 * name and the one code its sidecar names, the code its check must raise.
 */
export const PLANTED: ReadonlyArray<readonly [name: string, code: string]> = [
  ['same-machine-check', 'not_exact'],
  ['composed-in-core-view', 'operator_budget_class'],
  ['live-only-material', 'live_only_canonical'],
  ['scattered-write', 'operator_kind_rule'],
  ['tint-operator-status-color', 'operator_status_color'],
  ['tint-cost-understated', 'cost_understated'],
  ['tint-operator-cycle', 'operator_cycle'],
  ['tint-operator-limit', 'operator_limit'],
  ['tint-operator-source', 'operator_source'],
  ['tint-operator-type', 'operator_type'],
  ['tint-operator-unbounded', 'operator_unbounded'],
  ['tint-operator-unknown-op', 'operator_unknown_op'],
];

/** The plant AC2's wrong program runs under (README: The plant): the check trusts a compute write's index. */
export const TRUSTS_WRITE_INDEX = 'trusts_write_index';

export interface KitCase { case: string; verdict: string; fixture?: string; expected_codes?: string[]; raised_codes?: string[]; failure?: JsonObject; raw: JsonObject }
export interface KitPart { part: string; verdict: string; cases: KitCase[]; failures: JsonObject[] }
export interface KitModule { module: string; verdict: string; parts: KitPart[]; failures: JsonObject[] }

/** The kit reply's report of one module. */
export function kitModule(reply: JsonObject, module: string): KitModule {
  const modules = arr(reply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const m = modules.find((x) => x['module'] === module);
  expect(m, `the kit reports the module ${module}: ${JSON.stringify(reply).slice(0, 1500)}`).toBeDefined();
  const parts = arr(m!['parts'], `kit: ${module}.parts`).map((p, i): KitPart => {
    const part = obj(p, `kit: ${module}.parts[${i}]`);
    const cases = arr(part['cases'], `kit: ${module}.parts[${i}].cases`).map((c, j): KitCase => {
      const o = obj(c, `kit: ${module}.parts[${i}].cases[${j}]`);
      const out: KitCase = { case: str(o['case'], 'a case\'s name'), verdict: str(o['verdict'], 'a case\'s verdict'), raw: o };
      if (typeof o['fixture'] === 'string') out.fixture = o['fixture'];
      if (Array.isArray(o['expected_codes'])) out.expected_codes = strs(o['expected_codes'], 'expected_codes');
      if (Array.isArray(o['raised_codes'])) out.raised_codes = strs(o['raised_codes'], 'raised_codes');
      if (isObject(o['failure'])) out.failure = o['failure'];
      return out;
    });
    return { part: str(part['part'], 'a part\'s name'), verdict: str(part['verdict'], 'a part\'s verdict'), cases, failures: arr(part['failures'] ?? [], 'a part\'s failures').filter(isObject) };
  });
  return { module, verdict: str(m!['verdict'], `kit: ${module}.verdict`), parts, failures: arr(m!['failures'] ?? [], `kit: ${module}.failures`).filter(isObject) };
}

export function part(m: KitModule, name: string): KitPart {
  const p = m.parts.find((x) => x.part === name);
  expect(p, `the kit ran the part ${name} on ${m.module}: parts ${JSON.stringify(m.parts.map((x) => x.part))}`).toBeDefined();
  return p!;
}

/** Whether a kit fixture name (`parity/<category>/<name>.<profile>`) is the planted document `name`, wherever it is filed. */
export const isFixture = (kitName: string | undefined, name: string): boolean =>
  typeof kitName === 'string' && new RegExp(`/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9_]+$`).test(kitName);

/** The fixtures part's exact-codes case of the planted document `name`. */
export const codesCase = (fixtures: KitPart, name: string): KitCase | undefined =>
  fixtures.cases.find((c) => c.case.endsWith('#codes') && isFixture(c.fixture, name));

// ---------------------------------------------------------------------------------------------------
// scripts/known-failures.json

export const KNOWN_FAILURES = join(REPO, 'scripts', 'known-failures.json');
export function knownFailures(): Record<string, string> {
  const parsed = obj(JSON.parse(readFileSync(KNOWN_FAILURES, 'utf8')) as JsonValue, 'scripts/known-failures.json');
  const failures = obj(parsed['failures'], 'scripts/known-failures.json: failures');
  return Object.fromEntries(Object.entries(failures).map(([k, v]) => [k, str(v, `known failure ${k}`)]));
}
