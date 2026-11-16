// Test-side tools for the #903 acceptance tests (README: The surface under test). They build the two binaries the tests
// drive, each once per file: `deep-input` (#308's JSON lines, one session of the input module per line, where the tour
// lives) and `deep-show` (one JSON scenario on stdin for `run` and `screen`, as #501's, #506's, #542's and #1897's suites
// drive them); hold the fixtures (the tour board and the riding card) with the places the issue's numbers put the
// pointer; and read answers, exported PNGs and the app's window. The PNG coding is copied from #467's helpers.
// Nothing here stands in for the tour, its pointer, a control, the export or the renderer: every position, opacity,
// entry, hash and pixel a test compares is the implementation's own, and every expected value comes from the issue and
// the design, worked out here from the fixture's own numbers.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Pt = [number, number];
type V3 = [number, number, number];
export type Rect = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/903 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo, where it is kept off the default PATH. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  NO_COLOR: process.env['NO_COLOR'] ?? '1',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** A first build of deep-show takes many minutes on a loaded machine; each test passes its own timeout. */
const BUILD_TIMEOUT = 3_600_000;
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#903.` and the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #903.dd86ae00',
  2: 'AC2 #903.406ccd5b',
  3: 'AC3 #903.92244161',
  4: 'AC4 #903.da7f464f',
  5: 'AC5 #903.b48e3025',
  6: 'AC6 #903.772321ac',
  7: 'AC7 #903.f0bb108a',
  8: 'AC8 #903.1034b873',
} as const;

/** A host or tool this machine lacks: the test fails with this, never passes (AGENTS.md: invariant 2). */
const blocked = (why: string): never => expect.fail(`BLOCKED: ${why}; this is not a pass`);
/** The criterion stays open here, whatever the reason: never a pass. */
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
/** One canonical text per JSON value (keys sorted at every depth). */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail it, and some failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second.

export const FLICKS = 705_600_000;
/** Seconds as whole flicks (every time the tests write is a whole number of flicks). */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
export const secs = (flicks: number): number => flicks / FLICKS;
/** A seeded generator in [0, 1) (mulberry32), so a failing run replays. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A seeded shuffle of a copy of `xs`. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rand = seeded(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <name>` (the default features, deep-show's full set), once per file, copied out
// of the target folder. No cargo is BLOCKED; a build that fails fails each test that uses it, with cargo's error.

export type Bin = 'deep-input' | 'deep-show';
function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
const built = new Map<Bin, { bin: string; error: string }>();
function build(name: Bin): { bin: string; error: string } {
  const known = built.get(name);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-903-bins-'));
  const bin = join(binsDir, name);
  const error = cargo(['build', '--locked', '--bin', name]);
  if (error === '') copyFileSync(join(TARGET, 'debug', name), bin);
  const out = { bin, error };
  built.set(name, out);
  return out;
}
/** Builds the binaries a file uses before its tests (the slow part), so each test's time is its own. */
export function prebuild(...names: Bin[]): void {
  beforeAll(() => { for (const n of names) build(n); }, BUILD_TIMEOUT);
}
/** A built binary; a test that uses a build that failed fails, naming cargo's error. */
function binOf(name: Bin): string {
  const out = build(name);
  if (/cargo could not run/.test(out.error)) blocked(`${out.error}: this machine lacks the Rust toolchain`);
  expect(out.error, `${name} builds: cargo build --locked --bin ${name}`).toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-903-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The tour board (README: Fixtures): a 1920 × 1080 u figure whose 2D camera is the frame, so in a 1920 × 1080 px view
// and in an export at its own size 1 px is 1 u. Three controls drawn on it, each keyed by the tour.

export const BOARD = {
  size: [1920, 1080] as Pt,
  /** The press control `fire` is hit through its target item `fire-button`; its anchor is that box's centre. */
  fire: { box: [240, 300, 360, 180] as Rect, anchor: [420, 390] as Pt },
  /** The toggle control `lamp` is hit through its target item `lamp-button`. */
  lamp: { box: [1320, 700, 360, 180] as Rect, anchor: [1500, 790] as Pt },
  track: { box: [800, 530, 680, 20] as Rect },
  /** The slider `gain`'s thumb is its handle item `knob`, 60 × 60 u, its centre at (x0, y) at value 0 and `travel` u right at 1. */
  knob: { x0: 800, y: 540, travel: 680, size: 60 },
} as const;
/** The centre of the slider's thumb at value `v`: where `handle: {item: knob, along: x, travel: 680}` and the driver put it. */
export const thumb = (v: number): Pt => [BOARD.knob.x0 + BOARD.knob.travel * v, BOARD.knob.y];
/** The slider's value while the tour's key `[4, 0, linear]` owns its segment to `[6, 1, hold]` (Channel and key: linear). */
export const gainAt = (s: number): number => (s < 4 ? 0.5 : s >= 6 ? 1 : (s - 4) / 2);

/** The issue's tour: a press key at 2 s, a slider key from 0 to 1 over 4 s to 6 s, a toggle key at 8 s. */
const TOUR_KEYS: JsonObject = { fire: [[2, 1, 'hold']], gain: [[4, 0, 'linear'], [6, 1, 'hold']], lamp: [[8, true, 'hold']] };
export interface TourOptions { keys?: JsonObject; pointer?: JsonObject; resume_after?: number }
const rect = (id: string, name: string, order: string, box: Rect, role: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } }, ...extra });
/**
 * The tour board as a writer sends it (no `layers`, no item `layer`). Its tour starts at once (`idle_after: 0`), so the
 * tour's clock is the session's and the document's, and plays once (`loop: false`). With no `pointer`, the pointer has
 * the issue's defaults: shown, `glide` 0.5 s, `ring` 0.3 s. What a key's pointer lands on is drawn in the role `muted`,
 * the track in `accent`, the ground in `ground` (roles of the shipped clean look that the sibling suites' documents
 * already use): a pointer in ink, in the ground's color or in the accent shows on what it lands on.
 */
export function tourBoard(id: string, o: TourOptions = {}): JsonObject {
  const k = BOARD.knob;
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [BOARD.size[0] / 2, BOARD.size[1] / 2, 0], view_width: BOARD.size[0] } },
    rect('ground', 'Ground', 'a1', [0, 0, ...BOARD.size], 'ground'),
    rect('fire-button', 'Fire button', 'a2', BOARD.fire.box, 'muted'),
    rect('lamp-button', 'Lamp button', 'a3', BOARD.lamp.box, 'muted'),
    rect('gain-track', 'Gain track', 'a4', BOARD.track.box, 'accent'),
    rect('knob', 'Gain thumb', 'a5', [-k.size / 2, -k.size / 2, k.size, k.size], 'muted', { at: { pos: [k.x0, k.y, 0] } }),
  ];
  return {
    format: 1, id, profile: 'figure', title: `Tour board ${id}`, description: 'A press, a slider and a toggle that an idle tour keys in turn.',
    size: [...BOARD.size], seed: 903, camera: 'cam', transport: { span: '10s', frame_rate: [12, 1] }, requires: { modules: { input: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    controls: {
      fire: { kind: 'press', class: 'document', label: 'Fire', role: 'button', targets: { fire: 'fire-button' } },
      gain: { kind: 'slider', class: 'document', label: 'Gain', role: 'slider', range: [0, 1], default: 0.5, handle: { item: 'knob', along: 'x', travel: k.travel, drag: 'along' } },
      lamp: { kind: 'toggle', class: 'document', label: 'Lamp', role: 'switch', default: false, targets: { lamp: 'lamp-button' } },
    },
    // The app draws the thumb where the slider's value puts it, as the session's reading of `handle` does.
    drivers: { knob_x: { target: 'items/knob/at/pos/0', expr: `${k.x0} + ${k.travel} * v`, vars: { v: 'controls/gain/value' } } },
    tour: {
      keys: o.keys ?? TOUR_KEYS, idle_after: 0, loop: false,
      ...(o.resume_after !== undefined ? { resume_after: o.resume_after } : {}),
      ...(o.pointer ? { pointer: o.pointer } : {}),
    },
  };
}
/** A control's anchor on the board: the centre of the box it is hit through, the slider's at value `v`. */
export function anchorOf(control: string, v: JsonValue): Pt {
  if (control === 'fire') return BOARD.fire.anchor;
  if (control === 'lamp') return BOARD.lamp.anchor;
  if (control === 'gain' && typeof v === 'number') return thumb(v);
  throw Error(`the board has no anchored control ${control} with value ${show(v)}`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-input input` (#308): one session of the input module per JSON line in, one answer per line out.

/** The planted programs the issue names, each reached only through a session's `planted` (README: Planted programs). */
export type InputPlanted = 'tour_pointer_frame_clock' | 'tour_pointer_glide_before_key' | 'tour_pointer_takes_hits';
export interface InputLine { doc: JsonObject; fps?: Pt; reduced_motion?: boolean; planted?: InputPlanted; ops: JsonObject[] }
export interface Entry { t: number; control: string; value: JsonValue; writer: string }
/** A session's answer: the track's hash, its entries (`raw.track` as the binary wrote them) and one result per op. */
export interface InputRun { hash: string; track: Entry[]; results: JsonObject[]; raw: JsonObject }

/** The ops of one session, in order; each method gives the index of its op, whose result the test reads. Times are flicks. */
export class Ops {
  readonly list: JsonObject[] = [];
  private add(op: JsonObject): number { this.list.push(op); return this.list.length - 1; }
  /** #308: plays the playhead forward to `t` with no gesture; the tour writes its entries on the way. */
  advance(t: number): number { return this.add({ op: 'advance', t }); }
  /** #308: moves the playhead; no entry. */
  seek(t: number): number { return this.add({ op: 'seek', t }); }
  /** #308: your pointer's events, in viewport px. */
  down(at: Pt, t: number): number { return this.add({ op: 'pointer', phase: 'down', at, t, mods: [] }); }
  move(at: Pt, t: number): number { return this.add({ op: 'pointer', phase: 'move', at, t, mods: [] }); }
  up(at: Pt, t: number): number { return this.add({ op: 'pointer', phase: 'up', at, t, mods: [] }); }
  /** #308: the value a driver reads of `control` at `t`, the playhead moved there first. */
  read(control: string, t: number): number { this.seek(t); return this.add({ op: 'read', control, t }); }
  /** README: the tour pointer as a frame at the playhead draws it. */
  pointer(): number { return this.add({ op: 'tour_pointer' }); }
  /** Plays to `t`, then reads the tour pointer there. */
  pointerAt(t: number): number { this.advance(t); return this.pointer(); }
}

function spawnInput(lines: InputLine[]): { status: number | null; out: string[]; stderr: string } {
  const text = lines.map((l) => JSON.stringify({ viewport: BOARD.size, ...l })).join('\n');
  const r = spawnSync(binOf('deep-input'), ['input'], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  return { status: r.status, out: (r.stdout ?? '').split('\n').filter((l) => l !== ''), stderr: r.stderr ?? '' };
}
function answerOf(text: string, line: InputLine, what: string): InputRun {
  let parsed: JsonValue;
  try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
  const a = obj(parsed, `${what}: the answer`);
  expect(a['ok'], `${what}: deep-input plays the session and answers its \`tour_pointer\` ops (README: The surface under test); it answered ${show(a, 800)}`).toBe(true);
  const track = arr(a['track'], `${what}: track`).map((e, i): Entry => {
    const o = obj(e, `${what}: track[${i}]`);
    return { t: num(o['t'], `${what}: track[${i}].t`), control: str(o['control'], `${what}: track[${i}].control`), value: o['value'] ?? null, writer: str(o['writer'], `${what}: track[${i}].writer`) };
  });
  const results = arr(a['results'], `${what}: results`).map((r, i) => obj(r, `${what}: results[${i}]`));
  expect(results.length, `${what}: one result per op`).toBe(line.ops.length);
  return { hash: str(a['hash'], `${what}: hash`), track, results, raw: a };
}
/** The sessions, each in a 1920 × 1080 px view, all in one `deep-input input` process; each answer is `ok`. */
export function runInput(lines: InputLine[], what: string): InputRun[] {
  const r = spawnInput(lines);
  expect(r.status, `${what}: deep-input input exits 0; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  expect(r.out.length, `${what}: one answer per session`).toBe(lines.length);
  return r.out.map((text, i) => answerOf(text, lines[i]!, lines.length > 1 ? `${what} (session ${i + 1})` : what));
}
/** A planted program's sessions; null for one it refuses, crashes on or answers out of shape (its check then fails on that). */
export function tryInput(lines: InputLine[]): (InputRun | null)[] {
  const r = spawnInput(lines);
  if (r.status !== 0 || r.out.length !== lines.length) return lines.map(() => null);
  return r.out.map((text, i) => { try { return answerOf(text, lines[i]!, `planted ${lines[i]!.planted ?? ''}`); } catch { return null; } });
}

/** A `tour_pointer` reading: the tip in px, and the share of itself the pointer draws with (0: no pointer pixel). */
export interface Pointer { tip: Pt | null; opacity: number }
/** A result's reading, or null when it isn't one: `opacity` a number from 0 to 1, and a `tip` [x, y] wherever it is above 0. */
export function peek(v: JsonValue | undefined): Pointer | null {
  if (!isObject(v)) return null;
  const opacity = v['opacity'];
  if (typeof opacity !== 'number' || !(opacity >= 0 && opacity <= 1)) return null;
  const t = v['tip'];
  const tip: Pt | null = Array.isArray(t) && t.length === 2 && typeof t[0] === 'number' && typeof t[1] === 'number' && Number.isFinite(t[0]) && Number.isFinite(t[1]) ? [t[0], t[1]] : null;
  return tip === null && opacity > 0 ? null : { tip, opacity };
}
/** A result's reading; a result that isn't one fails, naming it. */
export function readingOf(v: JsonValue | undefined, what: string): Pointer {
  const p = peek(v);
  expect(p !== null, `${what}: the tour pointer's reading is {tip: [x, y] | null, opacity: 0 to 1}, with a tip wherever it draws; got ${show(v, 400)}`).toBe(true);
  return p!;
}
export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const at = (p: Pt): string => `(${+p[0].toFixed(3)}, ${+p[1].toFixed(3)})`;
/** Why the result `v` isn't a pointer drawn with its tip within 1 px of `want`; null when it is. */
export function offBy(v: JsonValue | undefined, want: Pt, what: string, where: string): string | null {
  const p = peek(v);
  if (!p) return `${what}: no tour pointer reading {tip, opacity}; got ${show(v, 300)}`;
  if (p.opacity <= 0 || !p.tip) return `${what}: no pointer draws (opacity ${p.opacity}); its tip belongs within 1 px of ${where} ${at(want)}`;
  const d = dist(p.tip, want);
  return d <= 1 ? null : `${what}: the pointer's tip is at ${at(p.tip)}, ${+d.toFixed(3)} px from ${where} ${at(want)}`;
}
/** Why the result `v` isn't a reading at which no pointer pixel draws; null when it is. */
export function drawn(v: JsonValue | undefined, what: string): string | null {
  const p = peek(v);
  if (!p) return `${what}: no tour pointer reading {tip, opacity}; got ${show(v, 300)}`;
  return p.opacity === 0 ? null : `${what}: the pointer draws (opacity ${p.opacity}${p.tip ? `, tip ${at(p.tip)}` : ''})`;
}
/** Whether the track holds an entry by `writer` on `control` at flick `t`. */
export const wrote = (run: InputRun, writer: string, control: string, t: number): boolean => run.track.some((e) => e.writer === writer && e.control === control && e.t === t);
/** The track in brief, for messages. */
export const trackText = (run: InputRun): string => show(run.track.map((e) => `${e.writer} ${e.control}=${show(e.value, 40)} @${+secs(e.t).toFixed(4)}s`), 1200);

// ---------------------------------------------------------------------------------------------------
// `deep-show run` and `deep-show screen`: one scenario line on stdin (#393; #501, #542 and #1897 as they drive it).

const SESSION = 'sess-903';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-903', name: 'Test agent: tour pointer', process: { pid: 4200, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4200, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB903D${String(n).padStart(18, '0')}`;
/** The reference window, 1512 × 982 points, on the display it sits on, with #383's virtual clock for the scope. */
export const WINDOW: Pt = [1512, 982];
const WINDOW_DISPLAY: Pt = [1728, 1117];
const MS = FLICKS / 1000;
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };

/**
 * A scenario: the agent's session and process tree, each document in a panel of its own, and the calls. With `window`
 * it is the app's reference window on its virtual clock, one panel filling it, and every call carries its `at`.
 */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], window?: Pt): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: window ? [0, 0, ...window] : [0, 540 * i, 960, 540] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, ...(window ? { clock: CLOCK, display: WINDOW_DISPLAY, window } : {}), calls };
}
/** The agent's `deep_show` of a whole document (#393), with its issues; `at` is its time on the scenario's clock. */
export const present = (doc: string, document: JsonObject, when?: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'], ...(when !== undefined ? { at: when } : {}) });
/** A `deep_show` reply that presented its document with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, `${what}: the deep_show reply`);
  const errors = (Array.isArray(r['issues']) ? r['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
  expect(r['outcome'], `${what} is presented, its \`tour\` a field of the document the app takes (README: Documents); the reply's issues: ${show(r['issues'] ?? r, 2500)}`).toBe('presented');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(binOf('deep-show'), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(list.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** `deep-show screen` (#1162): the scenario's calls run, then the app's window drawn at `t` flicks at `scale`, written to `out`. */
export function runScreen(sc: JsonObject, out: string, t: number, scale: number, what: string): Image {
  const r = spawnSync(binOf('deep-show'), ['screen'], { cwd: REPO, input: `${JSON.stringify({ ...sc, out, t, scale })}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const stdout = (r.stdout ?? '').trim();
  let reply: JsonValue;
  try { reply = JSON.parse(stdout.split('\n').pop() ?? '') as JsonValue; } catch { reply = stdout; }
  if (isObject(reply) && reply['code'] === 'unsupported_platform') inconclusive(`${what}: the app's window draws on macOS; this is ${process.platform}`);
  const o = obj(reply, `${what}: deep-show screen's answer (stderr ${(r.stderr ?? '').slice(-800)})`);
  expect(o['ok'], `${what}: deep-show screen draws the window: ${show(o)}`).toBe(true);
  expect(existsSync(out), `${what}: the window's PNG is written`).toBe(true);
  return decodePng(readFileSync(out));
}
/** A reply that says this machine can't draw or hash here: BLOCKED with no GPU, INCONCLUSIVE off the platform that draws. */
export function gate(reply: JsonObject, what: string): void {
  const code = `${String(reply['code'] ?? '')} ${String(reply['reason'] ?? '')}`;
  if (/unsupported_platform/.test(code)) inconclusive(`${what} reports unsupported_platform on ${process.platform}`);
  if (/gpu|adapter/.test(code)) blocked(`${what}: no GPU to draw or hash on here: ${show(reply, 600)}`);
}

/** A delivered export's receipt (#501): its size, rate and frame hashes. */
export interface Receipt { size: number[]; frame_rate: number[]; frame_hashes: string[] }
export function receiptOf(reply: JsonObject | undefined, what: string): Receipt {
  const r = obj(reply, `${what}: the export's reply`);
  gate(r, what);
  expect(r['outcome'], `${what} is exported: ${show(r)}`).toBe('exported');
  const receipt = obj(r['receipt'], `${what}: receipt`);
  return {
    size: arr(receipt['size'], `${what}: receipt.size`).map((v, i) => num(v, `${what}: receipt.size[${i}]`)),
    frame_rate: arr(receipt['frame_rate'], `${what}: receipt.frame_rate`).map((v, i) => num(v, `${what}: receipt.frame_rate[${i}]`)),
    frame_hashes: arr(receipt['frame_hashes'], `${what}: receipt.frame_hashes`).map((v, i) => str(v, `${what}: receipt.frame_hashes[${i}]`)),
  };
}
/** A png_seq export's frames (#501): the PNG files under `out`, in name order, which is frame order. */
export function pngFrames(out: string, what: string): Buffer[] {
  expect(existsSync(out), `${what}: the export wrote ${out}`).toBe(true);
  return readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort().map((f) => readFileSync(join(out, f)));
}

// ---------------------------------------------------------------------------------------------------
// The riding card (README: Fixtures): a 640 × 360 scene whose cart moves by a channel, and a card over it, anchored to
// the cart's point, holding one control. Units and axes: metres, +Y up; frame px from the top left corner, y down.

export const CARD = {
  size: [640, 360] as Pt,
  /** A pinhole, its field of view across the frame's wider side (#378, as #506's suites read it). */
  cam: { position: [0, 1.6, 6] as V3, target: [0, 1, 0] as V3, fov: 50 },
  /** The cart's position, linear from `from` at 0 s to `to` at `span` s. */
  ride: { from: [-1.5, 0.5, 0] as V3, to: [1.5, 1.5, 0] as V3, span: 4 },
  /** The tour's key on the card's control, s. */
  key: 3,
  /** The card's frame, its button's box in it, and the overlay's offset, px: the button's centre sits on the anchor's projection. */
  frame: [120, 80] as Pt, button: [40, 20, 40, 40] as Rect, offset: [-60, -40] as Pt,
} as const;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
/** The cart's position at `s` seconds. */
function cartAt(s: number): V3 {
  const u = Math.min(1, Math.max(0, s / CARD.ride.span));
  const { from, to } = CARD.ride;
  return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u];
}
/** Where world point `p` lands in the card's frame through its camera, px. */
function project(p: V3): Pt {
  const { position, target, fov } = CARD.cam;
  const f = unit(sub(target, position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, position);
  const [w, h] = CARD.size;
  const focal = Math.max(w, h) / 2 / Math.tan((fov * Math.PI) / 360);
  return [w / 2 + (focal * dot(d, r)) / dot(d, f), h / 2 - (focal * dot(d, u)) / dot(d, f)];
}
/** The card's control's anchor at `s`: its button's centre, which the frame's offset puts on the cart's projected point. */
export function cardAnchor(s: number): Pt {
  const [x, y] = project(cartAt(s));
  return [x + CARD.offset[0] + CARD.button[0] + CARD.button[2] / 2, y + CARD.offset[1] + CARD.button[1] + CARD.button[3] / 2];
}
/**
 * The riding card as a writer sends it (#506's scene form): a floor and a cart under a sun and a sky; the card
 * `overlay.frame@1` `card` holding the frame `card-frame` (its background and its button), anchored to the cart's point;
 * the toggle `card-switch`, hit through the button; a tour that keys it once, at 3 s.
 */
export function cardDoc(id: string): JsonObject {
  const material = (base: V3): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness: 0.7 } });
  const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [...CARD.cam.position], target: [...CARD.cam.target], fov: CARD.cam.fov, near: 0.05, far: 500 } },
    sky: { kind: 'sky@1', params: { top: [0.5, 0.48, 0.45, 1], low: [0.62, 0.58, 0.52, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 150, 0] } },
    'floor-mat': material([0.3, 0.28, 0.26]), 'cart-mat': material([0.4, 0.12, 0.08]),
    floor: box([14, 0.1, 14], [0, -0.05, 0], 'floor-mat'),
    cart: box([0.4, 0.4, 0.4], [...CARD.ride.from], 'cart-mat'),
    'card-frame': { kind: 'frame@1', params: { box: [0, 0, ...CARD.frame] } },
    'card-bg': { kind: 'rect@1', parent: 'card-frame', params: { box: [0, 0, ...CARD.frame], paint: { fill: { role: 'accent' } } } },
    'card-button': { kind: 'rect@1', parent: 'card-frame', params: { box: [...CARD.button], paint: { fill: { role: 'ink' } } } },
    card: { kind: 'overlay.frame@1', params: { frame: 'card-frame', anchor: { item: 'cart', point: [0, 0, 0] }, offset: [...CARD.offset] } },
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, ...item };
  return {
    format: 1, id, profile: 'scene', title: 'A card riding a cart', description: 'A cart that crosses the floor with a card over it, switched by an idle tour.',
    size: [...CARD.size], camera: 'cam', seed: 903, transport: { span: `${CARD.ride.span}s` },
    requires: { modules: { scene3d: '^1', marks2d: '^1', effects: '^1', input: '^1' } }, budget: { class: 'showpiece' },
    items: withIds,
    channels: { ride: { target: 'items/cart/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [...CARD.ride.from], interp: 'linear' }, k1: { t: `${CARD.ride.span}s`, value: [...CARD.ride.to], interp: 'linear' } } } },
    controls: { 'card-switch': { kind: 'toggle', class: 'document', label: 'Light', role: 'switch', default: false, targets: { switch: 'card-button' } } },
    tour: { keys: { 'card-switch': [[CARD.key, true, 'hold']] }, idle_after: 0, loop: false },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pictures: 8-bit PNG (copied from #467's helpers: a reader, a writer and an animated PNG of equal-sized frames).

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let pos = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString('latin1', pos + 4, pos + 8);
    const body = file.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (pred === undefined) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** A picture's color as RGB rows, each with filter 0, deflated: the same pixels always give the same bytes. */
function rgbRows(im: Image): Buffer {
  const raw = Buffer.alloc((im.width * 3 + 1) * im.height);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const o = (y * im.width + x) * 4; const r = y * (im.width * 3 + 1) + 1 + x * 3;
    raw[r] = im.rgba[o]!; raw[r + 1] = im.rgba[o + 1]!; raw[r + 2] = im.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
function header(im: Image): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(im.width, 0); ihdr.writeUInt32BE(im.height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return chunk('IHDR', ihdr);
}
/** A decoded picture written again as an 8-bit RGB PNG. */
export const encodePng = (im: Image): Buffer => Buffer.concat([SIGNATURE, header(im), chunk('IDAT', rgbRows(im)), chunk('IEND', new Uint8Array(0))]);
/** An animated PNG of equal-sized frames at `fps`, looping. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const first = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts: Buffer[] = [SIGNATURE, header(first), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(first.width, 4); fctl.writeUInt32BE(first.height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = rgbRows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The reference Macs (docs/technical-design.md: The reference Macs): a same-machine hash counts on one of them.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
/** Why this machine isn't a reference Mac; null when it is. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}, not a reference Mac`;
  const read = (name: string): string | null => {
    try { return execFileSync('sysctl', ['-n', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim(); } catch { return null; }
  };
  const model = read('hw.model'); const chip = read('machdep.cpu.brand_string'); const gib = Math.round(Number(read('hw.memsize')) / 2 ** 30);
  return REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib) ? null : `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
}
