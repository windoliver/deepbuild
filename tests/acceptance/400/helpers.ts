// Test-side tools for the #400 acceptance tests: `deep-show` built once per file and driven by one JSON scenario
// on stdin (`deep-show run`, #393's convention), on the hub's virtual display clock with two displays; the two
// displays, the main window and its panels; the documents the tests show; parsers for the replies this suite's
// calls get (windows, the layout, the question card, presented frames). Nothing here stands in for
// window placement, the frame clock, the latch or the card.

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
/** The checkout root (tests/acceptance/400 is three levels down). */
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
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #383's suite
// does; a test that uses a build that failed fails, naming it.

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
    dir = mkdtempSync(join(tmpdir(), 'deep-400-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh evidence folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-400-')); });
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
// The clock and the two displays (README: The surface under test)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const LEAD = 2 * MS; // each display's latch, 2 ms before its vsync
export const CHECK = MS / 2; // 0.5 ms of the checker per patch
/** With `displays` the clock carries no refresh: each display has its own. */
export const CLOCK: JsonObject = { lead: LEAD, check: CHECK };

export interface Display { uuid: string; bounds: Rect; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
export const periodOf = (d: Display): number => FLICKS / d.refresh_hz;
/** The built-in display: 120 Hz, at 2×, the main display (listed first, so the main window opens on it). */
export const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
/** A second display to its right: 60 Hz, at 1×, its vsyncs 3 ms out of phase with A's. */
export const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
export const PERIOD_A = periodOf(A); // 5,880,000 flicks
export const PERIOD_B = periodOf(B); // 11,760,000 flicks
export const displayJson = (d: Display): JsonObject => ({ uuid: d.uuid, bounds: d.bounds, scale: d.scale, refresh_hz: d.refresh_hz, next_vsync: d.next_vsync, color_space: d.color_space });
/** Whether a flick is one of this display's vsyncs: next_vsync + k × period, k ≥ 0. */
export const onGrid = (d: Display, t: number): boolean => t >= d.next_vsync && (t - d.next_vsync) % periodOf(d) === 0;

/** The main window's size in points, and its three panels in window px. */
export const WINDOW: [number, number] = [1200, 700];
export const PANELS: Record<string, Rect> = { x: [0, 0, 600, 350], y: [600, 0, 600, 350], z: [0, 350, 600, 350] };

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1_000 } };
export const BRAVO = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: labels', process: { pid: 5200, start: 2_000 } };
const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 5200, ppid: 3001, start: 2_000 }];
/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { x: ulid('01JB400D', 1), y: ulid('01JB400D', 2), z: ulid('01JB400D', 3) } as const;

/** A view an agent shows on a panel: one rect in the top-left corner of a 600 × 350 page. */
export function view(title: string): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `A view to pop out onto another display: ${title}.`, size: [600, 350],
    items: { mark: { id: 'mark', kind: 'rect@1', name: 'Mark', order: 'a0', params: { box: [0, 0, 80, 40], paint: { fill: { role: 'muted' } } }, at: { pos: [20, 20, 0] } } },
  };
}
/** A board two agents share (#96's form, revision 0): a layer each for alpha and bravo, one box each. */
export function sharedBoard(title: string): JsonObject {
  const box = (id: string, layer: string, x: number): JsonObject => ({
    id, kind: 'rect@1', layer, name: `Box ${id}`, order: 'a0', params: { box: [0, 0, 60, 40], paint: { fill: { role: 'muted' } } }, at: { pos: [x, 280, 0] },
  });
  return {
    format: 1, profile: 'board', title, description: 'A board two agents write at once, to read which revision each window presents at its latch.', size: [600, 350],
    layers: {
      'alpha-main': { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' },
      'bravo-main': { writer: `agent:${BRAVO.thread}`, title: BRAVO.name, order: 'a1' },
    },
    items: { 'alpha.box': box('alpha.box', 'alpha-main', 40), 'bravo.box': box('bravo.box', 'bravo-main', 200) },
  };
}

export type Planted = 'restores_to_main' | 'card_on_main_display' | 'one_clock_for_all' | 'arms_under_own_window';
export interface ShownDoc { doc: string; panel: string; document: JsonObject; seed?: boolean }
export interface World { evidence: string; displays: Display[]; docs: ShownDoc[]; calls: JsonObject[]; layout?: JsonValue; card?: JsonObject; planted?: Planted }

/**
 * A scenario (README): the displays, the main window and its panels, the documents (an agent's are presented by
 * alpha at flicks 1, 2, 3; a seed is revision 0), the saved layout to restore, the ask whose card the shell
 * presents, and the calls in `at` order.
 */
export function scenario(w: World): JsonObject {
  const present = w.docs.filter((d) => !d.seed).map((d, i) => ({ call: 'deep_show', session: ALPHA.id, doc: d.doc, document: d.document, include: ['issues'], at: 1 + i }));
  const calls = [...present, ...w.calls].map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    displays: w.displays.map(displayJson), window: WINDOW,
    panels: Object.fromEntries(w.docs.map((d) => [d.panel, { rect: PANELS[d.panel]! }])),
    docs: Object.fromEntries(w.docs.map((d) => [d.doc, d.seed ? { panel: d.panel, document: d.document } : { panel: d.panel }])),
    ...(w.layout !== undefined ? { layout: w.layout } : {}),
    ...(w.card ? { card: w.card } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls,
  };
}

/** `deep-show run`: one scenario, answered ok with one reply per call, in call order; each presenting call presented. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [s]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (its \`displays\`, \`layout\` and \`card\` fields, and the \`pop_out\`, \`move_window\`, \`windows\`, \`layout\` and \`card\` calls, README: The surface under test${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(s['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (isObject(c) && c['call'] === 'deep_show' && isObject(c['document'])) expect(replies[i]!['outcome'], `${what}: the document ${String(c['doc'])} is presented: ${JSON.stringify(replies[i]).slice(0, 600)}`).toBe('presented');
  });
  return replies;
}

/**
 * Drives one world step by step on the virtual clock, as #383's suite does: each step's calls are made from what
 * the steps before answered (a serial, a window's rect, the card's rect), and the whole scenario is played again
 * from the start with them added; it reads no wall time, so a replay answers the same. Returns each step's replies,
 * in the order its calls were given.
 */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: Omit<World, 'calls'>) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario({ ...this.world, calls: [...this.calls, ...fresh] });
    const replies = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const down = (at: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at, panel, event: { type: 'down', pos } });
export const up = (at: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at, panel, event: { type: 'up', pos } });
export const popOut = (at: number, panel: string, display: string, serial?: number, extra: JsonObject = {}): JsonObject =>
  ({ call: 'pop_out', at, panel, display, ...(serial === undefined ? {} : { serial }), ...extra });
export const moveWindow = (at: number, window: string, r: Rect, extra: JsonObject = {}): JsonObject => ({ call: 'move_window', at, window, rect: r, ...extra });
export const windowsCall = (at: number): JsonObject => ({ call: 'windows', at });
export const layoutCall = (at: number): JsonObject => ({ call: 'layout', at });
export const cardCall = (at: number): JsonObject => ({ call: 'card', at });
export const scopeCall = (at: number, panel: string): JsonObject => ({ call: 'scope', at, panel });
export const presentedCall = (at: number, panel: string): JsonObject => ({ call: 'presented', at, panel });
/** The ask whose card the shell presents (the scenario's `card`), created at `at`. */
export const ask = (at: number): JsonObject => ({
  ask: 'ask:01JB400A0000000000000001', question: 'Apply the migration to the staging database?',
  options: [{ id: 'yes', label: 'Apply' }, { id: 'no', label: 'Not now' }], size: [420, 220], at,
});

/** A click: a press and, 60 ms later, its release. */
export const click = (at: number, panel: string, pos: Point): JsonObject[] => [down(at, panel, pos), up(at + 60 * MS, panel, pos)];

/** Clicks a clear point of a panel's canvas at `at` and returns the press's serial (two steps: scope, then the click). */
export function clickPanel(d: Driver, at: number, panel: string, what: string): number {
  const p = clearPoint(d.one(scopeCall(at, panel), `${what}: the scope of ${panel}`), `${what}: the scope of ${panel}`);
  const [press] = d.step(click(at + 5 * MS, panel, p), `${what}: a click on ${panel}`);
  return serialOf(press, `${what}: the press on ${panel}`);
}

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Win { window: string; kind: string; view: string | null; display: string; rect: Rect; opened_by: string | null }
export function winOf(value: JsonValue | undefined, what: string): Win {
  const w = obj(value, what);
  const v = w['view'];
  const by = w['opened_by'];
  return {
    window: str(w['window'], `${what}.window`), kind: str(w['kind'], `${what}.kind`), view: v === null || v === undefined ? null : str(v, `${what}.view`),
    display: str(w['display'], `${what}.display`), rect: rect(w['rect'], `${what}.rect`), opened_by: by === null || by === undefined ? null : str(by, `${what}.opened_by`),
  };
}
export const windowsOf = (reply: JsonObject | undefined, what: string): Win[] => arr(obj(reply, what)['windows'], `${what}: windows`).map((w, i) => winOf(w, `${what}: windows[${i}]`));
/** The window a pop-out opened, from its reply. */
export function opened(reply: JsonObject | undefined, what: string): Win {
  const r = obj(reply, what);
  expect(r['code'], `${what} is answered with the window it opened, not refused: ${JSON.stringify(r).slice(0, 600)}`).toBeUndefined();
  return winOf(r['window'], `${what}: window`);
}
/** A refusal: a `code`, and no window. */
export function refusedReply(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  expect(typeof r['code'], `${what} is refused with a code: ${JSON.stringify(r).slice(0, 600)}`).toBe('string');
  expect(r['window'], `${what} opens no window`).toBeUndefined();
}

export interface CardState { state: string; at: number }
export interface Card { ask: string; display: string; window: string; rect: Rect; state: string; states: CardState[] }
export function cardOf(reply: JsonObject | undefined, what: string): Card {
  const c = obj(obj(reply, what)['card'], `${what}: card`);
  return {
    ask: str(c['ask'], `${what}: card.ask`), display: str(c['display'], `${what}: card.display`), window: str(c['window'], `${what}: card.window`),
    rect: rect(c['rect'], `${what}: card.rect`), state: str(c['state'], `${what}: card.state`),
    states: arr(c['states'], `${what}: card.states`).map((s, i) => {
      const o = obj(s, `${what}: card.states[${i}]`);
      return { state: str(o['state'], `${what}: card.states[${i}].state`), at: num(o['at'], `${what}: card.states[${i}].at`) };
    }),
  };
}

export interface Frame { vsync: number; rev: number; window: string; display: string; frame_seq: number }
export function framesOf(reply: JsonObject | undefined, what: string): Frame[] {
  return arr(obj(reply, what)['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    return { vsync: num(f['vsync'], `${at}.vsync`), rev: num(f['rev'], `${at}.rev`), window: str(f['window'], `${at}.window`), display: str(f['display'], `${at}.display`), frame_seq: num(f['frame_seq'], `${at}.frame_seq`) };
  });
}
export const serialOf = (reply: JsonObject | undefined, what: string): number => num(obj(reply, what)['serial'], `${what}: serial (the input router's serial for your input)`);

// ---------------------------------------------------------------------------------------------------
// Geometry (global points; windows and displays share the main display's origin, y down)

export const inside = (outer: Rect, inner: Rect): boolean =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
/** The area two rects share (0 when they only touch). */
export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
export const within = (r: Rect, p: Point): boolean => p[0] >= r[0] && p[1] >= r[1] && p[0] <= r[0] + r[2] && p[1] <= r[1] + r[3];

/** A point in a panel's canvas (window px, from its `scope` reply) clear of the controls it draws over itself. */
export function clearPoint(scopeReply: JsonObject | undefined, what: string): Point {
  const s = obj(obj(scopeReply, what)['state'], `${what}: state`);
  const r = rect(s['rect'], `${what}: state.rect`);
  const buttons = arr(s['buttons'] ?? [], `${what}: state.buttons`).map((b, i) => rect(obj(b, `${what}: buttons[${i}]`)['rect'], `${what}: buttons[${i}].rect`));
  const candidates: Point[] = [[0.5, 0.5], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25]].map(([u, v]) => [r[0] + u! * r[2], r[1] + v! * r[3]]);
  const p = candidates.find((c) => !buttons.some((b) => within(b, c)));
  expect(p, `${what}: a point of the canvas clear of its buttons`).toBeDefined();
  return p!;
}
