// AC2 #501.c0a30641: "At every valid pair of frame rate and sample rate, checked by an analytic parity fixture, frame
// k's audio span starts at ⌊k·Δ × sr ÷ 705,600,000⌋ exactly; at 30000/1001 fps and 48 kHz frame 30,000 starts at
// sample 48,048,000; a planted span that rounds each frame's count to 1,602 tiles with no gap and fails here, naming
// the frame and the 12,000-sample drift"
// AC8 #501.c24595f7: "At 30000/1001 fps and 44.1 kHz, frame 1's audio is samples [1471, 2942), frame 2's [2942, 4414)
// and frame 1,000's starts at 1,471,470; a planted span that rounds starts frame 2 at 2943 and fails, naming it"
//
// Through `deep-show run`: the film is presented, then `export`'s plan form (#488's rates-only call, which takes
// `frame_rate` and `audio.sample_rate`) is asked for frames by index and answers each frame's audio samples [first,
// end) on the export's clock (README: `export`, the plan form). The parity fixture is the formula in integers here:
// every valid frame rate (40) against every common sample rate (13), at fixed and seeded frames, each span's start
// checked against ⌊k·Δ × sr ÷ 705,600,000⌋ and its end against the next frame's start, so the spans tile. The planted
// spans: `--planted span_rounds_each_frame` (each frame's own count rounded, the next span starting where it ended)
// and `--planted span_rounds_start` (each start rounded to the nearest sample, not floored).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FRAME_RATES, FULL, SAMPLE_RATES, TIMEOUT, exportCall, failsNaming, film, frameLength, n, none, plannedFrames, present,
  presented, putEvidence, runShow, scenario, seeded, spanStart, toneWav, useShow, useTemp, type JsonObject, type Rate,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const NTSC: Rate = [30000, 1001];
const FIXED = [0, 1, 2, 3, 999, 1000, 1001, 29_999, 30_000, 30_001];
const random = seeded(501_002);
const SEEDED = Array.from({ length: 20 }, () => Math.floor(random() * 10_000_000));
const FRAMES = [...new Set([...FIXED, ...SEEDED])].sort((a, b) => a - b);

/** Each pair's plan for `frames`, in one scenario, through the given build and plant. */
function plans(pairs: { rate: Rate; sr: number }[], frames: number[], planted?: string): Map<string, ReturnType<typeof plannedFrames>> {
  const evidence = temp();
  const doc = film(putEvidence(evidence, toneWav()));
  const calls: JsonObject[] = [present(DOC.a, doc), ...pairs.map((p) => exportCall({ doc: DOC.a, frame_rate: p.rate, audio: { sample_rate: p.sr }, frames }))];
  const replies = runShow(shows.bin(FULL), scenario(evidence, calls), `the plans at ${pairs.length} pairs of rates`, planted);
  presented(replies[0]!, 'the film');
  return new Map(pairs.map((p, i) => [`${p.rate.join('/')}@${p.sr}`, plannedFrames(replies[i + 1]!, frames, `the plan at ${p.rate.join('/')} fps and ${p.sr} Hz`)]));
}

/** The parity check: each frame's span is [start(k), start(k + 1)) by the formula. A start off by any amount fails,
 * naming the frame, its start, the formula's start and the drift between them. */
function parity(rate: Rate, sr: number, got: ReturnType<typeof plannedFrames>): string[] {
  const at = `${rate.join('/')} fps, ${n(sr)} Hz`;
  const failures: string[] = [];
  for (const f of got) {
    const want = spanStart(f.frame, rate, sr); const end = spanStart(f.frame + 1, rate, sr);
    if (f.samples[0] !== want) failures.push(`${at}: frame ${n(f.frame)} starts at sample ${n(f.samples[0])}, not ${n(want)}: ${n(Math.abs(f.samples[0] - want))}-sample drift`);
    else if (f.samples[1] !== end) failures.push(`${at}: frame ${n(f.frame)}'s span is [${n(f.samples[0])}, ${n(f.samples[1])}), not [${n(want)}, ${n(end)}): the next frame's start`);
  }
  return failures;
}

describe(`${AC[2]} every frame's audio span starts at the floor of its time in samples, at every valid pair of rates`, () => {
  it(`${AC[2]} at all 40 × 13 valid pairs, frame k's span is [⌊k·Δ × sr ÷ 705,600,000⌋, the next frame's start), and at 30000/1001 fps and 48 kHz frame 30,000 starts at 48,048,000`, () => {
    for (const r of FRAME_RATES) expect(frameLength(r), `${r.join('/')} fps is a whole number of flicks a frame (the valid-rates rule)`).not.toBeNull();
    for (const sr of SAMPLE_RATES) expect(705_600_000 % sr, `${sr} Hz is a whole number of flicks a sample`).toBe(0);
    expect(spanStart(30_000, NTSC, 48_000), 'the formula itself gives 48,048,000').toBe(48_048_000);
    const pairs = FRAME_RATES.flatMap((rate) => SAMPLE_RATES.map((sr) => ({ rate, sr })));
    const got = plans(pairs, FRAMES);
    none(pairs.flatMap((p) => parity(p.rate, p.sr, got.get(`${p.rate.join('/')}@${p.sr}`)!)), 'the spans at every valid pair');
    const ntsc = got.get('30000/1001@48000')!.find((f) => f.frame === 30_000)!;
    expect(ntsc.samples[0], 'at 30000/1001 fps and 48 kHz frame 30,000 starts at sample 48,048,000').toBe(48_048_000);
  }, TIMEOUT);

  it(`${AC[2]} a planted span that rounds each frame's count to 1,602 tiles with no gap and fails the parity check, naming frame 30,000 and the 12,000-sample drift`, () => {
    const got = plans([{ rate: NTSC, sr: 48_000 }], FIXED, 'span_rounds_each_frame').get('30000/1001@48000')!;
    const gaps = got.filter((f, i) => i + 1 < got.length && got[i + 1]!.frame === f.frame + 1 && f.samples[1] !== got[i + 1]!.samples[0]);
    expect(gaps.map((f) => f.frame), 'the planted spans tile with no gap: each ends where the next starts').toEqual([]);
    failsNaming(parity(NTSC, 48_000, got), /frame 30,000 starts at sample 48,060,000, not 48,048,000: 12,000-sample drift/, 'the planted span (span_rounds_each_frame)');
  }, TIMEOUT);
});

describe(`${AC[8]} at 30000/1001 fps and 44.1 kHz the spans are the floors of 1,471.47 samples a frame`, () => {
  it(`${AC[8]} frame 1's audio is [1471, 2942), frame 2's [2942, 4414) and frame 1,000's starts at 1,471,470`, () => {
    const got = plans([{ rate: NTSC, sr: 44_100 }], [1, 2, 1000]).get('30000/1001@44100')!;
    expect(got.map((f) => f.samples), 'frames 1 and 2').toEqual([[1471, 2942], [2942, 4414], [1_471_470, spanStart(1001, NTSC, 44_100)]]);
    none(parity(NTSC, 44_100, got), 'the spans at 30000/1001 fps and 44.1 kHz');
  }, TIMEOUT);

  it(`${AC[8]} a planted span that rounds its start puts frame 2 at 2943 and fails, naming frame 2`, () => {
    const got = plans([{ rate: NTSC, sr: 44_100 }], [1, 2, 1000], 'span_rounds_start').get('30000/1001@44100')!;
    expect(got.find((f) => f.frame === 2)?.samples[0], 'the planted span starts frame 2 at 2943').toBe(2943);
    failsNaming(parity(NTSC, 44_100, got), /frame 2 starts at sample 2,943, not 2,942/, 'the planted span (span_rounds_start)');
  }, TIMEOUT);
});
