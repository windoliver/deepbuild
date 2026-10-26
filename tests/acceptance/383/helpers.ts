// Test-side tools for the #383 acceptance tests: three binaries built once per file and driven by JSON lines
// (`deep-salience zoom`, `deep-show run` with the interaction scope's calls, `deep-gpu run`'s view3d with levels by
// reference); the 2D camera mapping the tests use to place a pointer and to read where content landed; the city
// this suite generates for criterion 2; seeded draws; and the timing rule for budgets on the reference Mac. Nothing
// here stands in for salience, the interaction scope, the frame clock, residency or the GPU layer.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync as inflate } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/383 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SALIENCE_BIN = 'deep-salience';
export const SHOW_BIN = 'deep-show';
export const GPU_BIN = 'deep-gpu';
type BinName = typeof SALIENCE_BIN | typeof SHOW_BIN | typeof GPU_BIN;
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
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
export const strs = (value: JsonValue | undefined, what: string): string[] => arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function rect(value: JsonValue | undefined, what: string): Rect {
  const r = arr(value, what).map((v, i) => num(v, `${what}[${i}]`));
  expect(r.length, `${what} is [x, y, w, h]`).toBe(4);
  return r as Rect;
}

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}

/** Seeded draws (mulberry32), so a failing run replays. */
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

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file with `cargo build --locked --bin <name>`, copied out of target/debug
// under its own name, as #378's suite does; a test that uses a build that failed fails, naming it.

function cargoBuild(name: BinName): string {
  const args = ['build', '--locked', '--bin', name];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: (name: BinName) => string }
export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-383-bins-'));
    for (const name of names) {
      const error = cargoBuild(name);
      const bin = join(dir, exe(name));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(name)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${name}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh folder per test (the evidence store, generated documents), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-383-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Pipes JSON lines into one run of `bin args…`: exit 0 and exactly one line out per line in, or the test fails. */
export function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): JsonObject[] {
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
// `deep-salience zoom` (README: The surface under test)

export interface Zoomed { shown: { id: string; kind: string; name: string; holds: string; rank: number; reasons: string[] }[]; fold: { count: number; items: string[]; line: string } | null; evidence: { check: string; files: string[] }[]; raw: JsonObject }
export function zoomed(answer: JsonObject, what: string): Zoomed {
  expect(answer['ok'], `${what} is answered ok: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  const shown = arr(answer['shown'], `${what}: shown`).map((v, i) => {
    const s = obj(v, `${what}: shown[${i}]`);
    const at = `${what}: shown[${i}]`;
    return { id: str(s['id'], `${at}.id`), kind: str(s['kind'], `${at}.kind`), name: str(s['name'], `${at}.name`), holds: str(s['holds'], `${at}.holds`), rank: num(s['rank'], `${at}.rank`), reasons: strs(s['reasons'], `${at}.reasons`) };
  });
  const f = answer['fold'];
  const fold = f === null || f === undefined ? null : (() => {
    const o = obj(f, `${what}: fold`);
    return { count: num(o['count'], `${what}: fold.count`), items: strs(o['items'], `${what}: fold.items`), line: str(o['line'], `${what}: fold.line`) };
  })();
  const evidence = arr(answer['evidence'], `${what}: evidence`).map((v, i) => {
    const e = obj(v, `${what}: evidence[${i}]`);
    return { check: str(e['check'], `${what}: evidence[${i}].check`), files: strs(e['files'], `${what}: evidence[${i}].files`) };
  });
  return { shown, fold, evidence, raw: answer };
}

/** Every string anywhere in a JSON value (the paths a level could name, in any field). */
export function stringsIn(value: JsonValue): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isObject(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` with the interaction scope (README: The surface under test)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const REFRESH_HZ = 120;
export const PERIOD = FLICKS / REFRESH_HZ; // 5,880,000 flicks
export const LEAD = 2 * MS; // the latch, 2 ms before each vsync
export const CHECK = MS / 2; // 0.5 ms of the checker per patch
export const CLOCK: JsonObject = { refresh_hz: REFRESH_HZ, lead: LEAD, check: CHECK };
/** The display the window is on; full screen fills it. Same 16:9 shape as the panels. */
export const DISPLAY: [number, number] = [1600, 900];
export const PANEL: Rect = [0, 0, 800, 450];
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB383D', 1);

/** The scope's wrong programs (README: Planted programs), each reachable only through the scenario's `planted`. */
export type ShowPlanted = 'pick_mid_gesture' | 'commit_every_move' | 'line_scroll_pans' | 'drag_shows_on_release' | 'patch_shows_a_frame_late' | 'full_screen_only_3d' | 'esc_to_root';

export type Rect = [number, number, number, number];
export type Point = [number, number];
export interface Camera2 { target: [number, number, number]; view_width: number; raw: JsonObject }
export interface Scope {
  camera: Camera2; rect: Rect; full_screen: boolean; buttons: { verb: string; rect: Rect }[];
  selection: string[]; details: string | null; hover: string | null; level: string[]; palette: { open: boolean; query: string };
}
export interface Input { serial: number; state: Scope; picks: number; commits: number[] }

export function camera2(value: JsonValue | undefined, what: string): Camera2 {
  const c = obj(value, what);
  const t = arr(c['target'], `${what}.target`).map((v, i) => num(v, `${what}.target[${i}]`));
  expect(t.length, `${what}.target is [x, y, z]`).toBe(3);
  return { target: t as [number, number, number], view_width: num(c['view_width'], `${what}.view_width`), raw: c };
}
const optId = (v: JsonValue | undefined, what: string): string | null => (v === null ? null : str(v, what));
export function scopeOf(value: JsonValue | undefined, what: string): Scope {
  const s = obj(value, what);
  const p = obj(s['palette'], `${what}.palette`);
  return {
    camera: camera2(s['camera'], `${what}.camera`), rect: rect(s['rect'], `${what}.rect`), full_screen: bool(s['full_screen'], `${what}.full_screen`),
    buttons: arr(s['buttons'], `${what}.buttons`).map((b, i) => {
      const o = obj(b, `${what}.buttons[${i}]`);
      return { verb: str(o['verb'], `${what}.buttons[${i}].verb`), rect: rect(o['rect'], `${what}.buttons[${i}].rect`) };
    }),
    selection: strs(s['selection'], `${what}.selection`), details: optId(s['details'], `${what}.details`), hover: optId(s['hover'], `${what}.hover`),
    level: strs(s['level'], `${what}.level`), palette: { open: bool(p['open'], `${what}.palette.open`), query: str(p['query'], `${what}.palette.query`) },
  };
}
export function inputOf(reply: JsonObject, what: string): Input {
  return {
    serial: num(reply['serial'], `${what}: serial`), state: scopeOf(reply['state'], `${what}: state`), picks: num(reply['picks'], `${what}: picks`),
    commits: arr(reply['commits'], `${what}: commits`).map((c, i) => num(obj(c, `${what}: commits[${i}]`)['gesture'], `${what}: commits[${i}].gesture`)),
  };
}

// The 2D camera's view (canvas primitives: Camera `camera@1`, "In a 2D document the camera is orthographic, its
// target and view_width are in u with y down"): the canvas's rect shows view_width u across, centred on target.
export const uPerPx = (s: Scope): number => s.camera.view_width / s.rect[2];
export function toContent(s: Scope, p: Point): Point {
  const k = uPerPx(s);
  return [s.camera.target[0] + (p[0] - (s.rect[0] + s.rect[2] / 2)) * k, s.camera.target[1] + (p[1] - (s.rect[1] + s.rect[3] / 2)) * k];
}
export function toScreen(s: Scope, c: Point): Point {
  const k = uPerPx(s);
  return [s.rect[0] + s.rect[2] / 2 + (c[0] - s.camera.target[0]) / k, s.rect[1] + s.rect[3] / 2 + (c[1] - s.camera.target[1]) / k];
}
/** The part of the content the view shows, in u: [x, y, w, h]. */
export function viewBox(s: Scope): Rect {
  const w = s.camera.view_width;
  const h = w * (s.rect[3] / s.rect[2]);
  return [s.camera.target[0] - w / 2, s.camera.target[1] - h / 2, w, h];
}
export const inside = (outer: Rect, inner: Rect, eps = 1e-6): boolean =>
  inner[0] >= outer[0] - eps && inner[1] >= outer[1] - eps && inner[0] + inner[2] <= outer[0] + outer[2] + eps && inner[1] + inner[3] <= outer[1] + outer[3] + eps;
export const within = (r: Rect, p: Point): boolean => p[0] >= r[0] && p[1] >= r[1] && p[0] <= r[0] + r[2] && p[1] <= r[1] + r[3];
export const center = (r: Rect): Point => [r[0] + r[2] / 2, r[1] + r[3] / 2];
/** An item's box in u, from a fixture: its `at.pos` (no rotation or scale in these fixtures) plus `params.box`. */
export function boxOf(doc: JsonObject, id: string): Rect {
  const item = obj(obj(doc['items'], 'items')[id], `item ${id}`);
  const at = isObject(item['at']) ? arr(item['at']['pos'], `${id}.at.pos`).map((v) => num(v, 'pos')) : [0, 0, 0];
  const b = rect(obj(item['params'], `${id}.params`)['box'], `${id}.params.box`);
  return [at[0]! + b[0], at[1]! + b[1], b[2], b[3]];
}
export const nameOf = (doc: JsonObject, id: string): string => str(obj(obj(doc['items'], 'items')[id], `item ${id}`)['name'], `${id}.name`);

/** A scenario: the agent session presents each document on its panel at flick 1, then the calls run on the clock. */
export function showScenario(evidence: string, docs: { doc: string; panel: string; rect: Rect; document: JsonObject; seed?: boolean }[], calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  const present = docs.filter((d) => !d.seed).map((d, i) => ({ call: 'deep_show', session: ALPHA.id, doc: d.doc, document: d.document, include: ['issues'], at: 1 + i }));
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK, display: DISPLAY,
    panels: Object.fromEntries(docs.map((d) => [d.panel, { rect: d.rect }])),
    docs: Object.fromEntries(docs.map((d) => [d.doc, d.seed ? { panel: d.panel, document: d.document } : { panel: d.panel }])),
    calls: [...present, ...calls], ...(planted ? { planted } : {}),
  };
}

/** `deep-show run`: one scenario, answered ok with one reply per call; the presenting calls' replies presented. */
export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [scenario]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (the interaction scope takes \`input\`, \`scope\` and \`presented\` calls, the scenario its \`display\`${scenario['planted'] ? ` and planted ${String(scenario['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(scenario['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (isObject(c) && c['call'] === 'deep_show' && isObject(c['document'])) expect(replies[i]!['outcome'], `${what}: the document ${String(c['doc'])} is presented: ${JSON.stringify(replies[i]).slice(0, 600)}`).toBe('presented');
  });
  return replies;
}

export const input = (at: number, panel: string, event: JsonObject): JsonObject => ({ call: 'input', at, panel, event });
export const scopeCall = (at: number, panel: string): JsonObject => ({ call: 'scope', at, panel });
export const presentedCall = (at: number, panel: string): JsonObject => ({ call: 'presented', at, panel });
export const down = (pos: Point): JsonObject => ({ type: 'down', pos });
export const up = (pos: Point): JsonObject => ({ type: 'up', pos });
export const move = (pos: Point): JsonObject => ({ type: 'move', pos });
export const key = (k: string, mods: string[] = []): JsonObject => ({ type: 'key', key: k, mods });

/**
 * Drives one panel step by step on the virtual clock: each step's calls are made from the state the steps before
 * left, and the whole scenario is played again from the start with them added (it reads no wall time, so a replay
 * answers the same). Returns, per step, the replies to that step's calls.
 */
export class Driver {
  private calls: JsonObject[] = [];
  private t: number;
  constructor(private readonly bin: string, private readonly evidence: () => string, private readonly docs: Parameters<typeof showScenario>[1], private readonly panel: string, private readonly planted?: ShowPlanted, start = 20 * PERIOD) { this.t = start; }
  /** The time of the next call, then advances the clock by `gapMs`. */
  at(gapMs = 0): number { const now = this.t; this.t += Math.round(gapMs * MS); return now; }
  /** Runs `make`'s calls after the ones so far; returns their replies. */
  step(make: (at: (gapMs?: number) => number) => JsonObject[], what: string): JsonObject[] {
    const added = make((g) => this.at(g));
    const all = [...this.calls, ...added];
    const replies = runShow(this.bin, showScenario(this.evidence(), this.docs, all, this.planted), what);
    this.calls = all;
    return replies.slice(replies.length - added.length);
  }
  scope(what: string): Scope {
    const [r] = this.step((at) => [scopeCall(at(1), this.panel)], what);
    return scopeOf(r!['state'], `${what}: scope`);
  }
}

/** A minimal document of each profile the base presents (Document envelope: `profile`), one rect on an 800 × 450 page. */
export const PROFILES = ['figure', 'film', 'scene', 'world', 'view', 'board', 'sheet', 'chart', 'cells'] as const;
export function minimal(profile: string): JsonObject {
  return {
    format: 1, profile, title: `A ${profile}`, description: `A minimal ${profile} with one rect, to look for its full-screen button.`, size: [800, 450],
    items: { mark: { id: 'mark', kind: 'rect@1', name: 'Mark', order: 'a0', params: { box: [0, 0, 120, 60], paint: { fill: { role: 'muted' } } }, at: { pos: [340, 195, 0] } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run` (#377) with the view3d call (#378) and its levels by reference (README: The surface under test)

export type GpuPlanted = 'loads_everything' | 'slow_gpu_frame';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const [answer] = lines(bin, args, [{ out, calls }]);
  expect(answer!['ok'], `deep-gpu ${args.join(' ')} answers the scenario ok: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  const replies = arr(answer!['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

/** Fails with an INCONCLUSIVE message off macOS: the GPU layer draws on macOS's Metal device, the reference platform. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws this view on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

/** The reference window (technical design: The reference window): 1512 × 982 points at 2×, in device px. */
export const WINDOW_PX: [number, number] = [3024, 1964];
export const CITY = { parts: 64, tables: 12, columns: 8 } as const;
export const handle = (n: number): string => `doc:${ulid('01JB383C', n)}`;
export interface City { root: string; docs: Record<string, string>; opens: Map<string, string>; parentOf: Map<string, string>; deepest: string; deepestColumns: string[]; all: string[] }

const box = (id: string, name: string, size: [number, number, number], pos: [number, number, number], role: string, order: string, open?: string): JsonObject => ({
  id, kind: 'mark.box@1', layer: 'main', name, order,
  params: { size, paint: { fill: { role } }, ...(open ? { open: { at_px: 600, doc: open } } : {}) },
  at: { pos },
});
const scene = (id: string, title: string, items: JsonObject, camera?: JsonObject): JsonObject => ({
  format: 1, id, profile: 'scene', title, description: 'A level of the generated city: its parts as plates, each opening into its own document by reference.',
  size: [WINDOW_PX[0], WINDOW_PX[1]], ...(camera ? { camera: 'cam' } : {}),
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  items: camera ? { cam: camera, ...items } : items,
});
const order = (n: number): string => `a${String(n).padStart(4, '0')}`;

/**
 * The city (README: Fixtures): a root of 8 × 8 parts, 40 m plates 60 m apart; each part's document 12 tables, 7 m
 * plates 9 m apart; each table's document 8 columns. A child document's positions are in its opener's frame. The
 * camera looks down at part 27's table 5 from 10 m, so the deepest level is open there and nothing of any other part
 * is in view.
 */
export function writeCity(out: string): City {
  const dir = join(out, 'city');
  mkdirSync(dir, { recursive: true });
  const docs: Record<string, string> = {};
  const opens = new Map<string, string>();
  const parentOf = new Map<string, string>();
  let n = 0;
  const write = (h: string | null, doc: JsonObject): string => {
    const path = join(dir, `${h === null ? 'root' : h.slice(4)}.json`);
    writeFileSync(path, JSON.stringify(doc));
    if (h !== null) docs[h] = path;
    return path;
  };
  const rootItems: JsonObject = {};
  for (let p = 0; p < CITY.parts; p++) {
    const gx = p % 8; const gz = Math.floor(p / 8);
    const part = `p${p}`; const ph = handle(++n);
    rootItems[part] = box(part, `Part ${p}`, [40, 0.2, 40], [(gx - 3.5) * 60, 0.1, (gz - 3.5) * 60], 'block', order(p), ph);
    opens.set(part, ph);
    const partItems: JsonObject = {};
    for (let t = 0; t < CITY.tables; t++) {
      const tx = t % 4; const tz = Math.floor(t / 4);
      const table = `${part}.t${t}`; const th = handle(++n);
      partItems[table] = box(table, `Table ${t}`, [7, 0.2, 7], [(tx - 1.5) * 9, 0.2, (tz - 1) * 9], 'near', order(t), th);
      opens.set(table, th); parentOf.set(th, ph);
      const tableItems: JsonObject = {};
      for (let c = 0; c < CITY.columns; c++) {
        const cx = c % 2; const cz = Math.floor(c / 2); const h = 1 + (c % 4) * 0.5;
        tableItems[`${table}.c${c}`] = box(`${table}.c${c}`, `Column ${c}`, [1, h, 1], [(cx - 0.5) * 2.4, 0.1 + h / 2, (cz - 1.5) * 1.6], `c${c}`, order(c));
      }
      write(th, scene(th.slice(4), `${part} table ${t}`, tableItems));
    }
    write(ph, scene(ph.slice(4), `Part ${p}`, partItems));
  }
  const camera: JsonObject = {
    id: 'cam', kind: 'camera@1', layer: 'main', name: 'Camera', order: 'a',
    params: { projection: 'perspective', target: [-34.5, 0.3, -30], orbit: { azimuth: 30, elevation: 75, distance: 10 }, fov: 40, near: 0.1 },
  };
  const root = write(null, scene(ulid('01JB383C', 0), 'The city, opened at its deepest level', rootItems, camera));
  const deepest = opens.get('p27.t5')!;
  return { root, docs, opens, parentOf, deepest, deepestColumns: Array.from({ length: CITY.columns }, (_, c) => `p27.t5.c${c}`), all: Object.keys(docs) };
}

export interface CityFrame { frame: number; settled: boolean; resident: string[]; gpu_ms: number | null; gpu_bytes: number | null; ids: string | null; picks: Map<number, string> | null }
export function cityFrames(reply: JsonObject, what: string): CityFrame[] {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const opt = (k: string): number | null => (f[k] === undefined || f[k] === null ? null : num(f[k], `${at}.${k}`));
    const picks = isObject(f['picks']) ? new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)])) : null;
    return {
      frame: num(f['frame'], `${at}.frame`), settled: bool(f['settled'], `${at}.settled (whether every document the view selects is resident)`),
      resident: strs(f['resident'], `${at}.resident (the documents loaded by reference)`), gpu_ms: opt('gpu_ms'), gpu_bytes: opt('gpu_bytes'),
      ids: f['ids'] === undefined || f['ids'] === null ? null : str(f['ids'], `${at}.ids`), picks,
    };
  });
}

/** The item IDs the object-ID target holds at a captured frame (#378's encoding: pick ID r + 2^8 g + 2^16 b + 2^24 a). */
export function drawnIds(out: string, f: CityFrame, what: string): Set<string> {
  expect(f.ids, `${what}: the frame's object-ID target is written`).not.toBeNull();
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const png = decodePng(readFileSync(join(out, `${f.ids}.png`)));
  const seen = new Set<string>();
  for (let i = 0; i < png.rgba.length; i += 4) {
    const id = png.rgba[i]! + 256 * png.rgba[i + 1]! + 65536 * png.rgba[i + 2]! + 16777216 * png.rgba[i + 3]!;
    if (id === 0) continue;
    const item = f.picks!.get(id);
    expect(item, `${what}: pick ID ${id} in the ID target is named in picks`).toBeDefined();
    seen.add(item!);
  }
  return seen;
}

// An 8-bit RGBA PNG with no interlace (the object-ID target's format), read with node's zlib.
function decodePng(file: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let color = 0; let depth = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || color !== 6) throw Error(`the ID target is depth ${depth}, color type ${color}; it is an 8-bit RGBA PNG`);
  const raw = inflate(Buffer.concat(data));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0; const b = prev[i]!; const c = i >= 4 ? prev[i - 4]! : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth : NaN;
      if (Number.isNaN(add)) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + add) & 255;
    }
    rgba.set(line, y * stride);
    prev = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// Budgets on the reference Mac: the rule of tests/acceptance/377 and 237. Five fresh runs after a warm-up; PASS
// when all are within the limit, FAIL when all are over it by more than the margin (the larger of 5% and their
// spread), otherwise INCONCLUSIVE. A reading counts only on a reference Mac (Mac15,7 or Mac15,12) with Low Power
// Mode off, a nominal thermal state and the machine not loaded past its core count; anywhere else the measured
// runs are printed and the test is skipped as INCONCLUSIVE with that reason, never passed. Battery or mains alike,
// by the owner's change of October 24 (tests/acceptance/377/README.md).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  return r.stdout.trim();
};
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  const cores = availableParallelism();
  if (one! > cores) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${cores} cores`;
  return null;
}
const marginOf = (runs: number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
const shown = (name: string, runs: number[], limit: number): string => `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(marginOf(runs) * 100).toFixed(0)}%)`;
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const text = shown(name, runs, limit);
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + marginOf(runs))), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
/** A planted program's runs must be judged FAIL: every run over the limit by more than the margin. */
export function expectJudgedFail(name: string, runs: number[], limit: number): void {
  const text = shown(name, runs, limit);
  console.log(text);
  expect(runs.every((r) => r > limit * (1 + marginOf(runs))), `the planted program is judged FAIL: ${text}`).toBe(true);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
