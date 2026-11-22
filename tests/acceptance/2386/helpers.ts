// Test-side tools for the #2386 acceptance tests (README: The surface under test). JSON judging, PNG reading and
// writing, the look and `deep-canvas-render`'s driver come from ../467/helpers.ts by import; its raster lines and flat
// asset store from ../1653/helpers.ts; a check issue's own fields from ../536/helpers.ts; `deep-show run`'s driver and
// the evidence store from ../535/helpers.ts (all read only, as #536's suite imports #467's and #1653's). This file adds
// the two builds with their BLOCKED gate, this suite's scenario for `deep-show run`, the readers of a row's box where
// the issue says it shows (a set's bounds, the spatial index, `deep_show`'s table), a click and the selection it
// leaves, and the perf lane's judge for the budget. Nothing here stands in for the layout, the renderer, the spatial
// index or the hit test: every box, pixel, batch and selection read here is the binary's own, and every expected value
// comes from the issue's text.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import {
  LOOK, REPO, arr, errorsOf, issuesOf, num, obj, render, sha256, shown, str, type Image, type Issue, type JsonObject, type JsonValue,
} from '../467/helpers.ts';

export {
  LOOK, REPO, arr, check, decodePng, describeErrors, encodeRgbaPng, none, num, obj, px, sha256, shown, str, type Image, type Issue,
  type JsonObject, type JsonValue,
} from '../467/helpers.ts';
export { putAssets, rasterLine, rasterLines, rgbOff, solidAtlas } from '../1653/helpers.ts';
export { fieldsOf, namesItem, namesWord } from '../536/helpers.ts';
export { failsNaming, framesOf, pngOf, presented, putEvidence, runShow, shownSnapshot } from '../535/helpers.ts';

/** Each criterion's ID: `#2386.` + the first 8 hex digits of the SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #2386.2ebddc6b',
  2: 'AC2 #2386.4227a011',
  3: 'AC3 #2386.022a979d',
  4: 'AC4 #2386.dd0857c2',
  5: 'AC5 #2386.a5636b1c',
  6: 'AC6 #2386.b3f6fe16',
  7: 'AC7 #2386.e61634a0',
} as const;
/** Every test passes this explicit timeout: a spawned process can take tens of seconds to start on a loaded machine. */
export const TIMEOUT = 1_800_000;

export type Pt = [number, number];
/** A box `[x, y, w, h]` in u. */
export type Box = [number, number, number, number];
export type Rgb = [number, number, number];

/** A reading that can't count here fails with this, never passes (invariant 2). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Runs `make` once per file, the first time a test asks: the tests of one clause share one run of a scenario. */
export function once<T>(make: () => T): () => T {
  let done: { value: T } | null = null;
  return () => (done ??= { value: make() }).value;
}
/** A box as text, each number to a millionth of a u: `[-32, -48, 64, 64]`. */
export const boxText = (b: readonly number[]): string => `[${b.map((v) => Number(v.toFixed(6))).join(', ')}]`;
/** Two boxes equal within `tol` u on each number. */
export const sameBox = (a: Box, b: Box, tol = 1e-9): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
/** `b` moved by `by`: a box in a set's own u as the page holds it, the set at `by`. */
export const moved = ([x, y, w, h]: Box, [dx, dy]: Pt): Box => [x + dx, y + dy, w, h];

// ---------------------------------------------------------------------------------------------------
// The builds: each binary built once per file and copied out of the target folder. No cargo is BLOCKED, never a pass.

export type Bin = 'deep-canvas-render' | 'deep-show';
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const copies: string[] = [];
afterAll(() => { for (const d of copies.splice(0)) rmSync(d, { recursive: true, force: true }); });

interface Built { path: string; blocked: string; error: string }
function build(bin: Bin, release: boolean): Built {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return { path: '', error: '', blocked: `cargo could not run (${run.error.message}); this machine lacks the Rust toolchain` };
  if (run.status !== 0) {
    const said = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000);
    return { path: '', blocked: '', error: `cargo ${args.join(' ')} failed:\n${said}` };
  }
  const dir = mkdtempSync(join(tmpdir(), 'deep-2386-bin-'));
  copies.push(dir);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', exe(bin)), join(dir, exe(bin)));
  return { path: join(dir, exe(bin)), blocked: '', error: '' };
}
function built(b: Built, what: string): string {
  if (b.blocked) expect.fail(`BLOCKED: ${b.blocked}; this is not a pass`);
  expect(b.error, `${what} builds`).toBe('');
  return b.path;
}
/** `bin` built once for this file (debug, the default features); the returned function gives its path, failing the test if it can't. */
export function useBin(bin: Bin): () => string {
  let b: Built = { path: '', blocked: '', error: 'the build did not run' };
  beforeAll(() => { b = build(bin, false); }, 3_600_000);
  return () => built(b, `${bin} (cargo build --locked --bin ${bin})`);
}
/** `bin`'s release build, made when a test asks: the budget's timing alone, on a machine that can judge it. */
export const releaseBin = (bin: Bin): string => built(build(bin, true), `${bin} (cargo build --locked --release --bin ${bin})`);

/** A fresh temporary folder per call, deleted after the test that asked. */
export function useTemp(): () => string {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2386-')); dirs.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render check`: the document check, one line a document, every platform (#373; ../467/helpers.ts `render`).

/** Each of `docs` through one `check` process, with the asset store: whether it passed, and its error issues. */
export function checked(bin: string, docs: JsonObject[], store: string): { ok: boolean; errors: Issue[] }[] {
  return render(bin, 'check', docs.map((doc) => ({ doc, look: LOOK, store }))).map((answer, i) => {
    expect(typeof answer['ok'], `check answers document ${i} with ok: ${shown(answer)}`).toBe('boolean');
    return { ok: answer['ok'] === true, errors: errorsOf(issuesOf(answer, 'check')) };
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}` (../535/helpers.ts `runShow`).

/** The scenario's `planted` values this suite adds (README: Planted programs). */
export type Planted = 'draw_fills_grid_cell' | 'draw_anchors_at_center' | 'grid_hit_reads_quads';
export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
export const SESSION = 'sess-2386';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-2386', name: 'Agent: tall tiles', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** The interaction scope's virtual clock (#383's): 120 Hz, the latch 2 ms before vsync, 0.5 ms of the checker. */
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: Pt = [1600, 900];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB2386D${String(n).padStart(17, '0')}`;

/** A document shown in a visible panel of its own: `rect` in window px. */
export interface Panel { doc: string; rect: Box }
/**
 * A scenario: the agent's session, the process table, each document in its panel (`p1`, `p2`, … in the order given),
 * the scope's clock and a display when asked (every call then carries its `at`), `planted` when given, and the calls.
 */
export function scenario(evidence: string, panels: Panel[], calls: JsonObject[], o: { planted?: Planted; clock?: boolean } = {}): JsonObject {
  const map: JsonObject = {};
  const docs: JsonObject = {};
  panels.forEach((p, i) => { map[`p${i + 1}`] = { rect: p.rect }; docs[p.doc] = { panel: `p${i + 1}` }; });
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: map, docs,
    ...(o.clock ? { clock: CLOCK, display: DISPLAY } : {}), ...(o.planted ? { planted: o.planted } : {}), calls,
  };
}
/** The agent's `deep_show` of a whole document (#393), with its issues and, with `pixels`, a snapshot, `visible` and `batches`. */
export const showCall = (doc: string, document: JsonObject, pixels = false): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: pixels ? ['issues', 'pixels'] : ['issues'] });
/** `spatial` (#421; a 2D document's since #535) at t 0: one box query per `boxes` entry, each `[x, y, w, h]` in page u. */
export const spatialCall = (doc: string, boxes: Box[]): JsonObject =>
  ({ call: 'spatial', doc, t: 0, queries: boxes.map(([x, y, w, h]) => ({ box: { min: [x, y, -1], max: [x + w, y + h, 1] } })) });
/** `frames` (#387): `count` frames of the live session one 60 fps frame apart from 0, each with its `frame_ms`. */
export const framesCall = (doc: string, count: number, pixels = false): JsonObject => ({ call: 'frames', doc, count, step: '1f', pixels });

/** A spatial reply that answered: the message holds the refusal when it didn't. */
function answered(spatial: JsonObject, what: string): void {
  expect(spatial['code'], `${what}: the spatial call answers the 2D document, not refuses: ${shown(spatial)}`).toBeUndefined();
}
const pair = (v: JsonValue | undefined, what: string): Pt => {
  const l = arr(v, what);
  return [num(l[0], `${what}[0]`), num(l[1], `${what}[1]`)];
};
/** A set's bounds in page u as `spatial` answers them (`items.<set>.bounds {min, max}`, #535's reading), as a box. */
export function boundsOf(spatial: JsonObject, set: string, what: string): Box {
  answered(spatial, what);
  const b = obj(obj(obj(spatial['items'], `${what}: spatial items`)[set], `${what}: spatial items.${set}`)['bounds'], `${what}: spatial items.${set}.bounds`);
  const [min, max] = [pair(b['min'], `${what}: bounds.min`), pair(b['max'], `${what}: bounds.max`)];
  return [min[0], min[1], max[0] - min[0], max[1] - min[1]];
}
/** The rows the spatial index holds that meet query `i`'s box: `results[i]`, each `<set>#<key>`. */
export function metBy(spatial: JsonObject, i: number, what: string): string[] {
  answered(spatial, what);
  return arr(arr(spatial['results'], `${what}: spatial results`)[i], `${what}: spatial results[${i}]`).map((r, k) => str(r, `${what}: results[${i}][${k}]`));
}
/**
 * A set's row in `deep_show`'s table (`visible: [{id, box}]`, the snapshot's px, which are page u at the document's own
 * size): the entry whose `id` is the set's, or, where the table lists a set's rows one by one as `<set>#<key>`, their
 * union; `null` when the table holds neither.
 */
export function tableBoxOf(shownReply: JsonObject, set: string, what: string): Box | null {
  const rows = arr(shownReply['visible'], `${what}: deep_show's visible`).map((r, i) => obj(r, `${what}: visible[${i}]`))
    .filter((r) => r['id'] === set || (typeof r['id'] === 'string' && r['id'].startsWith(`${set}#`)))
    .map((r, i) => arr(r['box'], `${what}: visible box`).map((v) => num(v, `${what}: visible box of ${set} [${i}]`)));
  if (!rows.length) return null;
  const x0 = Math.min(...rows.map((b) => b[0]!)); const y0 = Math.min(...rows.map((b) => b[1]!));
  const x1 = Math.max(...rows.map((b) => b[0]! + b[2]!)); const y1 = Math.max(...rows.map((b) => b[1]! + b[3]!));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** How closely the index probes hold a side, u. */
const EPS = 1 / 64;
const SIDES = ['left', 'right', 'top', 'bottom'] as const;
/**
 * Eight thin boxes about `b`, two a side: one lying just outside the side, which a row whose box is `b` doesn't meet,
 * then one lying just inside it, which it meets. So the index's box for a row is `b` within 1/64 u on every side.
 */
export function sideProbes([x, y, w, h]: Box): Box[] {
  const e = EPS;
  return [
    [x - 1, y + e, 1 - e, h - 2 * e], [x, y + e, e, h - 2 * e],
    [x + w + e, y + e, 1 - e, h - 2 * e], [x + w - e, y + e, e, h - 2 * e],
    [x + e, y - 1, w - 2 * e, 1 - e], [x + e, y, w - 2 * e, e],
    [x + e, y + h + e, w - 2 * e, 1 - e], [x + e, y + h - e, w - 2 * e, e],
  ];
}
/**
 * What is wrong with a row's box against `want`, read the three ways the issue names (README: Readings): the set's
 * bounds (the set holds this one row, so they are its box), the row's box in the spatial index (the eight probes of
 * `want`, asked as queries `first` to `first + 7` of `spatial`), and the set's row in `deep_show`'s table. `want` and
 * the boxes named are in the set's own u, the set at `pos` on the page. Each failure names the row and both boxes.
 */
export function boxProblems(row: string, named: string, shownReply: JsonObject, spatial: JsonObject, first: number, want: Box, pos: Pt = [0, 0]): string[] {
  const set = row.split('#')[0]!;
  const back: Pt = [-pos[0], -pos[1]];
  const out: string[] = [];
  const bounds = moved(boundsOf(spatial, set, named), back);
  if (!sameBox(bounds, want)) out.push(`${named}: the set's bounds give it the box ${boxText(bounds)}, not ${boxText(want)}`);
  SIDES.forEach((side, s) => {
    const [outside, inside] = [metBy(spatial, first + 2 * s, named).includes(row), metBy(spatial, first + 2 * s + 1, named).includes(row)];
    if (outside) out.push(`${named}: the spatial index holds it past the ${side} of ${boxText(want)} (its bounds are ${boxText(bounds)})`);
    else if (!inside) out.push(`${named}: the spatial index holds it short of the ${side} of ${boxText(want)} (its bounds are ${boxText(bounds)})`);
  });
  const listed = tableBoxOf(shownReply, set, named);
  const table = listed && moved(listed, back);
  if (!table || !sameBox(table, want, 1e-6)) out.push(`${named}: deep_show's table gives it the box ${table ? boxText(table) : 'none'}, not ${boxText(want)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Clicks on the scope's virtual clock, and the selection they leave (#383, #384; as #535's and #539's suites click).

/** The calls of one clocked run, each at its own `at`, in order; each method gives the index of its reply. */
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  private add(call: JsonObject, gapMs: number): number {
    this.t += Math.round(gapMs * MS);
    this.calls.push({ ...call, at: this.t });
    return this.calls.length - 1;
  }
  present(doc: string, document: JsonObject): number { return this.add(showCall(doc, document), 1); }
  scope(panel: string): number { return this.add({ call: 'scope', panel }, 160); }
  spatial(doc: string, boxes: Box[]): number { return this.add(spatialCall(doc, boxes), 50); }
  /** A press and its release 60 ms later at panel px `p`, 800 ms after the call before (no double click): the release's reply. */
  click(panel: string, p: Pt): number {
    this.add({ call: 'input', panel, event: { type: 'down', pos: p } }, 800);
    return this.add({ call: 'input', panel, event: { type: 'up', pos: p } }, 60);
  }
}
/** The camera a panel's scope shows (#383's `state.camera` and `state.rect`), which maps a page point (u) to panel px. */
export interface View { target: Pt; width: number; rect: number[] }
export function viewOf(reply: JsonObject, what: string): View {
  const state = obj(reply['state'], `${what}: the scope's state (${shown(reply)})`);
  const cam = obj(state['camera'], `${what}: state.camera`);
  return {
    target: pair(cam['target'], `${what}: camera.target`), width: num(cam['view_width'], `${what}: camera.view_width`),
    rect: arr(state['rect'], `${what}: state.rect`).map((v, i) => num(v, `${what}: state.rect[${i}]`)),
  };
}
export function toPanel(v: View, [x, y]: Pt): Pt {
  const k = v.width / v.rect[2]!;
  return [v.rect[0]! + v.rect[2]! / 2 + (x - v.target[0]) / k, v.rect[1]! + v.rect[3]! / 2 + (y - v.target[1]) / k];
}
/** The selected IDs after an input (`state.selection`, each a row as `<set>#<key>`). */
export const selectionOf = (reply: JsonObject, what: string): string[] =>
  arr(obj(reply['state'], `${what}: state (${shown(reply)})`)['selection'], `${what}: state.selection`).map((s, i) => str(s, `${what}: selection[${i}]`));

// ---------------------------------------------------------------------------------------------------
// Pixels

/** The SHA-256 of a picture's pixels: its width, its height and its RGBA bytes, whatever its PNG's encoding. */
export const pixelHash = (im: Image): string => sha256(Buffer.concat([Buffer.from(`${im.width}x${im.height}\n`), Buffer.from(im.rgba)]));
/** The box `[x, y, w, h]` in px of the pixels that differ from the picture's last pixel (its ground), or null when none does. */
export function drawnExtent(im: Image): Box | null {
  const last = im.rgba.subarray(im.rgba.length - 4);
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const o = (y * im.width + x) * 4;
    if (im.rgba[o] === last[0] && im.rgba[o + 1] === last[1] && im.rgba[o + 2] === last[2] && im.rgba[o + 3] === last[3]) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// ---------------------------------------------------------------------------------------------------
// The budget: the perf lane's own judge (scripts/benchmark.mjs), run in a child process, as #2760's suite reads it.

/** Runs scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and `validateBudgets`). */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** A run's one-minute load average, read at its start and at its end. */
export type Load = { start: number; end: number };
export const loadNow = (): number => loadavg()[0]!;
const judgeLimit = (limit: number, runs: number[], loads: Load[]): JsonObject =>
  obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads }), 'judgeLimit');
/**
 * Why a timing can't count on this machine now, or '' when it can: the lane's judge on five empty readings with the
 * load read now, so the machine (a reference Mac, mains power, Low Power Mode off, thermal state nominal) and the load
 * are read as a run's would be.
 */
export function timingProblem(): string {
  const now = loadNow();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** One limit judged by the lane's rule on five runs after a warm-up, each with its load: PASS passes, FAIL fails, anything else is INCONCLUSIVE. */
export function judge(name: string, limit: number, runs: number[], loads: Load[]): void {
  const v = judgeLimit(limit, runs, loads);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit}, the load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (v['status'] === 'PASS') return;
  expect(v['status'], `FAIL: ${line}`).not.toBe('FAIL');
  inconclusive(line);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
