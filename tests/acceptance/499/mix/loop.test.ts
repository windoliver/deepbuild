// AC4: "A looping strip with a 20 s span over a 6 s loop region repeats the region until 20 s and, with no fade
// declared, ends on a 5 ms equal-power fade whose 240 samples at 48 kHz follow the curve within 1e-6; a strip whose span
// ends mid-sine does the same, and one that ends at its source's own end adds no fade"
//
// Through `media_mix` (README: The surface under test), one strip per document on the master, no fade declared. Each
// render is judged sample by sample against the asset's own samples (as the decode worker reads its 16-bit PCM), times
// one constant per channel fitted on an early stretch of the same render (so the pan and up-mix law of a mono asset on
// the stereo master is the implementer's), times the fade's gain, each within 1e-6; after the span every sample is
// within 1e-6 of 0. The three strips are each other's controls: one program can't pass both a fade where the span cuts
// the source and none where the source ends. The oracle (WPT's audiobuffersource-duration-loop.html, not copied) holds
// the same rule for a looped source given a duration: the loop plays until the duration ends, and silence follows.
import { describe, expect, it } from 'vitest';
import { RATE, SEC, asset, atSample, fadeOut, mix, pcmOf, sOf, secs, tone, useEvidence, useShow, type Pcm } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const FADE = 240; // 5 ms at 48 kHz
const TOL = 1e-6;

/** What is wrong with a strip's render: before its end it is the source (repeating every `period` samples when it
 * loops) times a constant per channel, the last 240 samples times the equal-power fade when `fade`, and after its end
 * silence. The first wrong sample of each stretch is named. */
function endProblems(p: Pcm, src: Float32Array, period: number | null, end: number, fade: boolean, name: string): string[] {
  const f: string[] = [];
  const s = (n: number): number => src[period === null ? n : n % period] ?? 0;
  const fitFrom = RATE / 2;
  const fitTo = fitFrom + 4800;
  for (let c = 0; c < p.channels.length; c++) {
    const out = p.channels[c]!;
    let num = 0;
    let den = 0;
    for (let n = fitFrom; n < fitTo; n++) { num += out[n - p.first]! * s(n); den += s(n) * s(n); }
    const k = num / den;
    if (!(Math.abs(k) > 0.1)) { f.push(`${name}: channel ${c} doesn't carry the source (gain ${k} over 0.5–0.6 s)`); continue; }
    const stretches: [number, number, (n: number) => number, string][] = [
      [0, end - FADE, () => 1, period === null ? 'before its last 5 ms, the source' : 'before its last 5 ms, the 6 s loop region repeated'],
      [end - FADE, end, fade ? (n) => fadeOut(n, end, FADE) : () => 1, fade ? 'its last 240 samples, the source on the equal-power fade' : 'its last 240 samples, the source with no fade'],
      [end, p.first + p.frames, () => 0, 'after its span, silence'],
    ];
    for (const [a, b, g, what] of stretches) {
      for (let n = a; n < b; n++) {
        const want = k * s(n) * g(n);
        const got = out[n - p.first]!;
        if (Math.abs(got - want) > TOL) {
          f.push(`${name}: channel ${c} at ${sOf(n)} is ${got}, not ${want} (${what}, within 1e-6; off by ${Math.abs(got - want).toExponential(2)})`);
          break;
        }
      }
    }
  }
  return f;
}

describe('AC4 a strip that stops inside its source ends on a 5 ms equal-power fade; one that ends with its source adds none', () => {
  it('AC4 a looping strip with a 20 s span over a 6 s source repeats it until 20 s and ends on 240 samples of equal-power fade within 1e-6; a strip whose span ends mid-sine at 2.5 s plus 27 samples does the same; a strip that ends at its source\'s own end, mid-sine, adds no fade', () => {
    const evidence = evidenceDir();
    const loopLen = 6 * RATE; // 6 s of 440 Hz: 2,640 whole cycles, so the loop region joins without a seam
    const midEnd = 120_027; // 2,500.5625 ms: 1,100.2475 cycles of 440 Hz, near a crest
    const loopSrc = asset(evidence, [tone(440, loopLen, 0.25)]);
    const cutSrc = asset(evidence, [tone(440, 4 * RATE, 0.25)]);
    const wholeSrc = asset(evidence, [tone(440, midEnd, 0.25)]);
    const cases = [
      {
        name: 'the looping strip `bed`', strip: 'bed', src: loopSrc.samples[0]!, period: loopLen, end: 20 * RATE, fade: true, span: secs(21),
        doc: { track: 0, asset: loopSrc.sha, start: 0, in: 0, out: secs(6), loop: true, span: secs(20) },
      },
      {
        name: 'the strip `cut`, its span ending mid-sine', strip: 'cut', src: cutSrc.samples[0]!, period: null, end: midEnd, fade: true, span: secs(3),
        doc: { track: 0, asset: cutSrc.sha, start: 0, in: 0, out: secs(4), span: atSample(midEnd) },
      },
      {
        name: 'the strip `whole`, ending at its source\'s own end', strip: 'whole', src: wholeSrc.samples[0]!, period: null, end: midEnd, fade: false, span: secs(3),
        doc: { track: 0, asset: wholeSrc.sha, start: 0, in: 0, out: atSample(midEnd) },
      },
    ];
    const f: string[] = [];
    for (const c of cases) {
      const m = mix(show(), evidence, { transport: { sample_rate: RATE, span: c.span }, strips: { [c.strip]: c.doc } }, [{ from: 0, to: c.span, write: true }], c.name);
      const p = pcmOf(evidence, m.segments[0]!, c.name);
      expect(p.frames, `${c.name}: the render covers ${c.span / SEC} s`).toBe(c.span / (SEC / RATE));
      f.push(...endProblems(p, c.src, c.period, c.end, c.fade, c.name));
    }
    expect(f, 'each strip repeats or plays its source to its span\'s end, fading over 5 ms only where the span cuts the source').toEqual([]);
  }, 1_800_000);
});
