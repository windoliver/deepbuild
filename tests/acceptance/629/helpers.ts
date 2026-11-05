// Test-side tools for the #629 acceptance tests (README: the surfaces, the fixtures and every stated choice). Node
// built-ins and vitest only. Every expected value is written here or in the tests from the issue and the design, never
// read from an implementation. Nothing here resolves a bound value or parses a tool's report: each is read from what
// `deep-show run`, `deep-canvas-render check` and `deep-replica` answer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rect = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/629 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const fixture = (name: string): string => join(FIXTURES, name);
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** A build's timeout: a first cargo build of either binary takes a while on a loaded machine. */
export const BUILD_TIMEOUT = 3_600_000;
export const TIMEOUT = 600_000;

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
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, before its tests, with `cargo build --locked --bin <bin>` in the
// checkout, and copies the binary out of target/debug; a test that uses a build that failed fails with cargo's error.

export type Bin = 'deep-show' | 'deep-canvas-render' | 'deep-replica';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

function cargoBuild(bin: Bin): string {
  const args = ['build', '--locked', '--bin', bin];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  const kept = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${kept.join('\n').slice(0, 4000)}`;
}

/** The binaries this file uses, built once before its tests. */
export function useBuilds(bins: Bin[]): (bin: Bin) => string {
  const made = new Map<Bin, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-629-bins-'));
    for (const bin of bins) {
      const error = cargoBuild(bin);
      const path = join(dir, exe(bin));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(bin)), path);
      made.set(bin, { path, error });
    }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin) => {
    const entry = made.get(bin);
    if (!entry) throw Error(`the file didn't list the build ${bin}`);
    expect(entry.error, `the binary builds: cargo build --locked --bin ${bin}`).toBe('');
    return entry.path;
  };
}

/** A fresh temporary folder per test (the evidence store, the copied reports), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-629-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Copies a fixture into the test's folder and answers the copy's path, so a test can delete it (the replay). */
export function copied(dir: string, name: string): string {
  const to = join(dir, name);
  copyFileSync(fixture(name), to);
  return to;
}

/** Pipes JSON lines into one run of `bin args…`: exit 0 and exactly one line out per line in, or the test fails. */
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  const label = `${bin.split('/').pop()} ${args.join(' ')}`;
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL',
  });
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${TIMEOUT} ms`);
  if (run.error) expect.fail(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0; stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`));
}

// ---------------------------------------------------------------------------------------------------
// The clock and the displays (#400's and #401's, unchanged)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
export const SEC = FLICKS;
export const LEAD = 2 * MS;
const CLOCK: JsonObject = { lead: LEAD, check: MS / 2 };
const DISPLAYS: JsonObject[] = [
  { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' },
  { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' },
];
const WINDOW: [number, number] = [1200, 700];
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: shop', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

// ---------------------------------------------------------------------------------------------------
// The runs (README: Fixtures). Each run's handle is a ULID; the assertion is the test the report names.

export const VITEST_RUN = 'run:01JB6290000000000000000001';
export const VITEST_PASSED_RUN = 'run:01JB6290000000000000000002';
export const PLAYWRIGHT_RUN = 'run:01JB6290000000000000000003';
export const PLAYWRIGHT_NA_RUN = 'run:01JB6290000000000000000004';
export const ASSERTION = 'cart total';
export const ulidOf = (handle: string): string => handle.slice('run:'.length);

/** When each run ended, on the scenario's clock: its as-of time. */
export const ENDED = 10 * SEC;
/** When the hub recorded the run, read from its report: 2 s after it ended, so an as-of stamped then is wrong. */
export const RECORDED_AT = 12 * SEC;
/** The frames the tests read: the panel's frame on screen at each of these. */
export const FRAMES_AT = [13 * SEC, 20 * SEC, 75 * SEC];

export type Tool = 'vitest' | 'playwright';
export interface RunCall { run: string; check: string; tool: Tool; report: string; ended: number; summary?: string }
/** `run`: the hub records a run that ended at `ended`, whose check's tool wrote `report` (README: The `run` call). */
export const runCall = (at: number, r: RunCall): JsonObject => ({ call: 'run', at, ...r });

// ---------------------------------------------------------------------------------------------------
// The panel (#401's plug-in install, with a bound value on a run handle)

/** A bound value's fields (Bound value), as an element of a panel's tree binds it. */
export interface Bind { source: string; select?: string; format?: JsonObject; missing?: string }
export interface BoundText { id: string; bind: Bind }
export const PANEL = 'cart';
const SLOT: Rect = [0, 0, 400, 350];

export type Planted = 'resolver_reads_summary' | 'unparsable_reads_zero';

export interface World {
  evidence: string;
  /** The panel's bound texts, each a `text` element of plug-in `cart-figure`'s panel `cart`. */
  bound: BoundText[];
  /** Runs recorded by this scenario's `run` calls. */
  runs?: { at: number; run: RunCall }[];
  /** A replay: the scenario starts from these record entries, as an earlier scenario's `run` replies gave them. */
  record?: JsonObject[];
  planted?: Planted;
}

/** One scenario: #401's world, the install at flick 1, the runs, then `drawn` at each frame time in `FRAMES_AT`. */
export function scenario(w: World): JsonObject {
  const install: JsonObject = {
    call: 'install', at: 1, plugin: 'cart-figure',
    manifest: { panels: { [PANEL]: { tree: [{ id: 'title', component: 'text', text: 'Cart total' }, ...w.bound.map((b) => ({ id: b.id, component: 'text', bind: b.bind as unknown as JsonObject }))] } } },
  };
  const runs = (w.runs ?? []).map((r) => runCall(r.at, r.run));
  const drawn = FRAMES_AT.map((t): JsonObject => ({ call: 'drawn', at: t, panel: PANEL }));
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK, displays: DISPLAYS, window: WINDOW,
    panels: { [PANEL]: { rect: SLOT } },
    ...(w.record ? { record: w.record } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls: [install, ...runs, ...drawn].sort((a, b) => num(a['at'], 'at') - num(b['at'], 'at')),
  };
}

const SURFACE = "#401's `install` and `drawn` calls with a bound value on `run:<id>#<assertion>`, the `run` call, the scenario's `record` (README: The surfaces under test)";

/** `deep-show run`: one scenario, answered ok with one reply per call, in call order; the install installs. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [s]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(s['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (isObject(c) && c['call'] === 'install') expect(replies[i]!['installed'], `${what}: the plug-in installs: ${JSON.stringify(replies[i]).slice(0, 600)}`).toBe(true);
  });
  return replies;
}

/** A run's record entry, as the `run` call's reply gives it (README: The `run` call). */
export interface Assertion { assertion: string; outcome: string; expected: string | null; received: string | null }
export interface Entry { raw: JsonObject; run: string; ended: number; assertions: Assertion[] }
export function entryOf(reply: JsonObject | undefined, what: string): Entry {
  const raw = obj(obj(reply, what)['recorded'], `${what}: recorded (the run's record entry)`);
  const nullable = (v: JsonValue | undefined, w: string): string | null => (v === null ? null : str(v, w));
  return {
    raw, run: str(raw['run'], `${what}: recorded.run`), ended: num(raw['ended'], `${what}: recorded.ended`),
    assertions: arr(raw['assertions'], `${what}: recorded.assertions`).map((v, i) => {
      const a = obj(v, `${what}: recorded.assertions[${i}]`);
      return {
        assertion: str(a['assertion'], `${what}: assertions[${i}].assertion`), outcome: str(a['outcome'], `${what}: assertions[${i}].outcome`),
        expected: nullable(a['expected'], `${what}: assertions[${i}].expected`), received: nullable(a['received'], `${what}: assertions[${i}].received`),
      };
    }),
  };
}

export interface Missing { cause: string; raw: JsonObject }
export interface Drawn { element: string; text: string; value: number | null; as_of: number | null; source: string; stale: boolean; missing: Missing | null }
/** A `drawn` reply: the frame on screen at `at` in the panel, and each bound element as that frame draws it. */
export function drawnOf(reply: JsonObject | undefined, what: string): { vsync: number; bound: Drawn[] } {
  const r = obj(reply, what);
  return {
    vsync: num(r['vsync'], `${what}: vsync`),
    bound: arr(r['bound'], `${what}: bound`).map((v, i) => {
      const b = obj(v, `${what}: bound[${i}]`);
      const m = b['missing'];
      const value = b['value'];
      expect(value === null || typeof value === 'number', `${what}: bound[${i}].value is a number or null, got ${JSON.stringify(value)}`).toBe(true);
      return {
        element: str(b['element'], `${what}: bound[${i}].element`), text: str(b['text'], `${what}: bound[${i}].text`),
        value: typeof value === 'number' ? value : null,
        as_of: b['as_of'] === null || b['as_of'] === undefined ? null : num(b['as_of'], `${what}: bound[${i}].as_of`),
        source: str(b['source'], `${what}: bound[${i}].source`), stale: b['stale'] === true,
        missing: m === null || m === undefined ? null : { cause: str(obj(m, `${what}: bound[${i}].missing`)['cause'], `${what}: bound[${i}].missing.cause`), raw: m as JsonObject },
      };
    }),
  };
}

/** The `drawn` replies of a scenario, in `FRAMES_AT` order. */
export function framesOf(s: JsonObject, replies: JsonObject[], what: string): { at: number; vsync: number; bound: Drawn[] }[] {
  const calls = arr(s['calls'], 'calls').map((c) => obj(c, 'call'));
  return calls.flatMap((c, i) => (c['call'] === 'drawn' ? [{ at: num(c['at'], 'at'), ...drawnOf(replies[i], `${what}: the panel's frame at ${num(c['at'], 'at') / SEC} s`) }] : []));
}
export const secs = (t: number | null): string => (t === null ? 'none' : `${t / SEC} s`);

// ---------------------------------------------------------------------------------------------------
// The criteria's check on a drawn bound value (README: Readings): what it must show, as failures naming it.

/** The numbers a text shows, as written (`18.01`, `18`, `18.00`; group separators kept). */
export const numbersIn = (text: string): string[] => text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];

export interface Want { element: string; source: string; shows: string; value: number; asOf: number; unit?: RegExp }
/**
 * A bound value that must show `shows` (the number as the report printed it), with `value`, the run as its source and
 * the run's end as its as-of time. Each failure names `bound value <element>`.
 */
export function showsValue(b: Drawn | undefined, want: Want, when: string): string[] {
  const name = `bound value ${want.element}`;
  if (!b) return [`${name}: not drawn ${when}`];
  const f: string[] = [];
  const nums = numbersIn(b.text);
  if (nums.length !== 1 || nums[0] !== want.shows) f.push(`${name}: ${when} its text ${JSON.stringify(b.text)} shows ${nums.length ? nums.join(', ') : 'no number'}, not ${want.shows} alone`);
  if (b.value === null || Math.abs(b.value - want.value) > 1e-9) f.push(`${name}: ${when} its value is ${b.value === null ? 'none' : b.value}, not ${want.value}, the value the run's report holds`);
  if (b.missing !== null) f.push(`${name}: ${when} it reads missing (${JSON.stringify(b.missing.raw)}) though the report holds ${want.shows}`);
  if (!b.source.startsWith(want.source)) f.push(`${name}: ${when} its source is ${JSON.stringify(b.source)}, not the run ${want.source}`);
  if (b.as_of !== want.asOf) f.push(`${name}: ${when} its as-of time is ${secs(b.as_of)}, not ${secs(want.asOf)}, the run's end`);
  if (b.stale) f.push(`${name}: ${when} it is drawn stale`);
  if (want.unit && !want.unit.test(b.text)) f.push(`${name}: ${when} its text ${JSON.stringify(b.text)} doesn't show its unit`);
  return f;
}

/** A bound value that must read missing with `not_reported`, naming the run and the assertion, and show no number. */
export function readsMissing(b: Drawn | undefined, element: string, run: string, when: string): string[] {
  const name = `bound value ${element}`;
  if (!b) return [`${name}: not drawn ${when}`];
  const f: string[] = [];
  if (b.missing === null) f.push(`${name}: ${when} it doesn't read missing; it shows ${JSON.stringify(b.text)} (value ${b.value})`);
  else {
    if (b.missing.cause !== 'not_reported') f.push(`${name}: ${when} it reads missing with cause ${JSON.stringify(b.missing.cause)}, not not_reported`);
    const said = JSON.stringify(b.missing.raw);
    if (!said.includes(ulidOf(run))) f.push(`${name}: ${when} its missing ${said} doesn't name the run ${run}`);
    if (!said.includes(ASSERTION)) f.push(`${name}: ${when} its missing ${said} doesn't name the assertion ${JSON.stringify(ASSERTION)}`);
  }
  // Never 0, and never any number: a missing value shows the dash (Bound value: `missing: dash`).
  if (b.value !== null) f.push(`${name}: ${when} it has the value ${b.value}, where nothing was reported`);
  if (numbersIn(b.text).length) f.push(`${name}: ${when} its text ${JSON.stringify(b.text)} shows a number, where nothing was reported`);
  return f;
}

export const find = (bound: Drawn[], element: string): Drawn | undefined => bound.find((b) => b.element === element);

// ---------------------------------------------------------------------------------------------------
// The document check: `deep-canvas-render check {doc, look: "clean"}` (#389's, #392's, #406's surface, unchanged).

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Checked { ok: boolean; issues: Issue[]; errors: Issue[]; raw: JsonObject }
export function checkedOf(value: JsonValue | undefined, what: string): Checked {
  const raw = obj(value, what);
  expect(typeof raw['ok'], `${what} answers ok: ${JSON.stringify(raw).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(raw['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
  return { ok: raw['ok'] === true, issues, errors: issues.filter((i) => i.severity === 'error'), raw };
}
export const shownErrors = (c: Checked): string => JSON.stringify(c.errors.map((e) => ({ code: e.code, ids: e.ids, path: e.raw['path'], actual: e.raw['actual'] }))).slice(0, 3000);

// ---------------------------------------------------------------------------------------------------
// Platforms (README: AC6)

/** Fails the test with a message that starts `INCONCLUSIVE:`; such a test never passes. */
export function inconclusive(why: string): never {
  expect.fail(`INCONCLUSIVE: ${why}`);
}
export function requireMac(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws the app headless at the reference window, which runs on macOS only; this is ${process.platform}`);
}
export const readJson = (path: string, what: string): JsonValue => {
  expect(existsSync(path), `${what} exists at ${path}`).toBe(true);
  try { return JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${what} is not JSON: ${(e as Error).message}`); }
};
