// AC1 #204.47d50ee6, Oracle lane: "A fixture whose engine preset maps a car's speed channel … to a sine oscillator …
// matches … a reference sweep computed in f64 …"
//
// Ported from the upstream test the Oracle page pins for criterion 1, `the-oscillatornode-interface/osc-basic-waveform.html`
// at commit 2f57f45d21482f94b36123dfcec77ae7ab859bc1 (vendored under doneright/oracles/vendor/ on branch `doneright`).
// License of the upstream test: the 3-Clause BSD License, copyright its project's contributors; redistribution and use
// in source and binary forms, with or without modification, are permitted under that license's three conditions. No
// upstream code is copied: its setup and assertions are re-expressed against our output, keeping upstream's numbers.
//
// Upstream renders, at 44.1 kHz, two render quanta (256 frames) of a sine oscillator started at 0 at 100, −100, 2 and
// 1 Hz, and holds each to the mathematical sine b1 · sin(ωk), ω = 2π f ÷ rate: every sample within an absolute
// threshold (2e-5 at ±100 Hz, 2e-7 at 2 and 1 Hz) and an SNR of at least 110 dB (118 dB at 2 Hz). Ours: the synth's
// `osc` node (sine), in `tones.tone@1` (the sine at the param `hz`, times 0.5), on one strip from 0 with `hz` set to
// each frequency, in a 44.1 kHz media document; `media_mix` writes the master's first 256 samples. The master carries
// the sine at 0.5 times the mix's pan law (1, or √½ for a mono voice on the stereo master): each channel's gain is
// fitted and must be one of those within 1e-4, which pins the oscillator's amplitude at 1, and the samples divided by it
// are held to upstream's thresholds and SNR. Upstream's custom PeriodicWave cases (its tests 4 and 5) have no node in
// our closed list and aren't ported.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, QUANTUM, TIMEOUT, UPSTREAM, UPSTREAM_RATE, gain, mediaDoc, mixes, osc, pcmOf, presetOf, secs, synthStrip, useShow, useTemp, writePack,
  type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

const FRAMES = 2 * QUANTUM;
/** Upstream's four sine cases: label, frequency, absolute threshold, SNR threshold (dB). */
const CASES = [
  { label: 'Test 0', hz: 100, threshold: 2.0e-5, snr: 110.0 },
  { label: 'Test 1', hz: -100, threshold: 2.0e-5, snr: 110.0 },
  { label: 'Test 2', hz: 2, threshold: 2.0e-7, snr: 118.0 },
  { label: 'Test 3', hz: 1, threshold: 2.0e-7, snr: 110.0 },
] as const;
/** A sine at `hz` times 0.5; cost: osc 4 + gain 1. */
const TONE: Preset = {
  nodes: { tone: osc('sine', 'hz'), level: gain(0.5) },
  edges: [['tone', 'level', 'in']],
  out: 'level',
  params: { hz: { unit: 'Hz', range: [-100, 100], default: 100 } },
  cost: 5,
};

describe(`${AC[1]} (Oracle: ${UPSTREAM.commit.slice(0, 10)} ${UPSTREAM.oscillator}) the synth's sine oscillator is the mathematical sine`, () => {
  it(`${AC[1]} basic sine waveform, ported: the osc node's sine at 100, −100, 2 and 1 Hz over 256 samples at 44.1 kHz is b1 · sin(2πfk ÷ rate) within upstream's thresholds and SNR`, () => {
    const root = temp();
    const evidence = temp();
    const pack = writePack(root, 'tones', { tone: TONE });
    const to = (FRAMES * FLICKS) / UPSTREAM_RATE;
    const asks = CASES.map((c) => ({
      rate: UPSTREAM_RATE,
      doc: mediaDoc({ rate: UPSTREAM_RATE, span: secs(0.2), packs: [pack], strips: { tone: synthStrip(0, { preset: presetOf(pack, 'tone'), params: { hz: String(c.hz) } }, 0, secs(0.1)) } }),
      segments: [{ from: 0, to, write: true }],
    }));
    const ms = mixes(bin(), evidence, [pack], asks, 'the sine oscillator at four frequencies, 44.1 kHz');
    const f: string[] = [];
    CASES.forEach((c, i) => {
      const p = pcmOf(evidence, ms[i]!.segments[0]!, UPSTREAM_RATE, `${c.label}: the first 256 samples`);
      const omega = (2 * Math.PI * c.hz) / UPSTREAM_RATE;
      const expected = Float64Array.from({ length: FRAMES }, (_, k) => Math.sin(omega * k));
      p.channels.forEach((y, ch) => {
        let yr = 0, rr = 0;
        for (let k = 0; k < FRAMES; k++) { yr += y[k]! * expected[k]!; rr += expected[k]! ** 2; }
        const fitted = yr / rr;
        const scale = [0.5, 0.5 * Math.SQRT1_2].find((s) => Math.abs(fitted - s) <= 1e-4 * s);
        if (scale === undefined) { f.push(`${c.label} (Sine: ${c.hz} Hz), channel ${ch}: the sine sounds at ${fitted} of full scale, neither 0.5 nor 0.5 × √½, so its amplitude isn't 1`); return; }
        let worst = 0, signal = 0, noise = 0;
        for (let k = 0; k < FRAMES; k++) {
          const d = y[k]! / scale - expected[k]!;
          worst = Math.max(worst, Math.abs(d));
          signal += expected[k]! ** 2;
          noise += d * d;
        }
        const snr = noise === 0 ? Infinity : 10 * Math.log10(signal / noise);
        if (!(worst <= c.threshold)) f.push(`${c.label} (Sine: ${c.hz} Hz), channel ${ch}: a sample differs from the mathematical sine by ${worst.toExponential(3)}, over upstream's ${c.threshold}`);
        if (!(snr >= c.snr)) f.push(`${c.label} (Sine: ${c.hz} Hz), channel ${ch}: SNR ${snr.toFixed(2)} dB, under upstream's ${c.snr} dB`);
      });
    });
    expect(f, 'each sine case meets upstream\'s thresholds').toEqual([]);
  }, TIMEOUT);
});
