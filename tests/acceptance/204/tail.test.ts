// AC12 #204.ba5e9d18: "After a preset's input stops, its output is under −120 dBFS by the tail the preset derives; a
// planted preset that states half its real tail fails, naming the preset and the level at the stated tail"
//
// Through `media_mix` (README: The surface under test). `tails.resonant@1`: white noise, opened by an envelope at the
// voice's start and closed 1 ms after the span ends (sustain 1, release 1 ms), times 0.25, into a bandpass at 1 kHz with
// Q 50, which rings on. Its derived tail (Synth `synth@1`, As built, "Derived tail"): the envelope stops 1 ms after the
// span's end, the gains with it, and the biquad adds its poles' decay to −120 dB, which the cookbook's poles give: r =
// √((1 − α) ÷ (1 + α)), α = sin(w0) ÷ 2Q, w0 = 2π × 1000 ÷ 48,000, so ln(10⁻⁶) ÷ ln r samples, about 0.220 s. The strip
// plays from 0.2 s for 0.5 s; the synth's reported tail (`mix.synths.ring.tail`, flicks) must be that law's within 5%,
// and the master must be under −120 dBFS (|x| < 10⁻⁶) over the 10 ms that end at the span's end plus the tail and for
// 0.3 s after, while it sounds at the span's end. The planted `synth_tail_halved` states half the tail: the level over
// the 10 ms before its stated tail is about 60 dB over −120 dBFS, and the failure names the preset and that level.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, RATE, TIMEOUT, biquad, env, fmt, gain, int, mediaDoc, mixes, noise, pcmOf, peak, presetOf, sampleAt, secs, synthOf, synthStrip, toDb, useShow,
  useTemp, writePack, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Cost: noise 2 + env 2 + gain 1 + gain 1 + biquad 5. */
const RESONANT: Preset = {
  nodes: { hiss: noise('white'), shape: env(0, 0, 0, 1, 0.001), burst: gain(0), trim: gain(0.25), filter: biquad('bandpass', 1000, 50) },
  edges: [['hiss', 'burst', 'in'], ['shape', 'burst', 'gain'], ['burst', 'trim', 'in'], ['trim', 'filter', 'in']],
  out: 'filter',
  params: {},
  cost: 11,
};
const START = secs(0.2);
const SPAN = secs(0.5);
const SPAN_END = START + SPAN;
/** The law's tail, seconds: the release, then the bandpass's poles' decay to −120 dB. */
const LAW = (() => {
  const w0 = (2 * Math.PI * 1000) / RATE;
  const alpha = Math.sin(w0) / (2 * 50);
  const r = Math.sqrt((1 - alpha) / (1 + alpha));
  return 0.001 + Math.log(1e-6) / Math.log(r) / RATE;
})();

function render(planted?: Planted): string[] {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'tails', { resonant: RESONANT });
  const end = SPAN_END + secs(1);
  const [m] = mixes(bin(), evidence, [pack], [{ doc: mediaDoc({ span: end, packs: [pack], strips: { ring: synthStrip(0, { preset: presetOf(pack, 'resonant') }, START, SPAN) } }), segments: [{ from: 0, to: end, write: true }] }], 'the resonant preset over 0.5 s, then its tail', planted);
  const tail = int(synthOf(m!, 'ring', 'the resonant strip')['tail'], 'mix.synths.ring.tail (flicks)');
  const p = pcmOf(evidence, m!.segments[0]!, RATE, 'the master');
  const f: string[] = [];
  const atEnd = peak(p, sampleAt(SPAN_END) - RATE / 100, sampleAt(SPAN_END));
  if (!(toDb(atEnd) > -80)) f.push(`the preset tails.resonant@1 is silent at its span's end (${fmt(toDb(atEnd))} dBFS), so its tail proves nothing`);
  const stated = SPAN_END + tail;
  const level = peak(p, sampleAt(stated) - RATE / 100, sampleAt(stated));
  const after = peak(p, sampleAt(stated), sampleAt(stated + secs(0.3)));
  if (!(level < 1e-6) || !(after < 1e-6)) f.push(`the preset tails.resonant@1: at its stated tail, ${fmt(tail / FLICKS, 4)} s after its input stops, its output reads ${fmt(toDb(level))} dBFS, and ${fmt(toDb(after))} dBFS over the 0.3 s after, not under −120 dBFS`);
  if (Math.abs(tail / FLICKS - LAW) > 0.05 * LAW) f.push(`the preset tails.resonant@1 derives a tail of ${fmt(tail / FLICKS, 4)} s, not its release and its bandpass's decay to −120 dB, ${fmt(LAW, 4)} s, within 5%`);
  return f;
}

describe(`${AC[12]} a preset's output is under −120 dBFS by the tail it derives`, () => {
  it(`${AC[12]} after the resonant preset's input stops, its output is under −120 dBFS by its derived tail; a planted preset that states half its real tail fails, naming the preset and the level at the stated tail`, () => {
    expect(render(), 'the resonant preset rings out within its derived tail').toEqual([]);
    const w = render('synth_tail_halved');
    expect(w.some((x) => /^the preset tails\.resonant@1: at its stated tail, [\d.]+ s after its input stops, its output reads -?[\d.]+ dBFS/.test(x)), `planted synth_tail_halved fails, naming the preset and the level at its stated tail; got ${JSON.stringify(w)}`).toBe(true);
  }, TIMEOUT);
});
