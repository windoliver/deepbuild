// Test-side tools for the #856 acceptance tests: the two release binaries they drive (`deep-text` and
// `deep-show`), built once per file and driven by JSON lines; the texts the criteria name, made here
// deterministically; the readers of `deep-text shape` and of `deep-show run`'s `frames` and `shaped_runs`
// replies; the design's judge for a timing limit; and the checks each criterion's planted program must
// fail, each returning its failures as sentences that name what failed. Nothing here stands in for the
// shaper, its cache, the scheduler, the render worker or render-back.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/856 is three levels down). */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const release = (name: string): string => join(REPO, 'target', 'release', process.platform === 'win32' ? `${name}.exe` : name);
/** The one shaper's binary (#390): `fit` read as at the base, `shape` added here. */
export const TEXT_BIN = release('deep-text');
/** The hub's canvas side (#393, #387): `run`, whose `frames` call and `shaped_runs` call are extended or added here. */
export const SHOW_BIN = release('deep-show');

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
export function count(value: JsonValue | undefined, what: string): number {
  const n = num(value, what);
  expect(Number.isInteger(n) && n >= 0, `${what} is a whole number, got ${n}`).toBe(true);
  return n;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe('boolean');
  return value as boolean;
}
/** A long text named by its head and its length, for messages. */
export const named = (text: string): string => (text.length <= 48 ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, 40))}… (${text.length} chars)`);

// ---------------------------------------------------------------------------------------------------
// Builds: the release binaries, built once per file; a test that needs one that failed fails with cargo's error.

function build(name: string): string {
  const run = spawnSync('cargo', ['build', '--release', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo build --release --locked --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
}

export function useRelease(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(build).filter((e) => e !== '').join('\n'); }, 7_200_000);
  beforeEach(() => { expect(error, `the release binaries build: ${names.join(', ')}`).toBe(''); });
}

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one JSON line out per line in, exit 0.

export interface Ran { lines: JsonValue[]; ms: number }

/** One run of `<bin> <args>` over `inputs`; it must exit 0 with one line out per line in. `ms` is the wall time of the whole process. */
export function runLines(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 900_000): Ran {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const name = `${bin.split('/').at(-1)} ${args.join(' ')}`;
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  expect(run.status, `${name} exits 0; stdout: ${run.stdout.slice(0, 600)}; stderr: ${run.stderr.slice(-2000)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return { lines, ms };
}

// ---------------------------------------------------------------------------------------------------
// INCONCLUSIVE and the design's judge for a timing limit

/** A timing that can't be judged fails with this word, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

/**
 * The design's judge for a timing limit (Every task carries its own budgets): five runs after a warm-up;
 * PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the
 * larger of 5% and their spread), else INCONCLUSIVE, which fails here with that word.
 */
export function judge(name: string, runs: number[], limit: number): void {
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  inconclusive(shown);
}

// ---------------------------------------------------------------------------------------------------
// The texts the criteria name, made deterministically. Every character of these shapes to one glyph in the
// bundled body face (checked at the base with the shaper's own glyph count: 300, 2,000, 10,000 and 100).

const WORDS = ['amber', 'bright', 'cobalt', 'delta', 'ember', 'grove', 'harbor', 'juniper', 'kettle', 'lantern', 'meadow', 'north',
  'orchard', 'pebble', 'quartz', 'river', 'summit', 'timber', 'umber', 'velvet', 'willow', 'yonder', 'zephyr'];
/** `length` characters of lowercase words and single spaces, never ending in a space. */
export function prose(length: number, stride: number, offset: number): string {
  let out = '';
  for (let i = 0; out.length < length; i++) out += (out ? ' ' : '') + WORDS[(i * stride + offset) % WORDS.length]!;
  out = out.slice(0, length);
  return out.endsWith(' ') ? `${out.slice(0, -1)}s` : out;
}
export const ELLIPSIS = '…';
/** AC1's label: 300 characters, 300 glyphs. */
export const LABEL_300 = prose(300, 7, 0);
/** AC1's counter: 60 ticks of a bound number cycling through twelve values, so 48 ticks repeat an earlier text. */
export const COUNTER_TICKS: string[] = Array.from({ length: 60 }, (_, k) => (1000 + 125 * (k % 12)).toLocaleString('en-US'));
/** AC2's string: 2,000 characters. */
export const LONG_2000 = prose(2000, 3, 1);
/** AC3's figure text before and after the change: 10,000 characters each, 10,000 glyphs each. */
export const FIGURE_BEFORE = prose(10_000, 5, 3);
export const FIGURE_AFTER = prose(10_000, 11, 4);
/** AC4's run of distinct strings: string `i` is 100 characters, distinct by its number. */
export const DISTINCT = 100_000;
export const distinct = (i: number): string => { const head = `Run ${String(i).padStart(6, '0')} `; return head + prose(100 - head.length, 5, i % 23); };
export const ANCHOR = `Anchor ${prose(93, 5, 2)}`;
export const BYSTANDER = `Bystander ${prose(90, 7, 5)}`;

// ---------------------------------------------------------------------------------------------------
// `deep-text shape` (README: `deep-text shape`)

export interface Shaping { text: string; glyphs: number }
export interface ShapeReply { glyphs: number; width: number; shown: string; shaped: Shaping[]; cache: { entries: number; bytes: number; bound: number } }

/** One reply of `shape`, accepted and holding every field the README names. */
export function shapeReply(value: JsonValue | undefined, what: string): ShapeReply {
  const o = obj(value, what);
  expect(o['ok'], `${what} is accepted: ${JSON.stringify(o).slice(0, 600)}`).toBe(true);
  const cache = obj(o['cache'], `${what}: cache`);
  return {
    glyphs: count(o['glyphs'], `${what}: glyphs`),
    width: num(o['width'], `${what}: width`),
    shown: str(o['shown'], `${what}: shown`),
    shaped: arr(o['shaped'], `${what}: shaped`).map((v, i) => {
      const s = obj(v, `${what}: shaped[${i}]`);
      return { text: str(s['text'], `${what}: shaped[${i}].text`), glyphs: count(s['glyphs'], `${what}: shaped[${i}].glyphs`) };
    }),
    cache: { entries: count(cache['entries'], `${what}: cache.entries`), bytes: count(cache['bytes'], `${what}: cache.bytes`), bound: count(cache['bound'], `${what}: cache.bound`) },
  };
}

/** `deep-text shape [--planted <name>]` over `inputs`, one process: every reply read with `shapeReply`. */
export function shape(inputs: JsonObject[], planted?: string): { replies: ShapeReply[]; ms: number } {
  const args = ['shape', ...(planted ? ['--planted', planted] : [])];
  const ran = runLines(TEXT_BIN, args, inputs);
  return { replies: ran.lines.map((line, i) => shapeReply(line, `shape line ${i + 1} (${named(String(inputs[i]?.['text']))})`)), ms: ran.ms };
}

const glyphsOf = (list: Shaping[]): number => list.reduce((sum, s) => sum + s.glyphs, 0);

/**
 * AC1: a counter's ticks, one line each in one process. A tick whose text an earlier tick showed must shape
 * nothing; a tick showing a text for the first time must shape that text, once, to the glyphs it draws.
 * Each failure names the tick and the glyphs it shaped; the summary names every glyph shaped.
 */
export function counterFailures(ticks: string[], replies: ShapeReply[]): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  let shaped = 0;
  let needed = 0;
  ticks.forEach((text, k) => {
    const r = replies[k]!;
    const glyphs = glyphsOf(r.shaped);
    shaped += glyphs;
    if (r.shown !== text) failures.push(`tick ${k + 1} shows ${named(r.shown)}, not the counter's ${named(text)}`);
    if (seen.has(text)) {
      if (r.shaped.length > 0) failures.push(`tick ${k + 1} repeats ${named(text)}, shown at an earlier tick, and shaped it again: ${glyphs} glyphs shaped (${r.shaped.map((s) => named(s.text)).join(', ')})`);
    } else {
      seen.add(text);
      needed += r.glyphs;
      if (r.glyphs === 0) failures.push(`tick ${k + 1}'s run of ${named(text)} has no glyphs`);
      if (r.shaped.length !== 1 || r.shaped[0]!.text !== text || r.shaped[0]!.glyphs !== r.glyphs)
        failures.push(`tick ${k + 1} shows ${named(text)} for the first time and must shape it once to its ${r.glyphs} glyphs; it shaped ${JSON.stringify(r.shaped)}`);
    }
  });
  if (failures.length) failures.push(`over ${ticks.length} ticks the shaper shaped ${shaped} glyphs where the counter's ${seen.size} distinct texts have ${needed}`);
  return failures;
}

/**
 * AC2: one ellipsis fit. Every text it shaped is the string or a candidate prefix of it (a prefix, with or
 * without the ellipsis), and none is shaped twice. Failures name each text shaped more than once and the count.
 */
export function fitShapingFailures(text: string, reply: ShapeReply): string[] {
  const failures: string[] = [];
  if (reply.shaped.length === 0) failures.push(`the fit of ${named(text)} shaped nothing in a fresh process: no run was shaped to fit`);
  const times = new Map<string, number>();
  for (const s of reply.shaped) {
    const base = s.text.endsWith(ELLIPSIS) ? s.text.slice(0, -ELLIPSIS.length) : s.text;
    if (!text.startsWith(base)) failures.push(`the fit shaped ${named(s.text)}, which is neither the string nor a prefix of it`);
    times.set(s.text, (times.get(s.text) ?? 0) + 1);
  }
  for (const [shaped, n] of times) if (n > 1) failures.push(`the fit shaped ${named(shaped)} ${n} times`);
  if (failures.length) failures.push(`the fit made ${reply.shaped.length} shapings of ${times.size} distinct texts`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC4: the cache's bound and its eviction over a run of distinct strings

/** The lines AC4's run sends, in order, with what each is for. */
export interface Plan { inputs: JsonObject[]; anchors: number[]; firsts: number[]; recents: number[]; bystander: number; lastAnchor: number }

/** The anchor, the bystander, then 100,000 distinct strings with the anchor used again every 100; then the 50 latest strings again, the bystander, the anchor. */
export function evictionPlan(): Plan {
  const inputs: JsonObject[] = [{ text: ANCHOR }, { text: BYSTANDER }];
  const anchors: number[] = [];
  const firsts: number[] = [];
  for (let i = 0; i < DISTINCT; i++) {
    firsts.push(inputs.length);
    inputs.push({ text: distinct(i) });
    if ((i + 1) % 100 === 0) { anchors.push(inputs.length); inputs.push({ text: ANCHOR }); }
  }
  const recents: number[] = [];
  for (let i = DISTINCT - 50; i < DISTINCT; i++) { recents.push(inputs.length); inputs.push({ text: distinct(i) }); }
  const bystander = inputs.length;
  inputs.push({ text: BYSTANDER });
  const lastAnchor = inputs.length;
  inputs.push({ text: ANCHOR });
  return { inputs, anchors: [...anchors, lastAnchor], firsts, recents, bystander, lastAnchor };
}

/** Each run holds at least a 16-bit glyph ID and a 32-bit position per glyph, so its bytes can't count less. */
export const MIN_BYTES_PER_GLYPH = 6;

export function evictionFailures(plan: Plan, replies: ShapeReply[]): string[] {
  const failures: string[] = [];
  const bound = replies[0]!.cache.bound;
  if (bound <= 0) failures.push(`the cache's bound is ${bound} bytes`);
  let most = 0;
  replies.forEach((r, i) => {
    if (r.cache.bound !== bound && failures.length < 20) failures.push(`line ${i + 1}: the bound changed from ${bound} to ${r.cache.bound} bytes`);
    if (r.cache.bytes > bound && failures.length < 20) failures.push(`line ${i + 1} (${named(String(plan.inputs[i]!['text']))}): the cache holds ${r.cache.bytes} bytes, past its bound of ${bound}`);
    most = Math.max(most, r.cache.entries);
  });
  for (const i of plan.firsts) {
    if (replies[i]!.shaped.length === 0) { failures.push(`line ${i + 1}: ${named(String(plan.inputs[i]!['text']))} was never shown before and shaped nothing`); break; }
  }
  for (const i of plan.anchors) {
    const r = replies[i]!;
    if (r.shaped.length > 0) {
      failures.push(`line ${i + 1}: the anchor ${named(ANCHOR)}, used 100 strings earlier, was evicted and shaped again (${glyphsOf(r.shaped)} glyphs), though runs used less recently were held: the cache doesn't evict the least recently used`);
      break;
    }
  }
  for (const i of plan.recents) {
    if (replies[i]!.shaped.length > 0) { failures.push(`line ${i + 1}: ${named(String(plan.inputs[i]!['text']))}, among the 50 strings used last, was shaped again`); break; }
  }
  if (replies[plan.bystander]!.shaped.length === 0)
    failures.push(`the bystander ${named(BYSTANDER)}, shaped at line 2 and never used again, is still held after ${DISTINCT} distinct strings: nothing was evicted (the cache peaked at ${most} runs)`);
  const end = replies[plan.lastAnchor]!.cache;
  if (end.entries < 100) failures.push(`the cache ends holding ${end.entries} runs: its bound can't hold the 100 runs used between two uses of the anchor`);
  if (end.bytes < end.entries * 100 * MIN_BYTES_PER_GLYPH) failures.push(`the cache counts ${end.bytes} bytes for ${end.entries} runs of 100 glyphs, under ${MIN_BYTES_PER_GLYPH} bytes a glyph`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's scenario, #387's `eval` and `frames`; README: `deep-show run`)

export const DOC = { a: '01JB856D000000000000000001', b: '01JB856D000000000000000002' } as const;
export const SESSION = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: text cache', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-856-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A scenario with DOC.a in panel p1 and DOC.b in panel p2, both visible. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } },
    processes: PROCESSES,
    panels: { p1: { rect: [0, 0, 960, 540] }, p2: { rect: [0, 540, 960, 540] } },
    docs: { [DOC.a]: { panel: 'p1' }, [DOC.b]: { panel: 'p2' } },
    calls,
  };
}

/** An agent's deep_show call: a whole revision of `document` (#393). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc, document, include: ['issues'] });

/** `deep-show run [--planted <name>]`: one scenario, accepted, one reply per call. */
export function showRun(sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const ran = runLines(SHOW_BIN, args, [sc]);
  const out = obj(ran.lines[0], 'deep-show run: the answer');
  expect(out['ok'], `deep-show ${args.join(' ')} refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}

export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

/** A text@1 item in the body face at `size`, in a `w` × `h` box at `pos`, filled in `role`. */
export const textItem = (id: string, text: string, size: number, box: { w: number; h: number }, pos: [number, number], role = 'ink'): JsonObject =>
  ({ id, kind: 'text@1', name: `Text ${id}`, order: 'a1', params: { text, font: 'body', size, box, overflow: 'mask', paint: { fill: { role } } }, at: { pos: [pos[0], pos[1], 0] } });

/** AC3's figure: a 960 × 540 document of budget class `figure` holding one text of 10,000 glyphs. */
export function figure(text: string): JsonObject {
  return {
    format: 1, profile: 'figure', seed: 856, title: 'Long text',
    description: 'A figure holding one 10,000-glyph text, drawn by a test agent for the #856 acceptance tests.',
    size: [960, 540], budget: { class: 'figure' },
    items: { big: textItem('big', text, 8, { w: 920, h: 520 }, [20, 10]) },
  };
}

/** AC4's two boards: the same label (text, face, size, box) in another paint, so their content keys differ while the shaped run's key is the same. */
export const SHARED_LABEL = 'Ready to ship, all checks passed';
export function labelBoard(role: string): JsonObject {
  return {
    format: 1, profile: 'board', seed: 856, title: 'Shared label',
    description: 'A board showing one label, drawn by a test agent for the #856 acceptance tests.',
    size: [320, 80], items: { lbl: textItem('lbl', SHARED_LABEL, 13, { w: 300, h: 20 }, [10, 30], role) },
  };
}

// ---------------------------------------------------------------------------------------------------
// AC3: frames of a figure whose text changes

/** The frame the revision arrives at (its latch), and how many paced 60 Hz frames are drawn. */
export const CHANGE_AT = 60;
export const FRAME_COUNT = 180;
/** The figure class's frame CPU (canvas primitives: The cost model, budget class table), in ms. */
export const FIGURE_CPU_MS = 4;

export interface Frame { frame: number; ui_ms: number; settling: boolean; pixel_hash: string | null }

/** The `frames` call AC3 makes: 180 paced frames at the default step of 1/60 s, the revision to `after` arriving at frame 60's latch. */
export const changeFrames = (after: JsonObject, pixels: boolean): JsonObject =>
  ({ call: 'frames', doc: DOC.a, count: FRAME_COUNT, paced: true, revise: { frame: CHANGE_AT, document: after }, pixels });

const SHA = /^[0-9a-f]{64}$/;
export function frames(reply: JsonObject, pixels: boolean, what: string): Frame[] {
  const list = arr(reply['frames'], `${what}: frames`);
  expect(list.length, `${what}: one entry per frame`).toBe(FRAME_COUNT);
  return list.map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const pixel_hash = pixels ? str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`) : null;
    if (pixel_hash !== null) expect(pixel_hash, `${what}: frames[${i}].pixel_hash is a SHA-256 in lowercase hex`).toMatch(SHA);
    const ui_ms = num(f['ui_ms'], `${what}: frames[${i}].ui_ms`);
    expect(ui_ms >= 0, `${what}: frames[${i}].ui_ms ${ui_ms} is not negative`).toBe(true);
    return { frame: i, ui_ms, settling: bool(f['settling'], `${what}: frames[${i}].settling`), pixel_hash };
  });
}

/**
 * AC3's behavior: the first revision settled before the change; from the change's frame, every frame until
 * the new run draws is settling and draws the last shaped run (the pixels of the frame before the change);
 * the change's own frame is one of them; from the first settled frame on, every frame is settled and equals
 * `reference`, the new revision shaped on the UI thread. Each failure names the frame.
 */
export function changeFailures(list: Frame[], reference: string): string[] {
  const failures: string[] = [];
  const before = list[CHANGE_AT - 1]!;
  if (before.settling) return [`frame ${CHANGE_AT - 1}, a second after the figure was shown, is still settling: the first revision never drew`];
  const old = before.pixel_hash!;
  if (old === reference) return [`the figure before the change draws what the changed figure draws (${old.slice(0, 12)}…): the change can't be seen`];
  const first = list[CHANGE_AT]!;
  if (!first.settling) failures.push(`frame ${CHANGE_AT}, at whose latch the 10,000-glyph text changed, is not settling (it drew ${first.pixel_hash === reference ? 'the new text' : first.pixel_hash === old ? 'the old text' : 'something else'}, ui ${first.ui_ms.toFixed(3)} ms): the new run was shaped before the frame drew, on the UI thread`);
  const settled = list.findIndex((f, i) => i >= CHANGE_AT && !f.settling);
  if (settled < 0) return [...failures, `no frame from ${CHANGE_AT} to ${FRAME_COUNT - 1} (2 s) settled: the new run never drew`];
  for (const f of list.slice(CHANGE_AT, settled)) {
    if (f.pixel_hash !== old) { failures.push(`frame ${f.frame} is settling but doesn't draw the last shaped run (${f.pixel_hash?.slice(0, 12)}…, not ${old.slice(0, 12)}…)`); break; }
  }
  for (const f of list.slice(settled)) {
    if (f.settling) { failures.push(`frame ${f.frame} is settling again after frame ${settled} settled`); break; }
    if (f.pixel_hash !== reference) { failures.push(`frame ${f.frame} is settled but differs from the new text shaped on the UI thread (${f.pixel_hash?.slice(0, 12)}…, not ${reference.slice(0, 12)}…)`); break; }
  }
  return failures;
}

/** The UI thread's most expensive frame from the change on, in ms, and which frame it was. */
export function worstFrame(list: Frame[]): Frame {
  return list.slice(CHANGE_AT).reduce((worst, f) => (f.ui_ms > worst.ui_ms ? f : worst));
}

// ---------------------------------------------------------------------------------------------------
// AC4: two documents showing one label

export interface SharedRun { shaped: number; docs: string[] }
export function sharedRuns(reply: JsonObject, what: string): SharedRun[] {
  return arr(reply['runs'], `${what}: runs`).map((v, i) => {
    const r = obj(v, `${what}: runs[${i}]`);
    return { shaped: count(r['shaped'], `${what}: runs[${i}].shaped`), docs: arr(r['docs'], `${what}: runs[${i}].docs`).map((d, j) => str(d, `${what}: runs[${i}].docs[${j}]`)) };
  });
}

/** One run of the label, shaped once in the process, drawn by both documents. Failures name the runs and the times each was shaped. */
export function shareFailures(runs: SharedRun[]): string[] {
  const shown = runs.map((r, i) => `run ${i + 1} shaped ${r.shaped} time(s), drawn by ${r.docs.length ? r.docs.join(' and ') : 'no document'}`).join('; ');
  const failures: string[] = [];
  if (runs.length !== 1) failures.push(`the cache holds ${runs.length} runs of ${named(SHARED_LABEL)} for two documents showing it (${shown})`);
  const total = runs.reduce((sum, r) => sum + r.shaped, 0);
  if (total !== 1) failures.push(`the label was shaped ${total} times for two documents (${shown})`);
  const docs = [...new Set(runs.flatMap((r) => r.docs))].sort();
  if (runs.length === 1 && JSON.stringify([...runs[0]!.docs].sort()) !== JSON.stringify([DOC.a, DOC.b].sort())) failures.push(`the one run is drawn by ${JSON.stringify(runs[0]!.docs)}, not both documents`);
  if (docs.length !== 2) failures.push(`the label's runs are drawn by ${JSON.stringify(docs)}, not by both documents`);
  return failures;
}
