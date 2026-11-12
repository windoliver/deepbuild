// Test-side tools for the #1918 acceptance tests (README: The surface under test). They extend #2009's and #2010's
// surface: the same `deep-physics` binary, built once per file through ../2009/helpers.ts (imported read only, through
// ../2010/helpers.ts, as #2012's suite does) and, for criterion 5, once more with the cargo feature `test-reverse-pairs`,
// asked this suite's calls (`check`, `bake` and `restore` of a scene's world) and read for this suite's fields
// (`occurrences`, `occurrences_hash`); and `deep-show run` (#393's convention, as #535's and #544's suites drive it) for
// the column view, the seal, the registry's kit, drivers and outputs in a scene. Nothing here stands in for the physics
// module, the motion module or the column view: every state, row, key, value, listing and refusal read here is the
// program's own; every expected value comes from the issue's text, the design's analytic answers and the fixtures' own
// channel keys, computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { REPO, TARGET, TIMEOUT, arr, cargoError, num, obj, physicsBin, show, type JsonObject, type JsonValue } from '../2010/helpers.ts';

export * from '../2010/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#1918.adfa6a63',
  2: '#1918.ea47680a',
  3: '#1918.62636f58',
  4: '#1918.1b4ea358',
  5: '#1918.4bdfb685',
} as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const MIB = 1024 * 1024;

/** A fixture file of this suite, parsed (README: The fixture). */
export const fixture = (path: string): JsonObject => obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, path);
/** A deep copy of a JSON value. */
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; a 120 Hz step is 5,880,000 and a 60 fps frame 11,760,000.

export const FLICKS = 705_600_000;
export const RATE = 120;
export const STEP = FLICKS / RATE;
export const FPS = 60;
export const FRAME = FLICKS / FPS;
/** A time in flicks as seconds to the tenth of a millisecond, for messages. */
export const sOf = (t: number): string => `${(t / FLICKS).toFixed(4)} s`;

/** A time literal `<decimal>s` with up to five fraction digits (the fixtures' keys) as flicks, exactly. */
export function flicksOf(text: string): number {
  const m = /^(\d+)(?:\.(\d{1,5}))?s$/.exec(text);
  if (!m) throw Error(`${text} is not a time literal of whole seconds and up to five fraction digits`);
  const frac = m[2] ?? '';
  const scale = 10 ** frac.length;
  const flicks = ((Number(m[1]) * scale + (frac === '' ? 0 : Number(frac))) * FLICKS) / scale;
  if (!Number.isInteger(flicks)) throw Error(`${text} is not a whole number of flicks`);
  return flicks;
}

// ---------------------------------------------------------------------------------------------------
// Channels (Channel and key): the fixtures' keys, evaluated here for the expected values.

export interface Key { t: number; value: number[]; interp: string }
/** A keyed channel's keys in time order, each value as numbers (an f32 channel's as one). */
export function keysOf(channel: JsonValue | undefined, what: string): Key[] {
  const keys = obj(obj(channel, what)['keys'], `${what}.keys`);
  return Object.entries(keys).map(([id, k]) => {
    const o = obj(k, `${what}.keys.${id}`);
    const v = o['value'];
    return {
      t: flicksOf(String(o['t'])),
      value: Array.isArray(v) ? v.map((x, i) => num(x, `${what}.keys.${id}.value[${i}]`)) : [num(v, `${what}.keys.${id}.value`)],
      interp: typeof o['interp'] === 'string' ? o['interp'] : 'linear',
    };
  }).sort((a, b) => a.t - b.t);
}
/**
 * A channel's value at `t` flicks for the interpolations the fixtures use (Channel and key): the left key owns its
 * segment; `linear` mixes the two keys' values in f64 by the time's share of the segment, `hold` keeps the left key's
 * value; a key's own time takes that key's value (right-continuous), and before the first key or after the last the end
 * value holds (`extrapolate: hold`, the default).
 */
export function channelAt(keys: Key[], t: number): number[] {
  const first = keys[0];
  if (!first) throw Error('a channel with no keys');
  if (t <= first.t) return [...first.value];
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i]!;
    if (t < k.t) continue;
    const next = keys[i + 1];
    if (!next || k.interp === 'hold') return [...k.value];
    const u = (t - k.t) / (next.t - k.t);
    return k.value.map((a, j) => a + (next.value[j]! - a) * u);
  }
  return [...first.value];
}

// ---------------------------------------------------------------------------------------------------
// `deep-physics` (#2009's JSON lines): this checkout's build (../2009/helpers.ts builds it once per file), or the test
// backend's build.

/** `deep-physics --planted <name>`: criterion 5's wrong program (README: Planted twins). */
export type PhysicsPlanted = 'occurrences_in_engine_order';
export interface Ask { bin?: string; planted?: PhysicsPlanted; where?: string }
/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], o: Ask = {}): JsonObject[] {
  const bin = o.bin ?? physicsBin();
  const args = o.planted ? ['--planted', o.planted] : [];
  const what = `deep-physics${args.length ? ` ${args.join(' ')}` : ''}${o.where ? ` (${o.where})` : ''}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** The cargo feature of `deep-physics-rapier` that builds criterion 5's test backend (README: The test backend). */
export const REVERSED_FEATURE = 'test-reverse-pairs';
let reversedDir = '';
let reversed: { bin: string; error: string } | undefined;
function reversedBuild(): { bin: string; error: string } {
  if (!reversed) {
    if (!reversedDir) reversedDir = mkdtempSync(join(tmpdir(), 'deep-1918-reversed-'));
    const bin = join(reversedDir, 'deep-physics');
    const error = cargoError(['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics', '--features', REVERSED_FEATURE]);
    if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-physics'), bin);
    reversed = { bin, error };
  }
  return reversed;
}
/** Builds the test backend's deep-physics before a file's tests, after the checkout's own (call after `prebuild()`). */
export function prebuildReversed(): void {
  beforeAll(() => { try { physicsBin(); } catch { /* the test reports it */ } reversedBuild(); }, TIMEOUT);
  afterAll(() => { if (reversedDir) rmSync(reversedDir, { recursive: true, force: true }); reversedDir = ''; reversed = undefined; });
}
/** The test backend's deep-physics; a test that uses it fails when its build failed, naming cargo's error. */
export function reversedBin(): string {
  const b = reversedBuild();
  expect(b.error, `deep-physics builds with --features ${REVERSED_FEATURE} (cargo build --locked -p deep-physics-rapier --bin deep-physics --features ${REVERSED_FEATURE})`).toBe('');
  return b.bin;
}

// Calls on a scene's world (README: deep-physics, what this suite adds).
export const sceneCheck = (scene: JsonObject, world: string): JsonObject => ({ call: 'check', scene, world });
export const sceneBake = (scene: JsonObject, world: string, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', scene, world, steps, ...extra });
export const sceneRestore = (scene: JsonObject, world: string, checkpoint: JsonObject, steps: number): JsonObject => ({ call: 'restore', scene, world, checkpoint, steps });

/** A `check` reply's error issues. */
export function errorsOf(reply: JsonObject | undefined, what: string): JsonObject[] {
  expect(reply?.['ok'], `${what}: the check ran: ${show(reply)}`).toBe(true);
  return arr(reply!['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['severity'] === 'error');
}

// ---------------------------------------------------------------------------------------------------
// Occurrence lists (README: Row)

/** The physics kinds in the design's order (Occurrence list), which is their `kind: u8` and so their order in a step. */
export const KINDS = ['contact_begin', 'contact_end', 'hit', 'force', 'sensor_enter', 'sensor_exit', 'break', 'tear', 'rest', 'wake', 'crossing', 'fault'] as const;
/** The kinds that name a pair, `a` the lower ID in canonical order and `b` the other. */
export const PAIR_KINDS = ['contact_begin', 'contact_end', 'hit', 'force', 'sensor_enter', 'sensor_exit'];

export interface Row { step: number; kind: string; a: string; b: string | null; aUse: number | null; bUse: number | null; raw: JsonObject }
const intOrNull = (v: JsonValue | undefined, what: string): number | null => {
  if (v === undefined || v === null) return null;
  expect(Number.isSafeInteger(v), `${what} is a whole number or null, got ${show(v)}`).toBe(true);
  return v as number;
};
/** A bake's occurrence list (`occurrences`), row by row, as the list holds it. */
export function rowsOf(reply: JsonObject | undefined, what: string): Row[] {
  expect(reply?.['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  return arr(reply!['occurrences'], `${what}: occurrences (the world's occurrence list)`).map((v, i) => {
    const o = obj(v, `${what}: occurrences[${i}]`);
    const w = `${what}: occurrences[${i}]`;
    const step = o['step'];
    expect(Number.isSafeInteger(step) && (step as number) >= 0, `${w}.step is a step, got ${show(step)}`).toBe(true);
    expect(KINDS.includes(o['kind'] as never), `${w}.kind is a physics kind, got ${show(o['kind'])}`).toBe(true);
    expect(typeof o['a'], `${w}.a is a stable ID, got ${show(o['a'])}`).toBe('string');
    const b = o['b'];
    expect(b === undefined || b === null || typeof b === 'string', `${w}.b is a stable ID or null, got ${show(b)}`).toBe(true);
    return { step: step as number, kind: o['kind'] as string, a: o['a'] as string, b: typeof b === 'string' ? b : null, aUse: intOrNull(o['a_use'], `${w}.a_use`), bUse: intOrNull(o['b_use'], `${w}.b_use`), raw: o };
  });
}
/** A bake's `occurrences_hash`: 64 lowercase hex. */
export function occurrencesHash(reply: JsonObject | undefined, what: string): string {
  const h = reply?.['occurrences_hash'];
  expect(typeof h === 'string' && /^[0-9a-f]{64}$/.test(h), `${what}: occurrences_hash is a sha256 as 64 hex, got ${show(h)}`).toBe(true);
  return h as string;
}
export const rowText = (r: Row): string => `step ${r.step} ${r.kind} a ${r.a}${r.aUse !== null ? `#${r.aUse}` : ''} b ${r.b ?? '-'}${r.bUse !== null ? `#${r.bUse}` : ''}`;

/** A row a fixture writes before the module runs: its kind and IDs, and where it names them, the shape uses. */
export interface Want { kind: string; a: string; b?: string; aUse?: number; bUse?: number }
const wantText = (w: Want): string => `${w.kind} a ${w.a}${w.aUse !== undefined ? `#${w.aUse}` : ''} b ${w.b ?? '-'}${w.bUse !== undefined ? `#${w.bUse}` : ''}`;
/** Steps ascending, then (Occurrence list) by kind, a and b, ties by a's shape-use index, then b's. */
export function orderFailures(rows: Row[], what: string): string[] {
  const key = (r: Row): (number | string)[] => [r.step, KINDS.indexOf(r.kind as never), r.a, r.b ?? '', r.aUse ?? -1, r.bUse ?? -1];
  const cmp = (x: (number | string)[], y: (number | string)[]): number => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
  };
  const f: string[] = [];
  rows.forEach((r, i) => { if (i > 0 && cmp(key(rows[i - 1]!), key(r)) > 0) f.push(`${what}: the list isn't sorted by (step, kind, a, b) and shape use: row ${i - 1} (${rowText(rows[i - 1]!)}) comes before row ${i} (${rowText(r)})`); });
  return f;
}
/** The list against the one a fixture writes: the same kinds, IDs (and shape uses where written), in that order, that count, sorted. */
export function listFailures(rows: Row[], want: Want[], what: string): string[] {
  const f: string[] = [];
  const all = rows.map(rowText).join('; ') || 'no rows';
  if (rows.length !== want.length) f.push(`${what}: the list holds ${rows.length} rows, the fixture writes ${want.length} (${want.map(wantText).join('; ')}); the list: ${all}`);
  want.forEach((w, i) => {
    const r = rows[i];
    if (!r) return;
    const same = r.kind === w.kind && r.a === w.a && r.b === (w.b ?? null) && (w.aUse === undefined || r.aUse === w.aUse) && (w.bUse === undefined || r.bUse === w.bUse);
    if (!same) f.push(`${what}: row ${i} is ${rowText(r)}, the fixture writes ${wantText(w)}; the list: ${all}`);
  });
  return [...f, ...orderFailures(rows, what)];
}
/** Each pair row names the lower ID in canonical order (all priorities here are 0, so ID order) as `a`. */
export function pairFailures(rows: Row[], what: string): string[] {
  return rows.filter((r) => PAIR_KINDS.includes(r.kind) && (r.b === null || !(r.a < r.b))).map((r) => `${what}: ${rowText(r)} names a pair with a not the lower ID`);
}
/** A JSON value as text with every -0 kept (JSON.stringify writes -0 as 0), so two lists compare byte for byte. */
export const canonical = (v: JsonValue | undefined): string => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && Object.is(x, -0) ? '-0' : x)) ?? 'undefined';
/** A normal within `tol` of `want`. */
export function normalFailures(r: Row, want: [number, number, number], what: string, tol = 1e-3): string[] {
  const n = r.raw['normal'];
  if (!Array.isArray(n) || n.length !== 3 || n.some((x) => typeof x !== 'number')) return [`${what}: ${rowText(r)} has no normal [x, y, z]: ${show(r.raw)}`];
  return (n as number[]).some((x, i) => Math.abs(x - want[i]!) > tol) ? [`${what}: ${rowText(r)}'s normal is ${show(n)}, from ${r.a} to ${r.b} is ${show(want)}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's convention, as #535's and #544's suites drive it): one scenario line on stdin, one answer.

/** `full`: the default build set. The others are the full set with one of criterion 3's planted twins (README). */
export type ShowBuild = 'full' | 'no-changes' | 'reads-by-name';
export const SHOW_FEATURES: Record<ShowBuild, string[]> = {
  full: [],
  'no-changes': ['test-physics-hands-no-changes'],
  'reads-by-name': ['test-motion-reads-physics-array'],
};
/** A deep-show scenario run's own timeout (a deep-show build is the slow part, in `beforeAll`). */
export const SHOW_TIMEOUT = 1_800_000;
let showDir = '';
const showBuilt = new Map<ShowBuild, { bin: string; error: string }>();
function showBuild(b: ShowBuild): { bin: string; error: string } {
  const known = showBuilt.get(b);
  if (known) return known;
  if (!showDir) showDir = mkdtempSync(join(tmpdir(), 'deep-1918-show-'));
  const bin = join(showDir, `deep-show-${b}`);
  const features = SHOW_FEATURES[b];
  const error = cargoError(['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show', ...(features.length ? ['--features', features.join(',')] : [])]);
  if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
  const out = { bin, error };
  showBuilt.set(b, out);
  return out;
}
/** Builds deep-show before a file's tests (the slow part), so each test's own time is its own. */
export function prebuildShow(list: ShowBuild[]): void {
  beforeAll(() => { for (const b of list) showBuild(b); }, TIMEOUT * list.length);
  afterAll(() => { if (showDir) rmSync(showDir, { recursive: true, force: true }); showDir = ''; showBuilt.clear(); });
}
/** The built deep-show; a test that uses a build that failed fails, naming cargo's error. */
export function showBin(b: ShowBuild = 'full'): string {
  const out = showBuild(b);
  expect(out.error, `deep-show (${b}) builds on this host (cargo build --locked -p deep-show --bin deep-show${SHOW_FEATURES[b].length ? ` --features ${SHOW_FEATURES[b].join(',')}` : ''})`).toBe('');
  return out.bin;
}

/** A fresh folder per call (an evidence store, a bake store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1918-')); made.push(d); return d; };
}

export const SESSION = 'sess-1918';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-1918', name: 'Claude Code: physics lab', process: { pid: 4200, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4200, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1918D0${String(n).padStart(16, '0')}`;
/** A scenario: the agent's session, the process table, each document in a visible panel of its own, the calls. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[]): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: SHOW_TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(list.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** A `deep_show` reply that presented its document: the message lists the issues when it didn't. */
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what} is presented: ${show(reply?.['issues'] ?? reply)}`).toBe('presented');
}
/** `eval` of the live session at frame `frame` (flicks, #488) reading `paths` (README: `eval`'s `paths`). */
export const evalCall = (doc: string, frame: number, paths: string[]): JsonObject => ({ call: 'eval', doc, t: frame * FRAME, paths });
/** An `eval` reply's `values`, each path's evaluated value at the frame. */
export function valuesOf(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply?.['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  return obj(reply!['values'], `${what}: values (each path read at the frame)`);
}

/** A deep-show start the seal may refuse: its exit status and its stdout lines. */
export interface Started { status: number | null; stdout: string; stderr: string; lines: JsonValue[] }
export function startShow(bin: string, sc: JsonObject): Started {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: SHOW_TIMEOUT, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') expect.fail('deep-show run did not finish within its timeout');
  if (r.error && code !== 'EPIPE') throw Error(`deep-show run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, stdout, stderr: r.stderr ?? '', lines };
}
/** #200's startup refusal: `{"ok": false, "code": "seal_refused", "reason", "modules", "operators", "arrays", "what", "registry"?, "entries"?, "rules"?}` and exit 2. */
export interface SealRefusal { reason: string; modules: string[]; registry: string | undefined; entries: JsonValue[]; rules: string[]; what: string; raw: JsonObject }
export function sealRefusalOf(s: Started, what: string): SealRefusal {
  expect(s.status, `${what}: the startup exits 2 with the seal's refusal; stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-800)}`).toBe(2);
  expect(s.lines.length, `${what}: the refusal is one line: ${s.stdout.slice(0, 800)}`).toBe(1);
  const raw = obj(s.lines[0], `${what}: the refusal`);
  expect([raw['ok'], raw['code']], `${what}: the line is the seal's refusal: ${show(raw)}`).toEqual([false, 'seal_refused']);
  const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []);
  return {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '', modules: strings(raw['modules']), registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined,
    entries: Array.isArray(raw['entries']) ? raw['entries'] : [], rules: strings(raw['rules']), what: typeof raw['what'] === 'string' ? raw['what'] : '', raw,
  };
}

/** One entry of a registry in `deep://registries` (#200's listing), with its kit result. */
export interface KitRule { rule: string; verdict: string; raw: JsonObject }
export interface Listed { name: string; module: string | undefined; value: JsonObject; verdict: string; rules: KitRule[]; raw: JsonObject }
/** The entries of `column.source@1` in a `registries` reply, with the row's owner. */
export function columnSources(reply: JsonObject | undefined, what: string): { owner: JsonValue | undefined; entries: Listed[] } {
  const list = arr(reply?.['registries'], `${what}: registries`).map((v, i) => obj(v, `${what}: registries[${i}]`));
  const row = list.find((r) => r['kind'] === 'registry' && r['name'] === 'column.source@1');
  expect(row, `${what} lists column.source@1; it lists ${list.map((r) => String(r['name'])).join(', ')}`).toBeDefined();
  const entries = arr(row!['entries'], `${what}: column.source@1.entries`).map((e, i) => {
    const eo = obj(e, `${what}: column.source@1.entries[${i}]`);
    const kit = obj(eo['kit'], `${what}: column.source@1.entries[${i}].kit`);
    return {
      name: String(eo['name']), module: typeof eo['module'] === 'string' ? eo['module'] : undefined, value: obj(eo['value'], `${what}: column.source@1.entries[${i}].value`),
      verdict: String(kit['verdict']), rules: arr(kit['rules'], `${what}: column.source@1.entries[${i}].kit.rules`).map((r) => { const ro = obj(r, 'kit rule'); return { rule: String(ro['rule']), verdict: String(ro['verdict']), raw: ro }; }),
      raw: eo,
    };
  });
  return { owner: row!['owner'], entries };
}

// ---------------------------------------------------------------------------------------------------
// Scene documents for deep-show (README: Scenes), as the agent's session sends them (#421's payload: no `id`, no `layers`).

export type V3 = [number, number, number];
export const camera = (position: V3, target: V3): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40 } });
export const markBox = (size: V3, pos?: V3): JsonObject => ({ kind: 'mark.box@1', params: { size }, ...(pos ? { at: { pos } } : {}) });
/** A scene whose items are given by ID (each gets its `id`, `name` and `order`), with `extra` sections over the envelope. */
export function sceneDoc(title: string, span: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1918 acceptance fixture.`, size: [640, 360], camera: 'cam',
    transport: { span, frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } }, ...extra, items: withIds,
  };
}

/** mulberry32: a fixed-seed generator of u32 words. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** `count` distinct frames in 1 … `max`, in the order a generator seeded with `seed` draws them. */
export function seededFrames(seed: number, count: number, max: number): number[] {
  const next = rng(seed);
  const out: number[] = [];
  while (out.length < count) {
    const f = 1 + (next() % max);
    if (!out.includes(f)) out.push(f);
  }
  return out;
}
