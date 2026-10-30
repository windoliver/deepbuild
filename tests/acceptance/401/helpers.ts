// Test-side tools for the #401 acceptance tests: `deep-show` built once per file and driven by one JSON scenario on
// stdin (`deep-show run`, #393's convention, with #400's displays and virtual display clock); the plug-ins the tests
// install (their panels, element trees, scripts, keymaps and recorded sources); the calls this suite adds and parsers
// for their replies. Nothing here stands in for the panel runtime, the input router, the keymap check, the session's
// box or a bound value: each is read from what `deep-show` answers.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rect = [number, number, number, number];
export type Point = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/401 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function rect(value: JsonValue | undefined, what: string): Rect {
  const r = arr(value, what).map((v, i) => num(v, `${what}[${i}]`));
  expect(r.length, `${what} is [x, y, w, h]`).toBe(4);
  return r as Rect;
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #400's suite does;
// a test that uses a build that failed fails, naming it.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', SHOW_BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** The deep-show binary for this file's tests. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-401-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh scratch folder per test (the evidence store, markers), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-401-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Pipes JSON lines into one run of `bin args…`: exit 0 and exactly one line out per line in, or the test fails. */
export function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 600_000): JsonObject[] {
  const label = `${bin.split('/').pop()} ${args.join(' ')}`;
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`));
}

// ---------------------------------------------------------------------------------------------------
// The clock and the displays (#400's, unchanged)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const SEC = FLICKS;
export const MIN = 60 * SEC;
export const LEAD = 2 * MS; // each display's latch, 2 ms before its vsync
export const CHECK = MS / 2; // 0.5 ms of the checker per patch
export const CLOCK: JsonObject = { lead: LEAD, check: CHECK };

export interface Display { uuid: string; bounds: Rect; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
export const periodOf = (d: Display): number => FLICKS / d.refresh_hz;
/** The built-in display: 120 Hz, at 2×, the main display. */
export const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
/** A second display to its right: 60 Hz, at 1×. */
export const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
export const PERIOD_A = periodOf(A); // 5,880,000 flicks, 8.33 ms
const displayJson = (d: Display): JsonObject => ({ uuid: d.uuid, bounds: d.bounds, scale: d.scale, refresh_hz: d.refresh_hz, next_vsync: d.next_vsync, color_space: d.color_space });

/** The main window's size in points, and the panel slots in it, in window px. A plug-in's panel takes a slot by its ID. */
export const WINDOW: [number, number] = [1200, 700];
export const SLOTS: Rect[] = [[0, 0, 400, 350], [400, 0, 400, 350], [800, 0, 400, 350], [0, 350, 400, 350], [400, 350, 400, 350], [800, 350, 400, 350]];
export const centre = (r: Rect): Point => [r[0] + r[2] / 2, r[1] + r[3] / 2];

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: billing', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

// ---------------------------------------------------------------------------------------------------
// Plug-ins (README: The surface under test)

/** A bound value's fields (Bound value), as an element of a panel's tree binds it. */
export interface Bind { source: string; select?: string; format?: JsonObject; show?: JsonObject; stale_after?: number; missing?: string }
export type Element =
  | { id: string; component: 'text'; text?: string; bind?: Bind }
  | { id: string; component: 'sheet'; cells: { id: string; text?: string; bind?: Bind }[] }
  | { id: string; component: 'chart'; label: { bind: Bind } };
export type Op =
  | { op: 'fetch'; url: string }
  | { op: 'run'; argv: string[] }
  | { op: 'focus' }
  | { op: 'pop_out'; display: string }
  | { op: 'clipboard'; text: string }
  | { op: 'toast'; text: string }
  | { op: 'read'; source: string }
  | { op: 'say'; session: string; kinds: ('steer' | 'follow_up' | 'prompt')[]; text: string }
  | { op: 'place'; piece: string; rect: Rect };
export interface Script { timers?: { first: number; every: number; until?: number; do: Op[] }[]; on_read_failed?: Op[] }
export interface PanelDef { tree: Element[]; script?: Script; raw_input?: boolean }
export interface Source { fresh_for: number; replay: JsonObject[]; then?: JsonObject }
export interface Binding { chord: string; context: string; command: JsonObject }
export interface Manifest { panels: Record<string, PanelDef>; sources?: Record<string, Source>; actions?: Record<string, { kind: 'change' | 'send' | 'spend' }>; keymap?: Binding[] }

/** A panel's tree with one plain text, for panels whose tree isn't read. */
export const plainTree = (title: string): Element[] => [{ id: 'title', component: 'text', text: title }];

export type Planted =
  | 'panel_policy_open' | 'toasts_ignore_card' | 'script_ops_need_no_serial' | 'placement_moves_yours' | 'refresh_restamps_cached'
  | 'sends_without_serial' | 'serial_carries_many_sends' | 'bound_value_a_frame_late' | 'keymap_unchecked' | 'conflicts_unreported'
  | 'focused_panel_takes_escape' | 'accepts_any_ring_serial';

export interface World {
  evidence: string;
  /** Installed in this order, at flicks 1, 2, 3 …, before every other call; each must install. */
  plugins: Record<string, Manifest>;
  /** Panel ID → slot: every panel the plug-ins name, in the main window. */
  panels: Record<string, Rect>;
  card?: JsonObject;
  planted?: Planted;
}

/** A scenario: #400's displays, clock and window, the panels' slots, the installs, then the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const installs = Object.entries(w.plugins).map(([plugin, manifest], i) => installCall(1 + i, plugin, manifest));
  const sorted = [...installs, ...calls].map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    displays: [A, B].map(displayJson), window: WINDOW,
    panels: Object.fromEntries(Object.entries(w.panels).map(([id, r]) => [id, { rect: r }])),
    ...(w.card ? { card: w.card } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls: sorted,
  };
}

const SURFACE = 'its `install` call (plug-in manifests: panels with element trees and scripts, sources, actions, keymaps) and the `attempts`, `focus`, `clipboard`, `toasts`, `place`, `pieces`, `drawn`, `reading`, `type`, `box`, `turns` and `keymap` calls, README: The surface under test';

/** `deep-show run`: one scenario, answered ok with one reply per call, in call order; every set-up install installed. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [s]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(s['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (isObject(c) && c['call'] === 'install' && num(c['at'], 'at') < 100) {
      expect(replies[i]!['installed'], `${what}: the plug-in ${String(c['plugin'])} installs: ${JSON.stringify(replies[i]).slice(0, 600)}`).toBe(true);
    }
  });
  return replies;
}

/**
 * Drives one world step by step on the virtual clock, as #400's suite does: each step's calls may be made from what
 * the steps before answered (a serial), and the whole scenario is played again from the start with them added; it
 * reads no wall time, so a replay answers the same. Returns each step's replies, in the order its calls were given.
 */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario(this.world, [...this.calls, ...fresh]);
    const replies = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const installCall = (at: number, plugin: string, manifest: Manifest): JsonObject => ({ call: 'install', at, plugin, manifest: manifest as unknown as JsonObject });
export const down = (at: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at, panel, event: { type: 'down', pos } });
export const up = (at: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at, panel, event: { type: 'up', pos } });
/** A click at the centre of a panel's slot: a press and, 60 ms later, its release. The press's reply holds its serial. */
export const click = (at: number, panel: string, slot: Rect): JsonObject[] => [down(at, panel, centre(slot)), up(at + 60 * MS, panel, centre(slot))];
export const key = (at: number, panel: string, k: string, mods: string[] = []): JsonObject => ({ call: 'input', at, panel, event: { type: 'key', key: k, mods } });
export const popOut = (at: number, panel: string, display: string, serial?: number): JsonObject => ({ call: 'pop_out', at, panel, display, ...(serial === undefined ? {} : { serial }) });
export const at = (call: string, t: number, extra: JsonObject = {}): JsonObject => ({ call, at: t, ...extra });

export const serialOf = (reply: JsonObject | undefined, what: string): number => num(obj(reply, what)['serial'], `${what}: serial (the input router's serial for your input)`);

/** A refusal: a `code`, and none of the fields a success carries. */
export function refusedReply(reply: JsonObject | undefined, what: string, not: string[] = ['window']): void {
  const r = obj(reply, what);
  expect(typeof r['code'], `${what} is refused with a code: ${JSON.stringify(r).slice(0, 600)}`).toBe('string');
  for (const k of not) expect(r[k], `${what}: a refusal carries no ${k}`).toBeUndefined();
}

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Attempt { at: number; op: string; outcome: string; serial: number | null }
export function attemptsOf(reply: JsonObject | undefined, what: string): Attempt[] {
  return arr(obj(reply, what)['attempts'], `${what}: attempts`).map((v, i) => {
    const a = obj(v, `${what}: attempts[${i}]`);
    const s = a['serial'];
    return { at: num(a['at'], `${what}: attempts[${i}].at`), op: str(a['op'], `${what}: attempts[${i}].op`), outcome: str(a['outcome'], `${what}: attempts[${i}].outcome`), serial: s === null || s === undefined ? null : num(s, `${what}: attempts[${i}].serial`) };
  });
}

export interface Win { window: string; kind: string; view: string | null; display: string }
export const windowsOf = (reply: JsonObject | undefined, what: string): Win[] => arr(obj(reply, what)['windows'], `${what}: windows`).map((v, i) => {
  const w = obj(v, `${what}: windows[${i}]`);
  return { window: str(w['window'], `${what}: windows[${i}].window`), kind: str(w['kind'], `${what}: windows[${i}].kind`), view: w['view'] === null || w['view'] === undefined ? null : str(w['view'], 'view'), display: str(w['display'], `${what}: windows[${i}].display`) };
});

export interface Drawn { element: string; text: string; stale: boolean; age: number | null; as_of: number | null; source: string }
/** A `drawn` reply: the frame on screen at `at` in the panel, and each bound element as that frame draws it. */
export function drawnOf(reply: JsonObject | undefined, what: string): { vsync: number; bound: Drawn[] } {
  const r = obj(reply, what);
  return {
    vsync: num(r['vsync'], `${what}: vsync`),
    bound: arr(r['bound'], `${what}: bound`).map((v, i) => {
      const b = obj(v, `${what}: bound[${i}]`);
      expect(typeof b['stale'], `${what}: bound[${i}].stale is a boolean`).toBe('boolean');
      return {
        element: str(b['element'], `${what}: bound[${i}].element`), text: str(b['text'], `${what}: bound[${i}].text`), stale: b['stale'] === true,
        age: b['age'] === null || b['age'] === undefined ? null : num(b['age'], `${what}: bound[${i}].age`),
        as_of: b['as_of'] === null || b['as_of'] === undefined ? null : num(b['as_of'], `${what}: bound[${i}].as_of`),
        source: str(b['source'], `${what}: bound[${i}].source`),
      };
    }),
  };
}

export interface Turn { at: number; kind: string; text: string; plugin: string | null; panel: string | null }
export function turnsOf(reply: JsonObject | undefined, what: string): Turn[] {
  return arr(obj(reply, what)['turns'], `${what}: turns`).map((v, i) => {
    const t = obj(v, `${what}: turns[${i}]`);
    const by = t['by'];
    const from = isObject(by) ? by : null;
    return {
      at: num(t['at'], `${what}: turns[${i}].at`), kind: str(t['kind'], `${what}: turns[${i}].kind`), text: str(t['text'], `${what}: turns[${i}].text`),
      plugin: from && typeof from['plugin'] === 'string' ? from['plugin'] : null, panel: from && typeof from['panel'] === 'string' ? from['panel'] : null,
    };
  });
}

export interface Draft { text: string; plugin: string; panel: string }
export function boxOf(reply: JsonObject | undefined, what: string): { typed: string; drafts: Draft[] } {
  const b = obj(obj(reply, what)['box'], `${what}: box`);
  return {
    typed: str(b['typed'], `${what}: box.typed`),
    drafts: arr(b['drafts'], `${what}: box.drafts`).map((v, i) => {
      const d = obj(v, `${what}: box.drafts[${i}]`);
      return { text: str(d['text'], `${what}: drafts[${i}].text`), plugin: str(d['plugin'], `${what}: drafts[${i}].plugin`), panel: str(d['panel'], `${what}: drafts[${i}].panel`) };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Geometry

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
