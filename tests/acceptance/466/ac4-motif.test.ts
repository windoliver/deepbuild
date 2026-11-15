// AC4 #466.3b9b126d: A motif with a rate of 1 beat stays on the beat within one frame across a tempo change from 120 to
// 144 BPM.
//
// Through `deep-motion eval` (#391's JSON lines; #491's tempo map). A 9 s film whose tempo map plays 8 beats at 120 BPM
// (to 4 s) and then 12 at 144 BPM (to 9 s), the second segment at `3:1b`; one square, `pad`, in the collection `pads`,
// which the document's `motif_slots` binds to the slot `beat`. The eval line's look (#462's motifs) pulses that slot:
// `{motion: "pulse", amount: 0.25, rate: {beats: 1}, phase: "free", desync: false}`, so the pad's evaluated scale is
// 1 + 0.25 sin(2π · beats) and rises through 1 at every beat. Frames 0 to 540 at 60 fps report `items.pad.at.scale`;
// each upward crossing of 1, placed by linear interpolation between its two frames, must lie within one frame (1/60 s)
// of a beat of the tempo map (beats 1 to 19: every 0.5 s to 4 s, then every 60 ÷ 144 s), one crossing each. The planted
// `motif_beats_at_first_tempo` counts the motif's beats at the first segment's 120 BPM throughout, and the same judge
// fails, naming beat 9, the first after the change.
import { describe, it } from 'vitest';
import {
  AC, FLICKS_PER_S, FRAME60, TIMEOUT, arr, camera2d, evalOk, failsNaming, film, none, num, obj, rect, sOf, useMotion, type JsonObject, type Planted,
} from './helpers.ts';

const motion = useMotion();

/** The tempo map's beat k in flicks: 0.5 s apart to beat 8 (4 s), then 60 ÷ 144 s apart. */
const beat = (k: number): number => (k <= 8 ? k * (FLICKS_PER_S / 2) : 4 * FLICKS_PER_S + (k - 8) * ((60 * FLICKS_PER_S) / 144));

function motifFilm(): JsonObject {
  return film('motif', [camera2d([480, 270]), rect('pad', [220, 115, 40, 40], 'accent')], {
    tempo_map: { segments: [{ at: '0s', bpm: 120, meter: [4, 4], span: 8, ramp: 'none' }, { at: '3:1b', bpm: 144, meter: [4, 4], span: 12, ramp: 'none' }] },
    collections: { pads: { members: ['pad'] } },
    motif_slots: { beat: 'pads' },
  }, { span: '9s' });
}
const LOOK: JsonObject = { motifs: { beat: { motion: 'pulse', amount: 0.25, rate: { beats: 1 }, phase: 'free', desync: false, seed: 'item' } } };

/** Each beat with no upward crossing of the pad's scale within one frame, by name. */
function beatFailures(planted?: Planted): string[] {
  const times = Array.from({ length: 541 }, (_, n) => n * FRAME60);
  const a = evalOk(motion.bin(), { doc: motifFilm(), times, look: LOOK, ...(planted ? { planted } : {}) }, planted ? `the motif film (planted ${planted})` : 'the motif film');
  const scale = a.frames.map((f) => num(arr(obj(obj(f.items['pad'], `items.pad at ${f.t}`)['at'], `items.pad.at at ${f.t}`)['scale'], `items.pad.at.scale at ${f.t}`)[0], `items.pad.at.scale[0] at ${f.t}`));
  const crossings: number[] = [];
  for (let n = 0; n + 1 < scale.length; n++) {
    const [p, q] = [scale[n]!, scale[n + 1]!];
    if (p < 1 && q >= 1) crossings.push(times[n]! + ((1 - p) / (q - p)) * FRAME60);
  }
  const failures: string[] = [];
  if (Math.max(...scale) - Math.min(...scale) < 0.4) failures.push(`the pad's scale moves only between ${Math.min(...scale)} and ${Math.max(...scale)}: the motif doesn't pulse it`);
  for (let k = 1; k <= 19; k++) {
    const near = crossings.filter((c) => Math.abs(c - beat(k)) <= FRAME60);
    if (near.length !== 1) {
      const nearest = crossings.reduce((best, c) => (Math.abs(c - beat(k)) < Math.abs(best - beat(k)) ? c : best), Number.POSITIVE_INFINITY);
      failures.push(`beat ${k} (${sOf(beat(k))}): ${near.length} upward crossings within one frame; the nearest is at ${Number.isFinite(nearest) ? sOf(nearest) : 'none'}, ${Number.isFinite(nearest) ? (Math.abs(nearest - beat(k)) / FRAME60).toFixed(2) : '∞'} frames off`);
    }
  }
  const stray = crossings.filter((c) => c > FRAME60 / 2 && ![...Array(19).keys()].some((i) => Math.abs(c - beat(i + 1)) <= FRAME60));
  if (stray.length) failures.push(`upward crossings on no beat: ${stray.map(sOf).join(', ')}`);
  return failures;
}

describe(`${AC[4]} a motif with a rate in beats stays on the beat when the tempo changes`, () => {
  it(`${AC[4]} the pulse rises through rest within one frame of every beat across the change from 120 to 144 BPM`, () => {
    none(beatFailures(), 'the motif on the tempo map\'s beats');
  }, TIMEOUT);

  it(`${AC[4]} (planted) a motif counting beats at the first tempo drifts off after the change and fails, naming beat 9`, () => {
    failsNaming(beatFailures('motif_beats_at_first_tempo'), ['beat 9 ('], 'the planted motif_beats_at_first_tempo');
  }, TIMEOUT);
});
