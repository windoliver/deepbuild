// Test-side tools for the #1826 acceptance tests: the binaries (deep-graph, deep-canvas-render) built once per file and
// driven by JSON lines; the three fixtures, written here from the issue; the checks each criterion names, computed from
// the fixtures and the issue's numbers alone; and PNG reading for the taste call. Nothing here stands in for a layout.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** `[x, y, w, h]` in u, y down. */
export type Box = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1826 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file (debug, `--locked`), copied out; a failed build fails each test that uses it.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] || join(REPO, 'target');

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const lines = r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(0, 4000)}`;
}

export type Bin = 'deep-graph' | 'deep-canvas-render';
export function useBins(bins: Bin[]): (bin: Bin) => string {
  const made = new Map<Bin, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1826-bins-'));
    for (const bin of bins) {
      const error = cargo(['build', '--locked', '--bin', bin]);
      const path = join(dir, bin);
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(bin)), path);
      made.set(bin, { path, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin) => {
    const m = made.get(bin);
    if (!m) throw Error(`the file didn't list the build ${bin}`);
    expect(m.error, `the binary builds: ${bin}`).toBe('');
    return m.path;
  };
}

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-1826-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One run of `bin args`, the inputs as JSON lines on stdin: exit 0, one line out per line in. Returns the raw lines. */
export function rawLines(bin: string, args: string[], inputs: JsonValue[]): string[] {
  const r = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  if (r.error) throw Error(`${name}: ${r.error.message}`);
  expect(r.status, `${name} exits 0: ${(r.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
  return out;
}
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  return rawLines(bin, args, inputs).map((l, i) => obj(JSON.parse(l) as JsonValue, `${args.join(' ')}: answer ${i}`));
}
/** One `deep-graph layout` line that must be accepted (`ok: true`). */
export function accepted(bin: string, input: JsonValue, what: string): JsonObject {
  const [out] = lines(bin, ['layout'], [input]);
  expect(out!['ok'], `${what}: accepted, got ${show(out, 2500)}`).toBe(true);
  return out!;
}

// ---------------------------------------------------------------------------------------------------
// Layout memory `{id → [rank, order, x, y]}` and the treemap's `boxes` `{id → [x, y, w, h]}`.

export interface Entry { rank: number; order: number; x: number; y: number }
export function memoryOf(value: JsonValue | undefined, what: string): Record<string, Entry> {
  const m = obj(value, what);
  return Object.fromEntries(Object.entries(m).map(([id, v]) => {
    const t = arr(v, `${what}[${id}]`);
    expect(t.length, `${what}[${id}] is [rank, order, x, y]`).toBe(4);
    const [rank, order, x, y] = t.map((n, i) => num(n, `${what}[${id}][${i}]`));
    return [id, { rank: rank!, order: order!, x: x!, y: y! }];
  }));
}
export function boxesOf(value: JsonValue | undefined, what: string): Record<string, Box> {
  const m = obj(value, what);
  return Object.fromEntries(Object.entries(m).map(([id, v]) => {
    const b = arr(v, `${what}[${id}]`);
    expect(b.length, `${what}[${id}] is [x, y, w, h]`).toBe(4);
    return [id, b.map((n, i) => num(n, `${what}[${id}][${i}]`)) as Box];
  }));
}
/** Same bits: `Object.is` on each of rank, order, x and y. */
export const sameEntry = (a: Entry | undefined, b: Entry | undefined): boolean =>
  !!a && !!b && Object.is(a.rank, b.rank) && Object.is(a.order, b.order) && Object.is(a.x, b.x) && Object.is(a.y, b.y);
export const entryText = (e: Entry | undefined): string => (e ? show([e.rank, e.order, e.x, e.y]) : 'missing');

// ---------------------------------------------------------------------------------------------------
// Fixtures (written from the issue; README: Fixtures). Node boxes 40 × 24 u; spacing left at the design's defaults
// (node 24, rank 48).

export const W = 40;
export const H = 24;
export const SPACING_NODE = 24;
export const SPACING_RANK = 48;
const node = (id: string, extra: JsonObject = {}): JsonObject => ({ id, kind: 'step', w: W, h: H, ...extra });
const edge = (id: string, a: string, b: string): JsonObject => ({ id, a, b, kind: 'flow' });

/** The 7-node binary tree, its IDs in-order numbered so ID order is not depth order: n4 the root, n2 and n6 its
 *  children, n1 n3 n5 n7 the leaves. Rows are listed out of ID order. */
export const TREE_NODES = ['n6', 'n1', 'n4', 'n7', 'n3', 'n2', 'n5'].map((id) => node(id));
export const TREE_EDGES = [edge('e3', 'n2', 'n3'), edge('e1', 'n4', 'n2'), edge('e6', 'n6', 'n7'), edge('e2', 'n4', 'n6'), edge('e5', 'n6', 'n5'), edge('e4', 'n2', 'n1')];
/** The one more edge that closes a cycle: leaf n1 back to the root n4 (n4 → n2 → n1 → n4). */
export const CYCLE_EDGE = edge('e7', 'n1', 'n4');
/** Criterion 4's leaf, added under leaf n3. */
export const ADDED_LEAF = node('n8');
export const ADDED_EDGE = edge('e8', 'n3', 'n8');
export const TREE_LAYOUT: JsonObject = { algo: 'tree', direction: 'down', seed: 1826 };
export const treeLine = (extra: JsonObject = {}): JsonObject => ({ graph: { nodes: TREE_NODES, edges: TREE_EDGES }, layout: TREE_LAYOUT, ...extra });

/** The 4 treemap leaves, `size` 1, 1, 2 and 4 in ID order, no groups, no edges, in a 400 × 200 u box. */
export const TREEMAP_SIZES: Record<string, number> = { t1: 1, t2: 1, t3: 2, t4: 4 };
export const TREEMAP_BOX: Box = [0, 0, 400, 200];
export const TREEMAP_NODES = ['t3', 't1', 't4', 't2'].map((id) => node(id, { size: TREEMAP_SIZES[id]! }));
export const TREEMAP_LAYOUT: JsonObject = { algo: 'treemap', direction: 'down', seed: 1826, box: TREEMAP_BOX };
export const treemapLine = (extra: JsonObject = {}): JsonObject => ({ graph: { nodes: TREEMAP_NODES, edges: [] }, layout: TREEMAP_LAYOUT, ...extra });

/** The grid: g01 … g10, listed shuffled; the 11th, g11, sorts last. */
export const GRID_IDS = ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g09', 'g10'];
export const GRID_NODES = ['g07', 'g02', 'g10', 'g05', 'g01', 'g09', 'g04', 'g08', 'g03', 'g06'].map((id) => node(id));
export const GRID_ELEVENTH = node('g11');
export const GRID_LAYOUT: JsonObject = { algo: 'grid', direction: 'down', seed: 1826 };

// ---------------------------------------------------------------------------------------------------
// The checks, each the one that holds the honest layout and must fail on the planted one.

const FLOAT = 1e-9;
const centre = (e: Entry): number => e.x + W / 2;

/**
 * The tree check of criterion 1, node by node in stable-ID order: its rank is its depth in the fixture's tree; a child's
 * box top is 48 u below its parent's box bottom (direction down); a parent's centre x is its children's mean centre x
 * within 0.5 u; siblings' boxes stand at least spacing.node apart. Each problem starts with the node's ID.
 */
export function treeProblems(memory: Record<string, Entry>, edges: JsonObject[] = TREE_EDGES): string[] {
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    parent.set(String(e['b']), String(e['a']));
    children.set(String(e['a']), [...(children.get(String(e['a'])) ?? []), String(e['b'])]);
  }
  const ids = [...new Set([...parent.keys(), ...children.keys()])].sort();
  const depth = (id: string): number => (parent.has(id) ? depth(parent.get(id)!) + 1 : 0);
  const out: string[] = [];
  for (const id of ids) {
    const p = memory[id];
    if (!p) { out.push(`${id}: missing from the memory`); continue; }
    if (p.rank !== depth(id)) out.push(`${id}: rank ${p.rank}, but its depth is ${depth(id)}`);
    const up = parent.get(id);
    if (up && memory[up]) {
      const gap = p.y - (memory[up]!.y + H);
      if (Math.abs(gap - SPACING_RANK) > FLOAT) out.push(`${id}: ${gap} u below its parent ${up}, not ${SPACING_RANK}`);
    }
    const kids = (children.get(id) ?? []).filter((k) => memory[k]);
    if (kids.length > 0) {
      const mean = kids.reduce((s, k) => s + centre(memory[k]!), 0) / kids.length;
      if (Math.abs(centre(p) - mean) > 0.5) out.push(`${id}: centre x ${centre(p)}, its children's mean ${mean}, off by more than 0.5 u`);
      const row = kids.map((k) => memory[k]!.x).sort((a, b) => a - b);
      for (let i = 1; i < row.length; i++) {
        if (row[i]! - (row[i - 1]! + W) < SPACING_NODE - FLOAT) out.push(`${id}: its children stand ${row[i]! - (row[i - 1]! + W)} u apart, less than spacing.node ${SPACING_NODE}`);
      }
    }
  }
  return out;
}

/**
 * The treemap check of criterion 2, leaf by leaf in stable-ID order: its rectangle's area is its share of the box,
 * `size / Σ size × 400 × 200`, within 0.5%, and lies in the box within 0.5 u; then the rectangles tile the box: no two
 * overlap (beyond 1e-6 u, float rounding) and no gap wider than 0.5 u is left. Each problem names its leaf or leaves.
 */
export function treemapProblems(boxes: Record<string, Box>): string[] {
  const [bx, by, bw, bh] = TREEMAP_BOX;
  const total = Object.values(TREEMAP_SIZES).reduce((s, v) => s + v, 0);
  const ids = Object.keys(TREEMAP_SIZES).sort();
  const out: string[] = [];
  for (const id of ids) {
    const b = boxes[id];
    if (!b) { out.push(`${id}: no rectangle`); continue; }
    const want = (TREEMAP_SIZES[id]! / total) * bw * bh;
    const area = b[2] * b[3];
    if (!(b[2] >= 0 && b[3] >= 0) || Math.abs(area - want) > 0.005 * want) out.push(`${id}: area ${area} u², its size ${TREEMAP_SIZES[id]} asks ${want} u² (±0.5%)`);
    if (b[0] < bx - 0.5 || b[1] < by - 0.5 || b[0] + b[2] > bx + bw + 0.5 || b[1] + b[3] > by + bh + 0.5) out.push(`${id}: ${show(b)} leaves the box ${show(TREEMAP_BOX)}`);
  }
  const placed = ids.filter((id) => boxes[id]);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const [a, c] = [boxes[placed[i]!]!, boxes[placed[j]!]!];
      const dx = Math.min(a[0] + a[2], c[0] + c[2]) - Math.max(a[0], c[0]);
      const dy = Math.min(a[1] + a[3], c[1] + c[3]) - Math.max(a[1], c[1]);
      if (dx > 1e-6 && dy > 1e-6) out.push(`${placed[i]} and ${placed[j]}: overlap by ${dx} × ${dy} u`);
    }
  }
  // Gaps: each rectangle grown by 0.25 u a side, the box shrunk by 0.25 u a side; any cell of the box the grown
  // rectangles leave uncovered is a gap wider than 0.5 u.
  const grown = placed.map((id) => { const b = boxes[id]!; return [b[0] - 0.25, b[1] - 0.25, b[0] + b[2] + 0.25, b[1] + b[3] + 0.25]; });
  const [x0, y0, x1, y1] = [bx + 0.25, by + 0.25, bx + bw - 0.25, by + bh - 0.25];
  const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const xs = [...new Set([x0, x1, ...grown.flatMap((g) => [clip(g[0]!, x0, x1), clip(g[2]!, x0, x1)])])].sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...grown.flatMap((g) => [clip(g[1]!, y0, y1), clip(g[3]!, y0, y1)])])].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    for (let j = 1; j < ys.length; j++) {
      const [cx, cy] = [(xs[i - 1]! + xs[i]!) / 2, (ys[j - 1]! + ys[j]!) / 2];
      if (!grown.some((g) => g[0]! <= cx && cx <= g[2]! && g[1]! <= cy && cy <= g[3]!)) {
        out.push(`a gap over 0.5 u in the box at [${xs[i - 1]}, ${ys[j - 1]}] to [${xs[i]}, ${ys[j]}], next to ${placed.join(', ')}`);
        return out;
      }
    }
  }
  return out;
}

/** The grid's rows as drawn: nodes grouped by equal y, top to bottom, each row left to right. */
export function gridRows(memory: Record<string, Entry>): string[][] {
  const byY = new Map<number, string[]>();
  for (const [id, e] of Object.entries(memory)) byY.set(e.y, [...(byY.get(e.y) ?? []), id]);
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids.sort((a, b) => memory[a]!.x - memory[b]!.x));
}

// ---------------------------------------------------------------------------------------------------
// The taste call: documents, PNGs, INCONCLUSIVE.

export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A document holding one graph@1 item (the envelope as #399's suite writes it). */
export function graphDoc(id: string, title: string, description: string, size: [number, number], graph: JsonObject, layout: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: { g: { id: 'g', kind: 'graph@1', name: 'Graph', layer: 'main', order: 'a0', params: { graph, layout } } },
  };
}

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** 8-bit RGB or RGBA, no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
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
export const readPng = (path: string): Image => decodePng(readFileSync(path));
/** Pixels that differ from the most common color (the ground). */
export function inked(im: Image): number {
  const counts = new Map<number, number>();
  const at = (i: number): number => (im.rgba[i]! << 16) | (im.rgba[i + 1]! << 8) | im.rgba[i + 2]!;
  for (let i = 0; i < im.rgba.length; i += 4) counts.set(at(i), (counts.get(at(i)) ?? 0) + 1);
  const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  let n = 0;
  for (let i = 0; i < im.rgba.length; i += 4) if (at(i) !== ground) n++;
  return n;
}
