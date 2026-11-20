// Test-side tools for the #1489 acceptance tests (README: The surface under test): the animated pictures, made here in
// code (a GIF89a writer with its own LZW coder), the documents that draw them, the frame a GIF shows at t, the answers
// of `deep-canvas-render frames`, `render` and `live` read back and checked, the resident memory of a run's process
// tree sampled while it plays, the replica's picture window driven over `deep-drive`'s stdin, and the timing judge
// (scripts/benchmark.mjs's). Nothing here decodes a GIF for a program, holds a frame for it or arms its timer: every
// frame shown, every byte held and every frame drawn comes from the binaries.
//
// Reused by import, unchanged: #1486's helpers (the release `deep-canvas-render` build, one request line in and one
// answer line out, the JSON readers, the PNG reader, the board document and the store). The replica is driven as
// #124's and #1482's helpers drive it (the same debug build with the planted programs, a temporary home, the child's
// environment without the session's DEEP_ variables, every process stopped by its PID), written out here because
// #124's helpers load the record store and the verdict engine, which these tests don't use.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import { arr, board, count, decodePng, num, obj, REPO, short, type Box, type Image, type JsonObject, type JsonValue, type Rgb } from '../1486/helpers.ts';

export { decodePng, LOOK, one, percentile, put, short, useRender } from '../1486/helpers.ts';
export type { JsonObject } from '../1486/helpers.ts';

/** 705,600,000 flicks a second: a GIF's hundredth of a second and a 60 Hz frame are each a whole number of them. */
const FLICKS = 705_600_000;
const HUNDREDTH = FLICKS / 100;
export const PERIOD = FLICKS / 60;

/** A folder under the OS temp folder, deleted after the file's tests. */
export function scratch(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-1489-${tag}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// The GIF writer: GIF89a with a global color table, a NETSCAPE2.0 block that loops it forever, an optional comment,
// and per frame a graphic control block (its delay; disposal "do not dispose", so each frame is drawn over what the
// frames before it left on the canvas) and its image, LZW-coded.

interface GifFrame {
  /** Where the frame's pixels go on the canvas, px: [left, top, width, height]. */
  rect: Box;
  /** Its pixels as palette indices, row by row: width × height of them. */
  indices: Uint8Array;
  /** How long it shows, in hundredths of a second, the GIF's own unit. */
  delay: number;
}
interface GifSpec {
  width: number;
  height: number;
  /** The global color table: at most 256 colors, padded with black to a power of two of at least 4. */
  palette: readonly Rgb[];
  frames: readonly GifFrame[];
  /** A comment block, so files with the same pixels are different files by hash. */
  comment?: string;
}

const u16 = (v: number): Buffer => Buffer.from([v & 255, (v >> 8) & 255]);

/** `data` in GIF sub-blocks of at most 255 bytes each, ended by an empty one. */
function subBlocks(data: Uint8Array): Buffer {
  const parts: Buffer[] = [];
  for (let at = 0; at < data.length; at += 255) {
    const piece = data.subarray(at, Math.min(at + 255, data.length));
    parts.push(Buffer.from([piece.length]), Buffer.from(piece));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// The coder's table, keyed by (prefix code << 8 | index): a code is in the table when its stamp is the current
// generation, so a clear costs nothing.
const CODES = new Int16Array(1 << 20);
const STAMPS = new Uint32Array(1 << 20);
let generation = 0;

/**
 * GIF's LZW: codes from `minSize` + 1 bits up to 12, packed least significant bit first, a clear code first and again
 * whenever the table fills, the end code last (the widely used encoder's order of growing the code size).
 */
function lzw(minSize: number, indices: Uint8Array): Buffer {
  const clear = 1 << minSize;
  const end = clear + 1;
  let next = end + 1;
  let size = minSize + 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  const put = (code: number): void => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let gen = ++generation;
  put(clear);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    if (STAMPS[key] === gen) {
      prefix = CODES[key]!;
      continue;
    }
    put(prefix);
    if (next === 4096) {
      put(clear);
      next = end + 1;
      size = minSize + 1;
      gen = ++generation;
    } else {
      if (next >= 1 << size) size++;
      CODES[key] = next++;
      STAMPS[key] = gen;
    }
    prefix = k;
  }
  put(prefix);
  put(end);
  if (bits > 0) out.push(acc & 255);
  return subBlocks(Uint8Array.from(out));
}

function gif(spec: GifSpec): Buffer {
  let tableBits = 2;
  while (1 << tableBits < spec.palette.length) tableBits++;
  if (tableBits > 8) throw Error(`a GIF's color table holds at most 256 colors, not ${spec.palette.length}`);
  const table = Buffer.alloc(3 << tableBits);
  spec.palette.forEach((c, i) => table.set(c, i * 3));
  const parts: Buffer[] = [
    Buffer.from('GIF89a', 'latin1'), u16(spec.width), u16(spec.height),
    Buffer.from([0x80 | (7 << 4) | (tableBits - 1), 0, 0]), table,
    Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  if (spec.comment !== undefined) parts.push(Buffer.from([0x21, 0xfe]), subBlocks(Buffer.from(spec.comment, 'latin1')));
  for (const f of spec.frames) {
    const [x, y, w, h] = f.rect;
    if (f.indices.length !== w * h) throw Error(`a ${w} × ${h} frame takes ${w * h} indices, not ${f.indices.length}`);
    if (f.indices.some((i) => i >= spec.palette.length)) throw Error('a frame names a color the table doesn\'t hold');
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 1 << 2]), u16(f.delay), Buffer.from([0x00, 0x00]));
    parts.push(Buffer.from([0x2c]), u16(x), u16(y), u16(w), u16(h), Buffer.from([0x00]));
    parts.push(Buffer.from([tableBits]), lzw(tableBits, f.indices));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/**
 * The frame a GIF shows at `t` flicks from its start: the one whose interval [start, start + delay) holds t, each
 * delay counted in hundredths of a second as the file gives it (no fixture here has a delay of 10 ms or less, which the
 * Scope stretches to 100 ms). With `loop` t wraps at the GIF's length; without it the last frame holds after its end.
 */
export function frameAt(delays: readonly number[], t: number, loop: boolean): number {
  const length = delays.reduce((sum, d) => sum + d, 0) * HUNDREDTH;
  let at = loop ? ((t % length) + length) % length : t;
  if (at < 0) return 0;
  for (let j = 0; j < delays.length; j++) {
    const d = delays[j]! * HUNDREDTH;
    if (at < d) return j;
    at -= d;
  }
  return delays.length - 1;
}

/** The mean color of `box` (px) in `image`. */
function meanOf(image: Image, [x0, y0, w, h]: Box): Rgb {
  const sum = [0, 0, 0];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) for (let c = 0; c < 3; c++) sum[c]! += image.rgba[(y * image.width + x) * 4 + c]!;
  return sum.map((v) => Math.round(v / (w * h))) as Rgb;
}
const near = (a: Rgb, b: Rgb, tolerance: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

// ---------------------------------------------------------------------------------------------------
// The pictures (README: The pictures).

/** AC1's GIF: 200 frames of 512 × 512, each shown 20 ms (4 s in all). Frame j is eight bars 64 px wide, each black or white by one of j's eight bits, the most significant at the left. */
export const BIG = { side: 512, frames: 200, delay: 2 } as const;
export const BIG_DELAYS: readonly number[] = Array.from({ length: BIG.frames }, () => BIG.delay);
/** One frame's pixels: 512 × 512 × 4 B. */
export const BIG_FRAME_BYTES = BIG.side * BIG.side * 4;

export function bigGif(): Buffer {
  const frames = Array.from({ length: BIG.frames }, (_, j): GifFrame => {
    const indices = new Uint8Array(BIG.side * BIG.side);
    for (let x = 0; x < BIG.side; x++) {
      const bit = (j >> (7 - Math.floor(x / 64))) & 1;
      for (let y = 0; y < BIG.side; y++) indices[y * BIG.side + x] = bit;
    }
    return { rect: [0, 0, BIG.side, BIG.side], indices, delay: BIG.delay };
  });
  return gif({ width: BIG.side, height: BIG.side, palette: [[0, 0, 0], [255, 255, 255]], frames });
}

/** The frame of the big GIF that `image` (the GIF drawn 1:1 at its top-left corner) shows, read from its eight bars; a description of what it shows when the bars read as no frame. */
export function barsShown(image: Image): number | string {
  let j = 0;
  const read: string[] = [];
  for (let b = 0; b < 8; b++) {
    const [r, g, bl] = meanOf(image, [64 * b + 24, 240, 16, 32]);
    const luma = (r + g + bl) / 3;
    read.push(`${Math.round(luma)}`);
    if (luma > 200) j |= 1 << (7 - b);
    else if (luma >= 55) return `bar ${b} reads luma ${Math.round(luma)}, neither black nor white (bars ${read.join(', ')})`;
  }
  return j;
}

/** AC2's 200 GIFs: 60 × 60, 8 frames each; GIF i shows each frame 4 + (i mod 7) hundredths (40 to 100 ms), its frame j all one color, SMALL_COLORS[(i + j) mod 8]; each carries its own comment, so each is its own file. */
export const SMALL = { side: 60, frames: 8, count: 200, columns: 20, pitch: 64, inset: 2 } as const;
const SMALL_COLORS: readonly Rgb[] = [
  [230, 40, 40], [40, 180, 60], [40, 90, 220], [240, 200, 30], [170, 50, 190], [40, 200, 210], [245, 130, 40], [250, 250, 250],
];
export const smallDelays = (i: number): number[] => Array.from({ length: SMALL.frames }, () => 4 + (i % 7));
export const smallId = (i: number): string => `a${i}`;
export const smallBox = (i: number): Box => [(i % SMALL.columns) * SMALL.pitch + SMALL.inset, Math.floor(i / SMALL.columns) * SMALL.pitch + SMALL.inset, SMALL.side, SMALL.side];
/** The view that holds all 200 tiles: 20 columns and 10 rows on a 64 u pitch. */
export const SMALL_VIEW: Box = [0, 0, SMALL.columns * SMALL.pitch, (SMALL.count / SMALL.columns) * SMALL.pitch];

export function smallGif(i: number): Buffer {
  const frames = Array.from({ length: SMALL.frames }, (_, j): GifFrame => ({
    rect: [0, 0, SMALL.side, SMALL.side],
    indices: new Uint8Array(SMALL.side * SMALL.side).fill((i + j) % SMALL.frames),
    delay: 4 + (i % 7),
  }));
  return gif({ width: SMALL.side, height: SMALL.side, palette: SMALL_COLORS, frames, comment: `deep-1489 animation ${i}` });
}

/** The color of SMALL_COLORS a tile's centre shows (`origin` its top-left in the image), or what it shows instead. */
export function smallShown(image: Image, [x, y]: [number, number]): number | string {
  const seen = meanOf(image, [x + 22, y + 22, 16, 16]);
  const k = SMALL_COLORS.findIndex((c) => near(seen, c, 40));
  return k >= 0 ? k : `[${seen.join(', ')}], none of the GIFs' colors`;
}

/** AC3's and AC4's chrome GIF: 64 × 64, 10 frames of 100 ms, frame j all one color, CHROME_COLORS[j]; it loops. */
const CHROME = { side: 64, frames: 10, delay: 10 } as const;
const CHROME_COLORS: readonly Rgb[] = [
  [230, 40, 40], [40, 180, 60], [40, 90, 220], [240, 200, 30], [170, 50, 190],
  [40, 200, 210], [245, 130, 40], [240, 120, 180], [120, 70, 20], [30, 30, 30],
];

export function chromeGif(): Buffer {
  const frames = Array.from({ length: CHROME.frames }, (_, j): GifFrame => ({
    rect: [0, 0, CHROME.side, CHROME.side], indices: new Uint8Array(CHROME.side * CHROME.side).fill(j), delay: CHROME.delay,
  }));
  return gif({ width: CHROME.side, height: CHROME.side, palette: CHROME_COLORS, frames });
}

/** Which of the chrome GIF's frames the picture's centre shows (`center` in device px), or what it shows instead. */
export function chromeShown(image: Image, [x, y]: [number, number]): number | string {
  const seen = meanOf(image, [x - 4, y - 4, 8, 8]);
  const j = CHROME_COLORS.findIndex((c) => near(seen, c, 40));
  return j >= 0 ? j : `[${seen.join(', ')}], none of the GIF's frames`;
}

/**
 * AC4's GIF: 64 × 64 in sixteen cells of 16 × 16, four to a row. Frame 0 covers the canvas, BASE everywhere but cell 0,
 * which is CELL_COLORS[0]; frame j (1 to 15) covers cell j alone, in CELL_COLORS[j], drawn over what the frames before
 * it left. So the canvas at frame j has cells 0 … j in their colors and the rest BASE, and no frame but the first can
 * be drawn without the ones before it. Each frame shows CELL_DELAYS[j] hundredths.
 */
export const CELLS = { side: 64, cell: 16 } as const;
export const CELL_DELAYS: readonly number[] = [10, 4, 7, 12, 5, 9, 6, 15, 8, 4, 11, 6, 13, 5, 7, 20];
const BASE: Rgb = [60, 60, 60];
const CELL_COLORS: readonly Rgb[] = Array.from({ length: 16 }, (_, c): Rgb => {
  const h = (c * 360) / 16 / 60;
  const f = h - Math.floor(h);
  const [v, p, q, t] = [235, 40, Math.round(235 - 195 * f), Math.round(40 + 195 * f)];
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as Rgb[])[Math.floor(h) % 6]!;
});
const cellRect = (c: number): Box => [(c % 4) * CELLS.cell, Math.floor(c / 4) * CELLS.cell, CELLS.cell, CELLS.cell];

export function cellsGif(): Buffer {
  const first = new Uint8Array(CELLS.side * CELLS.side);
  for (let y = 0; y < CELLS.cell; y++) for (let x = 0; x < CELLS.cell; x++) first[y * CELLS.side + x] = 1;
  const frames: GifFrame[] = [{ rect: [0, 0, CELLS.side, CELLS.side], indices: first, delay: CELL_DELAYS[0]! }];
  for (let j = 1; j < 16; j++) frames.push({ rect: cellRect(j), indices: new Uint8Array(CELLS.cell * CELLS.cell).fill(j + 1), delay: CELL_DELAYS[j]! });
  return gif({ width: CELLS.side, height: CELLS.side, palette: [BASE, ...CELL_COLORS], frames });
}

/** The frame of the cells GIF that `image` shows with the GIF drawn 1:1 at its top-left corner, read cell by cell; a description of what it shows when the cells read as no frame. */
export function cellsShown(image: Image): number | string {
  const states = Array.from({ length: 16 }, (_, c) => {
    const [x, y] = cellRect(c);
    const seen = meanOf(image, [x + 4, y + 4, 8, 8]);
    return near(seen, CELL_COLORS[c]!, 40) ? 'on' : near(seen, BASE, 24) ? 'base' : `[${seen.join(', ')}]`;
  });
  const j = states.lastIndexOf('on');
  if (j >= 0 && states.every((s, c) => s === (c <= j ? 'on' : 'base'))) return j;
  return `cells read ${states.map((s, c) => `${c}: ${s}`).join(', ')}, which no frame of the GIF shows (frame j has cells 0 … j in their colors and the rest the base [${BASE.join(', ')}])`;
}

// ---------------------------------------------------------------------------------------------------
// Documents: #391's board with image@1 items (#674), each animated item carrying `frames` (#499's field).

/** Plays once from t = 0, its source time the document's time. */
export const ONCE: JsonObject = { start: 0, in: 0, rate: [1, 1] };
/** The same, looping. */
export const LOOPING: JsonObject = { start: 0, in: 0, rate: [1, 1], loop: true };

export function animItem(id: string, order: number, asset: string, box: Box, frames: JsonObject): JsonObject {
  return { id, kind: 'image@1', layer: 'main', name: id, order: `a${order}`, params: { asset, box, fit: 'fill', alt: `Animation ${id}`, frames } };
}

export function animDoc(id: string, size: [number, number], items: readonly JsonObject[]): JsonObject {
  const byId: JsonObject = {};
  for (const item of items) byId[item['id'] as string] = item;
  return board(id, size, byId);
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render` answers (README: The surface under test).

interface Shown { asked: number; drawn: number | null; held: number }

function shown(value: JsonValue | undefined, what: string): Shown {
  const o = obj(value, what);
  return {
    asked: count(o['asked'], `${what}.asked`),
    drawn: o['drawn'] === null ? null : count(o['drawn'], `${what}.drawn`),
    held: count(o['held'], `${what}.held`),
  };
}

function animations(value: JsonValue | undefined, what: string, items: readonly string[]): Map<string, Shown> {
  const o = obj(value, what);
  const out = new Map<string, Shown>();
  for (const id of items) out.set(id, shown(o[id], `${what}.${id}`));
  return out;
}

export interface Vsync { k: number; t: number; presented: boolean; animations: Map<string, Shown> }

/** `frames`' answer read back: ok, one record per vsync, vsync k at k periods of `hz`, each naming every animated item in `items`. */
export function vsyncsOf(answer: JsonObject, what: string, vsyncs: number, hz: number, items: readonly string[]): Vsync[] {
  expect(answer['ok'], `${what}: frames answers ok: ${short(answer, 1500)}`).toBe(true);
  const list = arr(answer['vsyncs'], `${what}: vsyncs`);
  expect(list.length, `${what}: one record per vsync`).toBe(vsyncs);
  return list.map((value, k): Vsync => {
    const v = obj(value, `${what}: vsyncs[${k}]`);
    expect(v['t'], `${what}: vsyncs[${k}].t is vsync ${k}'s time, flicks`).toBe((k * FLICKS) / hz);
    expect(typeof v['presented'], `${what}: vsyncs[${k}].presented`).toBe('boolean');
    return { k, t: v['t'] as number, presented: v['presented'] as boolean, animations: animations(v['animations'], `${what}: vsyncs[${k}].animations`, items) };
  });
}

export interface LiveFrame { frame: number; phase: string; ui_ms: number; settling: boolean; animations: Map<string, Shown> }

/** `live`'s answer read back: ok, its frames numbered from 0 in phase order, one per move, each with its UI-thread time and every animated item in `items`. */
export function liveOf(answer: JsonObject, what: string, moves: number, items: readonly string[]): LiveFrame[] {
  expect(answer['ok'], `${what}: live answers ok: ${short(answer, 1500)}`).toBe(true);
  const phases = ['open', 'move', 'settle', 'redraw'];
  const frames = arr(answer['frames'], `${what}: frames`).map((value, k): LiveFrame => {
    const f = obj(value, `${what}: frames[${k}]`);
    expect(f['frame'], `${what}: frames[${k}].frame`).toBe(k);
    expect(phases, `${what}: frames[${k}].phase`).toContain(f['phase']);
    expect(typeof f['settling'], `${what}: frames[${k}].settling`).toBe('boolean');
    return {
      frame: k, phase: f['phase'] as string, ui_ms: num(f['ui_ms'], `${what}: frames[${k}].ui_ms`), settling: f['settling'] as boolean,
      animations: animations(f['animations'], `${what}: frames[${k}].animations`, items),
    };
  });
  const order = frames.map((f) => phases.indexOf(f.phase));
  expect(order, `${what}: the frames' phases run open, move, settle, redraw, in that order`).toEqual([...order].sort((a, b) => a - b));
  expect(frames.filter((f) => f.phase === 'move').length, `${what}: one frame per move`).toBe(moves);
  return frames;
}

/** `deep-canvas-render <subcommand>` on several request lines in one process: one answer line for each, in order. */
export function lines(bin: string, subcommand: string, inputs: readonly JsonValue[], timeoutMs = 900_000): JsonObject[] {
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: inputs.map((i) => `${JSON.stringify(i)}\n`).join(''), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const name = `deep-canvas-render ${subcommand}`;
  if (run.status !== 0) throw Error(`${name} exited ${run.status ?? run.signal}${run.error ? ` (${run.error.message})` : ''}:\n${(run.stderr ?? '').slice(-4000)}`);
  const out = run.stdout.split('\n').filter((line) => line !== '');
  expect(out.length, `${name}: one answer line for each of the ${inputs.length} request lines`).toBe(inputs.length);
  return out.map((line, k) => obj(JSON.parse(line) as JsonValue, `${name}: answer ${k}`));
}

// ---------------------------------------------------------------------------------------------------
// Resident memory: the bytes resident in a process and every process it started, read by `ps` while it runs, so a
// decoder in a worker process is counted as one in the renderer is.

function treeResident(root: number): number | null {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return null;
  const resident = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const [pid, ppid, kib] = [Number(m[1]), Number(m[2]), Number(m[3])];
    resident.set(pid, kib * 1024);
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  if (!resident.has(root)) return null;
  let sum = 0;
  const todo = [root];
  while (todo.length) {
    const pid = todo.pop()!;
    sum += resident.get(pid) ?? 0;
    todo.push(...(children.get(pid) ?? []));
  }
  return sum;
}

interface Sampled { answer: JsonObject; peak: number; samples: number }

/** `deep-canvas-render <subcommand>` on one request line, its process tree's resident memory read every 25 ms while it runs: its answer, and the most the tree held at one reading. */
export async function sampled(bin: string, subcommand: string, input: JsonValue, timeoutMs = 900_000): Promise<Sampled> {
  const child = spawn(bin, [subcommand], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
  let status: number | string | null = null;
  let closed = false;
  const done = new Promise<void>((resolve) => child.on('close', (code, signal) => { status = code ?? signal; closed = true; resolve(); }));
  child.stdin.on('error', () => { /* a process that exits before reading its line says why in its status */ });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  let peak = 0;
  let samples = 0;
  const deadline = Date.now() + timeoutMs;
  while (!closed) {
    const bytes = child.pid === undefined ? null : treeResident(child.pid);
    if (bytes !== null) { peak = Math.max(peak, bytes); samples++; }
    if (Date.now() > deadline) { child.kill('SIGKILL'); break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await done;
  const name = `deep-canvas-render ${subcommand}`;
  if (status !== 0) throw Error(`${name} exited ${String(status)}:\n${err}`);
  const answers = out.split('\n').filter((line) => line !== '');
  expect(answers.length, `${name}: one answer line for the one request line`).toBe(1);
  return { answer: obj(JSON.parse(answers[0]!) as JsonValue, `${name}: the answer`), peak, samples };
}

// ---------------------------------------------------------------------------------------------------
// The replica: `deep-drive` (#124), the debug build with the planted programs it reads from DEEP_DRIVE_PLANT, built
// once per file and copied out of target/, so another build can't replace it mid-run.

const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const DRIVE_BUILD = ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'];

export function useDrive(): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1489-bin-'));
    const r = spawnSync('cargo', DRIVE_BUILD, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) {
      const said = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n');
      error = `cargo ${DRIVE_BUILD.join(' ')} failed:\n${said.slice(0, 4000)}`;
    } else {
      error = '';
      copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', 'deep-drive'), join(dir, 'deep-drive'));
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    if (process.platform !== 'darwin') expect.fail(`INCONCLUSIVE: the replica draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`);
    expect(error, `it builds: cargo ${DRIVE_BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-drive');
  };
}

/** One `deep-drive --out <dir>` process: a call a line on stdin, its reply a line on stdout. */
class Replica {
  private buffer = '';
  private readonly waiting: ((line: JsonObject) => void)[] = [];
  private exited = false;
  private stderr = '';
  private constructor(private readonly child: ChildProcess, private readonly dir: string) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: JsonObject;
        try { line = JSON.parse(text) as JsonObject; } catch { line = { unparsed: text.slice(0, 2000) }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr = (this.stderr + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.stderr }); });
  }

  /** A replica process, planted when `plant` names a program, its home and output in a fresh folder; it must say it's ready. */
  static async start(bin: string, plant: string | undefined): Promise<Replica> {
    // Short, as #124's are: a socket path under the home must fit in 104 bytes.
    const dir = realpathSync(mkdtempSync('/tmp/dd1489-'));
    const home = join(dir, 'h');
    const out = join(dir, 'out');
    mkdirSync(home, { recursive: true });
    mkdirSync(out, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
      env[key] = value;
    }
    Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), LC_ALL: 'C' });
    if (plant !== undefined) env['DEEP_DRIVE_PLANT'] = plant;
    const child = spawn(bin, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const replica = new Replica(child, dir);
    const first = await replica.next(300_000);
    if (first['ready'] !== true) {
      await replica.stop();
      expect.fail(`deep-drive didn't say {"ready": true}${plant === undefined ? '' : ` with DEEP_DRIVE_PLANT=${plant}`}: ${JSON.stringify(first).slice(0, 400)}`);
    }
    return replica;
  }
  private next(timeoutMs: number): Promise<JsonObject> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.stderr });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: timeoutMs }), timeoutMs);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call that must succeed: its reply. */
  async must(args: JsonObject, what: string, timeoutMs = 1_800_000): Promise<JsonObject> {
    const answer = this.next(timeoutMs);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    expect(reply['ok'], `${what}: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
    return reply;
  }
  /** Stops the process by its PID and removes its folder. */
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 10_000;
    while (!this.exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!this.exited && this.child.pid) try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The replica's picture window (README: The surface under test, The replica): a replica in #1546's dirty mode on the
// arm `picture`, its clock run to 1 s, then to 4 s (the step a criterion reads), then a screenshot, then closed.

interface ReportFrame { frame: number; step: number; t: number; drawn: boolean; tiles: { changed: number; total: number } | null }
interface ReportStep { step: number; call: string; t: number; frames: number; drawn: number }
interface Report { read_back: string; steps: ReportStep[]; list: ReportFrame[] }
export interface PictureRun { report: Report; measured: ReportStep; frames: ReportFrame[]; shot: Image }

/** The window's size in points, at scale 1: the picture at its top-left corner, its centre at (32, 32) device px. */
const PICTURE_WINDOW: [number, number] = [128, 128];
const SECOND = FLICKS;

export async function pictureRun(bin: string, o: { picture: string; plant?: string; reducedMotion?: boolean }): Promise<PictureRun> {
  const replica = await Replica.start(bin, o.plant);
  try {
    const launch: JsonObject = { frames: 'dirty', arm: 'picture', picture: o.picture, size: PICTURE_WINDOW, scale: 1 };
    if (o.reducedMotion) launch['reduced_motion'] = true;
    const launched = await replica.must({ call: 'launch', launch }, `launch ${JSON.stringify(launch)}`);
    expect(launched['arm'], `launch answers its arm: ${JSON.stringify(launched).slice(0, 400)}`).toBe('picture');
    expect(launched['frames'], `launch answers frames: "dirty": ${JSON.stringify(launched).slice(0, 400)}`).toBe('dirty');
    const step = (args: JsonObject, what: string): Promise<JsonObject> => replica.must(args, what);
    await step({ call: 'wait_for', wait_for: { t: SECOND }, timeout: 60_000 }, 'the clock to 1 s');
    await step({ call: 'wait_for', wait_for: { t: 4 * SECOND }, timeout: 60_000 }, 'the clock to 4 s');
    const shot = await step({ call: 'screenshot', screenshot: {} }, 'a screenshot of the window');
    const image = decodePng(readFileSync(shot['path'] as string));
    const closed = await step({ call: 'close' }, 'close');
    const r = obj(closed['frames'] as JsonValue, 'close answers the frames report');
    const report: Report = {
      read_back: r['read_back'] as string,
      steps: arr(r['steps'], 'frames.steps').map((s, k) => {
        const o = obj(s, `frames.steps[${k}]`);
        return { step: count(o['step'], `frames.steps[${k}].step`), call: o['call'] as string, t: count(o['t'], `frames.steps[${k}].t`), frames: count(o['frames'], `frames.steps[${k}].frames`), drawn: count(o['drawn'], `frames.steps[${k}].drawn`) };
      }),
      list: arr(r['list'], 'frames.list').map((f, k) => {
        const o = obj(f, `frames.list[${k}]`);
        const tiles = o['tiles'] === null ? null : obj(o['tiles'], `frames.list[${k}].tiles`);
        return {
          frame: count(o['frame'], `frames.list[${k}].frame`), step: count(o['step'], `frames.list[${k}].step`), t: count(o['t'], `frames.list[${k}].t`),
          drawn: o['drawn'] === true,
          tiles: tiles === null ? null : { changed: count(tiles['changed'], `frames.list[${k}].tiles.changed`), total: count(tiles['total'], `frames.list[${k}].tiles.total`) },
        };
      }),
    };
    // The step that ran the clock from 1 s to 4 s: step 2, as #1546 numbers steps (every call after launch, from 1).
    const measured = report.steps.find((s) => s.step === 2);
    expect(measured, `the frames report holds step 2, the clock run from 1 s to 4 s: ${JSON.stringify(report.steps)}`).toBeDefined();
    expect(measured!.call, 'step 2 is the wait_for that ran the clock from 1 s to 4 s').toBe('wait_for');
    expect(measured!.t, 'step 2 ends at 4 s of the clock').toBe(4 * SECOND);
    expect(measured!.frames, 'step 2 passed 3 s of the clock, 180 frames at 60 a second').toBe(180);
    const frames = report.list.filter((f) => f.step === 2);
    expect(frames.filter((f) => f.drawn).length, 'the list and #1546\'s count agree on the frames step 2 drew').toBe(measured!.drawn);
    return { report, measured: measured!, frames, shot: image };
  } finally {
    await replica.stop();
  }
}

// ---------------------------------------------------------------------------------------------------
// The timing judge: scripts/benchmark.mjs's, as the perf lane judges a limit (five runs after warm-up, on a reference
// Mac on mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end no higher than
// the core count; elsewhere INCONCLUSIVE).

interface Benchmark {
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
export const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
export const oneMinuteLoad = (): number => loadavg()[0]!;
