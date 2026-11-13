// Test-side tools for the #1967 acceptance tests: `deep-show` built once per file and driven by one JSON scenario on
// stdin (`deep-show run`, #393's convention); the terminal recording the tests write (README: The recording); the
// document whose cell grid plays it (README: The document); the calls this suite reads and parsers for their replies;
// and the grid comparison every criterion's check uses. Nothing here stands in for the decode worker, the terminal
// emulator, the cell grid or the live terminal: each grid is read from what `deep-show` answers.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1967 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 900_000;

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isInteger(value), `${what} is an integer, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** An environment this suite can't run in: the test fails with `BLOCKED:` and the reason, never passes. */
function blocked(reason: string): never {
  throw new Error(`BLOCKED: ${reason}`);
}

// ---------------------------------------------------------------------------------------------------
// Time (canvas primitives: Time and the flick)

const FLICKS = 705_600_000;
const SEC = FLICKS;
/** Seconds as flicks, exactly: every time this suite uses is a whole number of flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  expect(Number.isSafeInteger(f) && Math.abs(f - seconds * FLICKS) < 1e-6, `${seconds} s is a whole number of flicks`).toBe(true);
  return f;
}
const secs = (flicks: number): string => (flicks % (FLICKS / 1000) === 0 ? `${flicks / FLICKS} s` : `${flicks} flicks`);

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug; a test that uses a build
// that failed fails, naming it.

export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1967-bin-'));
    const args = ['build', '--locked', '--bin', 'deep-show'];
    const run = spawnSync('cargo', args, {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' },
    });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, 'the binary builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-1967-'));
    made.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// The recording (README: The recording): a size, then output bytes with their times. UTF-8 JSON lines: the first line
// `{"cols", "rows"}`, then one line per chunk of output `{"at": flicks from the recording's start, "text"}`, the same
// `{at, text}` chunks #402's `terminal_open` takes as its `feed`. Line ends are `\r\n`, as a terminal program writes
// them.

export const COLS = 20;
export const ROWS = 4;
/** `step 1` in bold, true-color gold on true-color navy, then the pen reset and a new line. */
export const STEP_1 = '\u001b[1;38;2;255;215;0;48;2;26;26;64mstep 1\u001b[0m\r\n';
/** `step 2` underlined, true-color turquoise on the default background, then the pen reset and a new line. */
export const STEP_2 = '\u001b[4;38;2;64;224;208mstep 2\u001b[0m\r\n';
export const PEN_1 = { fg: '#ffd700', bg: '#1a1a40', attr: 'bold' } as const;
export const PEN_2 = { fg: '#40e0d0', attr: 'underline' } as const;
export interface Chunk { at: number; text: string }
/** The issue's recording: `step 1` printed at 0.5 s, `step 2` at 1.5 s. */
export const CHUNKS: Chunk[] = [{ at: fl(0.5), text: STEP_1 }, { at: fl(1.5), text: STEP_2 }];
function recordingBytes(): Buffer {
  const lines = [JSON.stringify({ cols: COLS, rows: ROWS }), ...CHUNKS.map((c) => JSON.stringify({ at: c.at, text: c.text }))];
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}
/** The recording written to `dir/run.rec`; its path and SHA-256. */
export function writeRecording(dir: string): { path: string; sha: string } {
  const bytes = recordingBytes();
  const path = join(dir, 'run.rec');
  writeFileSync(path, bytes);
  return { path, sha: sha256(bytes) };
}
/** The evidence store: a file named by its SHA-256, under a folder named by its first two hex digits. */
function putEvidence(evidence: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// What the grid shows at each time the tests read (README: Readings): nothing before 0.5 s, `step 1` from 0.5 s, both
// lines from 1.5 s; the cursor at the start of the row under the last line printed.

const NOTHING = ['', '', '', ''];
const ONLY_STEP_1 = ['step 1', '', '', ''];
const BOTH = ['step 1', 'step 2', '', ''];
export interface Expected { t: number; label: string; text: string[]; cursorY: number }
export const TIMES: Expected[] = [
  { t: fl(0.25), label: '0.25 s', text: NOTHING, cursorY: 0 },
  { t: fl(0.5) - 1, label: '0.5 s less one flick', text: NOTHING, cursorY: 0 },
  { t: fl(0.5), label: '0.5 s', text: ONLY_STEP_1, cursorY: 1 },
  { t: fl(0.75), label: '0.75 s', text: ONLY_STEP_1, cursorY: 1 },
  { t: fl(1), label: '1.0 s', text: ONLY_STEP_1, cursorY: 1 },
  { t: fl(1.5) - 1, label: '1.5 s less one flick', text: ONLY_STEP_1, cursorY: 1 },
  { t: fl(1.5), label: '1.5 s', text: BOTH, cursorY: 2 },
  { t: fl(1.75), label: '1.75 s', text: BOTH, cursorY: 2 },
  { t: fl(2), label: '2.0 s', text: BOTH, cursorY: 2 },
];
export const labelOf = (t: number): string => TIMES.find((e) => e.t === t)?.label ?? secs(t);

// ---------------------------------------------------------------------------------------------------
// The document (README: The document): a board whose one cell grid plays the recording from 0 s.

const LAYER = 'main';
const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #1967 acceptance tests.' };
/** The look's roles a live terminal draws with (#1003): its ink and ground, and its sixteen terminal colors in order. */
const TERMINAL_ROLES = [
  'term_black', 'term_red', 'term_green', 'term_yellow', 'term_blue', 'term_magenta', 'term_cyan', 'term_white',
  'term_bright_black', 'term_bright_red', 'term_bright_green', 'term_bright_yellow', 'term_bright_blue', 'term_bright_magenta', 'term_bright_cyan', 'term_bright_white',
];
const GRID = 'run';
const ulid = (n: number): string => `01JB1967${String(n).padStart(18, '0')}`;
const DOC = ulid(1);

/** The cell grid `run`, 20 × 4, playing the recording `sha` from film time 0 at its own rate. */
function gridItem(sha: string): JsonObject {
  return {
    id: GRID, kind: 'cells@1', layer: LAYER, name: 'Test run', order: 'a1', at: { pos: [16, 16, 0] },
    params: {
      size: { cols: COLS, rows: ROWS, cell: [8, 16] },
      font: { family: 'mono', size: 13, fallback: [], ligatures: false },
      palette: { fg: 'ink', bg: 'ground', ansi: TERMINAL_ROLES, truecolor: true },
      play: { asset: sha, start: '0s', in: 0, rate: [1, 1] },
    },
  };
}
function documentOf(sha: string): JsonObject {
  return {
    format: 1, id: 'terminal-recording', profile: 'board', title: '#1967 a test run replayed',
    description: 'A test run replayed from a terminal recording in a cell grid, for the #1967 acceptance tests.',
    size: [320, 200], layers: LAYERS, transport: { span: '3s', frame_rate: [30, 1] },
    requires: { modules: { cells: '^1' } },
    items: { [GRID]: gridItem(sha) }, assets: { rec: { sha256: sha, license: LICENSE } },
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };

/** A scenario for the document: the evidence store, your shell's process tree, one panel holding the document. */
function docScenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [DOC]: { panel: 'main' } }, ...(planted ? { planted } : {}), calls };
}
/** `deep show` of the whole document from your shell; the hub stamps the writer layer, so the payload has none. */
function present(document: JsonObject): JsonObject {
  const payload = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc: DOC, document: payload, include: ['issues'] };
}
/** #488's `determinism`: at each time, playing to it (every 144 Hz frame from 0) against seeking to it (a fresh session
 * jumping back from a second later). */
const determinismCall = (atTimes: number[]): JsonObject => ({ call: 'determinism', doc: DOC, display_hz: 144, at_times: atTimes });

interface Ran { replies: JsonObject[]; pid: number }
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call. `pid` is the run's own process. */
export function runShow(bin: string, sc: JsonObject, what: string): Ran {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error === undefined, `${what}: deep-show run finished (${run.error?.message ?? ''})`).toBe(true);
  expect(run.status, `${what}: deep-show run exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return { replies, pid: run.pid ?? -1 };
}

// ---------------------------------------------------------------------------------------------------
// Grids (README: The surface under test): a grid's size, its rows' text (right-trimmed), its cursor and every cell in
// row-major order, each cell as #402's `cell` call answers it.

export interface Cell { g: string; fg: string; bg: string; attrs: string[]; link: string | null }
export interface Cursor { x: number; y: number; shape: string; visible: boolean; blink: boolean }
export interface Grid { cols: number; rows: number; text: string[]; cursor: Cursor; cells: Cell[] }

function cellOf(v: JsonValue | undefined, what: string): Cell {
  const c = obj(v, what);
  const link = c['link'];
  expect(link === null || typeof link === 'string', `${what}.link is null or a link ID, got ${show(link)}`).toBe(true);
  return {
    g: str(c['g'], `${what}.g`), fg: str(c['fg'], `${what}.fg`), bg: str(c['bg'], `${what}.bg`),
    attrs: arr(c['attrs'], `${what}.attrs`).map((a, i) => str(a, `${what}.attrs[${i}]`)), link: link as string | null,
  };
}
function cursorOf(v: JsonValue | undefined, what: string): Cursor {
  const c = obj(v, what);
  const flag = (k: string): boolean => { expect(typeof c[k], `${what}.${k} is a boolean`).toBe('boolean'); return c[k] === true; };
  return { x: int(c['x'], `${what}.x`), y: int(c['y'], `${what}.y`), shape: str(c['shape'], `${what}.shape`), visible: flag('visible'), blink: flag('blink') };
}
const textOf = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((r, i) => str(r, `${what}[${i}]`));

/** A side's (or a reply's) `cells` block entry for `item`: the grid a cells@1 item shows. */
function blockGrid(holder: JsonObject, item: string, what: string): Grid {
  const g = obj(obj(holder['cells'], `${what}: cells (each cell grid as it shows, README: The surface under test)`)[item], `${what}: cells.${item}`);
  const cols = int(g['cols'], `${what}: cells.${item}.cols`), rows = int(g['rows'], `${what}: cells.${item}.rows`);
  const cells = arr(g['cells'], `${what}: cells.${item}.cells`);
  expect(cells.length, `${what}: cells.${item}.cells holds cols × rows cells`).toBe(cols * rows);
  return {
    cols, rows, text: textOf(g['text'], `${what}: cells.${item}.text`), cursor: cursorOf(g['cursor'], `${what}: cells.${item}.cursor`),
    cells: cells.map((c, i) => cellOf(c, `${what}: cells.${item}.cells[${i}]`)),
  };
}
const cellAt = (g: Grid, x: number, y: number): Cell => g.cells[y * g.cols + x]!;

/** Every difference between two grids, each a sentence naming what differs: the size, a row's text, a cursor field, or
 * a cell's grapheme, colors, attributes or link. An empty list means the grids are equal. */
export function gridDiffs(a: Grid, b: Grid): string[] {
  const out: string[] = [];
  if (a.cols !== b.cols || a.rows !== b.rows) return [`size ${a.cols} × ${a.rows} against ${b.cols} × ${b.rows}`];
  for (let r = 0; r < a.rows; r++) if (a.text[r] !== b.text[r]) out.push(`row ${r} text ${JSON.stringify(a.text[r])} against ${JSON.stringify(b.text[r])}`);
  for (const k of ['x', 'y', 'shape', 'visible', 'blink'] as const) if (a.cursor[k] !== b.cursor[k]) out.push(`cursor.${k} ${String(a.cursor[k])} against ${String(b.cursor[k])}`);
  for (let i = 0; i < a.cells.length; i++) {
    const p = a.cells[i]!, q = b.cells[i]!;
    const at = `cell (${i % a.cols}, ${Math.floor(i / a.cols)})`;
    if (p.g !== q.g) out.push(`${at} g ${JSON.stringify(p.g)} against ${JSON.stringify(q.g)}`);
    if (p.fg !== q.fg) out.push(`${at} fg ${p.fg} against ${q.fg}`);
    if (p.bg !== q.bg) out.push(`${at} bg ${p.bg} against ${q.bg}`);
    if ([...p.attrs].sort().join(',') !== [...q.attrs].sort().join(',')) out.push(`${at} attrs [${p.attrs.join(', ')}] against [${q.attrs.join(', ')}]`);
    if (p.link !== q.link) out.push(`${at} link ${String(p.link)} against ${String(q.link)}`);
  }
  return out;
}

/** What a grid shows against what the recording printed by `e.t`: its rows' text and its cursor's place. */
export function shownProblems(g: Grid, e: Expected, side: string): string[] {
  const out: string[] = [];
  if (g.cols !== COLS || g.rows !== ROWS) out.push(`${side} at ${e.label}: the grid is ${g.cols} × ${g.rows}, not ${COLS} × ${ROWS}`);
  if (JSON.stringify(g.text) !== JSON.stringify(e.text)) out.push(`${side} at ${e.label}: shows ${JSON.stringify(g.text)}, not ${JSON.stringify(e.text)}`);
  if (g.cursor.x !== 0 || g.cursor.y !== e.cursorY) out.push(`${side} at ${e.label}: the cursor is at (${g.cursor.x}, ${g.cursor.y}), not (0, ${e.cursorY})`);
  return out;
}

/** The pen of the six cells a line printed on row `y`: each grapheme, and the colors and attribute it was printed with. */
export function penProblems(g: Grid, y: number, word: string, pen: { fg: string; bg?: string; attr: string }, other: string, what: string): string[] {
  const out: string[] = [];
  const blankBg = cellAt(g, COLS - 1, ROWS - 1).bg;
  for (let x = 0; x < word.length; x++) {
    const c = cellAt(g, x, y);
    if (c.g !== word[x]) out.push(`${what}: cell (${x}, ${y}) holds ${JSON.stringify(c.g)}, not ${JSON.stringify(word[x])}`);
    if (c.fg.toLowerCase() !== pen.fg) out.push(`${what}: cell (${x}, ${y}) fg ${c.fg}, not ${pen.fg}`);
    const bg = pen.bg ?? blankBg;
    if (c.bg.toLowerCase() !== bg.toLowerCase()) out.push(`${what}: cell (${x}, ${y}) bg ${c.bg}, not ${pen.bg ?? `the default background ${blankBg}`}`);
    if (!c.attrs.includes(pen.attr)) out.push(`${what}: cell (${x}, ${y}) attrs [${c.attrs.join(', ')}] lack ${pen.attr}`);
    if (c.attrs.includes(other)) out.push(`${what}: cell (${x}, ${y}) attrs [${c.attrs.join(', ')}] hold ${other}`);
  }
  const after = cellAt(g, word.length, y);
  if (after.bg.toLowerCase() !== blankBg.toLowerCase()) out.push(`${what}: cell (${word.length}, ${y}), after the reset, has bg ${after.bg}, not the default ${blankBg}`);
  return out;
}

/** One time's two sides from a `determinism` reply: each side's canonical render (`pixels`) and the grid it shows. */
interface Side { pixels: string; grid: Grid }
export interface Compared { t: number; play: Side; seek: Side }
function comparedOf(reply: JsonObject, what: string): Compared[] {
  if (reply['outcome'] === 'refused' && /gpu|adapter/.test(String(reply['code']))) blocked(`no GPU for determinism's renders here: ${show(reply)}`);
  expect(reply['outcome'], `${what} is compared: ${show(reply)}`).toBe('compared');
  return arr(reply['frames'], `${what}: frames`).map((f, i) => {
    const o = obj(f, `${what}: frames[${i}]`);
    const t = int(o['t'], `${what}: frames[${i}].t`);
    const side = (k: 'play' | 'seek'): Side => {
      const s = obj(o[k], `${what}: frames[${i}].${k}`);
      const label = `${what}, ${k === 'play' ? 'played' : 'seeked'} to ${labelOf(t)}`;
      return { pixels: str(s['pixels'], `${label}: pixels`), grid: blockGrid(s, GRID, label) };
    };
    return { t, play: side('play'), seek: side('seek') };
  });
}
export function at(frames: Compared[], t: number): Compared {
  const f = frames.find((x) => x.t === t);
  expect(f, `determinism compared ${labelOf(t)}`).toBeDefined();
  return f!;
}

/** The recording in the evidence store, the document presented, then `determinism` at `times` (every time in TIMES
 * unless given). */
export function playAndSeek(bin: string, evidence: string, planted?: string, times: number[] = TIMES.map((e) => e.t)): Compared[] {
  const sha = putEvidence(evidence, recordingBytes());
  const what = `the recording in a cell grid${planted ? ` (planted ${planted})` : ''}`;
  const { replies } = runShow(bin, docScenario(evidence, [present(documentOf(sha)), determinismCall(times)], planted), what);
  expect(replies[0]!['outcome'], `${what}: the document is presented: ${show(replies[0])}`).toBe('presented');
  return comparedOf(replies[1]!, `${what}: determinism`);
}

// ---------------------------------------------------------------------------------------------------
// The live terminal (#402's surface): a plug-in's panel showing a terminal's cell grid, fed recorded chunks on the
// virtual display clock (#400, #401), read with `cells` and `cell` at a time.

const MS = FLICKS / 1000;
const A: JsonObject = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B: JsonObject = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
const SLOTS: number[][] = [[0, 0, 400, 350], [400, 0, 400, 350], [800, 0, 400, 350], [0, 350, 400, 350], [400, 350, 400, 350], [800, 350, 400, 350]];
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: billing', process: { pid: 4100, start: 1_000 } };
const LIVE_PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
/** When the live terminals' recorded output starts: their chunk at source time s arrives at LIVE_T0 + s. */
const LIVE_T0 = 3 * SEC;

/** A scenario of live terminals, one plug-in panel each (`{terminal ID → chunks}`), each opened at 1 s with 20 × 4
 * cells and fed its chunks from LIVE_T0; then `calls`. */
function liveScenario(evidence: string, feeds: Record<string, Chunk[]>, calls: JsonObject[]): JsonObject {
  const ids = Object.keys(feeds);
  const panelOf = (id: string): string => `screen-${id}`;
  const manifest: JsonObject = { panels: Object.fromEntries(ids.map((id) => [panelOf(id), { raw_input: true, tree: [{ id: 'screen', component: 'cells', terminal: id }] }])) };
  const opens: JsonObject[] = ids.map((id) => ({
    call: 'terminal_open', at: SEC, terminal: id, panel: panelOf(id), cols: COLS, rows: ROWS,
    feed: feeds[id]!.map((c) => ({ at: LIVE_T0 + c.at, text: c.text })),
  }));
  return {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: LIVE_PROCESSES,
    clock: { lead: 2 * MS, check: MS / 2 }, displays: [A, B], window: [1200, 700],
    panels: Object.fromEntries(ids.map((id, i) => [panelOf(id), { rect: SLOTS[i]! }])),
    calls: [{ call: 'install', at: 1, plugin: 'terminals', manifest }, ...opens, ...calls],
  };
}
/** The calls that read terminal `id`'s whole grid at `t`: `cells`, then `cell` for every (x, y) in row-major order. */
function readGridCalls(id: string, t: number): JsonObject[] {
  const calls: JsonObject[] = [{ call: 'cells', at: t, terminal: id }];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) calls.push({ call: 'cell', at: t, terminal: id, x, y });
  return calls;
}
/** The grid from `readGridCalls`' replies. */
function liveGrid(replies: JsonObject[], what: string): Grid {
  const head = replies[0]!;
  return {
    cols: int(head['cols'], `${what}: cells.cols`), rows: int(head['rows'], `${what}: cells.rows`), text: textOf(head['text'], `${what}: cells.text`),
    cursor: cursorOf(head['cursor'], `${what}: cells.cursor`), cells: replies.slice(1).map((r, i) => cellOf(r, `${what}: cell (${i % COLS}, ${Math.floor(i / COLS)})`)),
  };
}

/** Live terminals fed `feeds` (each chunk at LIVE_T0 + its time), each read whole at LIVE_T0 + `t`: their grids by ID. */
export function runLive(bin: string, evidence: string, feeds: Record<string, Chunk[]>, t: number): Record<string, Grid> {
  const ids = Object.keys(feeds);
  const sc = liveScenario(evidence, feeds, ids.flatMap((id) => readGridCalls(id, LIVE_T0 + t)));
  const { replies } = runShow(bin, sc, 'the live terminals');
  expect(replies[0]!['installed'], `the terminals' plug-in installs: ${show(replies[0])}`).toBe(true);
  ids.forEach((id, i) => expect(replies[1 + i]!['opened'], `live terminal ${id} opens: ${show(replies[1 + i])}`).toBe(true));
  const per = 1 + COLS * ROWS;
  const from = 1 + ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, liveGrid(replies.slice(from + i * per, from + (i + 1) * per), `live terminal ${id} at ${labelOf(t)}`)]));
}
