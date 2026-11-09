// Test-side tools for the #505 acceptance tests: the `deep-canvas-render` binary (#373's and #391's JSON-lines
// surface, with #398's vector import, #397's and #167's mark-set rows and counters, and what this suite adds: README,
// The surface under test), and `deep-show run` for the accessibility tree (#376's `see`), each built once per file;
// the documents the tests send; what the binaries answer, read strictly; and the reference math the expected values
// come from (the closed forms, distances to a curve, OKLab from its published formula). Nothing here stands in for the
// canvas: every value a test compares comes from a binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/505 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
/** Every `it` passes this timeout: a first build of a binary on the shared Mac can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #505.968d0296',
  2: 'AC2 #505.32c898a2',
  3: 'AC3 #505.5e6d3319',
  4: 'AC4 #505.00692b98',
  5: 'AC5 #505.91640dd4',
  6: 'AC6 #505.80c4ff9d',
  7: 'AC7 #505.6af13a53',
  8: 'AC8 #505.c8aaffce',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

export const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function near(got: number, want: number, tolerance: number, what: string): void {
  expect(Math.abs(got - want), `${what}: ${got}, want ${want} within ${tolerance}`).toBeLessThanOrEqual(tolerance);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure. */
export function fails(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name, so a later build
// can't change it under a running file; a test that uses a build that failed fails with cargo's error.

const CARGO_ENV: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating/.test(l)).join('\n').slice(0, 4000)}`;
}

function useBuild(name: string, args: string[]): () => string {
  let dir = ''; let error = ''; let path = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-505-bin-`));
    error = cargo(args);
    if (error === '') { path = join(dir, exe(name)); copyFileSync(join(targetDir(), 'debug', exe(name)), path); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe(''); return path; };
}
/** `cargo build --locked --bin deep-canvas-render`, once per file. */
export const useRender = (): (() => string) => useBuild('deep-canvas-render', ['build', '--locked', '--bin', 'deep-canvas-render']);
/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file. */
export const useShow = (): (() => string) => useBuild('deep-show', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full']);

/** One run of `deep-canvas-render <subcommand>`: exit 0, one parsed line out per line in. */
export function lines(bin: string, subcommand: string, inputs: JsonValue[]): JsonObject[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-canvas-render ${subcommand}: ${run.error.message}`);
  expect(run.status, `deep-canvas-render ${subcommand} exits 0: ${run.stderr.slice(0, 2000)}`).toBe(0);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `deep-canvas-render ${subcommand}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `deep-canvas-render ${subcommand}: answer ${i}`));
}

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-505-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The look: #373's role-map form. `a` and `b` are AC7's two ramp roles, named as the issue names them.

export type Rgb = [number, number, number];
export const ROLES: Record<string, Rgb> = {
  ground: [255, 255, 255], ink: [0, 0, 0], muted: [120, 120, 120], accent: [200, 40, 40], fillr: [120, 170, 230],
  a: [0, 0, 255], b: [255, 255, 0],
};
export const LOOK: JsonObject = { light: ROLES as unknown as JsonObject };

// ---------------------------------------------------------------------------------------------------
// Documents: the envelope as #167's suite writes it, with controls (Control) and an input track per request.

export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** A linear scale with its domain as written (`nice: false`), so a position is the plain map. */
export const scale = (id: string, order: string, domain: [number, number], range: [number, number]): JsonObject =>
  item(id, 'scale@1', order, { type: 'linear', domain, range, nice: false });
/** The map a linear scale makes, computed here. */
export const lin = (domain: [number, number], range: [number, number]) => (v: number): number =>
  range[0] + ((v - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);

export function document(id: string, title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description: `${title}, for the #505 acceptance tests.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: '2s' },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}
/** A document slider (Control): its declared range is `range`, its value `value` until an entry. */
export const slider = (label: string, range: [number, number], value: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'slider', class: 'document', label, role: 'slider', range, default: value, ...extra });
/** An input-track entry of yours (Input track: entries): one gesture on `control` at flick `t`. */
export const entry = (t: number, seq: number, control: string, value: number): JsonObject =>
  ({ t, seq, control, value, writer: 'you', serial: seq });
/** A channel keyed linearly from `from` at 0 s to `to` at `span` s. */
export const ramp = (target: string, from: number, to: number, span: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } });
/** A stroke paint. */
export const stroke = (role: string, width = 2): JsonObject => ({ stroke: { role, width } });

// ---------------------------------------------------------------------------------------------------
// The check (README: `check`)

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export interface Checked { ok: boolean; issues: Issue[]; errors: Issue[]; notices: JsonObject[]; raw: JsonObject }
export function checked(raw: JsonObject, what: string): Checked {
  const issues = arr(raw['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity']), ids: arr(o['ids'] ?? [], 'ids').map(String), path: String(o['path'] ?? ''), raw: o };
  });
  const notices = arr(raw['notices'] ?? [], `${what}: notices`).map((v, i) => obj(v, `${what}: notices[${i}]`));
  return { ok: raw['ok'] === true, issues, errors: issues.filter((i) => i.severity === 'error'), notices, raw };
}
export const shownIssues = (c: Checked): string => JSON.stringify(c.issues.map((i) => ({ code: i.code, severity: i.severity, ids: i.ids, path: i.path }))).slice(0, 1500);
export function check(bin: string, doc: JsonObject, what: string, extra: JsonObject = {}): Checked {
  return checked(lines(bin, 'check', [{ doc, look: LOOK, ...extra }])[0]!, `check ${what}`);
}
/** The document passes the check, no error issue. */
export function passes(bin: string, doc: JsonObject, what: string, extra: JsonObject = {}): Checked {
  const c = check(bin, doc, what, extra);
  expect(c.errors.map((e) => `${e.code} [${e.ids.join(',')}] ${e.path}`), `${what} passes the check: ${shownIssues(c)}`).toEqual([]);
  expect(c.ok, `${what}: the check answers ok`).toBe(true);
  return c;
}

// ---------------------------------------------------------------------------------------------------
// The geometry of a function path (README: `geometry`)

export type Pt = [number, number];
export interface Subpath { closed: boolean; points: Pt[] }
export interface Anchor { x: number; y: number; slope: number; at: Pt; foot: Pt }
export interface FnGeometry {
  subpaths: Subpath[];
  notices: JsonObject[];
  anchors: Record<string, Anchor>;
  area: { value: number; lo: number; hi: number } | null;
  fill: Subpath[];
  colorAt: [number, number, number][];
  cells: number | null;
  raw: JsonObject;
}
const pt = (v: JsonValue | undefined, what: string): Pt => {
  const p = arr(v, what);
  return [num(p[0], `${what}[0]`), num(p[1], `${what}[1]`)];
};
function subpathsOf(value: JsonValue | undefined, what: string): Subpath[] {
  return arr(value, what).map((s, i) => {
    const sp = obj(s, `${what}[${i}]`);
    return { closed: sp['closed'] === true, points: arr(sp['points'], `${what}[${i}].points`).map((p, k) => pt(p, `${what}[${i}].points[${k}]`)) };
  });
}
export function fnGeometry(answer: JsonObject, what: string): FnGeometry {
  expect(answer['ok'], `${what}: geometry answers: ${show(answer)}`).toBe(true);
  const anchors: Record<string, Anchor> = {};
  if (answer['anchors'] !== undefined) {
    for (const [name, v] of Object.entries(obj(answer['anchors'], `${what}: anchors`))) {
      const a = obj(v, `${what}: anchors.${name}`);
      anchors[name] = { x: num(a['x'], `${what}: anchors.${name}.x`), y: num(a['y'], `${what}: anchors.${name}.y`), slope: num(a['slope'], `${what}: anchors.${name}.slope`), at: pt(a['at'], `${what}: anchors.${name}.at`), foot: pt(a['foot'], `${what}: anchors.${name}.foot`) };
    }
  }
  let area: FnGeometry['area'] = null;
  if (answer['area'] !== undefined) {
    const a = obj(answer['area'], `${what}: area`);
    area = { value: num(a['value'], `${what}: area.value`), lo: num(a['lo'], `${what}: area.lo`), hi: num(a['hi'], `${what}: area.hi`) };
  }
  return {
    subpaths: subpathsOf(answer['subpaths'], `${what}: subpaths`),
    notices: arr(answer['notices'] ?? [], `${what}: notices`).map((n, i) => obj(n, `${what}: notices[${i}]`)),
    anchors, area,
    fill: answer['fill'] === undefined ? [] : subpathsOf(answer['fill'], `${what}: fill`),
    colorAt: answer['color_at'] === undefined ? [] : arr(answer['color_at'], `${what}: color_at`).map((c, i) => {
      const lab = arr(c, `${what}: color_at[${i}]`);
      return [num(lab[0], 'L'), num(lab[1], 'a'), num(lab[2], 'b')];
    }),
    cells: answer['cells'] === undefined ? null : num(answer['cells'], `${what}: cells`),
    raw: answer,
  };
}
/** `geometry` of one item, one line per request (each `{t, input?, …}`), in order, in one process. */
export function geometry(bin: string, doc: JsonObject, itemId: string, requests: JsonObject[]): JsonObject[] {
  return lines(bin, 'geometry', requests.map((r) => ({ doc, item: itemId, look: LOOK, t: 0, ...r })));
}
export const fnAt = (bin: string, doc: JsonObject, itemId: string, requests: JsonObject[], what: string): FnGeometry[] =>
  geometry(bin, doc, itemId, requests).map((a, i) => fnGeometry(a, `${what} (${i})`));

/** The estimate notices: `code: "estimate"`, naming the item. */
export const estimates = (notices: readonly JsonObject[], itemId: string): JsonObject[] =>
  notices.filter((n) => n['code'] === 'estimate' && arr(n['ids'] ?? [], 'notice ids').includes(itemId));
export const xRangeOf = (n: JsonObject, what: string): [number, number] => pt(n['x_range'], `${what}: x_range`);

// ---------------------------------------------------------------------------------------------------
// Mark-set rows (#167's `rows`, keyed by the row index for a computed set with no key column)

export interface Row { columns: JsonObject; place: { x: number; y: number; x2: number | null; y2: number | null }; oklab: [number, number, number] | null }
export function rowsOf(answer: JsonObject, what: string): Record<string, Row> {
  expect(answer['ok'], `${what}: geometry answers: ${show(answer)}`).toBe(true);
  const rows = obj(answer['rows'], `${what}: rows`);
  return Object.fromEntries(Object.entries(rows).map(([key, v]) => {
    const r = obj(v, `${what}: rows.${key}`);
    const p = obj(r['place'], `${what}: rows.${key}.place`);
    const opt = (k: string): number | null => (p[k] === undefined || p[k] === null ? null : num(p[k], `${what}: rows.${key}.place.${k}`));
    const lab = r['oklab'] === undefined || r['oklab'] === null ? null : arr(r['oklab'], 'oklab').map((c) => num(c, 'oklab')) as [number, number, number];
    return [key, { columns: obj(r['columns'], `${what}: rows.${key}.columns`), place: { x: num(p['x'], 'place.x'), y: num(p['y'], 'place.y'), x2: opt('x2'), y2: opt('y2') }, oklab: lab }];
  }));
}

// ---------------------------------------------------------------------------------------------------
// The raster (#373's `raster`, with #381's `texts`)

export function rasterAt(bin: string, doc: JsonObject, requests: JsonObject[], dir: string, name: string): { out: string; answer: JsonObject }[] {
  const outs = requests.map((_, i) => join(dir, `${name}-${i}.png`));
  const answers = lines(bin, 'raster', requests.map((r, i) => ({ out: outs[i]!, doc, look: LOOK, t: 0, ...r })));
  return answers.map((answer, i) => {
    expect(answer['ok'], `raster ${name} (${i}) draws: ${show(answer)}`).toBe(true);
    return { out: outs[i]!, answer };
  });
}
/** A text's shown string in `raster`'s `texts` (#381). */
export function shownText(answer: JsonObject, id: string, what: string): string {
  const texts = obj(answer['texts'], `${what}: texts`);
  return str(obj(texts[id], `${what}: texts["${id}"]`)['shown'], `${what}: texts["${id}"].shown`);
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393's scenario binary): one scenario, one reply per call. Only AC1's screen reader uses it.

export const DOC_ID = '01JB505D000000000000000001';
export const PANEL = 'main';
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell (pid 3002) writes as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** Puts bytes in a `deep-canvas-render` store (#373's: a folder of files named by their SHA-256) and answers it. */
export function putStore(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  writeFileSync(join(store, sha), bytes);
  return sha;
}
/** Writes bytes into a hub evidence store at their SHA-256 (`<2 hex>/<62 hex>`, the layout `evidence::put` writes). */
export function putEvidence(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(store, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export function runShow(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  // #96's virtual display clock: 60 Hz, latched at the vsync, a check taking no clock time (#376's world).
  const scenario = { evidence, clock: { refresh_hz: 60, lead: 0, check: 0 }, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC_ID]: { panel: 'main' } }, calls };
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-show run: ${run.error.message}`);
  expect(run.status, `deep-show run exits 0; stdout: ${run.stdout.slice(0, 1500)}; stderr: ${run.stderr.slice(-1500)}`).toBe(0);
  const out = obj(JSON.parse(run.stdout.split('\n')[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run refused the scenario: ${show(out)}`).toBe(true);
  return arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Distances, in document u (1 u is 1 px at the zoom the tests draw at)

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** The distance from `p` to the nearest drawn segment of any sub-path (a closed one with its closing segment). */
export function toDrawn(p: Pt, subpaths: readonly Subpath[]): number {
  let best = Infinity;
  for (const s of subpaths) {
    const pts = s.points;
    if (pts.length === 1) best = Math.min(best, dist(p, pts[0]!));
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segmentDistance(p, pts[i - 1]!, pts[i]!));
    if (s.closed && pts.length > 1) best = Math.min(best, segmentDistance(p, pts[pts.length - 1]!, pts[0]!));
  }
  return best;
}
/** The drawn line's y at document x `u` on an x-monotone sub-path (the segment that spans it), or null. */
export function drawnYAt(u: number, subpaths: readonly Subpath[]): number | null {
  for (const s of subpaths) {
    for (let i = 1; i < s.points.length; i++) {
      const [a, b] = [s.points[i - 1]!, s.points[i]!];
      const [lo, hi] = a[0] <= b[0] ? [a, b] : [b, a];
      if (u >= lo[0] && u <= hi[0]) return hi[0] === lo[0] ? (lo[1] + hi[1]) / 2 : lo[1] + ((u - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]);
    }
  }
  return null;
}
/** Whether a sub-path closes: marked closed, or ending where it starts. */
export const closes = (s: Subpath): boolean => s.closed || (s.points.length > 2 && dist(s.points[0]!, s.points[s.points.length - 1]!) <= 0.01);
export const allPoints = (subpaths: readonly Subpath[]): Pt[] => subpaths.flatMap((s) => s.points);
export const pointCount = (subpaths: readonly Subpath[]): number => subpaths.reduce((n, s) => n + s.points.length, 0);

/**
 * The distance in u from a point of the plane (in u) to the zero set of F, mapped through the scales: Newton steps
 * along F's gradient from the point, in the function's units, then the distance between the point and the root in u.
 * The test's own reference for "within 0.5 px of the curve" for an implicit fn.
 */
export function toZeroSet(p: Pt, F: (x: number, y: number) => number, toU: (x: number, y: number) => Pt, fromU: (u: Pt) => [number, number]): number {
  let [x, y] = fromU(p);
  for (let k = 0; k < 60; k++) {
    const f = F(x, y);
    const h = 1e-7;
    const gx = (F(x + h, y) - F(x - h, y)) / (2 * h);
    const gy = (F(x, y + h) - F(x, y - h)) / (2 * h);
    const g2 = gx * gx + gy * gy;
    if (g2 === 0) break;
    x -= (f * gx) / g2; y -= (f * gy) / g2;
    if (Math.abs(f) < 1e-14) break;
  }
  return Math.abs(F(x, y)) > 1e-9 ? Infinity : dist(p, toU(x, y));
}

// ---------------------------------------------------------------------------------------------------
// Seeded numbers (mulberry32), so a failing run replays.

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
/** `n` seeded numbers in [lo, hi). */
export function seededIn(seed: number, n: number, lo: number, hi: number): number[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, () => lo + (hi - lo) * rand());
}

// ---------------------------------------------------------------------------------------------------
// Pictures (PNG reading as #397's and #167's suites, written from the PNG specification)

export interface Image { width: number; height: number; rgba: Uint8Array }
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export function readPng(path: string): Image {
  const file = readFileSync(path);
  let width = 0; let height = 0; let color = 0; let depth = 0; let interlace = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
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
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
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
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export const same = (a: Rgb, b: Rgb): boolean => a.every((v, i) => v === b[i]);
export const codeDiff = (a: Rgb, b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
/** Pixels in the box [x0, x1) × [y0, y1) that differ from `c`. */
export function countOff(image: Image, [x0, y0, x1, y1]: [number, number, number, number], c: Rgb): number {
  let n = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) if (!same(pixel(image, x, y), c)) n++;
  return n;
}

/** An animated PNG from same-sized PNG frames, each shown `delayMs` (the APNG specification). The frames stay the canvas's bytes. */
export function apng(frames: Buffer[], delayMs: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const chunk = (type: string, body: Buffer): Buffer => { const t = Buffer.concat([Buffer.from(type, 'latin1'), body]); return Buffer.concat([u32(body.length), t, u32(crc(t))]); };
  const chunks = (png: Buffer): { type: string; body: Buffer }[] => {
    const out: { type: string; body: Buffer }[] = [];
    for (let at = 8; at < png.length;) { const n = png.readUInt32BE(at); out.push({ type: png.toString('latin1', at + 4, at + 8), body: png.subarray(at + 8, at + 8 + n) }); at += 12 + n; }
    return out;
  };
  const ihdr = chunks(frames[0]!).find((c) => c.type === 'IHDR')!.body;
  const parts: Buffer[] = [frames[0]!.subarray(0, 8), chunk('IHDR', ihdr), chunk('acTL', Buffer.concat([u32(frames.length), u32(0)]))];
  let seq = 0;
  frames.forEach((png, f) => {
    const delay = Buffer.alloc(4); delay.writeUInt16BE(delayMs, 0); delay.writeUInt16BE(1000, 2);
    parts.push(chunk('fcTL', Buffer.concat([u32(seq++), ihdr.subarray(0, 8), u32(0), u32(0), delay, Buffer.from([0, 0])])));
    for (const c of chunks(png)) {
      if (c.type !== 'IDAT') continue;
      parts.push(f === 0 ? chunk('IDAT', c.body) : chunk('fdAT', Buffer.concat([u32(seq++), c.body])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// Color, in f64 from published formulas: the sRGB transfer function (IEC 61966-2-1) and OKLab (Björn Ottosson, 2020).

export type Lab = [number, number, number];
const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toEncoded = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export function oklab([r8, g8, b8]: Rgb): Lab {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** An OKLab color in gamut as sRGB code values, before 8-bit rounding. */
export function srgb255([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return linear.map((v) => 255 * toEncoded(Math.max(0, Math.min(1, v)))) as [number, number, number];
}
export const deltaEok = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const midpoint = (a: Lab, b: Lab): Lab => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
