// AC3: "With `stems`, the stems summed sample by sample equal the mix with a residual at or under −60 dBFS RMS. A planted
// result whose drum stem is shifted by 1 ms fails, naming the stem and the residual"
//
// The clean bed's mix is its three stems (drums, bass, pad) added sample by sample, so its residual is f32 rounding,
// about −172 dBFS. The planted result declares the same mix with its drums stem moved 48 samples (1 ms) later, its
// length kept: its residual is the drums less themselves 1 ms on, about −27.5 dBFS RMS, which this file computes from
// the samples it wrote (20 log10 of the RMS of mix − Σ stems over every sample). Neither has a beats record: the stems
// rule reads the PCM alone.
import { describe, expect, it } from 'vitest';
import { bed, residualDbfs, shifted, wavF32 } from './fixtures/synth.ts';
import { AC, REGION, TIMEOUT, forProof, gens, mediaDoc, music, namesNumber, ofCode, proof, putAsset, show, useEvidence, useShow } from './helpers.ts';

const deepShow = useShow();
const evidenceDir = useEvidence();

describe('AC3 a bed\'s stems sum to its mix', () => {
  it(`${AC[3]} the clean bed's drums, bass and pad sum to its mix (no audio.gen.stems); with its drum stem shifted by 1 ms it fails audio.gen.stems, naming drums and the residual`, () => {
    const clean = bed(100, 16);
    const late = shifted(clean.stems.drums, 1);
    const { drums, bass, pad } = clean.stems;
    const cleanResidual = residualDbfs(clean.mix, [drums, bass, pad]);
    const residual = residualDbfs(clean.mix, [late, bass, pad]);
    expect(cleanResidual.dbfs <= -60 && residual.dbfs > -60, `fixture: the clean stems' residual is at or under −60 dBFS (${cleanResidual.dbfs.toFixed(1)}) and the shifted drums' is over it (${residual.dbfs.toFixed(2)})`).toBe(true);
    const evidence = evidenceDir();
    const a = {
      loop: putAsset(evidence, wavF32(clean.mix)), drums: putAsset(evidence, wavF32(drums)), bass: putAsset(evidence, wavF32(bass)),
      pad: putAsset(evidence, wavF32(pad)), late: putAsset(evidence, wavF32(late)),
    };
    const doc = mediaDoc({
      loop: music(a.loop, REGION, { stems: { drums: a.drums, bass: a.bass, pad: a.pad } }),
      late_stem: music(a.loop, REGION, { stems: { drums: a.late, bass: a.bass, pad: a.pad } }),
    });
    const g = gens(deepShow(), evidence, doc, ['loop', 'late_stem'], 'the bed with its stems, and with its drums 1 ms late');
    proof('ac3-gen.json', { residual_dbfs: { clean: cleanResidual.dbfs, late_drums: residual.dbfs }, loop: forProof(g['loop']!), late_stem: forProof(g['late_stem']!) });

    const cleanStems = ofCode(g['loop']!, 'audio.gen.stems');
    expect(cleanStems.map((i) => i.raw), `the clean stems sum to the mix within −60 dBFS: no audio.gen.stems (state ${g['loop']!.state})`).toEqual([]);

    const lateGen = g['late_stem']!;
    const stems = ofCode(lateGen, 'audio.gen.stems');
    expect(lateGen.state, `the result with its drum stem 1 ms late fails: ${show(lateGen.raw)}`).toBe('FAIL');
    const named = stems.filter((i) => JSON.stringify(i.raw).includes('drums'));
    expect(named.length > 0, `audio.gen.stems names the stem \`drums\`: ${show(stems.map((i) => i.raw))}`).toBe(true);
    expect(named.some((i) => namesNumber(i, residual.dbfs, 0.1) || namesRms(i, residual.rms)), `audio.gen.stems naming drums names the residual, ${residual.dbfs.toFixed(2)} dBFS RMS (${residual.rms.toFixed(5)}): ${show(named.map((i) => i.raw))}`).toBe(true);
  }, TIMEOUT);
});

/** The residual named as a linear RMS instead of in dBFS, within 1%. */
const namesRms = (i: Parameters<typeof namesNumber>[0], rms: number): boolean => namesNumber(i, rms, rms / 100);
