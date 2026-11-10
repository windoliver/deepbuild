// AC1: "A sine at a quarter of the sample rate and 45° of phase, driven 6 dB over full scale into the master, reads a
// true peak of at most −1.0 dBTP at 4× oversampling on the master's output; a planted limiter that holds sample peaks
// only reads above −1 dBTP true peak and fails, naming the bus"
//
// Through `media_mix` and #500's `media_bake` (README: The surface under test). A full-scale 12 kHz tone with 45° of
// phase (EBU Tech 3341 signal 16's construction: samples at ±√2/2, so its sample peak sits 3 dB under its true peak of
// 0 dBTP) is a strip on the master with a gain of +6 dB, starting at 0.1 s and stopping at 1.1 s. The master's output
// over 0 to 1.5 s is written as a float WAV and baked as loudness at `tp_oversample: 4`; its `true_peak` must read at
// most −1.0 dBTP, and, so silence can't pass, above −2 dBTP: the limiter holds the tone at its ceiling. The planted
// `limiter_holds_sample_peaks` holds the samples at the ceiling, so the true peak between them reads about 3 dB over it.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, fmt, mixes, putSignal, secs, sine, truePeak, useEvidence, useShow, type MediaDoc, type Planted } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const CEILING = -1.0;

/** The master's true peak at 4× and what is wrong with it, each line naming the bus. */
function master(planted?: Planted): { peak: number; f: string[] } {
  const evidence = evidenceDir();
  const tone = sine(RATE / 4, RATE, 1, Math.PI / 4);
  const asset = putSignal(evidence, [tone, tone]);
  const doc: MediaDoc = { strips: { tone: { track: 0, asset, start: secs(0.1), gain: 6, bus: 'master' } }, buses: {} };
  const [m] = mixes(show(), evidence, [{ doc, segments: [{ from: 0, to: secs(1.5), write: true }] }], 'a full-scale fs/4 tone at 45°, +6 dB into the master', planted);
  const peak = truePeak(show(), evidence, m!.segments[0]!.wav!, 4, `the master's output${planted ? ` (planted ${planted})` : ''}, baked at 4×`);
  const f = peak > CEILING ? [`bus \`master\`: its output reads a true peak of ${fmt(peak)} dBTP at 4× oversampling, above ${CEILING.toFixed(1)} dBTP`] : [];
  return { peak, f };
}

describe('AC1 the master ends in a true-peak limiter', () => {
  it(`${AC[1]} a full-scale tone at a quarter of the sample rate and 45° of phase, driven +6 dB into the master, reads a true peak of at most −1.0 dBTP at 4× on the master's output; a planted limiter that holds sample peaks only reads above −1 dBTP and fails, naming the bus \`master\``, () => {
    const clean = master();
    expect(clean.peak > -2, `the master's output still carries the tone near its ceiling (true peak ${fmt(clean.peak)} dBTP at 4×, not under −2): the limiter limits, it doesn't mute`).toBe(true);
    expect(clean.f, 'the master\'s output reads at most −1.0 dBTP true peak at 4×').toEqual([]);

    // Wrong program: a limiter that holds sample peaks only.
    const w = master('limiter_holds_sample_peaks');
    expect(w.f.some((l) => l.startsWith('bus `master`:')) && w.peak > CEILING, `planted limiter_holds_sample_peaks reads above −1 dBTP true peak and fails, naming the bus \`master\`; got ${fmt(w.peak)} dBTP, ${JSON.stringify(w.f)}`).toBe(true);
  }, TIMEOUT);
});
