// Oracle lane for #154 criterion 2 (AC2 #154.8b0e5b99: "Each event's note_on lands on its resolved flick within one
// sample, ..."), ported from the upstream web-platform-tests file
// webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html at commit
// 2f57f45d21482f94b36123dfcec77ae7ab859bc1 (README). Upstream schedules a 512-sample impulse (1 at its first sample)
// at nine sample offsets, inside and across 128-sample render quanta, renders, and checks that the left and right
// channels match, that every non-zero sample sits at one of the offsets, and that exactly nine are non-zero. Here the
// impulse is a sample library's one take, each offset an event of a score whose bar:beat resolves exactly to that
// sample at 48 kHz, and the render is score.render@1's stem: the plan's and the render's note_on put each event on its
// sample, and the stem holds the impulses there and nowhere else. The planted fault, built here from our own stem,
// moves each impulse to the start of its 128-sample quantum, as a renderer that starts notes per block would, and the
// ported check must reject it.
//
// Ported from web-platform-tests, under its license:
//
// The 3-Clause BSD License
//
// Copyright © web-platform-tests contributors
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
// following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
//    disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
//    following disclaimer in the documentation and/or other materials provided with the distribution.
// 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
//    products derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
// INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
// WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
import { describe, expect, it } from 'vitest';
import {
  AC, CC0, SAMPLE, TIMEOUT, film, flickAt, impulseTake, metaOf, outputsOf, packDirs, planOf, planReply, proof, ref, renderStem, sampled, scoreItem, scoreWorld,
  stemOf, tempo, useShow, wav16, type Ev, type Library,
} from '../154/helpers.ts';

const showBin = useShow();
/** Upstream's offsets, as samples: `sampleOffsets` in sample-accurate-scheduling.html. */
const OFFSETS = [0, 3, 512, 517, 1000, 1005, 20000, 21234, 37590];
/** Upstream's render quantum. */
const QUANTUM = 128;
const BPM = 90;

/** test/clicks: one preset, `click`, whose one take is upstream's impulse, rooted at MIDI 60. CC0. */
const CLICKS: Library = { id: 'test/clicks', version: '1.0.0', license: CC0, presets: { click: { zones: [{ lo: 0, hi: 127, root: 60, takes: [{ path: 'click.wav', bytes: wav16(impulseTake()) }] }] } } };
/** Offset s as bar 1's beat 1 + s ÷ 32,000 (a beat at 90 BPM is 32,000 samples), a finite decimal. */
function beatOf(s: number): string {
  const n = 100_000_000n + BigInt(s) * 3125n;
  const frac = String(n % 100_000_000n).padStart(8, '0').replace(/0+$/, '');
  return `1:${n / 100_000_000n}${frac ? `.${frac}` : ''}`;
}
/** The score: event c<k> at offset k, on the click, at pitch 60 (its root, so nothing resamples it), full velocity,
 * centred, with no attack or release. Each carries a bend from 30 ms, past the 512-sample take, so score.pitch lists
 * the click as unmeasured instead of measuring a tone it doesn't have (README: Readings). */
function clicks() {
  const events: Record<string, Ev> = {};
  OFFSETS.forEach((s, k) => { events[`c${k}`] = { at: beatOf(s), inst: 'click', pitch: 60, dur: '0.1s', vel: 1, gain: 0, pan: 0, attack: '0s', release: '0s', bend: [[0.03, 0], [0.06, 1]] }; });
  return film([scoreItem('clicks', { click: sampled(ref(CLICKS), 'click', 'clicks') }, events)], { tempo: tempo(BPM), packs: [ref(CLICKS)], span: '4s' });
}
/** Upstream's checkSampleAccuracy, ported: left and right match, every non-zero sample at an offset, exactly as many
 * as the offsets. Returns its failures, each in upstream's words. */
function checkSampleAccuracy(left: ArrayLike<number>, right: ArrayLike<number>, offsets: number[]): string[] {
  const failures: string[] = [];
  let mismatch = -1;
  for (let i = 0; i < Math.max(left.length, right.length) && mismatch < 0; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) mismatch = i;
  if (mismatch >= 0) failures.push(`Content of left and right channels match: they differ at sample ${mismatch}`);
  let impulses = 0;
  let bad = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] === 0) continue;
    impulses++;
    if (!offsets.includes(i)) { bad++; failures.push(`Non-zero sample found at sample offset ${i}`); }
  }
  if (impulses !== offsets.length) failures.push(`Number of impulses found: ${impulses}, expected ${offsets.length}`);
  else if (bad !== 0) failures.push(`bad offset: ${bad}`);
  return failures;
}

describe(`${AC[2]} oracle: upstream's sample-accurate scheduling, run on score.render@1's note_on and stem`, () => {
  it(`${AC[2]} impulses at offsets inside and across 128-sample quanta land on exactly their sample and nowhere else; a renderer that starts notes per quantum is rejected`, async () => {
    for (const s of OFFSETS) expect(flickAt(beatOf(s), BPM), `the fixture: ${beatOf(s)} resolves to sample ${s} exactly`).toBe(s * SAMPLE);
    const w = await scoreWorld([CLICKS]);
    const plan = planOf(planReply(showBin(), w.evidence, clicks(), 'clicks', packDirs(w), 'the clicks'), 'the clicks');
    const r = await renderStem(w, plan.stems['clicks']!);
    const out = outputsOf(r, 'the clicks');
    const meta = metaOf(w, out.meta, 'the clicks');
    const stem = stemOf(w, out.stem, 'the clicks');
    const [left, right] = [stem.samples[0]!, stem.samples[1]!];
    const ours = checkSampleAccuracy(left, right, OFFSETS);
    // The planted fault: each impulse moved to the start of its quantum.
    const moved = new Int32Array(left.length);
    OFFSETS.forEach((s) => { const q = Math.floor(s / QUANTUM) * QUANTUM; moved[q] = moved[q]! + left[s]!; });
    const planted = checkSampleAccuracy(moved, moved, OFFSETS);
    proof('oracle-sample-accurate.json', {
      note_on: plan.note_on, meta_note_on: meta.note_on,
      nonzero: Array.from(left.keys()).filter((i) => left[i] !== 0), ours, planted,
    });
    OFFSETS.forEach((s, k) => {
      const n = plan.note_on.find((o) => o.event === `c${k}`);
      expect([n?.t, n?.sample], `c${k}'s note_on in the plan is flick ${s * SAMPLE}, sample ${s}`).toEqual([s * SAMPLE, s]);
      expect(meta.note_on.find((o) => o.event === `c${k}`)?.sample, `c${k}'s note_on in the render is sample ${s}`).toBe(s);
    });
    expect(ours, `upstream's check on our stem: ${ours.join(' | ')}`).toEqual([]);
    expect(planted.length, `upstream's check rejects impulses moved to their quantum's start: ${planted.join(' | ')}`).toBeGreaterThan(0);
    expect(planted.some((f) => /Non-zero sample found at sample offset 896\b/.test(f)), 'it names sample 896, where the impulses at 1000 and 1005 land once quantized').toBe(true);
  }, TIMEOUT);
});
