// Test-side tools for the #233 acceptance tests (README: The surface under test). They drive the binaries as the
// sibling suites do: `deep-show run` (#393: `deep show`, `eval`, `install_pack`, `deep_kinds`, the scenario's `packs`
// and `planted`), `deep-canvas-render geometry` (#167, #221: an item's drawn sub-paths, its box and an axis's ticks),
// `deep-motion eval` (#391: a channel's value at given times) and `deep-gpu run`'s `frame_budget` (#1899). Copied in
// part from #142's, #222's, #226's and #490's helpers, since suites never import each other. Nothing here stands in
// for the pack, the expansion or the evaluation: every value a test judges comes from a binary, and every expected
// value from the issue, the design's stated conversions or the upstream equations (reference.ts).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type P2 = [number, number];
export type Box = [number, number, number, number];

export const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/233 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  PATH: `/opt/homebrew/opt/rustup/bin:${process.env['PATH'] ?? ''}`,
};
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;
export const FLICKS = 705_600_000;

/** Each criterion's ID: `#233.` and the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed
 * (scripts/proof-change.mjs `criterionId`). */
export const AC = {
  1: 'AC1 #233.b6a28e06', 2: 'AC2 #233.3d899ebc', 3: 'AC3 #233.1d713f1c', 4: 'AC4 #233.ca1d4667', 5: 'AC5 #233.a6357ff6',
  6: 'AC6 #233.8747d6f5', 7: 'AC7 #233.a838a9eb', 8: 'AC8 #233.1fb6242f', 9: 'AC9 #233.5c072eb1', 10: 'AC10 #233.1cae712c',
  11: 'AC11 #233.f4f81b7b', 12: 'AC12 #233.d8298507', 13: 'AC13 #233.2163815c',
} as const;
/** The bare ID (`#233.xxxxxxxx`) of criterion n. */
export const idOf = (n: keyof typeof AC): string => AC[n].split(' ')[1]!;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
/** Whether `v`'s JSON text holds `text` anywhere (an issue naming a word, a parameter or a recipe). */
export const mentions = (v: JsonValue | undefined, text: string): boolean => (JSON.stringify(v) ?? '').includes(text);
/** No failures; the message lists the first of them and how many there are. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.length} failures:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose input must come from outside this checkout fails with this until it exists. */
export function blocked(reason: string, unblock: string): never {
  return expect.fail(`BLOCKED: ${reason}\nUnblock: ${unblock}`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const fl = (s: number): number => Math.round(s * FLICKS);

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name; a test that uses a
// build that failed fails with cargo's error.

export type Bin = 'deep-show' | 'deep-canvas-render' | 'deep-motion' | 'deep-gpu';
const CARGO: Record<Bin, string[]> = {
  'deep-show': ['--bin', 'deep-show', '--no-default-features', '--features', 'full'],
  'deep-canvas-render': ['--bin', 'deep-canvas-render'],
  'deep-motion': ['--bin', 'deep-motion'],
  'deep-gpu': ['--bin', 'deep-gpu'],
};
const exeOf = (bin: Bin): string => (bin === 'deep-canvas-render' ? 'deep-canvas-render' : bin);
const cargoArgs = (bin: Bin, release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), ...CARGO[bin]];
/** Builds `bin` (debug, or release) and copies it into `dir`: its path, or cargo's error. */
export function buildInto(bin: Bin, release: boolean, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin, release);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, `${bin}${release ? '-release' : ''}`);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', exeOf(bin)), path);
  return { path, error: '' };
}
/** Builds the debug `bins` once, in order, before the file's tests. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-233-bin-'));
    for (const b of bins) made.set(b, buildInto(b, false, dir));
  }, 4 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin, false).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** Fresh folders for a test, all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-233-')); made.push(d); return d; };
}

interface Started { status: number | null; signal: string | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], input: string): Started {
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${bin} ${args.join(' ')} did not finish within 3,000 s`);
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, stdout, stderr: r.stderr ?? '', lines };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393). The answer is returned whole, so a test asserts
// in its own file that the scenario was accepted (an unknown `planted` value is refused at the base).

export interface Pack { id: string; version: string; dir: string }
export const packAt = (p: Pack): string => `${p.id}@${p.version}`;
/** The first-party pack under test (README: The pack): folder packs/math-1.0.0, installed as deepbuild/math@1.0.0. */
export const MATH: Pack = { id: 'deepbuild/math', version: '1.0.0', dir: join(REPO, 'packs', 'math-1.0.0') };
/** The first-party cue verbs (#222), which math@1's animation words map to; offered beside it. */
export const VERBS: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const MATH_AT = packAt(MATH);
export const OFFERED: readonly Pack[] = [MATH, VERBS];

/** The wrong programs this suite plants (README: The planted programs), each reachable only through the scenario's
 * `planted`. */
export type Planted = 'math_axes_ticks_as_marks' | 'math_keeps_y_up' | 'math_number_line_drops_excluded' | 'math_expands_each_frame';

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: math films', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const docId = (n: number): string => `01JB233D${String(n).padStart(18, '0')}`;

export interface Extra { packs?: readonly Pack[]; planted?: Planted }
/** A scenario: your shell's process tree, alpha's session, one 1920 × 1080 panel, every document a call names, the
 * packs offered before the first call (math@1 and the verbs by default) and the scenario's planted program. */
export function scenario(evidence: string, calls: JsonObject[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  const packs = extra.packs ?? OFFERED;
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    ...(packs.length ? { packs: packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}
export interface Answer { ok: boolean; replies: JsonObject[]; why: string }
/** One `deep-show run` process: whether it accepted the scenario, and its replies, one per call. */
export function run(bin: string, sc: JsonObject): Answer {
  const r = start(bin, ['run'], `${JSON.stringify(sc)}\n`);
  const head = `deep-show run exited ${r.status} (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-2000)}`;
  const a = r.lines[0];
  if (r.status !== 0 || !isObject(a) || a['ok'] !== true || !Array.isArray(a['replies'])) return { ok: false, replies: [], why: head };
  const replies = a['replies'].filter(isObject);
  const calls = Array.isArray(sc['calls']) ? sc['calls'].length : 0;
  return replies.length === calls ? { ok: true, replies, why: '' } : { ok: false, replies, why: `${replies.length} replies for ${calls} calls: ${head}` };
}
/** `deep show` of a whole document from your shell, with the parts of the reply `include` names. */
export const present = (doc: string, document: JsonObject, include: string[] = ['issues']): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document, include });
/** The reply's error issues. */
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** Why a `deep show` reply isn't a presentation with no error and nothing skipped, or '' when it is one. */
export function notPresented(reply: JsonObject | undefined): string {
  if (!reply) return 'no reply';
  if (reply['outcome'] !== 'presented') return `the outcome is ${brief(reply['outcome'] ?? null)}: ${brief(reply, 2500)}`;
  const e = errors(reply);
  if (e.length) return `it raises errors: ${brief(e as JsonValue, 2500)}`;
  // A pack this build lacks, or a kind it doesn't know, is presented with its instances skipped when drawing.
  const skipped = (Array.isArray(reply['notices']) ? reply['notices'] : []).filter(isObject).filter((n) => n['code'] === 'pack_missing' || n['code'] === 'unknown_kind');
  return skipped.length ? `instances are skipped when drawing: ${brief(skipped as JsonValue, 2500)}` : '';
}
/** `deep_kinds`' `word` op (#412). */
export const word = (w: string): JsonObject => ({ call: 'deep_kinds', op: 'word', word: w });
/** #387's `eval` at `t` flicks; with `pixels`, the canonical snapshot at `size` px. */
export const evalAt = (doc: string, t: number, o: { pixels?: boolean; size?: P2 } = {}): JsonObject =>
  ({ call: 'eval', doc, t, ...(o.pixels ? { pixels: true } : {}), ...(o.size ? { size: o.size } : {}) });

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents): figures as your shell sends them, each item a math@1 word's recipe kind
// `math.<word>@1` with the upstream parameter names, or a core kind.

export interface Spec { kind: string; params?: JsonObject; at?: JsonObject; [k: string]: JsonValue | undefined }
/** A figure of `size` u (1 u = 1 px at 1x) naming math@1 in `packs`, holding `items` in order. */
export function mathDoc(title: string, size: P2, items: Record<string, Spec>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  Object.entries(items).forEach(([id, s], i) => {
    const { kind, params, ...rest } = s;
    out[id] = { id, kind, name: id, order: `a${String(i).padStart(2, '0')}`, params: params ?? {}, ...(rest as JsonObject) };
  });
  // A document holding vector@1 items names the module they are (#505's documents do).
  const vectors = Object.values(items).some((s) => s.kind === 'vector@1');
  return {
    format: 1, profile: 'figure', title, description: `${title}: a fixture of the #233 acceptance suite.`, size,
    transport: { span: '1s' }, ...(vectors ? { requires: { modules: { marks2d: '^1', vector: '^1' } } } : {}), packs: [MATH_AT], items: out, ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// The expansion (README: Reading the expansion), off the `deep show` reply's `expansions` (#306, #420, #222).

export interface Row { instance: string; kind: string; derived: Record<string, JsonObject>; raw: JsonObject }
/** Every expansion row of the reply. */
export function rowsOf(reply: JsonObject): Row[] {
  const all = Array.isArray(reply['expansions']) ? reply['expansions'].filter(isObject) : [];
  return all.map((r) => ({
    instance: String(r['instance'] ?? ''), kind: String(r['kind'] ?? ''), raw: r,
    derived: isObject(r['derived']) ? Object.fromEntries(Object.entries(r['derived']).filter(([, v]) => isObject(v))) as Record<string, JsonObject> : {},
  }));
}
/** The derived items of `instance` and of every instance nested under it (`<instance>.…`), by ID. */
export function derivedOf(reply: JsonObject, instance: string): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};
  for (const r of rowsOf(reply)) if (r.instance === instance || r.instance.startsWith(`${instance}.`)) Object.assign(out, r.derived);
  return out;
}
const ROW_FIXED = new Set(['instance', 'kind', 'pack', 'key', 'derived', 'seeds', 'broken_out', 'channels']);
/**
 * The document as it draws, for `deep-canvas-render`, which expands no pack: each expanded instance replaced by its
 * derived items, each expansion's channels and sections (markers, placements and the rest) merged into the
 * document's, every item put on one layer `main`, and `packs` dropped, since nothing of a pack is left in it.
 */
export function drawnForm(document: JsonObject, reply: JsonObject, id = 'drawn-233'): JsonObject {
  const doc = JSON.parse(JSON.stringify(document)) as JsonObject;
  const items = { ...(isObject(doc['items']) ? doc['items'] : {}) } as JsonObject;
  const channels = { ...(isObject(doc['channels']) ? doc['channels'] : {}) } as JsonObject;
  for (const r of rowsOf(reply)) {
    delete items[r.instance];
    for (const [k, v] of Object.entries(r.derived)) items[k] = { ...v, id: k };
    if (isObject(r.raw['channels'])) Object.assign(channels, r.raw['channels']);
    for (const [section, entries] of Object.entries(r.raw)) {
      if (ROW_FIXED.has(section) || !isObject(entries)) continue;
      doc[section] = { ...(isObject(doc[section]) ? doc[section] as JsonObject : {}), ...entries };
    }
  }
  for (const [k, v] of Object.entries(items)) if (isObject(v)) items[k] = { ...v, layer: 'main', ...(typeof v['name'] === 'string' ? {} : { name: k }), ...(typeof v['order'] === 'string' ? {} : { order: 'z0' }) };
  delete doc['packs'];
  return { ...doc, id, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items, ...(Object.keys(channels).length ? { channels } : {}) };
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render geometry` (#167, #221): an item's drawn sub-paths, its box and nine box points, an axis's
// ticks, at t; one answer line per input line.

export function geometry(bin: string, inputs: JsonObject[]): JsonObject[] {
  if (!inputs.length) return [];
  const r = start(bin, ['geometry'], `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`);
  expect(r.status, `deep-canvas-render geometry exits 0: ${r.stderr.slice(0, 2000)}`).toBe(0);
  expect(r.lines.length, 'deep-canvas-render geometry: one answer per input').toBe(inputs.length);
  return r.lines.map((l, i) => obj(l, `deep-canvas-render geometry: answer ${i}`));
}
/** Every derived item's geometry at `t` in the drawn form, by ID; `store` holds the vectors' sources. */
export function geometryOfAll(bin: string, drawn: JsonObject, ids: string[], t = 0, store?: string): Record<string, JsonObject> {
  const answers = geometry(bin, ids.map((item) => ({ doc: drawn, item, t, ...(store ? { store } : {}) })));
  return Object.fromEntries(ids.map((id, i) => [id, answers[i]!]));
}

export interface Sub { verbs: string[]; points: P2[]; closed: boolean }
/** An answer's drawn sub-paths (#373's form: `{closed, verbs, points}`), or none. */
export function subpathsOf(answer: JsonObject): Sub[] {
  const list = Array.isArray(answer['subpaths']) ? answer['subpaths'] : [];
  const out: Sub[] = [];
  for (const s of list) {
    if (!isObject(s) || !Array.isArray(s['points'])) continue;
    const points = s['points'].filter((p): p is number[] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map((p) => [p[0]!, p[1]!] as P2);
    out.push({ verbs: Array.isArray(s['verbs']) ? s['verbs'].map(String) : [], points, closed: s['closed'] === true });
  }
  return out;
}
/** The points of a sub-path that lie on the drawn curve: every move and line end, and each curve's end point (not
 * its control points). */
export function onCurve(s: Sub): P2[] {
  const out: P2[] = [];
  let k = 0;
  for (const v of s.verbs) {
    const n = v === 'C' ? 3 : v === 'Q' ? 2 : v === 'Z' ? 0 : 1;
    if (n > 0) out.push(s.points[k + n - 1]!);
    k += n;
  }
  return out.length ? out : s.points;
}
/** An answer's box `[x, y, w, h]` in u (#221), or null. */
export function boxOf(answer: JsonObject): Box | null {
  const b = answer['box'];
  return Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number') ? (b as number[]) as Box : null;
}
export const centre = (b: Box): P2 => [b[0] + b[2] / 2, b[1] + b[3] / 2];
/** The box of a set of points. */
export function bounds(points: P2[]): Box {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}
/** Whether a sub-path is one straight open segment (its on-curve points on one line within 0.01 u): its two ends. */
export function segment(s: Sub): [P2, P2] | null {
  if (s.closed) return null;
  if (s.verbs.some((v) => v === 'C' || v === 'Q')) return null;
  const pts = s.points;
  if (pts.length < 2) return null;
  const a = pts[0]!; const b = pts[pts.length - 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return null;
  const off = (p: P2): number => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
  return pts.every((p) => off(p) <= 0.01) ? [a, b] : null;
}
/** The text an item draws: a text@1's `params.text`, or a vector@1's `params.alt` (#398's accessible text). */
export function textOf(item: JsonObject): string | null {
  const p = isObject(item['params']) ? item['params'] : {};
  if (typeof p['text'] === 'string') return p['text'];
  if (typeof p['alt'] === 'string') return p['alt'];
  return null;
}
export const isLabelKind = (item: JsonObject): boolean => item['kind'] === 'text@1' || item['kind'] === 'vector@1';
/** The ticks an axis@1's geometry answer holds (#167): `{value, opacity}`. */
export function ticksOf(answer: JsonObject): { value: number; opacity: number }[] {
  return (Array.isArray(answer['ticks']) ? answer['ticks'] : []).filter(isObject).filter((t) => typeof t['value'] === 'number' && typeof t['opacity'] === 'number')
    .map((t) => ({ value: t['value'] as number, opacity: t['opacity'] as number }));
}
/**
 * The tick marks an axis draws (README: Reading the drawing): its short straight sub-paths (at most 60 u) across its
 * line, each at its place along the axis, sorted along it; `horizontal` for an x axis.
 */
export function tickMarks(answer: JsonObject, horizontal: boolean): number[] {
  const out: number[] = [];
  for (const s of subpathsOf(answer)) {
    const g = segment(s);
    if (!g) continue;
    const [a, b] = g;
    const along = horizontal ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
    const across = horizontal ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
    if (along <= 0.01 && across > 0 && across <= 60) out.push(horizontal ? (a[0] + b[0]) / 2 : (a[1] + b[1]) / 2);
  }
  return out.sort((x, y) => x - y);
}

// ---------------------------------------------------------------------------------------------------
// The stated conversions (Pack: math@1, Conversions, stated): a math@1 unit is the frame's short side ÷ 8 in u; y
// flips and the origin moves to the frame's centre.

export const unitOf = (size: P2): number => Math.min(size[0], size[1]) / 8;
/** A point in math@1 units to u on a frame of `size`. */
export const toU = (size: P2, [x, y]: P2): P2 => [size[0] / 2 + x * unitOf(size), size[1] / 2 - y * unitOf(size)];

// ---------------------------------------------------------------------------------------------------
// `deep-motion eval` (#391's JSON-lines convention, as #490's suite drives it)

/** `deep-motion eval` on one line `{doc, times}`: the channel `id`'s value at each time, or why there is none. */
export function channelValues(bin: string, doc: JsonObject, times: number[], id: string): number[] | string {
  const s = start(bin, ['eval'], JSON.stringify({ doc, times }) + '\n');
  if (s.status !== 0) return `deep-motion eval exited ${s.status} (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-800)}`;
  const a = s.lines[0];
  if (!isObject(a) || a['ok'] !== true || !Array.isArray(a['frames'])) return `the document is not accepted: ${s.stdout.slice(0, 800)}`;
  if (a['frames'].length !== times.length) return `${a['frames'].length} frames for ${times.length} times`;
  const out: number[] = [];
  for (const f of a['frames']) {
    const c = isObject(f) && isObject(f['channels']) ? f['channels'][id] : undefined;
    const v = isObject(c) ? c['value'] : undefined;
    const n = Array.isArray(v) && v.length === 1 ? v[0] : v;
    if (typeof n !== 'number') return `a frame has no number at channels.${id}.value: ${brief(f, 400)}`;
    out.push(n);
  }
  return out;
}
/** A one-item film for deep-motion with one f32 channel `c` on the item's x scale (#490's shape). */
export function motionDoc(channel: JsonObject): JsonObject {
  return {
    format: 1, id: 'rate-233', profile: 'film', title: '#233 rate function', description: 'A #233 acceptance fixture: one channel.', size: [640, 360],
    transport: { span: '3s' },
    items: { sq: { id: 'sq', kind: 'rect@1', name: 'Square', order: 'a0', params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [100, 100, 0] } } },
    channels: { c: { target: 'items/sq/at/scale/0', type: 'f32', ...channel } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Budgets: the perf lane's rule, scripts/benchmark.mjs's judgeLimit and validateBudgets, imported, never copied; and
// `deep-gpu run` (#377's binary) for #1899's frame budget.

export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  (await bench()).validateBudgets(current, base);
}
/** One `deep-gpu run` scenario `{out, calls}`: its replies, one per call. */
export function runGpu(bin: string, calls: JsonObject[], what: string): JsonObject[] {
  const out = mkdtempSync(join(tmpdir(), 'deep-233-gpu-'));
  try {
    const s = start(bin, ['run'], `${JSON.stringify({ out, calls })}\n`);
    expect(s.status, `deep-gpu run (${what}) exited 0; stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
    const a = obj(s.lines[0], `deep-gpu run (${what}): the answer`);
    expect(a['ok'], `deep-gpu run (${what}) accepted the scenario: ${brief(a, 2000)}`).toBe(true);
    return arr(a['replies'], `deep-gpu run (${what}): replies`).map((r, i) => obj(r, `deep-gpu run (${what}): replies[${i}]`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
/** A shipped look's definition (crates/deep-canvas-marks/looks/<id>.json). */
export function shippedLook(id: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', `${id}.json`), 'utf8')) as JsonValue, `the look ${id}`);
}

// ---------------------------------------------------------------------------------------------------
// Pack folders: copies of math@1 with one change, and this suite's own test packs (fixtures/packs).

/** A copy of the math@1 folder with its manifest changed by `change`, under `root`. */
export function mathCopy(root: string, change: (manifest: JsonObject) => void): Pack {
  const dir = join(root, 'math-1.0.0');
  cpSync(MATH.dir, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as JsonObject;
  change(manifest);
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...MATH, dir };
}
/** math@1's manifest as shipped, or null when the folder has none. */
export function mathManifest(): JsonObject | null {
  const p = join(MATH.dir, 'pack.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as JsonObject : null;
}
/** One of this suite's test packs (fixtures/packs/<name>-1.0.0) as shipped, or copied under `root` with its manifest's
 * `aliases` changed by `change`. */
export function testPack(name: string, root?: string, change?: (aliases: JsonObject) => void): Pack {
  const src = join(HERE, 'fixtures', 'packs', `${name}-1.0.0`);
  const p: Pack = { id: `test233/${name}`, version: '1.0.0', dir: src };
  if (!root || !change) return p;
  const dir = join(root, `${name}-1.0.0`);
  mkdirSync(root, { recursive: true });
  cpSync(src, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as JsonObject;
  change(manifest['aliases'] as JsonObject);
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...p, dir };
}
export const install = (p: Pack): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });

// ---------------------------------------------------------------------------------------------------
// Vector sources: an SVG of one filled rectangle, put in an evidence store (`<2 hex>/<62 hex>`, what the hub reads a
// vector's `src` from) and in a flat store (`<sha256>`, what deep-canvas-render's `store` reads).

export function rectSvg(w: number, h: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect id="r" x="0" y="0" width="${w}" height="${h}" fill="currentColor"/></svg>`);
}
export function putSources(evidence: string, store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, sha), bytes);
  return sha;
}
/** A vector@1 item drawing the SVG `src` of `size` u, at `pos`. */
export const vectorItem = (src: string, size: P2, alt: string, pos: P2 = [0, 0]): Spec =>
  ({ kind: 'vector@1', params: { src, size, colors: { currentColor: 'ink' }, alt }, at: { pos: [pos[0], pos[1], 0] } });
