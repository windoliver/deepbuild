// Test-side tools for the #1217 acceptance tests (README: The surface under test). They build `deep-show` (the full
// set, once per file, as #169's and #172's suites build it), drive `deep-show run` (#393's scenario on #383's virtual
// clock, as #540's suite drives a 3D panel) and `deep-show screen` (#1162's window), write the fixtures, hold the
// reviewed references (camera@1's pinhole, the snap candidates of a built mesh, the readout's text), serve a web bundle
// from a child process and drive Google Chrome, headless with WebGPU on, over its DevTools protocol (no
// browser-automation library). Copied in part from ../169, ../172, ../540 and ../1976, since suites don't import each
// other. Nothing here stands in for the measure tool, the hit path, the snap, the input track, the export or the
// player: every point, text, hash and pixel a test reads is the implementation's own, and every expected value comes
// from the issue, the design and the fixtures. The assertions on the new behaviour are in the test files; what this
// file asserts is the harness (a process ran, a line is JSON) and the gates that are never a pass.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1217 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Every test and hook passes one of these: a first build of deep-show takes a long time on a loaded machine. */
export const TIMEOUT = 3_600_000;
export const HOOK_TIMEOUT = 300_000;
const RUN_TIMEOUT = 1_800_000;

/** Each criterion's ID: `#1217.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1217.727f50dc',
  2: 'AC2 #1217.a1a883c2',
  3: 'AC3 #1217.21c1b4f7',
  4: 'AC4 #1217.582db303',
  5: 'AC5 #1217.bf9688c3',
  6: 'AC6 #1217.628255fc',
  7: 'AC7 #1217.a0c92377',
} as const;
export const TASTE_CRITERION = '#1217.a0c92377';

/** The planted programs the Proof line names (README: Planted programs). */
export type Planted = 'measure_ignores_shown_at' | 'measure_writes_entry';

// ---------------------------------------------------------------------------------------------------
// JSON, and the gates that are never a pass

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** A test that can't be judged here fails with this, never passes (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** The app draws 3D on macOS's Metal device. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`deep-show draws 3D and names the item under a click on macOS's Metal device; this is ${process.platform}`);
}
/** A member of an object, or undefined when the value isn't one. */
export const at = (v: JsonValue | undefined, ...keys: string[]): JsonValue | undefined => {
  let cur: JsonValue | undefined = v;
  for (const k of keys) cur = isObject(cur) ? cur[k] : undefined;
  return cur;
};

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; the scope's virtual clock (#383's): 120 Hz, the latch 2 ms before vsync.

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: Size = [2560, 1600];
/** The reference window (technical design: The reference window): 1512 × 982 points at 2×, and its display. */
export const REFERENCE_WINDOW: Size = [1512, 982];
export const REFERENCE_SCALE = 2;
const WINDOW_DISPLAY: Size = [1728, 1117];

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, copied out
// of the target folder; a test that uses a build that failed fails with cargo's error.

const BUILD_ARGS = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
function build(to: string): string {
  const r = spawnSync('cargo', BUILD_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l));
    return `cargo ${BUILD_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
  }
  copyFileSync(join(TARGET, 'debug', 'deep-show'), to);
  return '';
}
/** `deep-show`, built before the file's tests. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1217-bin-'));
    error = build(join(dir, 'deep-show'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; }, HOOK_TIMEOUT);
  return () => {
    if (/cargo could not run/.test(error)) blocked(`${error}: this machine lacks the Rust toolchain`);
    expect(error, `the binary builds: cargo ${BUILD_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-show');
  };
}
/** Fresh folders for a test (evidence stores, export outputs), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, HOOK_TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1217-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer line `{ok, replies}` (#393).

export const SESSION = 'sess-1217';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-1217', name: 'Test agent: measure in 3D', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1217D${String(n).padStart(17, '0')}`;
/** The one panel every scenario shows its document in. */
export const PANEL = 'p1';

export interface ScenarioOptions { planted?: Planted; window?: Size }
/**
 * A scenario: the agent's session, the process table, the document in a visible panel whose rect is `[0, 0, w, h]`,
 * its document's `size` (so a panel pixel is a frame pixel), the scope's virtual clock and a display, the app's window
 * when asked (for `screen`), `planted` when given, and the calls.
 */
export function scenario(evidence: string, doc: string, size: Size, calls: JsonObject[], o: ScenarioOptions = {}): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, size[0], size[1]] } }, docs: { [doc]: { panel: PANEL } },
    clock: CLOCK, display: o.window ? WINDOW_DISPLAY : DISPLAY, ...(o.window ? { window: o.window } : {}), ...(o.planted ? { planted: o.planted } : {}), calls,
  };
}
/** What `deep-show run` answered: whether it took the scenario, its replies (one per call when it did), the line. */
export interface Answer { ok: boolean; replies: JsonObject[]; raw: JsonValue }
/** `deep-show run` on one scenario. The harness holds only that the process ran and wrote one JSON line; whether the
 * scenario was taken (`ok`) is the test's to assert. */
export function runShow(bin: string, sc: JsonObject, what: string): Answer {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: RUN_TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${what}: deep-show run ${(r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'did not finish within its timeout' : `could not run: ${r.error.message}`}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  let raw: JsonValue;
  try { raw = JSON.parse(lines[lines.length - 1] ?? '') as JsonValue; } catch { throw Error(`${what}: deep-show run wrote no JSON answer (exit ${String(r.status)}, ${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`); }
  const ok = isObject(raw) && raw['ok'] === true;
  const list = isObject(raw) && Array.isArray(raw['replies']) ? raw['replies'].filter(isObject) : [];
  if (ok && list.length !== (sc['calls'] as JsonValue[]).length) throw Error(`${what}: deep-show run answered ${list.length} replies to ${(sc['calls'] as JsonValue[]).length} calls`);
  return { ok, replies: list, raw };
}
/** `deep-show screen` (#1162): the scenario's calls run, then the app's window drawn at `t` flicks at `scale` device
 * pixels a point, written to `out` as a PNG. The answer line; off macOS, INCONCLUSIVE. */
export function runScreen(bin: string, sc: JsonObject, out: string, t: number, scale: number, what: string): JsonObject {
  const r = spawnSync(bin, ['screen'], { cwd: REPO, input: `${JSON.stringify({ ...sc, out, t, scale })}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: RUN_TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${what}: deep-show screen could not run: ${r.error.message}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  let raw: JsonValue;
  try { raw = JSON.parse(lines[lines.length - 1] ?? '') as JsonValue; } catch { throw Error(`${what}: deep-show screen wrote no JSON answer (exit ${String(r.status)}); stderr: ${(r.stderr ?? '').slice(-1500)}`); }
  if (isObject(raw) && raw['code'] === 'unsupported_platform') inconclusive(`${what}: the app's window draws on macOS; this is ${process.platform}`);
  return isObject(raw) ? raw : { ok: false, answer: raw };
}
/** A PNG's width and height from its header, or null when the bytes aren't a PNG. */
export function pngSize(b: Uint8Array): Size | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

// ---------------------------------------------------------------------------------------------------
// The calls of one run on the scope's virtual clock, each at its own `at`, in order; each method gives the index of
// its call, so a test reads that call's reply.

export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  /** The time of the last call, in flicks. */
  get now(): number { return this.t; }
  private add(c: JsonObject, gap: number, key: 'at' | 'arrives' = 'at'): number {
    this.t += Math.round(gap);
    this.calls.push({ ...c, [key]: this.t });
    return this.calls.length - 1;
  }
  /** Moves the clock to `t` flicks: the next call with gap 0 comes exactly then. */
  until(t: number): void {
    if (t < this.t) throw Error(`the script is already past ${t} flicks`);
    this.t = t;
  }
  /** The agent's `deep_show` of a whole document (#393), with its issues. */
  present(doc: string, document: JsonObject): number { return this.add({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] }, 706); }
  scope(): number { return this.add({ call: 'scope', panel: PANEL }, 100 * MS); }
  input(event: JsonObject, gap = 100 * MS): number { return this.add({ call: 'input', panel: PANEL, event }, gap); }
  /** The viewer's setting (README: turning the tool on). */
  measure(on: boolean): number { return this.input({ type: 'control', control: 'measure', value: on }); }
  /** A value for one of the document's own controls, at the clock's time now plus `gap`. */
  control(control: string, value: JsonValue, gap = 100 * MS): number { return this.input({ type: 'control', control, value }, gap); }
  /** A click: a press and a release 60 ms apart at `p` (panel px). The indices of both calls. */
  click(p: V2): [number, number] {
    return [this.input({ type: 'down', pos: p, button: 'primary' }, 200 * MS), this.input({ type: 'up', pos: p, button: 'primary' }, 60 * MS)];
  }
  key(key: string): number { return this.input({ type: 'key', key }); }
  /** #420's `geometry`: each item's built mesh in item space with its anchors and its world matrix (it arrives at `arrives`). */
  geometry(doc: string, items: string[]): number { return this.add({ call: 'geometry', doc, items }, 50 * MS, 'arrives'); }
  /** #1164's `track`: the document's input track as the hub holds it, with its hash. */
  track(doc: string): number { return this.add({ call: 'track', doc }, 50 * MS); }
  /** #222's evaluated-data hash at `t` flicks. */
  dataHash(doc: string, t: number): number { return this.add({ call: 'eval', doc, t, data_hash: true }, 50 * MS); }
  /** #501's export of every frame as PNGs into `out`, at `rate`, replaying the hub's input track. */
  exportFrames(doc: string, out: string, rate: [number, number]): number { return this.add({ call: 'export', doc, out, video: { codec: 'png_seq' }, frame_rate: rate }, 50 * MS); }
  /** #172's web export into the folder `out`. */
  exportWeb(doc: string, out: string): number { return this.add({ call: 'export', doc, out, video: { codec: 'web' } }, 50 * MS); }
}

/** Why a `deep_show` reply didn't present its document with no error, or '' when it did. */
export function notPresented(reply: JsonObject | undefined): string {
  if (!reply) return 'no reply';
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const errors = issues.filter((i) => i['severity'] === 'error').map((i) => `${String(i['code'])} at ${String(i['path'])}`);
  if (reply['outcome'] !== 'presented') return `outcome ${show(reply['outcome'])}${errors.length ? `, errors: ${errors.join('; ')}` : `: ${show(reply, 800)}`}`;
  return errors.length ? `presented with errors: ${errors.join('; ')}` : '';
}

// ---------------------------------------------------------------------------------------------------
// The tool's state as the app's `state.measure` and the player's `probe().measure` give it (README: what is read).

export interface Placed { item: string; point: V3 }
export interface Readout { distance: string | null; run: string | null; rise: string | null; why: string | null }
export interface Measure { on: boolean | null; a: Placed | null; b: Placed | null; readout: Readout | null; raw: JsonValue | undefined }
const v3Of = (v: JsonValue | undefined): V3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[] as V3) : null;
function placedOf(v: JsonValue | undefined): Placed | null {
  const point = v3Of(at(v, 'point'));
  const item = at(v, 'item');
  return point && typeof item === 'string' ? { item, point } : null;
}
/** White space of any kind (no-break and narrow spaces included) collapsed to one space. */
export const spaced = (s: string): string => s.replace(/\s+/gu, ' ').trim();
const textOf = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? spaced(v) : null);
/** A `measure` object decoded; a field it doesn't hold reads null. */
export function measureOf(v: JsonValue | undefined): Measure {
  const r = at(v, 'readout');
  return {
    on: typeof at(v, 'on') === 'boolean' ? (at(v, 'on') as boolean) : null,
    a: placedOf(at(v, 'a')), b: placedOf(at(v, 'b')),
    readout: isObject(r) ? { distance: textOf(r['distance']), run: textOf(r['run']), rise: textOf(r['rise']), why: textOf(r['why']) } : null,
    raw: v,
  };
}
/** The tool's state in an `input` or `scope` reply (`state.measure`). */
export const measureIn = (reply: JsonObject | undefined): Measure => measureOf(at(reply, 'state', 'measure'));
/** The three texts of a readout, as one line a failure can show. */
export const readoutText = (r: Readout | null): string => (r ? `distance ${show(r.distance)}, run ${show(r.run)}, rise ${show(r.rise)}${r.why === null ? '' : `, why ${show(r.why)}`}` : 'no readout');
/** The numbers a sentence holds in digits, group marks between digits dropped (`1,000` reads 1000). */
export function numbersIn(text: string): number[] {
  const plain = text.replace(/(\d)[,\u00a0\u202f\u2009 ](?=\d{3}(?!\d))/gu, '$1');
  return (plain.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
/** A length as the readout writes it at `precision` decimals in metres: `5.00 m`. */
export function metres(m: number, precision = 2): string {
  const tie = Math.abs(((m * 10 ** precision) % 1) - 0.5);
  if (tie < 1e-6) throw Error(`the fixture: ${m} m lies on a rounding tie at ${precision} decimals`);
  return `${m.toFixed(precision)} m`;
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors and camera@1's pinhole (#378, #1976): position, target, +Y up, `fov` degrees across
// the wider side of `size`; pixel (x, y)'s centre at (x + 0.5, y + 0.5), x right, y down.

export type V2 = [number, number];
export type V3 = [number, number, number];
export type Size = [number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const fmt = (p: readonly number[]): string => `(${p.map((v) => v.toFixed(6)).join(', ')})`;

export interface Pinhole { position: V3; target: V3; fov: number; size: Size }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360) };
}
/** The unit ray from the eye through frame point (sx, sy) in px. */
export function rayAt(cam: Pinhole, [sx, sy]: V2): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands in the frame, px; null behind the eye. */
export function project(cam: Pinhole, p: V3): V2 | null {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return z > 1e-9 ? [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z] : null;
}
/** Where the ray through frame point `px` meets the plane n · p = offset, or null when it runs along it. */
export function meetPlane(cam: Pinhole, px: V2, n: V3, offset: number): V3 | null {
  const d = rayAt(cam, px); const along = dot(n, d);
  if (Math.abs(along) < 1e-12) return null;
  return add(cam.position, scale(d, (offset - dot(n, cam.position)) / along));
}
/** The frame point `px` pixels from `target`'s projection toward `toward`'s: a click near a point, inside a face. */
export function clickNear(cam: Pinhole, target: V3, toward: V3, px = 5): V2 {
  const a = project(cam, target); const b = project(cam, toward);
  if (!a || !b) throw Error(`the fixture: ${fmt(target)} or ${fmt(toward)} is behind the eye`);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // A whole multiple of 1/64 px, so the click is the same number in f32 and f64.
  return [Math.round((a[0] + ((b[0] - a[0]) * px) / l) * 64) / 64, Math.round((a[1] + ((b[1] - a[1]) * px) / l) * 64) / 64];
}
/** The camera a scope state shows (#383's `state.camera`), or why it isn't `cam` within 1e-9. */
export function cameraDiffers(reply: JsonObject | undefined, cam: Pinhole): string {
  const c = at(reply, 'state', 'camera');
  const position = v3Of(at(c, 'position')); const target = v3Of(at(c, 'target')); const fov = at(c, 'fov');
  if (!position || !target || typeof fov !== 'number') return `the scope gives no camera: ${show(c, 400)}`;
  // The target may sit anywhere along the view axis: the pose is the eye, the direction and the field of view.
  const off = dist(unit(sub(target, position)), unit(sub(cam.target, cam.position)));
  return dist(position, cam.position) <= 1e-9 && off <= 1e-9 && Math.abs(fov - cam.fov) <= 1e-9 ? '' : `the scope's camera is at ${fmt(position)} looking at ${fmt(target)} with fov ${fov}, not at ${fmt(cam.position)} looking at ${fmt(cam.target)} with fov ${cam.fov}`;
}

// ---------------------------------------------------------------------------------------------------
// A built mesh as #420's `geometry` reports it, placed in the world, and its snap candidates.

export interface Built { id: string; vertices: V3[]; triangles: [number, number, number][]; anchors: Record<string, V3> }
/** Each item's row of a `geometry` reply (its mesh and anchors in item space), placed in the world by the position
 * the fixture gives the item (`placed`: item ID to its `at.pos`; no fixture turns or scales a part, and every
 * assembly sits at the origin); a failure text for a reply that holds no mesh for one. */
export function builtOf(reply: JsonObject | undefined, placed: Record<string, V3>): { built: Built[]; problem: string } {
  const rows = Array.isArray(reply?.['items']) ? reply['items'].filter(isObject) : [];
  const built: Built[] = [];
  for (const [id, pos] of Object.entries(placed)) {
    const row = rows.find((r) => r['id'] === id);
    const positions = Array.isArray(row?.['positions']) ? row['positions'].map(v3Of) : [];
    const indices = Array.isArray(row?.['indices']) ? row['indices'] : [];
    if (!row || positions.length === 0 || positions.some((p) => p === null) || indices.length % 3 !== 0 || !indices.every((i) => typeof i === 'number')) {
      return { built, problem: `geometry gives no mesh for ${id}: ${show(row ?? reply, 500)}` };
    }
    const place = (p: V3): V3 => add(p, pos);
    const triangles: [number, number, number][] = [];
    for (let i = 0; i < indices.length; i += 3) triangles.push([indices[i] as number, indices[i + 1] as number, indices[i + 2] as number]);
    const anchors: Record<string, V3> = {};
    for (const [name, a] of Object.entries(isObject(row['anchors']) ? row['anchors'] : {})) {
      const pos = v3Of(at(a, 'pos'));
      if (pos) anchors[name] = place(pos);
    }
    built.push({ id, vertices: (positions as V3[]).map(place), triangles, anchors });
  }
  return { built, problem: '' };
}
/** Every point a snap can reach on the meshes: each vertex and each triangle edge's midpoint, once each. */
export function snapPoints(meshes: readonly Built[]): { item: string; point: V3; kind: 'vertex' | 'edge midpoint' }[] {
  const seen = new Map<string, { item: string; point: V3; kind: 'vertex' | 'edge midpoint' }>();
  const key = (id: string, p: V3): string => `${id}:${p.map((v) => Math.round(v * 1e7)).join(',')}`;
  for (const m of meshes) {
    for (const p of m.vertices) seen.set(key(m.id, p), { item: m.id, point: p, kind: 'vertex' });
    for (const t of m.triangles) for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      const p = scale(add(m.vertices[t[i]]!, m.vertices[t[j]]!), 0.5);
      if (!seen.has(key(m.id, p))) seen.set(key(m.id, p), { item: m.id, point: p, kind: 'edge midpoint' });
    }
  }
  return [...seen.values()];
}
/**
 * The fixture's check for one click (README: Fixtures): `target` is a vertex or an edge midpoint of `item`'s built
 * mesh (or, with `target` null, the click snaps to nothing), it projects within `near` px of the click, and no other
 * vertex or edge midpoint of any mesh projects within `clear` px of it. '' when it holds, else why not.
 */
export function clickProblem(cam: Pinhole, meshes: readonly Built[], click: V2, item: string, target: V3 | null, near = 6, clear = 16): string {
  const all = snapPoints(meshes);
  const px = (p: V3): number => { const q = project(cam, p); return q ? Math.hypot(q[0] - click[0], q[1] - click[1]) : Infinity; };
  if (target) {
    const own = all.find((c) => c.item === item && dist(c.point, target) <= 1e-6);
    if (!own) return `${fmt(target)} is neither a vertex nor an edge's midpoint of ${item}'s built mesh`;
    if (px(target) > near) return `${fmt(target)} projects ${px(target).toFixed(2)} px from the click (${click.join(', ')}), not within ${near}`;
  }
  const others = all.filter((c) => !(target && dist(c.point, target) <= 1e-6)).map((c) => ({ c, d: px(c.point) })).sort((x, y) => x.d - y.d);
  const first = others[0];
  return first && first.d < clear ? `the ${first.c.kind} ${fmt(first.c.point)} of ${first.c.item} projects ${first.d.toFixed(2)} px from the click (${click.join(', ')}), inside ${clear} px` : '';
}

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: Fixtures). Documents are in the agent's form for `deep_show` (no layers; the hub stamps them).

const ordered = (items: Record<string, JsonObject>): JsonObject =>
  Object.fromEntries(Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(3, '0')}`, ...item }]));
const cameraItem = (cam: Pinhole, near: number, far: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near, far } });
/** A lit, opaque, double-sided material of linear `color` (Material), so a solid draws from inside too. */
const lit = (color: V3): JsonObject => ({ kind: 'material@1', params: { base_color: [...color, 1], roughness: 0.8, double_sided: true } });
/** A sun (`light.sun@1`) shining along its own −Z, aimed by `at.rot`, casting no shadow, and a plain sky. */
const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-50, 35, 0] } };
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0.55, 0.65, 0.8, 1], low: [0.8, 0.82, 0.85, 1], ambient_top: [0.5, 0.5, 0.5], ambient_low: [0.35, 0.35, 0.35] } };
const STONE: V3 = [0.62, 0.6, 0.55];
const STEEL: V3 = [0.35, 0.45, 0.6];
/** A part built by `slab@1`: `size` [x, y, z] m, standing on its plan at `pos` (centred in x and z, y up from it). */
const slab = (size: V3, pos: V3, material: string, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'slab@1', role: 'part', params: { size }, at: { pos }, material, ...extra });

export interface Fixture { id: string; size: Size; cam: Pinhole; document: JsonObject }
interface Envelope { id: string; title: string; profile: 'scene' | 'figure'; cam: Pinhole; near: number; far: number; span: string; rate: [number, number]; modules: string[] }
/** A 3D document that offers the measure tool (`viewer_tools: {measure: true}`, the issue's field). */
function measured(e: Envelope, items: Record<string, JsonObject>, extra: JsonObject = {}): Fixture {
  const document: JsonObject = {
    format: 1, id: e.id, profile: e.profile, title: e.title, description: `${e.title}: a fixture of the measure tool's acceptance tests.`, size: e.cam.size, seed: 1217, camera: 'cam',
    transport: { span: e.span, frame_rate: e.rate }, requires: { modules: Object.fromEntries(e.modules.map((m) => [m, '^1'])) },
    viewer_tools: { measure: true }, ...extra,
    items: ordered({ cam: cameraItem(e.cam, e.near, e.far), sky: SKY, sun: SUN, stone: lit(STONE), steel: lit(STEEL), ...items }),
  };
  return { id: e.id, size: e.cam.size, cam: e.cam, document };
}

/** The column: a cylinder of radius 1.25 m, 5.000 m tall, its caps fans about a centre vertex (Builder: lathe). */
export const COLUMN = { radius: 1.25, height: 5, segments: 16, top: [0, 5, 0] as V3, bottom: [0, 0, 0] as V3, foot: [1.25, 0, 0] as V3 };
const columnItem = (): JsonObject => ({
  kind: 'lathe@1', role: 'part', material: 'stone',
  params: { outline: [[COLUMN.radius, 0, false], [COLUMN.radius, COLUMN.height, false]], segments: COLUMN.segments, caps: 'flat' },
});
/** The column seen from inside, so one pose shows the faces of both caps (criteria 1 and 6). */
export function columnInside(n: number): Fixture {
  const cam: Pinhole = { position: [-1, 2.5, 0], target: [1, 2.5, 0], fov: 150, size: [800, 800] };
  return measured({ id: DOC(n), title: 'A column measured from inside', profile: 'scene', cam, near: 0.05, far: 50, span: '4s', rate: [60, 1], modules: ['scene3d', 'input'] }, { column: columnItem() });
}
/** The inside view's two clicks: 4.5 px off the projections of the bottom and the top caps' centres, each inside one
 * triangle of its cap's fan, midway between two spokes. A test clicks the bottom first, so the rise from A to B is up
 * and reads 5.00 m whether or not a rise carries a sign. */
export function insideClicks(f: Fixture): { bottom: V2; top: V2 } {
  const b = project(f.cam, COLUMN.bottom)!; const t = project(f.cam, COLUMN.top)!;
  const snapped = (p: V2, d: V2): V2 => [Math.round((p[0] + d[0]) * 64) / 64, Math.round((p[1] + d[1]) * 64) / 64];
  return { bottom: snapped(b, [-4, -2]), top: snapped(t, [4, 2]) };
}
/** The column seen from outside at the reference window's size (criterion 7). */
export function columnOutside(n: number): Fixture {
  const cam: Pinhole = { position: [12, 9, 0], target: [0, 2.5, 0], fov: 40, size: REFERENCE_WINDOW };
  return measured({ id: DOC(n), title: 'A column measured from outside', profile: 'scene', cam, near: 0.1, far: 100, span: '4s', rate: [60, 1], modules: ['scene3d', 'input'] }, { column: columnItem() });
}
/** The outside view's two clicks, each 5 px from its snap target and inside one triangle: on the top cap between two
 * spokes of its fan, and on the wall above the base ring's vertex, half a segment round. */
export function outsideClicks(f: Fixture): { top: V2; foot: V2 } {
  const turn = (deg: number, r: number, y: number): V3 => [r * Math.cos((deg * Math.PI) / 180), y, r * Math.sin((deg * Math.PI) / 180)];
  return { top: clickNear(f.cam, COLUMN.top, turn(33.75, 0.4, COLUMN.height)), foot: clickNear(f.cam, COLUMN.foot, turn(11.25, COLUMN.radius, 1)) };
}

/** The scaled parts (criterion 2): `chip` drawn 2 m across at `shown_at: 1000` (2 mm real), `block` at `shown_at: 1`. */
export const SCALES = { micro: 1000, bench: 1, chipEnds: [[-2.5, 1, 0], [-0.5, 1, 0]] as [V3, V3], chipTop: [-1.5, 1, 0] as V3, blockEnd: [1.25, 1, 0] as V3, blockTop: [1.75, 1, 0] as V3, drawn: 2 };
export function scaledParts(n: number): Fixture {
  const cam: Pinhole = { position: [0, 5, 7], target: [0, 0.5, 0], fov: 40, size: [800, 600] };
  const assembly = (shownAt: number): JsonObject => ({ parent: null, at: { pos: [0, 0, 0] }, shown_at: shownAt });
  return measured(
    { id: DOC(n), title: 'A part drawn larger than real beside one at real size', profile: 'figure', cam, near: 0.1, far: 100, span: '4s', rate: [60, 1], modules: ['scene3d', 'input'] },
    { chip: slab([2, 1, 1], [-1.5, 0, 0], 'steel', { parent: 'micro' }), block: slab([1, 1, 1], [1.75, 0, 0], 'stone', { parent: 'bench' }) },
    { assemblies: { micro: assembly(SCALES.micro), bench: assembly(SCALES.bench) } },
  );
}

/** The cut cube (criterion 3): a closed 2 m cube cut by a view cutaway at x > 0.25, its cut face capped. */
export const CUT = { normal: [1, 0, 0] as V3, offset: 0.25, on: [0.25, 1.45, 0.3] as V3, behind: -1 };
export function cutCube(n: number): Fixture {
  const cam: Pinhole = { position: [6, 1, 0], target: [0, 1, 0], fov: 40, size: [800, 600] };
  return measured({ id: DOC(n), title: 'A solid cut open', profile: 'scene', cam, near: 0.1, far: 100, span: '4s', rate: [60, 1], modules: ['scene3d', 'input'] }, {
    solid: slab([2, 2, 2], [0, 0, 0], 'stone'),
    cut: { kind: 'cutaway@1', params: { planes: [{ normal: CUT.normal, offset: CUT.offset }], cap: 'accent' } },
  });
}

/** The recorded session's piece (criterion 4): a post to measure, and a marker a document slider lifts. 4 s at 6
 * frames a second; the slider's entries come at 1 s and 2.5 s; the evaluated data is hashed on both sides of each. */
export const SESSION_PIECE = {
  corners: [[0.5, 2, 0.5], [-0.5, 2, 0.5], [0.5, 2, -0.5]] as [V3, V3, V3], top: [0, 2, 0] as V3, rate: [6, 1] as [number, number], frames: 24,
  entries: [{ t: FLICKS, value: 0.5 }, { t: (5 * FLICKS) / 2, value: 1.5 }],
  times: [0, FLICKS / 2, (3 * FLICKS) / 2, 3 * FLICKS, (39 * FLICKS) / 10],
  placed: { post: [0, 0, 0] as V3, marker: [2.5, 0, 0] as V3 },
};
export function sessionPiece(n: number): Fixture {
  const cam: Pinhole = { position: [4, 5, 6], target: [0.5, 1, 0], fov: 40, size: [640, 480] };
  return measured(
    { id: DOC(n), title: 'A post beside a marker a slider lifts', profile: 'scene', cam, near: 0.1, far: 100, span: '4s', rate: SESSION_PIECE.rate, modules: ['scene3d', 'input', 'motion'] },
    { post: slab([1, 2, 1], [0, 0, 0], 'stone'), marker: slab([0.5, 0.5, 0.5], [2.5, 0, 0], 'steel') },
    {
      controls: { lift: { kind: 'slider', class: 'document', label: 'Lift', role: 'slider', range: [0, 2], default: 0, increment: 0.5 } },
      drivers: { raise: { target: 'items/marker/at/pos/1', expr: 'h', vars: { h: 'controls/lift/value' } } },
    },
  );
}

/** The two parts (criterion 5): a plinth and a beam, 4 m apart; each part's ID with its `at.pos`. */
export const PARTS: Record<'plinth' | 'beam', V3> = { plinth: [-2, 0, 0], beam: [2, 0, 0] };
export function twoParts(n: number): Fixture {
  const cam: Pinhole = { position: [0, 4, 9], target: [0, 1, 0], fov: 40, size: [800, 600] };
  return measured({ id: DOC(n), title: 'A plinth and a beam', profile: 'scene', cam, near: 0.1, far: 100, span: '4s', rate: [60, 1], modules: ['scene3d', 'input'] }, {
    plinth: slab([1, 1, 1], PARTS.plinth, 'stone'), beam: slab([1, 2, 1], PARTS.beam, 'steel'),
  });
}

// ---------------------------------------------------------------------------------------------------
// A bundle served over HTTP by a child process of its own (as #172's suite serves one: `deep-show run` under
// spawnSync blocks this process's event loop), at http://127.0.0.1:<port>/, with no cross-origin isolation headers.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path');
const [root] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png' };
const s = http.createServer((q, r) => {
  const url = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

export class Server {
  private child: ChildProcess | null = null;
  origin = '';
  /** Serves `root`; resolves once it listens. */
  async start(root: string): Promise<string> {
    const child = spawn(process.execPath, ['-e', SERVER, root], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    this.origin = `http://127.0.0.1:${port}`;
    return this.origin;
  }
  /** Stops the child this started, by its own handle. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
  }
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on, over its DevTools protocol in flat sessions (as #172's suite drives it).
// Chrome runs in a process group of its own and is stopped by that PID; its profile is a fresh folder, removed after.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
];
/** A pause that lets the page draw a frame; no test reads how long anything took. */
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Record<string, unknown>) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, session = '', timeoutMs = 120_000): Promise<Record<string, unknown>> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Record<string, unknown>) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** The bundle's index page open in the browser (a target in a flat session). */
export class Tab {
  readonly errors: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, readonly target: string) {}
  /** A script's value in the page (its own JavaScript, as text), awaited. */
  async evaluate<T>(expression: string, timeoutMs = 120_000): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, this.session, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** Waits until the page's `<deep-player>` says `ready`, at most `ms`: whether it did, and the notices it shows. BLOCKED
   * when it isn't ready and the browser offers no WebGPU adapter here. */
  async ready(ms = 180_000): Promise<{ ready: boolean; player: boolean; notices: string[] }> {
    const until = Date.now() + ms;
    let s = { ready: false, player: false, notices: [] as string[] };
    while (Date.now() < until) {
      s = await this.evaluate<typeof s>(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true),
        notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`).catch(() => s);
      if (s.ready) return s;
      await sleep(200);
    }
    const gpu = await this.evaluate<string>(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e: Error) => e.message);
    if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the player needs WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    return s;
  }
  /** `probe()` of the page's player, as plain data. */
  probe(): Promise<JsonValue> {
    return this.evaluate<JsonValue>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v ?? null)); })()`);
  }
  /** The tool's state as the player gives it (`probe().measure`). */
  async measure(): Promise<Measure> { return measureOf(at(await this.probe(), 'measure')); }
  /** `probe().measure`, read until `until` holds or `ms` pass; the last reading. */
  async measureUntil(until: (m: Measure) => boolean, ms = 30_000): Promise<Measure> {
    const end = Date.now() + ms;
    let m = await this.measure();
    while (!until(m) && Date.now() < end) { await sleep(100); m = await this.measure(); }
    return m;
  }
  /** The viewer's setting on the player (README: the member `measure`): whether the element has the member (before
   * anything is set, so a property this call adds doesn't count), and what it reads after it is set. */
  setMeasure(on: boolean): Promise<{ member: boolean; reads: JsonValue }> {
    return this.evaluate(`(() => { const p = document.querySelector('deep-player'); const member = 'measure' in p; p.measure = ${on ? 'true' : 'false'};
      return { member, reads: p.measure === undefined ? null : p.measure }; })()`);
  }
  /** The player's canvas in the page: its client rect in CSS px, or why a frame point can't be mapped onto it. */
  async canvas(size: Size): Promise<{ rect: [number, number, number, number]; problem: string }> {
    const r = await this.evaluate<[number, number, number, number] | null>(`(() => { const c = document.querySelector('deep-player canvas'); if (!c) return null; c.scrollIntoView({ block: 'start', inline: 'start' });
      const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
    if (!r) return { rect: [0, 0, 0, 0], problem: 'the page has no <deep-player> canvas' };
    const fits = r[2] > 0 && r[3] > 0 && Math.abs(r[2] / r[3] - size[0] / size[1]) <= 2 / Math.min(r[2], r[3]);
    return { rect: r, problem: fits ? '' : `the canvas's box is ${r[2]} × ${r[3]} CSS px, not the frame's ${size[0]} : ${size[1]}, so a frame point has no one place on it` };
  }
  /** A left click at frame point `p` of a `size` frame drawn in the canvas's `rect`, as a mouse would. */
  async click(rect: [number, number, number, number], size: Size, p: V2): Promise<void> {
    const x = rect[0] + (p[0] * rect[2]) / size[0]; const y = rect[1] + (p[1] * rect[3]) / size[1];
    const mouse = (type: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => this.cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, this.session);
    await mouse('mouseMoved');
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
  }
  /** The page as the browser draws it, a PNG of the viewport at its device scale. */
  async screenshot(): Promise<Buffer> {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, this.session, 180_000);
    return Buffer.from(String(r['data'] ?? ''), 'base64');
  }
}

/** One browser for a test. Close it in a `finally`. */
export class Chrome {
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string) {}
  static async open(): Promise<Chrome> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the player is driven in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-1217-chrome-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 60_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { stop(chrome, profile); blocked(`${CHROME} opened no DevTools port within 60 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { stop(chrome, profile); return blocked((e as Error).message); }
    return new Chrome(chrome, cdp, profile);
  }
  /** Opens `url` in a new page of `viewport` CSS px at `deviceScale` device pixels a CSS px. */
  async open(url: string, viewport: Size, deviceScale = 1): Promise<Tab> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const tab = new Tab(this.cdp, sessionId, targetId);
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => tab.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: deviceScale, mobile: false }, sessionId);
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => undefined);
    await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => undefined);
    return tab;
  }
  async close(): Promise<void> {
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    stop(this.chrome, this.profile);
  }
}
/** Stops the Chrome this file started: its own process group, by its PID. */
function stop(chrome: ChildProcess, profile: string): void {
  if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
  rmSync(profile, { recursive: true, force: true });
}

/** A bundle served and opened in a browser for one test. */
export interface Played { server: Server; chrome: Chrome; tab: Tab }
export async function play(folder: string, viewport: Size, deviceScale = 1): Promise<Played> {
  const server = new Server();
  const origin = await server.start(folder);
  let chrome: Chrome;
  try { chrome = await Chrome.open(); } catch (e) { await server.stop(); throw e; }
  const tab = await chrome.open(`${origin}/index.html`, viewport, deviceScale);
  return { server, chrome, tab };
}
/** Pages a test opened, closed after it whether it passed or not. */
export function useBrowsers(): (p: Played) => Played {
  const open: Played[] = [];
  afterEach(async () => { for (const p of open.splice(0)) { await p.chrome.close(); await p.server.stop(); } }, HOOK_TIMEOUT);
  return (p) => { open.push(p); return p; };
}
