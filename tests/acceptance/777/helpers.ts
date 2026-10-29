// Test-side tools for the #777 acceptance tests: `deep-gpu` (#377's binary) in #379's `test-meter` build, driven by
// JSON lines through #379's `live` call with this suite's additions (`windows`, a session's `window`, a view's
// `window`, `told`, the meter's `app` row; README: The surface under test); the documents the sessions open,
// generated here; the two-display layout with one costly writer; and the checks the planted programs must fail.
// Nothing here stands in for the meter, the ladder or the windows under test.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/777 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const GPU_BIN = 'deep-gpu';
const uplifted = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// The design's numbers (Meter and degrade ladder; the budget class table).

/** A work product's frame GPU limit, in ms (budget class table): the app budget's limit for these documents. */
export const WORK_PRODUCT_GPU_MS = 2;
/** A layer steps down one rung after 30 consecutive presented frames over its limit (hysteresis: down after 30). */
export const DOWN_AFTER = 30;
/** `measured: 120-frame ring`. */
export const RING = 120;
/** The rungs below the class's base, in the design's order (refuse is the check's, no live rung). */
export const BELOW_BASE = ['effects_off', 'lod_down', 'internal_scale_down', '30hz', 'freeze', 'placeholder'] as const;
const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
const strOrNull = (v: JsonValue | undefined, what: string): string | null => (v === null ? null : str(v, what));

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu` with #379's `test-meter` feature (the stub meter), built once per file.

/** Builds `deep-gpu --features test-meter` once, before the file's tests; a test fails with cargo's error if it failed. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-777-bins-'));
    const args = ['build', '--locked', '--bin', GPU_BIN, '--features', 'test-meter'];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(uplifted(GPU_BIN), join(dir, `${GPU_BIN}-test-meter`));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${GPU_BIN} --features test-meter`).toBe('');
    return join(dir, `${GPU_BIN}-test-meter`);
  };
}

/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-777-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Starting `deep-gpu run`: one scenario line in, one answer line out (#377's JSON-lines convention).

/** The wrong programs `deep-gpu run --planted <name>` reaches, each only there (README: Planted programs). */
export type Planted = 'budgets_each_window' | 'steps_main_window' | 'tells_first_step_only';

/** One `live` call in a fresh `deep-gpu run --backend noop [--planted <name>]`: its reply. */
export function liveRun(bin: string, out: string, call: JsonObject, planted?: Planted): JsonObject {
  const args = ['run', '--backend', 'noop', ...(planted ? ['--planted', planted] : [])];
  const shown = `${GPU_BIN} ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls: [call] })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${shown}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(run.status, `${shown} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const a = obj(answer, `${shown}: the answer`);
  expect(a['ok'], `${shown} refused the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], `${shown}: replies`);
  expect(replies.length, `${shown}: one reply per call`).toBe(1);
  const reply = obj(replies[0], `${shown}: the live reply`);
  expect(reply['code'], `the live call is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Documents: #379's 3D scene document, a work product whose box slides so every frame draws while the view is still.

const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;

function sceneDoc(title: string): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
  };
  for (let i = 0; i < 4; i++) {
    items[`box-${i}`] = {
      id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(3, '0')}`,
      params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [i * 2.5 - 3.75, 0.5, -2.5] },
    };
  }
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #777 acceptance fixture.`, size: [128, 128], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, transport: { span: '60s' }, items,
    channels: { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -3.75, interp: 'linear' }, k1: { t: '60s', value: 3.75, interp: 'linear' } } } },
  };
}
function writeDoc(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The layout: two displays, a window on each, one costly writer.

/** Display UUIDs (Window and display placement: displays are remembered by UUID). */
export const DISPLAY = { A: '6F1C2B9E-3D4A-4E7B-9A21-0C5D8E7F6A11', B: 'B83E5A07-91C2-4D6F-8E3B-7A4C2D1E0F92' } as const;
/** The main window on display A, and a popped-out window on display B. */
export const WIN = { main: 'w-main', pop: 'w-pop' } as const;
export const WINDOWS = [{ window: WIN.main, display: DISPLAY.A }, { window: WIN.pop, display: DISPLAY.B }];
export const W = { alpha: 'agent:alpha', bravo: 'agent:bravo', charlie: 'agent:charlie' } as const;
/** alpha is the costly writer, drawing in the popped-out window on B; bravo and charlie draw in the main window on A. */
export const SESSIONS = [
  { session: 's-alpha', writer: W.alpha, window: WIN.pop },
  { session: 's-bravo', writer: W.bravo, window: WIN.main },
  { session: 's-charlie', writer: W.charlie, window: WIN.main },
] as const;
/** bravo's and charlie's charges, every frame: the main window's frames cost 0.9 ms. */
export const BRAVO_MS = 0.5;
export const CHARLIE_MS = 0.4;

export interface Charge { from: number; to?: number; gpu_ms: number }

/** The `live` call for the layout: `frames` frames at 60 fps, alpha charged `alpha`, the meter reported. */
export function layoutCall(dir: string, frames: number, alpha: Charge[]): JsonObject {
  const sessions = SESSIONS.map((s) => ({ ...s, doc: writeDoc(dir, s.session, sceneDoc(`${s.writer}, a work product`)) }));
  return {
    call: 'live', look: LOOK, frames, fps: 60,
    windows: WINDOWS, sessions,
    report: ['meter'],
    stub_meter: { writers: { [W.alpha]: alpha, [W.bravo]: [{ from: 1, gpu_ms: BRAVO_MS }], [W.charlie]: [{ from: 1, gpu_ms: CHARLIE_MS }] } },
  } as unknown as JsonObject;
}

// ---------------------------------------------------------------------------------------------------
// The `live` reply, as far as these tests read it: failing at the first missing or mistyped field.

export interface View { session: string; writer: string; window: string; rung: string; drawn: boolean; charged_gpu_ms: number }
export interface Frame { frame: number; views: View[] }
export interface Change { frame: number; session: string; writer: string; from: string | null; to: string; reason: string; effective: number }
export interface Told { frame: number; session: string; writer: string; rung: string; reason: string; scope: string | null }
export interface AppRow { windows: string[]; limits: JsonObject; measured: number[] }
export interface Live { frames: Frame[]; changes: Change[]; told: Told[]; app: AppRow; windowRows: JsonObject[] }

export function liveOf(reply: JsonObject, what = 'the live call'): Live {
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i): Frame => {
    const o = obj(f, `${what}: frames[${i}]`);
    const at = `${what}: frame ${o['frame']}`;
    return {
      frame: num(o['frame'], `${what}: frames[${i}].frame`),
      views: arr(o['views'], `${at}: views`).map((v, j): View => {
        const w = obj(v, `${at}: views[${j}]`);
        return {
          session: str(w['session'], `${at}: views[${j}].session`), writer: str(w['writer'], `${at}: views[${j}].writer`),
          window: str(w['window'], `${at}: views[${j}].window`), rung: str(w['rung'], `${at}: views[${j}].rung`),
          drawn: w['drawn'] === true, charged_gpu_ms: num(w['charged_gpu_ms'], `${at}: views[${j}].charged_gpu_ms`),
        };
      }),
    };
  });
  const changes = arr(reply['changes'], `${what}: changes`).map((c, i): Change => {
    const o = obj(c, `${what}: changes[${i}]`);
    const at = `${what}: changes[${i}]`;
    return {
      frame: num(o['frame'], `${at}.frame`), session: str(o['session'], `${at}.session`), writer: str(o['writer'], `${at}.writer`),
      from: strOrNull(o['from'], `${at}.from`), to: str(o['to'], `${at}.to`), reason: str(o['reason'], `${at}.reason`),
      effective: num(o['effective'], `${at}.effective`),
    };
  });
  const told = arr(reply['told'], `${what}: told`).map((t, i): Told => {
    const o = obj(t, `${what}: told[${i}]`);
    const at = `${what}: told[${i}]`;
    expect('scope' in o, `${at}.scope is present (null when no budget moved the rung)`).toBe(true);
    return {
      frame: num(o['frame'], `${at}.frame`), session: str(o['session'], `${at}.session`), writer: str(o['writer'], `${at}.writer`),
      rung: str(o['rung'], `${at}.rung`), reason: str(o['reason'], `${at}.reason`), scope: strOrNull(o['scope'], `${at}.scope`),
    };
  });
  const rows = arr(reply['meter'], `${what}: meter`).map((m, i) => obj(m, `${what}: meter[${i}]`));
  rows.forEach((r, i) => str(r['scope'], `${what}: meter[${i}].scope`));
  const apps = rows.filter((r) => r['scope'] === 'app');
  expect(apps.length, `${what}: the meter has one row of scope app, got scopes ${JSON.stringify(rows.map((r) => r['scope']))}`).toBe(1);
  const a = apps[0]!;
  const app: AppRow = {
    windows: arr(a['windows'], `${what}: the app row's windows`).map((w, i) => str(w, `${what}: the app row's windows[${i}]`)),
    limits: obj(a['limits'], `${what}: the app row's limits`),
    measured: arr(a['measured'], `${what}: the app row's measured`).map((x, i) => num(x, `${what}: the app row's measured[${i}]`)),
  };
  num(app.limits['gpu_ms'], `${what}: the app row's limits.gpu_ms`);
  return { frames, changes, told, app, windowRows: rows.filter((r) => r['scope'] === 'window') };
}

// ---------------------------------------------------------------------------------------------------
// The checks the planted programs must fail. Each returns sentences naming what failed.

const ms = (x: number): string => `${Number(x.toFixed(4))} ms`;

/** Each window's GPU time in a frame: the charges of the views it drew, by window ID, in first-seen order. */
export function perWindow(frame: Frame): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of frame.views) m.set(v.window, (m.get(v.window) ?? 0) + v.charged_gpu_ms);
  return m;
}
const appMs = (frame: Frame): number => frame.views.reduce((s, v) => s + v.charged_gpu_ms, 0);

/**
 * AC1's check, one app budget: whenever the windows' frames together go over the limit for 30 consecutive frames,
 * though each window alone stays under it, a layer steps down at the 30th (the sentence names both windows when not);
 * the meter's app row covers every window, takes its limit from the class and its 120-frame ring holds the windows'
 * frames summed; and no window-scope row carries a budget of its own.
 */
export function appBudgetProblems(live: Live, limitMs: number): string[] {
  const out: string[] = [];
  let streak: Frame[] = [];
  const close = (): void => {
    if (streak.length >= DOWN_AFTER) {
      const at = streak[DOWN_AFTER - 1]!.frame;
      const stepped = live.changes.some((c) => c.frame === at && c.reason === 'frame_health' && c.from !== null && BELOW_BASE.includes(c.to as (typeof BELOW_BASE)[number]));
      if (!stepped) {
        const first = streak[0]!;
        const parts = [...perWindow(first)].map(([w, x]) => `${w} on display ${WINDOWS.find((y) => y.window === w)?.display ?? '?'} (${ms(x)})`);
        out.push(`frames ${first.frame}–${at}: windows ${parts.join(' and ')} were each under the ${ms(limitMs)} limit but together ${ms(appMs(first))}, over it, for ${DOWN_AFTER} frames, and no layer stepped down at frame ${at}: the meter budgeted each window alone`);
      }
    }
    streak = [];
  };
  for (const f of live.frames) {
    const each = [...perWindow(f).values()];
    if (each.length >= 2 && each.every((x) => x <= limitMs + EPS) && appMs(f) > limitMs + EPS) streak.push(f);
    else close();
    // The count restarts after each rung change.
    if (live.changes.some((c) => c.frame === f.frame && c.from !== null)) close();
  }
  close();
  const want = [...new Set(live.frames.flatMap((f) => f.views.map((v) => v.window)))].sort();
  const got = [...live.app.windows].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`the meter's app row covers windows ${JSON.stringify(got)}, not every window the app drew in, ${JSON.stringify(want)}`);
  if (Math.abs((live.app.limits['gpu_ms'] as number) - limitMs) > EPS) out.push(`the meter's app row's limit is ${live.app.limits['gpu_ms']} ms, not the class's ${ms(limitMs)}`);
  const tail = live.frames.slice(-RING);
  if (live.app.measured.length !== tail.length) out.push(`the meter's app ring holds ${live.app.measured.length} frames, not the last ${tail.length}`);
  else tail.forEach((f, i) => {
    const sum = appMs(f);
    if (Math.abs(live.app.measured[i]! - sum) > EPS) out.push(`frame ${f.frame}: the app ring measured ${ms(live.app.measured[i]!)}, not the ${ms(sum)} its windows' frames (${[...perWindow(f)].map(([w, x]) => `${w} ${ms(x)}`).join(', ')}) came to`);
  });
  for (const r of live.windowRows) {
    if (r['limits'] !== null && r['limits'] !== undefined) out.push(`the meter's row for window ${JSON.stringify(r['window'])} carries a budget of its own (${JSON.stringify(r['limits'])})`);
  }
  return out;
}

export interface Expected { frame: number; from: string | null; to: string; reason: string }

/** Each session's ladder changes against the expected ones: each difference a sentence naming the frame and the rung. */
export function ladderProblems(live: Live, expected: Record<string, Expected[]>): string[] {
  const problems: string[] = [];
  for (const [session, want] of Object.entries(expected)) {
    const got = live.changes.filter((c) => c.session === session);
    for (let i = 0; i < Math.max(got.length, want.length); i++) {
      const g = got[i];
      const w = want[i];
      if (g && w && g.frame === w.frame && g.from === w.from && g.to === w.to && g.reason === w.reason) continue;
      if (g && w) problems.push(`frame ${g.frame}: ${session} (${g.writer}) moved ${g.from} → ${g.to} (${g.reason}), where frame ${w.frame} should move ${w.from} → ${w.to} (${w.reason})`);
      else if (g) problems.push(`frame ${g.frame}: ${session} (${g.writer}) moved ${g.from} → ${g.to} (${g.reason}), a change that shouldn't happen`);
      else problems.push(`frame ${w!.frame}: ${session} should move ${w!.from} → ${w!.to} (${w!.reason}) and didn't`);
      break;
    }
  }
  return problems;
}

/**
 * AC2's placement and rungs: every session draws in its own window every frame; `costly` draws at each rung of its
 * changes from the frame the change takes effect; every other writer's view, in either window, draws at base.
 */
export function rungProblems(live: Live, costly: string): string[] {
  const out: string[] = [];
  const steps = live.changes.filter((c) => c.session === costly && c.from !== null);
  const rungAt = (frame: number): string => steps.filter((c) => c.effective <= frame).at(-1)?.to ?? 'base';
  for (const f of live.frames) {
    for (const s of SESSIONS) {
      const v = f.views.find((x) => x.session === s.session);
      if (!v) { out.push(`frame ${f.frame}: no view of ${s.session}`); continue; }
      if (v.window !== s.window) out.push(`frame ${f.frame}: ${s.session} (${s.writer}) drew in ${v.window}, not ${s.window}, the window it draws in`);
      if (!v.drawn) out.push(`frame ${f.frame}: ${s.session} (${s.writer}) didn't draw`);
      const want = s.session === costly ? rungAt(f.frame) : 'base';
      if (v.rung !== want) out.push(`frame ${f.frame}: ${s.session} (${s.writer}) in ${v.window} drew at ${v.rung}, not ${want}`);
    }
  }
  return out;
}

/**
 * "That writer is told why at every rung": for every change of every session, its writer is told at that frame the
 * rung and the reason; a frame-health step-down is told with the budget that moved it, `scope: "app"`.
 */
export function toldProblems(live: Live): string[] {
  const out: string[] = [];
  for (const c of live.changes) {
    const t = live.told.find((x) => x.frame === c.frame && x.session === c.session && x.rung === c.to);
    if (!t) { out.push(`frame ${c.frame}: ${c.writer} (${c.session}) wasn't told why it moved to ${c.to}`); continue; }
    if (t.writer !== c.writer) out.push(`frame ${c.frame}: the message about ${c.session}'s move to ${c.to} went to ${t.writer}, not ${c.writer}`);
    if (t.reason !== c.reason) out.push(`frame ${c.frame}: ${c.writer} was told ${t.reason} for its move to ${c.to}, not ${c.reason}`);
    if (c.reason === 'frame_health' && t.scope !== 'app') out.push(`frame ${c.frame}: ${c.writer} was told its move to ${c.to} was for the ${t.scope} budget, not the app's`);
  }
  return out;
}
