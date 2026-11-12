// Test-side tools for the #157 Oracle lane: FFmpeg's FATE tests, pinned by the oracle map at FFmpeg 24e860f6d3, run
// against our output (#136). The ProRes 4444 samples are fetched on first use into a cache outside the checkout and
// checked against the SHA-256 pins in fixtures/fate/samples.json; the reference outputs the tests read are vendored
// in fixtures/fate/ unchanged, with FFmpeg's notice and licence (NOTICE, COPYING.LGPLv2.1); FATE's audiomatch is ported
// below with its licence notice kept. Everything else (the build, the fixture films, the export call, this suite's own
// box reader and FFmpeg as a reader) is the #157 suite's (`../157/helpers.ts`).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { isObject, show, type JsonObject } from '../157/helpers.ts';

export * from '../157/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures', 'fate');

// ---------------------------------------------------------------------------------------------------
// The FATE samples (criterion 10), fetched on first use, never committed.

export interface FateSample { ref: string; sample: string; sha256: string; bytes: number }
export const FATE = JSON.parse(readFileSync(join(FIXTURES, 'samples.json'), 'utf8')) as { commit: string; suite: string; samples: FateSample[] };
/** The cache the samples are fetched into: `DEEP_FATE_SAMPLES`, else the user's cache folder (#498's). */
export function fateCache(): string {
  const env = process.env['DEEP_FATE_SAMPLES'];
  if (env) return env;
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'deepbuild', 'fate-suite') : join(homedir(), '.cache', 'deepbuild', 'fate-suite');
}
const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
/** Each sample's path in the cache, fetched first when missing; a sample that can't be fetched or doesn't hash to its
 * pin makes the set unavailable, with the reason. */
export async function fetchFate(): Promise<{ paths: Map<string, string>; problem: string | null }> {
  const root = fateCache();
  const paths = new Map<string, string>();
  for (const s of FATE.samples) {
    const p = join(root, s.sample);
    if (!existsSync(p)) {
      let body: Buffer;
      try {
        const r = await fetch(`${FATE.suite}${s.sample}`, { signal: AbortSignal.timeout(120_000) });
        if (!r.ok) return { paths, problem: `${FATE.suite}${s.sample} answered HTTP ${r.status}` };
        body = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        return { paths, problem: `${FATE.suite}${s.sample} could not be fetched (${(e as Error).message})` };
      }
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(`${p}.part`, body);
      renameSync(`${p}.part`, p);
    }
    const got = sha256File(p);
    if (got !== s.sha256) return { paths, problem: `${p} hashes to ${got}, not the pinned ${s.sha256}; delete it to fetch it again` };
    paths.set(s.ref, p);
  }
  return { paths, problem: null };
}

// ---------------------------------------------------------------------------------------------------
// The vendored references

export const refText = (ref: string): string => readFileSync(join(FIXTURES, ref), 'utf8');
/** A framecrc or framemd5 reference's frame lines (`stream, dts, pts, duration, size, hash`), white space removed. */
export const frameLines = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).map((l) => l.replace(/\s+/g, ''));
/** The first frame line's pts of a framemd5 reference. */
export function firstPts(ref: string): bigint {
  const line = frameLines(refText(ref))[0];
  if (!line) throw Error(`${ref} has no frame line`);
  return BigInt(line.split(',')[2]!);
}
/** A `key=value` field of an ffprobe reference (the first one). */
export function refField(ref: string, key: string): string {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(refText(ref));
  if (!m) throw Error(`${ref} has no ${key}`);
  return m[1]!.trim();
}
/** audiomatch's reference line: `presig: <n> postsig:<n> lenerr:<n>`. */
export function refAudiomatch(ref: string): { presig: number; lenerr: number } {
  const m = /presig: (-?\d+) postsig:(-?\d+) lenerr:(-?\d+)/.exec(refText(ref));
  if (!m) throw Error(`${ref} has no audiomatch line`);
  return { presig: Number(m[1]), lenerr: Number(m[3]) };
}

// ---------------------------------------------------------------------------------------------------
// FATE's audiomatch (tests/audiomatch.c at FFmpeg 24e860f6d3c4f2ebae65ed7649e2a8860d512879), ported: the offset at which
// a decoded file's interleaved 16-bit samples best match the reference's, searched from 0 outwards, and the length
// error. Its notice, kept as AGENTS.md asks of ported code:
//
//   This file is part of FFmpeg.
//
//   FFmpeg is free software; you can redistribute it and/or
//   modify it under the terms of the GNU Lesser General Public
//   License as published by the Free Software Foundation; either
//   version 2.1 of the License, or (at your option) any later version.
//
//   FFmpeg is distributed in the hope that it will be useful,
//   but WITHOUT ANY WARRANTY; without even the implied warranty of
//   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
//   Lesser General Public License for more details.
//
//   You should have received a copy of the GNU Lesser General Public
//   License along with FFmpeg; if not, write to the Free Software
//   Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
//
// The licence's text is fixtures/fate/COPYING.LGPLv2.1.

export interface Match { presig: number; postsig: number; lenerr: number; c: number; ok: boolean }
/** audiomatch's search over `data` (the decoded file) against `signal` (the reference), both interleaved 16-bit. */
export function audiomatch(data: Int16Array, signal: Int16Array): Match {
  const eps = 0.161;
  let maxshift = 16384;
  let bestpos = 0; let bestc = 0; let sigamp = 0;
  for (let i = 0; i < signal.length; i++) sigamp += signal[i]! * signal[i]!;
  for (let pos = 0; pos < maxshift; pos = pos < 0 ? -pos : -pos - 1) {
    let c = 0;
    const testlen = Math.min(signal.length, data.length - pos);
    for (let i = Math.max(0, -pos); i < testlen; i++) c += signal[i]! * data[pos + i]!;
    if (Math.abs(c) > sigamp * 0.94) maxshift = Math.min(maxshift, Math.abs(pos) + 32);
    if (Math.abs(c) > Math.abs(bestc)) { bestc = c; bestpos = pos; }
  }
  const ratio = bestc / sigamp;
  return { presig: bestpos, postsig: data.length - signal.length - bestpos, lenerr: data.length - signal.length, c: ratio, ok: Math.abs(1 - ratio) <= eps };
}
/** Float channels as interleaved 16-bit, as `ffmpeg -f s16le` writes them. */
export function s16(channels: Float32Array[]): Int16Array {
  const n = channels[0]!.length; const out = new Int16Array(n * channels.length);
  for (let i = 0; i < n; i++) channels.forEach((c, k) => { out[i * channels.length + k] = Math.max(-32768, Math.min(32767, Math.round(c[i]! * 32768))); });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The decode worker's probe: the video stream's alpha range (README: the probe's `alpha`).

/** `media_import`'s video stream: its `color.range` and its `alpha.range` (null when it has no alpha). */
export function probeRanges(reply: JsonObject, what: string): { range: string; alpha: string | null } {
  const streams = isObject(reply['asset']) && isObject(reply['asset']['probe']) ? reply['asset']['probe']['streams'] : undefined;
  const v = (Array.isArray(streams) ? streams : []).filter(isObject).filter((s) => s['type'] === 'video');
  expect(v.length, `${what}: the probe lists one video stream: ${show(reply, 600)}`).toBe(1);
  const s = v[0]!;
  const color = isObject(s['color']) ? s['color'] : {};
  const alpha = isObject(s['alpha']) ? s['alpha'] : null;
  return { range: String(color['range']), alpha: alpha ? String(alpha['range']) : null };
}

/** 12-bit Y'CbCr with alpha (yuva444p12le) to BGRA8: BT.709, colour limited range, alpha full range. */
export function yuva12ToBgra(planes: Buffer, w: number, h: number): Buffer {
  const n = w * h; const out = Buffer.alloc(n * 4);
  const at = (p: number, i: number): number => planes.readUInt16LE(2 * (p * n + i));
  const clip = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < n; i++) {
    const y = (at(0, i) - 256) / 3504; const cb = (at(1, i) - 2048) / 3584; const cr = (at(2, i) - 2048) / 3584;
    out[4 * i + 2] = clip(y + 1.5748 * cr);
    out[4 * i + 1] = clip(y - 0.18733 * cb - 0.46813 * cr);
    out[4 * i] = clip(y + 1.8556 * cb);
    out[4 * i + 3] = Math.round((at(3, i) * 255) / 4095);
  }
  return out;
}
