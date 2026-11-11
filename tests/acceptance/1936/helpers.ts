// Test-side tools for the #1936 acceptance tests: `deep-show` built with the `full` feature set and driven by JSON
// lines (#393's `deep-show run`, #403's claims, requirements and `verdict`, #96's stored documents and patches); the
// scenes the criteria describe, generated here so every test judges the same documents; reading the geometry
// audit's row off a verdict; and sending a failure's fix back as a patch. Nothing here stands in for the audit or
// for a patch op: every value a test compares comes from the binary, every expected value from the issue's text
// and the design. Parts are copied from #405's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1936 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/.

/** Builds once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1936-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}`, ran: false }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '', ran: true };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1936-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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
// The world a scenario holds: the working agent alpha, the process table, one panel, and stored documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: scenes', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1936D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1936C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1936Q', n)}`;

/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check }] });

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims, ...(planted ? { planted } : {}), calls,
  };
}

export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** The working agent's patch of a stored document's revision 0 (Patch: `{patch, doc, base, reason, ops}`), as #96's `deep_show` carries one. */
export const patch = (doc: string, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, patch: { patch: ulid('01JB1936P', 1), doc, base: 0, reason: 'the fix the geometry audit names', ops } });

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** One issue on a requirement's row; `ids` with any sub-address `<id>#<part>` read as `<id>`, sorted. */
export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { result: string; issues: Issue[]; raw: JsonObject }

/** A field: on the issue itself, else in its `actual`. */
function field(o: JsonObject, name: string): JsonValue | undefined {
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

/** A fault: the audit's code and the item IDs it names. */
export type Fault = readonly [code: string, ids: readonly string[]];
const faultKey = (code: string, ids: readonly string[]): string => `${code} [${[...ids].sort().join(', ')}]`;
const reported = (issues: readonly Issue[]): string => issues.map((i) => faultKey(i.code, i.ids)).join('; ') || 'nothing';

/** The row FAILs, and its errors and warnings are exactly `faults`, each an error: no more, no fewer, no other item named. */
export function exactFaultFailures(row: Row, faults: readonly Fault[], what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const left = raised(row);
  for (const [code, ids] of faults) {
    const key = faultKey(code, ids);
    const k = left.findIndex((i) => faultKey(i.code, i.ids) === key);
    if (k < 0) { failures.push(`${what} reports no ${key}; it reports: ${reported(left)}`); continue; }
    if (left[k]!.severity !== 'error') failures.push(`${what}: ${key} is a ${left[k]!.severity}, not an error`);
    left.splice(k, 1);
  }
  for (const i of left) failures.push(`${what} reports ${faultKey(i.code, i.ids)}, which the fixture doesn't hold: ${brief(i.raw, 600)}`);
  return failures;
}
/** The row PASSes, and nothing is raised against it. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${faultKey(i.code, i.ids)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}
/**
 * The row FAILs with at least one error, and every error or warning is `code` naming exactly `pair`, with its `gap`
 * (m) within 0.00001 m of `gap`. More than one such issue may be raised: one for each two edges that don't meet.
 */
export function gapFailures(row: Row, code: string, pair: readonly string[], gap: number, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const key = faultKey(code, pair);
  const all = raised(row);
  if (!all.some((i) => faultKey(i.code, i.ids) === key)) failures.push(`${what} reports no ${key}; it reports: ${reported(all)}`);
  for (const i of all) {
    if (faultKey(i.code, i.ids) !== key) { failures.push(`${what} reports ${faultKey(i.code, i.ids)}, which the fixture doesn't hold: ${brief(i.raw, 600)}`); continue; }
    if (i.severity !== 'error') failures.push(`${what}: ${key} is a ${i.severity}, not an error`);
    const g = field(i.raw, 'gap');
    if (typeof g !== 'number' || Math.abs(g - gap) > 1e-5) failures.push(`${what}: ${key} names the gap ${brief(g)}, not ${gap} m: ${brief(i.raw, 600)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// A fix as patch ops (README: A fix as patch ops), and what its patch achieved

/** A failure's fix as patch ops: `fix` as a list of ops, or as `{ops}`; null when it is text, empty or absent. */
export function fixOps(issue: Issue): JsonObject[] | null {
  const fix = issue.raw['fix'];
  const list = Array.isArray(fix) ? fix : isObject(fix) && Array.isArray(fix['ops']) ? fix['ops'] : null;
  return list !== null && list.length > 0 && list.every(isObject) ? list : null;
}
/** Why `ops` don't remove one of `ids` and nothing else: each op a `delete` of one of them, one item deleted in all. */
export function removesOneFailures(ops: readonly JsonObject[], ids: readonly string[], what: string): string[] {
  const failures = ops.filter((op) => !(op['op'] === 'delete' && typeof op['id'] === 'string' && ids.includes(op['id'])))
    .map((op) => `${what}: ${brief(op)} isn't a delete of ${ids.join(' or ')}`);
  const gone = new Set(ops.filter((op) => op['op'] === 'delete').map((op) => String(op['id'])));
  if (gone.size !== 1) failures.push(`${what} deletes ${gone.size} items (${[...gone].join(', ') || 'none'}), not one`);
  return failures;
}
/** Why `ops` aren't a snap or a move of one of `ids`: each op a `set` at or under that item's `at`. */
export function movesFailures(ops: readonly JsonObject[], ids: readonly string[], what: string): string[] {
  const moves = (op: JsonObject): boolean => {
    const [id, path] = [op['id'], op['path']];
    return op['op'] === 'set' && typeof id === 'string' && ids.includes(id) && typeof path === 'string' && (path === `items/${id}/at` || path.startsWith(`items/${id}/at/`));
  };
  return ops.filter((op) => !moves(op)).map((op) => `${what}: ${brief(op)} isn't a set at items/<id>/at of ${ids.join(' or ')}`);
}
/** The patch was applied; what it achieved (Patch: result), as counts of items created, updated and deleted. */
export function achieved(reply: JsonObject, what: string): { created: number; updated: number; deleted: number } {
  expect(reply['outcome'], `${what} is applied: ${brief(reply, 3000)}`).toBe('applied');
  const a = obj(reply['achieved'], `${what}: achieved`);
  const count = (v: JsonValue | undefined): number => (isObject(v) ? Object.values(v).reduce<number>((n, x) => n + (typeof x === 'number' ? x : 0), 0) : Number.NaN);
  return { created: count(a['created']), updated: typeof a['updated'] === 'number' ? a['updated'] : Number.NaN, deleted: count(a['deleted']) };
}

// ---------------------------------------------------------------------------------------------------
// Scenes (README: Fixtures). Metres, +Y up. `mark.box@1` is a unit box centred on `at.pos` and scaled by
// `params.size`. `plate@1` is a one-sided sheet of `size[0]` × `size[1]` m in its own XZ plane, centred on `at.pos`
// and turned by `at.rot` (degrees about X, then Y, then Z): its four sides are its boundary edges.

type V3 = [number, number, number];
const box = (size: V3, pos: V3): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos } });
const plate = (size: [number, number], pos: V3, rot: V3): JsonObject => ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos, rot } });
const LAYER = 'alpha-main';

/** A scene as the hub stores it (#96): alpha's writer layer, and each item given its ID, name, draw order and layer. */
function stored(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1936 acceptance fixture.`, size: [640, 480],
    requires: { modules: { scene3d: '^1' } },
    layers: { [LAYER]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
    ...extra, items: out,
  };
}

/** The ground every scene stands on: a 6 × 0.2 × 6 m box whose top is at y = 0. Each check declares it floating. */
const FLOOR = box([6, 0.2, 6], [0, -0.1, 0]);
const SUPPORT: JsonObject = { floating: ['floor'] };

/** The codes the scene audit gains (README: The verdict's row). */
export const COINCIDENT = 'geometry.coincident';
export const OFF_GRID = 'geometry.off_grid';
export const SEAM = 'geometry.seam';
/** The planted audit that checks only overlaps (README: The planted program). */
export const OVERLAPS_ONLY = 'audit_checks_overlaps_only';

// ---- Criterion 1: one wall held twice

/** The two IDs the one wall is held under. */
export const WALLS: readonly string[] = ['wall', 'wall-again'];
/**
 * The floor and one wall, a 4 × 2 × 0.2 m box standing on it at z = −2, held under two IDs with the same kind,
 * params and `at`, as a patch that adds it twice leaves them. `apart` shifts `wall-again` that far along +x, in m:
 * 0 for the wall added twice, 0.001 for the same pair 1 mm apart.
 */
export function wallTwice(apart: number): JsonObject {
  return stored(apart === 0 ? 'A wall added twice' : 'The same two walls apart', {
    floor: FLOOR, wall: box([4, 2, 0.2], [0, 1, -2]), 'wall-again': box([4, 2, 0.2], [apart, 1, -2]),
  });
}
/** The definition's check on the walls: the scene audit with its defaults; the floor may float. */
export const WALL_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: SUPPORT };

// ---- Criterion 2: a kit room, open at the front

/** The collection of the room's kit pieces: its three walls. */
const KIT = 'kit';
/** The wall the fixtures move, and the one wall whose edge it meets. */
export const MOVED = 'wall-right';
export const SEAM_PAIR: readonly string[] = ['wall-back', MOVED];
/**
 * The floor and three kit walls standing on it, each a 4 × 2 m sheet with its origin at its centre, 1 m up:
 * - `wall-back` in the plane z = −2, from x = −2 to 2 (origin (0, 1, −2), yaw 0);
 * - `wall-left` in the plane x = −2, from z = −2 to 2 (origin (−2, 1, 0), yaw 90);
 * - `wall-right` in the plane x = `rightX`, from z = −2 to 2 (origin (`rightX`, 1, 0), yaw −90).
 * With `rightX` 2 every origin is on whole metres, and each side wall's back edge lies on an end edge of the back
 * wall. A larger `rightX` slides `wall-right` along the floor, away from the back wall's end.
 */
export function kitRoom(rightX: number): JsonObject {
  return stored('A kit room', {
    floor: FLOOR,
    'wall-back': plate([4, 2], [0, 1, -2], [90, 0, 0]),
    'wall-left': plate([4, 2], [-2, 1, 0], [90, 90, 0]),
    [MOVED]: plate([4, 2], [rightX, 1, 0], [90, -90, 0]),
  }, { collections: { [KIT]: { members: ['wall-back', 'wall-left', MOVED] } } });
}
/** The definition's check that the kit is on its grid: a 1 m unit, a 0.5 m sub-grid. */
export const GRID_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: SUPPORT, grid: { unit: 1, sub: 0.5, items: KIT } };
/** The definition's check that the kit's seams meet, with `max_gap` left at its default of 0.001 m. */
export const SEAMS_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: SUPPORT, seams: { pairs: [[KIT, KIT]] } };
