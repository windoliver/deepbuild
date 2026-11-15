// Test-side tools for the #2362 acceptance tests: `deep-show` built as scripts/canvas-kit.mjs builds it and as
// #855's release-build case builds it, driven by JSON lines (#305's `deep-show run`); the scenario and the `catalog`,
// `fixtures`, `kit`, `deep_show` and `eval` calls; the committed kit ledger; and the twelve codes #154 added to
// motion's catalog. Nothing here stands in for the kit, the catalog, the seal or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2362 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';

/** The criteria's IDs: scripts/proof-change.mjs's criterionId over each criterion's text as the issue gives it. */
export const AC1 = '#2362.57fbe409';
export const AC2 = '#2362.9bb19ae2';
export const AC3 = '#2362.c889f209';

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
export const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------
// The builds. `kit`: scripts/canvas-kit.mjs's own (`cargo build --locked --bin deep-show`, the default feature set,
// which is `full`). `release`: #855's release-build case's (`cargo build --locked --release --bin deep-show
// --no-default-features --features full`). Each is built once per file and copied out of target/ (or CARGO_TARGET_DIR)
// under its own name.
// The release build embeds the committed crates/deep-show/kit-ledger.json: DEEP_KIT_LEDGER is left out of cargo's
// environment, so no ledger but the committed one is sealed by.

export type BuildName = 'kit' | 'release';
const ARGS: Record<BuildName, string[]> = {
  kit: ['build', '--locked', '--bin', SHOW_NAME],
  release: ['build', '--locked', '--release', '--bin', SHOW_NAME, '--no-default-features', '--features', 'full'],
};
const uplifted = (name: BuildName): string => join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), name === 'release' ? 'release' : 'debug', SHOW_NAME);
export const buildCommand = (name: BuildName): string => `cargo ${ARGS[name].join(' ')}`;

function cargoBuild(name: BuildName): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  delete env['DEEP_KIT_LEDGER'];
  const run = spawnSync('cargo', ARGS[name], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `${buildCommand(name)} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds `name` once before the file's tests; a test that asks for the binary fails with cargo's error if it didn't build. */
export function useBuild(name: BuildName): () => string {
  let dir = '';
  let error = '';
  let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2362-bins-'));
    error = cargoBuild(name);
    bin = join(dir, `${SHOW_NAME}-${name}`);
    if (error === '') copyFileSync(uplifted(name), bin);
  }, 5_400_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${buildCommand(name)}`).toBe('');
    return bin;
  };
}

/** A fresh folder per test, deleted after it: the evidence store root and the kit's ledger. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2362-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running it: one scenario line in, one answer line out; a refused seal is one line and exit 2 (#305).

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, scenarioLine: JsonObject, timeoutMs = 3_000_000): Started {
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
  expect(s.status, `${SHOW_NAME} run (${what}) exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run (${what}): one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run (${what}): the answer`);
  expect(out['ok'], `${SHOW_NAME} run accepts ${what}: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls (#387's: one agent session, each document in its own visible panel)

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: kit seal', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** Document IDs: `doc(n)`, each in its own visible panel `p<n>`. */
export const doc = (n: number): string => `01JB2362D${String(n).padStart(17, '0')}`;

export function scenario(evidence: string, calls: JsonObject[], docs = 1, record?: JsonObject): JsonObject {
  const docMap: JsonObject = {};
  const panels: JsonObject = {};
  for (let n = 1; n <= Math.max(1, docs); n++) {
    docMap[doc(n)] = { panel: `p${n}` };
    panels[`p${n}`] = { rect: [0, 0, 1280, 720] };
  }
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels,
    docs: docMap,
    calls,
  };
  if (record) out['record'] = record;
  return out;
}

export const FIXTURES: JsonObject = { call: 'fixtures' };
export const CATALOG: JsonObject = { call: 'catalog' };
/** The kit call scripts/canvas-kit.mjs makes (every part, default backends, seed and sizes), over `modules`, writing `ledger`. */
export const kitCall = (modules: string[], ledger: string): JsonObject => ({ call: 'kit', modules, ledger });
/** An agent's deep_show call: a whole revision of `document`, its issues asked for, no pixels. */
export const show = (document: JsonObject, id: string): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: id, document, include: ['issues'] });
/** #855's evaluation: clean, at 0.5 s. */
export const evalClean = (id: string): JsonObject => ({ call: 'eval', doc: id, t: '0.5s', clean: true });

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

/** The `catalog` call's rows: each code with the module that catalogs it. */
export function catalogOf(reply: JsonObject): Map<string, string> {
  const out = new Map<string, string>();
  arr(reply['codes'], 'catalog: codes').forEach((v, i) => {
    const row = obj(v, `catalog: codes[${i}]`);
    out.set(str(row['code'], `catalog: codes[${i}].code`), str(row['module'], `catalog: codes[${i}].module`));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The conformance kit (#138's `kit` call) and its ledger

export interface KitCase { case: string; verdict: string; fixture?: string; expected_codes?: string[]; raised_codes?: string[]; failure?: JsonObject; raw: JsonObject }
export interface KitPart { part: string; verdict: string; cases: KitCase[]; failures: JsonObject[] }
export interface KitModule { module: string; version: string; digest: string; verdict: string; parts: KitPart[]; failures: JsonObject[] }

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
  return {
    module, version: str(m!['version'], `kit: ${module}.version`), digest: str(m!['digest'], `kit: ${module}.digest`), verdict: str(m!['verdict'], `kit: ${module}.verdict`),
    parts, failures: arr(m!['failures'] ?? [], `kit: ${module}.failures`).filter(isObject),
  };
}

export const partOf = (m: KitModule, name: string): KitPart | undefined => m.parts.find((x) => x.part === name);

/** A module's failures, its own and its parts', the first `n`, as JSON text. */
export const failuresOf = (m: KitModule, n = 8): string =>
  [...m.failures, ...m.parts.flatMap((p) => p.failures)].slice(0, n).map((f) => JSON.stringify(f)).join(' ');

/** Whether a kit fixture name (`parity/<category>/<name>.<profile>`) is the fixture `name`, wherever it is filed. */
export const isFixture = (kitName: string | undefined, name: string): boolean =>
  typeof kitName === 'string' && new RegExp(`/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9_]+$`).test(kitName);

/** The committed ledger the release build embeds and seals by. */
export const LEDGER = join(REPO, 'crates', 'deep-show', 'kit-ledger.json');
export const readLedger = (path: string): JsonObject => obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);

// ---------------------------------------------------------------------------------------------------
// The codes #154 added to motion's catalog (register_score in crates/deep-canvas-motion/src/module.rs, as the issue
// lists them). Ten are raised by motion's own checks of a document at the base (the score rule and `sound_lock`), so
// motion is the surface that raises them and they stay in its catalog. The issue names two that no planted document
// can raise as the code stands: `score.far_from_sample` (deep-show's plan call and its library check of a shown
// score) and `score.check_unread` (raised nowhere); either may leave motion's catalog.

export const RAISED_BY_MOTION = [
  'score.bad_duration', 'score.bad_loop', 'score.bad_pitch', 'score.note_too_long', 'score.pad_too_low', 'score.time_unresolved',
  'score.unknown_instrument', 'score.unknown_preset', 'score.unknown_source', 'sound_lock.off_palette',
] as const;
export const MAY_LEAVE = ['score.far_from_sample', 'score.check_unread'] as const;
export const TWELVE: readonly string[] = [...RAISED_BY_MOTION, ...MAY_LEAVE].sort();

/** Core's catalog fixture whose time_order twin passes at the base (the issue's Core paragraph). */
export const PACK_MISSING = 'code-pack-missing';
