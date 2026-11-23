// AC1's oracle, written as reviewed test code from the OpenType specification alone: a glyph's outline in a TrueType
// font at a location on its axes, read from the font file itself (`fvar`'s axes, `avar`'s maps, `gvar`'s deltas with
// the inferred deltas of untouched points, `glyf`'s contours, `cmap`'s characters). It shares nothing with the
// program's shaper or outline reader, so a run's outlines are compared with the instance the issue names, never with
// the program's own word for it. Simple glyphs only: a composite glyph is refused by name, and the tests' texts hold
// none (README: The oracle).

import { readFileSync } from 'node:fs';

export interface Axis { tag: string; min: number; def: number; max: number }
export interface Font {
  file: string;
  bytes: Buffer;
  tables: Map<string, { offset: number; length: number }>;
  upm: number;
  numGlyphs: number;
  /** `fvar`'s axes, in order; empty for a static face. */
  axes: Axis[];
}
/** One point of a contour, in font units, y up. */
export interface Point { x: number; y: number; on: boolean }

function table(font: Font, tag: string): number {
  const t = font.tables.get(tag);
  if (!t) throw Error(`${font.file} has no ${tag} table`);
  return t.offset;
}

/** The font file at `file`: its tables, units per em and axes. */
export function readFont(file: string): Font {
  const bytes = readFileSync(file);
  const tables = new Map<string, { offset: number; length: number }>();
  const count = bytes.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const o = 12 + 16 * i;
    tables.set(bytes.toString('latin1', o, o + 4), { offset: bytes.readUInt32BE(o + 8), length: bytes.readUInt32BE(o + 12) });
  }
  const font: Font = { file, bytes, tables, upm: 0, numGlyphs: 0, axes: [] };
  font.upm = bytes.readUInt16BE(table(font, 'head') + 18);
  font.numGlyphs = bytes.readUInt16BE(table(font, 'maxp') + 4);
  if (tables.has('fvar')) {
    const f = table(font, 'fvar');
    const at = f + bytes.readUInt16BE(f + 4);
    const fixed = (o: number): number => bytes.readInt32BE(o) / 65536;
    for (let i = 0; i < bytes.readUInt16BE(f + 8); i++) {
      const o = at + i * bytes.readUInt16BE(f + 10);
      font.axes.push({ tag: bytes.toString('latin1', o, o + 4), min: fixed(o + 4), def: fixed(o + 8), max: fixed(o + 12) });
    }
  }
  return font;
}

/** The glyph `cmap` maps `char` to (format 4 or 12 of a Unicode subtable); 0 when none. */
export function glyphOf(font: Font, char: string): number {
  const b = font.bytes;
  const c = table(font, 'cmap');
  const code = char.codePointAt(0)!;
  const subtables = Array.from({ length: b.readUInt16BE(c + 2) }, (_, i) => ({
    platform: b.readUInt16BE(c + 4 + 8 * i), encoding: b.readUInt16BE(c + 6 + 8 * i), at: c + b.readUInt32BE(c + 8 + 8 * i),
  })).filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
  for (const { at } of subtables) {
    const format = b.readUInt16BE(at);
    if (format === 12) {
      for (let i = 0, n = b.readUInt32BE(at + 12); i < n; i++) {
        const o = at + 16 + 12 * i;
        const start = b.readUInt32BE(o); const end = b.readUInt32BE(o + 4);
        if (code >= start && code <= end) return b.readUInt32BE(o + 8) + code - start;
      }
    } else if (format === 4 && code <= 0xffff) {
      const segs = b.readUInt16BE(at + 6) / 2;
      const ends = at + 14; const starts = ends + 2 * segs + 2; const deltas = starts + 2 * segs; const ranges = deltas + 2 * segs;
      for (let i = 0; i < segs; i++) {
        if (code > b.readUInt16BE(ends + 2 * i)) continue;
        const start = b.readUInt16BE(starts + 2 * i);
        if (code < start) break;
        const range = b.readUInt16BE(ranges + 2 * i);
        const delta = b.readInt16BE(deltas + 2 * i);
        if (range === 0) return (code + delta) & 0xffff;
        const g = b.readUInt16BE(ranges + 2 * i + range + 2 * (code - start));
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
  }
  return 0;
}

const f2dot14 = (v: number): number => Math.round(v * 16384);

/**
 * The normalized coordinates (F2Dot14 integers, in `fvar`'s axis order) of a location given in user values by axis
 * tag; an axis the location doesn't name sits at its default. Default normalization, clamped, then `avar`'s map.
 */
export function normalize(font: Font, location: Record<string, number>): number[] {
  const coords = font.axes.map((a) => {
    const v = Math.min(a.max, Math.max(a.min, location[a.tag] ?? a.def));
    const n = v < a.def ? (v - a.def) / (a.def - a.min) : v > a.def ? (v - a.def) / (a.max - a.def) : 0;
    return f2dot14(n);
  });
  if (!font.tables.has('avar')) return coords;
  const b = font.bytes;
  let o = table(font, 'avar') + 8;
  return coords.map((n) => {
    const pairs = b.readUInt16BE(o); o += 2;
    const map = Array.from({ length: pairs }, (_, k) => [b.readInt16BE(o + 4 * k), b.readInt16BE(o + 4 * k + 2)] as const);
    o += 4 * pairs;
    if (pairs < 3) return n;
    for (let k = 1; k < map.length; k++) {
      const [x1, y1] = map[k]!; const [x0, y0] = map[k - 1]!;
      if (n <= x1) return x1 === x0 ? y1 : y0 + Math.round(((y1 - y0) * (n - x0)) / (x1 - x0));
    }
    return n;
  });
}

/** A simple glyph's points (font units, y up), its contours' last point indices. Composite glyphs are refused. */
function simpleGlyph(font: Font, glyph: number): { points: Point[]; ends: number[] } {
  const b = font.bytes;
  if (glyph >= font.numGlyphs) throw Error(`${font.file} has no glyph ${glyph}`);
  const long = b.readInt16BE(table(font, 'head') + 50) === 1;
  const loca = table(font, 'loca');
  const [start, end] = long ? [b.readUInt32BE(loca + 4 * glyph), b.readUInt32BE(loca + 4 * glyph + 4)] : [2 * b.readUInt16BE(loca + 2 * glyph), 2 * b.readUInt16BE(loca + 2 * glyph + 2)];
  if (end === start) return { points: [], ends: [] };
  const at = table(font, 'glyf') + start;
  const contours = b.readInt16BE(at);
  if (contours < 0) throw Error(`glyph ${glyph} of ${font.file} is a composite glyph, which this reference doesn't read`);
  const ends = Array.from({ length: contours }, (_, i) => b.readUInt16BE(at + 10 + 2 * i));
  const n = contours ? ends[contours - 1]! + 1 : 0;
  let o = at + 10 + 2 * contours;
  o += 2 + b.readUInt16BE(o);
  const flags: number[] = [];
  while (flags.length < n) {
    const flag = b[o++]!;
    flags.push(flag);
    if (flag & 8) for (let r = b[o++]!; r > 0; r--) flags.push(flag);
  }
  const read = (short: number, same: number): number[] => {
    let v = 0;
    return flags.map((flag) => {
      if (flag & short) { const d = b[o++]!; v += flag & same ? d : -d; } else if (!(flag & same)) { v += b.readInt16BE(o); o += 2; }
      return v;
    });
  };
  const xs = read(2, 16);
  const ys = read(4, 32);
  return { points: flags.map((flag, i) => ({ x: xs[i]!, y: ys[i]!, on: (flag & 1) === 1 })), ends };
}

/** Packed point numbers at `o`: the list, or null for "every point", and where the data after them starts. */
function packedPoints(b: Buffer, o: number): { points: number[] | null; next: number } {
  let count = b[o++]!;
  if (count === 0) return { points: null, next: o };
  if (count & 0x80) count = ((count & 0x7f) << 8) | b[o++]!;
  const points: number[] = [];
  let last = 0;
  while (points.length < count) {
    const control = b[o++]!;
    const words = (control & 0x80) !== 0;
    for (let r = (control & 0x7f) + 1; r > 0 && points.length < count; r--) {
      last += words ? b.readUInt16BE(o) : b[o]!;
      o += words ? 2 : 1;
      points.push(last);
    }
  }
  return { points, next: o };
}

/** `count` packed deltas at `o`, and where the data after them starts. */
function packedDeltas(b: Buffer, o: number, count: number): { deltas: number[]; next: number } {
  const deltas: number[] = [];
  while (deltas.length < count) {
    const control = b[o++]!;
    const run = (control & 0x3f) + 1;
    for (let r = 0; r < run; r++) {
      if (control & 0x80) deltas.push(0);
      else if (control & 0x40) { deltas.push(b.readInt16BE(o)); o += 2; } else { deltas.push(b.readInt8(o)); o += 1; }
    }
  }
  return { deltas: deltas.slice(0, count), next: o };
}

/** A tuple's scalar at `coords` (F2Dot14 integers), with its intermediate region when it has one. */
function scalar(coords: number[], peak: number[], start: number[] | null, end: number[] | null): number {
  let s = 1;
  for (let i = 0; i < coords.length; i++) {
    const p = peak[i]!; const v = coords[i]!;
    if (p === 0) continue;
    if (v === 0) return 0;
    if (v === p) continue;
    if (start && end) {
      const lo = start[i]!; const hi = end[i]!;
      if (v < lo || v > hi) return 0;
      s *= v < p ? (v - lo) / (p - lo) : (hi - v) / (hi - p);
    } else {
      if (v < Math.min(0, p) || v > Math.max(0, p)) return 0;
      s *= v / p;
    }
  }
  return s;
}

/** The deltas of untouched points of each contour, inferred from its touched ones (the spec's IUP), on one axis. */
function infer(orig: number[], delta: number[], touched: boolean[], ends: number[]): void {
  let first = 0;
  for (const last of ends) {
    const touchedHere = [];
    for (let i = first; i <= last; i++) if (touched[i]) touchedHere.push(i);
    if (touchedHere.length > 0 && touchedHere.length < last - first + 1) {
      for (let k = 0; k < touchedHere.length; k++) {
        const a = touchedHere[k]!; const z = touchedHere[(k + 1) % touchedHere.length]!;
        // The untouched points after a and before z, in contour order, wrapping.
        let [i1, i2] = [a, z];
        if (orig[i1]! > orig[i2]!) [i1, i2] = [i2, i1];
        const [in1, in2, d1, d2] = [orig[i1]!, orig[i2]!, delta[i1]!, delta[i2]!];
        for (let i = a === last ? first : a + 1; i !== z; i = i === last ? first : i + 1) {
          const v = orig[i]!;
          // Two references at one coordinate with different deltas give no delta; with one delta, that delta.
          if (in1 === in2) delta[i] = d1 === d2 ? d1 : 0;
          else if (v <= in1) delta[i] = d1;
          else if (v >= in2) delta[i] = d2;
          else delta[i] = d1 + ((v - in1) * (d2 - d1)) / (in2 - in1);
        }
      }
    }
    first = last + 1;
  }
}

/**
 * The glyph's contours at `coords` (F2Dot14 integers in `fvar`'s order; empty for the default instance), in font
 * units, y up: its points moved by every `gvar` tuple whose region holds the location, scaled by the tuple's scalar,
 * untouched points' deltas inferred per tuple. Fractional deltas are kept, not rounded.
 */
export function contoursAt(font: Font, glyph: number, coords: number[]): Point[][] {
  const { points, ends } = simpleGlyph(font, glyph);
  const n = points.length;
  const dx = new Array<number>(n).fill(0);
  const dy = new Array<number>(n).fill(0);
  if (coords.some((c) => c !== 0) && n > 0) {
    const b = font.bytes;
    const g = table(font, 'gvar');
    const axisCount = b.readUInt16BE(g + 4);
    if (axisCount !== coords.length) throw Error(`gvar has ${axisCount} axes, the location ${coords.length}`);
    const sharedAt = g + b.readUInt32BE(g + 8);
    const shared = (k: number): number[] => Array.from({ length: axisCount }, (_, i) => b.readInt16BE(sharedAt + 2 * (k * axisCount + i)));
    const longOffsets = (b.readUInt16BE(g + 14) & 1) === 1;
    const dataAt = g + b.readUInt32BE(g + 16);
    const offset = (k: number): number => (longOffsets ? b.readUInt32BE(g + 20 + 4 * k) : 2 * b.readUInt16BE(g + 20 + 2 * k));
    const [from, to] = [offset(glyph), offset(glyph + 1)];
    if (to > from) {
      const at = dataAt + from;
      const header = b.readUInt16BE(at);
      let serialized = at + b.readUInt16BE(at + 2);
      let sharedPoints: number[] | null = null;
      if (header & 0x8000) ({ points: sharedPoints, next: serialized } = packedPoints(b, serialized));
      let h = at + 4;
      const ox = points.map((p) => p.x);
      const oy = points.map((p) => p.y);
      for (let t = 0; t < (header & 0x0fff); t++) {
        const size = b.readUInt16BE(h);
        const index = b.readUInt16BE(h + 2);
        h += 4;
        let peak: number[];
        if (index & 0x8000) { peak = Array.from({ length: axisCount }, (_, i) => b.readInt16BE(h + 2 * i)); h += 2 * axisCount; } else peak = shared(index & 0x0fff);
        let start: number[] | null = null; let end: number[] | null = null;
        if (index & 0x4000) {
          start = Array.from({ length: axisCount }, (_, i) => b.readInt16BE(h + 2 * i)); h += 2 * axisCount;
          end = Array.from({ length: axisCount }, (_, i) => b.readInt16BE(h + 2 * i)); h += 2 * axisCount;
        }
        const s = scalar(coords, peak, start, end);
        let o = serialized;
        serialized += size;
        if (s === 0) continue;
        let which = sharedPoints;
        if (index & 0x2000) ({ points: which, next: o } = packedPoints(b, o));
        const count = which === null ? n + 4 : which.length;
        const xs = packedDeltas(b, o, count);
        const ys = packedDeltas(b, xs.next, count);
        const tx = new Array<number>(n).fill(0);
        const ty = new Array<number>(n).fill(0);
        const touched = new Array<boolean>(n).fill(which === null);
        (which ?? Array.from({ length: n + 4 }, (_, i) => i)).forEach((p, k) => {
          if (p >= n) return; // a phantom point: the advance and side bearings, not the outline
          tx[p] = xs.deltas[k]!; ty[p] = ys.deltas[k]!; touched[p] = true;
        });
        if (which !== null) { infer(ox, tx, touched, ends); infer(oy, ty, touched, ends); }
        for (let i = 0; i < n; i++) { dx[i] = dx[i]! + s * tx[i]!; dy[i] = dy[i]! + s * ty[i]!; }
      }
    }
  }
  const moved = points.map((p, i) => ({ x: p.x + dx[i]!, y: p.y + dy[i]!, on: p.on }));
  let first = 0;
  return ends.map((last) => { const c = moved.slice(first, last + 1); first = last + 1; return c; });
}

/** An outline's points in logical px at `size` u, y down: its on-curve points (with the midpoints a quadratic contour
 * implies between two off-curve points) and its off-curve control points, as the drawn path's anchors and controls. */
export interface PointSet { anchors: [number, number][]; controls: [number, number][] }

export function pointSet(contours: Point[][], size: number, upm: number): PointSet {
  const k = size / upm;
  const px = (p: { x: number; y: number }): [number, number] => [p.x * k, -p.y * k];
  const anchors: [number, number][] = [];
  const controls: [number, number][] = [];
  for (const c of contours) {
    c.forEach((p, i) => {
      if (p.on) { anchors.push(px(p)); return; }
      controls.push(px(p));
      const next = c[(i + 1) % c.length]!;
      if (!next.on) anchors.push(px({ x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }));
    });
  }
  return { anchors, controls };
}
