// AC4: "A click's onset lands on the press frame within one frame"
//
// Through `media_mix` (README: The surface under test). A 24 fps document holds one strip, `click`, placed by its onset
// (Strip and track: `align: {onset: strongest, to: <the press>}`) on a press at 2.013 s. Its asset is a recorded-style
// click: a −60 dBFS noise floor, a weak tick at 20 ms (peak 0.15) and the strongest hit at 150 ms (a 0.5 ms attack to
// 0.9, then decaying noise), so its onset must be measured by the onset bake, and "strongest" is not "first". The press
// frame is the first frame that shows the press, ⌈2.013 × 24⌉ = 49, at 49/24 s (sample 98,000). On the rendered samples
// the strongest hit (the first sample louder than 0.45, which neither the floor nor the tick reaches) must lie within
// one frame (2,000 samples) of it. Declared `start` is 0, so a strip not moved by its onset is 1.9 s off; one aligned by
// its first onset (the tick) is 6,240 samples off.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, asset, atSample, level, mix, noise, pcmOf, secs, useEvidence, useShow, type MediaDoc } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const FRAME = 705_600_000 / 24; // 29,400,000 flicks
const PRESS = 1_420_372_800; // 2.013 s

describe('AC4 a click\'s measured onset lands on the press frame', () => {
  it(`${AC[4]} a click strip aligned by its strongest onset to a press at 2.013 s sounds its hit within one frame of the press frame, 49/24 s, by the samples`, () => {
    const pressFrame = Math.ceil(PRESS / FRAME) * FRAME;
    expect([PRESS, pressFrame / (705_600_000 / RATE)], 'the press is 2.013 s and its frame starts at sample 98,000').toEqual([secs(2.013), 98_000]);

    const evidence = evidenceDir();
    const len = Math.round(0.4 * RATE);
    const x = noise(len, 0.001, 500_004);
    const n = noise(len, 1, 500_044);
    for (let i = 0; i < 480; i++) x[960 + i]! += 0.15 * Math.exp(-i / 48) * (i % 2 === 0 ? 1 : -1);
    for (let i = 0; i < len - 7200; i++) x[7200 + i] = i < 24 ? (0.9 * (i + 1)) / 24 : 0.9 * Math.exp(-(i - 24) / 1440) * n[i]!;
    const doc: MediaDoc = {
      transport: { sample_rate: RATE, frame_rate: [24, 1], span: secs(4) },
      strips: { click: { track: 0, asset: asset(evidence, x), start: 0, in: 0, out: atSample(len), align: { onset: 'strongest', to: PRESS } } },
    };
    const [m] = mix(show(), evidence, [{ doc, segments: [{ from: 0, to: doc.transport.span, write: true }] }], 'a click aligned by its onset to a press');
    const p = pcmOf(evidence, m!.segments[0]!, 'the aligned click');
    let hit = -1;
    for (let k = 0; k < p.frames; k++) if (level(p, k) > 0.45) { hit = k; break; }
    const at = pressFrame / (705_600_000 / RATE);
    expect(hit >= 0, 'the click\'s hit sounds (some sample louder than 0.45)').toBe(true);
    expect(Math.abs(hit - at) <= RATE / 24, `the click's hit sounds at sample ${hit} (${(hit / RATE).toFixed(6)} s), ${hit - at} samples from the press frame's sample ${at}: within one frame (2,000 samples)`).toBe(true);
  }, TIMEOUT);
});
