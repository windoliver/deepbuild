// Test-side tools for the #490 acceptance tests: `deep-show run` (#200's `registries`, #387's `eval`, #138's
// `corpus_record`, #306's packs, and this suite's `fn` and `path` calls) and `deep-motion eval` (#391's and #489's
// JSON lines, with this suite's `packs` and `bounds`), each built once per file; the merge base built apart (as
// #200's suite); the seeded generator the interval search shares with the binary; and the f64 reference math the
// expected values come from. Nothing here stands in for the core or motion: every value a test compares comes from
// a binary, every expected value from the issue's text computed here.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/490 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));
export const MOTION_NAME = 'deep-motion';
export const SHOW_NAME = 'deep-show';
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-show` on the shared Mac can take many minutes. */
export const TIMEOUT = 1_800_000;
/** A d1 digest as the registries listing writes one (#200). */
export const DIGEST = /^(d1:)?[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A time field as the time grammar's text, `"<s>s"`. */
export const at = (s: number): string => `${s}s`;

// ---------------------------------------------------------------------------------------------------
// The seeded generator (mulberry32). The interval search's points come from it, in the binary and here alike
// (README: the `fn` call's `search`), so a failing run replays and the tests can recompute any range's points.

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The `n` points of the search's range `i` = [a, b]: x_j = a + (b − a)·u_j, u_j from mulberry32(seed + i). */
export function searchPoints(a: number, b: number, i: number, seed: number, n: number): number[] {
  const rand = seeded((seed + i) >>> 0);
  const out = new Array<number>(n);
  for (let j = 0; j < n; j++) out[j] = a + (b - a) * rand();
  return out;
}
/** `n` distinct seeded whole-flick times in [from, to), ascending. */
export function seededTimes(seed: number, n: number, from: number, to: number): number[] {
  const rand = seeded(seed);
  const set = new Set<number>();
  while (set.size < n) set.add(from + Math.floor(rand() * (to - from)));
  return [...set].sort((a, b) => a - b);
}
/** `n` seeded numbers in [lo, hi). */
export function seededIn(seed: number, n: number, lo: number, hi: number): number[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, () => lo + (hi - lo) * rand());
}

// ---------------------------------------------------------------------------------------------------
// f64

const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);
/** The next f64 above `x` (x finite). */
export function nextUp(x: number): number {
  if (x === 0) return Number.MIN_VALUE;
  F64[0] = x;
  U64[0] = x > 0 ? U64[0]! + 1n : U64[0]! - 1n;
  return F64[0]!;
}
/** The next f64 below `x` (x finite). */
export const nextDown = (x: number): number => -nextUp(-x);
/** One unit in the last place of `x`: the gap from |x| to the next f64 above it. */
export const ulp = (x: number): number => nextUp(Math.abs(x)) - Math.abs(x);
/** Little-endian f64 bytes as base64: the form a data asset's values take, so a NaN reaches the check (README: tables). */
export function f64Base64(values: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return Buffer.from(view.buffer).toString('base64');
}

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
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** Every number anywhere in a JSON value, strings included. */
export function numbersIn(value: JsonValue | undefined): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return [...value.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0]));
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (isObject(value)) return Object.values(value).flatMap(numbersIn);
  return [];
}
/** The value of the first member named `key` anywhere in a JSON value (depth first), or undefined. */
export function fieldIn(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (Array.isArray(value)) {
    for (const v of value) { const f = fieldIn(v, key); if (f !== undefined) return f; }
  } else if (isObject(value)) {
    if (key in value) return value[key];
    for (const v of Object.values(value)) { const f = fieldIn(v, key); if (f !== undefined) return f; }
  }
  return undefined;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name; a test that uses a
// build that failed fails with cargo's error.

function cargo(root: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}
const showArgs = (features: string): string[] => ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features];

export interface Built { bin: () => string }
/** `cargo build --locked --bin deep-motion`, once per file. */
export function useMotion(): Built {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-490-motion-'));
    error = cargo(REPO, ['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(MOTION_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; } };
}

export interface ShowBuilds { bin: (features: string) => string }
/** `cargo build --locked --bin deep-show --no-default-features --features <set>` for each listed set, once per file. */
export function useShow(featureSets: readonly string[]): ShowBuilds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-490-show-'));
    for (const features of featureSets) {
      const error = cargo(REPO, showArgs(features));
      const bin = join(dir, `${SHOW_NAME}-${features.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(SHOW_NAME)), bin);
      made.set(features, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return {
    bin(features: string): string {
      const entry = made.get(features);
      if (!entry) throw Error(`the file didn't list the feature set ${features} in useShow`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} --no-default-features --features ${features}`).toBe('');
      return entry.bin;
    },
  };
}

// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart (#200's way).
export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
function mergeBaseCheckout(sha: string): string {
  const dir = join(REPO, 'target', 'acceptance-490-base', sha.slice(0, 12));
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
  return dir;
}
const baseBins = new Map<string, string>();
/** The merge base's `deep-show` of `features`, built once per process in its own target folder (kept, so later runs build warm). */
export function baseShow(features: string): { sha: string; bin: string } {
  const sha = mergeBase();
  const dir = mergeBaseCheckout(sha);
  const bin = join(dir, `deep-show-${features.replace(/[^a-z0-9+.-]/g, '_')}`);
  if (!baseBins.has(features)) {
    const env = { CARGO_TARGET_DIR: join(dir, 'target') };
    const error = cargo(dir, showArgs(features), env);
    expect(error, `the merge base ${sha.slice(0, 12)}'s ${features} build compiles in ${dir}`).toBe('');
    copyFileSync(join(dir, 'target', 'debug', exe(SHOW_NAME)), bin);
    baseBins.set(features, bin);
  }
  return { sha, bin };
}

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = TIMEOUT): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario, one reply per call (README: The surface under test)

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-490-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB490D', 1), b: ulid('01JB490D', 2), c: ulid('01JB490D', 3) } as const;
/** `deep show` from your shell writes as you (the process table below). */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
export interface PackFixture { id: string; version: string; dir: string }
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;
/** A scenario: the evidence store, your shell's process tree, one panel, the three documents, the packs installed at start. */
export function scenario(evidence: string, calls: JsonObject[], packs: readonly PackFixture[] = []): JsonObject {
  const docs: JsonObject = {};
  for (const id of Object.values(DOC)) docs[id] = { panel: 'main' };
  return {
    evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } }, docs,
    ...(packs.length ? { packs: packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    calls,
  };
}
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], [sc]);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  return arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
}
/** `deep show` of a whole document from your shell, with its issues (and pixels when asked). */
export function present(doc: string, document: JsonObject, pixels = false): JsonObject {
  return { call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues', ...(pixels ? ['pixels'] : [])], ...(pixels ? { size: document['size'] ?? [320, 200] } : {}) };
}

// ---- the `fn` call: the core's closed function list (README: `fn`)

export type FnPoint = number | Record<string, number>;
export interface FnCall {
  expr: string;
  context?: 'driver' | 'field' | 'path';
  vars?: Record<string, string>;
  controls?: JsonObject;
  input?: JsonObject[];
  packs?: JsonObject[];
  at?: FnPoint[];
  over?: [number, number][];
  search?: { ranges: [number, number][]; points: number; seed: number };
  planted?: string;
}
export const fnCall = (c: FnCall): JsonObject => ({ call: 'fn', ...(c as unknown as JsonObject) });
/** Each call as its own `fn` reply, in one scenario. */
export function fnReplies(bin: string, evidence: string, calls: FnCall[]): JsonObject[] {
  const replies = runShow(bin, scenario(evidence, calls.map(fnCall)));
  expect(replies.length, 'one reply per fn call').toBe(calls.length);
  return replies;
}
/** A refused `fn` reply (`{code, …}` with no answer), or null. */
export const fnRefused = (r: JsonObject): boolean => typeof r['code'] === 'string' && r['values'] === undefined && r['bounds'] === undefined && r['search'] === undefined;
/** The point form's values: a number, a vector as an array, or null where the value isn't finite. */
export function valuesOf(r: JsonObject, n: number, what: string): (number | number[] | null)[] {
  expect(fnRefused(r), `${what} is answered, not refused: ${show(r)}`).toBe(false);
  const v = arr(r['values'], `${what}: values`);
  expect(v.length, `${what}: one value per point`).toBe(n);
  return v.map((x, i) => {
    if (x === null || typeof x === 'number') return x;
    return arr(x, `${what}: values[${i}]`).map((c, k) => num(c, `${what}: values[${i}][${k}]`));
  });
}
/** Scalar point values (null where not finite). */
export function scalars(r: JsonObject, n: number, what: string): (number | null)[] {
  return valuesOf(r, n, what).map((v, i) => {
    expect(v === null || typeof v === 'number', `${what}: values[${i}] is a number`).toBe(true);
    return v as number | null;
  });
}
/** An interval form's answer: lo and hi (null where unbounded), and whether it's an estimate (README: `fn`). */
export interface Bound { lo: number | null; hi: number | null; estimate: boolean }
function boundOf(v: JsonValue | undefined, what: string): Bound {
  const o = obj(v, what);
  const end = (k: string): number | null => (o[k] === null ? null : num(o[k], `${what}.${k}`));
  return { lo: end('lo'), hi: end('hi'), estimate: o['estimate'] === true };
}
export function boundsOf(r: JsonObject, n: number, what: string): Bound[] {
  expect(fnRefused(r), `${what} is answered, not refused: ${show(r)}`).toBe(false);
  const b = arr(r['bounds'], `${what}: bounds`);
  expect(b.length, `${what}: one bound per range`).toBe(n);
  return b.map((x, i) => boundOf(x, `${what}: bounds[${i}]`));
}
export interface Extreme { x: number; y: number }
export interface SearchRow extends Bound { range: [number, number]; min: Extreme | null; max: Extreme | null }
/** The search's answer per range: the interval form's bound and the least and greatest finite point values with their x. */
export function searchOf(r: JsonObject, ranges: readonly [number, number][], what: string): SearchRow[] {
  expect(fnRefused(r), `${what} is answered, not refused: ${show(r)}`).toBe(false);
  const rows = arr(r['search'], `${what}: search`);
  expect(rows.length, `${what}: one row per range`).toBe(ranges.length);
  return rows.map((v, i) => {
    const o = obj(v, `${what}: search[${i}]`);
    const ext = (k: string): Extreme | null => {
      if (o[k] === null || o[k] === undefined) return null;
      const e = obj(o[k], `${what}: search[${i}].${k}`);
      return { x: num(e['x'], `${what}: search[${i}].${k}.x`), y: num(e['y'], `${what}: search[${i}].${k}.y`) };
    };
    return { range: ranges[i]!, ...boundOf(o, `${what}: search[${i}]`), min: ext('min'), max: ext('max') };
  });
}

/** One function the search covers: its expression over x, the domain its ranges are drawn from, its poles and its named ranges. */
export interface Fn { expr: string; domain: [number, number]; poles?: (a: number, b: number) => boolean; special?: [number, number][]; ref?: (x: number) => number }
/** 10,000 seeded ranges inside `f.domain`: its named ranges (across a jump, a pole or an extremum) first, then log-uniform widths. */
export function rangesFor(f: Fn, seed: number, count = 10_000): [number, number][] {
  const [lo, hi] = f.domain;
  const span = hi - lo;
  const out: [number, number][] = [...(f.special ?? [])];
  const rand = seeded(seed);
  while (out.length < count) {
    const w = span * 10 ** (-6 * rand()) / 2;
    const a = lo + (span - w) * rand();
    out.push([a, Math.min(hi, a + w)]);
  }
  return out;
}
/**
 * The counterexample check on one function's search: every finite point value lies inside its range's bound; a
 * bound may be unbounded or an estimate only where the range holds a pole. Each failure names the function, the
 * range and the point.
 */
export function searchFailures(f: Fn, rows: readonly SearchRow[]): string[] {
  const failures: string[] = [];
  for (const r of rows) {
    const [a, b] = r.range;
    const name = `${f.expr}: range [${a}, ${b}]`;
    const pole = f.poles ? f.poles(a, b) : false;
    if ((r.estimate || r.lo === null || r.hi === null) && !pole) failures.push(`${name}: the form is ${r.estimate ? 'an estimate' : 'unbounded'} on a range with no pole`);
    if (r.min && r.lo !== null && r.min.y < r.lo) failures.push(`${name}: the form gives [${r.lo}, ${r.hi}], but the point x = ${r.min.x} reads ${r.min.y}, below it`);
    if (r.max && r.hi !== null && r.max.y > r.hi) failures.push(`${name}: the form gives [${r.lo}, ${r.hi}], but the point x = ${r.max.x} reads ${r.max.y}, above it`);
  }
  return failures;
}
/** Whether [a, b] holds a point of `xs` (poles), sorted or not. */
export const holdsAny = (xs: readonly number[]) => (a: number, b: number): boolean => xs.some((p) => p >= a && p <= b);

// ---- the `path` call: an item's drawn path (README: `path`)

export interface Drawn { subpaths: [number, number][][]; notices: JsonValue[]; raw: JsonObject }
export function drawn(r: JsonObject, what: string): Drawn {
  const subpaths = arr(r['subpaths'], `${what}: subpaths`).map((s, i) => arr(s, `${what}: subpaths[${i}]`).map((p, j) => {
    const pt = arr(p, `${what}: subpaths[${i}][${j}]`);
    return [num(pt[0], `${what}: subpaths[${i}][${j}][0]`), num(pt[1], `${what}: subpaths[${i}][${j}][1]`)] as [number, number];
  }));
  return { subpaths, notices: arr(r['notices'] ?? [], `${what}: notices`), raw: r };
}

// ---- deep://registries (#200: `{"uri": "deep://registries/<core version>", "registries": [...]}`)

export interface KitResult { verdict: string; rules: { rule: string; verdict: string }[]; raw: JsonObject }
function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`) };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface Entry { name: string; origin: string; module: string | undefined; since: string; digest: string; kit: KitResult; raw: JsonObject }
export interface Listed { name: string; owner: string; fill: string[]; since: string; digest: string; kit: { rule: string }[]; planted: { name: string; result: KitResult }[]; entries: Entry[]; raw: JsonObject }
/** The registry `name` in a `registries` reply. */
export function theRegistry(reply: JsonObject, name: string): Listed {
  const all = arr(reply['registries'], 'registries: registries').map((v, i) => obj(v, `registries[${i}]`));
  const o = all.find((x) => x['kind'] === 'registry' && x['name'] === name);
  expect(o, `deep://registries lists the registry ${name}; it lists ${all.map((x) => String(x['name'])).join(', ')}`).toBeDefined();
  const w = `deep://registries ${name}`;
  return {
    name,
    owner: str(o!['owner'], `${w}.owner`),
    fill: arr(o!['fill'], `${w}.fill`).map((f, i) => str(f, `${w}.fill[${i}]`)),
    since: String(o!['since'] ?? ''),
    digest: String(o!['digest'] ?? ''),
    kit: arr(o!['kit'], `${w}.kit`).map((r, i) => ({ rule: str(obj(r, `${w}.kit[${i}]`)['rule'], `${w}.kit[${i}].rule`) })),
    planted: arr(o!['planted'] ?? [], `${w}.planted`).map((p, i) => {
      const po = obj(p, `${w}.planted[${i}]`);
      return { name: String(po['name'] ?? ''), result: kitResult(po['result'], `${w}.planted[${i}].result`) };
    }),
    entries: arr(o!['entries'] ?? [], `${w}.entries`).map((e, i) => {
      const eo = obj(e, `${w}.entries[${i}]`);
      return {
        name: str(eo['name'], `${w}.entries[${i}].name`), origin: str(eo['origin'], `${w}.entries[${i}].origin`),
        module: typeof eo['module'] === 'string' ? eo['module'] : undefined, since: String(eo['since'] ?? ''),
        digest: String(eo['digest'] ?? ''), kit: kitResult(eo['kit'], `${w}.entries[${i}].kit`), raw: eo,
      };
    }),
    raw: o!,
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: `deep-motion eval`)

export interface EvalLine {
  doc: JsonObject;
  times: number[];
  planted?: string;
  input?: JsonObject[];
  packs?: JsonObject[];
  bounds?: boolean;
}
const lineOf = (l: EvalLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, times: l.times };
  if (l.planted !== undefined) out['planted'] = l.planted;
  if (l.input !== undefined) out['input'] = l.input;
  if (l.packs !== undefined) out['packs'] = l.packs;
  if (l.bounds !== undefined) out['bounds'] = l.bounds;
  return out;
};
/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const s = start(bin, ['eval'], lines.map(lineOf));
  expect(s.timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(s.status, `${MOTION_NAME} eval exits 0 (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${MOTION_NAME} eval: one output line per input line; stdout: ${s.stdout.slice(0, 600)}`).toBe(lines.length);
  return s.lines.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}
export interface Frame { t: number; items: JsonObject; channels: JsonObject; raw: JsonObject }
export interface MotionBounds { channels: Record<string, Bound>; drivers: Record<string, Bound> }
export interface Accepted { frames: Frame[]; bounds: MotionBounds | null; raw: JsonObject }
/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), items: isObject(f['items']) ? f['items'] : {}, channels: isObject(f['channels']) ? f['channels'] : {}, raw: f };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  let bounds: MotionBounds | null = null;
  if (answer['bounds'] !== undefined) {
    const b = obj(answer['bounds'], `${what}: bounds`);
    const group = (k: string): Record<string, Bound> => Object.fromEntries(Object.entries(isObject(b[k]) ? b[k] : {}).map(([id, v]) => [id, boundOf(v, `${what}: bounds.${k}.${id}`)]));
    bounds = { channels: group('channels'), drivers: group('drivers') };
  }
  return { frames, bounds, raw: answer };
}
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  return accepted(evalAll(bin, [line])[0]!, line.times, what);
}
/** The same for a planted program, which may refuse, crash or answer with the wrong frames: null then. */
export function evalPlanted(bin: string, line: EvalLine): Accepted | null {
  const s = start(bin, ['eval'], [lineOf(line)]);
  if (s.timedOut || s.status !== 0 || s.lines.length !== 1 || !isObject(s.lines[0])) return null;
  const a = s.lines[0];
  if (a['ok'] !== true || !Array.isArray(a['frames']) || a['frames'].length !== line.times.length) return null;
  return accepted(a, line.times, 'the planted program\'s answer');
}
/** A refused document: `{ok: false, code, …}`. */
export function refusal(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} is refused: ${show(answer)}`).toBe(false);
  str(answer['code'], `${what}: code`);
  return answer;
}
/** A channel's value as one number in a frame. */
export function chan(frame: Frame, id: string): number {
  const c = obj(frame.channels[id], `frame ${frame.t}: channels.${id}`);
  const v = c['value'];
  if (Array.isArray(v) && v.length === 1) return num(v[0], `frame ${frame.t}: channels.${id}.value[0]`);
  return num(v, `frame ${frame.t}: channels.${id}.value`);
}
/** The same, NaN where it isn't one (for the planted checks, which collect failures). */
export function chanOr(frame: Frame, id: string): number {
  const c = frame.channels[id];
  if (!isObject(c)) return NaN;
  const v = c['value'];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'number') return v[0];
  return typeof v === 'number' ? v : NaN;
}
/** An item's evaluated world `at.<group>` component in a frame. */
export function itemAt(frame: Frame, id: string, group: 'pos' | 'rot' | 'scale', k: number): number {
  const item = obj(frame.items[id], `frame ${frame.t}: items.${id}`);
  const a = arr(obj(item['at'], `frame ${frame.t}: items.${id}.at`)[group], `frame ${frame.t}: items.${id}.at.${group}`);
  return num(a[k], `frame ${frame.t}: items.${id}.at.${group}[${k}]`);
}

// ---- documents as the tests write them (#391's and #489's envelope)

export function rect(id: string, pos: [number, number] = [100, 100], extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] }, ...extra };
}
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '1s' }): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#490 ${id}`, description: `The #490 acceptance tests' document ${id}.`, size: [640, 360],
    transport, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A key: `{t, value, interp}`. */
export const key = (t: number, value: number, interp: JsonValue = 'linear', extra: JsonObject = {}): JsonObject => ({ t: at(t), value, interp, ...extra });
/** A keyed f32 channel. */
export const keyed = (target: string, keys: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject => ({ target, type: 'f32', keys, ...extra });
/** A slider control (#489's form), its declared range the var's max. */
export const slider = (label: string, range: [number, number], value: number): JsonObject => ({ kind: 'slider', class: 'document', label, range, default: value });
/** An input-track entry a test writer appends (Input track: entries). */
export const entry = (t: number, seq: number, control: string, value: number): JsonObject => ({ t, seq, control, value, writer: 'test' });
/** One frame per 1/1000 of `seconds` from 0: the 1,001 points x = i/1000 of a one-segment channel over [0, seconds]. */
export const thousandths = (seconds = 1): number[] => Array.from({ length: 1001 }, (_, i) => Math.round((i * seconds * FLICKS) / 1000));

// ---------------------------------------------------------------------------------------------------
// The closed eases (Channel and key: interp; ease@1's first-party entries, as the base's motion names them)

export const PENNER = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const;
export const EASES: string[] = [
  ...PENNER.flatMap((f) => [`in_${f}`, `out_${f}`, `in_out_${f}`]),
  'smoothstep', 'smootherstep', 'sigmoid', 'rush_in', 'rush_out', 'double_sigmoid', 'running_start', 'exp_decay',
];
/** The eases that leave [0, 1] or turn back, so the identities skip monotonicity for them. */
export const NOT_MONOTONE = (name: string): boolean => /_(back|elastic|bounce)$/.test(name) || name === 'running_start';

/** in_out_cubic: 4x³ below one half, 1 − (2 − 2x)³ ÷ 2 above. */
export const inOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2);
/** The logistic over [0, 1] with steepness k, renormalized to 0 at 0 and 1 at 1 (sigmoid(k)). */
export function sigmoid(k: number, x: number): number {
  const s = (v: number): number => 1 / (1 + Math.exp(-v));
  return (s(k * (x - 0.5)) - s(-k / 2)) / (s(k / 2) - s(-k / 2));
}
/** running_start(pull): the six-degree Bernstein curve with control values 0, 0, pull, pull, 1, 1, 1. */
export function runningStart(pull: number, x: number): number {
  const s = 1 - x;
  return 15 * x ** 2 * s ** 4 * pull + 20 * x ** 3 * s ** 3 * pull + 15 * x ** 4 * s ** 2 + 6 * x ** 5 * s + x ** 6;
}
/** The fixed four-arc bounce (out side): 7.5625 and 2.75. */
export function bounceOut(x: number): number {
  const n = 7.5625; const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) { const u = x - 1.5 / d; return n * u * u + 0.75; }
  if (x < 2.5 / d) { const u = x - 2.25 / d; return n * u * u + 0.9375; }
  const u = x - 2.625 / d; return n * u * u + 0.984375;
}
