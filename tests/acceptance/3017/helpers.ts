// Test-side tools for the #3017 acceptance tests (README: The surface under test): `deep-show` built with the `full`
// feature set and driven by JSON lines (#393's `deep-show run`: `deep_show` with pixels, `render_back` with `probes`
// and `sheet`; #387's `planted`), kept open for the timing as #412's budgets are; the fixtures the criteria name,
// generated here; reading a 3D snapshot's table (`visible`, and beside it `hidden` and `cut`); reading which item
// each px's pick resolves to, through render-back's probes on the same revision; and the perf lane's own timing rule
// (scripts/benchmark.mjs) under the machine's GPU lease. Every number a test compares comes from the binary or from the
// fixture's own geometry, every expected value from the issue and the design. Parts are copied from #1939's, #2513's
// and #2516's helpers, since suites don't import each other.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3017 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
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
/** A 3D revision is drawn, and its object-ID pass read, on macOS's Metal device; deep-show has no software 3D rasteriser. */
export function requireMetal(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws a 3D revision on macOS's Metal device; this is ${process.platform}`);
}
/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #3017 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/ (debug, or release for the timing).

const SHOW = 'deep-show';
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` (debug, or release) and copies it into `dir`: its path, or cargo's error; `ran` is false when cargo couldn't start. */
export function buildInto(release: boolean, dir: string): { path: string; error: string; ran: boolean } {
  const args = cargoArgs(release);
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}`, ran: false };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
  }
  const path = join(dir, `${SHOW}${release ? '-release' : ''}`);
  copyFileSync(join(targetDir(), release ? 'release' : 'debug', SHOW), path);
  return { path, error: '', ran: true };
}

/** Builds the debug binary once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { path: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3017-bin-'));
    made = buildInto(false, dir);
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${cargoArgs(false).join(' ')}`).toBe('');
    return made.path;
  };
}

/** Fresh folders for a test (evidence stores, a release build), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-3017-')); made.push(d); return d; };
}

/** A value computed once, on first use, and shared by a file's tests (one `deep-show` process serves several criteria). */
export function once<T>(make: () => T): () => T {
  let held: { value: T } | undefined;
  return () => (held ??= { value: make() }).value;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel and its documents.

export const SESSION = 'sess-alpha';
const WORLD: JsonObject = {
  sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: the table', process: { pid: 4100, start: 1_000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } },
};
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB3017D', n);

/** One scenario: `docs` minted on the panel with no revision yet, the calls, and a planted program by name (#387). */
export function scenarioOf(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, ...WORLD,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    claims: {},
    ...(planted ? { planted } : {}),
    calls,
  };
}

/** Alpha's deep_show of a whole revision at the start, rendered back with pixels at `size` px (#393): its reply carries the table. */
export const show = (doc: string, document: JsonObject, size: readonly [number, number]): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, t: '0s', size: [...size], include: ['issues', 'pixels'] });
/** Render-back of revision `rev` of `doc` at the start and at `size` px, with `probes` or a `sheet` when given (#1401, #1725). */
export const renderBack = (doc: string, rev: number, size: readonly [number, number], extra: JsonObject = {}): JsonObject =>
  ({ call: 'render_back', session: SESSION, doc, rev, t: 0, size: [...size], ...extra });

/** One `deep-show run` process: one scenario line in, one answer line out (exit 0); its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A `deep-show run` process kept open, one scenario a line (#412's budgets): each answer and its wall time. */
export class Streamed {
  private child: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => void)[] = [];
  constructor(bin: string) {
    this.child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.waiting.shift()?.(line));
    this.child.stderr.resume();
  }
  /** One scenario: its replies, and the wall time from writing its line to reading its answer, in ms. */
  async send(scenario: JsonObject): Promise<{ replies: JsonObject[]; ms: number }> {
    const line = new Promise<string>((done) => this.waiting.push(done));
    const t0 = process.hrtime.bigint();
    this.child.stdin.write(`${JSON.stringify(scenario)}\n`);
    const text = await line;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const out = obj(JSON.parse(text) as JsonValue, `${SHOW} run (kept open): the answer`);
    expect(out['ok'], `${SHOW} run (kept open) answers the scenario: ${text.slice(0, 1500)}`).toBe(true);
    return { replies: arr(out['replies'], 'replies').map((r, i) => obj(r, `replies[${i}]`)), ms };
  }
  /** Stops the process this test started, by its PID. */
  close(): void {
    this.child.stdin.end();
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}
export const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: Fixtures). Metres, +Y up; px x right and y down. Agent-form documents (#393): no `id`, no
// `layers`, no item `layer`. Each is seen by an orthographic camera level on +Z, so a box's face toward the camera
// covers a rectangle of whole px, and every edge falls on a px boundary, half a px from any px centre.

export type V3 = [number, number, number];
/** A rectangle of px `[x0, y0, x1, y1]`, x1 and y1 exclusive. */
export type Rect = [number, number, number, number];
/** A frame of `size` px seen by the orthographic camera `cam`, `viewWidth` m across, so `size[0] / viewWidth` px a metre. */
export interface View { size: [number, number]; viewWidth: number }
export const areaOf = (r: Rect): number => (r[2] - r[0]) * (r[3] - r[1]);

const ortho = (v: View): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: v.viewWidth, near: 0.5, far: 60 } });
const DARK: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** An unlit, opaque, double-sided material of linear `color`. */
const unlit = (color: V3): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } });
/** A box whose face toward the camera covers `rect` px of `v`'s frame exactly, its centre at depth `z` m, `depth` m deep. */
function boxAt(v: View, rect: Rect, z: number, depth: number, material: string): JsonObject {
  const s = v.size[0] / v.viewWidth;
  const [x0, y0, x1, y1] = rect;
  return {
    kind: 'mark.box@1', params: { size: [(x1 - x0) / s, (y1 - y0) / s, depth] },
    at: { pos: [((x0 + x1) / 2 - v.size[0] / 2) / s, (v.size[1] / 2 - (y0 + y1) / 2) / s, z] }, material,
  };
}
/** A document of `items` (each given its ID, name and draw order), drawn through `cam` at `size`. No number in any text. */
function sceneDoc(title: string, description: string, size: readonly [number, number], items: Record<string, JsonObject>): JsonObject {
  let k = 0;
  const named: JsonObject = {};
  for (const [id, item] of Object.entries(items)) named[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return { format: 1, profile: 'scene', title, description, size: [...size], camera: 'cam', requires: { modules: { scene3d: '^1' } }, items: named };
}

// ---- The room (criteria 1 to 3): a table in plain view, a chair wholly behind a wall, a lamp half behind a pillar.

export const ROOM_SIZE: [number, number] = [960, 540];
/** 16 m across: 60 px a metre. */
const ROOM_VIEW: View = { size: ROOM_SIZE, viewWidth: 16 };
export const [TABLE, CHAIR, LAMP, WALL, PILLAR] = ['table', 'chair', 'lamp', 'wall', 'pillar'] as const;
/** Each item's face toward the camera, px, and its depth: the wall and the pillar 1 m in front of the chair and the lamp. */
export const ROOM: Record<string, { rect: Rect; z: number; depth: number; color: V3 }> = {
  [TABLE]: { rect: [180, 300, 300, 360], z: 0, depth: 1, color: [0.45, 0.3, 0.15] },
  [WALL]: { rect: [630, 180, 810, 360], z: 1, depth: 0.2, color: [0.5, 0.5, 0.5] },
  [CHAIR]: { rect: [690, 225, 750, 315], z: -1, depth: 1, color: [0.7, 0.15, 0.1] },
  [LAMP]: { rect: [450, 240, 480, 300], z: -1, depth: 0.5, color: [0.9, 0.8, 0.2] },
  [PILLAR]: { rect: [464, 90, 520, 450], z: 1, depth: 0.5, color: [0.25, 0.35, 0.6] },
};
/** The room: the chair's face lies wholly inside the wall's, the pillar covers the lamp's right 16 of its 30 columns. */
export function room(): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(ROOM_VIEW), sky: DARK };
  for (const [id, it] of Object.entries(ROOM)) {
    items[`${id}-mat`] = unlit(it.color);
    items[id] = boxAt(ROOM_VIEW, it.rect, it.z, it.depth, `${id}-mat`);
  }
  return sceneDoc('A room', 'A table in plain view, a chair behind a wall and a lamp partly behind a pillar.', ROOM_SIZE, items);
}

// ---- The doorway (criterion 4): a far wall seen through a doorway 1 m wide in a near wall, and with the near wall gone.

export const DOOR_SIZE: [number, number] = [960, 540];
const DOOR_VIEW: View = { size: DOOR_SIZE, viewWidth: 16 };
export const FAR_WALL = 'far-wall';
/** The doorway: 1 m (60 px) wide, from the lintel at 210 px to the frame's bottom edge. */
export const DOORWAY: Rect = [450, 210, 510, 540];
const FAR: Rect = [120, 90, 840, 450];
/** The near wall's three parts round the doorway, reaching past the frame's edges. */
const NEAR: Record<string, Rect> = { 'near-left': [-60, -60, 450, 600], 'near-right': [510, -60, 1020, 600], lintel: [450, -60, 510, 210] };
/** The far wall 3 m behind; with `nearWall`, the near wall in front of it, its doorway the only gap. */
export function doorway(nearWall: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(DOOR_VIEW), sky: DARK, 'far-mat': unlit([0.6, 0.55, 0.45]), 'near-mat': unlit([0.3, 0.3, 0.35]) };
  items[FAR_WALL] = boxAt(DOOR_VIEW, FAR, -3, 0.2, 'far-mat');
  if (nearWall) for (const [id, r] of Object.entries(NEAR)) items[id] = boxAt(DOOR_VIEW, r, 0, 0.2, 'near-mat');
  return sceneDoc(nearWall ? 'A wall through a doorway' : 'A wall', nearWall ? 'A far wall seen through a doorway in a near wall.' : 'A far wall with nothing in front of it.', DOOR_SIZE, items);
}

// ---- The thousand boxes (criteria 5 and 8): 1,000 boxes in view, 300 of them large and near, none hiding another.

export const GRID_SIZE: [number, number] = [960, 540];
/** 48 m across at 960 px: 20 px a metre; the same metres at any size, so every box stays in view at 1936 × 1584 too. */
const GRID_VIEW_WIDTH = 48;
export const BOXES = 1000;
export const boxId = (k: number): string => `box-${String(k).padStart(3, '0')}`;
/** Box k's class: the 200 largest (k mod 5 = 4), the 100 next (k mod 10 = 2), both near; the other 700 small and far. */
export const classOf = (k: number): 'largest' | 'large' | 'small' => (k % 5 === 4 ? 'largest' : k % 10 === 2 ? 'large' : 'small');
const SIDE = { largest: 18, large: 14, small: 4 } as const;
/** Box k's face at 960 × 540: centred in cell (k mod 40, ⌊k ÷ 40⌋) of a 40 × 25 grid of 24 × 20 px cells. */
export function gridRect(k: number): Rect {
  const s = SIDE[classOf(k)];
  const [cx, cy] = [24 * (k % 40) + 12, 20 * Math.floor(k / 40) + 10];
  return [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2];
}
/** Each box's px at 960 × 540, from its face's area: 324, 196 or 16. */
export const gridPx = (k: number): number => areaOf(gridRect(k));
/** The thousand boxes at `size`: the large ones 1 m in front of the small ones' plane. */
export function grid(size: readonly [number, number]): JsonObject {
  const base: View = { size: GRID_SIZE, viewWidth: GRID_VIEW_WIDTH };
  const items: Record<string, JsonObject> = {
    cam: ortho({ size: [size[0], size[1]], viewWidth: GRID_VIEW_WIDTH }), sky: DARK,
    'near-mat': unlit([0.8, 0.5, 0.2]), 'far-mat': unlit([0.2, 0.5, 0.8]),
  };
  for (let k = 0; k < BOXES; k++) {
    const near = classOf(k) !== 'small';
    items[boxId(k)] = boxAt(base, gridRect(k), near ? 1 : -1, 0.2, near ? 'near-mat' : 'far-mat');
  }
  return sceneDoc('A thousand boxes', 'Large boxes in front and small boxes behind, none hiding another.', size, items);
}

// ---- The cutaway (criterion 6): a vase a cutaway's plane removes whole, beside a stand it leaves.

export const CUT_SIZE: [number, number] = [960, 540];
const CUT_VIEW: View = { size: CUT_SIZE, viewWidth: 16 };
export const [VASE, STAND] = ['vase', 'stand'] as const;
/** The vase spans x 2 m to 3 m, wholly past the plane x = 1 m; the stand spans −3 m to −1 m, wholly before it. */
const CUT_RECTS: Record<string, Rect> = { [VASE]: [600, 180, 660, 300], [STAND]: [300, 240, 420, 360] };
/** The vase and the stand; with `cut`, the cutaway `section` (view class, applying to all) hiding x > 1 m. */
export function cutaway(cut: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(CUT_VIEW), sky: DARK, 'vase-mat': unlit([0.2, 0.6, 0.6]), 'stand-mat': unlit([0.5, 0.35, 0.2]) };
  items[VASE] = boxAt(CUT_VIEW, CUT_RECTS[VASE]!, 0, 0.5, 'vase-mat');
  items[STAND] = boxAt(CUT_VIEW, CUT_RECTS[STAND]!, 0, 1, 'stand-mat');
  if (cut) items['section'] = { kind: 'cutaway@1', params: { planes: [{ normal: [1, 0, 0], offset: 1 }] } };
  return sceneDoc(cut ? 'A vase cut away' : 'A vase and a stand', cut ? 'A cutaway removes the vase and leaves the stand.' : 'A vase beside a stand.', CUT_SIZE, items);
}

// ---- The sheet (criterion 7): a cube and, 1 m behind it, a screen that hides it from the back view only.

export const SHEET_SIZE: [number, number] = [640, 360];
export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'three_quarter'] as const;
export const [CUBE, SCREEN] = ['cube', 'screen'] as const;
/** The view that hides the cube: back looks along +Z from behind the screen (Render-back: the sheet's named views). */
export const HIDING_VIEW = 'back';
/**
 * A 0.5 m cube at the origin and a 2.4 m square screen 0.1 m thick centred 1 m behind it (−Z). Every view of the
 * sheet orbits the bounds' centre (0, 0, −0.4): front, left, right, top and three-quarter see the cube (the screen is
 * behind it or edge-on beside it); back looks through the screen at it, and the screen covers it whole.
 */
export function sheetScene(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 8], target: [0, 0, 0], fov: 40, near: 0.1, far: 60 } },
    sky: DARK, 'cube-mat': unlit([0.8, 0.3, 0.2]), 'screen-mat': unlit([0.3, 0.4, 0.5]),
    [CUBE]: { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, at: { pos: [0, 0, 0] }, material: 'cube-mat' },
    [SCREEN]: { kind: 'mark.box@1', params: { size: [2.4, 2.4, 0.1] }, at: { pos: [0, 0, -1] }, material: 'screen-mat' },
  };
  return sceneDoc('A cube before a screen', 'A cube with a screen behind it.', SHEET_SIZE, items);
}

// ---------------------------------------------------------------------------------------------------
// The table (README: Assumed surfaces 1): `visible` rows `{id, box, px, at}`, and beside them `hidden` and `cut`.

export interface Row { id: string; box: number[]; px: JsonValue | undefined; at: JsonValue | undefined }
export interface Table { rows: Row[]; hidden: string[]; hiddenGiven: boolean; cut: JsonValue | undefined }

/** The reply's snapshot entries (`{sha256, w, h, …}`), and that it was presented; a machine with no GPU to draw on can't decide. */
export function snapshotsOf(reply: JsonObject, what: string): JsonObject[] {
  if ([reply['code'], reply['reason']].includes('unsupported_platform')) inconclusive(`${what} couldn't be drawn on this machine's GPU: ${brief(reply, 400)}`);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 2000)}`).toBe('presented');
  return arr(reply['snapshots'], `${what}: snapshots`).map((s, i) => obj(s, `${what}: snapshots[${i}]`));
}
/**
 * The table `holder` carries (a deep_show reply, or a sheet's snapshot entry): its `visible` rows, and `hidden` (IDs,
 * or rows with an `id`) and `cut` beside them. An absent `hidden` reads as empty, and `hiddenGiven` says so.
 */
export function tableOf(holder: JsonObject, what: string): Table {
  const rows = arr(holder['visible'], `${what}: visible`).map((r, i) => {
    const o = obj(r, `${what}: visible[${i}]`);
    expect(typeof o['id'], `${what}: visible[${i}].id is an item ID: ${brief(o, 300)}`).toBe('string');
    const b = arr(o['box'], `${what}: visible[${i}].box`);
    expect(b.length === 4 && b.every((v) => typeof v === 'number'), `${what}: visible[${i}].box is [x, y, w, h]: ${brief(o, 300)}`).toBe(true);
    return { id: o['id'] as string, box: b as number[], px: o['px'], at: o['at'] };
  });
  const h = holder['hidden'];
  const hidden = h === undefined || h === null ? [] : arr(h, `${what}: hidden`).map((x, i) => {
    const id = typeof x === 'string' ? x : isObject(x) ? x['id'] : undefined;
    expect(typeof id, `${what}: hidden[${i}] names an item by ID: ${brief(x, 300)}`).toBe('string');
    return id as string;
  });
  return { rows, hidden, hiddenGiven: h !== undefined && h !== null, cut: holder['cut'] };
}
export const rowOf = (t: Table, id: string): Row | undefined => t.rows.find((r) => r.id === id);
/** A row's px, when it is a whole number of px above 0; else null. */
export const pxOf = (r: Row): number | null => (typeof r.px === 'number' && Number.isInteger(r.px) && r.px > 0 ? r.px : null);
/** A row's `at`, when it is a px `[x, y]` of whole numbers inside a frame of `size`; else null. */
export function atOf(r: Row, size: readonly [number, number]): [number, number] | null {
  const a = r.at;
  if (!Array.isArray(a) || a.length !== 2 || !a.every((v) => typeof v === 'number' && Number.isInteger(v))) return null;
  const [x, y] = a as [number, number];
  return x >= 0 && y >= 0 && x < size[0] && y < size[1] ? [x, y] : null;
}
/** Why a 3D table's rows aren't `{id, box, px, at}` with px a whole count above 0 and `at` a px of the frame. */
export function shapeFailures(t: Table, size: readonly [number, number], what: string): string[] {
  const f: string[] = [];
  for (const r of t.rows) {
    if (pxOf(r) === null) f.push(`${what}: the row of ${r.id} carries no px count (px ${brief(r.px, 80)})`);
    if (atOf(r, size) === null) f.push(`${what}: the row of ${r.id} carries no visible centre at a px of the ${size[0]} × ${size[1]} frame (at ${brief(r.at, 80)})`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Picks, read through render-back's probes (Render-back: `probes ≤ 64`, answered through the object-ID pass, hits
// nearest first; a px where the pass drew no surface answers no hits).

export type Px = [number, number];
const key = (p: Px): string => `${p[0]},${p[1]}`;
/** Every px of `r`, grown by `grow` px on each side and clipped to a frame of `size`. */
export function pxIn(r: Rect, size: readonly [number, number], grow = 0): Px[] {
  const out: Px[] = [];
  for (let y = Math.max(0, r[1] - grow); y < Math.min(size[1], r[3] + grow); y++) {
    for (let x = Math.max(0, r[0] - grow); x < Math.min(size[0], r[2] + grow); x++) out.push([x, y]);
  }
  return out;
}
/** Render-back calls on revision `rev` of `doc` at `size` probing each of `points`, 64 a call. */
export function probeCalls(doc: string, rev: number, size: readonly [number, number], points: readonly Px[]): JsonObject[] {
  const calls: JsonObject[] = [];
  for (let k = 0; k < points.length; k += 64) calls.push(renderBack(doc, rev, size, { probes: points.slice(k, k + 64).map((p) => [...p]) }));
  return calls;
}
/**
 * The item each probed px's pick resolves to ('' where the object-ID pass drew nothing), by px, from the replies of
 * `probeCalls(…, points)`. Each reply must be presented and its snapshot be `sha256`, the picture the table is of.
 */
export function picksOf(replies: readonly JsonObject[], points: readonly Px[], sha256: string, what: string): Map<string, string> {
  const out = new Map<string, string>();
  replies.forEach((reply, c) => {
    const snaps = snapshotsOf(reply, `${what}: render-back ${c}`);
    expect(snaps.map((s) => s['sha256']), `${what}: render-back ${c} draws the same picture as the render-back whose table is read`).toEqual([sha256]);
    const hits = arr(reply['hits'], `${what}: render-back ${c}: hits`);
    const asked = points.slice(c * 64, c * 64 + 64);
    expect(hits.length, `${what}: render-back ${c} answers each of its ${asked.length} probes`).toBe(asked.length);
    hits.forEach((list, i) => {
      const first = arr(list, `${what}: render-back ${c}: hits[${i}]`)[0];
      const item = isObject(first) ? first['item'] : undefined;
      out.set(key(asked[i]!), typeof item === 'string' ? item : '');
    });
  });
  return out;
}
/** The item `picks` says px `p`'s pick resolves to; undefined where `p` wasn't probed. */
export const pickAt = (picks: Map<string, string>, p: Px): string | undefined => picks.get(key(p));
/** How many probed px resolve to `id`. */
export const countOf = (picks: Map<string, string>, id: string): number => [...picks.values()].filter((v) => v === id).length;

// ---------------------------------------------------------------------------------------------------
// The machine: the perf lane's own rule (scripts/benchmark.mjs), and the machine's GPU lease

/** The one-minute load average, which `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** Five runs after warm-up on a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at
 * each run's start and end within the cores: PASS, FAIL, or INCONCLUSIVE with the runs. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}

/** The machine's GPU lease: the file crates/deep-show/src/kit/goldens.rs `GpuLease` holds while a kit or an export draws. */
export const GPU_LEASE = join(process.env['HOME'] ?? tmpdir(), '.cache', 'deepbuild-gpu', 'lease');
export type Lease = { ok: true; ours: () => boolean; release: () => void } | { ok: false; reason: string };
/** Probes a PID with signal 0 (sends nothing); a process we may not signal still counts as alive. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Takes the lease at `file` as GpuLease does (create it, holding this PID); a live holder's lease is never taken. */
export function takeGpuLease(file = GPU_LEASE): Lease {
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(file, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd);
      const ours = (): boolean => { try { return readFileSync(file, 'utf8').trim() === String(process.pid); } catch { return false; } };
      return { ok: true, ours, release: () => { if (ours()) unlinkSync(file); } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder = NaN;
      try { holder = Number(readFileSync(file, 'utf8').trim()); } catch { /* removed meanwhile */ }
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return { ok: false, reason: `another GPU job holds the machine's GPU lease (${file}, process ${holder})` };
      try { unlinkSync(file); } catch { /* another taker removed it */ }
    }
  }
  return { ok: false, reason: `the machine's GPU lease (${file}) could not be taken` };
}
