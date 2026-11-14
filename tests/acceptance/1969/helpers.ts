// Test-side tools for the #1969 acceptance tests: the two binaries the criteria reach, each built once per file and driven
// by JSON lines (`deep-canvas-render raster` for a text's reveal, its `#head` and its write mode, as #381, #496 and #1646
// left it; `deep-show run` for the cue list, the first-party verbs and the cue kit, as #222 left it); the documents the
// criteria describe; the PNG reader; and the design's reveal schedule the expected values come from. Nothing here stands
// in for the text module, the anchor, the expander or the kit: every value a test compares comes from a binary, and
// every expected value from the issue's text or the design. Suites don't import each other, so the parts shared with
// #222's, #496's and #1646's helpers are repeated here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1969 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Every `it` passes this timeout: a first build of `deep-show` with `full` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#1969.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1969.880c329e',
  2: 'AC2 #1969.0cd379f8',
  3: 'AC3 #1969.3ef80026',
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
// Time (Time and the flick): replies carry times as integer flicks or as the time grammar's "<decimal>s".

export const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
export const secs = (s: number): string => `${s}s`;
export const showTime = (f: number): string => `${(f / FLICKS).toFixed(6)} s (${f} flicks)`;
/** A time as a reply writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds; else null. */
export function flicksOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const f = Number(scaled / den);
  return m[1] === '-' ? -f : f;
}
/** A seeded generator in [0, 1) (mulberry32), seeded from a text by FNV-1a, so every run draws the same times. */
export function random(seedText: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `list` in a seeded order. */
export function shuffled<T>(list: readonly T[], seedText: string): T[] {
  const next = random(seedText); const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The design's reveal schedule (Text `text@1`): n units overlapping by lag = min(4 ÷ n, 0.2), each over w = 1 ÷ (1 +
// (n − 1) × lag) of the progress, unit u starting at u × lag × w; its own progress clamp((p − u × lag × w) ÷ w, 0, 1).
// That is the formula write's lagged sub-alpha (Oracle page: the upstream creation formula) with the progress p as α.

export const lagOf = (n: number): number => Math.min(4 / n, 0.2);
export const widthOf = (n: number): number => 1 / (1 + (n - 1) * lagOf(n));
/** Unit u's own reveal at progress p, of n units. */
export const unitAt = (p: number, u: number, n: number): number => Math.min(1, Math.max(0, (p - u * lagOf(n) * widthOf(n)) / widthOf(n)));
/** The progress at which unit u's reveal reaches 0.5, which `#head` passes it at. */
export const halfOf = (u: number, n: number): number => (u * lagOf(n) + 0.5) * widthOf(n);
/** How many of n units' reveals have passed 0.5 at progress p: the graphemes that show, which `#head` follows. */
export const shownAt = (p: number, n: number): number => Array.from({ length: n }, (_, u) => u).filter((u) => unitAt(p, u, n) > 0.5).length;
/** In write mode, the share of unit u's outline drawn: all of it over the first half of its own progress. */
export const drawnAt = (p: number, u: number, n: number): number => Math.min(1, 2 * unitAt(p, u, n));

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, copied out of the target folder; a test that uses a failed build fails with
// cargo's error.

export type Binary = 'deep-canvas-render' | 'deep-show';
const cargoArgs = (b: Binary): string[] => (b === 'deep-show'
  ? ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full']
  : ['build', '--locked', '--bin', 'deep-canvas-render']);
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
function build(b: Binary): string {
  const args = cargoArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds `b` once, in beforeAll; the getter fails the test when the build failed. */
export function useBinary(b: Binary): () => string {
  let dir = ''; let error = 'not built'; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1969-bin-'));
    error = build(b);
    if (error === '') { bin = join(dir, b); copyFileSync(join(TARGET, 'debug', b), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${cargoArgs(b).join(' ')}`).toBe(''); return bin; };
}
/** Fresh folders for a test (PNGs, evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1969-')); made.push(d); return d; };
}

/** `<bin> <args>` over `inputs`, one JSON object per line in, one per line out, in order; it exits 0. One call is one process. */
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  const label = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', `${label} ran within its timeout`).toBe('');
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => {
    let v: JsonValue;
    try { v = JSON.parse(l) as JsonValue; } catch { return expect.fail(`${label}: line ${i + 1} of its output is not JSON: ${l.slice(0, 600)}`); }
    return obj(v, `${label}: answer ${i + 1}`);
  });
}

// ---------------------------------------------------------------------------------------------------
// PNGs (#418's reader, as #1646's): 8-bit RGB or RGBA, no interlace.

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

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render raster` (#391's JSON lines; #496's and #1646's `texts`): one PNG at `out` per line.

/** The look every raster draws in: the shipped clean look, by ID (#392). */
export const LOOK = 'clean';
/** `raster` of `doc` at each time, in one process, in order, each line writing its own PNG under `dir`. */
export function raster(bin: string, dir: string, doc: JsonObject, times: number[]): { answers: JsonObject[]; pngs: string[] } {
  const pngs = times.map((_, i) => join(dir, `frame-${i}.png`));
  const answers = lines(bin, ['raster'], times.map((t, i) => ({ out: pngs[i]!, doc, look: LOOK, t })));
  answers.forEach((a, i) => expect(a['ok'], `raster of ${String(doc['id'])} at ${showTime(times[i]!)} draws the document: ${brief(a)}`).toBe(true));
  return { answers, pngs };
}
export const readPng = (path: string): Image => decodePng(readFileSync(path));

/** A glyph outline command, in u, in the glyph's own frame: pen origin on the baseline, x along the advance, y down (#496). */
export type Cmd = [string, ...number[]];
export interface Glyph { grapheme: number; advance: number; transform: number[]; outline: Cmd[] }
/** `texts.<item>.glyphs` of a raster answer, with #496's fields. */
export function glyphsOf(answer: JsonObject, item: string, what: string): Glyph[] {
  const t = obj(obj(answer['texts'], `${what}: texts`)[item], `${what}: texts.${item}`);
  return arr(t['glyphs'], `${what}: texts.${item}.glyphs`).map((v, i) => {
    const g = obj(v, `${what}: texts.${item}.glyphs[${i}]`);
    const transform = arr(g['transform'], `${what}: glyph ${i}'s transform`).map((n, j) => num(n, `${what}: glyph ${i}'s transform[${j}]`));
    expect(transform.length, `${what}: glyph ${i}'s transform has six numbers`).toBe(6);
    const outline = arr(g['outline'], `${what}: glyph ${i}'s outline`).map((c, j): Cmd => {
      const parts = arr(c, `${what}: glyph ${i}'s outline[${j}]`);
      expect(typeof parts[0] === 'string' && ['M', 'L', 'Q', 'C', 'Z'].includes(parts[0]), `${what}: glyph ${i}'s outline[${j}] starts with M, L, Q, C or Z: ${brief(c)}`).toBe(true);
      return [parts[0] as string, ...parts.slice(1).map((n, k) => num(n, `${what}: glyph ${i}'s outline[${j}][${k + 1}]`))];
    });
    return { grapheme: num(g['grapheme'], `${what}: glyph ${i}'s grapheme`), advance: num(g['advance'], `${what}: glyph ${i}'s advance`), transform, outline };
  });
}
/** A glyph's pen in the document: the origin of its own frame. */
export const penOf = (g: Glyph): [number, number] => [g.transform[4]!, g.transform[5]!];
/** A point of the glyph's own frame in the document. */
export const apply = (t: number[], p: [number, number]): [number, number] => [t[0]! * p[0] + t[2]! * p[1] + t[4]!, t[1]! * p[0] + t[3]! * p[1] + t[5]!];

const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** A film for `raster` (#496's envelope), 640 × 360 u, at 60 fps over `span`, with `extra` sections (channels). */
export function renderFilm(id: string, items: JsonObject[], extra: JsonObject, span: string): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#1969 ${id}`, description: `The #1969 acceptance tests' document ${id}.`, size: [640, 360], layers: LAYERS,
    transport: { span, frame_rate: '60/1' }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A text@1 item in the render film's layer. */
export const textItem = (id: string, order: string, params: JsonObject, at: JsonObject): JsonObject =>
  ({ id, kind: 'text@1', layer: 'main', name: id, order, at, params });
/** An f32 channel on `target` with linear keys `[seconds, value]`. */
export function linear(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: secs(t), value, interp: 'linear' }])) };
}

// ---------------------------------------------------------------------------------------------------
// Outlines as polylines in the document, for reading a frame along them.

/** A glyph's contours in the document: each a polyline (curves cut into 64 pieces), closed back to its first point. */
export function contoursOf(g: Glyph): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  let pen: [number, number] = [0, 0];
  const put = (p: [number, number]): void => { cur.push(apply(g.transform, p)); pen = p; };
  for (const c of g.outline) {
    const v = c.slice(1) as number[];
    if (c[0] === 'M') { if (cur.length) out.push(cur); cur = []; put([v[0]!, v[1]!]); }
    else if (c[0] === 'L') put([v[0]!, v[1]!]);
    else if (c[0] === 'Q') {
      const p0 = pen;
      for (let i = 1; i <= 64; i++) { const s = i / 64; const m = 1 - s; put([m * m * p0[0] + 2 * m * s * v[0]! + s * s * v[2]!, m * m * p0[1] + 2 * m * s * v[1]! + s * s * v[3]!]); }
    } else if (c[0] === 'C') {
      const p0 = pen;
      for (let i = 1; i <= 64; i++) {
        const s = i / 64; const m = 1 - s;
        put([m * m * m * p0[0] + 3 * m * m * s * v[0]! + 3 * m * s * s * v[2]! + s * s * s * v[4]!, m * m * m * p0[1] + 3 * m * m * s * v[1]! + 3 * m * s * s * v[3]! + s * s * s * v[5]!]);
      }
    }
  }
  if (cur.length) out.push(cur);
  return out.map((poly) => {
    const first = poly[0]!; const last = poly[poly.length - 1]!;
    return Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-9 ? [...poly, first] : poly;
  });
}
export const lengthOf = (poly: [number, number][]): number => poly.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - poly[i]![0], p[1] - poly[i]![1]), 0);
/** The point at arc length s along a polyline. */
export function along(poly: [number, number][], s: number): [number, number] {
  let left = s;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!; const b = poly[i]!; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= d && d > 0) return [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d];
    left -= d;
  }
  return poly[poly.length - 1]!;
}
/** Whether a point lies inside a closed polyline (even-odd). */
export function inside(poly: [number, number][], [x, y]: [number, number]): boolean {
  let hit = false;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1]!; const [bx, by] = poly[i]!;
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) hit = !hit;
  }
  return hit;
}
/** A point's distance to a polyline. */
export function distance(poly: [number, number][], [x, y]: [number, number]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1]!; const [bx, by] = poly[i]!;
    const dx = bx - ax; const dy = by - ay; const l2 = dx * dx + dy * dy;
    const s = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + s * dx - x, ay + s * dy - y));
  }
  return best;
}
/** A polyline's bounds [x0, y0, x1, y1]. */
export function boundsOf(poly: [number, number][]): [number, number, number, number] {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393; #222's scenario): one scenario line in, one answer line out, exit 0.

/** One `deep-show run` process: its replies, one per call. */
export function runShow(bin: string, scenario: JsonObject): JsonObject[] {
  const [out] = lines(bin, ['run'], [scenario]);
  expect(out!['ok'], `deep-show run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out!['replies'], 'deep-show run: replies').map((x, i) => obj(x, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}
/** A pack folder offered to the scenario's store (#306) and the version a document names. */
export interface Pack { id: string; version: string; dir: string }
/** The first-party pack of verbs (#222's suite: The first-party verbs). */
export const VERBS_PACK: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const VERBS_AT = `${VERBS_PACK.id}@${VERBS_PACK.version}`;

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: typed text', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const docId = (n: number): string => `01JB1969D${String(n).padStart(17, '0')}`;

/** A scenario: your shell's process tree, alpha's session, one panel, every document a call names on it, the packs offered. */
export function scenario(evidence: string, calls: JsonObject[], packs: readonly Pack[] = [VERBS_PACK]): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    packs: packs.map((p) => ({ id: p.id, dir: p.dir })),
    calls,
  };
}
/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  expect(errors(reply), `${what} raises no error`).toEqual([]);
}
/** #387's `eval` at `t` flicks, reading `paths` (#1918), the film block's glyphs (#493) and the frame's snapshot. */
export const evalAt = (doc: string, t: number, o: { paths?: string[]; film?: boolean; pixels?: boolean } = {}): JsonObject =>
  ({ call: 'eval', doc, t, ...(o.paths ? { paths: o.paths } : {}), ...(o.film ? { film: true } : {}), ...(o.pixels ? { pixels: true } : {}) });
export function evaluated(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
}
/** A path's evaluated value in an `eval` reply. */
export function valueOf(reply: JsonObject, path: string, what: string): JsonValue {
  evaluated(reply, what);
  return obj(reply['values'], `${what}: values`)[path] ?? null;
}
/** Each glyph's pen `[x, y]` of a text item in an `eval` reply's film block (#493: `film.glyphs.<item>`). */
export function filmGlyphs(reply: JsonObject, item: string, what: string): [number, number][] {
  evaluated(reply, what);
  const g = obj(obj(reply['film'], `${what}: film`)['glyphs'], `${what}: film.glyphs`);
  return arr(g[item], `${what}: film.glyphs.${item}`).map((v, i) => {
    const o = obj(v, `${what}: film.glyphs.${item}[${i}]`);
    return [num(o['x'], `${what}: film.glyphs.${item}[${i}].x`), num(o['y'], `${what}: film.glyphs.${item}[${i}].y`)];
  });
}
/** The frame an `eval` with `pixels` stored in the scenario's evidence store, by its SHA-256. */
export function snapshotOf(reply: JsonObject, evidence: string, what: string): Image {
  evaluated(reply, what);
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
  const sha = str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
  expect(sha, `${what}: the snapshot is named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  return readPng(path);
}

/** A film as your shell sends it (#222's form: no `id`, no `layers`), 640 × 360 u. */
export function showFilm(title: string, items: JsonObject[], o: { span: number; packs?: string[] }): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the #1969 acceptance suite.`, size: [640, 360], transport: { span: secs(o.span) },
    ...(o.packs?.length ? { packs: o.packs } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
export const LIST = 'list';
/** The cue list item `cues@1` holding `cues`, in order. */
export const cueList = (cues: JsonObject[]): JsonObject => ({ id: LIST, kind: 'cues@1', name: 'Cue list', order: 'z0', params: { cues } });

/** A cue list's expansion off a `deep show` reply (#222's suite: The expansion). */
export interface Channel { id: string; target: string; cue: string; times: number[] }
export interface Expansion { channels: Channel[]; markers: Record<string, { t: number; span: number }> }
export function expansionOf(reply: JsonObject, what: string): Expansion {
  const all = arr(reply['expansions'], `${what}: the deep show reply's expansions`).filter(isObject);
  const found = all.filter((e) => e['instance'] === LIST);
  expect(found.length, `${what}: the reply's expansions hold one for the cue list ${LIST}`).toBe(1);
  const raw = found[0]!;
  const markers: Record<string, { t: number; span: number }> = {};
  for (const [name, m] of Object.entries(obj(raw['markers'], `${what}: the expansion's markers`))) {
    const mo = obj(m, `${what}: markers.${name}`);
    const t = flicksOf(mo['t']); const span = flicksOf(mo['span'] ?? 0);
    expect(t !== null && span !== null, `${what}: markers.${name} has t and span in whole flicks, got ${brief(mo)}`).toBe(true);
    markers[name] = { t: t!, span: span! };
  }
  const channels = Object.entries(obj(raw['channels'], `${what}: the expansion's channels`)).map(([id, c]): Channel => {
    const co = obj(c, `${what}: channels.${id}`);
    const times: number[] = [];
    const keys = co['keys'];
    for (const k of Array.isArray(keys) ? keys : isObject(keys) ? Object.values(keys) : []) {
      const t = flicksOf(isObject(k) ? k['t'] : undefined);
      expect(t, `${what}: channels.${id}: every key's t is a whole number of flicks, got ${brief(k)}`).not.toBeNull();
      times.push(t!);
    }
    for (const m of Array.isArray(co['modifiers']) ? co['modifiers'] : []) {
      const body = isObject(m) ? (m['kind'] === 'pulse' ? m : isObject(m['pulse']) ? m['pulse'] : null) : null;
      if (!body) continue;
      const at = flicksOf(body['at']); const span = flicksOf(body['span']);
      expect(at !== null && span !== null, `${what}: channels.${id}: a pulse's at and span are whole flicks, got ${brief(body)}`).toBe(true);
      times.push(at!, at! + span!);
    }
    return { id, target: str(co['target'], `${what}: channels.${id}.target`), cue: id.slice(LIST.length + 1).split('.')[0]!, times: times.sort((a, b) => a - b) };
  });
  return { channels, markers };
}

/** cue.kind@1's row in deep://registries (#200, #222): its entries and planted entries, each with a kit result. */
export interface Kit { verdict: string; rules: { rule: string; verdict: string; message: string }[]; raw: JsonObject }
export function kitOf(v: JsonValue | undefined, what: string): Kit {
  const o = obj(v, what);
  const rules = (Array.isArray(o['rules']) ? o['rules'] : []).filter(isObject).map((r) => ({ rule: String(r['rule']), verdict: String(r['verdict']), message: typeof r['message'] === 'string' ? r['message'] : '' }));
  return { verdict: String(o['verdict']), rules, raw: o };
}
export const CUE_KINDS = 'cue.kind@1';
export function registryRow(reply: JsonObject, name: string): JsonObject {
  const rows = arr(reply['registries'], 'registries: registries').filter(isObject).filter((r) => r['name'] === name && r['kind'] !== 'slot');
  expect(rows.length, `deep://registries lists the registry ${name}`).toBe(1);
  return rows[0]!;
}
/** The cue kit's five rules (#222's suite: The cue kit). */
export const KIT_RULES = ['same_bytes', 'targets_only', 'inside_span', 'end_state', 'back_to_base'] as const;
