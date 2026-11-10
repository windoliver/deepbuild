// AC7 #502.ecdfe344 and AC8 #502.6db99478 (Oracle lane, port): libebur128 67b33abe1558160ed76ada1322329b0e9e058b02,
// test/tests.c lines 246-284 and 312-327, run against our export. Each upstream macro is one test here, with its
// files, expected values and tolerances as tests.c states them (gr[], lra[] and each macro's literal). Where tests.c
// hands a file to its meter, this lane makes the file the master of a film (one strip at unity on the master, README:
// The films) and exports it with `audio.codec: pcm` and no loudness profile, so the readings are our output's:
//   TEST_GLOBAL_LOUDNESS  ebur128_loudness_global, ±0.1 of gr[i]   → the receipt's `integrated` and `delivery.integrated`
//   TEST_LRA              ebur128_loudness_range, ±1 of lra[i]     → the receipt's `lra` and `delivery.lra`
// Not ported: the 5- and 6-channel copies of signal 6 (an export's master is stereo); ebur128_loudness_global_multiple
// (lines 286-310; an export has one master); the EXACT_PASSED column (gre[], lrae[]: libebur128's own outputs, which
// its file says need not match). #500's Oracle lane holds the meter itself to all of them through `media_bake`.
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
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ebuSet, type EbuSet } from '../500/bake/helpers.ts';
import { AC, DOC, FULL, TIMEOUT, exportCall, filmRun, loudnessOf, lu, masterFilm, putEvidence, receiptOf, useFileTemp, useShow, wavFrames, type JsonObject, type Loudness } from '../502/helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('oracle-ebu');

let set: EbuSet | string = 'BLOCKED: the EBU set was not read';
beforeAll(async () => { set = await ebuSet(); }, TIMEOUT);

const EBU_LICENSE: JsonObject = { id: 'LicenseRef-EBU-loudness-test-set-v05', terms: 'Provided by the EBU as is, for technical testing purposes only.', shareable: false, credit: 'EBU loudness test set v05' };
const read = new Map<string, Loudness>();
/** The receipt's loudness readings of a PCM export whose master is `file`; each file is exported once. */
function exported(file: string): Loudness {
  if (typeof set === 'string') expect.fail(set);
  let l = read.get(file);
  if (!l) {
    const evidence = temp(); const dir = temp();
    const bytes = set.file(file);
    const what = `the PCM export whose master is ${file}`;
    const [reply] = filmRun(shows.bin(FULL), evidence, masterFilm(putEvidence(evidence, bytes), wavFrames(bytes), EBU_LICENSE), [
      exportCall({ doc: DOC.a, out: join(dir, 'master.mp4'), video: { codec: 'h264' }, audio: { codec: 'pcm' } }),
    ], what);
    l = loudnessOf(receiptOf(reply!, what).raw, what);
    read.set(file, l);
  }
  return l;
}
const within = (v: number, lo: number, hi: number): boolean => v >= lo - 1e-12 && v <= hi + 1e-12;

// tests.c line 246: double gr[] = { -23.0, -33.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0 };
const gr = [-23.0, -33.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0, -23.0];
// tests.c line 252: double lra[] = { 10.0, 5.0, 20.0, 15.0, 5.0, 15.0 };
const lra = [10.0, 5.0, 20.0, 15.0, 5.0, 15.0];

describe('libebur128 test/tests.c (67b33abe15) lines 246-284 and 312-327 on our PCM export', () => {
  it(`${AC[8]} TEST_GLOBAL_LOUDNESS (lines 266-284): seq-3341-1-16bit.wav and the six other stereo files, each the master of a PCM export, read integrated loudness within 0.1 of gr[] on the receipt and on its decoded delivery`, () => {
    // [file, its index in gr[]]: indices 5 and 6 are the 5- and 6-channel files, not ported.
    const files: [string, number][] = [
      ['seq-3341-1-16bit.wav', 0], ['seq-3341-2-16bit.wav', 1], ['seq-3341-3-16bit-v02.wav', 2], ['seq-3341-4-16bit-v02.wav', 3],
      ['seq-3341-5-16bit-v02.wav', 4], ['seq-3341-7_seq-3342-5-24bit.wav', 7], ['seq-3341-2011-8_seq-3342-6-24bit-v02.wav', 8],
    ];
    const failed = files.flatMap(([file, i]) => {
      const l = exported(file);
      return [['the receipt', l.integrated] as const, ['the decoded delivery', l.delivery.integrated] as const]
        .filter(([, v]) => !within(v, gr[i]! - 0.1, gr[i]! + 0.1)).map(([where, v]) => `FAILED - ${file}: ${where} reads ${lu(v)} LUFS, not ${gr[i]} ±0.1`);
    });
    expect(failed).toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} TEST_LRA (lines 312-327): the six files, each the master of a PCM export, read loudness range within 1 of lra[] on the receipt and on its decoded delivery`, () => {
    const files = ['seq-3342-1-16bit.wav', 'seq-3342-2-16bit.wav', 'seq-3342-3-16bit.wav', 'seq-3342-4-16bit.wav', 'seq-3341-7_seq-3342-5-24bit.wav', 'seq-3341-2011-8_seq-3342-6-24bit-v02.wav'];
    const failed = files.flatMap((file, i) => {
      const l = exported(file);
      return [['the receipt', l.lra] as const, ['the decoded delivery', l.delivery.lra] as const]
        .filter(([, v]) => !within(v, lra[i]! - 1, lra[i]! + 1)).map(([where, v]) => `FAILED - ${file}: ${where} reads ${lu(v)} LU, not ${lra[i]} ±1`);
    });
    expect(failed).toEqual([]);
  }, TIMEOUT);
});
