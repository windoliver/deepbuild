// Test-side tools for the #503 Oracle lane (criterion 4): the FATE samples, fetched on first use into a cache outside
// the repository and checked against their pins (as tests/acceptance/498/decode/helpers.ts fetches); the decode worker
// driven through `deep-show run`'s `media_decode` (the #503 suite's helpers); and the comparisons the FATE recipes make,
// re-expressed here: FFmpeg's sample conversion to s16, tiny_psnr's MAXDIFF and stddev, the crc muxer's Adler-32, an
// MD5, and the first second of FATE's synthetic sound.
//
// tiny_psnr's comparison, swresample's float-to-s16 rounding and audiogen's integer cosine are re-expressed from
// FFmpeg's tests/tiny_psnr.c, libswresample and tests/audiogen.c at 24e860f6d3 (tiny_psnr.c: Copyright (c) 2003 Michael
// Niedermayer; audiogen.c: Copyright (c) 2002 Fabrice Bellard). FFmpeg is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation;
// either version 2.1 of the License, or (at your option) any later version; distributed WITHOUT ANY WARRANTY; see
// fixtures/fate/COPYING.LGPLv2.1.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { blocked, decodeCall, decodedPcm, runShowPid, scenario, show, type JsonObject, type Pcm } from '../503/helpers.ts';

export {
  FULL, LOSSY_DBFS, TIMEOUT, blocked, decodeCall, decodedPcm, ffmpeg, ffmpegPcm, ffmpegTools, failsNaming, none, peakDb, requireMac, runShowPid,
  scenario, sha256, show, str, useShow, useTemp, type JsonObject, type Pcm,
} from '../503/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');

/** Criterion 4's ID; every test of this lane is criterion 4's. */
export const AC4 = 'AC4 #503.89909452';

// ---------------------------------------------------------------------------------------------------
// The FATE samples (README: Pinned samples)

export interface Sample { sample: string; sha256: string; bytes: number }
export const FATE = JSON.parse(readFileSync(join(FIXTURES, 'samples.json'), 'utf8')) as { commit: string; suite: string; samples: Sample[] };
/** The cache the samples are fetched into: `DEEP_FATE_SAMPLES`, else the user's cache folder. Never in the checkout. */
export function fateCache(): string {
  const env = process.env['DEEP_FATE_SAMPLES'];
  if (env) return env;
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'deepbuild', 'fate-suite') : join(homedir(), '.cache', 'deepbuild', 'fate-suite');
}
const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
/** Each named sample's path in the cache, fetched first when missing; one that can't be fetched or doesn't match its pin
 * is BLOCKED with the one unblock ask. */
export async function samples(names: string[]): Promise<Map<string, string>> {
  const root = fateCache();
  const paths = new Map<string, string>();
  const ask = `Unblock: let this Mac reach ${FATE.suite} once, or put the pinned samples (tests/acceptance/503-oracle/fixtures/samples.json) under DEEP_FATE_SAMPLES`;
  for (const name of names) {
    const pin = FATE.samples.find((s) => s.sample === name);
    if (!pin) throw Error(`${name} is not pinned in fixtures/samples.json`);
    const p = join(root, name);
    if (!existsSync(p)) {
      let body: Buffer | null = null; let why = '';
      for (let attempt = 0; attempt < 3 && !body; attempt++) {
        try {
          const r = await fetch(`${FATE.suite}${name}`, { signal: AbortSignal.timeout(300_000) });
          if (r.ok) body = Buffer.from(await r.arrayBuffer()); else why = `HTTP ${r.status}`;
        } catch (e) { why = (e as Error).message; }
      }
      if (!body) blocked(`the FATE sample ${FATE.suite}${name} could not be fetched (${why}). ${ask}`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(`${p}.part`, body);
      renameSync(`${p}.part`, p);
    }
    const got = sha256File(p);
    if (got !== pin.sha256 || readFileSync(p).length !== pin.bytes) blocked(`${p} hashes to ${got}, not the pinned ${pin.sha256} (${pin.bytes} bytes); delete it to fetch it again. ${ask}`);
    paths.set(name, p);
  }
  return paths;
}
/** A vendored file of FFmpeg's tests/ tree at the pinned commit (fixtures/fate/<path>). */
export const vendored = (path: string): string => readFileSync(join(FIXTURES, 'fate', path), 'utf8');

// ---------------------------------------------------------------------------------------------------
// Decoding through the worker

/** Every path decoded by the worker in one `deep-show run`; each reply's PCM, or the refusal as a failure line. */
export function decodeAll(bin: string, evidence: string, items: { name: string; path: string; out: string }[]): Map<string, Pcm | string> {
  const { replies } = runShowPid(bin, scenario(evidence, items.map((i) => decodeCall(i.path, i.out))), 'the FATE samples through the decode worker');
  const out = new Map<string, Pcm | string>();
  items.forEach((it, i) => {
    const r = replies[i]!;
    out.set(it.name, typeof r['code'] === 'string' || typeof r['error'] === 'string' ? `${it.name}: the decode worker refused ${it.path.split('/').slice(-2).join('/')}: ${show(r as JsonObject, 400)}` : decodedPcm(r, it.out, it.name));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// FFmpeg's conversions and comparisons, re-expressed

/** Float samples as FFmpeg's `-f s16le` writes them (swresample: x × 2^15 to the nearest integer, clipped), little- or
 * big-endian. A tie goes up, as FFmpeg 9.0.2 on this arm64 Mac writes it (checked sample for sample against its own
 * `-f s16le` output of aac/al04_44.mp4 when this lane was written); only the one-off and stddev comparisons meet
 * ties, and their fuzz covers the rule. */
export function s16le(x: Float32Array, bigEndian = false): Buffer {
  const b = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32768)));
    if (bigEndian) b.writeInt16BE(v, 2 * i); else b.writeInt16LE(v, 2 * i);
  }
  return b;
}
/** Float samples as `-f f32le` writes them. */
export function f32le(x: Float32Array): Buffer {
  const b = Buffer.alloc(x.length * 4);
  x.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return b;
}
/** A RIFF WAVE file's data chunk, else the bytes (tiny_psnr skips a WAV header). */
function dataOf(b: Buffer): Buffer {
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') {
    for (let o = 12; o + 8 <= b.length;) {
      const id = b.toString('ascii', o, o + 4); const size = b.readUInt32LE(o + 4);
      if (id === 'data') return b.subarray(o + 8, Math.min(b.length, o + 8 + size));
      o += 8 + size;
    }
  }
  return b;
}
export interface Psnr { maxdiff: number; stddev: number; size0: number; size1: number }
/** tiny_psnr's MAXDIFF and stddev of two files of s16 or f32 samples, over the shorter (its run_psnr, shift 0): for
 * s16 the stddev in its fixed point (2 decimals); for f32 both scaled by 2^24. */
export function tinyPsnr(a: Buffer, b: Buffer, unit: 's16' | 'f32'): Psnr {
  const x = dataOf(a); const y = dataOf(b);
  const len = unit === 's16' ? 2 : 4;
  const n = Math.floor(Math.min(x.length, y.length) / len);
  if (unit === 's16') {
    let sse = 0n; let max = 0;
    for (let i = 0; i < n; i++) { const d = x.readInt16LE(2 * i) - y.readInt16LE(2 * i); sse += BigInt(d * d); max = Math.max(max, Math.abs(d)); }
    const k = BigInt(Math.max(1, n)); const F = 100n;
    const v = (sse / k) * F * F + ((sse % k) * F * F + k / 2n) / k;
    let r = 0n; for (let s = 31n; s >= 0n; s--) { const t = r + (1n << s); if (t * t <= v) r = t; }
    return { maxdiff: max, stddev: Number(r) / 100, size0: x.length, size1: y.length };
  }
  let sse = 0; let max = 0;
  for (let i = 0; i < n; i++) { const d = x.readFloatLE(4 * i) - y.readFloatLE(4 * i); sse += d * d; max = Math.max(max, Math.abs(d)); }
  return { maxdiff: Math.floor(max * 2 ** 24), stddev: Math.sqrt(sse / Math.max(1, n)) * 2 ** 24, size0: x.length, size1: y.length };
}
/** A recipe's comparison (fate-run.sh's do_tiny_psnr): `oneoff` holds MAXDIFF within FUZZ of CMP_TARGET, `stddev` the
 * stddev; both hold the sizes within SIZE_TOLERANCE. For stddev, ours is held to the bound's upper side, target + fuzz
 * (README: Readings: a decoder nearer the reference than FFmpeg's isn't failed for it). Failures name the recipe. */
export interface Recipe { test: string; cmp: 'oneoff' | 'stddev'; unit: 's16' | 'f32'; fuzz: number; target: number; sizeTolerance: number }
export function recipeFailures(r: Recipe, ref: Buffer, ours: Buffer): string[] {
  const p = tinyPsnr(ref, ours, r.unit);
  const f: string[] = [];
  const val = r.cmp === 'oneoff' ? p.maxdiff : p.stddev;
  const bad = r.cmp === 'oneoff' ? Math.abs(val - r.target) > r.fuzz : val > r.target + r.fuzz;
  if (bad) f.push(`${r.test}: ${r.cmp === 'oneoff' ? 'MAXDIFF' : 'stddev'} ${val} against the reference decode, beyond ${r.cmp === 'oneoff' ? `${r.target} ± ${r.fuzz}` : `${r.target} + ${r.fuzz}`} (${r.unit})`);
  if (Math.abs(p.size0 - p.size1) > r.sizeTolerance) f.push(`${r.test}: ${p.size1} bytes decoded, the reference ${p.size0} (tolerance ${r.sizeTolerance})`);
  return f;
}
/** The crc muxer's checksum: Adler-32 from 1 over every packet's bytes, as `CRC=0x%08x`. */
export function adler32(b: Buffer): string {
  let s1 = 1; let s2 = 0;
  for (const x of b) { s1 = (s1 + x) % 65521; s2 = (s2 + s1) % 65521; }
  return `0x${(((s2 << 16) | s1) >>> 0).toString(16).padStart(8, '0')}`;
}
export const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');

/** A PCM WAVE file's integer samples (16, 24 or 32 bits, plain or extensible), interleaved. */
export function wavIntegers(bytes: Buffer, what: string): { rate: number; channels: number; bits: number; x: Int32Array } {
  let fmt: { channels: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') {
      const tag = body.readUInt16LE(0) === 0xfffe ? body.readUInt16LE(24) : body.readUInt16LE(0);
      expect(tag, `${what}: integer PCM`).toBe(1);
      fmt = { channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what}: fmt and data chunks`).toBe(true);
  const width = fmt!.bits / 8; const x = new Int32Array(Math.floor(data!.length / width));
  for (let i = 0; i < x.length; i++) x[i] = data!.readIntLE(i * width, width);
  return { ...fmt!, x };
}
/** The reference decode of integer samples (Decode worker: sample ÷ 2^(depth − 1) as f32), as its bytes. */
export function referenceF32(x: Int32Array, bits: number): Buffer {
  const b = Buffer.alloc(x.length * 4);
  x.forEach((v, i) => b.writeFloatLE(Math.fround(v / 2 ** (bits - 1)), 4 * i));
  return b;
}

// ---------------------------------------------------------------------------------------------------
// FATE's synthetic sound (tests/audiogen.c), its first section only: one second of a 1,000 Hz integer cosine at
// 44,100 Hz on two channels, `(int_cos(a) × 10000) >> 16`. lavf_audio reads the file as mono (`-f s16le` with no
// `-ac`), so its one second is the file's first 44,100 values.

const COS_TABLE = [
  0x8000, 0x7ffe, 0x7ff6, 0x7fea, 0x7fd9, 0x7fc2, 0x7fa7, 0x7f87, 0x7f62, 0x7f38, 0x7f0a, 0x7ed6, 0x7e9d, 0x7e60, 0x7e1e, 0x7dd6,
  0x7d8a, 0x7d3a, 0x7ce4, 0x7c89, 0x7c2a, 0x7bc6, 0x7b5d, 0x7aef, 0x7a7d, 0x7a06, 0x798a, 0x790a, 0x7885, 0x77fb, 0x776c, 0x76d9,
  0x7642, 0x75a6, 0x7505, 0x7460, 0x73b6, 0x7308, 0x7255, 0x719e, 0x70e3, 0x7023, 0x6f5f, 0x6e97, 0x6dca, 0x6cf9, 0x6c24, 0x6b4b,
  0x6a6e, 0x698c, 0x68a7, 0x67bd, 0x66d0, 0x65de, 0x64e9, 0x63ef, 0x62f2, 0x61f1, 0x60ec, 0x5fe4, 0x5ed7, 0x5dc8, 0x5cb4, 0x5b9d,
  0x5a82, 0x5964, 0x5843, 0x571e, 0x55f6, 0x54ca, 0x539b, 0x5269, 0x5134, 0x4ffb, 0x4ec0, 0x4d81, 0x4c40, 0x4afb, 0x49b4, 0x486a,
  0x471d, 0x45cd, 0x447b, 0x4326, 0x41ce, 0x4074, 0x3f17, 0x3db8, 0x3c57, 0x3af3, 0x398d, 0x3825, 0x36ba, 0x354e, 0x33df, 0x326e,
  0x30fc, 0x2f87, 0x2e11, 0x2c99, 0x2b1f, 0x29a4, 0x2827, 0x26a8, 0x2528, 0x23a7, 0x2224, 0x209f, 0x1f1a, 0x1d93, 0x1c0c, 0x1a83,
  0x18f9, 0x176e, 0x15e2, 0x1455, 0x12c8, 0x113a, 0x0fab, 0x0e1c, 0x0c8c, 0x0afb, 0x096b, 0x07d9, 0x0648, 0x04b6, 0x0324, 0x0192,
  0x0000, 0x0000,
];
const FRAC_ONE = 1 << 16;
const CSHIFT = 16 - 7 - 2;
function intCos(angle: number): number {
  let a = angle & (FRAC_ONE - 1);
  if (a >= FRAC_ONE / 2) a = FRAC_ONE - a;
  let neg = 0;
  if (a > FRAC_ONE / 4) { neg = -1; a = FRAC_ONE / 2 - a; }
  const p = a >> CSHIFT; const f = a & ((1 << CSHIFT) - 1);
  let v = COS_TABLE[p]! + (((COS_TABLE[p + 1]! - COS_TABLE[p]!) * f + (1 << (CSHIFT - 1))) >> CSHIFT);
  v = (v ^ neg) - neg;
  return v << 1;
}
/** The first second lavf_audio encodes: 44,100 mono s16le samples of asynth1.sw. */
export function lavfSecond(): Buffer {
  const values: number[] = [];
  let a = 0;
  for (let i = 0; values.length < 44_100; i++) {
    const v = (intCos(a) * 10_000) >> 16;
    values.push(v, v);
    a += Math.trunc((1000 * FRAC_ONE) / 44_100);
  }
  const b = Buffer.alloc(44_100 * 2);
  for (let i = 0; i < 44_100; i++) b.writeInt16LE(values[i]!, 2 * i);
  return b;
}
