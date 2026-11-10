// AC2: "The compressor's static curve at the Processor row's defaults matches the law this task writes into the row
// within 0.1 dB at 10 input levels from −60 to 0 dBFS; a planted compressor with a hard knee differs at the knee's
// middle and fails, naming the level"
//
// Through `media_mix` (README: The surface under test). The law is the Processor row's at a098f9f9: the static curve
// takes the level L (dBFS, a full-scale sine reads 0) to L below T − W/2, to L + (1/R − 1)(L − T + W/2)²/(2W) within
// W/2 of T, and to T + (L − T)/R above T + W/2; at the defaults (threshold −24, knee 30, ratio 12, makeup 0) the knee
// runs from −39 to −9 dBFS and its middle is −24. Each level is its own mix: a full-scale 1 kHz float sine as a strip
// whose gain is the level, into a bus whose one processor is a compressor with no fields set (the row's defaults), out
// to the master. The output's level is the sine's amplitude from its mean power over 0.3 to 0.5 s, long after the
// 3 ms attack has settled. The levels are −60, −52, −44 (under the knee), −36, −30, −24, −18, −12 (in it, −24 its
// middle) and −6, 0 (over it). The planted `compressor_hard_knee` reads −24 at −24 against the law's −27.4375.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, fmt, mixes, pcm, putSignal, secs, sine, sineLevel, useEvidence, useShow, type MixAsk, type Planted } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const LEVELS = [-60, -52, -44, -36, -30, -24, -18, -12, -6, 0];
const MIDDLE = -24;

/** The written law at the row's defaults: threshold T, knee W, ratio R. */
function law(L: number, T = -24, W = 30, R = 12): number {
  if (L < T - W / 2) return L;
  if (L <= T + W / 2) return L + ((1 / R - 1) * (L - T + W / 2) ** 2) / (2 * W);
  return T + (L - T) / R;
}

/** The output level at each input level, and each level whose output is off the law by more than 0.1 dB. */
function curve(planted?: Planted): { off: Map<number, number>; f: string[] } {
  const evidence = evidenceDir();
  const tone = sine(1000, (6 * RATE) / 10, 1);
  const asset = putSignal(evidence, [tone, tone]);
  const asks: MixAsk[] = LEVELS.map((level) => ({
    doc: {
      strips: { tone: { track: 0, asset, gain: level, bus: 'dyn' } },
      buses: { dyn: { processors: ['comp'], out: 'master' } },
      processors: { comp: { kind: 'compressor' } },
    },
    segments: [{ from: 0, to: secs(0.6), write: true }],
  }));
  const ms = mixes(show(), evidence, asks, 'a 1 kHz sine at each level through the compressor at its defaults', planted);
  const off = new Map<number, number>();
  const f: string[] = [];
  LEVELS.forEach((level, i) => {
    const out = sineLevel(pcm(evidence, ms[i]!.segments[0]!, `the compressor's output at ${level} dBFS`), (3 * RATE) / 10, RATE / 2);
    const want = law(level);
    off.set(level, out - want);
    if (!(Math.abs(out - want) <= 0.1)) f.push(`input level ${level} dBFS: the compressor's output reads ${fmt(out)} dBFS, not the law's ${want.toFixed(4)} ±0.1 (off by ${fmt(out - want)} dB)`);
  });
  return { off, f };
}

describe('AC2 the compressor\'s static curve is the law written into the Processor row', () => {
  it(`${AC[2]} at the row's defaults, a 1 kHz sine at −60, −52, −44, −36, −30, −24, −18, −12, −6 and 0 dBFS comes out of the compressor within 0.1 dB of the written law; a planted compressor with a hard knee differs most at the knee's middle and fails, naming the level −24 dBFS`, () => {
    const clean = curve();
    expect(clean.f, 'the compressor\'s static curve matches the written law within 0.1 dB at every level').toEqual([]);

    // Wrong program: a compressor with a hard knee.
    const w = curve('compressor_hard_knee');
    const worst = [...w.off.entries()].reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[0];
    expect(w.f.some((l) => l.startsWith(`input level ${MIDDLE} dBFS:`)) && worst === MIDDLE, `planted compressor_hard_knee differs most at the knee's middle and fails, naming the level ${MIDDLE} dBFS; differs most at ${worst} dBFS, failures ${JSON.stringify(w.f)}`).toBe(true);
  }, TIMEOUT);
});
