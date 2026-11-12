// AC2: "At the loop seam, the sample-to-sample step and the spectral flux across the join stay within the bed's own 99th
// percentile. A planted bed whose last 10 ms are cut, leaving a click, fails, naming the sample offset of the seam"
//
// The clean bed (fixtures/synth.ts bed: 16 bars at 100 BPM, every tone a whole number of cycles over it and every
// drum's tail wrapped to its start) loops with a join like any bar line inside it. The planted bed is the same file with
// its last 480 samples (10 ms) cut away and its region its whole new length, so the join steps from 10 ms before the
// downbeat to the downbeat: the 50 Hz drone jumps by about twice its level, a click. Its seam is at `end` = 1,842,720.
// Neither has a beats record: the seam rule reads the PCM alone (the tempo rule's BLOCKED is AC1's).
import { describe, expect, it } from 'vitest';
import { bed, cut, wavF32 } from './fixtures/synth.ts';
import { AC, REGION, TIMEOUT, forProof, gens, mediaDoc, music, numbers, ofCode, proof, putAsset, show, useEvidence, useShow } from './helpers.ts';

const deepShow = useShow();
const evidenceDir = useEvidence();

describe('AC2 a bed\'s loop seam is no rougher than the bed itself', () => {
  it(`${AC[2]} the clean bed's join stays within its own 99th percentiles (no audio.gen.seam); the bed with its last 10 ms cut fails audio.gen.seam, naming the seam's sample offset 1842720`, () => {
    const clean = bed(100, 16);
    const clipped = cut(clean.mix, 10);
    expect([clean.length, clipped.length], 'fixture: the clean bed is 1,843,200 samples and the cut one 480 fewer').toEqual([REGION, REGION - 480]);
    const evidence = evidenceDir();
    const loop = putAsset(evidence, wavF32(clean.mix));
    const clicked = putAsset(evidence, wavF32(clipped));
    const doc = mediaDoc({ loop: music(loop, REGION), cut_loop: music(clicked, clipped.length) });
    const g = gens(deepShow(), evidence, doc, ['loop', 'cut_loop'], 'the clean and the cut bed');
    proof('ac2-gen.json', { seam: { clean: REGION, cut: clipped.length }, loop: forProof(g['loop']!), cut_loop: forProof(g['cut_loop']!) });

    const cleanSeam = ofCode(g['loop']!, 'audio.gen.seam');
    expect(cleanSeam.map((i) => i.raw), `the clean bed's join stays within its own 99th percentiles: no audio.gen.seam (state ${g['loop']!.state})`).toEqual([]);

    const cutGen = g['cut_loop']!;
    const seam = ofCode(cutGen, 'audio.gen.seam');
    expect(cutGen.state, `the bed with its last 10 ms cut fails: ${show(cutGen.raw)}`).toBe('FAIL');
    expect(seam.some((i) => numbers(i).includes(clipped.length)), `the bed with its last 10 ms cut fails audio.gen.seam, naming the seam's sample offset ${clipped.length}: ${show(seam.map((i) => i.raw))}`).toBe(true);
  }, TIMEOUT);
});
