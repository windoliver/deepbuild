// Test-side tools for the #407 acceptance tests: `deep-show` built per Cargo feature set and driven by JSON lines
// (#393's `deep-show run`, with #403's claims, requirements and `verdict`, #371's patches through `deep show`); the
// films, staged pieces, looks and briefs the criteria describe, generated here so every file judges the same documents;
// reading the film audit's, the flicker check's and honest numbers' rows; and the checks each criterion's wrong
// programs must fail, each returning its failures as sentences naming what failed. Nothing here stands in for the film
// audit, the flicker check or the evaluation: every value a test compares comes from a binary, every expected value
// from the issue's text and the design. Parts are copied from #408's, #403's and #371's helpers, since suites don't
// import each other.

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
/** The checkout root (tests/acceptance/407 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/**
 * Each criterion's number and ID, which start its tests' names: `AC<n> #407.` and the first 8 hex digits of SHA-256 of
 * its checkbox text after `- [ ] `, trimmed, white space collapsed (scripts/proof-change.mjs, `criterionId`).
 */
export const AC = {
  1: 'AC1 #407.1d0942b2', 2: 'AC2 #407.ce50be00', 3: 'AC3 #407.2d08dfcb', 4: 'AC4 #407.b38e05f8', 5: 'AC5 #407.6f6541a9', 6: 'AC6 #407.64b30d68', 7: 'AC7 #407.0ee0ea87',
  8: 'AC8 #407.4b703bba', 9: 'AC9 #407.0c62af86', 10: 'AC10 #407.a3712df9', 11: 'AC11 #407.58086c02', 12: 'AC12 #407.f621d801', 13: 'AC13 #407.4f632f03', 14: 'AC14 #407.56eb7041',
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

// ---------------------------------------------------------------------------------------------------
// Time: replies carry times as integer flicks (Time and the flick), or as the time grammar's "<n>s".

export const FLICKS = 705_600_000;
/** A time value in seconds: an integer is flicks, a string `<n>s` is seconds; anything else is null. */
export function secondsOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v / FLICKS;
  const m = typeof v === 'string' ? /^(-?\d+(?:\.\d+)?)s$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : null;
}
/**
 * A duration in seconds (README: `need` and `held` are seconds): a number below 100,000 is seconds, a larger integer
 * is flicks, a string `<n>s` is seconds; anything else is null.
 */
export function durationOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(v) < 100_000 ? v : v / FLICKS;
  return secondsOf(v);
}
const sec = (s: number): string => `${Number(s.toFixed(6))}s`;

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` per Cargo feature set, copied out of target/ under its own name.

export interface Build { features: string[] }
export const FULL: Build = { features: ['full'] };
/** `full` with the test build of the film audit whose shortest reading hold is 2 s (README: The test build). */
export const HOLD_2S: Build = { features: ['full', 'test-hold-min-2s'] };
const nameOf = (b: Build): string => b.features.join('+');
export const cargoArgs = (b: Build): string[] => ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', b.features.join(',')];

/** Builds `b` and copies the binary into `dir`: the binary, or cargo's error. */
function buildInto(b: Build, dir: string): { bin: string; error: string } {
  const args = cargoArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-${nameOf(b).replace(/[^a-z0-9+.-]/g, '_')}`);
  copyFileSync(join(TARGET, 'debug', SHOW), bin);
  return { bin, error: '' };
}

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-407-bins-'));
    for (const b of builds) if (!made.has(nameOf(b))) made.set(nameOf(b), buildInto(b, dir));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b: Build): string => {
    const entry = made.get(nameOf(b));
    if (!entry) throw Error(`the file didn't list the build ${nameOf(b)} in useBuilds`);
    expect(entry.error, `the binary builds: cargo ${cargoArgs(b).join(' ')}`).toBe('');
    return entry.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-407-')); made.push(d); return d; };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** Puts bytes into an evidence store at their SHA-256, as the hub keeps them. */
function putStore(evidence: string, bytes: Buffer): void {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const calls = arr(scenario['calls'], 'the calls').length;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((x, i) => obj(x, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the claim's agent, the process table, one panel.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: films', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PANELS: JsonObject = { main: { rect: [0, 0, 1920, 1080] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB407D', n);
const claimId = (n: number): string => `claim:${ulid('01JB407C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB407Q', n)}`;
export const patchId = (n: number): string => ulid('01JB407P', n);

/** The film audit, the flicker check and honest numbers as a requirement's check input, every field at its default. */
export const AUDIT: JsonObject = { kind: 'film.audit' };
export const FLICKER: JsonObject = { kind: 'film.flicker' };
export const HONEST: JsonObject = { kind: 'honest_numbers' };

/**
 * A document a test judges: a name for messages, its document ID, the document (stored as revision 0, yours), the
 * check input of its claim's one requirement (the film audit unless given), the claim's brief when it has one, and the
 * bytes it needs in the evidence store (a look).
 */
export interface Film { name: string; doc: string; document: JsonObject; check?: JsonObject | null; brief?: JsonObject; stored?: Buffer[] }
export interface Extra { planted?: string; before?: JsonObject[]; after?: JsonObject[] }

/**
 * The scenario: each film stored on the panel (`docs[…].document`, opened as revision 0) and named by one claim of
 * alpha's, with the film's brief when it has one and one requirement holding its check input (none when `check` is
 * null, so the brief's own checks are the claim's only ones); the calls are `before`, one `verdict` per claim in the
 * films' order, then `after`.
 */
export function scenarioOf(evidence: string, films: readonly Film[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = {};
  const claims: JsonObject = {};
  films.forEach((f, i) => {
    for (const bytes of f.stored ?? []) putStore(evidence, bytes);
    docs[f.doc] = { panel: 'main', document: f.document };
    const requirements: JsonObject[] = f.check === null ? [] : [{ id: reqId(i + 1), check: f.check ?? AUDIT }];
    claims[claimId(i + 1)] = { session: ALPHA.id, deliverables: [f.doc], requirements, ...(f.brief ? { brief: f.brief } : {}) };
  });
  const calls: JsonObject[] = [...(extra.before ?? []), ...films.map((_, i) => ({ call: 'verdict', claim: claimId(i + 1) })), ...(extra.after ?? [])];
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, ...(extra.planted ? { planted: extra.planted } : {}), calls };
}

/** One issue on a row. */
export interface Issue { code: string; severity: string; raw: JsonObject }
/** A requirement's row in a verdict (#403's row, README: The rows). */
export interface Row { result: string; issues: Issue[]; blocked: JsonObject[]; raw: JsonObject }
/** A claim's verdict: its result and every row. */
export interface Verdict { result: string; rows: Row[]; raw: JsonObject }
function rowFrom(raw: JsonObject, what: string): Row {
  const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });
  const blocked = (Array.isArray(raw['blocked']) ? raw['blocked'] : []).filter(isObject);
  return { result: String(raw['result']), issues, blocked, raw };
}
export function verdictOf(reply: JsonObject, what: string): Verdict {
  const rows = (Array.isArray(reply['requirements']) ? reply['requirements'] : []).filter(isObject).map((r, i) => rowFrom(r, `${what}: requirements[${i}]`));
  return { result: String(reply['result']), rows, raw: reply };
}
/** What one judged film gives: its claim's verdict and its one requirement's row (absent when the verdict has none). */
export interface Judged { verdict: Verdict; row: Row | undefined }
/** The verdicts of a scenario's claims, by film name. */
export function judgedOf(replies: readonly JsonObject[], films: readonly Film[], before = 0): Record<string, Judged> {
  const out: Record<string, Judged> = {};
  films.forEach((f, i) => {
    const verdict = verdictOf(obj(replies[before + i], `the verdict on ${f.name}`), `the verdict on ${f.name}`);
    out[f.name] = { verdict, row: verdict.rows.find((r) => r.raw['id'] === reqId(i + 1)) };
  });
  return out;
}
/** Judges each film on this machine: each film's verdict and row, by name, and every reply. */
export function judge(bin: string, evidence: string, films: readonly Film[], extra: Extra = {}): { judged: Record<string, Judged>; replies: JsonObject[] } {
  const replies = run(bin, scenarioOf(evidence, films, extra));
  return { judged: judgedOf(replies, films, extra.before?.length ?? 0), replies };
}

// ---------------------------------------------------------------------------------------------------
// Reading issues (README: The rows)

/** A field: on the issue itself, else in its `actual`. */
export function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
/** Whether a value names item `id`: its ID, or a sub-address `<id>#<part>` of it. */
export const namesItem = (v: JsonValue | undefined, id: string): boolean => typeof v === 'string' && (v === id || v.startsWith(`${id}#`));
/** Every string in a value, deep. */
const strings = (v: JsonValue | undefined): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : [];
/** Whether an issue (or a blocked entry) names item `id` anywhere but its prose: in `ids`, a field, or `actual`. */
export function mentions(issue: JsonObject, id: string): boolean {
  const { what: _what, fix: _fix, ...rest } = issue;
  return strings(rest).some((s) => namesItem(s, id));
}
/** Whether an issue names script line `id`: its `line` field, its `ids`, or a path under `script/lines/<id>`. */
export function namesLine(issue: JsonObject, id: string): boolean {
  if (field(issue, 'line') === id) return true;
  if (Array.isArray(issue['ids']) && issue['ids'].includes(id)) return true;
  const path = issue['path'];
  return typeof path === 'string' && new RegExp(`(^|/)lines/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`).test(path);
}
/** Whether an issue names a caption of line `id`: the line, or a caption `<id>.<n>`. */
export function namesCaption(issue: JsonObject, id: string): boolean {
  const { what: _what, fix: _fix, ...rest } = issue;
  return namesLine(issue, id) || strings(rest).some((s) => s === id || new RegExp(`^${id}\\.\\d+$`).test(s));
}
const timeOf = (issue: JsonObject): number | null => secondsOf(field(issue, 't'));
const shownT = (issue: JsonObject): string => { const t = timeOf(issue); return t === null ? brief(field(issue, 't')) : `${Number(t.toFixed(4))} s`; };
const rowLine = (row: Row): string => `${row.result} ${brief(row.issues.map((i) => i.raw), 1200)}${row.blocked.length ? ` blocked ${brief(row.blocked, 400)}` : ''}`;

/** The row PASSes, and no error or warning is raised. */
export function passFailures(row: Row | undefined, what: string): string[] {
  if (!row) return [`${what} has no row in the verdict`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${rowLine(row)}`);
  const raised = row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  if (raised.length) failures.push(`${what} raises ${raised.map((i) => i.code).join(', ')}: ${brief(raised.map((i) => i.raw))}`);
  return failures;
}

/** What a failing issue must show: the subject it names, and optionally its frame (with a tolerance) and fields. */
export interface Expect {
  /** Names the subject. */
  match: (issue: JsonObject) => boolean;
  /** The subject, for messages. */
  subject: string;
  /** The frame it names, in seconds, and how far off it may be (default half a frame at 60 fps). */
  t?: number; within?: number;
  /** Or a range of frames it may name, in seconds. */
  tIn?: [number, number];
  /** More conditions, each a failure sentence when broken (null when held). */
  also?: (issue: JsonObject) => string | null;
}
/**
 * The row FAILs and raises an error of exactly `code` that names the subject (and its frame, fields), as the
 * criteria's "fails, naming …". Each failure names the subject.
 */
export function failsWith(row: Row | undefined, code: string, e: Expect, what: string): string[] {
  if (!row) return [`${what} has no row in the verdict, so nothing names ${e.subject}`];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${rowLine(row)}`);
  const hits = row.issues.filter((i) => i.code === code && e.match(i.raw));
  if (!hits.length) {
    failures.push(`no ${code} issue names ${e.subject} on ${what}: ${brief(row.issues.map((i) => i.raw))}`);
    return failures;
  }
  const errs = hits.filter((i) => i.severity === 'error');
  if (!errs.length) failures.push(`the ${code} naming ${e.subject} on ${what} is a ${hits[0]!.severity}, not an error`);
  const atT = (i: JsonObject): boolean => {
    const t = timeOf(i);
    if (e.t !== undefined && (t === null || Math.abs(t - e.t) > (e.within ?? 1 / 120))) return false;
    return !(e.tIn && (t === null || t < e.tIn[0] - 1e-9 || t > e.tIn[1] + 1e-9));
  };
  const candidates = (errs.length ? errs : hits).map((i) => i.raw);
  if (!candidates.some((i) => atT(i) && (!e.also || e.also(i) === null))) {
    const i = candidates.find(atT) ?? candidates[0]!;
    if (!atT(i)) failures.push(`the ${code} naming ${e.subject} on ${what} names the frame t = ${shownT(i)}, not ${e.t !== undefined ? `${e.t} s` : `one in [${e.tIn![0]}, ${e.tIn![1]}] s`}`);
    const more = e.also?.(i);
    if (more) failures.push(`the ${code} naming ${e.subject} on ${what}: ${more}`);
  }
  return failures;
}
/** No issue of `code` (any severity) on the row matches `match`. */
export function noneOf(row: Row | undefined, code: string, match: (issue: JsonObject) => boolean, subject: string, what: string): string[] {
  if (!row) return [`${what} has no row in the verdict`];
  const hits = row.issues.filter((i) => i.code === code && match(i.raw));
  return hits.length ? [`${what} raises ${code} naming ${subject}: ${brief(hits.map((i) => i.raw))}`] : [];
}

/** The row FAILs with an error, of a code the issue leaves open, that names `subject` by `match`. */
export function errorNaming(row: Row | undefined, match: (issue: JsonObject) => boolean, subject: string, what: string): string[] {
  if (!row) return [`${what} has no row in the verdict, so nothing names ${subject}`];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${rowLine(row)}`);
  if (!row.issues.some((i) => i.severity === 'error' && match(i.raw))) failures.push(`no error names ${subject} on ${what}: ${brief(row.issues.map((i) => i.raw))}`);
  return failures;
}
/** The reading-hold code (README: The codes). */
export const HOLD = 'film.hold_short';
/** A film.hold_short naming `item` in `rendition` (any rendition when null), with `need` within 0.005 s when given. */
export function holdShort(row: Row | undefined, item: string, o: { need?: number; t?: number; tIn?: [number, number]; rendition?: string; heldZero?: boolean }, what: string): string[] {
  return failsWith(row, HOLD, {
    subject: `${item}${o.rendition ? ` in the ${o.rendition} rendition` : ''}`,
    match: (i) => mentions(i, item) && (!o.rendition || field(i, 'rendition') === o.rendition),
    ...(o.t !== undefined ? { t: o.t } : {}), ...(o.tIn ? { tIn: o.tIn } : {}),
    also: (i) => {
      const need = durationOf(field(i, 'need'));
      if (o.need !== undefined && (need === null || Math.abs(need - o.need) > 0.005)) return `its need is ${brief(field(i, 'need'))}, not ${o.need} s`;
      const held = durationOf(field(i, 'held'));
      if (o.heldZero && (held === null || Math.abs(held) > 1e-6)) return `its held is ${brief(field(i, 'held'))}, not 0: the hold started`;
      return null;
    },
  }, what);
}
/** No film.hold_short names `item` (in `rendition`, or in any when null). */
export function noHoldShort(row: Row | undefined, item: string, what: string, rendition: string | null = null): string[] {
  return noneOf(row, HOLD, (i) => mentions(i, item) && (rendition === null || field(i, 'rendition') === rendition), `${item}${rendition ? ` in the ${rendition} rendition` : ''}`, what);
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: The films). 1920 × 1080 u films with the default safe area of 24 u, at 60 frames a second, so 1 u
// is 1 px; flicker films are 640 × 360 u at 24 frames a second. Every film is stored with one layer of yours.

export const SIZE: [number, number] = [1920, 1080];
const LAYER = 'you-main';
export const order = (i: number): string => `a${String(i).padStart(4, '0')}`;

export interface FilmOptions {
  span: number; fps?: number; size?: [number, number]; markers?: JsonObject; channels?: JsonObject; shots?: JsonObject;
  transitions?: JsonObject; camera?: boolean; data?: JsonObject; locale?: string; script?: JsonObject; look?: { id: string; sha: string };
}
/** A film: the items in their draw order, with its markers, channels, shots and the rest. */
export function film(doc: string, title: string, items: JsonObject[], o: FilmOptions): JsonObject {
  const size = o.size ?? SIZE;
  const all = o.camera ? [camera2d(size), ...items] : items;
  return {
    format: 1, id: doc, profile: 'film', title, description: `${title}: a film the #407 acceptance tests judge.`.slice(0, 400),
    size, safe: 24, transport: { frame_rate: `${o.fps ?? 60}/1`, span: sec(o.span), reduced_motion: 'hold' },
    ...(o.locale ? { locale: o.locale } : {}),
    ...(o.camera ? { camera: 'cam' } : {}),
    ...(o.look ? { look: { asset: `${o.look.id}@1`, theme: 'light' }, assets: { [o.look.id]: { sha256: o.look.sha, license: LICENSE } } } : {}),
    ...(o.data ? { data: o.data } : {}),
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(all.map((i) => [String(i['id']), { ...i, layer: LAYER }])),
    ...(o.markers ? { markers: o.markers } : {}),
    ...(o.channels ? { channels: o.channels } : {}),
    ...(o.shots ? { shots: o.shots } : {}),
    ...(o.transitions ? { transitions: o.transitions } : {}),
    ...(o.script ? { script: o.script } : {}),
  };
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the #407 acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };

/** A text@1: `words` at `size` u, centred in a box `w` × `h` u at (x, y), with `extra` params. */
export function text(id: string, words: string, k: number, at: [number, number], o: { size?: number; w?: number; h?: number; align?: string } = {}, extra: JsonObject = {}): JsonObject {
  return {
    id, kind: 'text@1', name: `Text ${id}`, order: order(k),
    params: { text: words, font: 'body', size: o.size ?? 72, box: { w: o.w ?? 1600, h: o.h ?? 120 }, align: o.align ?? 'center', ...extra },
    at: { pos: [at[0], at[1], 0] },
  };
}
/** A filled rect@1 in `role`, its box [x, y, w, h] in u. */
export function rect(id: string, box: [number, number, number, number], role: string, k: number): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role } } } };
}
/** The kettle: a shape every text film shows beside its text, so no text is its shot's only subject. */
export const kettle = (k = 0): JsonObject => rect('kettle', [120, 780, 240, 200], 'muted', k);
/** A 2D camera@1 over the whole page, y down. */
export function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a00cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A shot `[start, end)` on the camera, framing the whole page, with the rest of its fields. */
export function shot(start: number, end: number, fields: JsonObject = {}): JsonObject {
  return { start: sec(start), end: sec(end), camera: 'cam', move: 'hold', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0], ...fields };
}
/** A channel whose keys hold: each value from its time until the next key's. */
export function holdKeys(target: string, type: string, keys: [number, JsonValue][]): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map(([t, value], i) => [`k${String(i).padStart(3, '0')}`, { t: sec(t), value, interp: 'hold' }])) };
}
/** Shown only over `[from, to)`: its `adjust.opacity` held at 0, then 1 from `from`, then 0 from `to`. */
export const shownOver = (id: string, from: number, to: number): JsonObject =>
  holdKeys(`items/${id}/adjust/opacity`, 'f32', [[0, from <= 0 ? 1 : 0], ...(from > 0 ? [[from, 1] as [number, JsonValue]] : []), [to, 0]]);
/** Markers `[id, kind, t s, span s]`. */
export function markers(list: [string, string, number, number][]): JsonObject {
  return Object.fromEntries(list.map(([id, kind, t, span]) => [id, { kind, name: `${kind} ${id}`, t: sec(t), ...(span ? { span: sec(span) } : {}) }]));
}

// ---- The reading-hold rule's numbers (Film audit: hold): need = max(1.5, or 4 for a title card, 1.5 + CJK ÷ 4.5 + other ÷ 15)

export const KETTLE = 'THE KETTLE SINGS';
export const STEAM = 'Steam lifts the lid.';
export const CJK = '水开了，壶在唱歌。';
/** The issue's own numbers. */
export const NEED = { kettle: 2.43, steam: 2.63, cjk: 3.19, card: 4 } as const;
/** The criterion's numbers by the design's rule, so the fixtures' holds sit 5 to 7 frames either side of them. */
export function needOf(words: string, titleCard = false): number {
  const g = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(words)].map((s) => s.segment).filter((s) => !/^\s+$/u.test(s));
  const cjk = g.filter((s) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s)).length;
  return Math.max(1.5, titleCard ? 4 : 0, 1.5 + cjk / 4.5 + (g.length - cjk) / 15);
}

/** A hold of `held` s from `from`, of `words` (one text item `id`, with the kettle beside it): ends on a 0.05 s grid. */
export function holdFilm(doc: string, id: string, words: string, from: number, held: number): JsonObject {
  return film(doc, `${id} held ${held} s`, [kettle(0), text(id, words, 1, [160, 420])], { span: from + held + 1, channels: { show: shownOver(id, from, from + held) } });
}
/** The title card: `words` the only subject of its one shot, shown `[from, from + held)`; past the frame's left edge when `cut`. */
export function titleCardFilm(doc: string, words: string, from: number, held: number, cut = false): JsonObject {
  const title = cut
    ? text('title', words, 1, [-60, 420], { size: 120, w: 900, h: 160, align: 'start' })
    : text('title', words, 1, [160, 420], { size: 120, h: 160 });
  return film(doc, `Title card held ${held} s${cut ? ', cut by the frame' : ''}`, [title], {
    span: from + held + 1, camera: true, shots: { card: shot(0, from + held + 1, { frame: { keep: ['title'] } }) },
    channels: { show: shownOver('title', from, from + held) },
  });
}
/** "THE KETTLE SINGS" typed by a reveal from 1 s to 2 s (Text text@1: reveal), then held until `to`. */
export function typedFilm(doc: string, to: number): JsonObject {
  return film(doc, `Typed, held to ${to} s`, [kettle(0), text('typed', KETTLE, 1, [160, 420], {}, { reveal: { mode: 'fade', order: 'reading', progress: 0 } })], {
    span: to + 1,
    channels: {
      typing: { target: 'items/typed/params/reveal/progress', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '1s', value: 0, interp: 'linear' }, k2: { t: '2s', value: 1, interp: 'hold' } } },
      show: holdKeys('items/typed/adjust/opacity', 'f32', [[0, 1], [to, 0]]),
    },
  });
}

// ---- Criterion 8: a title card under a slow push, as made and under reduced motion

/**
 * "THE KETTLE SINGS", 96 u, the only subject of one shot `[0, 6.5)` whose camera pushes in 5% of the view width with
 * the shot's default ease, so its glyphs move under 0.3 px a frame; shown from 1 s to 6 s. Under reduced motion (the
 * document's `hold`), the push is a cut at its midpoint, 3.25 s, with a 200 ms dissolve (Transport), unless `essential`.
 */
export function pushFilm(doc: string, essential: boolean): JsonObject {
  return film(doc, essential ? 'A title under an essential push' : 'A title under a slow push', [text('title', KETTLE, 1, [160, 460], { size: 96, h: 160 })], {
    span: 6.5, camera: true,
    shots: { push: shot(0, 6.5, { move: 'push', by: 0.05, frame: { keep: ['title'] }, ...(essential ? { essential: true } : {}) }) },
    channels: { show: shownOver('title', 1, 6) },
  });
}

// ---- Criterion 9: two words held 1.7 s each and a title with a typo

export const GO = 'word-go';
export const UP = 'word-up';
export const TYPO = 'title-typo';
/** "Go" over [1, 2.7) s and "Up" over [3, 4.7) s (each 1.7 s, needing 1.633 s by the shipped rule and 2 s by the test build's), and "The kettel sings" over [5, 8) s. */
export function carriedFilm(doc: string): JsonObject {
  return film(doc, 'Two short words and a title with a typo', [kettle(0), text(GO, 'Go', 1, [160, 160]), text(UP, 'Up', 2, [160, 400]), text(TYPO, 'The kettel sings', 3, [160, 640])], {
    span: 8.5, channels: { go: shownOver(GO, 1, 2.7), up: shownOver(UP, 3, 4.7), title: shownOver(TYPO, 5, 8) },
  });
}

// ---- Criterion 5: a brief's moments, reading holds and cues

/** What every brief here wants. */
export const GOAL = 'A kettle comes to the boil and sings';
/** The brief of criterion 5: two moments, three reading holds and two cues, and no sources. */
export const BRIEF: JsonObject = { goal: GOAL, moments: ['m-lid', 'm-steam'], holds: ['t-kettle', 't-steam', 't-cjk'], cues: ['c-boil', 'c-pour'] };
/** The brief's entries as `<kind>:<ID>`, in the order it lists them. */
export const BRIEF_ENTRIES = ['moment:m-lid', 'moment:m-steam', 'hold:t-kettle', 'hold:t-steam', 'hold:t-cjk', 'cue:c-boil', 'cue:c-pour'] as const;
/**
 * The render of the brief: the three texts held 0.17 to 0.21 s past their need, the cues `c-boil` (1 to 2 s) and
 * `c-pour` (4 to 5 s), the moments `m-lid` (2.5 s) and `m-steam` (5.5 s). `missing` leaves one out.
 */
export function briefFilm(doc: string, missing: 'none' | 'cue' | 'moment' | 'hold'): JsonObject {
  const items = [kettle(0), text('t-kettle', KETTLE, 1, [160, 160]), text('t-cjk', CJK, 3, [160, 640])];
  const channels: JsonObject = { kettle: shownOver('t-kettle', 1, 3.6), cjk: shownOver('t-cjk', 5, 8.4) };
  if (missing !== 'hold') { items.push(text('t-steam', STEAM, 2, [160, 400])); channels['steam'] = shownOver('t-steam', 3, 5.8); }
  const list: [string, string, number, number][] = [['c-boil', 'cue', 1, 1], ['m-lid', 'moment', 2.5, 0]];
  if (missing !== 'cue') list.push(['c-pour', 'cue', 4, 1]);
  if (missing !== 'moment') list.push(['m-steam', 'moment', 5.5, 0]);
  return film(doc, `The brief's render${missing === 'none' ? '' : `, missing a ${missing}`}`, items, { span: 9, markers: markers(list), channels });
}
/** A brief row's entry, `<kind>:<ID>`, from its `from` (README: The brief's checks); null for a row not from the brief. */
export function entryOf(row: Row): string | null {
  const from = row.raw['from'];
  if (!isObject(from)) return null;
  const kinds = ['moment', 'hold', 'cue'].filter((k) => typeof from[k] === 'string');
  return kinds.length === 1 ? `${kinds[0]}:${String(from[kinds[0]!])}` : `?:${brief(from, 200)}`;
}

// ---- Film audit codes chosen here (README: The codes)

export const LINE_LIMIT = 'film.line_limit';
export const BOUNDARY = 'film.boundary';
export const CURSOR = 'film.cursor_crossing';
export const UNSOURCED = 'number_unsourced';

// ---- Captions (Narration and captions; Loudness and caption profiles)

/** A script of `caption` lines (text shown and written to the sidecar, with no speech job). */
export function captionScript(lines: Record<string, { t: number; text: string; cites?: JsonValue }>, profile: string): JsonObject {
  return {
    lines: Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, { t: sec(l.t), text: l.text, kind: 'caption', ...(l.cites !== undefined ? { cites: l.cites } : {}) }])),
    captions: { profile, font: 'body', size: 48 },
  };
}
/** A film of one caption line `cap` at 1 s in `locale`, held to `profile`. */
export function captionFilm(doc: string, words: string, locale: string, profile: string): JsonObject {
  return film(doc, `A caption in ${locale}`, [kettle(0)], { span: 5, locale, script: captionScript({ cap: { t: 1, text: words } }, profile) });
}

// ---- Line limits: a headline's copies (Text text@1: `copy`, `max_lines`)

export const HEADLINE_EN = 'The kettle sings';
export const HEADLINE_DE_LONG = 'Der Wasserkessel singt laut und pfeift hell über dem alten Herd';
export const HEADLINE_DE_SHORT = 'Der Kessel singt';
/**
 * The headline: copy `headline` in en and de, 48 u in a 400 × 140 u box that doesn't grow, two lines at most, shown
 * from 1 s to 7 s in an en film. The long German copy needs four lines or more at any width of a body face's glyphs.
 */
export function headlineFilm(doc: string, de: string): JsonObject {
  const headline = { id: 'headline', kind: 'text@1', name: 'Headline', order: order(1), params: { copy: 'headline', font: 'body', size: 48, box: { w: 400, h: 140 }, autosize: 'none', max_lines: 2, align: 'center' }, at: { pos: [760, 300, 0] } };
  return film(doc, 'A headline in two locales', [kettle(0), headline], {
    span: 8, locale: 'en', data: { copy: { en: { headline: HEADLINE_EN }, de: { headline: de } } }, channels: { show: shownOver('headline', 1, 7) },
  });
}

// ---- Shot boundaries: the kettle carried across a cut at 3 s

/** Two shots `[0, 3)` and `[3, 6)` framing the same page and a cut that carries the kettle; with `jump`, it moves 300 u at the cut. */
export function boundaryFilm(doc: string, jump: boolean): JsonObject {
  const channels: JsonObject = jump ? { jump: holdKeys('items/kettle/at/pos', 'vec3', [[0, [0, 0, 0]], [3, [300, 0, 0]]]) } : {};
  return film(doc, jump ? 'The kettle jumps at the cut' : 'The kettle carried across the cut', [kettle(0)], {
    span: 6, camera: true, shots: { a: shot(0, 3), b: shot(3, 6) },
    transitions: { cut: { from: 'a', to: 'b', kind: 'cut', span: '0s', carry: ['kettle'] } }, channels,
  });
}

// ---- Cursor paths: "Stir" and "Pour", and a cursor that presses "Pour"

/** The cursor input (README: The check input): the cursor is the item `cursor`, and it presses `pour`. */
export const CURSOR_CHECK: JsonObject = { kind: 'film.audit', cursor_path: { item: 'cursor', presses: ['pour'] } };
/**
 * Texts "Stir" (box from x 605) and "Pour" (box from x 1305), 48 u, their boxes y 860 to 940 and their glyphs about y
 * 874 to 909, shown throughout; an 8 × 8 u cursor that ends on "Pour" at (1350, 885) at 3 s. `through`: it moves
 * along y = 885 from x 200 (1 s) to 1350 (3 s), 575 u a second, reaching "Stir" between 1.69 s (its box less the
 * cursor's 8 u) and 1.72 s (its first glyph); else it moves along y = 700 to x 1350 (2.5 s), then down onto "Pour".
 */
export function cursorFilm(doc: string, through: boolean): JsonObject {
  const keys: [number, number[]][] = through
    ? [[0, [200, 885, 0]], [1, [200, 885, 0]], [3, [1350, 885, 0]]]
    : [[0, [200, 700, 0]], [1, [200, 700, 0]], [2.5, [1350, 700, 0]], [3, [1350, 885, 0]]];
  const path = { target: 'items/cursor/at/pos', type: 'vec3', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: sec(t), value: v, interp: 'linear' }])) };
  return film(doc, through ? 'The cursor crosses Stir' : 'The cursor goes round Stir', [
    text('stir', 'Stir', 0, [605, 860], { size: 48, w: 200, h: 80, align: 'start' }),
    text('pour', 'Pour', 1, [1305, 860], { size: 48, w: 200, h: 80, align: 'start' }),
    { id: 'cursor', kind: 'rect@1', name: 'Cursor', order: order(2), params: { box: [0, 0, 8, 8], paint: { fill: { role: 'ink' } } }, at: { pos: keys[0]![1] } },
  ], { span: 4.5, channels: { path } });
}

// ---- Honest numbers in a film: a number shown from 2 s

/** "Boils in 4 min", from 2 s to 6 s: a story constant through a template, or a literal. */
export function numberFilm(doc: string, literal: boolean): JsonObject {
  const params = literal ? { text: 'Boils in 4 min' } : { template: 'Boils in {data/wait} min' };
  const item = { id: 'wait', kind: 'text@1', name: 'Wait', order: order(1), params: { ...params, font: 'body', size: 72, box: { w: 1600, h: 120 }, align: 'center' }, at: { pos: [160, 420, 0] } };
  return film(doc, literal ? 'A literal number' : 'A story number', [kettle(0), item], {
    span: 7, channels: { show: shownOver('wait', 2, 6) }, ...(literal ? {} : { data: { wait: { value: 4, source: 'story' } } }),
  });
}

// ---------------------------------------------------------------------------------------------------
// Flicker (Flicker check). Relative luminance of an sRGB gray, in linear light, and the looks whose roles hold them.

/** The relative luminance of the sRGB gray `v` (0 to 255): IEC 61966-2-1's decode, in linear light. */
export function luminance(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const hex = (v: number): string => `#${v.toString(16).padStart(2, '0').repeat(3)}`;
/** The grays: mid-grey low and high (a 0.15 swing), and a near-white sky. */
export const GRAY = { low: 124, high: 160, sky: 245 } as const;

/**
 * A look@1 on a drawing basis whose roles `ground`, `muted`, `accent` and `raised` are the given grays, with
 * `finish` (README: The looks). Built here, so every value is known; its bytes go into the evidence store.
 */
export function lookOf(id: string, grays: { ground: number; muted: number; accent: number; raised: number }, finish: JsonObject[] = []): { id: string; sha: string; bytes: Buffer } {
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: `The #407 acceptance look ${id}: flat grays whose relative luminance the tests know.`,
    palette: {
      ground: hex(grays.ground), muted: hex(grays.muted), accent: hex(grays.accent), raised: hex(grays.raised),
      graphite: '#1b1d22', snow: '#f2f3f5', night: '#0b0c0e', fog: '#e3e4e6',
      graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d2285', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
      orchid: '#b0207f', indigo: '#2c3e7b', cream: '#f4ecd8',
    },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled',
      hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo', paper: 'cream',
    },
    themes: { light: {}, dark: { roles: { ground: 'night', ink: 'snow' } } },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish,
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: sha256(bytes), bytes };
}

/** Flicker films' frame: 640 × 360 u at 24 frames a second. */
export const FLICKER_SIZE: [number, number] = [640, 360];
export const FLICKER_FPS = 24;
/**
 * The times a toggle flips at `hz` full cycles a second, from `from` to `to`: every 1 ÷ (2 hz) s, so 2 hz changes a
 * second (2 Hz: four changes, two flashes; 4 Hz: eight changes, four flashes).
 */
export function flips(hz: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = 0; from + k / (2 * hz) < to - 1e-9; k++) out.push(from + k / (2 * hz));
  return out;
}
/** `adjust.opacity` of `id`: `first` until the first flip, then the other value at each flip in turn. */
function toggled(id: string, first: 0 | 1, at: number[]): JsonObject {
  let v: number = first;
  const keys: [number, JsonValue][] = [[0, v]];
  for (const t of at) { v = 1 - v; keys.push([t, v]); }
  return holdKeys(`items/${id}/adjust/opacity`, 'f32', keys);
}
/** A flicker film under `look`: `items`, with `channels`, 6 s long. */
function flickerFilm(doc: string, title: string, look: { id: string; sha: string }, items: JsonObject[], channels: JsonObject, span = 6): JsonObject {
  return film(doc, title, items, { span, fps: FLICKER_FPS, size: FLICKER_SIZE, look, channels });
}
const GRAY_LOOK = (): ReturnType<typeof lookOf> => lookOf('gray-407', { ground: 255, muted: GRAY.low, accent: GRAY.high, raised: GRAY.sky });

/**
 * A mid-grey quarter of the frame (the top-left 320 × 180 u of 640 × 360) swinging 0.15 in relative luminance at
 * `hz` from 1 s to 5 s: the `muted` gray (sRGB 124) under an `accent` one (sRGB 160) shown and hidden at each flip.
 */
export function quarterFilm(doc: string, hz: number): { document: JsonObject; stored: Buffer[] } {
  const look = GRAY_LOOK();
  const box: [number, number, number, number] = [0, 0, 320, 180];
  return {
    document: flickerFilm(doc, `A mid-grey quarter at ${hz} Hz`, look, [rect('low', box, 'muted', 0), rect('high', box, 'accent', 1)], { swing: toggled('high', 1, flips(hz, 1, 5)) }),
    stored: [look.bytes],
  };
}
/** Each half of the frame (320 × 360 u) swinging 0.15 at `hz` from 1 s to 5 s, in counter-phase: one up as the other goes down. */
export function halvesFilm(doc: string, hz: number): { document: JsonObject; stored: Buffer[] } {
  const look = GRAY_LOOK();
  const left: [number, number, number, number] = [0, 0, 320, 360];
  const right: [number, number, number, number] = [320, 0, 320, 360];
  const at = flips(hz, 1, 5);
  return {
    document: flickerFilm(doc, `Two halves at ${hz} Hz in counter-phase`, look,
      [rect('left-low', left, 'muted', 0), rect('left-high', left, 'accent', 1), rect('right-low', right, 'muted', 2), rect('right-high', right, 'accent', 3)],
      { left: toggled('left-high', 1, at), right: toggled('right-high', 0, at) }),
    stored: [look.bytes],
  };
}
/** A near-white sky (sRGB 245) over the top third of the frame above a mid-grey hill, under a look whose finish wears the print ±5%. */
export function skyFilm(doc: string): { document: JsonObject; stored: Buffer[] } {
  const look = lookOf('wear-407', { ground: 255, muted: GRAY.low, accent: GRAY.high, raised: GRAY.sky }, [{ print_wear: { flicker: '5%' } }]);
  return {
    document: flickerFilm(doc, 'A worn print of a near-white sky', look, [rect('sky', [0, 0, 640, 120], 'raised', 0), rect('hill', [0, 120, 640, 240], 'muted', 1)], {}),
    stored: [look.bytes],
  };
}
/** The flicker check's code (README: The codes). */
export const FLASH = 'film.flash';

// ---------------------------------------------------------------------------------------------------
// Briefs, sources and cites (README: The brief)

export const SOURCE_ID = 'kettle-notes';
export const SOURCE_TEXT = 'The old kettle sits on the stove. Its water boils after a short wait. The path to the spring climbs 3.4 km. ' +
  'Steam lifts the lid at the boil. The kettle sings a high note. The tea is poured into cups.';
export const SOURCES: JsonObject[] = [{ id: SOURCE_ID, title: 'Kettle notes', text: SOURCE_TEXT }];
/** The six lines, each a sentence of the source quoted word for word; line n starts at 1 + 3(n − 1) s. */
export const LINES = [
  'The old kettle sits on the stove', 'Its water boils after a short wait', 'The path to the spring climbs 3.4 km',
  'Steam lifts the lid at the boil', 'The kettle sings a high note', 'The tea is poured into cups',
] as const;
export const lineId = (n: number): string => `l${n}`;
export const lineAt = (n: number): number => 1 + 3 * (n - 1);
const cite = (quote: string): JsonObject[] => [{ source: SOURCE_ID, quote }];
/** How a twin differs from the six-line script. */
export type ScriptTwin = 'none' | 'uncited' | 'empty' | 'quote' | 'number';
/**
 * The six-line script as `caption` lines in an en film: each line's text is its sentence with a full stop, citing the
 * sentence. `uncited`: line 4 has no `cites`; `empty`: line 4's `cites` is `[]`; `quote`: line 2's quote has one word
 * changed ("short" to "long"); `number`: line 3 says 3.2 km where its quote says 3.4 km.
 */
export function scriptFilm(doc: string, twin: ScriptTwin): JsonObject {
  const lines: Record<string, { t: number; text: string; cites?: JsonValue }> = {};
  LINES.forEach((s, i) => {
    const n = i + 1;
    let words: string = s;
    let cites: JsonValue | undefined = cite(s);
    if (twin === 'uncited' && n === 4) cites = undefined;
    if (twin === 'empty' && n === 4) cites = [];
    if (twin === 'quote' && n === 2) cites = cite(s.replace('short', 'long'));
    if (twin === 'number' && n === 3) words = s.replace('3.4', '3.2');
    lines[lineId(n)] = { t: lineAt(n), text: `${words}.`, ...(cites !== undefined ? { cites } : {}) };
  });
  return film(doc, `A six-line script (${twin})`, [kettle(0)], { span: 19, locale: 'en', script: captionScript(lines, 'netflix-en-adult') });
}
/** The staged piece's stage markers: stage-1 at 0 s, stage-2 at 4 s, stage-3 at 8 s (Marker: present mode). */
export const STAGES = markers([['stage-1', 'stage', 0, 0], ['stage-2', 'stage', 4, 0], ['stage-3', 'stage', 8, 0]]);
/**
 * A staged piece: the on-screen sentence `fact`, shown in stage 2 only (4 s to 8 s), citing the source. `uncited`: no
 * `cites`; `quote`: its quote has one word changed; `number`: it reads "The path to the spring climbs 3.2 km." citing
 * the 3.4 km sentence. Otherwise it reads "Steam lifts the lid at the boil."
 */
export function stagedPiece(doc: string, twin: Exclude<ScriptTwin, 'empty'>): JsonObject {
  const s = twin === 'number' ? LINES[2] : LINES[3];
  const words = twin === 'number' ? s.replace('3.4', '3.2') : s;
  const cites = twin === 'uncited' ? {} : { cites: cite(twin === 'quote' ? s.replace('boil', 'top') : s) };
  return film(doc, `A staged piece (${twin})`, [kettle(0), text('fact', `${words}.`, 1, [160, 420], { size: 64 }, cites)], {
    span: 10, markers: STAGES, channels: { show: shownOver('fact', 4, 8) },
  });
}
/** The claim check's codes (the issue's scope). */
export const UNCITED = 'film.uncited';
export const QUOTE_MISSING = 'film.quote_missing';
export const NUMBER_MISMATCH = 'film.number_mismatch';
export const CITE_CODES = [UNCITED, QUOTE_MISSING, NUMBER_MISMATCH] as const;
