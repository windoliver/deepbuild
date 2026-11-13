// Test-side tools for the #507 acceptance tests: `deep-show` built once per file (`--no-default-features --features
// full`) and driven by #393's `deep-show run` scenarios, on #400's two virtual displays and virtual clock where a test
// presents; a Driver that replays one present-mode session from its start with each step's calls added (as #1163's
// suite does), since a pop-out carries the serial of a click the run before handed out; the documents the criteria
// describe, written here so every file judges the same pieces; the readers of what the binary answers; a K-weighted
// short-term loudness meter and a single-bin tone detector for the sound; and the PDF reader apart from the writer
// (poppler's pdfinfo, pdfimages and pdftotext, found on PATH or in /opt/homebrew/bin, else BLOCKED).
//
// Nothing here stands in for present mode, a marker, the film audit's hold rule, the mixer, the card, the presenter
// view, the keymap check or the pdf writer: every value a test compares comes from `deep-show` or from the PDF reader,
// and every expected value from the issue's text and the design (README: The surface under test). The PNG reader, the
// evidence store, the WAV reader and writer and the tone are #501's helpers; the float WAV writer is #1819's; the
// words record's analyzer is #502's.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, getEvidence, putEvidence, readWav, tone, wav16, type Image } from '../501/helpers.ts';
import { pcmBytes, wavF32 } from '../1819/fixtures/synth.ts';
import { ALIGNER } from '../502/helpers.ts';

export { getEvidence, readWav };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/507 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Light builds (no incremental cache, no debug info) unless the caller set them, with the pinned toolchain first. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  PATH: `/opt/homebrew/opt/rustup/bin:${process.env['PATH'] ?? ''}`,
};
/** Every `it` passes this: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and the failure rules

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(v), `${what} is an integer, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
/** Whether a value's JSON text holds `needle`. */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): integers, 705,600,000 flicks a second

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
/** Decimal seconds to whole flicks (exact for the tenths and hundredths the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** Flicks as seconds, for messages. */
export const secs = (f: number): string => `${(f / FLICKS).toFixed(4)} s`;
/** A time field in the time grammar. */
const at = (s: number): string => `${s}s`;

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with the shipped full set, once per file, copied out of target/

export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-507-bin-'));
    const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { built = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l));
      built = { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const bin = join(dir, 'deep-show');
    copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
    built = { bin, error: '' };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(built.error, 'deep-show builds: cargo build --locked --bin deep-show --no-default-features --features full').toBe('');
    return built.bin;
  };
}

/** Fresh folders for a test (evidence stores, export outputs), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-507-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393)

/** One `deep-show run`: the scenario taken (`ok: true`), one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${what}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell: it acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, k: number): string => `${prefix}${String(k).padStart(26 - prefix.length, '0')}`;
/** The documents' IDs. */
export const DOC = {
  quiz: ulid('01JB507D', 1), plain: ulid('01JB507D', 2), loop: ulid('01JB507D', 3), nine: ulid('01JB507D', 4),
  held: ulid('01JB507D', 5), narrated: ulid('01JB507D', 6), refused: ulid('01JB507D', 7),
} as const;
/** The ask a scenario's card carries (#400's `card`). */
export const ASK = `ask:${ulid('01JB507A', 1)}`;

/** `deep show` of a whole document from your shell (the hub stamps the writer layer). */
export function present(doc: string, document: JsonObject, when?: number): JsonObject {
  return { call: 'deep show', peer: YOU_PEER, doc, document: clone(document), include: ['issues'], ...(when === undefined ? {} : { at: when }) };
}
/** The document was presented: shown, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}

/** A scenario with no clock and no displays (#501's shape): each document in its own panel. */
export function plainScenario(evidence: string, docs: string[], calls: JsonObject[], planted?: string): JsonObject {
  const panels: JsonObject = {};
  const owned: JsonObject = {};
  docs.forEach((d, k) => { panels[`p${k}`] = { rect: [0, 0, 1280, 720] }; owned[d] = { panel: `p${k}` }; });
  return { evidence, sessions: {}, processes: PROCESSES, panels, docs: owned, ...(planted ? { planted } : {}), calls };
}

// ---------------------------------------------------------------------------------------------------
// The room: #400's displays and virtual clock, the main window with the piece's panel (and a plug-in's), and a Driver
// that replays the session from its start with each step's calls added.

/** Display A, the main one (120 Hz), and display B (60 Hz, to A's right), as #400's and #1163's suites have them. */
export const DISPLAY_A: JsonObject = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
export const DISPLAY_B: JsonObject = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
export const A = String(DISPLAY_A['uuid']);
export const B = String(DISPLAY_B['uuid']);
/** The piece's panel, in the main window's px. */
export const FILM_PANEL = 'film';
const FILM_RECT = [0, 0, 960, 540];
/** A plug-in's panel beside it (criterion 4's toast). */
export const TOOL_PANEL = 'tool';
const TOOL_RECT = [960, 0, 240, 200];

interface Room {
  evidence: string;
  displays: JsonObject[];
  /** The document the piece's panel shows. */
  doc: string;
  /** With the plug-in's panel beside the piece's. */
  tool?: boolean;
  /** #400's card, with `deadline` (README: The surface under test). */
  card?: JsonObject;
  planted?: string;
}
function roomScenario(r: Room, calls: JsonObject[]): JsonObject {
  const when = (c: JsonObject): number => int(c['at'], `a call's at: ${show(c, 200)}`);
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => when(p.c) - when(q.c) || p.i - q.i).map((p) => p.c);
  const panels: JsonObject = { [FILM_PANEL]: { rect: FILM_RECT } };
  if (r.tool) panels[TOOL_PANEL] = { rect: TOOL_RECT };
  return {
    evidence: r.evidence, sessions: {}, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 }, displays: r.displays, window: [1200, 700],
    panels, docs: { [r.doc]: { panel: FILM_PANEL } }, ...(r.card ? { card: r.card } : {}), ...(r.planted ? { planted: r.planted } : {}), calls: sorted,
  };
}
/** One session, replayed from its start each step with the step's calls added; a step's replies are its own calls'. */
export class Driver {
  private calls: JsonObject[] = [];
  private readonly bin: string;
  private readonly room: Room;
  constructor(bin: string, room: Room) { this.bin = bin; this.room = room; }
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const all = [...this.calls, ...fresh];
    const sc = roomScenario(this.room, all);
    const replies = runShow(this.bin, sc, what);
    const sorted = arr(sc['calls'], 'calls');
    this.calls = all;
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}

// Calls (README: The surface under test). Every call in a room carries `at` (flicks).

/** Your click at `pos` (the panel's own window px): a press and its release 60 ms later; the press's reply holds its serial. */
export const click = (when: number, panel: string, pos: [number, number] = [480, 270]): JsonObject[] => [
  { call: 'input', at: when, panel, event: { type: 'down', pos } },
  { call: 'input', at: when + 60 * MS, panel, event: { type: 'up', pos } },
];
export const key = (when: number, k: string, mods: string[] = [], panel = FILM_PANEL): JsonObject =>
  ({ call: 'input', at: when, panel, event: { type: 'key', key: k, mods } });
/** A value for one of the document's own controls (#504's `control` event): one entry on its input track. */
export const pick = (when: number, control: string, value: JsonValue, panel = FILM_PANEL): JsonObject =>
  ({ call: 'input', at: when, panel, event: { type: 'control', control, value } });
/** `eval` of the document at clock time `when` (the session's own track and present mode), with its new `position`. */
export const evalAt = (when: number, doc: string, extra: JsonObject = {}): JsonObject => ({ call: 'eval', at: when, doc, t: when, ...extra });
export const presentState = (when: number, panel = FILM_PANEL): JsonObject => ({ call: 'present', at: when, panel });
export const presenterState = (when: number): JsonObject => ({ call: 'presenter', at: when });
export const cardState = (when: number): JsonObject => ({ call: 'card', at: when });
export const menuBar = (when: number): JsonObject => ({ call: 'menu_bar', at: when });
export const keymap = (when: number): JsonObject => ({ call: 'keymap', at: when });
export const framesOf = (when: number, panel = FILM_PANEL): JsonObject => ({ call: 'presented', at: when, panel });

/** An input reply's serial (#383). */
const serialOf = (reply: JsonObject | undefined, what: string): number => int(obj(reply, what)['serial'], `${what}: serial`);

/**
 * The piece shown in its panel, your click there, and its pop-out full screen onto `display` with that click's serial,
 * which puts it in present mode (Marker: present mode: "a piece with stage markers … enters it when it goes full
 * screen"). Present mode starts at `ENTER`.
 */
export const ENTER = 200 * MS;
export function enterPresent(d: Driver, doc: string, document: JsonObject, display: string, what: string): void {
  const r1 = d.step([present(doc, document, 2 * MS), ...click(100 * MS, FILM_PANEL)], `${what}: the piece shown and your click`);
  presented(r1[0], `${what}: the piece`);
  const serial = serialOf(r1[1], `${what}: your click in the piece's panel`);
  const [popped] = d.step([{ call: 'pop_out', at: ENTER, panel: FILM_PANEL, display, serial, full_screen: true }], `${what}: the pop-out`);
  const w = obj(obj(popped, `${what}: the pop-out's reply`)['window'], `${what}: the pop-out opens a window`);
  expect([w['kind'], w['display']], `${what}: the piece is full screen on the display asked: ${show(w)}`).toEqual(['full_screen', display]);
}

/** A `present` entry an input appended (Input track: `{t, seq, present, writer}`). */
interface PresentEntry { t: number; present: JsonValue; raw: JsonObject }
/** The entries an input appended to the document's input track (#504's `appended`). */
export function appendedOf(reply: JsonObject | undefined, what: string): JsonObject[] {
  return arr(obj(reply, what)['appended'], `${what}: appended`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** The one `present` entry an input appended, of the kind expected. */
export function presentEntry(reply: JsonObject | undefined, kind: JsonValue, what: string): PresentEntry {
  const list = appendedOf(reply, what);
  expect(list.length, `${what} appends exactly one entry: ${show(list)}`).toBe(1);
  const e = list[0]!;
  expect(e['present'], `${what} appends a present entry ${show(kind)}: ${show(e)}`).toEqual(kind);
  return { t: int(e['t'], `${what}: the entry's t`), present: e['present']!, raw: e };
}
/** An `eval` reply's timeline position (new): the position the frame at that clock time shows, in flicks. */
export function positionOf(reply: JsonObject | undefined, what: string): number {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is evaluated: ${show(r)}`).toBe('evaluated');
  return int(r['position'], `${what}: position`);
}
/** An `eval` reply's `texts` (new, with `texts: true`): each text item's string as the frame draws it. */
export function textsOf(reply: JsonObject | undefined, what: string): JsonObject {
  return obj(obj(reply, what)['texts'], `${what}: texts`);
}
/** The numbers a drawn string shows. */
export const numbersIn = (text: string): number[] => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
/** `present` (new): what present mode shows on the panel's display. */
export interface Present { on: boolean; display: string | null; stage: string | null; number: number | null; blank: boolean; notice: string | null; raw: JsonObject }
export function presentOf(reply: JsonObject | undefined, what: string): Present {
  const p = obj(obj(reply, what)['present'], `${what}: present`);
  expect(typeof p['on'], `${what}: present.on is a boolean: ${show(p)}`).toBe('boolean');
  return {
    on: p['on'] === true, display: typeof p['display'] === 'string' ? p['display'] : null, stage: typeof p['stage'] === 'string' ? p['stage'] : null,
    number: typeof p['number'] === 'number' ? p['number'] : null, blank: p['blank'] === true, notice: typeof p['notice'] === 'string' ? p['notice'] : null, raw: p,
  };
}
/** #400's `presented` frames, each with the new `over`: what the shell drew over the piece in that frame on its display. */
export interface Shown { vsync: number; display: string; over: string[] }
export function shownFrames(reply: JsonObject | undefined, what: string): Shown[] {
  return arr(obj(reply, what)['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return {
      vsync: int(f['vsync'], `${what}: frames[${i}].vsync`), display: str(f['display'], `${what}: frames[${i}].display`),
      over: arr(f['over'], `${what}: frames[${i}].over`).map((o, k) => str(o, `${what}: frames[${i}].over[${k}]`)),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope, written as you send it: no layers, no item layer). 2D, u = px, y down.

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #507 acceptance tests at test time.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
const SIZE: [number, number] = [640, 360];
const camera2d = (): JsonObject => ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a000cam', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } });
const rect = (id: string, box: [number, number, number, number], role: string, k: number): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role } } } });
const text = (id: string, words: string, k: number, pos: [number, number]): JsonObject =>
  ({ id, kind: 'text@1', name: `Text ${id}`, order: order(k), params: { text: words, font: 'body', size: 20, box: { w: 576, h: 80 }, align: 'start' }, at: { pos: [pos[0], pos[1], 0] } });
const linear = (target: string, a: number, b: number, to: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: at(to), value: b, interp: 'linear' } } });
/** Shown only over [from, to): its opacity held at 0, then 1 from `from`, then 0 from `to` (to null: to the end). */
const shownOver = (id: string, from: number, to: number | null): JsonObject => ({
  target: `items/${id}/adjust/opacity`, type: 'f32',
  keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: at(from), value: 1, interp: 'hold' }, ...(to === null ? {} : { k2: { t: at(to), value: 0, interp: 'hold' } }) },
});
function film(id: string, title: string, items: JsonObject[], extra: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'film', title, description: `${title}: a piece the #507 acceptance tests present.`, size: SIZE, safe: 24, camera: 'cam',
    items: Object.fromEntries([camera2d(), rect('back', [0, 0, SIZE[0], SIZE[1]], 'ground', 1), ...items].map((i) => [String(i['id']), i])),
    ...extra,
  };
}
const choice = (label: string, options: string[], def?: string): JsonObject =>
  ({ kind: 'choice', class: 'document', label, role: 'radiogroup', options, ...(def === undefined ? {} : { default: def }) });

// The quiz film (criteria 1 and 2): 50 s at 10 fps; a stage marker at 8 s waiting for a two-option choice (A plays on, B
// goes on at the marker at 21 s), a goto at 20 s to 30 s, three questions waiting at 33, 37 and 41 s, and a counter of
// right answers from 45 s. Each waiting marker's text shows only from its marker for 0.1 s of the timeline, so it is the
// one text that frame shows; a block slides 12 u a second, so every timeline frame differs.

/**
 * The texts and their counts of graphemes the hold rule reads (whitespace never counts): 45, 60, 51 and 39. None shows a
 * number (no digit and no number word), since a text@1 that shows one with no source is refused at check
 * (`number_unsourced`, Honest numbers).
 */
export const QUIZ_TEXT = {
  prompt: 'Pick A to watch the opening part, or B to skip to the quiz',
  q1: 'First question: Which of the planets is the largest in our solar system?',
  q2: 'Second question: Is a prime number divisible only by itself?',
  q3: 'Last question: Is the Moon closer than the Sun?',
} as const;
/** The waiting markers, their texts and their controls. */
export const WAITS = [
  { marker: 'fork', t: 8, text: 'prompt', control: 'path' },
  { marker: 'ask1', t: 33, text: 'q1', control: 'q1' },
  { marker: 'ask2', t: 37, text: 'q2', control: 'q2' },
  { marker: 'ask3', t: 41, text: 'q3', control: 'q3' },
] as const;
export const QUIZ_FPS = 10;
interface QuizOptions {
  /** The reference film: no markers, each question's default the given option, so it plays straight. */
  plain?: Record<string, string>;
  /** The fork's `then` for B names this marker, added as a cue at 5 s (the refused `then`). */
  earlyThen?: boolean;
  /** The fork waits for a choice of class view (the refused waiting control). */
  viewWait?: boolean;
}
export function quizFilm(o: QuizOptions = {}): JsonObject {
  const at2 = [32, 32] as [number, number];
  const items = [
    rect('mover', [0, 300, 40, 40], 'accent', 2),
    text('prompt', QUIZ_TEXT.prompt, 3, at2), text('q1', QUIZ_TEXT.q1, 4, at2), text('q2', QUIZ_TEXT.q2, 5, at2), text('q3', QUIZ_TEXT.q3, 6, at2),
    { id: 'score', kind: 'text@1', name: 'Score', order: order(7), params: { text: { counter: { source: 'right', tabular: true, format: { group: 'none' } } }, font: 'body', size: 48, box: { w: 200, h: 64 }, widest: '8' }, at: { pos: [32, 160, 0] } },
  ];
  const controls: JsonObject = {
    path: choice('Path', ['A', 'B'], o.plain ? 'B' : 'A'),
    q1: choice('Question 1', ['a', 'b'], o.plain?.['q1']), q2: choice('Question 2', ['a', 'b'], o.plain?.['q2']), q3: choice('Question 3', ['a', 'b'], o.plain?.['q3']),
  };
  const fork: JsonObject = { kind: 'stage', name: 'Fork', t: '8s', waits_for: 'path', then: { B: 'part2' } };
  const markers: JsonObject = {
    intro: { kind: 'stage', name: 'Intro', t: '0s' },
    fork,
    jump: { kind: 'cue', name: 'Jump', t: '20s', goto: 'resume' },
    part2: { kind: 'cue', name: 'Part two', t: '21s' },
    resume: { kind: 'cue', name: 'Resume', t: '30s' },
    ask1: { kind: 'stage', name: 'Question 1', t: '33s', waits_for: 'q1' },
    ask2: { kind: 'stage', name: 'Question 2', t: '37s', waits_for: 'q2' },
    ask3: { kind: 'stage', name: 'Question 3', t: '41s', waits_for: 'q3' },
  };
  if (o.earlyThen) { markers['early'] = { kind: 'cue', name: 'Early', t: '5s' }; fork['then'] = { B: 'early' }; }
  if (o.viewWait) { controls['viewer_pick'] = { kind: 'choice', class: 'view', label: 'Viewer pick', role: 'radiogroup', options: ['x', 'y'] }; fork['waits_for'] = 'viewer_pick'; fork['then'] = { y: 'part2' }; }
  return film(o.plain ? DOC.plain : DOC.quiz, o.plain ? 'The quiz film, played straight' : 'The quiz film', items, {
    transport: { span: '50s', frame_rate: [QUIZ_FPS, 1], sample_rate: 48_000 },
    controls,
    data: { right: { value: 0, source: 'quiz' } },
    drivers: { right: { target: 'data/right', expr: '(q1 == 0 ? 1 : 0) + (q2 == 1 ? 1 : 0) + (q3 == 0 ? 1 : 0)', vars: { q1: 'controls/q1/value', q2: 'controls/q2/value', q3: 'controls/q3/value' } } },
    ...(o.plain ? {} : { markers }),
    channels: {
      slide: linear('items/mover/params/box/0', 0, 600, 50),
      show_prompt: shownOver('prompt', 8, 8.1), show_q1: shownOver('q1', 33, 33.1), show_q2: shownOver('q2', 37, 37.1), show_q3: shownOver('q3', 41, 41.1),
      show_score: shownOver('score', 45, null),
    },
  });
}
/** An input track entry (Input track; #504's form). */
export const entry = (t: number, control: string, value: JsonValue): JsonObject => ({ t, seq: 0, control, value, writer: 'you', player: 1 });

// The loop film (criterion 5 and the Oracle lane): 20 s at 30 fps; stage s1 at 0 s, the cue `span_start` at 4 s and
// stage s2 at 6 s holding on a loop from it (the span [4 s, 6 s)), stage s3 at 12 s. A block slides 30 u a second.
export const LOOP = { from: 4, stage: 6, span: 2, fps: 30 } as const;
export function loopFilm(): JsonObject {
  return film(DOC.loop, 'A stage that holds on a loop', [rect('mover', [0, 300, 40, 40], 'accent', 2)], {
    transport: { span: '20s', frame_rate: [LOOP.fps, 1], sample_rate: 48_000 },
    markers: {
      s1: { kind: 'stage', name: 'Start', t: '0s' },
      span_start: { kind: 'cue', name: 'The looped span starts', t: at(LOOP.from) },
      s2: { kind: 'stage', name: 'The loop', t: at(LOOP.stage), hold: { loop: { from: 'span_start' } } },
      s3: { kind: 'stage', name: 'After', t: '12s' },
    },
    channels: { slide: linear('items/mover/params/box/0', 0, 600, 20) },
  });
}

// The nine-stage piece (criteria 4, 5, 6 and 7): 36 s at 30 fps; stage k at 4(k − 1) s with a name and notes; a block
// slides 16 u a second, so each stage's settled still differs.
export const NINE_NAMES = ['Welcome', 'Setup', 'Method', 'Results', 'Detail', 'Compare', 'Summary', 'Questions', 'Close'] as const;
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const;
/** Stage k's notes: words with no ligature pair, so a text layer reads them back as written. */
export const noteOf = (k: number): string => `Point ${k}: talk about part ${WORDS[k - 1]} slowly`;
export const stageAt = (k: number): number => 4 * (k - 1);
export function ninePiece(): JsonObject {
  const markers: JsonObject = {};
  for (let k = 1; k <= 9; k++) markers[`s${k}`] = { kind: 'stage', name: NINE_NAMES[k - 1]!, t: at(stageAt(k)), notes: noteOf(k) };
  return film(DOC.nine, 'Nine stages', [rect('mover', [0, 300, 40, 40], 'accent', 2)], {
    transport: { span: '36s', frame_rate: [30, 1], sample_rate: 48_000 },
    markers,
    channels: { slide: linear('items/mover/params/box/0', 0, 576, 36) },
  });
}

// Sound. The narration line's recording: a 3 s mono tone at 1 kHz, with its words record (the Analysis bake row's shape,
// as #502's suite writes it) placing four words in it; the music: a 2 s stereo 440 Hz tone that loops.
const RATE = 48_000;
export const VOICE_HZ = 1000;
export const MUSIC_HZ = 440;
const LINE_TEXT = 'Now the second part';
/** The words, in seconds of the recording: the line's speech span is [0.2 s, 2.8 s) of it. */
const LINE_WORDS: [string, number, number][] = [['now', 0.2, 0.6], ['the', 0.7, 0.9], ['second', 1.0, 1.8], ['part', 2.0, 2.8]];
/** The recording and its attached words record, put in the evidence store: the asset entry. */
function voiceAsset(evidence: string): JsonObject {
  const x = tone(VOICE_HZ, 3 * RATE, 0.25, RATE);
  const wav = wavF32(x, RATE);
  const record = {
    kind: 'bake.words', analyzer: ALIGNER, weights: [], pcm_sha256: sha256(pcmBytes(x)), frame: FLICKS / 100,
    words: LINE_WORDS.map(([t, a, b]) => ({ text: t, start: fl(a), end: fl(b), phonemes: [] })),
  };
  return { sha256: putEvidence(evidence, wav), license: LICENSE, attached: [putEvidence(evidence, new TextEncoder().encode(JSON.stringify(record)))] };
}
const script = (lineAt: number): JsonObject => ({
  narrator: { name: 'Fixture voice', license: LICENSE, synthetic: false },
  lines: { voice_line: { t: at(lineAt), text: LINE_TEXT, recording: { asset: 'voice' } } },
});

/** The narrated film (criterion 1's refusal): 20 s; the line at 10 s (speech over [10.2 s, 12.8 s)) and a stage at `stage` s. */
export function narratedFilm(evidence: string, stage: number): JsonObject {
  return film(DOC.narrated, 'A stage and a narration line', [rect('mover', [0, 300, 40, 40], 'accent', 2)], {
    transport: { span: '20s', frame_rate: [30, 1], sample_rate: RATE },
    markers: { s1: { kind: 'stage', name: 'Start', t: '0s' }, inside: { kind: 'stage', name: 'Inside', t: at(stage) } },
    assets: { voice: voiceAsset(evidence) },
    script: script(10),
    channels: { slide: linear('items/mover/params/box/0', 0, 600, 20) },
  });
}

// The held film (criterion 3): 40 s at 30 fps on a 120 BPM 4/4 tempo map from 0 s (a bar every 2 s); stage s1 at 0 s,
// stage m1 at 11 s and m2 at 21 s, each 1.0 s past a bar line; the narration line at 11.5 s, after m1; the looping music
// on the bus `music`; a stages control `views` whose stage `side` frames another shot than `front`.
export const HELD = { m1: 11, m2: 21, line: 11.5, fps: 30 } as const;
export const FRONT = { target: [320, 180, 0], view_width: 640 } as const;
export const SIDE = { target: [480, 180, 0], view_width: 320 } as const;
export function heldFilm(evidence: string): JsonObject {
  const music = putEvidence(evidence, wav16([tone(MUSIC_HZ, 2 * RATE, 0.2, RATE), tone(MUSIC_HZ, 2 * RATE, 0.2, RATE)], RATE));
  return film(DOC.held, 'A held stage on the beat', [rect('mover', [0, 300, 40, 40], 'accent', 2)], {
    transport: { span: '40s', frame_rate: [HELD.fps, 1], sample_rate: RATE },
    tempo_map: { segments: [{ at: '0s', bpm: 120, meter: [4, 4], span: 80 }] },
    markers: {
      s1: { kind: 'stage', name: 'Start', t: '0s' },
      m1: { kind: 'stage', name: 'The long hold', t: at(HELD.m1) },
      m2: { kind: 'stage', name: 'The short hold', t: at(HELD.m2) },
    },
    controls: {
      views: { kind: 'stages', class: 'document', label: 'Views', role: 'tablist', default: 'front', stages: { front: { label: 'Front', shot: 'front_shot' }, side: { label: 'Side', shot: 'side_shot' } } },
    },
    shots: {
      front_shot: { camera: 'cam', move: 'hold', target: [...FRONT.target], view_width: FRONT.view_width },
      side_shot: { camera: 'cam', move: 'hold', target: [...SIDE.target], view_width: SIDE.view_width },
    },
    assets: { music: { sha256: music, license: LICENSE }, voice: voiceAsset(evidence) },
    strips: { music: { track: 1, src: music, start: '0s', in: 0, out: fl(2), rate: 1, loop: true, bus: 'music' } },
    buses: { music: {} },
    script: script(HELD.line),
    channels: { slide: linear('items/mover/params/box/0', 0, 600, 40) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Sound readers: ITU-R BS.1770's K-weighting at 48 kHz and its short-term loudness (3 s), and one tone's power.

function biquad(x: Float64Array, b: [number, number, number], a: [number, number]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i]! + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** Each channel K-weighted (the 48 kHz shelf and high-pass of BS.1770), from the signal's start. */
export function kWeighted(channels: Float32Array[]): Float64Array[] {
  return channels.map((c) => biquad(
    biquad(Float64Array.from(c), [1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]),
    [1, -2, 1], [-1.99004745483398, 0.99007225036621]));
}
/** The short-term loudness (LUFS) of the 3 s ending at sample `end`, from K-weighted channels. */
export function shortTerm(k: Float64Array[], end: number): number {
  const n = 3 * RATE;
  let sum = 0;
  for (const c of k) { let s = 0; for (let i = end - n; i < end; i++) s += c[i]! * c[i]!; sum += s / n; }
  return -0.691 + 10 * Math.log10(sum);
}
/** The power (dBFS of a full-scale sine) of `hz` over [from, to) samples of the channels' mean. */
export function tonePower(channels: Float32Array[], hz: number, from: number, to: number): number {
  const w = (2 * Math.PI * hz) / RATE;
  let re = 0; let im = 0;
  for (let i = from; i < to; i++) {
    let v = 0; for (const c of channels) v += c[i]!; v /= channels.length;
    re += v * Math.cos(w * i); im -= v * Math.sin(w * i);
  }
  const amplitude = (2 * Math.hypot(re, im)) / (to - from);
  return 20 * Math.log10(Math.max(amplitude, 1e-12));
}
/** The first sample at or after flick `t` (Time and the flick). */
export const sampleAt = (t: number): number => Math.ceil((t * RATE) / FLICKS - 1e-9);

// ---------------------------------------------------------------------------------------------------
// Export outputs and the PDF reader apart from the writer

/** A still's PNG: `out` itself, or the one PNG in the folder at `out` (README: png_seq files). */
export function stillPng(out: string, what: string): Image {
  expect(existsSync(out), `${what}: the export wrote ${out}`).toBe(true);
  if (!statSync(out).isDirectory()) return decodePng(readFileSync(out));
  const pngs = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  expect(pngs.length, `${what}: one PNG at ${out}`).toBe(1);
  return decodePng(readFileSync(join(out, pngs[0]!)));
}
/** An image's RGB bytes (alpha dropped), for comparing pictures whose alpha a writer may keep apart. */
export function rgbOf(img: Image): Buffer {
  const b = Buffer.alloc(img.width * img.height * 3);
  for (let i = 0, o = 0; i < img.rgba.length; i += 4, o += 3) { b[o] = img.rgba[i]!; b[o + 1] = img.rgba[i + 1]!; b[o + 2] = img.rgba[i + 2]!; }
  return b;
}

function findTool(name: string): string | null {
  for (const dir of [...(process.env['PATH'] ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin']) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}
interface Poppler { pdfinfo: string; pdfimages: string; pdftotext: string; version: string }
let poppler: Poppler | null | undefined;
/** poppler's readers, which no part of DeepBuild calls, or BLOCKED with the one unblock line. */
export function popplerTools(): Poppler {
  if (poppler === undefined) {
    const [pdfinfo, pdfimages, pdftotext] = [findTool('pdfinfo'), findTool('pdfimages'), findTool('pdftotext')];
    if (pdfinfo && pdfimages && pdftotext) {
      const v = spawnSync(pdfinfo, ['-v'], { encoding: 'utf8' });
      poppler = { pdfinfo, pdfimages, pdftotext, version: `${v.stdout ?? ''}${v.stderr ?? ''}`.split('\n')[0]!.trim() };
    } else poppler = null;
  }
  if (!poppler) return expect.fail('BLOCKED: the handout is read back by poppler (pdfinfo, pdfimages, pdftotext), and one of them was not found on PATH, in /opt/homebrew/bin or /usr/local/bin; this is not a pass.\nUnblock: brew install poppler');
  return poppler;
}
function tool(bin: string, args: string[], what: string): string {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  expect(r.status, `${what}: ${bin} ${args.join(' ')} exits 0; ${(r.stderr ?? '').slice(-800)}`).toBe(0);
  return r.stdout ?? '';
}
/** The PDF's page count, by pdfinfo. */
export function pdfPages(path: string, what: string): number {
  const m = /^Pages:\s+(\d+)\s*$/m.exec(tool(popplerTools().pdfinfo, [path], what));
  expect(m, `${what}: pdfinfo reads a page count`).not.toBeNull();
  return Number(m![1]);
}
/** Each page's largest image, decoded (pdfimages writes each image losslessly as a PNG). */
export function pdfPageImages(path: string, dir: string, what: string): Map<number, Image> {
  const { pdfimages } = popplerTools();
  const rows = tool(pdfimages, ['-list', path], what).split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 9);
  tool(pdfimages, ['-png', '-p', path, join(dir, 'img')], what);
  const out = new Map<number, { area: number; img: Image }>();
  for (const r of rows) {
    const [page, n, type, w, h] = [Number(r[0]), Number(r[1]), r[2], Number(r[3]), Number(r[4])];
    if (type !== 'image') continue;
    const file = join(dir, `img-${String(page).padStart(3, '0')}-${String(n).padStart(3, '0')}.png`);
    if (!existsSync(file)) continue;
    const had = out.get(page);
    if (!had || w * h > had.area) out.set(page, { area: w * h, img: decodePng(readFileSync(file)) });
  }
  return new Map([...out].map(([p, v]) => [p, v.img]));
}
/** A page's text layer, by pdftotext, white space collapsed. */
export function pdfPageText(path: string, page: number, what: string): string {
  return tool(popplerTools().pdftotext, ['-f', String(page), '-l', String(page), path, '-'], what).replace(/\s+/g, ' ').trim();
}
