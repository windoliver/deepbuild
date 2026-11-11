// AC4 #935.003bdbdb (Oracle lane, port): the upstream loudness meter's test/tests.c at commit
// 67b33abe1558160ed76ada1322329b0e9e058b02, lines 257-347, run against audio.gen's own readings: each EBU signal is the
// one take of a `sound` entry, and media_gen's audio.gen.level and audio.gen.peak issues name what audio.gen read
// (README: How each upstream case is read). Ported, with tests.c's files, expected values and tolerances:
//   TEST_GLOBAL_LOUDNESS  integrated loudness within ±0.1 of gr[i]       → the reading audio.gen.level names
//   TEST_MAX_TRUE_PEAK    true peak within +0.2/−0.4 dB of its literal   → the reading audio.gen.peak names (8×)
// Not ported: seq-3341-6 in 5 and 6 channels (a `sound` take declares no channel layout, and how audio.gen weights a
// 5.0 or 5.1 file is open in the design), ebur128_loudness_global_multiple and TEST_LRA (audio.gen reads neither), and
// the EXACT_PASSED column (the upstream meter's own outputs).
//
// The expected values below come from tests.c, which carries this notice (the upstream COPYING at that commit):
//
//   Copyright (c) 2011 Jan Kokemüller
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.
import { beforeAll, describe, expect, it } from 'vitest';
import { ebuSet, type EbuSet } from '../500/bake/helpers.ts';
import { AC, TIMEOUT, gens, mediaDoc, ofCode, proof, putAsset, show, sound, useEvidence, useShow, type Issue } from '../935/helpers.ts';

const deepShow = useShow();
const evidenceDir = useEvidence();

let set: EbuSet | string = 'BLOCKED: the EBU set was not read';
beforeAll(async () => { set = await ebuSet(); }, TIMEOUT);
const ebu = (): EbuSet => (typeof set === 'string' ? expect.fail(set) : set);

/** The numbers an issue's `actual` holds: the value it refused, the reading. */
const readings = (i: Issue): number[] => [...JSON.stringify(i.actual ?? null).replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((m) => Number(m[0]));

interface Case { id: string; file: string; bytes: Uint8Array; code: 'audio.gen.level' | 'audio.gen.peak'; target: number; lo: number; hi: number; expected: string }

/** Each case's file as the one take of its own `sound` entry; the cases whose issue is missing or names no reading in [lo, hi]. */
function run(cases: Case[], what: string): string[] {
  const evidence = evidenceDir();
  const doc = mediaDoc(Object.fromEntries(cases.map((c) => [c.id, sound([c.target], [[putAsset(evidence, c.bytes)]])])));
  const g = gens(deepShow(), evidence, doc, cases.map((c) => c.id), what);
  proof(`oracle-${what}.json`, cases.map((c) => ({ file: c.file, id: c.id, target: c.target, issues: g[c.id]!.issues.map((i) => i.raw) })));
  return cases.flatMap((c) => {
    const found = ofCode(g[c.id]!, c.code);
    if (found.length === 0) return [`FAILED - ${c.file}: no ${c.code} issue (state ${g[c.id]!.state}), so audio.gen read it outside ${c.expected}`];
    return found.some((i) => readings(i).some((v) => v >= c.lo - 1e-9 && v <= c.hi + 1e-9)) ? [] : [`FAILED - ${c.file}: ${c.code} names no reading within ${c.expected}: ${show(found.map((i) => i.raw), 600)}`];
  });
}

/** A 24-bit PCM WAVE file's channels as floats (the EBU true-peak signals: format 1, 48 kHz). */
function pcm24(b: Uint8Array): Float32Array[] {
  const buf = Buffer.from(b);
  let at = 12, ch = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      expect([buf.readUInt16LE(at + 8), buf.readUInt32LE(at + 12), buf.readUInt16LE(at + 22)], 'an EBU true-peak signal is 24-bit PCM at 48 kHz').toEqual([1, 48_000, 24]);
      ch = buf.readUInt16LE(at + 10);
    } else if (id === 'data') {
      const frames = Math.floor(size / (3 * ch));
      const out = Array.from({ length: ch }, () => new Float32Array(frames));
      for (let n = 0; n < frames; n++) for (let c = 0; c < ch; c++) out[c]![n] = buf.readIntLE(at + 8 + 3 * (n * ch + c), 3) / 8_388_608;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return expect.fail('an EBU true-peak signal has a data chunk');
}
/** Channels as one 32-bit IEEE-float WAVE file at 48 kHz, each sample times `gain`. */
function floatWav(channels: Float32Array[], gain: number): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const b = Buffer.alloc(44 + frames * nch * 4);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + frames * nch * 4, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(48_000, 24); b.writeUInt32LE(48_000 * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(frames * nch * 4, 40);
  for (let n = 0, o = 44; n < frames; n++) for (const c of channels) { b.writeFloatLE(c[n]! * gain, o); o += 4; }
  return new Uint8Array(b);
}

// tests.c line 246: double gr[] = { -23.0, -33.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0 };
const GR: [string, number][] = [
  ['seq-3341-1-16bit.wav', -23.0], ['seq-3341-2-16bit.wav', -33.0], ['seq-3341-3-16bit-v02.wav', -23.0], ['seq-3341-4-16bit-v02.wav', -23.0],
  ['seq-3341-5-16bit-v02.wav', -23.0], ['seq-3341-7_seq-3342-5-24bit.wav', -23.0], ['seq-3341-2011-8_seq-3342-6-24bit-v02.wav', -23.0],
];
// tests.c lines 338-346: TEST_MAX_TRUE_PEAK(file, expected), within +0.2/−0.4.
const TP: [string, number][] = [
  ['seq-3341-15-24bit.wav.wav', -6.0], ['seq-3341-16-24bit.wav.wav', -6.0], ['seq-3341-17-24bit.wav.wav', -6.0], ['seq-3341-18-24bit.wav.wav', -6.0],
  ['seq-3341-19-24bit.wav.wav', 3.0], ['seq-3341-20-24bit.wav.wav', 0.0], ['seq-3341-21-24bit.wav.wav', 0.0], ['seq-3341-22-24bit.wav.wav', 0.0], ['seq-3341-23-24bit.wav.wav', 0.0],
];
/** The gain the −6 dBTP signals get so their peak lands over audio.gen's −1 dBTP ceiling: +5.8 dB, to −0.2 dBTP. */
const LIFT = 5.8;

describe('the upstream loudness meter\'s test/tests.c (67b33abe15) lines 257-347 on audio.gen\'s readings', () => {
  it(`${AC[4]} TEST_GLOBAL_LOUDNESS (lines 266-284): seven files read integrated loudness within 0.1 of gr[], as audio.gen.level names it`, () => {
    const set_ = ebu();
    const cases: Case[] = GR.map(([file, gr], k) => ({
      id: `global_${k}`, file, bytes: set_.file(file), code: 'audio.gen.level', target: gr + 2, lo: gr - 0.1, hi: gr + 0.1, expected: `${gr} ±0.1 LUFS (its take's target is ${gr + 2}, 2 LU above)`,
    }));
    expect(run(cases, 'TEST_GLOBAL_LOUDNESS')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} TEST_MAX_TRUE_PEAK (lines 329-346): signals 15 to 23 read their maximum true peak within +0.2/−0.4 dB, as audio.gen.peak names it`, () => {
    const set_ = ebu();
    const cases: Case[] = TP.map(([file, want], k) => {
      const lift = want < -1 ? LIFT : 0;
      const bytes = lift ? floatWav(pcm24(set_.file(file)), 10 ** (lift / 20)) : set_.file(file);
      return {
        id: `peak_${k}`, file: lift ? `${file} lifted ${LIFT} dB` : file, bytes, code: 'audio.gen.peak', target: -23,
        lo: want + lift - 0.4, hi: want + lift + 0.2, expected: `${want} +0.2/−0.4 dBTP${lift ? `, read ${LIFT} dB higher` : ''}`,
      };
    });
    expect(run(cases, 'TEST_MAX_TRUE_PEAK')).toEqual([]);
  }, TIMEOUT);
});
