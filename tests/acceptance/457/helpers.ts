// Test-side tools for the #457 acceptance tests (README: Surfaces this suite assumes). `deep-show` is built with the
// `full` feature set (in release too, for the budgets) and driven by one JSON scenario line per run: #96's stored
// documents, #403's claims (with this suite's `brief.sweeps`), `verdict`, #393's `deep_show` patches and
// `render_back`, #387's `planted`, #138's `environment`. #1938's helpers are imported as they are (its `run`, its
// scenario, its row and patch-op readers, its PNG encoder), and #456's for its review room and PNG decoder. This file
// adds the build in release, the readers of camera.framing's `occluded` and `paths` results and its failures, the
// fixtures the criteria name, and the perf lane's own judge. Nothing here stands in for the check under test: every
// value a test compares comes from the binary, every expected value from the issue's text and the design.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import {
  brief, encodePng, fixOps, holds, inconclusive, isObject, none, opFailures, passFailures, putEvidence, raised, requireMetal, rowOf, run, same,
  scenarioOf, sha256, verdict, type Extra, type Issue, type JsonObject, type JsonValue, type Row,
} from '../1938/helpers.ts';

export {
  brief, fixOps, holds, inconclusive, isObject, none, opFailures, passFailures, putEvidence, raised, requireMetal, rowOf, run, same, scenarioOf,
  sha256, verdict, type Extra, type Issue, type JsonObject, type JsonValue, type Row,
};

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/457 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;
/** Flicks a second: the base's checked times and the `t` of `paths` are in flicks. */
const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with `full`, debug before the file's tests and release only when a timing can count.

const cargoArgs = (release: boolean): string[] =>
  ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];

function buildInto(release: boolean, dir: string): { bin: string; error: string; ran: boolean } {
  const args = cargoArgs(release);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}`, ran: false };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
  }
  const bin = join(dir, `${SHOW}-${release ? 'release' : 'debug'}`);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '', ran: true };
}

/** The file's builds: debug before its tests; release on the first call of `release()`. Without cargo, INCONCLUSIVE. */
export function useBuilds(): { debug: () => string; release: () => string } {
  let dir = '';
  let debug: { bin: string; error: string; ran: boolean } = { bin: '', error: 'not built', ran: true };
  let release: { bin: string; error: string; ran: boolean } | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-457-bins-'));
    debug = buildInto(false, dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const use = (b: { bin: string; error: string; ran: boolean }, rel: boolean): string => {
    if (!b.ran) inconclusive(b.error);
    expect(b.error, `the binary builds: cargo ${cargoArgs(rel).join(' ')}`).toBe('');
    return b.bin;
  };
  return { debug: () => use(debug, false), release: () => { release ??= buildInto(true, dir); return use(release, true); } };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-457-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The scenario's names and calls. #1938's scenario holds the working agent alpha (session `sess-alpha`, its process
// under your shell) and the panel; a stored document opens as revision 0 in alpha's writer layer.

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB0457D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB0457C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB0457Q', n)}`;
export const patchId = (n: number): string => ulid('01JB0457P', n);
const ALPHA = 'sess-alpha';

/** Alpha's claim on one deliverable: its requirements `[ID, check input]`, and its brief when given (README: `brief.sweeps`). */
export function claimOn(doc: string, requirements: readonly (readonly [string, JsonObject])[], theBrief?: JsonObject): JsonObject {
  return { session: ALPHA, deliverables: [doc], requirements: requirements.map(([id, check]) => ({ id, check })), ...(theBrief ? { brief: theBrief } : {}) };
}
/** Alpha's patch through `deep_show` (Patch: `{patch, doc, base, reason, ops}`). */
export const patch = (doc: string, id: string, base: number, ops: readonly JsonObject[], reason: string): JsonObject =>
  ({ call: 'deep_show', session: ALPHA, doc, patch: { patch: id, doc, base, reason, ops: [...ops] } });
/** Render-back of revision `rev` at t = 0 for alpha's session, at the document's size (Render-back: `{doc, rev, t}`). */
export const renderBack = (doc: string, rev: number): JsonObject => ({ call: 'render_back', session: ALPHA, doc, rev, t: 0 });
/** The revision a verdict judged `doc` at, from its key (#403: `key.revisions[{doc, rev, hash}]`). */
export function judgedRev(v: JsonObject, doc: string): number | null {
  const key = isObject(v['key']) ? v['key'] : {};
  const list = Array.isArray(key['revisions']) ? key['revisions'].filter(isObject) : [];
  const r = list.find((x) => x['doc'] === doc)?.['rev'];
  return typeof r === 'number' ? r : null;
}
/** A render-back reply's first snapshot `{sha256, w, h}`, or why there is none. */
export function snapshotOf(reply: JsonObject, rev: number, what: string): { sha: string; w: number; h: number } | string {
  const snap = Array.isArray(reply['snapshots']) ? reply['snapshots'][0] : undefined;
  if (reply['outcome'] !== 'presented' || reply['rev'] !== rev || !isObject(snap) || typeof snap['sha256'] !== 'string' || typeof snap['w'] !== 'number' || typeof snap['h'] !== 'number') {
    return `${what}: render-back of revision ${rev} isn't presented with a snapshot: ${brief(reply, 800)}`;
  }
  return { sha: snap['sha256'], w: snap['w'], h: snap['h'] };
}

// ---------------------------------------------------------------------------------------------------
// camera.framing's results and failures (README: Surfaces this suite assumes)

const num = (v: JsonValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const idOf = (s: string): string => s.split('#')[0]!;
const ids = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(idOf))].sort() : []);
/** A field: on the issue itself, else in its `actual` (as #405's suite reads a sweep). */
export function field(o: JsonObject, name: string): JsonValue | undefined {
  if (name in o) return o[name];
  const actual = o['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
const results = (row: Row): JsonObject[] => (Array.isArray(row.raw['results']) ? row.raw['results'].filter(isObject) : []);

/** One `occluded` entry of a checked time: `{item, share, occluders, points}`, with the time it was read at. */
export interface Occluded { t: number | null; item: string; share: number | null; occluders: string[]; points: number[][] | null; raw: JsonObject }
function points(v: JsonValue | undefined): number[][] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((p) => (Array.isArray(p) && p.length === 3 && p.every((c) => typeof c === 'number' && Number.isFinite(c)) ? (p as number[]) : null));
  return out.every((p): p is number[] => p !== null) ? out : null;
}
/** Every `occluded` entry in the row's results, each checked time's in turn. */
export function occludedOf(row: Row): Occluded[] {
  return results(row).flatMap((r) => (Array.isArray(r['occluded']) ? r['occluded'].filter(isObject) : []).map((o) => ({
    t: num(r['t']), item: typeof o['item'] === 'string' ? idOf(o['item']) : '', share: num(o['share']), occluders: ids(o['occluders']), points: points(o['points']), raw: o,
  })));
}
/** The entries for `item`; the test fails, saying what the row holds, when there is none. */
export function occludedFor(row: Row, item: string, what: string): Occluded[] {
  const found = occludedOf(row).filter((o) => o.item === item);
  expect(found.length, `${what}: camera.framing's results list an occluded share for ${item} (results[].occluded[] {item, share, occluders}): ${brief(row.raw['results'] ?? null, 1500)}`).toBeGreaterThan(0);
  return found;
}

/** The camera path measures, by the check input's field names (README: `paths`). */
export type Measure = 'clearance' | 'corners' | 'raster' | 'focus';
const MEASURE_NAMES: Record<Measure, readonly string[]> = { clearance: ['clearance'], corners: ['corners'], raster: ['raster_max', 'raster'], focus: ['focus_coc_max', 'focus'] };
const isMeasure = (v: JsonValue | undefined, m: Measure): boolean => typeof v === 'string' && MEASURE_NAMES[m].includes(v);
/** One `paths` reading: `{shot, t, measure, item, value}`, t in flicks. */
export interface PathReading { shot: string | null; t: number | null; measure: string; item: string | null; value: number | null; raw: JsonObject }
/** Every `paths` reading in the row's results of `measure`, for `item` when given. */
export function pathsOf(row: Row, measure: Measure, item?: string): PathReading[] {
  return results(row).flatMap((r) => (Array.isArray(r['paths']) ? r['paths'].filter(isObject) : []))
    .filter((p) => isMeasure(p['measure'], measure) && (item === undefined || (typeof p['item'] === 'string' && idOf(p['item']) === item)))
    .map((p) => ({ shot: typeof p['shot'] === 'string' ? p['shot'] : null, t: num(p['t']), measure: String(p['measure']), item: typeof p['item'] === 'string' ? idOf(p['item']) : null, value: num(p['value']), raw: p }));
}

/** camera.framing's errors and warnings on the row whose `ids` hold `item`. */
export const framingIssues = (row: Row, item: string): Issue[] => raised(row).filter((i) => i.check === 'camera.framing' && i.ids.includes(item));
/** Occlusion failures of `item`: framing issues naming it that carry its `share` and `occluders` (on the issue or its `actual`). */
export const occlusionIssues = (row: Row, item: string): Issue[] => framingIssues(row, item).filter((i) => num(field(i.raw, 'share')) !== null);
export const shareOf = (i: Issue): number | null => num(field(i.raw, 'share'));
export const occludersOf = (i: Issue): string[] => ids(field(i.raw, 'occluders'));
/** Path failures of `measure`: camera.framing's errors and warnings whose `measure` (on the issue or its `actual`) is that
 * measure, naming `item` in their `ids` when given. */
export const pathIssues = (row: Row, measure: Measure, item?: string): Issue[] =>
  raised(row).filter((i) => i.check === 'camera.framing' && isMeasure(field(i.raw, 'measure'), measure) && (item === undefined || i.ids.includes(item)));
export const valueOf = (i: Issue): number | null => num(field(i.raw, 'value'));
/** A failure's time in seconds (its `t` in flicks). */
export const secondsOf = (i: Issue): number | null => { const t = num(field(i.raw, 't')); return t === null ? null : t / FLICKS; };
export const shotOf = (i: Issue): JsonValue | undefined => field(i.raw, 'shot');
/** A failure found under a control sweep: `sweep: {control, value}` on the issue or its `actual` (#405's shape). */
export function sweepOf(i: Issue): { control: string | null; value: JsonValue | null } {
  const s = field(i.raw, 'sweep');
  return { control: isObject(s) && typeof s['control'] === 'string' ? s['control'] : null, value: isObject(s) && s['value'] !== undefined ? s['value'] : null };
}
/** Whether some string in `v` names `name`: equal to it, or a path ending in `/name`. */
export function names(v: JsonValue | undefined, name: string): boolean {
  if (typeof v === 'string') return v === name || v.endsWith(`/${name}`);
  if (Array.isArray(v)) return v.some((x) => names(x, name));
  if (isObject(v)) return Object.values(v).some((x) => names(x, name));
  return false;
}
/** An issue as a line in a failure message. */
export const shown = (i: Issue): string => `${i.code || '(no code)'} by ${i.check || '(no check)'} [${i.ids.join(', ')}]: ${brief(i.raw, 700)}`;
/** Whether the row is decided: PASS or FAIL, never BLOCKED, INVALID or INCONCLUSIVE. */
export const decided = (row: Row): boolean => row.result === 'PASS' || row.result === 'FAIL';
/** A row this machine couldn't draw for (no GPU): the test can't decide here, so it fails INCONCLUSIVE, never passes. */
export function gpuGate(row: Row, what: string): void {
  const codes = Array.isArray(row.raw['blocked']) ? row.raw['blocked'].filter(isObject).map((b) => String(b['code'])) : [];
  const gpu = codes.find((c) => c === 'gpu_unavailable' || c === 'unsupported_platform' || c === 'software_adapter');
  if (row.result !== 'PASS' && row.result !== 'FAIL' && gpu) inconclusive(`${what} is ${row.result} with ${gpu}: this machine has no GPU to draw on`);
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #457 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). Metres, +Y up; 2D in u, y down. Every solid has an unlit material, so nothing a
// check reads depends on light, and render-back draws each in its own colour.

export type V3 = [number, number, number];
const LAYER = 'alpha-main';
/** A document as the hub stores it (#96): alpha's writer layer, each item given its ID, name, draw order and layer. */
function stored(profile: string, title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile, title, description: `${title}: a #457 acceptance fixture.`,
    layers: { [LAYER]: { writer: 'agent:thread-alpha', title: 'Claude Code: the loop', order: 'a0' } },
    ...extra, items: out,
  };
}
/** The frame every 3D fixture is checked at unless said: 320 × 240 px. */
const SIZE: [number, number] = [320, 240];
/** A 3D scene through `cam`, with the canvas modules it needs. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}, modules: readonly string[] = ['scene3d']): JsonObject {
  return stored('scene', title, items, { size: [...SIZE], camera: 'cam', requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, ...extra });
}
/** A perspective camera@1 at `position` looking at `target`, 40° across the wider side, near 0.1 m, far 200 m. */
export const camera = (position: V3, target: V3, more: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: [...position], target: [...target], fov: 40, near: 0.1, far: 200, ...more } });
/** A pale sky. */
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0.55, 0.62, 0.72, 1], low: [0.85, 0.85, 0.82, 1], ambient_top: [0.1, 0.1, 0.1], ambient_low: [0.05, 0.05, 0.05] } };
/** An unlit, double-sided material of linear `color`, opaque unless `more` says. */
const unlit = (color: V3, more: JsonObject = {}): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true, ...more } });
export const box = (size: V3, pos: V3, material: string): JsonObject => ({ kind: 'mark.box@1', params: { size: [...size] }, at: { pos: [...pos] }, material });
export const sphere = (d: number, pos: V3, material: string): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [d, d, d] }, at: { pos: [...pos] }, material });
const cylinder = (d: number, h: number, pos: V3, material: string): JsonObject => ({ kind: 'mark.cylinder@1', params: { size: [d, h, d] }, at: { pos: [...pos] }, material });
/** A channel on `target` with keys `{id: [seconds, value]}`, every key's interpolation `interp`. */
function channel(target: string, type: 'f32' | 'vec3', keys: Record<string, readonly [number, number | V3]>, interp: string): JsonObject {
  return { target, type, keys: Object.fromEntries(Object.entries(keys).map(([id, [t, value]]) => [id, { t: `${t}s`, value: Array.isArray(value) ? [...value] : value, interp }])) };
}
/** A shot of `cam` from 0 to `span` s whose pose the camera's own channels and drivers write (Shot: `keyed`). */
const keyedShot = (span: number): JsonObject => ({ start: '0s', end: `${span}s`, camera: 'cam', move: 'hold', keyed: true });
/** A copy of `doc` with one more item, drawn after the item ordered `after` and before the next. */
export function withItem(doc: JsonObject, id: string, item: JsonObject, after: string): JsonObject {
  const copy = JSON.parse(JSON.stringify(doc)) as JsonObject;
  (copy['items'] as JsonObject)[id] = { id, name: id, order: `${after}5`, layer: LAYER, ...item };
  return copy;
}

// ---- Criteria 1, 3 and 10: the castle shot

/** The kept tower: a 1 × 5 × 1 m box standing at the origin. The market stall's top is 3.05 m up, the camera's eye height. */
export const TOWER = { id: 'tower', size: [1, 5, 1] as V3, pos: [0, 2.5, 0] as V3 };
export const STALL = { id: 'stall', top: 3.05 };
/**
 * The castle shot: the camera 20 m out at the stall's top height (3.05 m), looking level along −z at the tower; a
 * 2 × 3.05 × 1 m market stall 10 m out on the line of sight (at x = `stallX`), a curtain wall 6 m behind the tower and
 * the ground 1 cm below it. Seen level from the stall's top height, the stall hides exactly the tower's surface below
 * 3.05 m: (4 × 3.05 + 1) ÷ (4 × 5 + 2) = 0.6 of it by area, bottom face included. At `stallX` 4 it hides none.
 */
export function castle(stallX = 0): JsonObject {
  return scene(stallX === 0 ? 'A tower behind a market stall' : 'A tower beside a market stall', {
    cam: camera([0, STALL.top, 20], [0, STALL.top, 0]), sky: SKY,
    grass: unlit([0.18, 0.32, 0.12]), stone: unlit([0.55, 0.52, 0.47]), 'dark-stone': unlit([0.35, 0.33, 0.3]), awning: unlit([0.7, 0.12, 0.1]),
    ground: box([40, 0.2, 60], [0, -0.11, 0], 'grass'),
    [TOWER.id]: box(TOWER.size, TOWER.pos, 'stone'),
    [STALL.id]: box([2, STALL.top, 1], [stallX, STALL.top / 2, 10], 'awning'),
    curtain: box([14, 3, 1], [0, 1.5, -6.5], 'dark-stone'),
  });
}
export const CASTLE_CHECK: JsonObject = { kind: 'camera.framing', keep: [TOWER.id] };
/** How far `p` is from the tower's surface, as a fraction of its half-extent: 1 on its true shape. */
export function onTower(p: readonly number[]): number {
  const [hx, hy, hz] = TOWER.size.map((s) => s / 2) as V3;
  return Math.max(Math.abs(p[0]! - TOWER.pos[0]) / hx, Math.abs(p[1]! - TOWER.pos[1]) / hy, Math.abs(p[2]! - TOWER.pos[2]) / hz);
}

// ---- Criterion 2: see-through items and an excepted pillar before a statue

/**
 * A 1 × 2 × 0.4 m statue 8 m in front of the camera, and between them: a pane of transmission 0.9 over its whole
 * silhouette, a banner in alpha_mode blend over its upper part, a beam in alpha_mode add over 75% of its sample points
 * by area, and an opaque pillar over another 19%, which the check input excepts.
 */
export function gallery(): JsonObject {
  return scene('A statue behind glass, a banner, a beam and a pillar', {
    cam: camera([0, 1.5, 8], [0, 1.5, 0]), sky: SKY,
    bronze: unlit([0.45, 0.3, 0.15]), stone: unlit([0.55, 0.52, 0.47]),
    glass: { kind: 'material@1', params: { base_color: [0.85, 0.92, 1, 1], transmission: 0.9, roughness: 0.05, metallic: 0 } },
    cloth: unlit([0.6, 0.1, 0.12], { alpha_mode: 'blend', alpha: 0.6 }),
    light: unlit([1, 0.85, 0.45], { alpha_mode: 'add', alpha: 0.5 }),
    statue: box([1, 2, 0.4], [0, 1.5, 0], 'bronze'),
    pane: box([3, 3, 0.02], [0, 1.5, 4], 'glass'),
    banner: box([1.5, 1, 0.02], [0, 2.2, 3.5], 'cloth'),
    beam: box([0.75, 3, 0.3], [0.13, 1.5, 2], 'light'),
    pillar: box([0.2, 3, 0.2], [-0.36, 1.5, 3], 'stone'),
  });
}
export const GALLERY_CHECK: JsonObject = { kind: 'camera.framing', keep: ['statue'], except: ['pillar'] };

// ---- Criteria 4 and 10: a piston in a casing, with a half-section cutaway

/**
 * A closed casing of six 0.1 m walls (outer 2 m cube at the origin), holding the kept piston (a 0.5 m cylinder 1 m tall)
 * and the kept crank (a 0.4 m box), both wholly behind the plane z = 0, and a 0.26 m valve 0.15 m behind the plane in
 * front of the crank, hiding about 17% of its sample points by area. The cutaway `section` removes z > 0: the front wall
 * and the front halves of the others. The camera is 5 m out on +z.
 */
export function engine(cut: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 0.3, 5], [0.05, -0.15, -0.45]), sky: SKY,
    steel: unlit([0.5, 0.52, 0.56]), brass: unlit([0.72, 0.55, 0.2]), iron: unlit([0.28, 0.28, 0.3]), red: unlit([0.7, 0.15, 0.12]),
    'casing-front': box([2, 2, 0.1], [0, 0, 0.95], 'iron'), 'casing-back': box([2, 2, 0.1], [0, 0, -0.95], 'iron'),
    'casing-left': box([0.1, 2, 1.8], [-0.95, 0, 0], 'iron'), 'casing-right': box([0.1, 2, 1.8], [0.95, 0, 0], 'iron'),
    'casing-top': box([1.8, 0.1, 1.8], [0, 0.95, 0], 'iron'), 'casing-bottom': box([1.8, 0.1, 1.8], [0, -0.95, 0], 'iron'),
    piston: cylinder(0.5, 1, [-0.35, 0, -0.4], 'steel'),
    crank: box([0.4, 0.4, 0.4], [0.45, -0.3, -0.5], 'brass'),
    valve: box([0.26, 0.26, 0.08], [0.44, -0.27, -0.15], 'red'),
  };
  if (cut) items['section'] = { kind: 'cutaway@1', params: { planes: [{ normal: [0, 0, 1], offset: 0 }] } };
  return scene(cut ? 'A piston seen through a half-section' : 'A piston in its casing', items);
}
export const ENGINE_CHECK: JsonObject = { kind: 'camera.framing', keep: ['piston', 'crank'] };

// ---- Criterion 5: a walkthrough through a door frame

/** The deepest point of the walkthrough: z = 0 on a path from z = 3.05 at 0 s to z = −1.95 at 2 s. */
export const WALK = { shot: 'walk', deepest: 2 * (3.05 / 5) };
/**
 * A door frame (a tube of radius 0.05 m up the post at x = −0.5, across at 2.1 m and down at x = 0.5), and a camera at
 * 1.6 m walking through it along x = `x` from z = 3.05 to z = −1.95 over the 2 s keyed shot `walk`, aimed at the kept
 * goal 6 m beyond. Along x = −0.4 it passes 0.05 m from the post's surface at z = 0 (t = 1.22 s), inside the frame and
 * inside its clearance (√(0.1² + h²) ≈ 0.11 m for its near plane); along x = 0 it keeps 0.45 m from it.
 */
export function walkthrough(x: number): JsonObject {
  return scene(x === 0 ? 'A walk through the middle of a doorway' : 'A walk close past a door post', {
    cam: camera([x, 1.6, 3.05], [0, 1.2, -6]), sky: SKY,
    oak: unlit([0.4, 0.26, 0.14]), slate: unlit([0.3, 0.35, 0.42]),
    frame: { kind: 'tube@1', params: { path: [[-0.5, 0, 0], [-0.5, 2.1, 0], [0.5, 2.1, 0], [0.5, 0, 0]], radius: 0.05 }, material: 'oak' },
    goal: box([1, 1, 1], [0, 1.2, -6], 'slate'),
  }, {
    transport: { span: '2s' }, shots: { [WALK.shot]: keyedShot(2) },
    channels: { stride: channel('items/cam/params/position', 'vec3', { from: [0, [x, 1.6, 3.05]], to: [2, [x, 1.6, -1.95]] }, 'linear') },
  }, ['scene3d', 'motion']);
}
export const WALK_CHECK: JsonObject = { kind: 'camera.framing', keep: ['goal'] };

/**
 * A camera keyed at three points 4 m apart over 2 s: 4 m out, at the origin, then 4 m on along a heading 40° to the
 * right, so two linear segments meet at the key `turn` at a 40° turn (a jump of 2 × 4 × sin 20° ≈ 2.74 m/s, 68% of the
 * shot's 4 m/s), aimed at the kept beacon. With `auto` keys the path is smooth through `turn`. x and z are keyed apart.
 */
export function glide(interp: 'linear' | 'auto'): JsonObject {
  const turn = (40 * Math.PI) / 180;
  return scene(interp === 'linear' ? 'A glide with a corner' : 'A glide with auto tangents', {
    cam: camera([0, 1.6, 4], [0, 1.6, -8]), sky: SKY,
    glow: unlit([0.9, 0.7, 0.2]),
    beacon: box([1.3, 1.3, 1.3], [0, 1.6, -8], 'glow'),
  }, {
    transport: { span: '2s' }, shots: { glide: keyedShot(2) },
    // One f32 channel a component: the base takes auto keys on f32 channels only (Channel and key: auto tangents).
    channels: {
      'course-x': channel('items/cam/params/position/0', 'f32', { start: [0, 0], turn: [1, 0], end: [2, 4 * Math.sin(turn)] }, interp),
      'course-z': channel('items/cam/params/position/2', 'f32', { start: [0, 4], turn: [1, 0], end: [2, -4 * Math.cos(turn)] }, interp),
    },
  }, ['scene3d', 'motion']);
}
export const GLIDE_CHECK: JsonObject = { kind: 'camera.framing', keep: ['beacon'] };

/** A screen recording captured at 2 px per u: a 1440 × 900 px picture of a 720 × 450 u region of the screen. */
export function recording(): Uint8Array {
  return encodePng(1440, 900, (x, y) => (((x >> 5) + (y >> 5)) % 2 === 0 ? [236, 238, 242, 255] : [52, 60, 74, 255]));
}
/**
 * A 2D film of a 1440 u wide screen (1440 × 900 u): the recording over the middle 720 × 450 u, and over it the kept
 * button (120 × 80 u). The 1 s shot `zoom` holds the view `1440 ÷ zoom` u wide on the screen's centre. Exported 1920 px
 * wide, a view `w` u wide shows the recording at (1920 ÷ w) ÷ 2 export px per source px: 2.0 at 3×, 1.33 at 2×.
 */
export function screenFilm(zoom: number, sha: string): JsonObject {
  const width = 1440 / zoom;
  return stored('film', zoom === 3 ? 'A screen recording seen close' : 'A screen recording seen nearer', {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', target: [720, 450, 0], view_width: 1440 } },
    recording: { kind: 'image@1', params: { asset: sha, box: [360, 225, 720, 450], fit: 'fill', alt: 'A recording of the app' } },
    button: { kind: 'rect@1', params: { box: [660, 410, 120, 80], paint: { fill: { role: 'accent' } } } },
  }, {
    size: [1440, 900], safe: 24, camera: 'cam', locale: 'en', transport: { span: '1s' },
    assets: { 'screen-recording': { sha256: sha, license: { id: 'cc0', terms: 'CC0 1.0', shareable: true, credit: 'a #457 test fixture' } } },
    shots: { zoom: { start: '0s', end: '1s', camera: 'cam', move: 'hold', target: [720, 450, 0], view_width: width } },
  });
}
/** The raster check reads the export's width from the check input's `render.widths` (Check input). */
export const SCREEN_CHECK: JsonObject = { kind: 'camera.framing', keep: ['button'], render: { widths: [1920] } };

/**
 * A kept 0.8 m box 4 m in front of a 50 mm lens at f/1.4 on a 36 × 24 mm sensor fitted horizontally, in a 1920 × 1080
 * frame, with depth of field on and focused at 3 m: its centre 1 m behind the focus plane blurs into a circle of
 * confusion of 0.05² × 1 ÷ (1.4 × 4 × 2.95) m = 0.1513 mm on the sensor, × 1920 ÷ 36 = 8.07 px.
 */
export function focusShot(): JsonObject {
  return stored('scene', 'A subject behind the focus plane', {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 1, 4], target: [0, 1, 0], lens: { focal_length: 50, sensor: [36, 24], fit: 'horizontal' }, aperture: { f_stop: 1.4, blades: 0 }, near: 0.05, far: 200 } },
    sky: SKY, clay: unlit([0.6, 0.4, 0.3]),
    subject: box([0.8, 0.8, 0.8], [0, 1, 0], 'clay'),
    fx: { kind: 'effect@1', params: { kind: 'dof', dof: { focus: 3, coc: 'physical', taps: 64, rotate: 'pixel_hash', far_over_near: 'refuse' } } },
  }, {
    size: [1920, 1080], camera: 'cam', requires: { modules: { scene3d: '^1', motion: '^1', effects: '^1' } },
    transport: { span: '1s' }, shots: { hold: keyedShot(1) },
  });
}
export const FOCUS_CHECK: JsonObject = { kind: 'camera.framing', keep: ['subject'] };
/** The circle of confusion in px: f² |d − s| ÷ (N d (s − f)) on the sensor, × px per mm. */
export const coc = (f: number, n: number, s: number, d: number, sensorMm: number, px: number): number => ((f * f * Math.abs(d - s)) / (n * d * (s - f))) * 1000 * (px / sensorMm);

/** A body and its lid; the toggle `explode` binds the lid's x, from 0 at rest to 4 m apart, past the frame's edge. */
export function explodeFigure(): JsonObject {
  return scene('A box whose lid comes apart', {
    cam: camera([0, 1.2, 5], [0, 0.7, 0]), sky: SKY,
    teal: unlit([0.1, 0.45, 0.45]), sand: unlit([0.8, 0.7, 0.5]),
    body: box([1, 1, 1], [0, 0.5, 0], 'teal'),
    lid: box([1, 0.2, 1], [0, 1.1, 0], 'sand'),
  }, { controls: { explode: { kind: 'toggle', class: 'document', label: 'Explode', role: 'switch', binds: ['items/lid/at/pos/0'], range: [0, 4], default: false } } }, ['scene3d', 'input']);
}
export const EXPLODE_CHECK: JsonObject = { kind: 'camera.framing', keep: ['body', 'lid'] };

// ---- Criterion 6: a near plane 0.1 m out, 0.08 × 0.06 m

/** The field of view across the wider side that makes a near plane 0.1 m out 0.08 m wide: 2·atan(0.04 ÷ 0.1). */
export const NEAR_FOV = (2 * Math.atan(0.04 / 0.1) * 180) / Math.PI;
/** A still camera at 1 m looking along −z, near plane 0.1 m out (0.08 × 0.06 m in the 320 × 240 frame), a 1 mm-radius sphere `dot` centred on the axis `at` m out, and the kept crate 4 m out, in one 1 s keyed shot. */
export function nearPlane(at: number): JsonObject {
  return scene(at === 0.1 ? 'A bead on the near plane' : 'A bead just past the near plane', {
    cam: camera([0, 1, 0], [0, 1, -4], { fov: NEAR_FOV, near: 0.1 }), sky: SKY,
    pearl: unlit([0.9, 0.9, 0.85]), pine: unlit([0.5, 0.35, 0.2]),
    dot: sphere(0.002, [0, 1, -at], 'pearl'),
    crate: box([1.2, 1.2, 1.2], [0, 1, -4], 'pine'),
  }, { transport: { span: '1s' }, shots: { still: keyedShot(1) } }, ['scene3d', 'motion']);
}
export const NEAR_CHECK: JsonObject = { kind: 'camera.framing', keep: ['crate'] };

// ---- Criterion 7: a camera bobbing under a ceiling

/** The camera's height at t s: 1.4 + 0.1·sin(30πt) m. */
export const bob = (t: number): number => 1.4 + 0.1 * Math.sin(30 * Math.PI * t);
/** A ceiling slab whose underside is 1.6 m up over the camera, which a driver bobs at 1.4 + 0.1·sin(30πt) m through the 1 s keyed shot `hall`, aimed at the kept marker 6 m on. */
export function bobbing(): JsonObject {
  return scene('A camera bobbing under a ceiling', {
    cam: camera([0, 1.4, 0], [0, 1, -6]), sky: SKY,
    plaster: unlit([0.85, 0.83, 0.78]), blue: unlit([0.15, 0.3, 0.7]),
    ceiling: box([4, 0.1, 4], [0, 1.65, 0], 'plaster'),
    marker: box([0.8, 0.8, 0.8], [0, 1, -6], 'blue'),
  }, {
    transport: { span: '1s' }, shots: { hall: keyedShot(1) },
    drivers: { bob: { target: 'items/cam/params/position/1', expr: '1.4 + 0.1 * sin(30 * pi * t)', vars: { t: 'time' } } },
  }, ['scene3d', 'motion']);
}
export const BOB_CHECK: JsonObject = { kind: 'camera.framing', keep: ['marker'], clearance: 0.15 };

// ---- Criterion 8: a camera a slider lowers toward a table

/** The camera's height above the table at slider value s: 0.3 − 0.25·exp(−((s − 0.6) ÷ 0.05)²) m. */
export const above = (s: number): number => 0.3 - 0.25 * Math.exp(-(((s - 0.6) / 0.05) ** 2));
/** The five samples of a 5-sample sweep over [0, 1]: evenly spaced, both ends included. */
export const SAMPLES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];
/** The table's top, 0.75 m up. */
const TABLE_TOP = 0.75;
/** A table, and over its middle a camera whose height the slider `s` sets through the driver `lower`, aimed at the kept vase 4 m on, in the 1 s keyed shot `overhead`. */
export function tableShot(): JsonObject {
  return scene('A camera a slider lowers over a table', {
    cam: camera([0, TABLE_TOP + 0.3, 0], [0, 1, -4]), sky: SKY,
    walnut: unlit([0.35, 0.22, 0.12]), glaze: unlit([0.2, 0.5, 0.6]),
    table: box([1.2, 0.05, 0.8], [0, TABLE_TOP - 0.025, 0], 'walnut'),
    vase: box([0.4, 0.6, 0.4], [0, 1, -4], 'glaze'),
  }, {
    transport: { span: '1s' }, shots: { overhead: keyedShot(1) },
    controls: { s: { kind: 'slider', class: 'document', label: 'Height', role: 'slider', range: [0, 1], default: 0 } },
    drivers: { lower: { target: 'items/cam/params/position/1', expr: `${TABLE_TOP} + 0.3 - 0.25 * exp(-pow((s - 0.6) / 0.05, 2))`, vars: { s: 'controls/s/value' }, fallback: TABLE_TOP + 0.3 } },
  }, ['scene3d', 'motion', 'input']);
}
export const TABLE_CHECK: JsonObject = { kind: 'camera.framing', keep: ['vase'], clearance: 0.15 };

// ---- Criterion 9: the budgets' fixtures

/** The 1,000-part scene: a plate and 999 0.3 m boxes standing on it, 37 × 27 of them 0.6 m apart. */
const BIG = { cols: 37, rows: 27, pitch: 0.6, size: 0.3 } as const;
const partId = (k: number): string => `part-${String(k).padStart(3, '0')}`;
/** The ten kept boxes: the middle row's (13), columns 13 to 22. */
export const KEPT_TEN: readonly string[] = Array.from({ length: 10 }, (_, j) => partId(13 * BIG.cols + 13 + j));
/** The 1,000-part scene, seen from 14 m up and 20 m back, its ten kept boxes the collection `hero`. */
export function bigScene(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([10.8, 14, 28], [10.8, 0, 7.8]), sky: SKY,
    grey: unlit([0.18, 0.18, 0.18]), ochre: unlit([0.5, 0.36, 0.12]),
    plate: box([23, 0.1, 17], [10.8, -0.05, 7.8], 'grey'),
  };
  for (let k = 0; k < BIG.cols * BIG.rows; k++) {
    const id = partId(k);
    items[id] = box([BIG.size, BIG.size, BIG.size], [BIG.pitch * (k % BIG.cols), BIG.size / 2, BIG.pitch * Math.floor(k / BIG.cols)], KEPT_TEN.includes(id) ? 'ochre' : 'grey');
  }
  return scene('Many parts on a plate', items, { collections: { hero: { members: [...KEPT_TEN] } } });
}
/** The 100,000-triangle torus, a `mesh.asset@1` of the GLB the evidence store holds as `sha`. */
export const torusDoc = (sha: string): JsonObject =>
  scene('A torus of many triangles', { cam: camera([0, 2, 4], [0, 0, 0]), sky: SKY, ring: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 } } });
/** A 60 s film: one keyed shot whose camera circles a kept fountain 7 m out, its x and z keyed every 5 s with auto tangents, past four pillars outside its circle. */
export function longFilm(): JsonObject {
  const xs: Record<string, readonly [number, number]> = {};
  const zs: Record<string, readonly [number, number]> = {};
  for (let k = 0; k <= 12; k++) {
    xs[`k${String(k).padStart(2, '0')}`] = [5 * k, 7 * Math.sin((Math.PI * k) / 6)];
    zs[`k${String(k).padStart(2, '0')}`] = [5 * k, 7 * Math.cos((Math.PI * k) / 6)];
  }
  const items: Record<string, JsonObject> = {
    cam: camera([0, 1.6, 7], [0, 0.75, 0]), sky: SKY, stone: unlit([0.55, 0.52, 0.47]), water: unlit([0.2, 0.45, 0.65]),
    floor: box([20, 0.2, 20], [0, -0.1, 0], 'stone'), fountain: box([1, 1.5, 1], [0, 0.75, 0], 'water'),
  };
  for (const [x, z] of [[6, 6], [-6, 6], [6, -6], [-6, -6]] as const) items[`pillar-${x > 0 ? 'e' : 'w'}${z > 0 ? 's' : 'n'}`] = box([0.5, 3, 0.5], [x, 1.5, z], 'stone');
  return scene('A minute round a fountain', items, {
    transport: { span: '60s' }, shots: { tour: keyedShot(60) }, channels: { 'circle-x': channel('items/cam/params/position/0', 'f32', xs, 'auto'), 'circle-z': channel('items/cam/params/position/2', 'f32', zs, 'auto') },
  }, ['scene3d', 'motion']);
}

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied.

export const load = (): number => loadavg()[0]!;
export interface Load { start: number; end: number }
export async function judgeLimit(limit: number, runs: number[], loads: Load[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** judgeLimit on five stand-in runs at this moment: PASS only when this machine can judge a timing now. */
export async function canJudge(): Promise<JsonObject> {
  const now = Array.from({ length: 5 }, () => ({ start: load(), end: load() }));
  return judgeLimit(1, [0, 0, 0, 0, 0], now);
}

// ---------------------------------------------------------------------------------------------------
// A GLB (glTF 2.0: one mesh, one triangle primitive), for criterion 9's 100,000-triangle torus.

export function glb(positions: readonly V3[], normals: readonly V3[], indices: readonly number[]): Uint8Array {
  const f = (rows: readonly V3[]): Buffer => { const b = Buffer.alloc(rows.length * 12); rows.forEach((r, i) => r.forEach((v, k) => b.writeFloatLE(v, i * 12 + k * 4))); return b; };
  const pos = f(positions), nor = f(normals), ind = Buffer.alloc(indices.length * 4);
  indices.forEach((v, i) => ind.writeUInt32LE(v, i * 4));
  const bin = Buffer.concat([pos, nor, ind]);
  const lo = [0, 1, 2].map((k) => positions.reduce((m, p) => Math.min(m, p[k]!), Infinity));
  const hi = [0, 1, 2].map((k) => positions.reduce((m, p) => Math.max(m, p[k]!), -Infinity));
  const json = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/457' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'mesh', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: normals.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: nor.length },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: ind.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (body: Buffer, kind: number): Buffer => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
  return Buffer.concat([header, chunk(text, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}
/** A closed torus of `major` × `minor` quads, two outward triangles each: 250 × 200 gives 100,000 triangles. */
export function torus(major: number, minor: number, r1 = 1, r2 = 0.3): { glb: Uint8Array; triangles: number } {
  const positions: V3[] = []; const normals: V3[] = []; const indices: number[] = [];
  for (let i = 0; i < major; i++) {
    const u = (2 * Math.PI * i) / major;
    for (let j = 0; j < minor; j++) {
      const v = (2 * Math.PI * j) / minor;
      const n: V3 = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
      positions.push([(r1 + r2 * Math.cos(v)) * Math.cos(u), r2 * Math.sin(v), (r1 + r2 * Math.cos(v)) * Math.sin(u)]);
      normals.push(n);
    }
  }
  const at = (i: number, j: number): number => (i % major) * minor + (j % minor);
  for (let i = 0; i < major; i++) for (let j = 0; j < minor; j++) {
    const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    indices.push(a, c, b, a, d, c);
  }
  return { glb: glb(positions, normals, indices), triangles: indices.length / 3 };
}
