// #509.659d2ba6: "A line with `after: intro` starts 0.3 s after intro's last word in the words bake, within one sample,
// and moves when intro's text grows by four words; and a placement from `@l.word:x#1` to `@l.word:squared#1.end` covers
// exactly those words' span in the bake"
//
// Through `deep-show run`'s `time` and `eval`. Two lines, each your own recording spoken word by word by `say` at known
// samples, their words records written from those samples (#502's shapes): `intro` at 0.5 s, "Here is the first idea";
// `l`, "Now x squared grows quickly", with `after: intro` and no `t`, its take starting on its first word (sample 0), so
// the line's start and its first word's are one time. `@l` must resolve to 0.5 s + intro's last word's end + 0.3 s
// (the default gap), within one sample at 48 kHz (14,700 flicks). With intro's text grown by four words ("… we want to
// share") and its take grown with them, `@l` moves to the new last word's end + 0.3 s, within one sample. A placement
// `p` of the clip `mark` (which holds the rect `flag` at x 40) runs from `@l.word:x#1` to `@l.word:squared#1.end`: those
// anchors lie at l's start plus the bake's start of "x" and end of "squared", to the flick, and `eval` reads flag's x as
// 40 from the first to the flick before the second, and 0 a flick before the first and at the second.
import { describe, expect, it } from 'vitest';
import { AC, FULL, SAMPLE, TIMEOUT, assetOf, film, filmRun, flicksOf, proof, recorded, show, stage, take, timeCall, useShow, useTemp, DOC, FLICKS, type JsonObject, type Take } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const INTRO = 'Here is the first idea';
const GROWN = `${INTRO} we want to share`;
const L = 'Now x squared grows quickly';
const T = FLICKS / 2;
const GAP = (3 * FLICKS) / 10;
const FLAG = 'items/flag/at/pos/0';
const PACING: JsonObject = {
  clips: { mark: { slots: { target: { type: 'rect@1', required: true } }, span: '60s', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 40, interp: 'hold' } } } } } },
  placements: { p: { clip: 'mark', slots: { target: 'flag' }, start: '@l.word:x#1', end: '@l.word:squared#1.end' } },
};
const flag: JsonObject = { id: 'flag', kind: 'rect@1', name: 'Rect flag', order: 'a3', params: { box: [0, 0, 8, 8], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } };

function doc(evidence: string, intro: Take, l: Take, introText: string): JsonObject {
  const a = stage(evidence, intro);
  const b = stage(evidence, l);
  return film({
    span: 9, items: [flag], clips: PACING['clips'] as JsonObject, placements: PACING['placements'] as JsonObject,
    lines: { intro: recorded('voice_intro', introText, 0.5), l: recorded('voice_l', L, null, { after: 'intro' }) },
    assets: { voice_intro: assetOf(a), voice_l: assetOf(b) },
  });
}
/** The times `time` resolves, in flicks, or a failure naming the anchor. */
function times(bin: string, evidence: string, document: JsonObject, anchors: string[], what: string): number[] {
  const replies = filmRun(bin, evidence, document, anchors.map(timeCall), what);
  expect(replies[0]!['outcome'], `${what}: the film is presented: ${show(replies[0])}`).toBe('presented');
  return anchors.map((a, i) => {
    const r = replies[i + 1]!;
    expect(r['outcome'] === 'resolved' && Number.isSafeInteger(r['t']), `${what}: ${a} resolves to a time in flicks: ${show(r)}`).toBe(true);
    return r['t'] as number;
  });
}
const lastEnd = (t: Take): number => flicksOf(t.words[t.words.length - 1]!.end);

describe(`${AC[11]} narration sets the pace: after, and placements on word anchors`, () => {
  it(`${AC[11]} l with after: intro starts 0.3 s after intro's last word within one sample, and moves when intro grows by four words; p covers exactly x to the end of squared`, () => {
    const bin = shows.bin(FULL);
    const intro = take(INTRO);
    const grown = take(GROWN);
    const l = take(L);
    expect(l.words[0]!.start, 'the fixture: l\'s take starts on its first word').toBe(0);
    const e1 = temp();
    const short = doc(e1, intro, l, INTRO);
    const [at, x, squared] = times(bin, e1, short, ['@l', '@l.word:x#1', '@l.word:squared#1.end'], 'the film with intro of five words');
    const e2 = temp();
    const [moved] = times(bin, e2, doc(e2, grown, l, GROWN), ['@l'], 'the film with intro grown by four words');
    const probes = [x! - 1, x!, squared! - 1, squared!];
    const evals = filmRun(bin, e1, short, probes.map((t) => ({ call: 'eval', doc: DOC.a, t, paths: [FLAG] })), 'flag through the placement');
    const xs = evals.slice(1).map((r) => (r['values'] as JsonObject | undefined)?.[FLAG] ?? null);
    const want = { at: T + lastEnd(intro) + GAP, moved: T + lastEnd(grown) + GAP, x: at! + flicksOf(l.words[1]!.start), squared: at! + flicksOf(l.words[2]!.end) };
    proof('ac11-after.json', { got: { at, moved, x, squared, flag: xs }, want, intro: intro.words, grown: grown.words, l: l.words });

    expect(Math.abs(at! - want.at), `@l is ${at} flicks; intro's last word ends at ${T + lastEnd(intro)}, so 0.3 s after is ${want.at} (one sample is ${SAMPLE} flicks)`).toBeLessThanOrEqual(SAMPLE);
    expect(Math.abs(moved! - want.moved), `with intro grown by four words @l is ${moved}; 0.3 s after its new last word is ${want.moved}`).toBeLessThanOrEqual(SAMPLE);
    expect(moved! - at!, 'l moves later by the four words intro gained').toBeGreaterThan(SAMPLE);
    expect([x, squared], 'the anchors are l\'s start plus the bake\'s start of x and end of squared, to the flick').toEqual([want.x, want.squared]);
    expect(xs, `flag's x is 40 exactly from @l.word:x#1 to the flick before @l.word:squared#1.end, and 0 just outside: at ${probes.join(', ')} flicks`).toEqual([0, 40, 40, 0]);
  }, TIMEOUT);
});
