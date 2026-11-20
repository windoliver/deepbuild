// Test-side tools for the #2456 acceptance tests: `deep-show run`, built once per file and driven by one scenario line
// (#222's and #1969's form: `deep show` of a film from your shell, then `eval {doc, t, paths, pixels}`, the call #222's
// explainer was shot through); the films the criteria describe; the PNG reader; the design's reveal schedule (Text
// `text@1`), which every expected share comes from; and the one judge both criteria read frames with (README: Readings
// where the issue leaves a choice). Nothing here stands in for the text module, the channel or the renderer: every
// picture a test reads is a frame `deep-show` drew, and every expected value comes from the issue or the design. Suites
// don't import each other, so the parts shared with #1969's helpers are repeated here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2456 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Every `it` passes this timeout: a first build of `deep-show` with `full` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#2456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #2456.6a4fab33',
  2: 'AC2 #2456.3ee39994',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string', `${what} is a string, got ${brief(v)}`).toBe(true);
  return v as string;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

export const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
export const secs = (s: number): string => `${s}s`;
export const showTime = (f: number): string => `${Number((f / FLICKS).toFixed(6))} s`;

// ---------------------------------------------------------------------------------------------------
// The design's reveal schedule (Text `text@1`): units are graphemes (UAX #29); n units overlap by lag = min(4 ÷ n, 0.2),
// each revealing over w = 1 ÷ (1 + (n − 1) × lag) of the progress, unit u from u × lag × w (Clip and placement: a
// stagger's total is d × ((n − 1) × lag + 1), here 1); so at progress p unit u's share is clamp((p − u·lag·w) ÷ w, 0, 1).

export const graphemes = (text: string): string[] => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
export const lagOf = (n: number): number => Math.min(4 / n, 0.2);
export const widthOf = (n: number): number => 1 / (1 + (n - 1) * lagOf(n));
/** Each grapheme's share of its reveal at progress p, in reading order. */
export function sharesAt(text: string, p: number): number[] {
  const n = graphemes(text).length;
  const lag = lagOf(n); const w = widthOf(n);
  return Array.from({ length: n }, (_, u) => Math.min(1, Math.max(0, (p - u * lag * w) / w)));
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` once per file, copied out of the target folder; a test that uses a failed build fails with
// cargo's error.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
/** Builds stay light (no incremental cache, no debug info; the caller's settings win); cargo from rustup when PATH has none. */
function cargoEnv(): NodeJS.ProcessEnv {
  const extra = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'].filter((d) => existsSync(join(d, 'cargo')));
  return {
    ...process.env,
    PATH: [process.env['PATH'] ?? '', ...extra].join(delimiter),
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
}
function build(): string {
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds `deep-show` once, in beforeAll; the getter fails the test when the build failed. */
export function useShow(): () => string {
  let dir = ''; let error = 'not built'; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2456-bin-'));
    error = build();
    if (error === '') { bin = join(dir, 'deep-show'); copyFileSync(join(TARGET, 'debug', 'deep-show'), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return bin; };
}
/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2456-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393; #222's scenario): one scenario line in, one answer line out, exit 0.

/** One `deep-show run` process over `scenario`: its replies, one per call. */
export function runShow(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', 'deep-show run ran within its timeout').toBe('');
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, 'deep-show run: one answer line').toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(out[0]!) as JsonValue; } catch { return expect.fail(`deep-show run: its answer is not JSON: ${out[0]!.slice(0, 600)}`); }
  const a = obj(answer, 'deep-show run: the answer');
  expect(a['ok'], `deep-show run refused the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], 'deep-show run: replies').map((x, i) => obj(x, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const docId = (n: number): string => `01JB2456D${String(n).padStart(17, '0')}`;

/** A scenario: your shell's process tree, one panel, every document a call names on it, and the calls. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs, calls };
}
/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  const errors = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
  expect(errors, `${what} raises no error`).toEqual([]);
}
/** #387's `eval` at `t` flicks, reading `paths` (#1918) and drawing the frame (`pixels`). */
export const evalAt = (doc: string, t: number, paths: string[] = []): JsonObject =>
  ({ call: 'eval', doc, t, ...(paths.length ? { paths } : {}), pixels: true });
export function evaluated(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
}
/** A path's evaluated value in an `eval` reply. */
export function valueOf(reply: JsonObject, path: string, what: string): JsonValue {
  evaluated(reply, what);
  return obj(reply['values'], `${what}: values`)[path] ?? null;
}
/** The frame an `eval` with `pixels` drew: its one snapshot, the PNG the scenario's evidence store holds by its SHA-256. */
export function frameOf(reply: JsonObject, evidence: string, what: string): Image {
  evaluated(reply, what);
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
  const sha = str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
  expect(sha, `${what}: the snapshot is named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(createHash('sha256').update(file).digest('hex'), `${what}: the stored frame hashes to its name`).toBe(sha);
  return decodePng(file);
}

// ---------------------------------------------------------------------------------------------------
// The films (README: Fixtures): 640 × 360 u, 3 s, as your shell sends them (#222's form: no `id`, no `layers`), each
// holding one text item `tx`, "Hello there" in the body role at 64 u, ink fill, at (40, 140).

export const TEXT = 'Hello there';
export const TX = 'tx';
/** The path the issue's channel keys. */
export const PROGRESS = `items/${TX}/params/reveal/progress`;
/** The times the criteria are read at: the issue's 0.5 s and 1.5 s (progress 0 and 0.5) and 2.5 s (the whole text). */
export const TIMES = [fl(0.5), fl(1.5), fl(2.5)] as const;

/** A reveal as the design writes it: `{mode: fade, order: reading, progress}`; null for a text with none. */
function text(progress: number | null): JsonObject {
  return {
    id: TX, kind: 'text@1', name: 'Hello', order: 'a1', at: { pos: [40, 140, 0] },
    params: { text: TEXT, font: 'body', size: 64, paint: { fill: { role: 'ink' } }, ...(progress === null ? {} : { reveal: { mode: 'fade', order: 'reading', progress } }) },
  };
}
function film(title: string, item: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the #2456 acceptance suite.`, size: [640, 360],
    transport: { span: secs(3) }, items: { [TX]: item }, ...extra,
  };
}
/** The issue's film: progress 1 as written, and a channel on it keyed 0 at 1 s and 1 at 2 s, linear. */
export const KEYED = film('Keyed', text(1), {
  channels: { reveal: { target: PROGRESS, type: 'f32', keys: { k0: { t: '1s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 1, interp: 'linear' } } } },
});
/** A reveal no channel keys, at the progress written. */
export const unkeyed = (progress: number): JsonObject => film(`Unkeyed at ${progress}`, text(progress));
/** The same text with no reveal: what "drawn whole" is read against. */
export const PLAIN = film('Plain', text(null));

/** What `drawAll` drew: each film's frames at TIMES, and the progress `eval` read at each time for the film it read. */
export interface Drawn { frames: Record<string, Image[]>; progress: JsonValue[] }
/**
 * One `deep-show run`: shows each film from your shell (doc IDs 1, 2, … in order), then draws each at each of TIMES by
 * `eval` with `pixels`, the film named `read` also reading PROGRESS. Memoized per file through `once`.
 */
export function drawAll(bin: string, evidence: string, films: Record<string, JsonObject>, read?: string): Drawn {
  const names = Object.keys(films);
  const ids = names.map((_, i) => docId(i + 1));
  const calls = [
    ...names.map((n, i) => present(ids[i]!, films[n]!)),
    ...TIMES.flatMap((t) => names.map((n, i) => evalAt(ids[i]!, t, n === read ? [PROGRESS] : []))),
  ];
  const replies = runShow(bin, scenario(evidence, calls));
  names.forEach((n, i) => presented(replies[i]!, `the ${n} film`));
  const frames: Record<string, Image[]> = Object.fromEntries(names.map((n) => [n, [] as Image[]]));
  const progress: JsonValue[] = [];
  TIMES.forEach((t, k) => names.forEach((n, i) => {
    const reply = replies[names.length + k * names.length + i]!;
    const what = `the ${n} film at ${showTime(t)}`;
    frames[n]!.push(frameOf(reply, evidence, what));
    if (n === read) progress.push(valueOf(reply, PROGRESS, what));
  }));
  return { frames, progress };
}
/** `f` run once, by whichever test asks first; later calls get its value, or its error again. */
export function once<T>(f: () => T): () => T {
  let ran = false; let value: T | undefined; let error: unknown = null;
  return () => {
    if (!ran) { ran = true; try { value = f(); } catch (e) { error = e ?? Error('failed'); } }
    if (error !== null) throw error;
    return value as T;
  };
}

// ---------------------------------------------------------------------------------------------------
// PNGs (#418's reader, as #1646's and #1969's): 8-bit RGB or RGBA, no interlace.

export type Rgb = [number, number, number];
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The largest difference of one channel, in 8-bit code values. */
export const codeDiff = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
/** A pixel's ink: the sum over its channels of how far it is from the ground, in 8-bit code values. */
const inkOf = (p: Rgb, g: Rgb): number => Math.abs(p[0] - g[0]) + Math.abs(p[1] - g[1]) + Math.abs(p[2] - g[2]);

// ---------------------------------------------------------------------------------------------------
// The judge (README: Readings where the issue leaves a choice, 4 to 7). 2D writer layers composite in sRGB-encoded space
// (design: 2D marks and paint), so a grapheme drawn at opacity s over the ground moves each of its pixels s of the way
// from the ground to the pixel its plain text draws, in 8-bit codes; its ink is then s of the plain text's.

/** A pixel more than this many code values off the ground has ink; a stripe that draws none stays within it. */
export const NONE = 2;
/** A grapheme's ink over the plain text's, within this of its share. */
export const SHARE = 0.05;
/** A solid pixel's ink over the plain text's, within this of its grapheme's share, for all but 1% of its solid pixels. */
export const SOLID_SHARE = 0.1;
/** A solid pixel: one where the plain text's ink is at least this share of its strongest. */
const SOLID = 0.9;

/** The plain text's frame cut into one column stripe per grapheme that draws ink (Reading 4). */
export interface Stripe { grapheme: number; from: number; to: number; /** The plain text's ink in it. */ ink: number }
export interface Cut { plain: Image; ground: Rgb; stripes: Stripe[]; strongest: number }

/** The most frequent color of a frame: the ground, in a frame that holds one line of text. */
function groundOf(image: Image): Rgb {
  const counts = new Map<number, number>();
  for (let i = 0; i < image.width * image.height; i++) {
    const key = (image.rgba[i * 4]! << 16) | (image.rgba[i * 4 + 1]! << 8) | image.rgba[i * 4 + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0; let most = -1;
  for (const [key, n] of counts) if (n > most) { best = key; most = n; }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}
function inkIn(image: Image, ground: Rgb, from: number, to: number): number {
  let sum = 0;
  for (let y = 0; y < image.height; y++) for (let x = from; x < to; x++) sum += inkOf(pixel(image, x, y), ground);
  return sum;
}

/** Cuts the plain text's frame (`TEXT`, no reveal) into stripes: its columns of ink, one run per grapheme that draws. */
export function cut(plain: Image, what: string): Cut {
  const ground = groundOf(plain);
  const units = graphemes(TEXT);
  const inked = units.map((_, u) => u).filter((u) => !/^\s+$/u.test(units[u]!));
  const column = Array.from({ length: plain.width }, (_, x) => {
    for (let y = 0; y < plain.height; y++) if (codeDiff(pixel(plain, x, y), ground) > NONE) return true;
    return false;
  });
  const runs: [number, number][] = [];
  column.forEach((ink, x) => {
    if (!ink) return;
    const last = runs.at(-1);
    if (last && last[1] === x) last[1] = x + 1; else runs.push([x, x + 1]);
  });
  if (runs.length !== inked.length) {
    inconclusive(`${what}: the plain text's ink falls in ${runs.length} runs of columns (${runs.map(([a, b]) => `${a}–${b - 1}`).join(', ')}), not one per grapheme of "${TEXT}" that draws (${inked.length}), so a grapheme's share can't be read off the frame`);
  }
  let top = -1; let bottom = -1;
  for (let y = 0; y < plain.height; y++) {
    for (let x = 0; x < plain.width; x++) if (codeDiff(pixel(plain, x, y), ground) > NONE) { if (top < 0) top = y; bottom = y; break; }
  }
  if (bottom - top > 1.5 * 64 * (plain.height / 360)) inconclusive(`${what}: the plain film draws ink over rows ${top} to ${bottom}, more than one line of 64 u text, so it draws something besides its text`);
  // Each stripe runs to the middle of the gap on either side, the first from the frame's left edge, the last to its right.
  const mid = (k: number): number => Math.floor((runs[k - 1]![1] + runs[k]![0]) / 2);
  const stripes = runs.map((_, k): Stripe => {
    const from = k === 0 ? 0 : mid(k); const to = k === runs.length - 1 ? plain.width : mid(k + 1);
    return { grapheme: inked[k]!, from, to, ink: inkIn(plain, ground, from, to) };
  });
  let strongest = 0;
  for (let y = 0; y < plain.height; y++) for (let x = 0; x < plain.width; x++) strongest = Math.max(strongest, inkOf(pixel(plain, x, y), ground));
  return { plain, ground, stripes, strongest };
}

/**
 * Each way `frame` fails to draw every grapheme of `TEXT` by its share in `shares` (Readings 5 to 7): a grapheme whose
 * share is 0 leaves every pixel of its stripe within NONE code values of the ground; any other draws its share of the
 * plain text's ink within SHARE, and all but 1% of its solid pixels at its share within SOLID_SHARE. `at` names the
 * frame and its progress in each failure.
 */
export function drawnBy(frame: Image, c: Cut, shares: readonly number[], at: string): string[] {
  if (frame.width !== c.plain.width || frame.height !== c.plain.height) return [`${at}: the frame is ${frame.width} × ${frame.height}, the plain text's ${c.plain.width} × ${c.plain.height}`];
  const units = graphemes(TEXT);
  const failures: string[] = [];
  for (const s of c.stripes) {
    const share = shares[s.grapheme]!;
    const name = `grapheme ${s.grapheme} ${JSON.stringify(units[s.grapheme])} (columns ${s.from}–${s.to - 1})`;
    if (share === 0) {
      let off = 0; let worst = 0;
      for (let y = 0; y < frame.height; y++) {
        for (let x = s.from; x < s.to; x++) {
          const d = codeDiff(pixel(frame, x, y), c.ground);
          if (d > NONE) off++;
          worst = Math.max(worst, d);
        }
      }
      if (off > 0) failures.push(`${at}: ${name} has share 0 but draws: ${off} pixels of its stripe off the ground by up to ${worst} code values`);
      continue;
    }
    const read = inkIn(frame, c.ground, s.from, s.to) / s.ink;
    if (!(Math.abs(read - share) <= SHARE)) failures.push(`${at}: ${name} draws ${read.toFixed(3)} of the plain text's ink, not its share ${share.toFixed(3)} within ${SHARE}`);
    let solid = 0; let off = 0; let worst = share;
    for (let y = 0; y < frame.height; y++) {
      for (let x = s.from; x < s.to; x++) {
        const plainInk = inkOf(pixel(c.plain, x, y), c.ground);
        if (plainInk < SOLID * c.strongest) continue;
        solid++;
        const r = inkOf(pixel(frame, x, y), c.ground) / plainInk;
        if (Math.abs(r - share) > SOLID_SHARE) { off++; if (Math.abs(r - share) > Math.abs(worst - share)) worst = r; }
      }
    }
    if (solid < 20) inconclusive(`${at}: ${name} has ${solid} solid pixels in the plain text, too few to read how it's drawn`);
    if (off > 0.01 * solid) failures.push(`${at}: ${name}: ${off} of its ${solid} solid pixels aren't drawn at its share ${share.toFixed(3)} within ${SOLID_SHARE} (one reads ${worst.toFixed(3)}), so it isn't drawn whole at its share`);
  }
  return failures;
}
