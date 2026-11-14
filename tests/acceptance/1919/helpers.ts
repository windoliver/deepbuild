// Test-side tools for the #1919 acceptance tests (README: The surface under test). They extend #2009's, #2010's,
// #2012's and #1918's surface, imported read only: the same `deep-physics` binary, built once per file through
// ../2009/helpers.ts, asked this suite's calls (`query`, physics.query; `backend_calls` on the counting build); the same
// binary built with the cargo feature `test-count-calls`; the wasm32 leg of #2012 (`node scripts/physics-wasm32.mjs`);
// and `deep-show run` (#1918's scenario helpers) built with the cargo features `test-leave-out-physics` and
// `test-physics-shapes-empty`. Nothing here stands in for the physics module: every result, verdict, count, golden, run
// and reply read here is the program's own; the expected values come from the issue's text, computed here, and from the
// program's own bake of the same world.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import {
  TARGET, TIMEOUT, answered, arr, box, cargoError, dynamic, floor, num, obj, physics, show, sphere, world, type JsonObject,
  type JsonValue, type PhysicsPlanted,
} from '../1918/helpers.ts';

export * from '../1918/helpers.ts';
export { WASM32, onWasm32 } from '../2012/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = { 1: '#1919.adaa86f8', 2: '#1919.b83c52f8', 3: '#1919.4c1f2dbc', 4: '#1919.6198ed94' } as const;

// ---------------------------------------------------------------------------------------------------
// Builds with a cargo feature (README: The surface under test), each once per file, the binary copied out.

/** Criterion 1's test backend: deep-physics on a backend that wraps Rapier and counts its calls. */
export const COUNTING = 'test-count-calls';
/** Criterion 3: the full set without the physics module, and its planted twin. */
export const LEAVE_OUT_PHYSICS = 'test-leave-out-physics';
export const SHAPES_EMPTY = 'test-physics-shapes-empty';

interface Built { bin: string; error: string }
const built = new Map<string, Built>();
const binDirs: string[] = [];
function featureBuild(pkg: string, bin: string, feature: string): Built {
  const key = `${pkg}/${bin}/${feature}`;
  const known = built.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-1919-bin-'));
  binDirs.push(dir);
  const out = { bin: join(dir, bin), error: cargoError(['build', '--locked', '-p', pkg, '--bin', bin, '--features', feature]) };
  if (out.error === '') copyFileSync(join(TARGET, 'debug', bin), out.bin);
  built.set(key, out);
  return out;
}
const cargoLine = (pkg: string, bin: string, feature: string): string => `cargo build --locked -p ${pkg} --bin ${bin} --features ${feature}`;
/** Builds each binary before a file's tests (the slow part); each test then reports its own build failure. */
export function prebuildFeatures(list: Array<[pkg: string, bin: string, feature: string]>): void {
  beforeAll(() => { for (const [p, b, f] of list) featureBuild(p, b, f); }, TIMEOUT * list.length);
  afterAll(() => { for (const d of binDirs.splice(0)) rmSync(d, { recursive: true, force: true }); built.clear(); });
}
/** A built binary; a test that uses a build that failed fails, naming cargo's error. */
export function featureBin(pkg: string, bin: string, feature: string): string {
  const b = featureBuild(pkg, bin, feature);
  expect(b.error, `${bin} builds with --features ${feature} (${cargoLine(pkg, bin, feature)})`).toBe('');
  return b.bin;
}
export const countingBin = (): string => featureBin('deep-physics-rapier', 'deep-physics', COUNTING);
export const showBuildBin = (feature: string): string => featureBin('deep-show', 'deep-show', feature);

// ---------------------------------------------------------------------------------------------------
// deep-physics with this suite's planted twins (README: Planted twins), through #1918's runner.

export type Planted = 'query_bypasses_backend' | 'query_machines_any';
export interface Run { bin?: string; planted?: Planted; where?: string }
/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function deepPhysics(calls: JsonObject[], o: Run = {}): JsonObject[] {
  return physics(calls, {
    ...(o.bin ? { bin: o.bin } : {}),
    ...(o.planted ? { planted: o.planted as unknown as PhysicsPlanted } : {}),
    ...(o.where ? { where: o.where } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------
// The world the criteria name: a ball launched at 10 m/s and 45° from the floor, no drag, g 9.81 m/s².

export const SPEED = 10;
export const VX = SPEED * Math.cos(Math.PI / 4);
export const VY = SPEED * Math.sin(Math.PI / 4);
export const RADIUS = 0.1;
/** The range back at launch height, v² sin 2θ ÷ g (behavior kit: projectile): 10.19 m. */
export const RANGE = (SPEED * SPEED) / 9.81;
/** 2 s at 120 Hz: the ball lands at about 1.44 s. */
export const STEPS = 240;

/** The projectile: a floor whose top is y = 0 and a 0.1 m ball launched at (10 cos 45°, 10 sin 45°, 0) m/s, its position an output. */
export function projectile(): JsonObject {
  return world({
    contact_materials: {
      ground: { friction: 0, restitution: 0, density: 1000 },
      leather: { friction: 0, restitution: 0, density: 1000 },
    },
    shapes: { floor: box([30, 0.1, 30]), ball: sphere(RADIUS) },
    bodies: {
      floor: floor('ground'),
      ball: dynamic('ball', 'leather', [0, RADIUS, 0], { velocity: { linear: [VX, VY, 0] } }),
    },
    outputs: { ball: { from: 'ball', read: 'position' } },
  });
}

// ---------------------------------------------------------------------------------------------------
// physics.query (README: `query`)

/** The ball's x: component 0 of the output `ball`. */
export const BALL_X = 'outputs/ball/0';
/** The ball's first hit on the floor: the first `hit` row naming both. */
export const FIRST_HIT: JsonObject = { list: 'occurrences', filter: { kinds: ['hit'], ids: ['ball', 'floor'] }, nth: 'first' };
export const X_AT_FIRST_HIT: JsonObject = { output: { path: BALL_X, at: FIRST_HIT } };
export const X_AT_FIRST_HIT_TEXT = `output ${BALL_X} at the first hit of ball and floor`;
/** Straight down from (5, 3, 0); the ball is at x ≈ 0 at step 0, so only the floor lies under it. */
export const RAY_DOWN: JsonObject = { ray: { from: [5, 3, 0], dir: [0, -1, 0] } };
export const SWEEP_DOWN: JsonObject = { sweep: { shape: sphere(0.1), from: { pos: [5, 3, 0] }, to: { pos: [5, -1, 0] } } };
export const OVERLAP_FLOOR: JsonObject = { overlap: { shape: box([0.5, 0.5, 0.5]), at: { pos: [5, 0, 0] } } };
export const STEP_0: JsonObject = { step: 0 };

/** `{"call": "query", world, steps, store, probe, expect, …extra}`: physics.query over the bake of `world` kept in `store`. */
export const query = (w: JsonObject, store: string, probe: JsonObject, expectation: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ call: 'query', world: w, steps: STEPS, store, probe, expect: expectation, ...extra });

export interface Result { value: number | null; step: number; ids: string[]; machines: string; raw: JsonObject }
export interface Checked { verdict: string; result: Result | null; what: string; raw: JsonObject }
/** A physics.query reply: ok, its verdict, its `what`, and its result when it has one. */
export function checked(reply: JsonObject | undefined, what: string): Checked {
  expect(reply?.['ok'], `${what}: physics.query ran (ok: true): ${show(reply)}`).toBe(true);
  const verdict = reply!['verdict'];
  expect(['PASS', 'FAIL', 'BLOCKED'], `${what}: a verdict PASS, FAIL or BLOCKED: ${show(reply)}`).toContain(verdict as string);
  const r = reply!['result'];
  return { verdict: String(verdict), result: r === null || r === undefined ? null : resultFrom(r, `${what}: result`), what: typeof reply!['what'] === 'string' ? reply!['what'] : '', raw: reply! };
}
function resultFrom(v: JsonValue, what: string): Result {
  const r = obj(v, what);
  const value = r['value'] === null ? null : num(r['value'], `${what}.value`);
  const step = num(r['step'], `${what}.step`);
  expect(Number.isInteger(step), `${what}.step is a step number, got ${show(r['step'])}`).toBe(true);
  const ids = arr(r['ids'], `${what}.ids`).map((x, i) => { expect(typeof x, `${what}.ids[${i}] is an ID`).toBe('string'); return x as string; });
  expect(['any', 'same'], `${what}.machines is any or same, got ${show(r['machines'])}`).toContain(r['machines'] as string);
  return { value, step, ids, machines: String(r['machines']), raw: r };
}
/** The result of a check that ran its probe. */
export function resultOf(c: Checked, what: string): Result {
  expect(c.result, `${what}: the check has a result: ${show(c.raw)}`).not.toBeNull();
  return c.result!;
}

// ---------------------------------------------------------------------------------------------------
// Judges

/** Criterion 1: query() calls the counting backend saw, by kind (README: `backend_calls`); an absent count is 0. */
export interface QueryCounts { ray: number; sweep: number; overlap: number }
export function queryCounts(reply: JsonObject | undefined, what: string): QueryCounts {
  const calls = obj(answered(reply, what)['calls'], `${what}: calls`);
  const q = calls['query'] === undefined ? {} : obj(calls['query'], `${what}: calls.query`);
  const n = (k: keyof QueryCounts): number => (q[k] === undefined ? 0 : num(q[k], `${what}: calls.query.${k}`));
  return { ray: n('ray'), sweep: n('sweep'), overlap: n('overlap') };
}
/** Every probe of each kind reached the backend through query(), one call each; a failure names the call. */
export function throughQueryFailures(counts: QueryCounts, probes: QueryCounts): string[] {
  return (['ray', 'sweep', 'overlap'] as const).filter((k) => counts[k] !== probes[k])
    .map((k) => `query(${k}) reached the test backend ${counts[k]} time(s) for ${probes[k]} physics.query ${k} probe(s): every one must arrive through the backend interface's query()`);
}

/** Criterion 4: the result's `machines` for a probe, given where the bake's golden stands; a failure names the probe. */
export function machinesFailures(c: Checked, want: 'same' | 'any', probe: string, standing: string): string[] {
  const got = c.result?.machines;
  return got === want ? [] : [`the probe ${probe} reports machines: ${got ?? '(no result)'} on a bake whose golden ${standing}; want ${want} (${show(c.raw)})`];
}

/** Criterion 3: #411's module_missing answer naming physics, with no snapshot, empty or not, and nothing drawn. */
export function moduleMissingFailures(reply: JsonObject | undefined): string[] {
  const f: string[] = [];
  if (reply?.['code'] !== 'module_missing') f.push(`physics shapes answers code ${show(reply?.['code'])}, not module_missing: ${show(reply)}`);
  if (reply?.['module'] !== 'physics') f.push(`the answer names module ${show(reply?.['module'])}, not physics`);
  const emptyOrAbsent = (v: JsonValue | undefined): boolean => v === undefined || (Array.isArray(v) && v.length === 0);
  if (!emptyOrAbsent(reply?.['snapshots'])) f.push(`it returns snapshots ${show(reply?.['snapshots'])}: never a snapshot, empty or not`);
  if (!emptyOrAbsent(reply?.['drawn'])) f.push(`it returns drawn rows ${show(reply?.['drawn'])}`);
  return f;
}

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1919D0${String(n).padStart(16, '0')}`;
