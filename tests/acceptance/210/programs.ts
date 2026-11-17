// This suite's logic programs (README: The programs), as an agent would hand them over: WebAssembly bytes, each
// exporting `memory` (one page, its maximum its minimum), `init(seed: i64)`, `step(k: i64)` and the immutable i32
// globals `reads_at` and `writes_at` (and `emits_at` for the drum pad's item), with no imports (Logic `logic@1`:
// Exports). They are written here as bytes by a small encoder, since #533's assembler doesn't build `--locked` in place
// at this base (#555's README says why); each module is checked by Node's own WebAssembly before it is used.
//
// Offsets. The drum pad's item `hits` (deep-show) reads one control and writes one i32, so its offsets are the design's
// declaration order (Logic `logic@1`: "fills the program's read region in declaration order"; the region map lays the
// write and emit regions out the same way): the `notes` slot at the read region's start, `n` at the write region's,
// and the kind `hit`'s count at the emit region's start with its rows right after it (Logic: occurrences: "a u32
// count, then max_per_step rows of {a: u32, b: u32, its fields in declaration order}"). The deep-logic programs take
// their offsets from the layout `check` reports for their item (`layoutOf` in helpers.ts), as #533's do.

import { createHash } from 'node:crypto';
import type { Layout, Program } from '../533/helpers.ts';
import { entryAt } from '../533/helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The encoder

const uleb = (n: number): number[] => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const body = (i32Locals: number, code: number[]): number[] => {
  const b = [...(i32Locals ? [0x01, ...uleb(i32Locals), 0x7f] : [0x00]), ...code, 0x0b];
  return [...uleb(b.length), ...b];
};

/** The instructions the programs use. Local 0 is `step`'s parameter k (i64); locals 1 and up are i32. */
const op = {
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  f64zero: [0x44, 0, 0, 0, 0, 0, 0, 0, 0],
  get: (i: number): number[] => [0x20, ...uleb(i)],
  set: (i: number): number[] => [0x21, ...uleb(i)],
  i32load: [0x28, 0x02, 0x00],
  i64load: [0x29, 0x03, 0x00],
  f64load: [0x2b, 0x03, 0x00],
  i32store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  f64store: (offset = 0): number[] => [0x39, 0x03, ...uleb(offset)],
  add: [0x6a], mul: [0x6c], shl: [0x74], ltu: [0x49], leu: [0x4d], geu: [0x4f],
  f64FromU32: [0xb8], f64FromI64: [0xb9],
  block: [0x02, 0x40], loop: [0x03, 0x40], ifF64: [0x04, 0x7c], else: [0x05], end: [0x0b],
  br: (d: number): number[] => [0x0c, d], brIf: (d: number): number[] => [0x0d, d],
};

/** A module whose `step` runs `step` with `locals` i32 locals, exporting the globals given, in order. */
function module(label: string, globals: [string, number][], locals: number, step: number[]): Program {
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec(globals.map(([, v]) => [0x7f, 0x00, ...op.i32(v), 0x0b]))),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], ...globals.map(([g], i) => [...name(g), 0x03, ...uleb(i)]), [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body(0, []), body(locals, step)])),
  ]);
  if (!WebAssembly.validate(bytes)) throw Error(`this suite's encoder wrote an invalid module for ${label}`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  return { name: `${label}_${sha.slice(0, 8)}`, bytes, b64: bytes.toString('base64'), sha };
}

/** `count` loop iterations of `each(j)` for j = 0, 1, … while j < the i32 in local `bound` (or the constant). */
function forEach(j: number, bound: number[], each: number[]): number[] {
  return [
    ...op.i32(0), ...op.set(j),
    ...op.block, ...op.loop,
    ...op.get(j), ...bound, ...op.geu, ...op.brIf(1),
    ...each,
    ...op.get(j), ...op.i32(1), ...op.add, ...op.set(j),
    ...op.br(0), ...op.end, ...op.end,
  ];
}
/** An address `base + j × stride` (j in local `j`, stride a power of two given as its shift, or any stride). */
const at = (base: number, j: number, stride: number): number[] =>
  [...op.i32(base), ...op.get(j), ...(Number.isInteger(Math.log2(stride)) ? [...op.i32(Math.log2(stride)), ...op.shl] : [...op.i32(stride), ...op.mul]), ...op.add];

// ---------------------------------------------------------------------------------------------------
// The programs

/** A program for no layout: `check` of an item naming it reports the item's layout (`layoutOf`). */
export const layoutProbe = (): Program => module('layout_probe', [['reads_at', 0], ['writes_at', 32768]], 0, []);

const HITS = { reads: 0, writes: 4096, emits: 8192 } as const;
/**
 * The drum pad's `hits` (reads `notes`, a slider; writes `n: i32`; emits `hit {note: f64}`, at most 16 a step): each
 * step it emits one `hit` row for each `notes` entry it read, in the order read, the row's `a` the entry's place in the
 * step (0, 1, …), `b` 0 and `note` the entry's value, and adds how many it read to `n`. The `notes` slot: a u32 count
 * and 4 zero bytes, then each entry as a u32 player, 4 zero bytes and its f64 value (Logic `logic@1`).
 */
export function hitsProgram(): Program {
  const n = 1; const j = 2;
  const rows = HITS.emits + 4;
  return module('hits', [['reads_at', HITS.reads], ['writes_at', HITS.writes], ['emits_at', HITS.emits]], 2, [
    ...op.i32(HITS.reads), ...op.i32load, ...op.set(n),
    ...op.block, ...op.get(n), ...op.i32(16), ...op.leu, ...op.brIf(0), ...op.i32(16), ...op.set(n), ...op.end,
    ...op.i32(HITS.emits), ...op.get(n), ...op.i32store(),
    ...op.i32(HITS.writes), ...op.i32(HITS.writes), ...op.i32load, ...op.get(n), ...op.add, ...op.i32store(),
    ...forEach(j, op.get(n), [
      ...at(rows, j, 16), ...op.get(j), ...op.i32store(0),
      ...at(rows, j, 16), ...op.i32(0), ...op.i32store(4),
      ...at(rows, j, 16), ...at(HITS.reads + 16, j, 16), ...op.f64load, ...op.f64store(8),
    ]),
  ]);
}

const WRITES = 4096;
/** The value at place `j` of a reading slot or 0 past its count (local `n`), as an f64 pushed on the stack. */
const orZero = (j: number, n: number, value: number[]): number[] => [...op.get(j), ...op.get(n), ...op.ltu, ...op.ifF64, ...value, ...op.else, ...op.f64zero, ...op.end];

/** The sensor piece's `gauge` (reads `reading:sensor`, a scalar source, `each`, at most 16 a step; writes `values: f64 ×
 * 16`, `as_of: f64 × 16`, `count: f64`): each step it writes how many values it read and each value with its as-of time
 * (µs, as an f64), in the order read, 0 past the count. The slot: a u32 count and 4 zero bytes, then each value as an
 * f64 followed by its as-of time as an i64 (Logic: readings). */
export const GAUGE_WRITES = { values: { type: 'f64', count: 16 }, as_of: { type: 'f64', count: 16 }, count: { type: 'f64' } } as const;
export function gaugeProgram(l: Layout, reading: string): Program {
  const r = entryAt(l, 'reads', reading).offset;
  const [v, a, c] = (['values', 'as_of', 'count'] as const).map((w) => WRITES + entryAt(l, 'writes', w).offset) as [number, number, number];
  const n = 1; const j = 2;
  return module('gauge', [['reads_at', 0], ['writes_at', WRITES]], 2, [
    ...op.i32(r), ...op.i32load, ...op.set(n),
    ...op.i32(c), ...op.get(n), ...op.f64FromU32, ...op.f64store(),
    ...forEach(j, op.i32(16), [
      ...at(v, j, 8), ...orZero(j, n, [...at(r + 8, j, 16), ...op.f64load]), ...op.f64store(),
      ...at(a, j, 8), ...orZero(j, n, [...at(r + 16, j, 16), ...op.i64load, ...op.f64FromI64]), ...op.f64store(),
    ]),
  ]);
}

/** The tilt piece's `tilt` (reads `reading:imu`, a source of shape vec of 3, `each`, at most 4 a step; writes `seen:
 * f64 × 12`, `as_of: f64 × 4`, `count: f64`): each step it writes how many values it read and each value's three
 * numbers (value j's at 3j, 3j + 1, 3j + 2) and as-of time, 0 past the count. The slot: a u32 count and 4 zero bytes,
 * then each value as three f64s followed by its as-of time as an i64, 32 bytes a value (Logic: readings). */
export const TILT_WRITES = { seen: { type: 'f64', count: 12 }, as_of: { type: 'f64', count: 4 }, count: { type: 'f64' } } as const;
export function tiltProgram(l: Layout, reading: string): Program {
  const r = entryAt(l, 'reads', reading).offset;
  const [s, a, c] = (['seen', 'as_of', 'count'] as const).map((w) => WRITES + entryAt(l, 'writes', w).offset) as [number, number, number];
  const n = 1; const j = 2;
  const numbers = [0, 1, 2].flatMap((k) => [...at(s + 8 * k, j, 24), ...orZero(j, n, [...at(r + 8 + 8 * k, j, 32), ...op.f64load]), ...op.f64store()]);
  return module('tilt', [['reads_at', 0], ['writes_at', WRITES]], 2, [
    ...op.i32(r), ...op.i32load, ...op.set(n),
    ...op.i32(c), ...op.get(n), ...op.f64FromU32, ...op.f64store(),
    ...forEach(j, op.i32(4), [
      ...numbers,
      ...at(a, j, 8), ...orZero(j, n, [...at(r + 32, j, 32), ...op.i64load, ...op.f64FromI64]), ...op.f64store(),
    ]),
  ]);
}
