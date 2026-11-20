// #2760.9c74b517: "A Spawn on the same list starts each voice on its ring's flick: for all three touches the voice's first
// sample and the ring's age 0 fall on one flick"
//
// One document (helpers.ts `pondDoc`, 480 × 270): criterion 1's still pond and its three touches at 1, 1.5 and 2 s. Its
// material carries `rings: {on: {list: "taps.occurrences", kinds: ["touch"]}}`, and its `spawns` hold `splash`, a Spawn
// on the same list with the same filter (#544's form) that plays a 0.25 s 1 kHz cosine at 0.5 from its first sample.
// The voices come from `deep-show run`'s `media_mix` of that document over [0, 3 s), as #544's suite reads a Spawn's;
// the rings from `deep-gpu run`'s `view3d` of the same document, frame 55 at 25 fps (2.2 s), at which rate the second
// touch (1.5 s) falls between two frames.
//
// For each of the three touches: the spawn starts one voice on its occurrence (`voices[].occurrence`, the row's index
// in the list), whose `start` is the touch's flick; the mix is silent from the end of the voice before to that flick's
// sample (48,000 × its seconds) and sounds at that sample, so the voice's first sample is on that flick; and the frame's
// `rings` rows list the ring of the same occurrence whose `born`, its age 0, is that flick (born × 705,600,000 within
// half a flick of the voice's `start`), with radius speed × the time since that flick. Wrong programs: a ring started
// at the first frame at or after its occurrence, at its step's end or a frame late, a ring keyed by another index than
// the Spawn's, no ring at all. At the base the voices are there and the rings aren't.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, SAMPLE, SILENCE, STILL, TAPS, TAPS_LIST, TAP_RINGS, type JsonObject, alive, frameAt, framesOf, logicItem, look3d, mediaMix, mixOf, none, peak, pondDoc,
  putAsset, putEvidence, requireGpu, ringFailures, ringsOf, runGpu, runShow, secs, threeTouches, toneWav, useBins, useOut, view3d, writeJson,
} from './helpers.ts';

const bins = useBins(['deep-gpu', 'deep-show']);
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('spawn-2760');
const FPS = 25;
const AT = 55; // 2.2 s
const T = AT / FPS;
const SPAWN = 'splash';
/** The spawn's one template: a 0.25 s mono 1 kHz cosine at 0.5 (12,000 samples), audible from its first sample. */
const VOICE_FRAMES = 12_000;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #2760 acceptance tests.' };

describe(`${AC[7]} a touch's ring and its splash start on one flick`, () => {
  it(`${AC[7]} a Spawn on the same list starts each voice on its ring's flick: for all three touches the voice's first sample and the ring's age 0 fall on one flick`, () => {
    requireGpu();
    const dir = out();
    const taps = threeTouches();
    const tone = putEvidence(dir, toneWav(1000, VOICE_FRAMES, 0.5));
    putEvidence(dir, taps.program.bytes);
    const doc = pondDoc('splash', SIZE, { ...STILL, rings: TAP_RINGS }, { [TAPS]: logicItem(taps) }, {
      extra: {
        spawns: { [SPAWN]: { on: { list: TAPS_LIST, kinds: ['touch'] }, play: { src: { asset: tone }, in: 0, out: secs(0.25) } } },
        assets: { taps_program: { sha256: taps.program.sha, license: LICENSE }, splash_tone: { sha256: tone, license: LICENSE } },
      },
    });

    // The voices: one a touch, on its flick, its first sample there.
    const [mixed] = runShow(bins('deep-show'), dir, [mediaMix(doc, 0, secs(3))]);
    const { voices, pcm } = mixOf(mixed!, dir, 'media_mix of the pond with its spawn');
    expect(voices.map((v) => ({ spawn: v.spawn, occurrence: v.occurrence, start: v.start })), 'the spawn starts one voice per touch, at its flick').toEqual(taps.rows.map((r) => ({ spawn: SPAWN, occurrence: r.index, start: r.t })));
    let quietFrom = 0;
    for (const v of voices) {
      expect(v.start % SAMPLE, `the voice of touch ${v.occurrence + 1} starts on a sample`).toBe(0);
      const s = v.start / SAMPLE;
      expect(peak(pcm, quietFrom, s), `the mix is silent before the voice of touch ${v.occurrence + 1}, from sample ${quietFrom} to ${s}`).toBeLessThanOrEqual(SILENCE);
      expect(peak(pcm, s, s + 1), `the voice of touch ${v.occurrence + 1} sounds at sample ${s}, its first`).toBeGreaterThan(0.1);
      quietFrom = s + VOICE_FRAMES;
    }

    // The rings of the same document: each one's age 0 on its voice's flick.
    const [drawn] = runGpu(bins('deep-gpu'), dir, [
      view3d({ doc: writeJson(dir, 'splash', doc), look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, capture: [AT], rings: true, assets: putAsset(dir, taps.program) }),
    ]);
    const rings = ringsOf(frameAt(framesOf(drawn!, 'the pond with its spawn'), AT, 'the pond with its spawn'), 'the pond with its spawn');
    none(ringFailures(rings, alive(taps.rows, T), T, TAPS_LIST), 'each touch\'s ring at 2.2 s, its radius speed × the time since its flick');
    for (const v of voices) {
      const ring = rings.find((r) => r.occurrence === v.occurrence);
      expect(ring, `the ring of touch ${v.occurrence + 1} (occurrence ${v.occurrence} of ${TAPS_LIST}) is listed at 2.2 s`).toBeDefined();
      console.log(`${AC[7]}: touch ${v.occurrence + 1}: the voice's first sample at ${v.start} flicks (sample ${v.start / SAMPLE}), the ring's age 0 at ${ring!.born * FLICKS} flicks`);
      expect(Math.abs(ring!.born * FLICKS - v.start), `the ring of touch ${v.occurrence + 1} is born at ${ring!.born} s; its age 0 and the voice's first sample (${v.start} flicks) fall on one flick`).toBeLessThan(0.5);
    }
  });
});
