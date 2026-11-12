// Test-side tools for the #1486 acceptance tests (README: Surfaces this suite names): the build, `deep-canvas-render`
// driven by JSON lines, the pictures the tests make (1024 × 640 JPEGs and PNGs, encoded here in code), the stores they
// are read from, the grid document and its geometry, the `live` report read back and checked, PNG reading and writing,
// and the reference-Mac judge the timing goes through (copied from tests/acceptance/1485, which copied
// scripts/benchmark.mjs). Nothing here stands in for a decoder, a level, a queue or a cache.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/1486 is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs (scripts/proof-change.mjs's, from the issue's text), so each test is traced to its criterion. */
export const AC = {
  1: 'AC1 #1486.38c05d85',
  2: 'AC2 #1486.a0330377',
  3: 'AC3 #1486.36b0c465',
  4: 'AC4 #1486.0be6d156',
  5: 'AC5 #1486.b1bef80e',
  6: 'AC6 #1486.427b5b13',
  7: 'AC7 #1486.0381bfcf',
  8: 'AC8 #1486.9e82ff7a',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${short(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${short(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${short(value)}`).toBe(true);
  return value as number;
}
/** A count: a whole number at or above 0. */
export function count(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isInteger(value) && value >= 0, `${what} is a count (a whole number ≥ 0), got ${short(value)}`).toBe(true);
  return value as number;
}
export function short(value: JsonValue | undefined, n = 600): string {
  return JSON.stringify(value)?.slice(0, n) ?? 'undefined';
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const MiB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// The pictures: 1024 × 640, picture n even a JPEG and odd a PNG. Each is a smooth two-color gradient in its own hues
// (the golden angle apart), a saturated disc of radius 200 px at the centre, n in white seven-segment digits inside the
// disc, and two bands of one-pixel stripes (black and white columns at the top, rows at the bottom), so a level made
// by box reduction differs from a picture merely sampled. A tile's sample patch, source (512, 470), lies in the disc
// below the digits, so a tile that shows its picture shows the disc's color there.

export const PIC_W = 1024;
export const PIC_H = 640;
const DISC_R = 200;
/** The sample patch's point in the source picture, px. */
export const PATCH_SRC: [number, number] = [512, 470];

function hsv(h: number, s: number, v: number): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const SEGMENTS: Record<string, Box> = {
  a: [0, 0, 64, 16], b: [48, 0, 16, 64], c: [48, 64, 16, 64], d: [0, 112, 64, 16], e: [0, 64, 16, 64], f: [0, 0, 16, 64], g: [0, 56, 64, 16],
};
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

export interface Picture { n: number; rgb: Uint8Array; disc: Rgb }

export function picture(n: number): Picture {
  const hue = (n * 137.508) % 360;
  const tl = hsv(hue + 25, 0.3, 0.96);
  const br = hsv(hue - 25, 0.55, 0.42);
  const disc = hsv(hue + 180, 0.85, 0.85);
  const rgb = new Uint8Array(PIC_W * PIC_H * 3);
  for (let y = 0; y < PIC_H; y++) {
    for (let x = 0; x < PIC_W; x++) {
      const o = (y * PIC_W + x) * 3;
      const t = (x / PIC_W) * 0.6 + (y / PIC_H) * 0.4;
      let r = tl[0] + (br[0] - tl[0]) * t;
      let g = tl[1] + (br[1] - tl[1]) * t;
      let b = tl[2] + (br[2] - tl[2]) * t;
      const d = Math.hypot(x + 0.5 - PIC_W / 2, y + 0.5 - PIC_H / 2);
      const a = Math.min(1, Math.max(0, DISC_R + 0.5 - d));
      r += (disc[0] - r) * a; g += (disc[1] - g) * a; b += (disc[2] - b) * a;
      if (y >= 40 && y < 100) { const w = x & 1 ? 245 : 10; r = w; g = w; b = w; }
      if (y >= 540 && y < 600) { const w = y & 1 ? 245 : 10; r = w; g = w; b = w; }
      rgb[o] = Math.round(r); rgb[o + 1] = Math.round(g); rgb[o + 2] = Math.round(b);
    }
  }
  const text = String(n);
  const width = text.length * 64 + (text.length - 1) * 16;
  const x0 = PIC_W / 2 - width / 2;
  const y0 = PIC_H / 2 - 64;
  [...text].forEach((ch, k) => {
    for (const s of DIGITS[Number(ch)]!) {
      const [sx, sy, sw, sh] = SEGMENTS[s]!;
      for (let y = y0 + sy; y < y0 + sy + sh; y++) {
        for (let x = x0 + k * 80 + sx; x < x0 + k * 80 + sx + sw; x++) rgb.fill(250, (y * PIC_W + x) * 3, (y * PIC_W + x) * 3 + 3);
      }
    }
  });
  return { n, rgb, disc };
}

// ---------------------------------------------------------------------------------------------------
// A baseline JPEG encoder (JFIF, Huffman, 4:2:0, quality 90): the forward DCT is the Arai-Agui-Nakajima
// factorization, the quantization and Huffman tables are the JPEG standard's example tables (ITU T.81, Annex K),
// written into the file's DQT and DHT segments, so any decoder reads them from the file.

const ZIGZAG: number[] = (() => {
  const z: number[] = [];
  for (let s = 0; s < 15; s++) {
    const lo = Math.max(0, s - 7);
    const hi = Math.min(s, 7);
    if (s % 2 === 0) for (let r = hi; r >= lo; r--) z.push(r * 8 + (s - r));
    else for (let r = lo; r <= hi; r++) z.push(r * 8 + (s - r));
  }
  return z;
})();

const LUM_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHR_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...Array<number>(32).fill(99)];
const AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

interface HuffSpec { bits: number[]; values: number[] }
const DC_LUM: HuffSpec = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHR: HuffSpec = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUM: HuffSpec = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  values: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91,
    0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25,
    0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
    0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
    0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5,
    0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa],
};
const AC_CHR: HuffSpec = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  values: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14,
    0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18,
    0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
    0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
    0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa],
};

interface Codes { code: Int32Array; size: Uint8Array }

/** The canonical codes a DHT table defines. Every symbol the encoder may write must be in it. */
function codes(spec: HuffSpec, symbols: number[]): Codes {
  const sorted = [...spec.values].sort((a, b) => a - b);
  if (spec.bits.reduce((a, b) => a + b, 0) !== spec.values.length || sorted.join() !== [...symbols].sort((a, b) => a - b).join()) {
    throw Error('a Huffman table does not hold each symbol once');
  }
  const out: Codes = { code: new Int32Array(256), size: new Uint8Array(256) };
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < spec.bits[length - 1]!; i++) {
      out.code[spec.values[k]!] = code;
      out.size[spec.values[k]!] = length;
      code++; k++;
    }
    code <<= 1;
  }
  return out;
}
const DC_SYMBOLS = Array.from({ length: 12 }, (_, i) => i);
const AC_SYMBOLS = [0x00, 0xf0, ...Array.from({ length: 160 }, (_, i) => ((i / 10) | 0) * 16 + (i % 10) + 1)];
const CODES = {
  dcLum: codes(DC_LUM, DC_SYMBOLS), acLum: codes(AC_LUM, AC_SYMBOLS), dcChr: codes(DC_CHR, DC_SYMBOLS), acChr: codes(AC_CHR, AC_SYMBOLS),
};

class Bits {
  buf: Uint8Array;
  len = 0;
  private acc = 0;
  private n = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); }
  byte(b: number): void {
    if (this.len === this.buf.length) { const grown = new Uint8Array(this.buf.length * 2); grown.set(this.buf); this.buf = grown; }
    this.buf[this.len++] = b;
  }
  put(value: number, size: number): void {
    this.acc = (this.acc << size) | (value & ((1 << size) - 1));
    this.n += size;
    while (this.n >= 8) {
      const b = (this.acc >>> (this.n - 8)) & 255;
      this.byte(b);
      if (b === 255) this.byte(0);
      this.n -= 8;
    }
    this.acc &= (1 << this.n) - 1;
  }
  flush(): void { if (this.n > 0) this.put((1 << (8 - this.n)) - 1, 8 - this.n); }
}

/** The forward DCT of an 8 × 8 block in place, scaled as AAN leaves it (the divisors take the scale out). */
function fdct(d: Float64Array): void {
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 1 : 8;
    const next = pass === 0 ? 8 : 1;
    for (let line = 0; line < 8; line++) {
      const o = line * next;
      const at = (i: number): number => o + i * step;
      const tmp0 = d[at(0)]! + d[at(7)]!; const tmp7 = d[at(0)]! - d[at(7)]!;
      const tmp1 = d[at(1)]! + d[at(6)]!; const tmp6 = d[at(1)]! - d[at(6)]!;
      const tmp2 = d[at(2)]! + d[at(5)]!; const tmp5 = d[at(2)]! - d[at(5)]!;
      const tmp3 = d[at(3)]! + d[at(4)]!; const tmp4 = d[at(3)]! - d[at(4)]!;
      let tmp10 = tmp0 + tmp3; const tmp13 = tmp0 - tmp3;
      let tmp11 = tmp1 + tmp2; let tmp12 = tmp1 - tmp2;
      d[at(0)] = tmp10 + tmp11; d[at(4)] = tmp10 - tmp11;
      const z1 = (tmp12 + tmp13) * 0.707106781;
      d[at(2)] = tmp13 + z1; d[at(6)] = tmp13 - z1;
      tmp10 = tmp4 + tmp5; tmp11 = tmp5 + tmp6; tmp12 = tmp6 + tmp7;
      const z5 = (tmp10 - tmp12) * 0.382683433;
      const z2 = 0.5411961 * tmp10 + z5;
      const z4 = 1.306562965 * tmp12 + z5;
      const z3 = tmp11 * 0.707106781;
      const z11 = tmp7 + z3; const z13 = tmp7 - z3;
      d[at(5)] = z13 + z2; d[at(3)] = z13 - z2;
      d[at(1)] = z11 + z4; d[at(7)] = z11 - z4;
    }
  }
}

const category = (v: number): number => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));

function segment(marker: number, body: number[] | Uint8Array): Buffer {
  const head = Buffer.from([0xff, marker, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255]);
  return Buffer.concat([head, Buffer.from(body)]);
}

/** A baseline JPEG of `rgb` (8-bit RGB, row-major), its sides multiples of 16, with an optional COM segment. */
export function jpeg(width: number, height: number, rgb: Uint8Array, comment?: string): Buffer {
  if (width % 16 || height % 16) throw Error('the encoder takes sides that are multiples of 16');
  const quality = 90;
  const scale = (t: number[]): number[] => t.map((q) => Math.min(255, Math.max(1, Math.floor((q * (200 - 2 * quality) + 50) / 100))));
  const lq = scale(LUM_Q);
  const cq = scale(CHR_Q);
  const divisors = (q: number[]): Float64Array => {
    const d = new Float64Array(64);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) d[r * 8 + c] = 1 / (q[r * 8 + c]! * AAN[r]! * AAN[c]! * 8);
    return d;
  };
  const ld = divisors(lq);
  const cd = divisors(cq);
  const Y = new Float64Array(width * height);
  const Cb = new Float64Array(width * height);
  const Cr = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3]!; const g = rgb[i * 3 + 1]!; const b = rgb[i * 3 + 2]!;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const bits = new Bits(width * height);
  const block = new Float64Array(64);
  const q = new Int32Array(64);
  const prev = [0, 0, 0];
  const encode = (div: Float64Array, dc: Codes, ac: Codes, c: number): void => {
    fdct(block);
    for (let i = 0; i < 64; i++) {
      const k = ZIGZAG[i]!;
      q[i] = Math.max(-1023, Math.min(1023, Math.round(block[k]! * div[k]!)));
    }
    const diff = q[0]! - prev[c]!;
    prev[c] = q[0]!;
    const s = category(diff);
    bits.put(dc.code[s]!, dc.size[s]!);
    if (s) bits.put(diff < 0 ? diff + (1 << s) - 1 : diff, s);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const v = q[i]!;
      if (v === 0) { run++; continue; }
      while (run > 15) { bits.put(ac.code[0xf0]!, ac.size[0xf0]!); run -= 16; }
      const size = category(v);
      const symbol = (run << 4) | size;
      bits.put(ac.code[symbol]!, ac.size[symbol]!);
      bits.put(v < 0 ? v + (1 << size) - 1 : v, size);
      run = 0;
    }
    if (run > 0) bits.put(ac.code[0]!, ac.size[0]!);
  };
  for (let my = 0; my < height / 16; my++) {
    for (let mx = 0; mx < width / 16; mx++) {
      for (const [bx, by] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) block[r * 8 + c] = Y[(my * 16 + by + r) * width + mx * 16 + bx + c]!;
        encode(ld, CODES.dcLum, CODES.acLum, 0);
      }
      for (const [plane, c] of [[Cb, 1], [Cr, 2]] as const) {
        for (let r = 0; r < 8; r++) {
          for (let k = 0; k < 8; k++) {
            const o = (my * 16 + r * 2) * width + mx * 16 + k * 2;
            block[r * 8 + k] = (plane[o]! + plane[o + 1]! + plane[o + width]! + plane[o + width + 1]!) / 4;
          }
        }
        encode(cd, CODES.dcChr, CODES.acChr, c);
      }
    }
  }
  bits.flush();
  const dht = (cls: number, spec: HuffSpec): number[] => [cls, ...spec.bits, ...spec.values];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(comment === undefined ? [] : [segment(0xfe, Buffer.from(comment, 'latin1'))]),
    segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    segment(0xdb, [0, ...ZIGZAG.map((k) => lq[k]!), 1, ...ZIGZAG.map((k) => cq[k]!)]),
    segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    segment(0xc4, [...dht(0x00, DC_LUM), ...dht(0x10, AC_LUM), ...dht(0x01, DC_CHR), ...dht(0x11, AC_CHR)]),
    segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
    Buffer.from(bits.buf.subarray(0, bits.len)),
    Buffer.from([0xff, 0xd9]),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// PNG, written with node's zlib and read back (8-bit RGB or RGBA, no interlace), and APNG for the recording.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function ihdr(width: number, height: number, color: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0); b.writeUInt32BE(height, 4); b[8] = 8; b[9] = color;
  return chunk('IHDR', b);
}

/** The rows of an 8-bit picture of `channels` channels, each with the filter (None, Sub, Up or Paeth) that leaves the smallest sum. */
function filtered(width: number, height: number, channels: number, px: Uint8Array): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = -1; let bestSum = Infinity;
    for (const f of [0, 1, 2, 4]) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels]! : 0;
        const b = up ? up[i]! : 0;
        const c = up && i >= channels ? up[i - channels]! : 0;
        const v = f === 0 ? row[i]! : f === 1 ? row[i]! - a : f === 2 ? row[i]! - b : row[i]! - paeth(a, b, c);
        sum += Math.abs((v << 24) >> 24);
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    const o = y * (stride + 1);
    out[o] = best;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = up ? up[i]! : 0;
      const c = up && i >= channels ? up[i - channels]! : 0;
      const v = best === 0 ? row[i]! : best === 1 ? row[i]! - a : best === 2 ? row[i]! - b : row[i]! - paeth(a, b, c);
      out[o + 1 + i] = v & 255;
    }
  }
  return out;
}

/** An 8-bit RGB PNG of `rgb`, every row filtered Sub, deflate level 6: a picture's file as a camera or an editor writes one. */
export function pngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (rgb[y * stride + i]! - (i >= 3 ? rgb[y * stride + i - 3]! : 0)) & 255;
  }
  return Buffer.concat([SIGNATURE, ihdr(width, height, 2), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

/** An 8-bit RGBA PNG of `image`, deflate level 9: the same pixels always give the same bytes. */
export function pngRgba(image: Image): Buffer {
  return Buffer.concat([SIGNATURE, ihdr(image.width, image.height, 6), chunk('IDAT', deflateSync(filtered(image.width, image.height, 4, image.rgba), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** An animated PNG of `frames` (all one size), `fps` a second, looping. */
export function apng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts = [SIGNATURE, ihdr(width, height, 6), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, k) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = deflateSync(filtered(width, height, 4, f.rgba), { level: 9 });
    if (k === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace (tests/acceptance/1485's reader). */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
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
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
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

/** `image` at half its size, each pixel the mean of a 2 × 2 square (the recording only). */
export function halved(image: Image): Image {
  const width = image.width >> 1; const height = image.height >> 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (yy: number, xx: number): number => image.rgba[(yy * image.width + xx) * 4 + c]!;
        rgba[(y * width + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1) + 2) >> 2;
      }
    }
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// Stores: `deep-canvas-render`'s `store` is a flat folder whose files are named by their sha256 (#674).

/** A scratch folder, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-1486-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes `bytes` into the flat store `dir` under its sha256; returns the hash. */
export function put(dir: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, hash), bytes);
  return hash;
}

/** A fresh store at `to` holding exactly the assets' files of the store `from` (hard links, else copies), and nothing a run kept. */
export function freshStore(from: string, to: string, assets: readonly Asset[]): string {
  mkdirSync(to, { recursive: true });
  for (const a of new Set(assets.map((x) => x.hash))) {
    try { linkSync(join(from, a), join(to, a)); } catch { copyFileSync(join(from, a), join(to, a)); }
  }
  return to;
}

export interface Asset { hash: string; format: 'jpeg' | 'png'; n: number; disc: Rgb }

/** Pictures 0 … count − 1 in the store `dir`: even n a JPEG, odd n a PNG. */
export function makePictures(dir: string, count: number): Asset[] {
  return Array.from({ length: count }, (_, n) => {
    const p = picture(n);
    const format = n % 2 === 0 ? 'jpeg' : 'png';
    const bytes = format === 'jpeg' ? jpeg(PIC_W, PIC_H, p.rgb) : pngRgb(PIC_W, PIC_H, p.rgb);
    return { hash: put(dir, bytes), format, n, disc: p.disc } as Asset;
  });
}

/**
 * `times` assets for each of `assets`, the first the asset itself and each other its bytes with one comment added (a
 * JPEG COM segment after SOI, a PNG tEXt chunk after IHDR), so each is its own file by hash with the same pixels.
 */
export function copies(dir: string, assets: readonly Asset[], times: number): Asset[] {
  const out: Asset[] = [];
  for (let k = 0; k < times; k++) {
    for (const a of assets) {
      if (k === 0) { out.push(a); continue; }
      const bytes = readFileSync(join(dir, a.hash));
      const note = Buffer.from(`deep-1486 copy ${k}`, 'latin1');
      const added = a.format === 'jpeg'
        ? Buffer.concat([bytes.subarray(0, 2), segment(0xfe, note), bytes.subarray(2)])
        : Buffer.concat([bytes.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), note])), bytes.subarray(33)]);
      out.push({ ...a, hash: put(dir, added) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The look, the grid document and its geometry, as `deep-canvas-render` reads them (#391's role map; #674's image@1).

/** The ground: a neutral grey, so a tile that shows no picture shows no chroma. */
export const GROUND: Rgb = [128, 128, 128];
export const LOOK: JsonObject = { light: { ground: GROUND, ink: [0, 0, 0] } };

/** The grid: 10 columns of 120 px cover tiles on a 128 px pitch, 4 px in from each cell's corner; 1280 u wide. */
export const COLUMNS = 10;
export const PITCH = 128;
export const TILE = 120;
const INSET = 4;
export const itemId = (i: number): string => `p${i}`;
export const tileBox = (i: number): Box => [(i % COLUMNS) * PITCH + INSET, Math.floor(i / COLUMNS) * PITCH + INSET, TILE, TILE];

export function board(id: string, size: [number, number], items: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'board', title: 'Pictures', description: 'Pictures drawn at the size they are drawn.', size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items, ...extra,
  };
}

export function imageItem(id: string, order: number, asset: Asset, box: Box, fit: string, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'image@1', layer: 'main', name: id, order: `a${order}`, params: { asset: asset.hash, box, fit, alt: `Picture ${asset.n}` }, ...extra };
}

/** The grid of `assets`, asset i in tile i, each `fit: cover`. */
export function gridDoc(assets: readonly Asset[]): JsonObject {
  const items: JsonObject = {};
  assets.forEach((a, i) => { items[itemId(i)] = imageItem(itemId(i), i, a, tileBox(i), 'cover'); });
  return board(`grid-1486-${assets.length}`, [COLUMNS * PITCH, Math.ceil(assets.length / COLUMNS) * PITCH], items);
}

/** Whether `box` and `rect` overlap in an area (a shared edge isn't overlap). */
export function meets(box: Box, rect: Box): boolean {
  return box[0] + box[2] > rect[0] && box[0] < rect[0] + rect[2] && box[1] + box[3] > rect[1] && box[1] < rect[1] + rect[3];
}

/** The grid's tiles in view at `rect`, by item ID, sorted. */
export function visible(tiles: number, rect: Box): string[] {
  const out: string[] = [];
  for (let i = 0; i < tiles; i++) if (meets(tileBox(i), rect)) out.push(itemId(i));
  return out.sort();
}

/**
 * Tile i's sample patch (README: The pictures) in device px of a frame showing `rect` at `zoom`: the source point
 * PATCH_SRC under `fit: cover` into the 120 u tile, ±2 u. Null when the patch isn't wholly in the frame.
 */
export function patchOf(i: number, rect: Box, zoom: number, frame: Image): Box | null {
  const s = TILE / PIC_H;
  const [bx, by] = tileBox(i);
  const cx = bx + (PATCH_SRC[0] - (PIC_W - PIC_H) / 2) * s;
  const cy = by + PATCH_SRC[1] * s;
  const x0 = Math.round((cx - 2 - rect[0]) * zoom); const y0 = Math.round((cy - 2 - rect[1]) * zoom);
  const x1 = Math.round((cx + 2 - rect[0]) * zoom); const y1 = Math.round((cy + 2 - rect[1]) * zoom);
  if (x0 < 0 || y0 < 0 || x1 > frame.width || y1 > frame.height) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}

/** The mean color of `box` (device px) in `image`. */
export function meanOf(image: Image, [x0, y0, w, h]: Box): Rgb {
  const sum: Rgb = [0, 0, 0];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) for (const c of [0, 1, 2] as const) sum[c] += image.rgba[(y * image.width + x) * 4 + c]!;
  return sum.map((v) => Math.round(v / (w * h))) as Rgb;
}
/** A tile shows a picture where its patch has chroma: the ground is neutral, and each disc is saturated. */
export const chroma = (c: Rgb): number => Math.max(...c) - Math.min(...c);
export const SHOWS_CHROMA = 60;
export const near = (a: Rgb, b: Rgb, tolerance: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

// ---------------------------------------------------------------------------------------------------
// The build: release, as timing needs and as the 10,000-image runs need to finish. Built once per file, copied out of
// target/ (so a sibling file's build can't replace it mid-run); a failed build fails each test, with cargo's error.

const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const RENDER_BUILD = ['build', '--locked', '--release', '--bin', 'deep-canvas-render'];

export function useRender(): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1486-bin-'));
    const r = spawnSync('cargo', RENDER_BUILD, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) {
      const said = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n');
      error = `cargo ${RENDER_BUILD.join(' ')} failed:\n${said.slice(0, 4000)}`;
    } else {
      error = '';
      copyFileSync(join(REPO, 'target', 'release', 'deep-canvas-render'), join(dir, 'deep-canvas-render'));
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    if (process.platform !== 'darwin') expect.fail(`INCONCLUSIVE: deep-canvas-render draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`);
    expect(error, `it builds: cargo ${RENDER_BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-canvas-render');
  };
}

/** `deep-canvas-render <subcommand>` on one JSON line: its one answer line. */
export function one(bin: string, subcommand: string, input: JsonValue, timeoutMs = 900_000): JsonObject {
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const name = `deep-canvas-render ${subcommand}`;
  // A process that exits before reading a long request leaves the write an EPIPE: its status and stderr say why.
  if (run.status !== 0) throw Error(`${name} exited ${run.status ?? run.signal}${run.error ? ` (${run.error.message})` : ''}:\n${(run.stderr ?? '').slice(-4000)}`);
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line for the one input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['code'], `${name}: GPUI's offscreen renderer runs here`).not.toBe('unsupported_platform');
  return answer;
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render live` (README: Surfaces this suite names): the request, and the report read back and checked
// for its shape, so every test reads a report whose frames, phases, views and levels hang together.

export type Phase = 'open' | 'move' | 'settle' | 'redraw';
const PHASES: Phase[] = ['open', 'move', 'settle', 'redraw'];
export interface Move { at: [number, number]; t?: number }
export type Capture = { phase: Phase; frame: number | 'last'; out: string } | { phase: Phase; dir: string };
export interface LiveRequest {
  doc: JsonObject;
  view: { zoom: number; rect: Box };
  store: string;
  moves?: Move[];
  settle_ms?: number;
  redraws?: number;
  images?: { budget: number };
  captures?: Capture[];
  planted?: 'queue_without_cancel' | 'evictor_ignores_two_frames';
}
export interface Level { asked: number; drawn: number | null }
export const STAT_NAMES = ['bytes', 'budget', 'entries', 'pending', 'decoded', 'failed', 'cancelled', 'evicted', 'decode_ms'] as const;
export type Stats = Record<(typeof STAT_NAMES)[number], number>;
export interface Frame {
  frame: number; phase: Phase; at_ms: number; done_ms: number; ui_ms: number; rect: Box; settling: boolean;
  levels: Map<string, Level>; stats: Stats; drawn_bytes: number; allocations: number;
}
export interface Job { asset: string; level: number; kind: 'decode' | 'read'; frame: number }
export interface Live { frames: Frame[]; jobs: Job[]; stats: Stats }

/** 705,600,000 flicks a second; one frame at 60 Hz. */
export const PERIOD = 705_600_000 / 60;

function stats(value: JsonValue | undefined, what: string): Stats {
  const o = obj(value, what);
  const out = {} as Stats;
  for (const name of STAT_NAMES) out[name] = name === 'decode_ms' ? num(o[name], `${what}.${name}`) : count(o[name], `${what}.${name}`);
  expect(out.decode_ms >= 0, `${what}.decode_ms is at least 0`).toBe(true);
  return out;
}

export function live(bin: string, request: LiveRequest, what: string, timeoutMs = 900_000): Live {
  const answer = one(bin, 'live', { look: LOOK, ...request } as unknown as JsonValue, timeoutMs);
  expect(answer['ok'], `${what}: live answers ok: ${short(answer, 2000)}`).toBe(true);
  const rect = request.view.rect;
  const moves = request.moves ?? [];
  const frames = arr(answer['frames'], `${what}: frames`).map((value, k): Frame => {
    const f = obj(value, `${what}: frames[${k}]`);
    const at = `${what}: frames[${k}]`;
    expect(f['frame'], `${at}.frame`).toBe(k);
    expect(PHASES, `${at}.phase`).toContain(f['phase']);
    const levels = new Map<string, Level>();
    for (const [item, l] of Object.entries(obj(f['levels'], `${at}.levels`))) {
      const o = obj(l, `${at}.levels.${item}`);
      levels.set(item, { asked: count(o['asked'], `${at}.levels.${item}.asked`), drawn: o['drawn'] === null ? null : count(o['drawn'], `${at}.levels.${item}.drawn`) });
    }
    const r = arr(f['rect'], `${at}.rect`).map((v) => num(v, `${at}.rect`));
    expect(r.length, `${at}.rect is [x, y, w, h]`).toBe(4);
    expect(typeof f['settling'], `${at}.settling`).toBe('boolean');
    return {
      frame: k, phase: f['phase'] as Phase,
      at_ms: num(f['at_ms'], `${at}.at_ms`), done_ms: num(f['done_ms'], `${at}.done_ms`), ui_ms: num(f['ui_ms'], `${at}.ui_ms`),
      rect: r as Box, settling: f['settling'] as boolean, levels, stats: stats(f['stats'], `${at}.stats`),
      drawn_bytes: count(f['drawn_bytes'], `${at}.drawn_bytes`), allocations: count(f['allocations'], `${at}.allocations`),
    };
  });
  // The phases in order: open (at least one frame), one frame per move, settle (at least one), then the redraws.
  const of = (p: Phase): Frame[] => frames.filter((f) => f.phase === p);
  expect(frames.map((f) => PHASES.indexOf(f.phase)), `${what}: the frames' phases run open, move, settle, redraw, in that order`).toEqual(frames.map((f) => PHASES.indexOf(f.phase)).sort((a, b) => a - b));
  expect(of('open').length, `${what}: the open phase draws at least one frame`).toBeGreaterThan(0);
  expect(of('move').length, `${what}: one frame per move`).toBe(moves.length);
  expect(of('settle').length, `${what}: the settle phase draws at least one frame`).toBeGreaterThan(0);
  expect(of('redraw').length, `${what}: one frame per redraw`).toBe(request.redraws ?? 0);
  const last = moves.length ? [moves[moves.length - 1]!.at[0], moves[moves.length - 1]!.at[1], rect[2], rect[3]] : rect;
  const firstMove = of('move')[0]?.frame ?? 0;
  for (const f of frames) {
    const want = f.phase === 'open' ? rect : f.phase === 'move' ? [...moves[f.frame - firstMove]!.at, rect[2], rect[3]] : last;
    expect(f.rect, `${what}: frame ${f.frame} (${f.phase}) shows the view the request gives it`).toEqual(want);
    expect(f.settling, `${what}: frame ${f.frame}: settling is true exactly when an image in view drew another level than it asked, or none`).toBe([...f.levels.values()].some((l) => l.drawn !== l.asked));
    expect(f.drawn_bytes <= f.stats.bytes, `${what}: frame ${f.frame}: what the last two frames drew (${f.drawn_bytes} B) is held, so within the cache's ${f.stats.bytes} B`).toBe(true);
    expect(f.done_ms >= f.at_ms, `${what}: frame ${f.frame} is done after it starts`).toBe(true);
    if (f.frame > 0) expect(f.at_ms >= frames[f.frame - 1]!.done_ms, `${what}: frame ${f.frame} starts after frame ${f.frame - 1} is done`).toBe(true);
  }
  const jobs = arr(answer['jobs'], `${what}: jobs`).map((value, k): Job => {
    const j = obj(value, `${what}: jobs[${k}]`);
    expect(typeof j['asset'] === 'string' && /^[0-9a-f]{64}$/.test(j['asset']), `${what}: jobs[${k}].asset is a sha256`).toBe(true);
    expect(['decode', 'read'], `${what}: jobs[${k}].kind`).toContain(j['kind']);
    const frame = count(j['frame'], `${what}: jobs[${k}].frame`);
    expect(frame < frames.length, `${what}: jobs[${k}].frame is a frame of the run`).toBe(true);
    return { asset: j['asset'] as string, level: count(j['level'], `${what}: jobs[${k}].level`), kind: j['kind'] as Job['kind'], frame };
  });
  return { frames, jobs, stats: stats(answer['stats'], `${what}: stats`) };
}

/** Each frame whose `levels` aren't exactly the grid's tiles in its view: the frame draws what the view shows, no more. */
export function viewProblems(frames: readonly Frame[], tiles: number): string[] {
  const out: string[] = [];
  for (const f of frames) {
    const want = visible(tiles, f.rect);
    const got = [...f.levels.keys()].sort();
    if (want.join() !== got.join()) {
      const missing = want.filter((id) => !f.levels.has(id));
      const extra = got.filter((id) => !want.includes(id));
      out.push(`frame ${f.frame} (${f.phase}) at ${JSON.stringify(f.rect)} drew ${got.length} images where the view holds ${want.length}: missing ${missing.slice(0, 5).join(', ') || 'none'}, extra ${extra.slice(0, 5).join(', ') || 'none'}`);
    }
  }
  return out;
}

/**
 * AC1's rule on every frame: "cache bytes never over budget except for what the last two frames drew", read when the
 * frame's eviction has run. A frame breaks it when the cache holds more than both its budget and what the last two
 * drawn frames drew.
 */
export function budgetProblems(frames: readonly Frame[]): string[] {
  return frames
    .filter((f) => f.stats.bytes > Math.max(f.stats.budget, f.drawn_bytes))
    .map((f) => `frame ${f.frame} (${f.phase}): the cache holds ${f.stats.bytes} B, over its budget of ${f.stats.budget} B and over the ${f.drawn_bytes} B the last two frames drew`);
}

/** The view `rect` moved `step` u down a frame until it reaches the bottom of a grid of `tiles`: one move per frame. */
export function scrollMoves(tiles: number, rect: Box, step: number): Move[] {
  const end = Math.ceil(tiles / COLUMNS) * PITCH - rect[3];
  const out: Move[] = [];
  for (let y = rect[1] + step; y <= end; y += step) out.push({ at: [rect[0], y] });
  return out;
}

/**
 * AC4's check, read from the frames as captured (`<dir>/<frame>.png`): once a tile has shown its picture, every later
 * frame that holds its patch must show it again. Each frame that shows such a tile empty is named, with the tile and
 * the frame it first showed in.
 */
export function emptyAfterShown(frames: readonly Frame[], dir: string, tiles: number, zoom: number): string[] {
  const shownAt = new Map<string, number>();
  const out: string[] = [];
  for (const f of frames) {
    const image = decodePng(readFileSync(join(dir, `${f.frame}.png`)));
    for (const id of visible(tiles, f.rect)) {
      const patch = patchOf(Number(id.slice(1)), f.rect, zoom, image);
      if (!patch) continue;
      if (chroma(meanOf(image, patch)) >= SHOWS_CHROMA) {
        if (!shownAt.has(id)) shownAt.set(id, f.frame);
      } else if (shownAt.has(id)) {
        out.push(`frame ${f.frame} (${f.phase}) shows tile ${id} empty, after it showed its picture from frame ${shownAt.get(id)}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The reference Macs and the judge of a timing limit (docs/technical-design.md: Every task carries its own budgets, The
// reference Macs; the rule scripts/benchmark.mjs's judgeLimit holds, copied here as tests/acceptance/1485 copied it).

const REFERENCE_MACS = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
  { name: 'Mac17,10 (M5 Max, 64 GB)', model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 },
];

export interface Machine {
  model: string | null; chip: string | null; memoryBytes: number | null;
  power: 'ac' | 'battery' | null; lowPowerMode: boolean | null; thermalState: string | null; macosBuild: string | null;
}

/** The machine a result ran under; a field it can't report is null, so the result is a reading. */
export function machine(): Machine {
  const read = (command: string, ...args: string[]): string | null => {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const memory = Number(read('sysctl', '-n', 'hw.memsize'));
  const source = read('pmset', '-g', 'ps') ?? '';
  const objc = (expr: string): string | null => read('osascript', '-l', 'JavaScript', '-e', `ObjC.import("Foundation"); $.NSProcessInfo.processInfo.${expr}`);
  const lowPower = /^\s*lowpowermode\s+([01])\s*$/m.exec(read('pmset', '-g') ?? '')?.[1] ?? ({ true: '1', false: '0' } as Record<string, string>)[objc('isLowPowerModeEnabled') ?? ''];
  const thermal = Number(objc('thermalState'));
  return {
    model: read('sysctl', '-n', 'hw.model') || null,
    chip: read('sysctl', '-n', 'machdep.cpu.brand_string') || null,
    memoryBytes: Number.isSafeInteger(memory) && memory > 0 ? memory : null,
    power: /'AC Power'/.test(source) ? 'ac' : /'Battery Power'/.test(source) ? 'battery' : null,
    lowPowerMode: lowPower === undefined ? null : lowPower === '1',
    thermalState: ['nominal', 'fair', 'serious', 'critical'][thermal] ?? null,
    macosBuild: read('sw_vers', '-buildVersion') || null,
  };
}

export interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; limit: number; runs: number[]; margin?: number; reason?: string }

/**
 * Five runs after warm-up against `limit`: PASS when all five are within it, FAIL when all five are over it by more
 * than the margin (the larger of 5% and the runs' spread, as fractions of the limit), INCONCLUSIVE otherwise, and
 * INCONCLUSIVE off the reference Macs, off mains power, in Low Power Mode, at a thermal state past nominal, or when
 * the one-minute load at a run's start or end is above the core count or unread.
 */
export function judgeLimit(limit: number, runs: number[], m: Machine, loads: { start: number; end: number }[]): Verdict {
  if (runs.length !== 5 || runs.some((r) => !Number.isFinite(r) || r < 0)) return { status: 'BLOCKED', limit, runs, reason: `a limit is judged on five readings taken after warm-up, got ${JSON.stringify(runs)}` };
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const off: string[] = [];
  if (!REFERENCE_MACS.some((r) => r.model === m.model && r.chip === m.chip && r.memoryBytes === m.memoryBytes)) {
    off.push(`${m.model} / ${m.chip} / ${m.memoryBytes === null ? '?' : Math.round(m.memoryBytes / 2 ** 30)} GiB is none of ${REFERENCE_MACS.map((r) => r.name).join(', ')}`);
  }
  if (m.power !== 'ac') off.push(`power is ${m.power}, not mains`);
  if (m.lowPowerMode !== false) off.push(`Low Power Mode is ${m.lowPowerMode}`);
  if (m.thermalState !== 'nominal') off.push(`thermal state is ${m.thermalState}`);
  if (!m.macosBuild) off.push('the macOS build is missing');
  const cores = availableParallelism();
  const readings = loads.flatMap((l) => [l.start, l.end]);
  if (loads.length !== runs.length || readings.some((l) => !Number.isFinite(l) || l < 0)) off.push(`the load at each run's start and end can't be read: ${JSON.stringify(loads)}`);
  else if (readings.some((l) => l > cores)) off.push(`load ${Math.max(...readings).toFixed(1)} at a run's start or end is above the ${cores} cores`);
  if (off.length) return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `a reading, not a budget result: ${off.join('; ')}` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', limit, runs, margin };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', limit, runs, margin, reason: `all five runs are over ${limit} by more than the ${(margin * 100).toFixed(1)}% margin` };
  return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `the five runs are neither all within ${limit} nor all over it by more than the ${(margin * 100).toFixed(1)}% margin` };
}

/** The nearest-rank percentile `p` (0..1) of `values`. */
export function percentile(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]!;
}
