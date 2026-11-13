// #525.06f030c7: "A collision plays its sound at the step it happened"
//
// A live lab with sound playing (README: The lab): a 0.1 m ball dropped from rest, its lowest point 1 m above a static
// floor, in the world `lab` that the panel's live transport steps; a bed looping on the left; and the spawn `clack` on
// the world's hits, panned hard right, so the right channel the live transport hands the gate is silent until the first
// hit's voice. The world's own list names the step of its first hit, k (within three steps of the free fall's landing,
// √(2 × 1 m ÷ g) = 0.4515 s, step 54.18: a guard that the row is the landing). The hit's sound must start on that step's
// own sample, ⌊k × 5,880,000 × 48,000 ÷ 705,600,000⌋ = 400 k, exactly.
//
// Wrong program (the criterion names none; README: Planted programs): `voice_at_frame`, a spawn that starts each voice at
// the t of the first display frame at or after its hit. Play is pressed 0.8 of a step past a step boundary, so under the
// audio master every frame's t lies 80 samples past a step's time and that voice lands 80 samples late.
import { describe, it } from 'vitest';
import {
  CRITERIA, Driver, LANDING_STEPS, PLAY_AT, STEP, TIMEOUT, dropLab, failsNaming, handed, handedOf, none, occurrences, onset,
  pcmOf, play, playing, rowsOf, sOf, sampleOf, secs, sounds, startLab, useBuilds, useTemp, type LivePlanted, type Pcm, type Row,
} from './helpers.ts';

const ID = CRITERIA[1];
const bin = useBuilds(['full']);
const temp = useTemp();

/** The document's 12 s transport; the window read, [0.25 s, 0.75 s) of document time, holds the first hit; the play runs
 * to 2 s past Play. */
const SPAN = secs(12);
const WINDOW: [number, number] = [secs(0.25), secs(0.75)];
const END = PLAY_AT + secs(2);

function played(planted?: LivePlanted): { rows: Row[]; pcm: Pcm } {
  const what = `the dropped ball, played live${planted ? ` (planted ${planted})` : ''}`;
  const evidence = temp('ev');
  const d = new Driver(bin('full'), { evidence, ...(planted ? { planted } : {}) });
  const serial = startLab(d, dropLab(sounds(evidence), SPAN), what);
  const [p, h, o] = d.step([play(serial), handed(END, ...WINDOW), occurrences(END)], what);
  playing(p, what);
  return { rows: rowsOf(o, 'lab.occurrences', what), pcm: pcmOf(evidence, handedOf(h, ...WINDOW, what), `${what}: the PCM handed to the gate`) };
}

/** The first hit's sound against its step's own sample. */
function failures({ rows, pcm }: { rows: Row[]; pcm: Pcm }, what: string): string[] {
  const hit = rows.find((r) => r.kind === 'hit');
  if (!hit) return [`${what}: the world lab's occurrence list holds no hit, so the ball never landed: ${JSON.stringify(rows).slice(0, 400)}`];
  const f: string[] = [];
  if (Math.abs(hit.step - LANDING_STEPS) > 3) f.push(`${what}: the first hit is at step ${hit.step}, not within three steps of the landing (step ${LANDING_STEPS.toFixed(2)})`);
  const own = sampleOf(hit.step * STEP);
  if (own < pcm.first || own >= pcm.first + pcm.frames) return [...f, `${what}: the hit's sample ${sOf(own)} lies outside the window read`];
  const heard = onset(pcm, 1);
  if (heard !== own) f.push(`${what}: the hit at step ${hit.step} sounds at ${heard === null ? 'no sample' : sOf(heard)}, not on its step's own sample ${sOf(own)} (⌊${hit.step} × 5,880,000 × 48,000 ÷ 705,600,000⌋)`);
  return f;
}

describe(`${ID} a collision's sound starts on its step's own sample`, () => {
  it(`${ID} the dropped ball's first hit, at step k of the live world's list, sounds from sample 400 k of the PCM the live transport hands the gate; a planted spawn that starts it at the frame showing the hit fails, naming the hit`, () => {
    none(failures(played(), 'the live lab'), 'the hit sounds on its step\'s own sample');
    failsNaming(failures(played('voice_at_frame'), 'the planted lab'), /the hit at step \d+ sounds at/, 'voice_at_frame');
  }, TIMEOUT);
});
