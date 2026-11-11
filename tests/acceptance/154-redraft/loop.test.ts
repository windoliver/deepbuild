// AC7 #154.54798db1: "A score with loop {from: "5:1", to: "9:1"} gives stems whose loop points sit on those bar lines
// exactly, and three passes of the region by a looping strip match a straight render of those bars' events played three
// times in a row within −96 dBFS per sample from the second pass on, while on a fixture whose last note rings past the
// region's end the same stem looped without the fold differs there by more than −40 dBFS"
//
// One sampled instrument (a 4 s decaying tone, root A3) on one stem, at 120 BPM in 4/4, so 5:1 is 8 s (sample 384,000)
// and 9:1 is 16 s (sample 768,000). A short intro note in bar 1; the region's five notes in bars 5 to 8, the last two
// releasing over 1.5 s, so they ring past 9:1. The looped score declares loop {from: "5:1", to: "9:1"}; the straight
// score is the same score with no loop (the same item, events and seed). Both are rendered by deep_job and played by
// `media_mix` as the export plays them: the looped stem by one strip with `loop: true` for four passes, the straight
// stem once. "A straight render of those bars' events played three times in a row" is built here from the straight
// stem's mix: its region from 5:1 on, tails and all, added at 5:1, one region later and two regions later. From the
// second pass on, the looping strip must match it within −96 dBFS per sample. The planted program, "the same stem
// looped without the fold", is the straight stem's region repeated with nothing carried over; it must differ there by
// more than −40 dBFS, which shows the fixture's tails reach past the region's end.
import { describe, expect, it } from 'vitest';
import { AC, beatFlicks, firstSound, library, metaNotes, mix, once, plan, readMeta, readStem, render, sampled, SAMPLE, scoreDoc, scoreWorld, show, TIMEOUT, tone, useShow, type Event } from './helpers.ts';

const bin = useShow();
const TEMPO = [{ at: '0s', bpm: 120, span: 64 }];
const BED = library('testlib/bed', 'bed', 57, [tone(220, 4, [{ ratio: 1, amp: 1 }, { ratio: 2, amp: 0.5 }, { ratio: 3, amp: 0.25 }], { decay: 1.5 })]);
const T5 = beatFlicks(TEMPO, 16) / SAMPLE;
const T9 = beatFlicks(TEMPO, 32) / SAMPLE;
const L = T9 - T5;
const note = (at: string, pitch: number, release: number): Event => ({ at, inst: 'bed', pitch, dur: 2, vel: 0.8, attack: 0.005, release });
const EVENTS: Record<string, Event> = {
  intro: note('1:1', 57, 0.5),
  e1: note('5:1', 57, 0.5),
  e2: note('6:1', 60, 0.5),
  e3: note('7:1', 55, 0.5),
  e4: note('8:1', 57, 1.5),
  e5: note('8:3', 59, 1.5),
};
const doc = (loop: boolean) => scoreDoc({
  id: 'bed', instruments: { bed: sampled(BED, 'bed') }, events: EVENTS, tempo: TEMPO, span: '40s', packs: [BED],
  ...(loop ? { loop: { from: '5:1', to: '9:1' } } : {}),
});
const world = once(() => scoreWorld([BED]));
const dbfs = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
/** The largest per-sample difference of two stereo signals over [from, to), with where it is. */
function maxDiff(a: Float32Array[], b: (c: number, n: number) => number, from: number, to: number): { value: number; at: number } {
  let value = 0;
  let at = -1;
  for (let c = 0; c < 2; c++) for (let n = from; n < to; n++) { const d = Math.abs((a[c]![n] ?? 0) - b(c, n)); if (d > value) { value = d; at = n; } }
  return { value, at };
}
const where = (n: number) => `sample ${n} (pass ${Math.floor((n - T5) / L) + 1}, ${(((n - T5) % L) / 48).toFixed(2)} ms into it)`;

describe(`${AC[7]} loop {from 5:1, to 9:1}: loop points on the bar lines; a looping strip matches the straight render played three times within −96 dBFS from the second pass; without the fold it differs by more than −40 dBFS`, () => {
  it(`${AC[7]} the looped stem's loop points sit on 5:1 and 9:1 exactly, three passes match the straight render of bars 5 to 8 played three times within −96 dBFS per sample from the second pass on, and the stem looped without the fold differs there by more than −40 dBFS`, async () => {
    expect([T5, T9], '5:1 and 9:1 at 120 BPM in 4/4').toEqual([384_000, 768_000]);
    const { w, dirs } = await world();
    const looped = await render(w, plan(bin(), w.evidence, doc(true), dirs, 'the looped score').stems.bed!, 'the looped score: bed');
    const straight = await render(w, plan(bin(), w.evidence, doc(false), dirs, 'the straight score').stems.bed!, 'the straight score: bed');

    const meta = readMeta(w, looped.meta, 'the looped stem: meta');
    expect(meta.loop, `meta's loop is the region in samples, on the bar lines: ${show(meta.loop)}`).toEqual({ start: T5, end: T9 });
    const flac = readStem(w, looped.stem, 'the looped stem');
    expect({ LOOPSTART: flac.comments.LOOPSTART, LOOPLENGTH: flac.comments.LOOPLENGTH }, 'the stem\'s loop points (Vorbis comment, in samples) sit on 5:1 and 9:1').toEqual({ LOOPSTART: String(T5), LOOPLENGTH: String(L) });
    expect(readMeta(w, straight.meta, 'the straight stem: meta').loop, 'the straight score has no loop region').toBeNull();
    const straightFlac = readStem(w, straight.stem, 'the straight stem');
    expect(firstSound(straightFlac, T9, T9 + 24_000), 'the straight stem keeps the tails that ring past 9:1').toBeGreaterThanOrEqual(T9);
    expect(metaNotes(meta, 'the looped stem: meta').map((n) => n.event).sort(), 'every event is rendered once').toEqual(Object.keys(EVENTS).sort());

    // The looping strip: from the stem's start, through its intro, then the region over and over.
    const end = T5 + 3 * L;
    const [y] = mix(bin(), w.evidence, { transport: { sample_rate: 48_000, span: (T5 + 4 * L) * SAMPLE }, strips: { bed: { track: 1, src: { asset: looped.stem }, start: 0, in: 0, loop: true } } }, [{ from: 0, to: end * SAMPLE }], 'the looping strip');
    // The straight stem played once, the same way.
    const straightEnd = T9 + 3 * 48_000;
    const [s] = mix(bin(), w.evidence, { transport: { sample_rate: 48_000, span: straightEnd * SAMPLE }, strips: { bed: { track: 1, src: { asset: straight.stem }, start: 0, in: 0 } } }, [{ from: 0, to: straightEnd * SAMPLE }], 'the straight stem');
    expect(y![0]!.length, 'the looping strip played three passes').toBeGreaterThanOrEqual(end);
    const at = (c: number, n: number) => (n >= T5 && n < s![c]!.length ? s![c]![n]! : 0);
    const reference = (c: number, n: number) => at(c, n) + at(c, n - L) + at(c, n - 2 * L);
    const folded = maxDiff(y!, reference, T5 + L, end);
    expect(dbfs(folded.value), `the looping strip matches the straight render of bars 5 to 8 played three times within −96 dBFS per sample from the second pass on: the largest difference is ${dbfs(folded.value).toFixed(1)} dBFS at ${where(folded.at)}`).toBeLessThanOrEqual(-96);

    // The planted program: the straight stem's region repeated with nothing carried over (looped without the fold).
    const unfolded = (c: number, n: number) => at(c, T5 + ((n - T5) % L));
    const planted: Float32Array[] = [0, 1].map((c) => Float32Array.from({ length: end }, (_, n) => (n < T5 ? 0 : unfolded(c, n))));
    const off = maxDiff(planted, reference, T5 + L, end);
    expect(dbfs(off.value), `the stem looped without the fold differs from the straight render played three times by more than −40 dBFS where the tails ring past 9:1: ${dbfs(off.value).toFixed(1)} dBFS at ${where(off.at)}`).toBeGreaterThan(-40);
  }, TIMEOUT);
});
