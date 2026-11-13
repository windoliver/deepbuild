// Test-side tools for the #1183 acceptance tests: `deep-show` built once and driven by JSON lines (#393's `deep-show
// run`, with #403's claims, requirements and `verdict`, and #1918's `eval` paths); the figures the criteria describe,
// with their logic programs written here as WebAssembly bytes, so every file judges the same documents; reading the
// honest-numbers row, its `lengths` record (README: The check record) and its issues; and the checks each criterion's
// wrong programs must fail, each returning its failures as sentences naming what failed. Nothing here stands in for the
// check or the evaluation: every value a test compares comes from the binary, every expected value from the issue's
// text and the design. Parts are copied from #407's and #1918's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1183 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/**
 * Each criterion's number and ID, which start its tests' names: `AC<n> #1183.` and the first 8 hex digits of SHA-256 of
 * its checkbox text after `- [ ] `, trimmed, white space collapsed (scripts/proof-change.mjs, `criterionId`).
 */
export const AC = {
  1: 'AC1 #1183.53c5a71a', 2: 'AC2 #1183.c8624e05', 3: 'AC3 #1183.2a50d207', 4: 'AC4 #1183.162053d0', 5: 'AC5 #1183.b941c395', 6: 'AC6 #1183.285af30a',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted program's check: it found something wrong, and a failure names each of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}
/** `actual` is within `rel` of `expected`, relative to `expected`. */
export const near = (actual: number, expected: number, rel: number): boolean => Math.abs(actual - expected) <= rel * Math.abs(expected);
/** The criteria's tolerance on a ratio and on a drawn length: 1e-6 relative. */
export const REL = 1e-6;

// ---------------------------------------------------------------------------------------------------
// Time: replies carry times as integer flicks (Time and the flick), or as the time grammar's "<n>s".

export const FLICKS = 705_600_000;
/** The figures' frame rate, and one frame in flicks. */
export const FPS = 60;
export const FRAME = FLICKS / FPS;
/** A time value in seconds: an integer is flicks, a string `<n>s` is seconds; anything else is null. */
export function secondsOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v / FLICKS;
  const m = typeof v === 'string' ? /^(-?\d+(?:\.\d+)?)s$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with the full set, copied out of target/ under its own name.

const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build has not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1183-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) made = { bin: '', error: `cargo could not run: ${r.error.message}` };
    else if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
    } else {
      const bin = join(dir, SHOW);
      copyFileSync(join(TARGET, 'debug', SHOW), bin);
      made = { bin, error: '' };
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1183-')); made.push(d); return d; };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** Puts bytes into an evidence store at their SHA-256, as the hub keeps them. */
function putStore(evidence: string, bytes: Uint8Array): void {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process on this machine: its stdout as written, and its replies, one per call. */
export function runRaw(bin: string, scenario: JsonObject): { stdout: string; replies: JsonObject[] } {
  const calls = arr(scenario['calls'], 'the calls').length;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((x, i) => obj(x, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls);
  return { stdout, replies };
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the claims' agent, the process table, one panel.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: figures', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 960, 540] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1183D', n);
const claimId = (n: number): string => `claim:${ulid('01JB1183C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB1183Q', n)}`;

/** Honest numbers as a requirement's check input, every field at its default (Check input; Honest numbers). */
export const HONEST: JsonObject = { kind: 'honest_numbers' };

/** A document a test judges: a name for messages, its document ID, the document and the bytes it needs in the evidence store. */
export interface Fig { name: string; doc: string; document: JsonObject; stored: Uint8Array[] }
export interface Extra { planted?: string; before?: JsonObject[]; shown?: string[] }

/**
 * The scenario: each figure stored on the panel (`docs[…].document`, opened as revision 0) and named by one claim of
 * alpha's with one requirement, honest numbers; the documents `shown` on the panel with no document, for a `deep_show`
 * to present; the calls are `before`, then one `verdict` per claim in the figures' order.
 */
export function scenarioOf(evidence: string, figs: readonly Fig[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = Object.fromEntries((extra.shown ?? []).map((d) => [d, { panel: 'main' }]));
  const claims: JsonObject = {};
  figs.forEach((f, i) => {
    for (const bytes of f.stored) putStore(evidence, bytes);
    docs[f.doc] = { panel: 'main', document: f.document };
    claims[claimId(i + 1)] = { session: ALPHA.id, deliverables: [f.doc], requirements: [{ id: reqId(i + 1), check: HONEST }] };
  });
  const calls: JsonObject[] = [...(extra.before ?? []), ...figs.map((_, i) => ({ call: 'verdict', claim: claimId(i + 1) }))];
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, ...(extra.planted ? { planted: extra.planted } : {}), calls };
}

/** One issue on a row. */
export interface Issue { code: string; severity: string; raw: JsonObject }
/** A requirement's row in a verdict (#403's row). */
export interface Row { result: string; issues: Issue[]; raw: JsonObject }
/** A claim's verdict: its result and its honest-numbers row. */
export interface Judged { result: string; row: Row | undefined; raw: JsonObject }
function rowFrom(raw: JsonObject, what: string): Row {
  const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });
  return { result: String(raw['result']), issues, raw };
}
/** The verdicts of a scenario's claims, by figure name. */
export function judgedOf(replies: readonly JsonObject[], figs: readonly Fig[], before = 0): Record<string, Judged> {
  const out: Record<string, Judged> = {};
  figs.forEach((f, i) => {
    const reply = obj(replies[before + i], `the verdict on ${f.name}`);
    const raw = (Array.isArray(reply['requirements']) ? reply['requirements'] : []).filter(isObject).find((r) => r['id'] === reqId(i + 1));
    out[f.name] = { result: String(reply['result']), row: raw ? rowFrom(raw, `the verdict on ${f.name}`) : undefined, raw: reply };
  });
  return out;
}
/** Judges each figure on this machine: each figure's verdict by name, every reply, and stdout as written. */
export function judge(bin: string, evidence: string, figs: readonly Fig[], extra: Extra = {}): { judged: Record<string, Judged>; replies: JsonObject[]; stdout: string } {
  const { stdout, replies } = runRaw(bin, scenarioOf(evidence, figs, extra));
  return { judged: judgedOf(replies, figs, extra.before?.length ?? 0), replies, stdout };
}

// ---------------------------------------------------------------------------------------------------
// Reading issues

/** A field: on the issue itself, else in its `actual`. */
export function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
/** Whether a value names item `id`: its ID, or a sub-address `<id>#<part>` of it. */
export const namesItem = (v: JsonValue | undefined, id: string): boolean => typeof v === 'string' && (v === id || v.startsWith(`${id}#`));
/** Every string in a value, deep. */
export const strings = (v: JsonValue | undefined): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : [];
/** Whether an issue names item `id` anywhere but its prose: in `ids`, a field, or `actual`. */
export function mentions(issue: JsonObject, id: string): boolean {
  const { what: _what, fix: _fix, ...rest } = issue;
  return strings(rest).some((s) => namesItem(s, id));
}
/** The numbers a field holds: one number, or each number of a list. */
export const numbersIn = (v: JsonValue | undefined): number[] => typeof v === 'number' ? [v] : Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
const rowLine = (row: Row): string => `${row.result} ${brief(row.issues.map((i) => i.raw), 1500)}`;

/** The row PASSes, and no error or warning is raised. */
export function passFailures(row: Row | undefined, what: string): string[] {
  if (!row) return [`${what} has no honest-numbers row in the verdict`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${rowLine(row)}`);
  const raised = row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  if (raised.length) failures.push(`${what} raises ${raised.map((i) => i.code).join(', ')}: ${brief(raised.map((i) => i.raw))}`);
  return failures;
}

/** What a failing issue must show: the subject it names, and optionally more conditions. */
export interface Expect {
  match: (issue: JsonObject) => boolean;
  subject: string;
  /** More conditions, each a failure sentence when broken (null when held). */
  also?: (issue: JsonObject) => string | null;
}
/** The row FAILs and raises an error of exactly `code` that names the subject and meets `also`. Each failure names the subject. */
export function failsWith(row: Row | undefined, code: string, e: Expect, what: string): string[] {
  if (!row) return [`${what} has no honest-numbers row in the verdict, so nothing names ${e.subject}`];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${rowLine(row)}`);
  const hits = row.issues.filter((i) => i.code === code && i.severity === 'error' && e.match(i.raw));
  if (!hits.length) {
    failures.push(`no ${code} error names ${e.subject} on ${what}: ${brief(row.issues.map((i) => i.raw))}`);
    return failures;
  }
  if (e.also && !hits.some((i) => e.also!(i.raw) === null)) failures.push(`the ${code} naming ${e.subject} on ${what}: ${e.also(hits[0]!.raw)}`);
  return failures;
}
/** The row FAILs with an error, of a code the issue leaves open, that names `subject` by `match`. */
export function errorNaming(row: Row | undefined, match: (issue: JsonObject) => boolean, subject: string, what: string): string[] {
  if (!row) return [`${what} has no honest-numbers row in the verdict, so nothing names ${subject}`];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${rowLine(row)}`);
  if (!row.issues.some((i) => i.severity === 'error' && match(i.raw))) failures.push(`no error names ${subject} on ${what}: ${brief(row.issues.map((i) => i.raw))}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The check record (README: The check record): the honest-numbers row's `lengths`, one entry per mapping.

/** A mapping's entry: `{mapping, item, result: pass | refused | unchecked, ratio}` and whatever else it holds. */
export interface Length { mapping: string; item: string; result: string; ratio: number | null; raw: JsonObject }
/** The row's `lengths` record, or null when it has none. */
export function lengthsOf(row: Row | undefined): Length[] | null {
  const list = row?.raw['lengths'];
  if (!Array.isArray(list)) return null;
  return list.filter(isObject).map((raw) => ({
    mapping: String(raw['mapping']), item: String(raw['item']), result: String(raw['result']),
    ratio: typeof raw['ratio'] === 'number' ? raw['ratio'] : null, raw,
  }));
}
/** Whether an entry's `mapping` names driver `id`: `drivers/<id>`, or the ID alone. */
export const namesDriver = (l: Length, id: string): boolean => l.mapping === `drivers/${id}` || l.mapping === id;
/**
 * The record holds an entry for driver `id`, on item `item`, whose `result` is `result`, and (when given) whose ratio
 * is `ratio` within 1e-6 relative.
 */
export function entryFailures(row: Row | undefined, id: string, item: string, result: string, ratio: number | null, what: string): string[] {
  const lengths = lengthsOf(row);
  if (lengths === null) return [`${what}: the honest-numbers row holds no \`lengths\` record: ${row ? brief(row.raw, 1200) : 'no row'}`];
  const entry = lengths.find((l) => namesDriver(l, id));
  if (!entry) return [`${what}: no entry of the \`lengths\` record names the mapping drivers/${id}: ${brief(lengths.map((l) => l.raw))}`];
  const failures: string[] = [];
  if (entry.item !== item) failures.push(`${what}: the entry for drivers/${id} names the item ${entry.item}, not ${item}`);
  if (entry.result !== result) failures.push(`${what}: the entry for drivers/${id} reads ${entry.result}, not ${result}: ${brief(entry.raw)}`);
  if (ratio !== null && (entry.ratio === null || !near(entry.ratio, ratio, REL))) failures.push(`${what}: the entry for drivers/${id} has ratio ${brief(entry.raw['ratio'])}, not ${ratio} within 1e-6 relative`);
  return failures;
}

/** The code a length mapped at a ratio the document doesn't declare raises (README: Codes). */
export const RATIO_UNDECLARED = 'length.ratio_undeclared';
/** The code a disclosure that isn't readable while its item is on screen raises (README: Codes). */
export const DISCLOSURE_HIDDEN = 'length.disclosure_hidden';
/** The refusal of a mapping: a length.ratio_undeclared naming `item`, with `ratio` and `expected` (each within 1e-6 relative). */
export function refusedWith(row: Row | undefined, item: string, ratio: number, expected: number, what: string): string[] {
  return failsWith(row, RATIO_UNDECLARED, {
    subject: item, match: (i) => mentions(i, item),
    also: (i) => {
      const r = numbersIn(field(i, 'ratio'));
      if (!r.some((x) => near(x, ratio, REL))) return `its ratio is ${brief(field(i, 'ratio'))}, not ${ratio}`;
      const e = numbersIn(field(i, 'expected'));
      if (!e.some((x) => near(x, expected, REL))) return `its expected ratio is ${brief(field(i, 'expected'))}, not ${expected}`;
      return null;
    },
  }, what);
}

// ---------------------------------------------------------------------------------------------------
// Logic programs, as WebAssembly bytes written here (README: Programs). Each exports `memory` (one page, its maximum
// equal to its minimum), `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` (0: no reads, so the
// read region holds only the step's seed) and `writes_at` (1024), and imports nothing. Its one write, an f64, is the
// write region's first 8 bytes, and every step writes it, so its value after step k is a function of k alone.

export const WRITES_AT = 1024;
function uleb(n: number): number[] {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n !== 0) b |= 0x80; out.push(b); } while (n !== 0);
  return out;
}
function sleb(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const label = (s: string): number[] => [...uleb(Buffer.byteLength(s)), ...Buffer.from(s, 'utf8')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const f64Const = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [0x44, ...b]; };
const funcBody = (code: number[]): number[] => { const b = [0x00, ...code, 0x0b]; return [...uleb(b.length), ...b]; };
/** A module whose `step(k)` runs `value` (code leaving one f64) and stores it at `writes_at`. */
function moduleOf(value: number[]): Uint8Array<ArrayBuffer> {
  const store = [0x41, ...sleb(WRITES_AT), ...value, 0x39, 0x03, 0x00]; // i32.const; …; f64.store align 8
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 1, 0x7e, 0]])), // one type: (i64) -> ()
    ...section(3, vec([[0], [0]])), // init, step
    ...section(5, vec([[0x01, 1, 1]])), // memory 1 page, max 1
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...label('memory'), 0x02, 0], [...label('init'), 0x00, 0], [...label('step'), 0x00, 1], [...label('reads_at'), 0x03, 0], [...label('writes_at'), 0x03, 1]])),
    ...section(10, vec([funcBody([]), funcBody(store)])),
  ]);
}
export interface Program { name: string; bytes: Uint8Array<ArrayBuffer>; sha: string }
const programOf = (name: string, bytes: Uint8Array<ArrayBuffer>): Program => ({ name, bytes, sha: sha256(bytes) });
/**
 * What a program writes at step `k`, run here on Node's own WebAssembly: the fixture's truth by construction, checked
 * before the binary judges it (the binary's own reading of a logic array at a frame isn't a surface `eval` returns).
 */
export function programOutput(p: Program, k: number): number {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(p.bytes), {});
  (instance.exports['init'] as (seed: bigint) => void)(0n);
  (instance.exports['step'] as (k: bigint) => void)(BigInt(k));
  return new DataView((instance.exports['memory'] as WebAssembly.Memory).buffer).getFloat64(WRITES_AT, true);
}
/** Writes `x` at every step. */
export const constantProgram = (name: string, x: number): Program => programOf(name, moduleOf(f64Const(x)));
/** Writes `high` at steps `from` ≤ k < `to`, else `low`: `select(high, low, k >= from && k < to)`. */
export function swingProgram(name: string, low: number, high: number, from: number, to: number): Program {
  return programOf(name, moduleOf([
    ...f64Const(high), ...f64Const(low),
    0x20, 0x00, 0x42, ...sleb(from), 0x59, // local.get k; i64.const from; i64.ge_s
    0x20, 0x00, 0x42, ...sleb(to), 0x53, // local.get k; i64.const to; i64.lt_s
    0x71, 0x1b, // i32.and; select
  ]));
}

// ---------------------------------------------------------------------------------------------------
// Figures (README: Fixtures). 3D, in metres, +Y up; 960 × 540 px at 60 frames a second; every item in one layer of
// yours. No title, name or description holds a digit, so honest numbers finds no number but the ones a test puts there.

const LAYER = 'you-main';
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };
export const SIZE: [number, number] = [960, 540];
const order = (i: number): string => `a${String(i).padStart(4, '0')}`;

/** A figure: its items in draw order, a camera first, and the envelope's other maps. */
function figure(doc: string, title: string, span: string, items: JsonObject[], programs: Program[], extra: JsonObject): JsonObject {
  return {
    format: 1, id: doc, profile: 'figure', title, description: `${title}, a figure the honest-numbers acceptance tests judge.`,
    size: SIZE, camera: 'cam', seed: 7, transport: { frame_rate: `${FPS}/1`, span },
    requires: { modules: { scene3d: '^1', motion: '^1', logic: '^1' } },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((item, k) => [String(item['id']), { name: String(item['id']), order: order(k), ...item, layer: LAYER }])),
    assets: Object.fromEntries(programs.map((p) => [p.name, { sha256: p.sha, license: LICENSE }])),
    ...extra,
  };
}
/** A perspective camera@1 orbiting `target` at `distance` m, 40° across the wider side, near 1 mm and far 10 m. */
const camera = (target: [number, number, number], distance: number): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', params: { projection: 'perspective', target, orbit: { azimuth: 0, elevation: 10, distance }, fov: 40, near: 0.001, far: 10 } });
/** A mark.box@1 centred on `pos`, a member of `assembly`. */
const box = (id: string, pos: [number, number, number], size: [number, number, number], role: string, assembly: string): JsonObject =>
  ({ id, kind: 'mark.box@1', parent: assembly, params: { size, paint: { fill: { role } } }, at: { pos } });
/** A logic item (Logic `logic@1`) at 60 steps a second with one f64 write `write`, its `unit` given or left out. */
const logic = (id: string, program: Program, write: string, unit: string | null): JsonObject =>
  ({ id, kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: [], writes: { [write]: { type: 'f64', ...(unit ? { unit } : {}) } } } });
/** An assembly at the origin that declares `shown_at` (drawn ÷ real). */
const assembly = (shownAt: number): JsonObject => ({ parent: null, at: { pos: [0, 0, 0] }, shown_at: shownAt });
/** A bool channel on `target` whose hold keys switch it at each frame given: `true` from 0, then alternately false and true. */
function toggles(target: string, frames: number[]): JsonObject {
  const keys: JsonObject = { k00: { t: '0f', value: true, interp: 'hold' } };
  frames.forEach((f, i) => { keys[`k${String(i + 1).padStart(2, '0')}`] = { t: `${f}f`, value: i % 2 === 1, interp: 'hold' }; });
  return { target, type: 'bool', keys };
}

// ---- The electron in a lamp's flex (criteria 1, 3 and 4)

/** The electron's drift, metres: about nine nanometres, and 1 mm over steps 180 to 239, which takes the dot off the frame. */
export const DRIFT = 8.8146e-9;
export const AWAY = 1e-3;
export const AWAY_FROM = 180;
export const AWAY_TO = 240;
/** The exaggeration the dot is drawn at, and the drawn offset it gives the drift: 200,000 × 8.8146e-9 m. */
export const FACTOR = 200_000;
export const DRAWN = FACTOR * DRIFT;
/** The disclosure's template (the issue's words), and the template typed with the factor in it. */
export const TEMPLATE = 'drawn {factor}× larger than real';
export const TYPED = 'drawn 200,000× larger than real';
/** The frames the disclosure hides on in the parity run: inside the dot's frames off screen, [180, 240). */
export const HIDE_OFF: [number, number] = [195, 225];
/** The planted disclosure's 10 frames hidden while the dot is on screen: from frame 90 (1.5 s). */
export const HIDE_ON: [number, number] = [90, 100];
export const electronProgram = (): Program => swingProgram('electron-drift', DRIFT, AWAY, AWAY_FROM, AWAY_TO);
/** How a twin of the electron figure differs from it. */
export type ElectronTwin = 'none' | 'undeclared' | 'hidden' | 'typed';
/**
 * The electron figure, 6 s: in assembly `flex` (`shown_at: 1`), a wire along x and the dot `dot`, whose x the driver
 * `swing` sets to 200,000 × `electron.drift` (a logic output in metres), with `exaggerate {factor: 200000, disclose:
 * disclosure}`; the overlay `disclosure` (overlay.text@1 in a corner, template "drawn {factor}× larger than real") shown
 * by the bool channel `blink` except over frames 195 to 224, while the dot is off the frame. Twins: `undeclared`, the
 * same driver with no `exaggerate` (and no disclosure); `hidden`, `blink` also false over frames 90 to 99, while the dot
 * is on screen; `typed`, the disclosure's template typed "drawn 200,000× larger than real".
 */
export function electronFigure(doc: string, twin: ElectronTwin): Fig {
  const program = electronProgram();
  const swing: JsonObject = { target: 'items/dot/at/pos/0', expr: '200000 * d', vars: { d: 'electron.drift' } };
  const items: JsonObject[] = [
    camera([0.001, 0, 0], 0.012),
    box('wire', [0.001, 0, 0], [0.006, 0.00005, 0.00005], 'muted', 'flex'),
    box('dot', [0, 0, 0], [0.0003, 0.0003, 0.0003], 'accent', 'flex'),
    logic('electron', program, 'drift', 'm'),
  ];
  const extra: JsonObject = { assemblies: { flex: assembly(1) }, drivers: { swing } };
  if (twin !== 'undeclared') {
    swing['exaggerate'] = { factor: FACTOR, disclose: 'disclosure' };
    items.push({ id: 'disclosure', kind: 'overlay.text@1', params: { anchor: 'corner', role: 'caption', template: twin === 'typed' ? TYPED : TEMPLATE, show: true } });
    const frames = twin === 'hidden' ? [...HIDE_ON, ...HIDE_OFF] : [...HIDE_OFF];
    extra['channels'] = { blink: toggles('items/disclosure/params/show', frames) };
  }
  return { name: `the electron figure (${twin})`, doc, document: figure(doc, 'An electron in a lamp flex', '6s', items, [program], extra), stored: [program.bytes] };
}

// ---- A wall socket drawn at a quarter of real size (criteria 2 and 6)

/** The plug's reach, metres, and the socket pop-up's scale. */
export const REACH = 0.4;
export const QUARTER = 0.25;
/** The driver `push`'s expressions: drawn at a quarter (0.1 m), at real size (0.4 m), and a quarter plus 5 cm. */
export const PUSH = { quarter: '0.25 * d', real: 'd', offset: '0.25 * d + 0.05' } as const;
/**
 * The socket pop-up, 2 s: in assembly `popup` (`shown_at: 0.25`), the socket and the plug `plug`, whose z the driver
 * `push` sets from `reach.depth` (a logic output in metres, 0.4 m at every step) by `expr`.
 */
export function socketFigure(doc: string, expr: string): Fig {
  const program = constantProgram('reach-depth', REACH);
  const items: JsonObject[] = [
    camera([0, 0, 0.05], 0.6),
    box('socket', [0, 0, 0], [0.08, 0.08, 0.01], 'muted', 'popup'),
    box('plug', [0, 0, 0], [0.04, 0.04, 0.05], 'accent', 'popup'),
    logic('reach', program, 'depth', 'm'),
  ];
  const extra = { assemblies: { popup: assembly(QUARTER) }, drivers: { push: { target: 'items/plug/at/pos/2', expr, vars: { d: 'reach.depth' } } } };
  return { name: `the socket pop-up (${expr})`, doc, document: figure(doc, 'A wall socket and its plug', '2s', items, [program], extra), stored: [program.bytes] };
}

// ---- A gauge whose needle reads a value with no unit (criterion 5)

/**
 * The gauge, 2 s: in assembly `gauge` (`shown_at: 1`), the dial and the needle `needle`, whose x the driver `sweep`
 * sets to 0.01 × `meter.reading`, a logic output (0.5 at every step) whose write declares no unit.
 */
export function gaugeFigure(doc: string): Fig {
  const program = constantProgram('meter-reading', 0.5);
  const items: JsonObject[] = [
    camera([0, 0, 0], 0.3),
    box('dial', [0, 0, 0], [0.1, 0.1, 0.005], 'muted', 'gauge'),
    box('needle', [0, 0, 0.005], [0.002, 0.04, 0.002], 'accent', 'gauge'),
    logic('meter', program, 'reading', null),
  ];
  const extra = { assemblies: { gauge: assembly(1) }, drivers: { sweep: { target: 'items/needle/at/pos/0', expr: '0.01 * r', vars: { r: 'meter.reading' } } } };
  return { name: 'the gauge (a reading with no unit)', doc, document: figure(doc, 'A gauge and its needle', '2s', items, [program], extra), stored: [program.bytes] };
}

// ---------------------------------------------------------------------------------------------------
// The agent's `deep_show` and `eval` (#393, #1918): the electron figure presented, then evaluated at a frame.

/** A document as a writer sends it: no `layers` and no item `layer`, which the hub stamps from the connection. */
export function strip(document: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete out['layers'];
  if (isObject(out['items'])) for (const item of Object.values(out['items'])) if (isObject(item)) delete item['layer'];
  return out;
}
/** Alpha's `deep_show` of a whole document, with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document: strip(document), include: ['issues'] });
/** `eval` of the live session at frame `frame` reading `paths` (#1918's `paths`). */
export const evalCall = (doc: string, frame: number, paths: string[]): JsonObject => ({ call: 'eval', doc, t: frame * FRAME, paths });
