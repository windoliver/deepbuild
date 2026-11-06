// Criterion 2: "With a tempo map, a boundary written on a downbeat lands within one frame of it, and beat times round
// to the nearest flick"
//
// Through `deep-motion eval`. A 24 fps film whose tempo map changes BPM and meter at bar 9: 107 BPM in 4/4 for 8 bars
// (32 beats), then 118 BPM in 3/4 for 8 bars (24 beats). Neither tempo's beat is a whole number of flicks, so every
// beat's flick is a rounding. The boundary is a `section` marker written on the downbeat `9:1b`: its flick must be
// within one frame (29,400,000 flicks at 24 fps) of the downbeat's exact time, 32 × 60 ÷ 107 s. Every beat of both
// sections, as a marker written in bar:beat form, must resolve to its exact rational time rounded to the nearest
// flick (computed here in BigInt). The fixture's tempos are chosen so that no beat sits within 0.04 flick of a
// rounding tie, and so that rounding the exact time, or the second section's start first and its offset after, give
// the same flick (README: Choices). No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, barBeat, evalOk, film, markerT, markerTOr, none, roundDiv, segment, tempoMap, tieDistance, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const FRAME = FLICKS / 24;
const B60 = 60n * BigInt(FLICKS);

/** Each beat's marker ID, bar:beat text and exact time as the rational n ÷ d flicks. */
function beats(): { id: string; text: string; n: bigint; d: bigint }[] {
  const out: { id: string; text: string; n: bigint; d: bigint }[] = [];
  for (let j = 0; j < 32; j++) out.push({ id: `a${j}`, text: barBeat(Math.floor(j / 4) + 1, (j % 4) + 1), n: BigInt(j) * B60, d: 107n });
  for (let k = 0; k < 24; k++) out.push({ id: `c${k}`, text: barBeat(9 + Math.floor(k / 3), (k % 3) + 1), n: 32n * B60 * 118n + BigInt(k) * B60 * 107n, d: 107n * 118n });
  return out;
}
function mapDoc(): JsonObject {
  const markers: JsonObject = { verse: { kind: 'section', t: '9:1b' } };
  for (const b of beats()) markers[b.id] = { kind: 'cue', t: b.text };
  return film('tempo-map', [], {
    tempo_map: tempoMap([segment('0s', 107, [4, 4], 32), segment('9:1b', 118, [3, 4], 24)]),
    markers,
  }, { span: '31s', frame_rate: [24, 1] });
}

describe('criterion 2: a tempo map places its boundaries on downbeats and its beats on the nearest flick', () => {
  it('criterion 2: the section boundary written on the downbeat 9:1b lands within one frame of 32 × 60 ÷ 107 s', () => {
    const a = evalOk(motion.bin(), { doc: mapDoc(), times: [0] }, 'the two-section tempo map');
    const exact = Number(32n * B60) / 107;
    const t = markerT(a, 'verse', 'the boundary');
    expect(Math.abs(t - exact), `the boundary 9:1b at ${t} flicks against the downbeat's ${exact}: within one frame (${FRAME} flicks)`).toBeLessThanOrEqual(FRAME);
  }, TIMEOUT);

  it('criterion 2: every beat of both sections resolves to its exact time rounded to the nearest flick', () => {
    const list = beats();
    for (const b of list) if (b.id !== 'a0') expect(tieDistance(b.n, b.d), `fixture: beat ${b.text} sits clear of a rounding tie`).toBeGreaterThan(0.04);
    const a = evalOk(motion.bin(), { doc: mapDoc(), times: [0] }, 'the two-section tempo map');
    const failures: string[] = [];
    for (const b of list) {
      const want = Number(roundDiv(b.n, b.d));
      const t = markerTOr(a, b.id);
      if (t !== want) failures.push(`beat ${b.text} (marker ${b.id}) resolves to ${t} flicks, not the nearest flick ${want} to ${Number(b.n) / Number(b.d)}`);
    }
    none(failures, 'the beats round to the nearest flick');
  }, TIMEOUT);
});
