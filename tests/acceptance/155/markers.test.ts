// AC1 #155.2ad28764: "A marker of kind press drives a spawn through markers.press, and moving the marker moves the
// sound with it"
//
// Through `deep-show run`'s `media_mix` (#499, #500's `voices`). A media document of 4 s holds three markers (Marker:
// `{kind, t, tags, payload}`): `tap` of kind press, `other` of kind cue at 2 s and `later` of kind press at 3.5 s whose
// tag is `late`, and one spawn, `click`, on `{list: "markers.press", tags: ["ui"]}` (the design's form `markers.<kind>`,
// filtered by tags) playing a one-sample click (0.5 at its first sample, then 2,399 zeros: a float WAV in the evidence
// store) with no cooldown. `tap` carries the tag `ui`; `later` doesn't, so the filter keeps it out.
//   - `tap` at 1.25 s: one voice, on occurrence `tap`'s row, starting at 1.25 s; the mix holds one click, on sample
//     60,000 (the first at or after its flick), and every other sample is 0.
//   - `tap` moved to 2.6 s and 7,000 flicks: one voice at that flick; the click on sample 124,801 (⌈t ÷ 14,700⌉) and
//     nowhere else; sample 60,000 is 0.
// The wrong program is the merge base: it answers `unbaked_list` for markers.press, which no document lists in
// `occurrences`, so no mix comes back.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, SAMPLE, TIMEOUT, mixCall, mixOf, pcmOf, proof, putSignal, runShow, sOf, sampleAt, scenario, secs, tempDir, useShow, type JsonObject,
} from './helpers.ts';

const bin = useShow();
const SPAN = secs(4);

function pressDoc(click: string, tapAt: number): JsonObject {
  return {
    transport: { sample_rate: 48_000, span: SPAN },
    strips: {},
    markers: {
      tap: { kind: 'press', t: tapAt, tags: ['ui'], payload: {} },
      other: { kind: 'cue', t: secs(2), tags: ['ui'], payload: {} },
      later: { kind: 'press', t: secs(3.5), tags: ['late'], payload: {} },
    },
    spawns: { click: { on: { list: 'markers.press', tags: ['ui'] }, play: { src: { asset: click }, in: 0, out: 2400 * SAMPLE }, cooldown: 0 } },
  };
}

/** The voices and the clicks heard when `tap` sits at `tapAt`; each failure names what differs. */
function pressFailures(tapAt: number): { failures: string[]; heard: number[]; starts: number[] } {
  const evidence = tempDir();
  const x = new Float32Array(2400);
  x[0] = 0.5;
  const click = putSignal(evidence, [x]);
  const asks = [{ from: 0, to: SPAN, write: true }];
  const [reply] = runShow(bin(), scenario(evidence, [mixCall(pressDoc(click, tapAt), asks)]), `the press marker at ${sOf(tapAt)}`);
  const m = mixOf(reply, asks, `the press marker at ${sOf(tapAt)}`);
  const pcm = pcmOf(evidence, m.segments[0]!, `the press marker at ${sOf(tapAt)}`);
  const failures: string[] = [];
  const starts = m.voices.map((v) => v.start);
  if (m.voices.length !== 1) failures.push(`markers.press filtered by the tag ui starts ${m.voices.length} voices, not 1 (tap's): ${JSON.stringify(m.voices.map((v) => v.raw))}`);
  else if (m.voices[0]!.start !== tapAt) failures.push(`the voice starts at ${sOf(m.voices[0]!.start)} (${m.voices[0]!.start} flicks), not at the marker tap's ${sOf(tapAt)} (${tapAt})`);
  const heard: number[] = [];
  for (let n = 0; n < pcm.frames; n++) if (pcm.channels[0]![n] !== 0 || pcm.channels[1]![n] !== 0) heard.push(pcm.first + n);
  const want = sampleAt(tapAt);
  if (heard.length !== 1 || heard[0] !== want) failures.push(`the mix sounds on samples [${heard.slice(0, 12).join(', ')}${heard.length > 12 ? ', …' : ''}], not on sample ${want} alone (the first at or after the marker's flick)`);
  return { failures, heard, starts };
}

describe(`${AC[1]} a press marker drives a spawn through markers.press, and its sound moves with it`, () => {
  it(`${AC[1]} the press marker tap at 1.25 s plays one click on sample 60,000; moved to 2.6 s + 7,000 flicks, the click moves to sample 124,801 and nothing sounds at 60,000`, () => {
    const first = pressFailures(secs(1.25));
    const movedAt = secs(2.6) + 7_000;
    const moved = pressFailures(movedAt);
    proof('ac1-press.json', { first, moved, movedAt, flicks: FLICKS });
    expect(first.failures, `with tap at 1.25 s: ${first.failures.join(' | ')}`).toEqual([]);
    expect(moved.failures, `with tap moved to ${sOf(movedAt)}: ${moved.failures.join(' | ')}`).toEqual([]);
    expect(moved.heard.includes(60_000), 'nothing sounds at the marker\'s old sample once it moved').toBe(false);
  }, TIMEOUT);
});
