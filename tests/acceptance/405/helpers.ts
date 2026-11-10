// Test-side tools for the #405 acceptance tests: `deep-show` built per Cargo feature set (in release too, for the
// budgets) and driven by JSON lines (#393's `deep-show run`, #403's claims, requirements and `verdict`); the scenes
// the criteria describe, generated here so every file judges the same documents; and reading the geometry audit's
// row off a verdict. Nothing here stands in for the audit, the sweep, the interval forms or the evaluation: every
// value a test compares comes from a binary, every expected value from the issue's text and the design. Parts are
// copied from #408's and #1732's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/405 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

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
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` per Cargo feature set, copied out of target/ under its own name.

/** A feature set, debug unless `release`. */
export interface Build { features: string[]; release?: boolean }
export const FULL: Build = { features: ['full'] };
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
    dir = mkdtempSync(join(tmpdir(), 'deep-405-bins-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-405-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: scenes', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it acts as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB405D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB405C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB405Q', n)}`;

/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check }] });

/** The scenario: the documents on the panel (each shown by a call), the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: readonly string[], claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])), claims, ...(planted ? { planted } : {}), calls,
  };
}

/** The working agent's deep_show of a whole revision (#393's agent form: no `id`, no `layers`). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** An answer to the approval ask open on a claim's requirement (README: The answer call): from you, or from the agent. */
export const answer = (claim: string, requirement: string, who: 'you' | 'agent'): JsonObject =>
  ({ call: 'answer', ...(who === 'you' ? { peer: YOU_PEER } : { session: ALPHA.id }), claim, requirement, answer: 'yes' });

/** The show was presented, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const unknown = [...notices, ...issues].filter((n) => n['code'] === 'unknown_kind');
  expect(unknown.map((n) => brief(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 3000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** One issue on a requirement's row; `ids` with any sub-address `<id>#<part>` read as `<id>`, sorted. */
export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { result: string; issues: Issue[]; raw: JsonObject }

/** A field: on the issue itself, else in its `actual`. */
export function field(o: JsonObject, name: string): JsonValue | undefined {
  if (name in o) return o[name];
  const actual = o['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
function idsOf(issue: JsonObject): string[] {
  const v = field(issue, 'ids');
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return [...new Set(list.map((s) => s.split('#')[0]!))].sort();
}
/** The row of requirement `req` in a verdict. */
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).map((x, i) => {
    const o = obj(x, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), ids: idsOf(o), raw: o };
  });
  return { result: String(raw!['result']), issues, raw: raw! };
}
/** The issues that count against a check: errors and warnings. */
export const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');

/** A planted fault: the audit's code and the part IDs it names. */
export type Fault = readonly [code: string, ids: readonly string[]];
const faultKey = (code: string, ids: readonly string[]): string => `${code} [${[...ids].sort().join(', ')}]`;

/** The row FAILs, and its errors and warnings are exactly `faults`, each an error: no more, no fewer, no other part named. */
export function exactFaultFailures(row: Row, faults: readonly Fault[], what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const left = raised(row).map((i) => ({ key: faultKey(i.code, i.ids), issue: i }));
  for (const [code, ids] of faults) {
    const key = faultKey(code, ids);
    const k = left.findIndex((x) => x.key === key);
    if (k < 0) { failures.push(`${what} reports no ${key}; it reports: ${left.map((x) => x.key).join('; ') || 'nothing'}`); continue; }
    if (left[k]!.issue.severity !== 'error') failures.push(`${what}: ${key} is a ${left[k]!.issue.severity}, not an error`);
    left.splice(k, 1);
  }
  for (const x of left) failures.push(`${what} reports ${x.key}, which isn't a planted fault: ${brief(x.issue.raw, 600)}`);
  return failures;
}
/** The row PASSes, and nothing is raised against it. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${faultKey(i.code, i.ids)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}

/** The verdict's approval asks on requirement `req` (#200's `asks`, `{kind: "approval", requirement, …}`). */
export function approvalAsks(v: JsonObject, req: string): JsonObject[] {
  const asks = Array.isArray(v['asks']) ? v['asks'].filter(isObject) : [];
  return asks.filter((a) => a['kind'] === 'approval' && a['requirement'] === req);
}

/** A sweep failure's control and the control's value where the audit found it: `sweep: {control, value}`. */
export function sweepOf(issue: JsonObject): { control: string | null; value: number | null } {
  const s = field(issue, 'sweep');
  const control = isObject(s) && typeof s['control'] === 'string' ? s['control'] : null;
  const value = isObject(s) && typeof s['value'] === 'number' && Number.isFinite(s['value']) ? s['value'] : null;
  return { control, value };
}
/** Why a row is refused: the entries of its `blocked` list (where #464's `display_only` refusal sits) or `refused`. */
export function refusalsOf(row: Row): JsonObject[] {
  return ['blocked', 'refused'].flatMap((k) => (Array.isArray(row.raw[k]) ? (row.raw[k] as JsonValue[]).filter(isObject) : []));
}
/** Whether `v` is the range `[lo, hi]`. */
export const isRange = (v: JsonValue | undefined, lo: number, hi: number): boolean =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && near(v[0], lo) && near(v[1], hi);
/** The row's estimates: `estimates: [{control, samples: [value | {value}]}]`. */
export function estimatesOf(row: Row): { control: string | null; samples: number[] | null; raw: JsonObject }[] {
  const list = Array.isArray(row.raw['estimates']) ? row.raw['estimates'].filter(isObject) : [];
  return list.map((e) => {
    const s = e['samples'];
    const values = Array.isArray(s) ? s.map((x) => (typeof x === 'number' ? x : isObject(x) && typeof x['value'] === 'number' ? x['value'] : null)) : null;
    return {
      control: typeof e['control'] === 'string' ? e['control'] : null,
      samples: values && values.every((x): x is number => x !== null) ? values : null,
      raw: e,
    };
  });
}
/** A timing reading on a row, `timing.<key>` in ms: null when it isn't a finite number ≥ 0. */
export function timingOf(row: Row, key: string): number | null {
  const t = row.raw['timing'];
  const v = isObject(t) ? t[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

// ---------------------------------------------------------------------------------------------------
// Scenes (README: The scenes). Metres, +Y up; `mark.box@1`, `mark.sphere@1` and `mark.cylinder@1` are unit solids
// centred on `at.pos` and scaled by `params.size` (a cylinder's axis +Y); `tube@1` runs along its points at `radius`.

export type V3 = [number, number, number];
const box = (size: V3, pos: V3): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos } });
const sphere = (d: number, pos: V3): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [d, d, d] }, at: { pos } });
const cylinder = (d: number, h: number, pos: V3): JsonObject => ({ kind: 'mark.cylinder@1', params: { size: [d, h, d] }, at: { pos } });
const tube = (path: V3[], radius: number): JsonObject => ({ kind: 'tube@1', params: { path, radius } });

/** A scene in the agent's form: each item given its ID, name and draw order, in the order listed. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}, modules: readonly string[] = ['scene3d']): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #405 acceptance fixture.`, size: [640, 480],
    requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, ...extra, items: out,
  };
}

// ---- Criterion 1: a small figure with three planted faults, and its clean twin

/** The audit's tolerances for the figures: a cable's 1.5 mm end cap sinks less than `sunk` into the socket it lands on. */
const TOLERANCE: JsonObject = { sunk: 0.003, touch: 0.001, land: 0.001 };
/** The definition's check: the base plate and the cable may float (the base is the figure's ground; the cable hangs by its ends). */
export const FIGURE_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', tolerance: TOLERANCE, support: { floating: ['base', 'cable'] } };
/** The broken figure's planted faults, by part ID; its clean twin has none. */
export const PLANTED: readonly Fault[] = [
  ['geometry.overlap', ['bracket', 'housing']],
  ['geometry.floating', ['washer']],
  ['geometry.unlanded', ['cable']],
];
/**
 * The figure on a 0.4 × 0.02 × 0.3 m base plate (top at y = 0.02), every part resting on what's under it:
 * - `housing`, a 0.1 × 0.08 × 0.1 m box at x −0.18 to −0.08, z −0.05 to 0.05;
 * - `bracket`, a 0.04 × 0.06 × 0.04 m box 0.01 m in front of the housing (z 0.06 to 0.10); broken, 0.03 m further back
 *   (z 0.03 to 0.07), so it passes 0.02 m into the housing;
 * - `knob`, a 0.04 m sphere on the thin post `stand`, its centre 0.016 m right of and above the housing's top-right
 *   edge: its true shape clears the housing by 2.6 mm, while its bounds pass 4 mm into the housing's (a fault an audit
 *   of bounds, not true shapes, would report);
 * - `washer`, a 0.03 m disc 0.004 m thick on the plate; broken, 0.05 m above it, touching nothing;
 * - `socket-a` and `socket-b`, 0.04 m boxes at x 0.06 and 0.16, tops at y 0.06;
 * - `cable`, a 1.5 mm tube from the top of socket-a up 0.05 m, across and down onto the top of socket-b; broken, it
 *   stops 0.05 m above socket-b, its end in the air.
 */
export function figure(broken: boolean): JsonObject {
  const path: V3[] = [[0.06, 0.06, 0], [0.06, 0.11, 0], [0.16, 0.11, 0], ...(broken ? [] : [[0.16, 0.06, 0] as V3])];
  return scene(broken ? 'A figure with three faults' : 'A figure with none', {
    base: box([0.4, 0.02, 0.3], [0, 0.01, 0]),
    housing: box([0.1, 0.08, 0.1], [-0.13, 0.06, 0]),
    bracket: box([0.04, 0.06, 0.04], [-0.13, 0.05, broken ? 0.05 : 0.08]),
    stand: box([0.02, 0.076, 0.02], [-0.064, 0.058, 0]),
    knob: sphere(0.04, [-0.064, 0.116, 0]),
    washer: cylinder(0.03, 0.004, [0.11, broken ? 0.072 : 0.022, 0.09]),
    'socket-a': box([0.04, 0.04, 0.04], [0.06, 0.04, 0]),
    'socket-b': box([0.04, 0.04, 0.04], [0.16, 0.04, 0]),
    cable: tube(path, 0.0015),
  });
}

// ---- Criterion 2: a vase 0.2 m above a table, declared floating only in the document's own checks

/** A 4 m floor (top at 0.1 m), a 1.2 × 0.75 × 0.8 m table on it (top at 0.85 m), and a vase 0.2 m above the table. */
export function vaseScene(): JsonObject {
  return scene('A vase above a table', {
    floor: box([4, 0.1, 4], [0, 0.05, 0]),
    table: box([1.2, 0.75, 0.8], [0, 0.475, 0]),
    vase: cylinder(0.15, 0.3, [0, 1.2, 0]),
  }, { checks: [{ kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor', 'vase'] } }] });
}
/** The locked definition's check: the floor may float, and nothing else. */
export const VASE_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor'] } };
/** The same check with the agent's exception named in the definition itself. */
export const VASE_CHECK_NAMED: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor', 'vase'] } };

// ---- Criterion 3: a lid a slider lifts toward a shelf 0.03 m above it

/** The lift the driver sets from the slider's value s, in m: 0.05·exp(−((s − 0.6) ÷ 0.05)²). */
export const lift = (s: number): number => 0.05 * Math.exp(-(((s - 0.6) / 0.05) ** 2));
/** The five samples of a 5-sample sweep over [0, 1]: evenly spaced, both ends included. */
export const SAMPLES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];
export const SLIDER = 'lift';
/** The slider s, a document control over [0, 1] at 0 by default. */
const SLIDER_CONTROL: JsonObject = { kind: 'slider', class: 'document', label: 'Lift', role: 'slider', range: [0, 1], default: 0 };
const LIFT_EXPR = (rest: number): string => `${rest} + 0.05 * exp(-pow((s - 0.6) / 0.05, 2))`;
/** A 0.7 m base plate (top at 0.02 m) and two posts at x ±0.28 under a 0.6 × 0.02 × 0.3 m shelf whose underside is at `under`. */
function frame(under: number): Record<string, JsonObject> {
  const post = (x: number): JsonObject => box([0.04, under - 0.02, 0.04], [x, (under + 0.02) / 2, 0]);
  return { base: box([0.7, 0.02, 0.4], [0, 0.01, 0]), 'post-l': post(-0.28), 'post-r': post(0.28), shelf: box([0.6, 0.02, 0.3], [0, under + 0.01, 0]) };
}
/**
 * The lid, a 0.3 × 0.02 × 0.3 m box resting on the base (top at 0.04 m), under the shelf at 0.07 m: 0.03 m above the
 * lid's top. The driver `raise` writes the lid's y, 0.03 + lift(s), from the slider. It passes into the shelf only for
 * s in (0.5643, 0.6357), 0.02 m deep at s = 0.6, and rises under 1 mm at every sample.
 */
export function lidScene(): JsonObject {
  return scene('A lid under a shelf', { ...frame(0.07), lid: box([0.3, 0.02, 0.3], [0, 0.03, 0]) }, {
    controls: { [SLIDER]: SLIDER_CONTROL },
    drivers: { raise: { target: 'items/lid/at/pos/1', expr: LIFT_EXPR(0.03), vars: { s: `controls/${SLIDER}/value` } } },
  }, ['scene3d', 'motion', 'input']);
}
/** The definition's sweep of the slider with 5 samples; the base and the lid (which the slider lifts) may float. */
export const LID_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', sweeps: { [SLIDER]: 5 }, support: { floating: ['base', 'lid'] } };
/**
 * The same lid lifted through a physics world instead: the lid is the one body `lid` of the baked world `lift-world`
 * (#419's `fixture.world@1`, the physics module's baked world as a scene draws it; zero gravity, so its bake holds the
 * body where it starts), a 0.05 m-radius sphere resting on the base (top at 0.12 m) under the shelf at 0.15 m. The
 * driver `raise` writes the body's starting height, 0.07 + lift(s), from the slider, so the slider moves the lid
 * only through the world.
 */
export function physicsLidScene(): JsonObject {
  return scene('A lid a physics world lifts', {
    ...frame(0.15),
    'lift-world': { kind: 'fixture.world@1', params: { step_hz: 60, span: '1s', gravity: 0, floor: -1, restitution: 0, bodies: { lid: { radius: 0.05, pos: [0, 0.07, 0] } } } },
  }, {
    controls: { [SLIDER]: SLIDER_CONTROL },
    drivers: { raise: { target: 'items/lift-world/params/bodies/lid/pos/1', expr: LIFT_EXPR(0.07), vars: { s: `controls/${SLIDER}/value` } } },
  }, ['scene3d', 'motion', 'input']);
}
/** The definition's sweep of the slider over the physics lid. */
export const PHYSICS_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', sweeps: { [SLIDER]: 5 }, support: { floating: ['base'] } };

// ---- Criterion 4: a 1,000-part figure, and the same parts rendered for the determinism check

export const BIG = { rows: 27, cols: 37, pitch: 0.05, size: 0.04 } as const;
/** 999 parts and the plate: 1,000. */
export const BIG_PARTS = BIG.rows * BIG.cols + 1;
export const partId = (k: number): string => `part-${String(k).padStart(3, '0')}`;
/** The nine parts shifted 0.02 m along +x into their right-hand neighbour: row 3j + 1, column 4j + 2. */
const SHIFTED = Array.from({ length: 9 }, (_, j) => BIG.cols * (3 * j + 1) + 4 * j + 2);
/** The 1,000-part figure's planted faults: each shifted part passes 0.01 m into its neighbour. */
export const BIG_PLANTED: readonly Fault[] = SHIFTED.map((k) => ['geometry.overlap', [partId(k), partId(k + 1)]] as const);
/**
 * A 1.95 × 0.02 × 1.45 m plate (top at 0.02 m) and 999 parts on it in 27 rows of 37, 0.05 m apart: 0.04 m boxes,
 * cylinders and spheres in turn (part k's kind by k mod 3), each resting on the plate, 0.01 m from its neighbours,
 * except the nine shifted parts. With `render`, a camera and a sun for the determinism check's renders.
 */
export function bigFigure(render: boolean): JsonObject {
  const items: Record<string, JsonObject> = { plate: box([BIG.cols * BIG.pitch + 0.1, 0.02, BIG.rows * BIG.pitch + 0.1], [0, 0.01, 0]) };
  for (let k = 0; k < BIG.rows * BIG.cols; k++) {
    const [r, c] = [Math.floor(k / BIG.cols), k % BIG.cols];
    const pos: V3 = [-0.9 + BIG.pitch * c + (SHIFTED.includes(k) ? 0.02 : 0), 0.02 + BIG.size / 2, -0.65 + BIG.pitch * r];
    items[partId(k)] = k % 3 === 0 ? box([BIG.size, BIG.size, BIG.size], pos) : k % 3 === 1 ? cylinder(BIG.size, BIG.size, pos) : sphere(BIG.size, pos);
  }
  if (render) {
    items['cam'] = { kind: 'camera@1', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 45, distance: 5 }, view_width: 2.4 } };
    items['sun'] = { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [-50, 30, 0] } };
  }
  return scene(render ? 'A thousand parts, rendered' : 'A thousand parts', items, render ? { size: [1920, 1080], camera: 'cam', transport: { span: '1s' } } : {});
}
export const BIG_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', tolerance: TOLERANCE, support: { floating: ['plate'] } };
export const BIG_DETERMINISM: JsonObject = { kind: 'document.determinism', at_times: ['0s', '0.5s', '1s'], compare: 'same_machine' };

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
