// Test-side tools for the #2011 acceptance tests (README: The surface under test). They extend #2009's surface (the
// `deep-physics` binary, built once per file by ../2009/helpers.ts, and its world document) with the `pairs` call, roles
// on shape uses, `sensor_enter` occurrences in a bake, mesh, convex and compound shapes, and the step-budget check
// `node scripts/physics-budget.mjs`. Nothing here stands in for the physics module: every verdict, matrix, occurrence,
// state and timing read here is the program's own; the expected values come from the issue's text, worked out here.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { CARGO_ENV, REPO, TIMEOUT, arr, isObject, obj, physicsBin, show, world, type JsonObject, type JsonValue } from '../2009/helpers.ts';

export * from '../2009/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = { 1: '#2011.3daf6b1d', 2: '#2011.a8a76103', 3: '#2011.b8ab4f30' } as const;

const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// deep-physics, with this suite's planted name (README: Planted wrong programs)

export type Planted = 'role_table_pickup_solid';
/** Runs `calls` through one `deep-physics [--planted p]` process: exit 0, one JSON reply per call, in order. */
export function ask(calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  const what = `deep-physics ${args.join(' ')}`.trim();
  const run = spawnSync(physicsBin(), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

// ---------------------------------------------------------------------------------------------------
// Shape uses (README: ShapeUse): a body's `shapes[index]`, which names `shape`

export interface Use { body: string; index: number; shape: string }
export const use = (body: string, shape: string, index = 0): Use => ({ body, index, shape });
const label = (u: Use): string => `${u.body}/shapes/${u.index} (${u.shape})`;
export const isUse = (v: JsonValue | undefined, u: Use): boolean => isObject(v) && v['body'] === u.body && v['index'] === u.index && v['shape'] === u.shape;
/** `pair` is [a, b] in either order. */
export const isUsePair = (pair: JsonValue | undefined, a: Use, b: Use): boolean =>
  Array.isArray(pair) && pair.length === 2 && ((isUse(pair[0], a) && isUse(pair[1], b)) || (isUse(pair[0], b) && isUse(pair[1], a)));
export const isGroupPair = (pair: JsonValue | undefined, a: string, b: string): boolean =>
  Array.isArray(pair) && pair.length === 2 && ((pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a));

// ---------------------------------------------------------------------------------------------------
// physics.pairs (README: `pairs`)

export interface Brief { touch?: [string, string][]; never?: [string, string][] }
export const pairsCall = (w: JsonObject, brief: Brief = {}): JsonObject => ({ call: 'pairs', world: w, brief: brief as unknown as JsonValue });

export interface Pairs { verdict: JsonValue | undefined; groups: JsonValue[]; matrix: JsonObject[]; shapes: JsonObject[]; failures: JsonObject[] }
/** A `pairs` reply that ran (ok: true), its lists read. */
export function pairsOf(reply: JsonObject, what: string): Pairs {
  expect(reply['ok'], `${what}: physics.pairs ran (the \`pairs\` call answers ok: true): ${show(reply)}`).toBe(true);
  const list = (key: string): JsonObject[] => arr(reply[key], `${what}: ${key}`).map((v, i) => obj(v, `${what}: ${key}[${i}]`));
  return { verdict: reply['verdict'], groups: arr(reply['groups'], `${what}: groups`), matrix: list('matrix'), shapes: list('shapes'), failures: list('failures') };
}

/** The matrix holds each unordered pair of `groups` once, a self pair included, and `want` gives each one's `interacts`. */
export function matrixFailures(p: Pairs, groups: readonly string[], want: (a: string, b: string) => boolean): string[] {
  const f: string[] = [];
  const n = groups.length;
  if (p.matrix.length !== (n * (n + 1)) / 2) f.push(`the matrix holds ${p.matrix.length} group pairs, not ${(n * (n + 1)) / 2} (${n} groups, each pair once, self pairs included)`);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const [a, b] = [groups[i]!, groups[j]!];
      const hits = p.matrix.filter((m) => isGroupPair([m['a'] ?? null, m['b'] ?? null], a, b));
      if (hits.length !== 1) { f.push(`the matrix holds ${a}–${b} ${hits.length} times, not once`); continue; }
      if (hits[0]!['interacts'] !== want(a, b)) f.push(`the matrix says ${a}–${b} interacts: ${show(hits[0]!['interacts'])}, not ${want(a, b)}`);
    }
  }
  return f;
}

export type Contact = 'solid' | 'sensor' | 'none' | 'touch';
/** Each shape pair's `contact` is the one wanted (`touch`: solid or sensor, so they interact). */
export function contactFailures(p: Pairs, wants: [Use, Use, Contact][]): string[] {
  const f: string[] = [];
  for (const [a, b, want] of wants) {
    const hits = p.shapes.filter((s) => isUsePair([s['a'] ?? null, s['b'] ?? null], a, b));
    if (hits.length !== 1) { f.push(`physics.pairs names the shape pair ${label(a)}–${label(b)} ${hits.length} times among its shapes, not once`); continue; }
    const got = hits[0]!['contact'];
    const ok = want === 'touch' ? got === 'solid' || got === 'sensor' : got === want;
    if (!ok) f.push(`${label(a)}–${label(b)}: contact ${show(got)}, wanted ${want === 'touch' ? '"solid" or "sensor" (they touch)' : JSON.stringify(want)}`);
  }
  return f;
}

/** Failures that name the shape pair (a, b), and, when given, the lock and the group pair. */
export function failuresNaming(p: Pairs, a: Use, b: Use, lock?: string, groups?: [string, string]): JsonObject[] {
  return p.failures.filter((x) => isUsePair(x['shapes'], a, b) && (lock === undefined || x['lock'] === lock) && (groups === undefined || isGroupPair(x['pair'], groups[0], groups[1])));
}

// ---------------------------------------------------------------------------------------------------
// A bake's occurrences (README: `bake` with `occurrences: true`)

export function occurrencesOf(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  return arr(reply['occurrences'], `${what}: occurrences`).map((v, i) => obj(v, `${what}: occurrences[${i}]`));
}
export const sensorEnters = (occurrences: JsonObject[], sensor: Use, other: Use): JsonObject[] =>
  occurrences.filter((o) => o['kind'] === 'sensor_enter' && isUsePair([o['a'] ?? null, o['b'] ?? null], sensor, other));

// ---------------------------------------------------------------------------------------------------
// The step-budget check (README: `node scripts/physics-budget.mjs`)

export const BUDGET_SCRIPT = join(REPO, 'scripts', 'physics-budget.mjs');
/** A check run: release builds for this Mac and wasm32 the first time, then six runs (one untimed) a timed host. */
export const BUDGET_TIMEOUT = 2 * 3_600_000;
export const LIMIT_MS = 2;
export type Host = 'app' | 'web';
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
export const WASM32 = 'wasm32-unknown-unknown';

export interface BudgetRequest { world: JsonObject; steps: number; reference_mac: Record<Host, boolean> }
/** Runs the check on `request` (with `--planted times_only_app` when asked): exit 0, one JSON report on stdout. */
export function budget(request: BudgetRequest, planted?: 'times_only_app'): JsonObject {
  expect(existsSync(BUDGET_SCRIPT), 'the step-budget check, node scripts/physics-budget.mjs, exists (README: The surface under test)').toBe(true);
  const args = [BUDGET_SCRIPT, ...(planted ? ['--planted', planted] : [])];
  const what = `node scripts/physics-budget.mjs${planted ? ` --planted ${planted}` : ''}`;
  const env: NodeJS.ProcessEnv = { ...process.env, ...CARGO_ENV };
  const r = spawnSync(process.execPath, args, { cwd: REPO, input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 256 * MIB, env, timeout: BUDGET_TIMEOUT - 600_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (r.error && code !== 'EPIPE') throw Error(`${what}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  expect(lines.length, `${what} writes one JSON report line on stdout; got: ${stdout.slice(0, 1000)}`).toBe(1);
  const report = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the report`);
  expect(report['ok'], `${what}: the check ran (ok: true): ${show(report)}`).toBe(true);
  return report;
}

export const hostOf = (report: JsonObject, host: Host): JsonObject => obj(obj(report['hosts'], 'the report\'s hosts')[host], `the report's hosts.${host}`);

/** This machine's target triple, as rustc names its host. */
export function hostTriple(): string {
  const r = spawnSync('rustc', ['-vV'], { encoding: 'utf8', env: { ...process.env, ...CARGO_ENV } });
  const t = /^host: (\S+)$/m.exec(r.stdout ?? '')?.[1];
  if (!t) throw Error(`rustc -vV names no host: ${r.stderr ?? ''}`);
  return t;
}

/** FAIL when a host fails, else BLOCKED when one is, else INCONCLUSIVE when one is, else PASS (README: the report). */
export function combined(verdicts: JsonValue[]): Verdict {
  for (const v of ['FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const) if (verdicts.includes(v)) return v;
  return 'PASS';
}

const isInt = (v: JsonValue | undefined, min: number, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isMs = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * A host timed on this Mac as its configured reference Mac: the release build for its target (this Mac's triple for the
 * app, wasm32 in headless Chrome for the web), five runs' step p95s and their loads, a verdict the five-run rule can give
 * (PASS only with every run within, FAIL only with every run over), and its slowest step with the shape pair that ran the
 * most narrow-phase tests in it.
 */
export function timedFailures(report: JsonObject, host: Host, steps: number, triple: string): string[] {
  const h = report['hosts'];
  if (!isObject(h) || !isObject(h[host])) return [`the report has no hosts.${host}: ${show(report).slice(0, 500)}`];
  const x = h[host] as JsonObject;
  const f: string[] = [];
  const at = `hosts.${host}`;
  if (x['verdict'] === 'BLOCKED') f.push(`${at} is BLOCKED although a reference Mac is configured for it: ${show(report['asks'])}`);
  else if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(x['verdict'] as string)) f.push(`${at}.verdict is ${show(x['verdict'])}`);
  const target = host === 'app' ? triple : WASM32;
  if (x['target'] !== target) f.push(`${at}.target is ${show(x['target'])}, not ${target}: the ${host} host is timed in ${host === 'app' ? 'the app\'s own build on this Mac' : 'the wasm32 build in headless Chrome'}`);
  if (x['profile'] !== 'release') f.push(`${at}.profile is ${show(x['profile'])}, not "release": the app ships optimized builds`);
  if (host === 'web' && !(typeof x['engine'] === 'string' && /HeadlessChrome\//.test(x['engine']))) f.push(`${at}.engine is ${show(x['engine'])}, not headless Chrome's user agent`);
  if (host === 'app' && x['engine'] !== 'native') f.push(`${at}.engine is ${show(x['engine'])}, not "native"`);
  const runs = x['runs'];
  const okRuns = Array.isArray(runs) && runs.length === 5 && runs.every(isMs);
  if (!okRuns) f.push(`${at}.runs is ${show(runs)}, not five step p95s in ms`);
  const loads = x['loads'];
  if (!(Array.isArray(loads) && loads.length === 5 && loads.every((l) => isObject(l) && isMs(l['start']) && isMs(l['end'])))) f.push(`${at}.loads is ${show(loads)}, not five {start, end} load averages`);
  const limit = report['limit_ms'];
  if (okRuns && typeof limit === 'number') {
    const rs = runs as number[];
    if (x['verdict'] === 'PASS' && !rs.every((r) => r <= limit)) f.push(`${at} PASSes with a run over ${limit} ms: ${show(runs)}`);
    if (x['verdict'] === 'FAIL' && !rs.every((r) => r > limit)) f.push(`${at} FAILs with a run within ${limit} ms: ${show(runs)}`);
  }
  const s = x['slowest'];
  if (!isObject(s)) f.push(`${at}.slowest is ${show(s)}, not the slowest step`);
  else {
    if (!isInt(s['run'], 1, 5)) f.push(`${at}.slowest.run is ${show(s['run'])}, not 1 to 5`);
    if (!isInt(s['step'], 1, steps)) f.push(`${at}.slowest.step is ${show(s['step'])}, not a step from 1 to ${steps}`);
    if (!isMs(s['ms'])) f.push(`${at}.slowest.ms is ${show(s['ms'])}`);
    else if (okRuns && s['ms'] < Math.max(...(runs as number[]))) f.push(`${at}.slowest.ms ${s['ms']} is under a run's p95 (${show(runs)}), so it isn't the slowest step`);
    if (!isInt(s['tests'], 1, Number.MAX_SAFE_INTEGER)) f.push(`${at}.slowest.tests is ${show(s['tests'])}, not a count of narrow-phase tests`);
    const pair = s['pair'];
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every((u) => isObject(u) && typeof u['body'] === 'string' && isInt(u['index'], 0, 1e9) && typeof u['shape'] === 'string') && (pair[0] as JsonObject)['body'] !== (pair[1] as JsonObject)['body'])) {
      f.push(`${at}.slowest.pair is ${show(pair)}, not two shape uses on different bodies`);
    }
  }
  return f;
}

/** The report's own verdict follows its hosts', its limit is the world's default step_p95 and its asks are its BLOCKED hosts'. */
export function reportFailures(report: JsonObject): string[] {
  const f: string[] = [];
  if (report['limit_ms'] !== LIMIT_MS) f.push(`limit_ms is ${show(report['limit_ms'])}, not ${LIMIT_MS} (budget.step_p95's default)`);
  const h = report['hosts'];
  if (!isObject(h) || !isObject(h['app']) || !isObject(h['web'])) return [...f, `the report doesn't hold hosts.app and hosts.web: ${show(h)}`];
  const want = combined([(h['app'] as JsonObject)['verdict'] ?? null, (h['web'] as JsonObject)['verdict'] ?? null]);
  if (report['verdict'] !== want) f.push(`the report's verdict is ${show(report['verdict'])}, not ${want} from its hosts'`);
  if (!Array.isArray(report['asks'])) f.push(`asks is ${show(report['asks'])}, not a list`);
  return f;
}

/** Each host's verdict is the one wanted; one read INCONCLUSIVE where PASS or FAIL is wanted is a reading, not a result. */
export function verdictsOf(report: JsonObject, want: Record<Host, Verdict>): { failures: string[]; inconclusive: string[] } {
  const failures: string[] = [];
  const inconclusive: string[] = [];
  for (const host of ['app', 'web'] as const) {
    const x = hostOf(report, host);
    if (x['verdict'] === want[host]) continue;
    if (x['verdict'] === 'INCONCLUSIVE' && (want[host] === 'PASS' || want[host] === 'FAIL')) {
      inconclusive.push(`${host} (wanted ${want[host]}): runs ${show(x['runs'])}; ${String(x['reason'] ?? '')}`);
    } else failures.push(`hosts.${host}.verdict is ${show(x['verdict'])}, not ${want[host]} (runs ${show(x['runs'])}; ${String(x['reason'] ?? '')})`);
  }
  return { failures, inconclusive };
}

/** Fails the test as INCONCLUSIVE: the five-run rule read a loaded machine (or one off the reference Macs), which is not a pass. */
export function inconclusive(what: string, readings: string[]): void {
  if (readings.length) throw Error(`INCONCLUSIVE: ${what}: a reading, not a budget result:\n  ${readings.join('\n  ')}`);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2's worlds (README: The level): 50 capsules on dynamic bodies on a 30 m square floor of 20,000 triangles,
// as 100 convex slabs in a compound or as one mesh, inside four bouncing walls.

export const LEVEL = 30;
export const STRIPS = 10_000;
export const CAPSULES = 50;
export const BUDGET_STEPS = 1200;
export const capsuleId = (k: number): string => `c${String(k).padStart(2, '0')}`;
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

export function levelWorld(level: 'compound' | 'mesh'): JsonObject {
  const h = LEVEL / 2;
  const shapes: JsonObject = {
    capsule: { kind: 'capsule', half_height: 0.6, radius: 0.3 },
    wall_x: { kind: 'box', half: [0.5, 1, h + 1] },
    wall_z: { kind: 'box', half: [h + 1, 1, 0.5] },
  };
  if (level === 'compound') {
    const s = LEVEL / 10;
    shapes['slab'] = { kind: 'convex', points: [[0, 0, 0], [s, 0, 0], [0, 0, s], [s, 0, s], [0, -0.5, 0], [s, -0.5, 0], [0, -0.5, s], [s, -0.5, s]] };
    const children: JsonValue[] = [];
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) children.push({ shape: 'slab', pose: { pos: [-h + i * s, 0, -h + j * s] } });
    shapes['level'] = { kind: 'compound', children };
  } else {
    const vertices: JsonValue[] = [];
    const triangles: JsonValue[] = [];
    for (let r = 0; r <= STRIPS; r++) { const z = round(-h + (r * LEVEL) / STRIPS); vertices.push([-h, 0, z], [h, 0, z]); }
    for (let r = 0; r < STRIPS; r++) { const a = 2 * r; triangles.push([a, a + 2, a + 1], [a + 1, a + 2, a + 3]); }
    expect(triangles.length, 'the mesh level has 20,000 triangles').toBe(20_000);
    shapes['level'] = { kind: 'mesh', vertices, triangles };
  }
  const bodies: JsonObject = {
    level: { kind: 'static', shapes: [{ shape: 'level' }] },
    walls: {
      kind: 'static',
      shapes: [
        { shape: 'wall_x', offset: { pos: [-h - 0.5, 1, 0] }, contact_material: 'bouncy' },
        { shape: 'wall_x', offset: { pos: [h + 0.5, 1, 0] }, contact_material: 'bouncy' },
        { shape: 'wall_z', offset: { pos: [0, 1, -h - 0.5] }, contact_material: 'bouncy' },
        { shape: 'wall_z', offset: { pos: [0, 1, h + 0.5] }, contact_material: 'bouncy' },
      ],
    },
  };
  for (let k = 0; k < CAPSULES; k++) {
    const [i, j] = [k % 8, Math.floor(k / 8)];
    const a = (k * 137.5 * Math.PI) / 180;
    bodies[capsuleId(k)] = {
      kind: 'dynamic', mass: 80, sleep: false, locks: { angular: [true, true, true] },
      pose: { pos: [round(-h + (LEVEL * (i + 0.5)) / 8), 0.9, round(-h + (LEVEL * (j + 0.5)) / 7)] },
      velocity: { linear: [round(2 * Math.cos(a)), 0, round(2 * Math.sin(a))] },
      shapes: [{ shape: 'capsule' }],
    };
  }
  return world({
    capacity: { bodies: 64, shapes: 128, joints: 0, contacts: 100_000, particles: 0 },
    defaults: { friction: 0, restitution: 0, damping: 0 },
    contact_materials: { bouncy: { friction: 0, restitution: 1 } },
    shapes,
    bodies,
  });
}

/** The pair a mesh level's slowest step names: one capsule's use and the level's. */
export function capsuleLevelPair(pair: JsonValue | undefined): boolean {
  if (!Array.isArray(pair) || pair.length !== 2) return false;
  const level = pair.find((u) => isUse(u, use('level', 'level')));
  const other = pair.find((u) => u !== level);
  return level !== undefined && isObject(other) && typeof other['body'] === 'string' && /^c\d\d$/.test(other['body']) && other['index'] === 0 && other['shape'] === 'capsule';
}
