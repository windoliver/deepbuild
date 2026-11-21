// #2371.aabc7fe9: "A drag whose medium reads a channel, a spring whose point reads a channel and a force whose strength
// an input sets each change the world at the step the channel or the input says, and a seek from a checkpoint equals
// playing by step hash"
//
// The field (README: The worlds), a world in a scene: `leaf` in the drag `breeze`, whose medium reads
// items/wind/at/pos; `bob` on the spring `tether`, whose point reads items/anchor/at/pos; `puck` under the force
// `push`, whose strength the `set` input `throttle` sets. All three float at rest as built. The wind's channel holds
// still until 0.275 s (step 33), then 3 m/s along +x until 1.275 s (step 153), then 2 m/s along −z; the anchor's holds
// the bob's built position until 0.375 s (step 45), then 0.5 m along +x until 1.375 s (step 165), then 0.5 m up; the
// track sets the strength to 3 at step 40 and to 1 at step 190. Every key sits on an odd step's time, between two
// 60 fps frames.
//
// "At the step the channel or the input says": the field without one key, or without one entry, gives the same step
// hashes before that step and another at it, where the body its force applies to differs. A key at step K's time is
// first read by the step that ends there, so the state after K steps is the first to change (#1918's step time); an
// entry stamped k applies at the start of the next step, so the state after k + 1 is (#522's stamp).
import { describe, expect, test } from 'vitest';
import {
  AC, FIELD, FIELD_TRACK, HASHES_ONLY, SAYS, SEEK_LATE, STEPS, TIMEOUT, ask, drop, forceScene, hashesOf, prebuild, saysFailures,
  sceneBake, sceneSeek, scratch, seekFailures,
} from './helpers.ts';

prebuild();

describe(`${AC[3]} a drag's medium and a spring's point read from a channel and a force's strength set by an input change the world at their step, and a seek equals playing`, () => {
  test(`${AC[3]} the drag's medium, the spring's point and the force's strength each change the world at the step the channel's key or the input's entry says: steps 33 and 153, 45 and 165, 41 and 191`, () => {
    const run = ask([sceneBake(forceScene(), FIELD, FIELD_TRACK, STEPS), ...SAYS.map((s) => sceneBake(s.scene, FIELD, s.track, STEPS))]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const played = hashesOf(run.replies[0], STEPS, 'the field, its forces reading two channels and an input');
    expect(typeof played === 'string' ? played : '', 'the world whose drag and spring read a channel and whose force an input sets is played in its scene, a step hash after each step').toBe('');
    const failures = SAYS.flatMap((s, i) => saysFailures(run.replies[0], run.replies[1 + i], s, STEPS));
    expect(failures, `what each channel and the input say, against the field without it:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a seek to step ${SEEK_LATE.to} from the checkpoint at step ${SEEK_LATE.from}, played on to step ${STEPS}, gives the straight run's step hashes`, () => {
    const store = scratch();
    try {
      const still = forceScene({ wind: 'k1', anchor: 'k1' });
      const run = ask([
        sceneBake(forceScene(), FIELD, FIELD_TRACK, STEPS, { ...HASHES_ONLY, store }),
        sceneSeek(forceScene(), FIELD, FIELD_TRACK, STEPS, store, SEEK_LATE.to),
        sceneBake(still, FIELD, [], SEEK_LATE.from, HASHES_ONLY),
      ]);
      expect(run.problem, `${run.what} answers`).toBe('');
      const played = hashesOf(run.replies[0], STEPS, 'the field');
      expect(typeof played === 'string' ? played : '', 'the field is played 2 s into a store, a step hash after each step').toBe('');
      const straight = played as string[];
      const what = `the seek to step ${SEEK_LATE.to}, played on to step ${STEPS}`;
      const failures = seekFailures(straight, run.replies[1], SEEK_LATE, what);
      // Not vacuous: the checkpoint the seek restores holds what the channels and the input did before it. With the
      // channels' first keys and the track left out, the state after 120 steps is another.
      const idle = hashesOf(run.replies[2], SEEK_LATE.from, 'the field with its channels\' first keys and its track left out');
      if (typeof idle === 'string') failures.push(idle);
      else if (idle[SEEK_LATE.from] === straight[SEEK_LATE.from]) failures.push(`the state after ${SEEK_LATE.from} steps is the same with the channels' first keys and the track left out: nothing the seek restores depends on them`);
      expect(failures, `${what}, against the straight run:\n  ${failures.join('\n  ')}`).toEqual([]);
    } finally {
      drop(store);
    }
  }, TIMEOUT);
});
