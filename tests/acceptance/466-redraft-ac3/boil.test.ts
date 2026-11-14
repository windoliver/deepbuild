// AC3 #466.4f5a25b8: "A boil with cycle 3 at 12 Hz repeats its drawing exactly every 0.25 s, and the flicker check
// passes it while still failing a seed that follows playback"
//
// Fixture (helpers.ts): the boil film, 640 × 360 at 24 frames a second, 2 s, under a drawn look whose pencil line boils
// with `time.boil {hz: 12, cycle: 3, amount_px: 2, scope: lines, while: always, seed: item}`: two pencil zigzags in the
// ink role and nothing else, so only the boil changes the drawing.
//
// asserts:
//   - Every 0.25 s the drawing repeats exactly: the snapshots at the six step starts k/12 s (k = 0..5) are three
//     drawings, pairwise different, in the order d0 d1 d2 d0 d1 d2; and at 16 seeded whole-flick times t in [0, 1.5) s,
//     the snapshots at t, t + 0.25 s and t + 0.5 s are byte-identical (one SHA-256) and equal the step start
//     ⌊12 t⌋/12's drawing. Every time is reached as its own eval, in a seeded order. Fails a boil that doesn't draw
//     (one drawing), one that ignores `cycle` (no repeat at 0.25 s), one at another rate, or one that moves between
//     its steps.
//   - The flicker check (a claim's requirement `{kind: "film.flicker"}`) PASSes the film with nothing raised; under the
//     planted `boil_seed_follows_playback` (the boil's seed taken from the frames the session has played, not from
//     ⌊t × hz⌋ mod 3 and IDs), the same judge fails, naming `film.reseed`.
import { describe, expect, it } from 'vitest';
import {
  AC3, CYCLE, FLICKS, PERIOD, RESEED, STEP, VERDICT, differing, drawScenario, evalAt, failsNaming, flickerFailures, flickerRow, inked, none, pictureOf,
  judgeScenario, run, secs, seededTimes, shuffled, snapshotSha, stepOf, TIMEOUT, useFolders, useShow,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();

describe(`${AC3} a boil with cycle 3 at 12 Hz repeats its drawing every 0.25 s, and the flicker check holds it to time`, () => {
  it(`${AC3} the drawing cycles through three drawings at 12 Hz and repeats exactly every 0.25 s`, () => {
    const evidence = folder();
    const starts = [0, 1, 2, 3, 4, 5].map((k) => k * STEP);
    const seededT = seededTimes(466_3, 16, 0, Math.round(1.5 * FLICKS));
    const asked = [...new Set([...starts, ...seededT.flatMap((t) => [t, t + PERIOD, t + 2 * PERIOD, stepOf(t) * STEP])])];
    const order = shuffled(asked, 466_31);
    const replies = run(bin(), drawScenario(evidence, order.map(evalAt)), 'the boil film drawn at each time');
    const sha = new Map<number, string>();
    order.forEach((t, i) => sha.set(t, snapshotSha(replies[i + 1]!, `the eval at ${secs(t)}`)));
    const failures: string[] = [];

    // The three drawings of a cycle, pairwise different, each with ink on it, and the cycle again.
    const pics = starts.slice(0, CYCLE).map((t) => pictureOf(evidence, sha.get(t)!, `the drawing at ${secs(t)}`));
    for (const [k, p] of pics.entries()) if (inked(p) < 500) failures.push(`the drawing at step ${k} (${secs(starts[k]!)}) shows ${inked(p)} inked pixels; the zigzags draw thousands`);
    for (let a = 0; a < CYCLE; a++) {
      for (let b = a + 1; b < CYCLE; b++) {
        if (differing(pics[a]!, pics[b]!) === 0) failures.push(`steps ${a} and ${b} (${secs(starts[a]!)} and ${secs(starts[b]!)}) draw the same picture: a cycle of 3 boils through three drawings`);
      }
    }
    for (let k = CYCLE; k < starts.length; k++) {
      if (sha.get(starts[k]!) !== sha.get(starts[k - CYCLE]!)) failures.push(`step ${k} (${secs(starts[k]!)}) doesn't redraw step ${k - CYCLE}'s drawing (${secs(starts[k - CYCLE]!)}) byte for byte`);
    }
    // Exactly every 0.25 s, from any time, and held through each 1/12 s step.
    for (const t of seededT) {
      const at = sha.get(t)!;
      if (sha.get(t + PERIOD) !== at) failures.push(`the drawing at ${secs(t + PERIOD)} isn't the one at ${secs(t)} byte for byte`);
      if (sha.get(t + 2 * PERIOD) !== at) failures.push(`the drawing at ${secs(t + 2 * PERIOD)} isn't the one at ${secs(t)} byte for byte`);
      if (sha.get(stepOf(t) * STEP) !== at) failures.push(`the drawing at ${secs(t)} isn't its step's (${secs(stepOf(t) * STEP)}): the seed is ⌊t × 12⌋ mod 3`);
    }
    expect(sha.size, 'one snapshot per time asked').toBe(asked.length);
    none(failures, 'the boil with cycle 3 at 12 Hz');
  }, TIMEOUT);

  it(`${AC3} the flicker check passes the boil`, () => {
    const [reply] = run(bin(), judgeScenario(folder(), [VERDICT]), 'the flicker check on the boil film');
    none(flickerFailures(flickerRow(reply!, 'the verdict'), 'the boil film'), 'the flicker check on the boil');
  }, TIMEOUT);

  it(`${AC3} a planted boil whose seed follows playback fails the flicker check, naming ${RESEED}`, () => {
    const [reply] = run(bin(), judgeScenario(folder(), [VERDICT], 'boil_seed_follows_playback'), 'the flicker check on the boil film under boil_seed_follows_playback');
    failsNaming(flickerFailures(flickerRow(reply!, 'the verdict'), 'the boil film'), [RESEED], 'the flicker check on a boil seeded by playback');
  }, TIMEOUT);
});
