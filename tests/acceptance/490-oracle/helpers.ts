// Test-side tools for the #490 Oracle-lane acceptance tests: `deep-show run`'s `fn` call (the surface the README
// names), `deep-motion eval` for the one channel modifier a criterion names (the pulse), each binary built once per
// file; the seeded generators the ported cases need (NumPy's legacy MT19937 for SciPy's TestPCHIP data); and small
// float tools. Nothing here stands in for our code: every value a test compares comes from a binary, every
// expected value from an upstream case or an upstream formula computed in the test file.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/490-oracle is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** A fixture under fixtures/, parsed. */
export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as T;
}

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** No failures; the message lists the first of them and how many there are. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.length} failures:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name; a test that uses a
// build that failed fails with cargo's error.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}
export interface Built { bin: () => string }
function useBuild(name: string, args: string[]): Built {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-490-oracle-${name}-`));
    error = cargo(['build', '--locked', '--bin', name, ...args]);
    if (error === '') { bin = join(dir, name); copyFileSync(join(TARGET, 'debug', exe(name)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${name} ${args.join(' ')}`).toBe(''); return bin; } };
}
/** `cargo build --locked --bin deep-show --no-default-features --features core`, once per file. */
export const useShowCore = (): Built => useBuild('deep-show', ['--no-default-features', '--features', 'core']);
/** `cargo build --locked --bin deep-motion`, once per file. */
export const useMotion = (): Built => useBuild('deep-motion', []);

interface Ran { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], inputs: JsonValue[]): Ran {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run's `fn` call (README: The surface under test)

export interface Table { x: number[]; y: number[]; mode?: 'linear' | 'monotone' }
export interface Pack { name: string; tables?: Record<string, Table> }
export interface FnCall {
  expr: string;
  context?: 'driver' | 'field' | 'path';
  packs?: Pack[];
  at?: (number | Record<string, number>)[];
  over?: [number, number][];
}
export interface Bound { lo: number | null; hi: number | null; estimate: boolean }
export type FnReply = { values: (number | JsonValue[] | null)[] } | { bounds: Bound[] } | { code: string; raw: JsonObject } | { bad: string };

const callOf = (c: FnCall): JsonObject => {
  const o: JsonObject = { call: 'fn', expr: c.expr };
  if (c.context !== undefined) o['context'] = c.context;
  if (c.packs !== undefined) o['packs'] = c.packs as unknown as JsonValue;
  if (c.at !== undefined) o['at'] = c.at as JsonValue;
  if (c.over !== undefined) o['over'] = c.over;
  return o;
};

/**
 * One `deep-show run` scenario holding `calls`, all `fn` calls: one reply per call, in order. The scenario must be
 * accepted (`{"ok": true, "replies": [...]}`); each reply is read as values, bounds or a refusal, or `bad` with
 * why it is none of them.
 */
export function runFns(bin: string, calls: FnCall[]): FnReply[] {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-490-oracle-ev-'));
  try {
    const sc: JsonObject = { evidence, sessions: {}, processes: [], panels: {}, docs: {}, calls: calls.map(callOf) };
    const s = start(bin, ['run'], [sc]);
    expect(s.timedOut, 'deep-show run finished within its timeout').toBe(false);
    expect(s.status, `deep-show run exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 600)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
    const out = s.lines[0];
    expect(isObject(out) && out['ok'] === true, `deep-show run accepts a scenario of ${calls.length} fn calls (the first: ${show(callOf(calls[0]!))}); it answered ${s.stdout.slice(0, 600)}`).toBe(true);
    const replies = (out as JsonObject)['replies'];
    expect(Array.isArray(replies) && replies.length === calls.length, `one reply per call (${calls.length}); got ${show(replies)}`).toBe(true);
    return (replies as JsonValue[]).map(replyOf);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
function replyOf(r: JsonValue): FnReply {
  if (!isObject(r)) return { bad: `not an object: ${show(r)}` };
  if (typeof r['code'] === 'string') return { code: r['code'], raw: r };
  if (Array.isArray(r['values'])) return { values: r['values'] as (number | JsonValue[] | null)[] };
  if (Array.isArray(r['bounds'])) {
    const bs: Bound[] = [];
    for (const b of r['bounds']) {
      const okEnd = (v: JsonValue | undefined): boolean => v === null || (typeof v === 'number' && Number.isFinite(v));
      if (!isObject(b) || !okEnd(b['lo']) || !okEnd(b['hi'])) return { bad: `a bound is not {lo, hi}: ${show(b)}` };
      bs.push({ lo: b['lo'] as number | null, hi: b['hi'] as number | null, estimate: b['estimate'] === true });
    }
    return { bounds: bs };
  }
  return { bad: `neither values, bounds nor a refusal: ${show(r)}` };
}
/** The numbers of an `at` reply, or why it isn't one with `n` numbers. */
export function valuesOf(r: FnReply, n: number): number[] | string {
  if (!('values' in r)) return `not values: ${show(r as unknown as JsonValue)}`;
  if (r.values.length !== n) return `${r.values.length} values for ${n} points`;
  const bad = r.values.findIndex((v) => typeof v !== 'number' || !Number.isFinite(v));
  return bad >= 0 ? `value ${bad} is ${show(r.values[bad])}` : (r.values as number[]);
}
/** The bounds of an `over` reply, or why it isn't one with `n` bounds. */
export function boundsOf(r: FnReply, n: number): Bound[] | string {
  if (!('bounds' in r)) return `not bounds: ${show(r as unknown as JsonValue)}`;
  return r.bounds.length === n ? r.bounds : `${r.bounds.length} bounds for ${n} ranges`;
}
/** Whether a reply is a refusal (a `code`), and the reply as text. */
export const refused = (r: FnReply): boolean => 'code' in r;

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (#391's JSON-lines convention, as tests/acceptance/489 drives it)

/** `deep-motion eval` on one line `{doc, times}`: the channel `id`'s value at each time, or why there is none. */
export function channelValues(bin: string, doc: JsonObject, times: number[], id: string): number[] | string {
  const s = start(bin, ['eval'], [{ doc, times }]);
  if (s.timedOut || s.status !== 0) return `deep-motion eval exited ${s.status} (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-800)}`;
  const a = s.lines[0];
  if (!isObject(a) || a['ok'] !== true || !Array.isArray(a['frames'])) return `the document is not accepted: ${s.stdout.slice(0, 800)}`;
  const frames = a['frames'];
  if (frames.length !== times.length) return `${frames.length} frames for ${times.length} times`;
  const out: number[] = [];
  for (const f of frames) {
    const c = isObject(f) && isObject(f['channels']) ? f['channels'][id] : undefined;
    const v = isObject(c) ? c['value'] : undefined;
    const n = Array.isArray(v) && v.length === 1 ? v[0] : v;
    if (typeof n !== 'number') return `a frame has no number at channels.${id}.value: ${show(f).slice(0, 400)}`;
    out.push(n);
  }
  return out;
}

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// Numbers

/** `n` + 1 evenly spaced samples of [0, 1]: i ÷ n. */
export const unitSamples = (n: number): number[] => Array.from({ length: n + 1 }, (_, i) => i / n);
/** NumPy's linspace(a, b, n): a + i·(b − a)/(n − 1), its last point exactly b. */
export function linspace(a: number, b: number, n: number): number[] {
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + i * step));
}

/**
 * NumPy's legacy `np.random.RandomState(seed).random(n)`: MT19937 seeded by `init_genrand(seed)` (numpy's
 * `_legacy_seeding` for an integer seed), each double `genrand_res53` = (a·2^26 + b) / 2^53 from a = next >> 5,
 * b = next >> 6. The suites check its first values against NumPy's published ones before using it.
 */
export function randomState(seed: number): (n: number) => number[] {
  const mt = new Uint32Array(624); let idx = 624;
  mt[0] = seed >>> 0;
  for (let i = 1; i < 624; i++) {
    const p = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
    mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
  }
  const next = (): number => {
    if (idx >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k]! & 0x80000000) | (mt[(k + 1) % 624]! & 0x7fffffff);
        mt[k] = (mt[(k + 397) % 624]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
      }
      idx = 0;
    }
    let y = mt[idx++]!;
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return y >>> 0;
  };
  return (n) => Array.from({ length: n }, () => { const a = next() >>> 5; const b = next() >>> 6; return (a * 67108864 + b) / 9007199254740992; });
}
