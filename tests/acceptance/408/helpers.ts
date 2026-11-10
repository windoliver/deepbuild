// Test-side tools for the #408 acceptance tests: `deep-show` built per Cargo feature set (and, for criterion 5, in
// release and for Linux x86_64 in Docker) and driven by JSON lines (#393's `deep-show run`, with #403's claims,
// requirements and `verdict`); the films the criteria describe, generated here so every file judges the same
// documents; reading film.layout's issues off a requirement's row; and the checks the criteria's wrong programs must
// fail, each returning its failures as sentences that name what failed. Nothing here stands in for film.layout, the
// core's arrays or the evaluation: every value a test compares comes from a binary, every expected value from the
// issue's text and the design. Parts are copied from #403's, #494's and #532's helpers, since suites don't import
// each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/408 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#408.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = { 1: '#408.6a23d77a', 2: '#408.72c2e372', 3: '#408.78b2fa37', 4: '#408.022d8403', 5: '#408.5416e245' } as const;

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
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** JSON with every object's keys sorted, so two results compare by content. */
export function canonical(v: JsonValue | undefined): string {
  const sort = (x: JsonValue): JsonValue => Array.isArray(x) ? x.map(sort)
    : isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k]!)])) : x;
  return JSON.stringify(v === undefined ? null : sort(v));
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
/** A list of times in seconds, ascending as given; null when it isn't a list of times. */
export function timesOf(v: JsonValue | undefined): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(secondsOf);
  return out.every((t): t is number => t !== null) ? out : null;
}
export const sameTime = (a: number | null, s: number): boolean => a !== null && Math.abs(a - s) < 1e-6;
const sameTimes = (a: number[] | null, b: readonly number[]): boolean => a !== null && a.length === b.length && a.every((t, i) => sameTime(t, b[i]!));
const shownTimes = (ts: readonly number[] | null): string => (ts === null ? '(none)' : `[${ts.map((t) => `${t} s`).join(', ')}]`);

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` per Cargo feature set, copied out of target/ under its own name.

/** A feature set (the `full` build set, alone or with this suite's test feature), debug unless `release`. */
export interface Build { features: string[]; release?: boolean }
export const FULL: Build = { features: ['full'] };
/** `full` with the test canvas module `test.label` (README: The test canvas module). */
export const LABEL_BUILD: Build = { features: ['full', 'test-glyph-label'] };
export const RELEASE: Build = { features: ['full'], release: true };
const nameOf = (b: Build): string => `${b.features.join('+')}${b.release ? '-release' : ''}`;
export const cargoArgs = (b: Build): string[] =>
  ['build', '--locked', ...(b.release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', b.features.join(',')];

/** Builds `b` and copies the binary into `dir`: the binary, or cargo's error. */
export function buildInto(b: Build, dir: string): { bin: string; error: string } {
  const args = cargoArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-${nameOf(b).replace(/[^a-z0-9+.-]/g, '_')}`);
  copyFileSync(join(TARGET, b.release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '' };
}

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-408-bins-'));
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

/** Fresh folders for a test (evidence stores, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-408-')); made.push(d); return d; };
}

/** Puts bytes into an evidence store at their SHA-256, as the hub keeps them, and returns the hash. */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

interface Started { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
function answerOf(s: Started, calls: number, name: string): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  const lines = s.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(out['ok'], `${name} refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}
/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  return answerOf({ status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }, arr(scenario['calls'], 'the calls').length, `${SHOW} run`);
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the claim's agent, the process table, one panel the size of the films.

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
export const docId = (n: number): string => ulid('01JB408D', n);
const claimId = (n: number): string => `claim:${ulid('01JB408C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB408Q', n)}`;
export const patchId = (n: number): string => ulid('01JB408P', n);

/** A film a test judges: a name for messages, its document ID and the document, stored as revision 0. */
export interface Film { name: string; doc: string; document: JsonObject }
export interface Extra { planted?: string; before?: JsonObject[]; after?: JsonObject[] }

/**
 * The scenario: each film stored on the panel (`docs[…].document`, opened as revision 0) and named by one claim of
 * alpha's whose one requirement is the check input `{kind: "film.layout"}`; the calls are `before`, one `verdict` per
 * claim in the films' order, then `after`.
 */
export function scenarioOf(evidence: string, films: readonly Film[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = {};
  const claims: JsonObject = {};
  films.forEach((f, i) => {
    docs[f.doc] = { panel: 'main', document: f.document };
    claims[claimId(i + 1)] = { session: ALPHA.id, deliverables: [f.doc], requirements: [{ id: reqId(i + 1), check: { kind: 'film.layout' } }] };
  });
  const calls: JsonObject[] = [...(extra.before ?? []), ...films.map((_, i) => ({ call: 'verdict', claim: claimId(i + 1) })), ...(extra.after ?? [])];
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, ...(extra.planted ? { planted: extra.planted } : {}), calls };
}

/** One issue on a requirement's row. */
export interface Issue { code: string; severity: string; raw: JsonObject }
/** film.layout's requirement row in a verdict (#403's row, README: The verdict's row). */
export interface Row { result: string; issues: Issue[]; raw: JsonObject }
function rowOf(verdict: JsonObject, id: string, what: string): Row | undefined {
  const rows = Array.isArray(verdict['requirements']) ? verdict['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === id);
  if (!raw) return undefined;
  const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });
  return { result: String(raw['result']), issues, raw };
}
/** The rows of a scenario's verdicts, by film name. */
export function rowsOf(replies: readonly JsonObject[], films: readonly Film[], before = 0): Record<string, Row | undefined> {
  const out: Record<string, Row | undefined> = {};
  films.forEach((f, i) => { out[f.name] = rowOf(obj(replies[before + i], `the verdict on ${f.name}`), reqId(i + 1), `film.layout on ${f.name}`); });
  return out;
}
/** Judges each film on this machine: the verdicts' rows by film name, and every reply. */
export function judge(bin: string, evidence: string, films: readonly Film[], extra: Extra = {}): { rows: Record<string, Row | undefined>; replies: JsonObject[] } {
  const replies = run(bin, scenarioOf(evidence, films, extra));
  return { rows: rowsOf(replies, films, extra.before?.length ?? 0), replies };
}

// ---------------------------------------------------------------------------------------------------
// Reading film.layout's issues (README: The verdict's row)

/** A code's field: on the issue itself, else in its `actual`. */
export function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
/** Whether a field names item `id`: its ID, or a sub-address `<id>#<part>` of it. */
export const namesItem = (v: JsonValue | undefined, id: string): boolean => typeof v === 'string' && (v === id || v.startsWith(`${id}#`));
/** Whether an issue names item `id` anywhere: in `ids`, or in a field on it or in its `actual`. */
export function mentions(issue: JsonObject, id: string): boolean {
  const strings = (v: JsonValue | undefined): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : [];
  const { what: _what, fix: _fix, ...rest } = issue;
  return strings(rest).some((s) => namesItem(s, id));
}
/** A fix's patch ops: `fix_ops` (the base's field for a fix that is ops), or `fix` when it is a list. */
export function fixOps(issue: JsonObject): JsonObject[] | null {
  const ops = Array.isArray(issue['fix_ops']) ? issue['fix_ops'] : Array.isArray(issue['fix']) ? issue['fix'] : null;
  return ops && ops.length > 0 && ops.every(isObject) ? (ops as JsonObject[]) : null;
}
const of = (row: Row, code: string): Issue[] => row.issues.filter((i) => i.code === code);

/** The criteria's common shape: the row FAILs with exactly one issue of `code`, an error, matching `match`. Each failure names `subject`. */
function single(row: Row | undefined, code: string, match: (i: JsonObject) => boolean, subject: string): { failures: string[]; issue: JsonObject | null } {
  if (!row) return { failures: [`film.layout's requirement on the film with ${subject} has no row in the verdict`], issue: null };
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`film.layout on the film with ${subject} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const found = of(row, code);
  if (found.length !== 1) failures.push(`film.layout raises ${found.length} ${code} issues on the film with ${subject}, not one: ${brief(found.map((i) => i.raw))}`);
  const hit = found.find((i) => match(i.raw));
  if (!hit) {
    failures.push(`no ${code} issue names ${subject} as the criterion does: ${brief(row.issues.map((i) => i.raw))}`);
    return { failures, issue: null };
  }
  if (hit.severity !== 'error') failures.push(`the ${code} naming ${subject} is a ${hit.severity}, not an error`);
  return { failures, issue: hit.raw };
}
/** First seen at `t`, and seen at exactly `ts` when given (`t` and `ts`, each with every code). */
function timeFailures(issue: JsonObject, code: string, subject: string, t: number, ts: readonly number[] | null): string[] {
  const failures: string[] = [];
  const first = secondsOf(field(issue, 't'));
  if (!sameTime(first, t)) failures.push(`the ${code} naming ${subject} has t = ${first === null ? brief(field(issue, 't')) : `${first} s`}, not ${t} s`);
  if (ts) {
    const seen = timesOf(field(issue, 'ts'));
    if (!sameTimes(seen, ts)) failures.push(`the ${code} naming ${subject} lists ts = ${seen === null ? brief(field(issue, 'ts')) : shownTimes(seen)}, not every cue end it holds, ${shownTimes(ts)}`);
  }
  return failures;
}

/** layout.crossing {text, stroke}: one issue, naming `text` and `stroke`, first seen at `t` (and at exactly `ts`). */
export function crossingFailures(row: Row | undefined, text: string, stroke: string, t: number, ts: readonly number[] | null): string[] {
  const s = single(row, 'layout.crossing', (i) => namesItem(field(i, 'text'), text) && namesItem(field(i, 'stroke'), stroke), `the text ${text} crossed by ${stroke}`);
  return s.issue ? [...s.failures, ...timeFailures(s.issue, 'layout.crossing', text, t, ts)] : s.failures;
}
/** layout.overlap {a, b, share}: one issue, naming `a` and `b` in either order, its share within `tolerance` of `share`. */
export function overlapFailures(row: Row | undefined, a: string, b: string, share: number, tolerance: number): string[] {
  const pair = (i: JsonObject): boolean => (namesItem(field(i, 'a'), a) && namesItem(field(i, 'b'), b)) || (namesItem(field(i, 'a'), b) && namesItem(field(i, 'b'), a));
  const s = single(row, 'layout.overlap', pair, `the texts ${a} and ${b}`);
  if (!s.issue) return s.failures;
  const got = field(s.issue, 'share');
  if (typeof got !== 'number' || Math.abs(got - share) > tolerance) s.failures.push(`the layout.overlap of ${a} and ${b} has share ${brief(got)}, not ${share} ± ${tolerance}`);
  return s.failures;
}
/** layout.covered {text, by, share}: one issue, naming `text` and `by`, its share within `tolerance` of `share`. */
export function coveredFailures(row: Row | undefined, text: string, by: string, share: number, tolerance: number): string[] {
  const s = single(row, 'layout.covered', (i) => namesItem(field(i, 'text'), text) && namesItem(field(i, 'by'), by), `the text ${text} covered by ${by}`);
  if (!s.issue) return s.failures;
  const got = field(s.issue, 'share');
  if (typeof got !== 'number' || Math.abs(got - share) > tolerance) s.failures.push(`the layout.covered of ${text} by ${by} has share ${brief(got)}, not ${share} ± ${tolerance}`);
  return s.failures;
}
/**
 * layout.cut {item, sides: [{edge, by}]}: one issue naming `item`, past two different edges each by `by` u (within
 * 0.05 u), first seen at `t` and at exactly `ts`, with a fix as patch ops. Gives the issue's ops.
 */
export function cutFailures(row: Row | undefined, item: string, by: number, t: number, ts: readonly number[]): { failures: string[]; ops: JsonObject[] | null } {
  const s = single(row, 'layout.cut', (i) => namesItem(field(i, 'item'), item), `the item ${item} past the frame`);
  if (!s.issue) return { failures: s.failures, ops: null };
  const failures = [...s.failures, ...timeFailures(s.issue, 'layout.cut', item, t, ts)];
  const sides = field(s.issue, 'sides');
  const list = Array.isArray(sides) ? sides.filter(isObject) : [];
  const edges = new Set(list.map((x) => canonical(x['edge'])));
  if (list.length !== 2 || edges.size !== 2) failures.push(`the layout.cut of ${item} names ${brief(sides)} as its sides, not two different edges`);
  for (const x of list) {
    const got = x['by'];
    if (typeof got !== 'number' || Math.abs(got - by) > 0.05) failures.push(`the layout.cut of ${item} has ${brief(x)} as a side, not past it by ${by} u`);
  }
  const ops = fixOps(s.issue);
  if (!ops) failures.push(`the layout.cut of ${item} carries no fix as patch ops: fix ${brief(s.issue['fix'])}, fix_ops ${brief(s.issue['fix_ops'])}`);
  return { failures, ops };
}
/** The row PASSes, and no error or warning is raised. */
export function passFailures(row: Row | undefined, what: string): string[] {
  if (!row) return [`film.layout's requirement on ${what} has no row in the verdict`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`film.layout on ${what} is ${row.result}, not PASS`);
  const raised = row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  if (raised.length) failures.push(`film.layout on ${what} raises ${raised.map((i) => i.code).join(', ')}: ${brief(raised.map((i) => i.raw))}`);
  return failures;
}
/** A notice names `item`, and nothing worse does. */
export function noticeFailures(row: Row | undefined, item: string): string[] {
  if (!row) return [`film.layout's requirement on the film with ${item} has no row in the verdict`];
  const failures: string[] = [];
  if (!row.issues.some((i) => i.severity === 'notice' && mentions(i.raw, item))) failures.push(`no notice names ${item}: ${brief(row.issues.map((i) => i.raw))}`);
  const worse = row.issues.filter((i) => i.severity !== 'notice' && mentions(i.raw, item));
  if (worse.length) failures.push(`${item} is named by ${worse.map((i) => `${i.code} (${i.severity})`).join(', ')}, not only a notice`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: The films). Every film is 1920 × 1080 u with the default safe area, stored with one layer of
// yours; 1 u is 1 px at 1080p.

export const SIZE: [number, number] = [1920, 1080];
export const SAFE = 24;
const LAYER = 'you-main';
export const order = (i: number): string => `a${String(i).padStart(4, '0')}`;
const pos = (x: number, y: number): JsonObject => ({ pos: [x, y, 0] });
const seconds = (s: number): string => `${s}s`;

/** A film: the items in their draw order, its cue, hold and moment markers, and its other maps. */
export function film(doc: string, title: string, items: JsonObject[], o: { span: number; markers: JsonObject; channels?: JsonObject; transitions?: JsonObject; modules?: string[] }): JsonObject {
  const modules = o.modules ?? [];
  return {
    format: 1, id: doc, profile: 'film', title, description: `${title}: a film the #408 acceptance tests judge with film.layout.`,
    size: SIZE, safe: SAFE, transport: { span: seconds(o.span) },
    ...(modules.length ? { requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) } } : {}),
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: LAYER }])),
    markers: o.markers,
    ...(o.channels ? { channels: o.channels } : {}),
    ...(o.transitions ? { transitions: o.transitions } : {}),
  };
}
/** Markers `[id, kind, start s, span s]`: each one's end, start + span, is a cue end (Film layout: `at: cues`). */
export function markers(list: [string, 'cue' | 'hold', number, number][]): JsonObject {
  return Object.fromEntries(list.map(([id, kind, t, span]) => [id, { kind, name: `${kind} ${id}`, t: seconds(t), span: seconds(span) }]));
}
/** A vec3 channel on `target` whose keys hold: each value from its time until the next key's. */
export function holdChannel(target: string, keys: [number, number[]][]): JsonObject {
  return { target, type: 'vec3', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: seconds(t), value, interp: 'hold' }])) };
}
export function textItem(id: string, words: string, at: [number, number], box: { w: number; h: number }, size: number, k: number, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'text@1', name: `Text ${id}`, order: order(k), params: { text: words, font: 'body', size, box, align: 'center', ...extra }, at: pos(at[0], at[1]) };
}
export function rectItem(id: string, box: [number, number, number, number], k: number): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role: 'ink' } } } };
}
export function vectorItem(id: string, src: string, size: [number, number], at: [number, number], alt: string, k: number): JsonObject {
  return { id, kind: 'vector@1', name: `Formula ${id}`, order: order(k), params: { src, size, colors: { '#000000': 'ink' }, alt }, at: pos(at[0], at[1]) };
}
export function pathItem(id: string, d: string, width: number, k: number): JsonObject {
  return { id, kind: 'path@1', name: `Path ${id}`, order: order(k), params: { d, paint: { stroke: { role: 'ink', width } } } };
}
/** An SVG of `w` × `h` u holding one filled part `part` that fills its viewBox, so the part's box is the item's. */
export function blockSvg(w: number, h: number, part: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n  <path id="${part}" d="M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z" fill="#000000"/>\n</svg>\n`);
}

// ---- Criteria 1 and 4: an axis line through a label from 2.0 s to 3.5 s

export const AXIS = 'x-axis';
const SCALE = 'x-scale';
export const LABEL = 'speed-label';
export const PROBE = 'probe-label';
/** Cue ends 1, 2, 2.5 (a hold's), 3.5 and 4.5 s. */
const CROSS_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1], ['h1', 'hold', 2, 0.5], ['c3', 'cue', 2.5, 1], ['c4', 'cue', 3.5, 1]]);
export const CROSS_FIRST = 1;
/** The cue ends at which the axis line passes through the label. */
export const CROSS_TIMES = [2, 2.5, 3.5] as const;
const scaleItem = (range: [number, number], k: number): JsonObject =>
  ({ id: SCALE, kind: 'scale@1', name: 'X scale', order: order(k), params: { domain: [0, 1], range, nice: false } });
const axisItem = (y: number, grid: boolean, k: number): JsonObject =>
  ({ id: AXIS, kind: 'axis@1', name: 'X axis', order: order(k), params: { scale: SCALE, side: 'bottom', ...(grid ? { grid: true } : {}) }, at: pos(0, y) });
/** The text@1 label "Speed", 32 u, centred in its 240 × 42 box at (616, 500); with `halo`, a 4 px halo in the paper's role. */
export const speedLabel = (halo: boolean, k = 2): JsonObject =>
  textItem(LABEL, 'Speed', [496, 479], { w: 240, h: 42 }, 32, k, halo ? { halo: [{ width: 4, role: 'ground' }] } : {});
/** The test canvas module's label: its glyph box `box`, 100 × 32 u centred at (616, 500). */
export const probeLabel = (k = 2): JsonObject =>
  ({ id: PROBE, kind: 'test.label@1', name: 'Probe label', order: order(k), params: { box: [566, 484, 100, 32], text: 'Speed' } });
/**
 * The axis@1 `x-axis` along y = 900 (its scale maps [0, 1] to x 100 to 1820), drawn first, and `label` over it; a
 * hold-keyed channel moves the axis's line to y = 500, through the label's middle, at 2.0 s and back at 3.75 s.
 */
export function crossingFilm(doc: string, label: JsonObject, modules: string[] = []): JsonObject {
  return film(doc, 'Axis through a label', [scaleItem([100, 1820], 0), axisItem(900, false, 1), label], {
    span: 4.5, markers: CROSS_CUES, modules,
    channels: { 'axis-in': holdChannel(`items/${AXIS}/at/pos`, [[0, [0, 900, 0]], [2, [0, 500, 0]], [3.75, [0, 900, 0]]]) },
  });
}
/**
 * The label over the first tick of an axis with grid lines, whose line lies along y = 536, 15 u under the label's box:
 * the tick's grid line runs up through the label's middle. The axis draws under the label, or over it with `over`.
 */
export function gridFilm(doc: string, over: boolean): JsonObject {
  return film(doc, over ? 'Grid line over a label' : 'Grid line under a label', [scaleItem([616, 1816], 0), axisItem(536, true, over ? 3 : 1), speedLabel(false)], {
    span: 4.5, markers: CROSS_CUES,
  });
}

// ---- Criterion 2: formulas that overlap, a match morph's two copies, and a rect over a text

/** Cue ends 1, 2.5 and 4 s; the morph's window is [2, 3] s. */
const FORMULA_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1.5], ['c3', 'cue', 2.5, 1.5]]);
export const FORMULA_A: [number, number] = [200, 100];
export const FORMULA_B: [number, number] = [300, 100];
/** Two formulas: A, 200 × 100 u at (400, 400), and B, 300 × 100 u at (x, 400); they share (600 − x) × 100 u², of A's 20,000. */
export function overlapFilm(doc: string, srcA: string, srcB: string, x: number): JsonObject {
  return film(doc, 'Two formulas side by side', [vectorItem('formula-a', srcA, FORMULA_A, [400, 400], 'a + b', 0), vectorItem('formula-b', srcB, FORMULA_B, [x, 400], 'c = d', 1)], {
    span: 4, markers: FORMULA_CUES, modules: ['vector'],
  });
}
/** One formula's two copies in one place, `morph-from` and `morph-to`; with `morph`, a match_morph from one to the other. */
export function morphFilm(doc: string, src: string, morph: boolean): JsonObject {
  return film(doc, morph ? 'A formula morphing in place' : 'Two copies of a formula in one place', [vectorItem('morph-from', src, FORMULA_A, [400, 400], 'x + y', 0), vectorItem('morph-to', src, FORMULA_A, [400, 400], 'x + y', 1)], {
    span: 4, markers: FORMULA_CUES, modules: ['vector'],
    ...(morph ? { transitions: { morph: { from: 'morph-from', to: 'morph-to', kind: 'match_morph', at: '2.5s', span: '1s', progress: 'linear', match_morph: {} } } } : {}),
  });
}
/**
 * The text@1 `cap` ("HHHHHHHH", 48 u, centred on x = 960 in its 600 × 63 box at (660, 300)) and an opaque ink rect
 * `veil` from x = 560 to 948, y = 250 to 420: it covers the text's whole height left of 12 u short of its centre, so 3
 * of the 7 columns of its 7 × 7 samples (21 of 49), drawn after the text, or first with `rectFirst`.
 */
export function coveredFilm(doc: string, rectFirst: boolean): JsonObject {
  const cap = textItem('cap', 'HHHHHHHH', [660, 300], { w: 600, h: 63 }, 48, rectFirst ? 1 : 0);
  const veil = rectItem('veil', [560, 250, 388, 170], rectFirst ? 0 : 1);
  return film(doc, rectFirst ? 'A rect under a text' : 'A rect over a text', rectFirst ? [veil, cap] : [cap, veil], { span: 4, markers: FORMULA_CUES });
}

// ---- Criterion 3: a title past both edges from 2 s to 3 s, and a plot leaving the frame

export const TITLE = 'title';
/** 182 u past the left and right edges: 1920 + 2 × 182 u wide. */
export const TITLE_SIZE: [number, number] = [2284, 200];
export const SAFE_WIDTH = SIZE[0] - 2 * SAFE;
/** Cue ends 1, 2, 3 and 4 s. */
const CUT_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1], ['c3', 'cue', 2, 1], ['c4', 'cue', 3, 1]]);
export const CUT_TIMES = [2, 3] as const;
/**
 * The title, a vector@1 whose one part fills its 2284 × 200 u box, at x = −182 (so 182 u past each side edge): a
 * hold-keyed channel keeps it above the frame (y = −1000, wholly out of it) until 2 s, at y = 300 from 2 s, and above
 * the frame again from 3.5 s, so it is in the frame at the cue ends 2 and 3 s only.
 */
export function cutFilm(doc: string, src: string): JsonObject {
  return film(doc, 'A title too wide for the frame', [vectorItem(TITLE, src, TITLE_SIZE, [-182, -1000], 'Motion', 0)], {
    span: 4, markers: CUT_CUES, modules: ['vector'],
    channels: { 'title-in': holdChannel(`items/${TITLE}/at/pos`, [[0, [-182, -1000, 0]], [2, [-182, 300, 0]], [3.5, [-182, -1000, 0]]]) },
  });
}
export const PLOT = 'plot';
/** An open path@1 plot from (200, 800) that leaves the frame past its right edge at (2200, 100). */
export function plotFilm(doc: string): JsonObject {
  return film(doc, 'A plot leaving the frame', [pathItem(PLOT, 'M 200 800 L 1000 500 L 2200 100', 3, 0)], {
    span: 2, markers: markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1]]),
  });
}
/** deep_query (#411, #1162) of an item's evaluated bounds at one time. */
export const boundsQuery = (doc: string, id: string, at: string): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, paths: [`items/${id}/bounds`], at: [at] });
/** `[x0, y0, x1, y1]` from deep_query's `items/<id>/bounds` value, `[[x0, y0, z], [x1, y1, z]]`. */
export function boundsOf(reply: JsonObject, id: string, what: string): [number, number, number, number] {
  const values = obj(reply['values'], `${what}: deep_query's values`);
  const box = arr(arr(values[`items/${id}/bounds`], `${what}: items/${id}/bounds`)[0], `${what}: the bounds`);
  const lo = arr(box[0], `${what}: bounds[0]`); const hi = arr(box[1], `${what}: bounds[1]`);
  const n = (v: JsonValue | undefined): number => { expect(typeof v === 'number', `${what}: a bound is a number, got ${brief(v)}`).toBe(true); return v as number; };
  return [n(lo[0]), n(lo[1]), n(hi[0]), n(hi[1])];
}
/** `deep show` from your shell applying `ops` as one patch on revision 0. */
export const fixPatch = (doc: string, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, patch: { patch: patchId(1), doc, base: 0, reason: "film.layout's fix for the title's layout.cut", ops } });

// ---- Criterion 5: 60 cue ends × 40 texts × 200 strokes of 64 segments

export const BIG = { cues: 60, texts: 40, strokes: 200, segments: 64 } as const;
/** Cue ends 0.1, 0.2, …, 6.0 s. */
export const BIG_CUE_ENDS: readonly number[] = Array.from({ length: BIG.cues }, (_, k) => (k + 1) / 10);
const fmt = (x: number): string => String(Number(x.toFixed(3)));
/**
 * 40 text@1 labels on an 8 × 5 grid (24 u, 160 × 32 u boxes, 220 u apart across and 200 down from (120, 100)); 200
 * open path@1 waves of 64 segments each, x 40 to 1880, y = 40 + 4i + 24 sin(2πx / 460 + 0.7i), children of the group
 * `waves`, which a linear channel moves down by 180 u over 6 s so no two cue ends are equal by evaluated data; and
 * 60 cues of 0.1 s, so cue ends every 0.1 s from 0.1 to 6.0 s. Every wave stays inside the frame.
 */
export function bigFilm(doc: string): JsonObject {
  const items: JsonObject[] = [{ id: 'waves', kind: 'group@1', name: 'Waves', order: order(0), params: {} }];
  for (let i = 0; i < BIG.strokes; i++) {
    const d = Array.from({ length: BIG.segments + 1 }, (_, j) => {
      const x = 40 + (j * 1840) / BIG.segments;
      return `${j ? 'L' : 'M'} ${fmt(x)} ${fmt(40 + 4 * i + 24 * Math.sin((2 * Math.PI * x) / 460 + 0.7 * i))}`;
    }).join(' ');
    items.push({ ...pathItem(`wave-${String(i).padStart(3, '0')}`, d, 1, 1 + i), parent: 'waves' });
  }
  for (let k = 0; k < BIG.texts; k++) {
    items.push(textItem(`text-${String(k).padStart(2, '0')}`, `Label ${k}`, [120 + 220 * (k % 8), 100 + 200 * Math.floor(k / 8)], { w: 160, h: 32 }, 24, 1 + BIG.strokes + k));
  }
  const cues: JsonObject = {};
  for (let k = 0; k < BIG.cues; k++) cues[`q${String(k).padStart(2, '0')}`] = { kind: 'cue', name: `Cue ${k}`, t: seconds(k / 10), span: '0.1s' };
  return film(doc, 'Waves through labels', items, {
    span: 6, markers: cues,
    channels: { drift: { target: 'items/waves/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [0, 0, 0], interp: 'linear' }, k1: { t: '6s', value: [0, 180, 0], interp: 'linear' } } } },
  });
}
/** Every cue end some issue of the row lists in its `ts`. */
export function cueEndsSeen(row: Row): number[] {
  const seen = row.issues.flatMap((i) => timesOf(field(i.raw, 'ts')) ?? []);
  return BIG_CUE_ENDS.filter((t) => seen.some((s) => sameTime(s, t)));
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: the checkout built for linux/amd64 in Docker with the rust image of rust-toolchain.toml's channel,
// its caches under target/acceptance-408-linux/, as #238's and #532's suites build theirs. Nothing is pulled.

const LINUX = join(TARGET, 'acceptance-408-linux');
export function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): Started {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, signal: null, timedOut, stdout: '', stderr: r.error.message };
  return { status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** Why Linux x86_64 can't run here (no Docker, or no linux/amd64 image), or null when it can. */
export function linuxMissing(): string | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) return `Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the Linux half runs in a linux/amd64 container`;
  const image = linuxImage();
  const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  const any = arch.status === 0 ? arch : docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (any.stdout.trim() !== 'amd64') return `Docker has no linux/amd64 image ${image} and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`;
  return null;
}
/** Builds `full` deep-show for linux/amd64: cargo's error, or ''. */
export function buildLinux(): string {
  const image = linuxImage();
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const r = docker([
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
    image, 'cargo', ...cargoArgs(FULL),
  ], undefined, 3 * 3_600_000);
  return r.status === 0 ? '' : `cargo ${cargoArgs(FULL).join(' ')} in ${image} (linux/amd64) failed${r.timedOut ? ' (timed out)' : ''}:\n${r.stderr.slice(-4000)}`;
}
/** One `deep-show run` process in a linux/amd64 container, the checkout read-only as its folder, `evidence` as its store. */
export function runLinux(scenario: JsonObject, evidence: string): JsonObject[] {
  const inside = { ...scenario, evidence: '/evidence' };
  const r = docker([
    'run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    '-w', '/src', linuxImage(), `/target/debug/${SHOW}`, 'run',
  ], `${JSON.stringify(inside)}\n`, 1_800_000);
  return answerOf(r, arr(scenario['calls'], 'the calls').length, `${SHOW} run on linux/amd64`);
}

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}

// ---------------------------------------------------------------------------------------------------
// Rust sources outside `skip` that hold `needle` (criterion 4: film.layout unchanged by the test module's kind).

export function rustNaming(needle: string, skip: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = relative(REPO, p);
      if (name === 'target' || name === 'node_modules' || skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.rs') && readFileSync(p, 'utf8').includes(needle)) found.push(rel);
    }
  };
  walk(join(REPO, 'crates'));
  return found;
}
