// AC3 #500.5b74b67b (Oracle lane, port): libebur128 67b33abe1558160ed76ada1322329b0e9e058b02, test/tests.c lines
// 246-406, run against our loudness bake. Each upstream macro is one test here, with its files, expected values and
// tolerances as tests.c states them (gr[], lra[] and each macro's literal), and its reading taken as tests.c takes it:
//   TEST_GLOBAL_LOUDNESS  ebur128_loudness_global, ±0.1 of gr[i]                    → the bake's `integrated`
//   TEST_LRA              ebur128_loudness_range, ±1 of lra[i]                       → the bake's `range`
//   TEST_MAX_TRUE_PEAK    max over channels of ebur128_true_peak, +0.2/−0.4 dB       → `true_peak` at tp_oversample 4
//                         (libebur128 oversamples 4× below 96 kHz)
//   TEST_MAX_MOMENTARY    max of ebur128_loudness_momentary read after every 10 ms once 400 ms are in, ±0.1
//                                                                                    → max of `momentary` from 400 ms
//   TEST_MAX_SHORTTERM    max of ebur128_loudness_shortterm read after every 100 ms (and the file's last, shorter read)
//                         once 3 s are in, ±0.1                                      → max of `short_term` at those ends
// The 5-channel file gets tests.c's channel map (L, R, C, Ls, Rs); the 6-channel file gets libebur128's default for six
// (L, R, C, unused, Ls, Rs), the fourth as our `lfe`. Not ported: ebur128_loudness_global_multiple (lines 286-310; our
// bake reads one asset, and no criterion reads several together) and the EXACT_PASSED column (gre[], lrae[]: libebur128's
// own outputs, which its file says need not match).
//
// The expected values below come from tests.c, which carries this notice (libebur128's COPYING at that commit):
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
import {
  AC, FIVE, SIX, TIMEOUT, bakes, between, ebuSet, fmt, loudnessOf, maxOf, putAsset, useEvidence, useShow,
  type EbuSet, type Loudness, type Place,
} from '../500/bake/helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

let set: EbuSet | string = 'BLOCKED: the EBU set was not read';
beforeAll(async () => { set = await ebuSet(); }, TIMEOUT);

interface Case { file: string; channels?: Place[]; check: (r: Loudness) => string | null }

/** Bakes each case's file at tp_oversample 4 and returns the cases whose reading misses, each naming its file. */
function run(cases: Case[], what: string): string[] {
  if (typeof set === 'string') expect.fail(set);
  const ebu = set;
  const evidence = evidenceDir();
  const asks = cases.map((c) => ({ asset: putAsset(evidence, ebu.file(c.file)), kind: 'loudness' as const, tp_oversample: 4 as const, ...(c.channels ? { channels: c.channels } : {}) }));
  return bakes(show(), evidence, asks, what).flatMap((b, i) => {
    const miss = cases[i]!.check(loudnessOf(b, `${what}: ${cases[i]!.file}`));
    return miss === null ? [] : [`FAILED - ${cases[i]!.file}: ${miss}`];
  });
}

const within = (v: number | null, lo: number, hi: number): boolean => v !== null && v >= lo - 1e-12 && v <= hi + 1e-12;

// tests.c line 246: double gr[] = { -23.0, -33.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0 };
const gr = [-23.0, -33.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0];
// tests.c line 252: double lra[] = { 10.0, 5.0, 20.0, 15.0, 5.0, 15.0 };
const lra = [10.0, 5.0, 20.0, 15.0, 5.0, 15.0];

describe('libebur128 test/tests.c (67b33abe15) lines 246-406 on our loudness bake', () => {
  it(`${AC[3]} TEST_GLOBAL_LOUDNESS (lines 266-284): nine files read integrated loudness within 0.1 of gr[]`, () => {
    const files: [string, Place[]?][] = [
      ['seq-3341-1-16bit.wav'], ['seq-3341-2-16bit.wav'], ['seq-3341-3-16bit-v02.wav'], ['seq-3341-4-16bit-v02.wav'],
      ['seq-3341-5-16bit-v02.wav'], ['seq-3341-6-5channels-16bit.wav', FIVE], ['seq-3341-6-6channels-WAVEEX-16bit.wav', SIX],
      ['seq-3341-7_seq-3342-5-24bit.wav'], ['seq-3341-2011-8_seq-3342-6-24bit-v02.wav'],
    ];
    const cases: Case[] = files.map(([file, channels], i) => ({
      file, ...(channels ? { channels } : {}),
      check: (r) => (within(r.integrated, gr[i]! - 0.1, gr[i]! + 0.1) ? null : `${fmt(r.integrated)} LUFS, not ${gr[i]} ±0.1`),
    }));
    expect(run(cases, 'TEST_GLOBAL_LOUDNESS')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} TEST_LRA (lines 312-327): six files read loudness range within 1 of lra[]`, () => {
    const files = ['seq-3342-1-16bit.wav', 'seq-3342-2-16bit.wav', 'seq-3342-3-16bit.wav', 'seq-3342-4-16bit.wav', 'seq-3341-7_seq-3342-5-24bit.wav', 'seq-3341-2011-8_seq-3342-6-24bit-v02.wav'];
    const cases: Case[] = files.map((file, i) => ({ file, check: (r) => (within(r.range, lra[i]! - 1, lra[i]! + 1) ? null : `${r.range.toFixed(3)} LU, not ${lra[i]} ±1`) }));
    expect(run(cases, 'TEST_LRA')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} TEST_MAX_TRUE_PEAK (lines 329-346): signals 15 to 23 read their maximum true peak within +0.2/−0.4 dB`, () => {
    const expected = [-6.0, -6.0, -6.0, -6.0, 3.0, 0.0, 0.0, 0.0, 0.0];
    const cases: Case[] = expected.map((want, k) => ({
      file: `seq-3341-${15 + k}-24bit.wav.wav`,
      check: (r) => (within(r.true_peak, want - 0.4, want + 0.2) ? null : `${r.true_peak.toFixed(3)} dBTP, not ${want} +0.2/−0.4`),
    }));
    expect(run(cases, 'TEST_MAX_TRUE_PEAK')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} TEST_MAX_MOMENTARY (lines 348-376): the twenty files of signal 13 read a maximum momentary loudness of −23.0 ±0.1, read every 10 ms from 400 ms`, () => {
    const cases: Case[] = Array.from({ length: 20 }, (_, k) => ({
      file: `seq-3341-13-${k + 1}-24bit.wav${k + 1 >= 3 ? '.wav' : ''}`,
      check: (r: Loudness) => {
        const m = maxOf(between(r.momentary, 390, Infinity));
        return within(m, -23.1, -22.9) ? null : `${fmt(m)} LUFS, not -23 ±0.1`;
      },
    }));
    expect(run(cases, 'TEST_MAX_MOMENTARY')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} TEST_MAX_SHORTTERM (lines 378-406): the twenty files of signal 10 read a maximum short-term loudness of −23.0 ±0.1, read every 100 ms from 3 s`, () => {
    const cases: Case[] = Array.from({ length: 20 }, (_, k) => ({
      file: `seq-3341-10-${k + 1}-24bit.wav`,
      check: (r: Loudness) => {
        const last = 10 * r.short_term.length;
        const m = maxOf(between(r.short_term, 2990, Infinity).filter((x) => x.ms % 100 === 0 || x.ms === last));
        return within(m, -23.1, -22.9) ? null : `${fmt(m)} LUFS, not -23 ±0.1`;
      },
    }));
    expect(run(cases, 'TEST_MAX_SHORTTERM')).toEqual([]);
  }, TIMEOUT);
});
