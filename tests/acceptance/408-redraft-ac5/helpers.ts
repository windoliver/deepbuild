// Test-side tools for the redraft of #408's criterion 5: `deep-show` built with cargo on this Mac (debug, and release
// for the timing) and for Linux x86_64 in Docker, driven by JSON lines (#393's `deep-show run`, with #403's claims,
// requirements and `verdict`); the five films criterion 5 judges, generated here exactly as tests/acceptance/408/
// generates them (commit 5062d254), so the documents are the same; reading film.layout's rows off the verdicts; and
// the perf lane's judgeLimit. Nothing here stands in for film.layout or the evaluation: every value a test compares
// comes from a binary, every expected value from the issue's text and the design. Copied from 5062d254's
// tests/acceptance/408/helpers.ts, since suites don't import each other; only the Linux section is new (README: Why a
// redraft).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/408-redraft-ac5 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** An hour: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Criterion 5's ID: `#408.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC5 = '#408.5416e245';

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** JSON with every object's keys sorted, so two results compare by content. */
export function canonical(v: JsonValue | undefined): string {
  const sort = (x: JsonValue): JsonValue => Array.isArray(x) ? x.map(sort)
    : isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k]!)])) : x;
  return JSON.stringify(v === undefined ? null : sort(v));
}

// ---------------------------------------------------------------------------------------------------
// Time: replies carry times as integer flicks (Time and the flick), or as the time grammar's "<n>s".

const FLICKS = 705_600_000;
/** A time value in seconds: an integer is flicks, a string `<n>s` is seconds; anything else is null. */
function secondsOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v / FLICKS;
  const m = typeof v === 'string' ? /^(-?\d+(?:\.\d+)?)s$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : null;
}
/** A list of times in seconds, ascending as given; null when it isn't a list of times. */
function timesOf(v: JsonValue | undefined): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(secondsOf);
  return out.every((t): t is number => t !== null) ? out : null;
}
const sameTime = (a: number | null, s: number): boolean => a !== null && Math.abs(a - s) < 1e-6;

// ---------------------------------------------------------------------------------------------------
// Builds on this Mac: `deep-show` per Cargo feature set, copied out of target/ under its own name.

/** A feature set, debug unless `release`. */
export interface Build { features: string[]; release?: boolean }
export const FULL: Build = { features: ['full'] };
export const RELEASE: Build = { features: ['full'], release: true };
const nameOf = (b: Build): string => `${b.features.join('+')}${b.release ? '-release' : ''}`;
const cargoArgs = (b: Build): string[] =>
  ['build', '--locked', ...(b.release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', b.features.join(',')];

/** Builds `b` and copies the binary into `dir`: the binary, or cargo's error. */
export function buildInto(b: Build, dir: string): { bin: string; error: string } {
  const args = cargoArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-${nameOf(b).replace(/[^a-z0-9+.-]/g, '_')}`);
  copyFileSync(join(TARGET, b.release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '' };
}

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-408r5-bins-'));
    for (const b of builds) if (!made.has(nameOf(b))) made.set(nameOf(b), buildInto(b, dir));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b: Build): string => {
    const entry = made.get(nameOf(b));
    if (!entry) throw Error(`the file didn't list the build ${nameOf(b)} in useBuilds`);
    expect(entry.error, `the binary builds: cargo ${cargoArgs(b).join(' ')}`).toBe('');
    return entry.bin;
  };
}

/** Fresh folders for a test (evidence stores, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-408r5-')); made.push(d); return d; };
}

/** Puts bytes into an evidence store at their SHA-256, as the hub keeps them, and returns the hash. */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

interface Started { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
function answerOf(s: Started, calls: number, name: string): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  const lines = s.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(out['ok'], `${name} refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}
/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  return answerOf({ status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }, arr(scenario['calls'], 'the calls').length, `${SHOW} run`);
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the claim's agent, the process table, one panel the size of the films.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: films', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1920, 1080] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB408D', n);
const claimId = (n: number): string => `claim:${ulid('01JB408C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB408Q', n)}`;

/** A film a test judges: a name for messages, its document ID and the document, stored as revision 0. */
export interface Film { name: string; doc: string; document: JsonObject }

/**
 * The scenario: each film stored on the panel (`docs[…].document`, opened as revision 0) and named by one claim of
 * alpha's whose one requirement is the check input `{kind: "film.layout"}`; the calls are one `verdict` per claim in
 * the films' order.
 */
export function scenarioOf(evidence: string, films: readonly Film[]): JsonObject {
  const docs: JsonObject = {};
  const claims: JsonObject = {};
  films.forEach((f, i) => {
    docs[f.doc] = { panel: 'main', document: f.document };
    claims[claimId(i + 1)] = { session: ALPHA.id, deliverables: [f.doc], requirements: [{ id: reqId(i + 1), check: { kind: 'film.layout' } }] };
  });
  const calls: JsonObject[] = films.map((_, i) => ({ call: 'verdict', claim: claimId(i + 1) }));
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, calls };
}

/** One issue on a requirement's row. */
export interface Issue { code: string; severity: string; raw: JsonObject }
/** film.layout's requirement row in a verdict (#403's row, README: The surface under test). */
export interface Row { result: string; issues: Issue[]; raw: JsonObject }
function rowOf(verdict: JsonObject, id: string, what: string): Row | undefined {
  const rows = Array.isArray(verdict['requirements']) ? verdict['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === id);
  if (!raw) return undefined;
  const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });
  return { result: String(raw['result']), issues, raw };
}
/** The rows of a scenario's verdicts, by film name. */
export function rowsOf(replies: readonly JsonObject[], films: readonly Film[]): Record<string, Row | undefined> {
  const out: Record<string, Row | undefined> = {};
  films.forEach((f, i) => { out[f.name] = rowOf(obj(replies[i], `the verdict on ${f.name}`), reqId(i + 1), `film.layout on ${f.name}`); });
  return out;
}
/** Judges each film on this machine: the verdicts' rows by film name. */
export function judge(bin: string, evidence: string, films: readonly Film[]): Record<string, Row | undefined> {
  return rowsOf(run(bin, scenarioOf(evidence, films)), films);
}

/** A code's field: on the issue itself, else in its `actual`. */
function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: The films). Every film is 1920 × 1080 u with the default safe area, stored with one layer of
// yours; 1 u is 1 px at 1080p. Byte for byte the documents 5062d254's helpers make.

const SIZE: [number, number] = [1920, 1080];
const SAFE = 24;
const LAYER = 'you-main';
const order = (i: number): string => `a${String(i).padStart(4, '0')}`;
const pos = (x: number, y: number): JsonObject => ({ pos: [x, y, 0] });
const seconds = (s: number): string => `${s}s`;

/** A film: the items in their draw order, its cue and hold markers, and its other maps. */
function film(doc: string, title: string, items: JsonObject[], o: { span: number; markers: JsonObject; channels?: JsonObject; modules?: string[] }): JsonObject {
  const modules = o.modules ?? [];
  return {
    format: 1, id: doc, profile: 'film', title, description: `${title}: a film the #408 acceptance tests judge with film.layout.`,
    size: SIZE, safe: SAFE, transport: { span: seconds(o.span) },
    ...(modules.length ? { requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) } } : {}),
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: LAYER }])),
    markers: o.markers,
    ...(o.channels ? { channels: o.channels } : {}),
  };
}
/** Markers `[id, kind, start s, span s]`: each one's end, start + span, is a cue end (Film layout: `at: cues`). */
function markers(list: [string, 'cue' | 'hold', number, number][]): JsonObject {
  return Object.fromEntries(list.map(([id, kind, t, span]) => [id, { kind, name: `${kind} ${id}`, t: seconds(t), span: seconds(span) }]));
}
/** A vec3 channel on `target` whose keys hold: each value from its time until the next key's. */
function holdChannel(target: string, keys: [number, number[]][]): JsonObject {
  return { target, type: 'vec3', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: seconds(t), value, interp: 'hold' }])) };
}
function textItem(id: string, words: string, at: [number, number], box: { w: number; h: number }, size: number, k: number, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'text@1', name: `Text ${id}`, order: order(k), params: { text: words, font: 'body', size, box, align: 'center', ...extra }, at: pos(at[0], at[1]) };
}
function rectItem(id: string, box: [number, number, number, number], k: number): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role: 'ink' } } } };
}
function vectorItem(id: string, src: string, size: [number, number], at: [number, number], alt: string, k: number): JsonObject {
  return { id, kind: 'vector@1', name: `Formula ${id}`, order: order(k), params: { src, size, colors: { '#000000': 'ink' }, alt }, at: pos(at[0], at[1]) };
}
function pathItem(id: string, d: string, width: number, k: number): JsonObject {
  return { id, kind: 'path@1', name: `Path ${id}`, order: order(k), params: { d, paint: { stroke: { role: 'ink', width } } } };
}
/** An SVG of `w` × `h` u holding one filled part `part` that fills its viewBox, so the part's box is the item's. */
export function blockSvg(w: number, h: number, part: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n  <path id="${part}" d="M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z" fill="#000000"/>\n</svg>\n`);
}

// ---- Criterion 1's film: an axis line through a label from 2.0 s to 3.5 s

const AXIS = 'x-axis';
const SCALE = 'x-scale';
export const LABEL = 'speed-label';
/** Cue ends 1, 2, 2.5 (a hold's), 3.5 and 4.5 s. */
const CROSS_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1], ['h1', 'hold', 2, 0.5], ['c3', 'cue', 2.5, 1], ['c4', 'cue', 3.5, 1]]);
const scaleItem = (range: [number, number], k: number): JsonObject =>
  ({ id: SCALE, kind: 'scale@1', name: 'X scale', order: order(k), params: { domain: [0, 1], range, nice: false } });
const axisItem = (y: number, k: number): JsonObject =>
  ({ id: AXIS, kind: 'axis@1', name: 'X axis', order: order(k), params: { scale: SCALE, side: 'bottom' }, at: pos(0, y) });
/** The text@1 label "Speed", 32 u, centred in its 240 × 42 box at (616, 500), with no halo. */
export const speedLabel = (): JsonObject => textItem(LABEL, 'Speed', [496, 479], { w: 240, h: 42 }, 32, 2);
/**
 * The axis@1 `x-axis` along y = 900 (its scale maps [0, 1] to x 100 to 1820), drawn first, and `label` over it; a
 * hold-keyed channel moves the axis's line to y = 500, through the label's middle, at 2.0 s and back at 3.75 s.
 */
export function crossingFilm(doc: string, label: JsonObject): JsonObject {
  return film(doc, 'Axis through a label', [scaleItem([100, 1820], 0), axisItem(900, 1), label], {
    span: 4.5, markers: CROSS_CUES,
    channels: { 'axis-in': holdChannel(`items/${AXIS}/at/pos`, [[0, [0, 900, 0]], [2, [0, 500, 0]], [3.75, [0, 900, 0]]]) },
  });
}

// ---- Criterion 2's films: formulas that overlap, and a rect over a text

/** Cue ends 1, 2.5 and 4 s. */
const FORMULA_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1.5], ['c3', 'cue', 2.5, 1.5]]);
export const FORMULA_A: [number, number] = [200, 100];
export const FORMULA_B: [number, number] = [300, 100];
/** Two formulas: A, 200 × 100 u at (400, 400), and B, 300 × 100 u at (x, 400); they share (600 − x) × 100 u², of A's 20,000. */
export function overlapFilm(doc: string, srcA: string, srcB: string, x: number): JsonObject {
  return film(doc, 'Two formulas side by side', [vectorItem('formula-a', srcA, FORMULA_A, [400, 400], 'a + b', 0), vectorItem('formula-b', srcB, FORMULA_B, [x, 400], 'c = d', 1)], {
    span: 4, markers: FORMULA_CUES, modules: ['vector'],
  });
}
/**
 * The text@1 `cap` ("HHHHHHHH", 48 u, centred on x = 960 in its 600 × 63 box at (660, 300)) and an opaque ink rect
 * `veil` from x = 560 to 948, y = 250 to 420, drawn after the text: it covers the text's whole height left of 12 u
 * short of its centre, so 3 of the 7 columns of its 7 × 7 samples (21 of 49).
 */
export function coveredFilm(doc: string): JsonObject {
  return film(doc, 'A rect over a text', [textItem('cap', 'HHHHHHHH', [660, 300], { w: 600, h: 63 }, 48, 0), rectItem('veil', [560, 250, 388, 170], 1)], { span: 4, markers: FORMULA_CUES });
}

// ---- Criterion 3's film: a title past both edges from 2 s to 3 s

const TITLE = 'title';
/** 182 u past the left and right edges: 1920 + 2 × 182 u wide. */
export const TITLE_SIZE: [number, number] = [2284, 200];
/** Cue ends 1, 2, 3 and 4 s. */
const CUT_CUES = markers([['c1', 'cue', 0, 1], ['c2', 'cue', 1, 1], ['c3', 'cue', 2, 1], ['c4', 'cue', 3, 1]]);
/**
 * The title, a vector@1 whose one part fills its 2284 × 200 u box, at x = −182 (so 182 u past each side edge): a
 * hold-keyed channel keeps it above the frame (y = −1000, wholly out of it) until 2 s, at y = 300 from 2 s, and above
 * the frame again from 3.5 s, so it is in the frame at the cue ends 2 and 3 s only.
 */
export function cutFilm(doc: string, src: string): JsonObject {
  return film(doc, 'A title too wide for the frame', [vectorItem(TITLE, src, TITLE_SIZE, [-182, -1000], 'Motion', 0)], {
    span: 4, markers: CUT_CUES, modules: ['vector'],
    channels: { 'title-in': holdChannel(`items/${TITLE}/at/pos`, [[0, [-182, -1000, 0]], [2, [-182, 300, 0]], [3.5, [-182, -1000, 0]]]) },
  });
}

// ---- Criterion 5's own film: 60 cue ends × 40 texts × 200 strokes of 64 segments

export const BIG = { cues: 60, texts: 40, strokes: 200, segments: 64 } as const;
/** Cue ends 0.1, 0.2, …, 6.0 s. */
const BIG_CUE_ENDS: readonly number[] = Array.from({ length: BIG.cues }, (_, k) => (k + 1) / 10);
const fmt = (x: number): string => String(Number(x.toFixed(3)));
/**
 * 40 text@1 labels on an 8 × 5 grid (24 u, 160 × 32 u boxes, 220 u apart across and 200 down from (120, 100)); 200
 * open path@1 waves of 64 segments each, x 40 to 1880, y = 40 + 4i + 24 sin(2πx / 460 + 0.7i), children of the group
 * `waves`, which a linear channel moves down by 180 u over 6 s so no two cue ends are equal by evaluated data; and
 * 60 cues of 0.1 s, so cue ends every 0.1 s from 0.1 to 6.0 s. Every wave stays inside the frame.
 */
export function bigFilm(doc: string): JsonObject {
  const items: JsonObject[] = [{ id: 'waves', kind: 'group@1', name: 'Waves', order: order(0), params: {} }];
  for (let i = 0; i < BIG.strokes; i++) {
    const d = Array.from({ length: BIG.segments + 1 }, (_, j) => {
      const x = 40 + (j * 1840) / BIG.segments;
      return `${j ? 'L' : 'M'} ${fmt(x)} ${fmt(40 + 4 * i + 24 * Math.sin((2 * Math.PI * x) / 460 + 0.7 * i))}`;
    }).join(' ');
    items.push({ ...pathItem(`wave-${String(i).padStart(3, '0')}`, d, 1, 1 + i), parent: 'waves' });
  }
  for (let k = 0; k < BIG.texts; k++) {
    items.push(textItem(`text-${String(k).padStart(2, '0')}`, `Label ${k}`, [120 + 220 * (k % 8), 100 + 200 * Math.floor(k / 8)], { w: 160, h: 32 }, 24, 1 + BIG.strokes + k));
  }
  const cues: JsonObject = {};
  for (let k = 0; k < BIG.cues; k++) cues[`q${String(k).padStart(2, '0')}`] = { kind: 'cue', name: `Cue ${k}`, t: seconds(k / 10), span: '0.1s' };
  return film(doc, 'Waves through labels', items, {
    span: 6, markers: cues,
    channels: { drift: { target: 'items/waves/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [0, 0, 0], interp: 'linear' }, k1: { t: '6s', value: [0, 180, 0], interp: 'linear' } } } },
  });
}
/** Every cue end some issue of the row lists in its `ts`. */
export function cueEndsSeen(row: Row): number[] {
  const seen = row.issues.flatMap((i) => timesOf(field(i.raw, 'ts')) ?? []);
  return BIG_CUE_ENDS.filter((t) => seen.some((s) => sameTime(s, t)));
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64 (the redraft's change; README: Why a redraft). The checkout is built for linux/amd64 in Docker, as
// #238's and #532's suites build theirs, but in an image that holds what deep-show's `full` build needs there: a C++
// compiler (meshopt's and basisu_c_sys's build scripts compile C++) and libclang (basisu_c_sys's build script runs
// bindgen). rust:<channel>-bookworm, the non-slim image of rust-toolchain.toml's channel, has g++ but no libclang, so
// the image is that one with libclang-dev added, made once by the command `linuxSetup` gives. Nothing is pulled and
// no image is built here. Cargo runs LINUX_JOBS jobs so the build fits a small, shared Docker VM, and each container
// ends itself with coreutils' timeout. Caches live under target/acceptance-408-redraft-ac5-linux/, so a later run
// continues a build an earlier one didn't finish.

const LINUX = join(TARGET, 'acceptance-408-redraft-ac5-linux');
/**
 * Cargo's jobs in the container: an 8 GB, 6-CPU Docker VM, emulating amd64 with QEMU, killed cargo at its default
 * count (6) out of memory after about 70 crates, and 2 got past that point. Fixed, since the VM is shared with other
 * worktrees' containers, so its free memory, not its size, is what the count must fit.
 */
const LINUX_JOBS = 2;
/** The longest one Linux build runs before its container stops itself; the next run continues from the cache. */
const LINUX_BUILD_HOURS = 4;
/** The longest one `deep-show run` of the five films runs in the container, under emulation, in debug. */
const LINUX_RUN_MINUTES = 30;

function channel(): string {
  const found = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!found) throw Error('rust-toolchain.toml names no channel');
  return found;
}
const linuxBase = (): string => `rust:${channel()}-bookworm`;
const linuxImage = (): string => `deepbuild-acceptance-408-linux:${channel()}`;
/** The one-time setup, run by a person with the network: pull the official image, then add libclang-dev to it. */
const linuxSetup = (): string =>
  `docker pull --platform linux/amd64 ${linuxBase()} && printf 'FROM ${linuxBase()}\\nRUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*\\n' | docker build --platform linux/amd64 -t ${linuxImage()} -`;

function docker(args: string[], input: string | undefined, timeoutMs: number): Started {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, signal: null, timedOut, stdout: '', stderr: r.error.message };
  return { status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/**
 * Why a container that didn't exit 0 decided nothing about the program: Docker couldn't run or start it (125), it hit
 * its time (124, or the client's timeout), it or a compiler in it was killed (137, cargo's "signal: 9, SIGKILL", the
 * Docker VM out of memory), the image lacks a tool a build script looks for, or cargo couldn't reach the network to
 * fetch crates. Null when none of these: the program's own failure.
 */
function containerFault(r: Started, what: string, limit: string): string | null {
  const tail = r.stderr.trim().slice(-3000);
  if (r.status === null && !r.timedOut) return `docker could not run: ${tail}`;
  if (r.timedOut || r.status === 124) return `${what} didn't finish within ${limit}: ${tail}`;
  if (r.status === 125) return `docker could not start the container for ${what}: ${tail}`;
  if (r.status === 137 || /signal: 9, SIGKILL/.test(r.stderr)) return `${what} was killed (exit ${String(r.status)}), as the Docker VM does when it runs out of memory: ${tail}`;
  if (/ToolNotFound|failed to find tool|Unable to find libclang/.test(r.stderr)) return `${linuxImage()} lacks a tool ${what} needs: ${tail}`;
  if (/Couldn't resolve host|failed to download from|network failure seems to have happened/.test(r.stderr)) return `${what} couldn't fetch crates over the Docker VM's network: ${tail}`;
  return null;
}

/** Why Linux x86_64 can't run here (no Docker, or no linux/amd64 image), or null when it can. */
export function linuxMissing(): string | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) return `Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the Linux half runs in a linux/amd64 container`;
  const image = linuxImage();
  const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  const any = arch.status === 0 ? arch : docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (any.stdout.trim() !== 'amd64') {
    return `Docker has no linux/amd64 image ${image} (${linuxBase()} with libclang-dev, which basisu_c_sys's bindgen needs) and this suite pulls and builds no image; run: ${linuxSetup()}`;
  }
  return null;
}
/** Builds `full` deep-show for linux/amd64: `failed` is cargo's error, `open` why the build decided nothing here. */
export function buildLinux(): { failed: string; open: string } {
  const image = linuxImage();
  const args = [...cargoArgs(FULL), '--jobs', String(LINUX_JOBS)];
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const r = docker([
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
    image, 'timeout', `${LINUX_BUILD_HOURS}h`, 'cargo', ...args,
  ], undefined, LINUX_BUILD_HOURS * 3_600_000 + 600_000);
  if (r.status === 0) return { failed: '', open: '' };
  const what = `cargo ${args.join(' ')} in ${image} (linux/amd64)`;
  const open = containerFault(r, what, `${LINUX_BUILD_HOURS} h; the crates it built stay cached under ${LINUX}, so a rerun continues`);
  return open ? { failed: '', open } : { failed: `${what} failed (exit ${String(r.status)}):\n${r.stderr.slice(-4000)}`, open: '' };
}
/** One `deep-show run` process in a linux/amd64 container, the checkout read-only as its folder, `evidence` as its store. */
export function runLinux(scenario: JsonObject, evidence: string): { replies: JsonObject[] } | { open: string } {
  const inside = { ...scenario, evidence: '/evidence' };
  const r = docker([
    'run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    '-w', '/src', linuxImage(), 'timeout', `${LINUX_RUN_MINUTES}m`, `/target/debug/${SHOW}`, 'run',
  ], `${JSON.stringify(inside)}\n`, (LINUX_RUN_MINUTES + 10) * 60_000);
  const open = r.status === 0 ? null : containerFault(r, `${SHOW} run in ${linuxImage()} (linux/amd64)`, `${LINUX_RUN_MINUTES} min under emulation`);
  return open ? { open } : { replies: answerOf(r, arr(scenario['calls'], 'the calls').length, `${SHOW} run on linux/amd64`) };
}

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
