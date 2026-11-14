// AC1 #204.47d50ee6: "A fixture whose engine preset maps a car's speed channel, rising from 0 to 30 m/s over 4 s, to a
// sine oscillator at 60 Hz plus 4 Hz per m/s matches, from 0 to 4 s, a reference sweep computed in f64 from the
// integral of that frequency, within −80 dB; a planted synth that holds params for a whole frame instead of a block
// differs by more than −60 dB and fails, naming the first block"
//
// Through `media_mix` (README: The surface under test). The engine fixture (README: Fixtures) is a film whose synth
// strip `engine` plays `engines.engine@1`, a sine at the param `hz` at half scale, with `hz: "60 + 4 * speed"` over the
// speed channel, 0 to 30 m/s linearly over [0, 4 s). So f(t) = 60 + 30t Hz there, and the reference is
// sin 2π(60t + 15t²), the integral of f, in f64. The master's 0 to 4 s is written as a float WAV; each channel is fitted
// to the reference with one gain (the strip's pan law is the mix's, not this criterion's) and the residual's energy
// against the fitted reference's must be at most −80 dB. The planted `synth_holds_params_per_frame` reads a param once
// per 60 Hz frame (800 samples) and holds it: its residual must pass −60 dB, and its failure names the first 128-sample
// block whose own residual passes −80 dB, which lies in the first frame.
import { describe, expect, it } from 'vitest';
import { AC, BLOCK, ENGINE, RATE, TIMEOUT, engineFilm, fit, fmt, mixes, pcmOf, secs, useShow, useTemp, writePack, type Pcm, type Planted } from './helpers.ts';

const bin = useShow();
const temp = useTemp();

const SPAN = 4 * RATE; // 192,000 samples: 1,500 blocks
const FRAME = RATE / 60; // 800 samples

/** The reference sweep in f64: the phase is ∫ (60 + 30τ) dτ = 60t + 15t² cycles. */
function reference(): Float64Array {
  const r = new Float64Array(SPAN);
  for (let n = 0; n < SPAN; n++) {
    const t = n / RATE;
    const phase = 60 * t + 15 * t * t;
    r[n] = Math.sin(2 * Math.PI * (phase - Math.floor(phase)));
  }
  return r;
}
const REF = reference();

function render(planted?: Planted): Pcm {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'engines', { engine: ENGINE });
  const [m] = mixes(bin(), evidence, [pack], [{ doc: engineFilm(pack), segments: [{ from: 0, to: secs(4), write: true }] }], 'the engine fixture from 0 to 4 s', planted);
  return pcmOf(evidence, m!.segments[0]!, RATE, `the engine fixture's 0 to 4 s${planted ? ` (planted ${planted})` : ''}`);
}

interface Judged { gains: number[]; db: number; firstBlock: number | null }
/** Each channel's fitted gain and residual (the worst channel's), and the first block whose residual passes −80 dB. */
function judge(p: Pcm): Judged {
  const fits = p.channels.map((c) => fit(c, REF, 0, SPAN));
  let firstBlock: number | null = null;
  for (let b = 0; b < SPAN / BLOCK && firstBlock === null; b++) {
    let e = 0, s = 0;
    p.channels.forEach((c, k) => {
      const g = fits[k]!.gain;
      for (let n = b * BLOCK; n < (b + 1) * BLOCK; n++) { const d = c[n]! - g * REF[n]!; e += d * d; s += (g * REF[n]!) ** 2; }
    });
    if (!(s > 0) || 10 * Math.log10(e / s) > -80) firstBlock = b;
  }
  return { gains: fits.map((f) => f.gain), db: Math.max(...fits.map((f) => f.db)), firstBlock };
}

describe(`${AC[1]} the engine's sweep follows the speed channel within −80 dB of its f64 reference`, () => {
  it(`${AC[1]} the engine fixture's 0 to 4 s, a sine at 60 Hz + 4 Hz per m/s of a speed rising 0 to 30 m/s, matches sin 2π(60t + 15t²) within −80 dB; a planted synth that holds params for a frame differs by more than −60 dB and fails, naming the first block`, () => {
    const clean = judge(render());
    const f: string[] = [];
    clean.gains.forEach((g, c) => { if (!(Math.abs(g) > 0.1)) f.push(`channel ${c} carries the engine at a gain of ${fmt(g, 4)} against the reference, so a match would prove nothing`); });
    if (!(clean.db <= -80)) f.push(`the engine's 0 to 4 s differs from the f64 reference sweep by ${fmt(clean.db)} dB, over −80 dB${clean.firstBlock !== null ? `; the first block over −80 dB is block ${clean.firstBlock} (samples ${clean.firstBlock * BLOCK} to ${clean.firstBlock * BLOCK + BLOCK - 1})` : ''}`);
    expect(f, 'the engine fixture matches its f64 reference sweep within −80 dB').toEqual([]);

    // Wrong program: params held for a whole 60 Hz frame (800 samples) instead of a 128-sample block.
    const w = judge(render('synth_holds_params_per_frame'));
    expect(w.db > -60, `planted synth_holds_params_per_frame differs from the reference by more than −60 dB; got ${fmt(w.db)} dB`).toBe(true);
    expect(w.firstBlock, `planted synth_holds_params_per_frame fails naming the first block whose residual passes −80 dB, which lies in the first frame (blocks 0 to ${Math.floor((FRAME - 1) / BLOCK)}); got ${w.firstBlock === null ? 'no block' : `block ${w.firstBlock}`}`).not.toBeNull();
    expect(w.firstBlock! * BLOCK < FRAME, `planted synth_holds_params_per_frame: the first block named, block ${w.firstBlock}, starts inside the first frame`).toBe(true);
  }, TIMEOUT);
});
