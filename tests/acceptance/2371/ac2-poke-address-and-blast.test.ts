// #2371.825e2c1b: "A poke by `address` equals a poke at that anchor's point by step hash; a blast with radius 1 m
// moves a body 0.9 m away and leaves one 1.1 m away at rest"
//
// The poke (README: The worlds): a 0.5 m crate floating at rest at the origin, unturned, with the anchor `rim` at
// (0.25, 0, 0) m, the middle of its +x face. One impulse of 1 N·s along +y at step 10, three ways: by
// `address: "crate#rim"`, at `point: [0.25, 0, 0]`, and at the body's centre. The first two must give the same step
// hashes; they are not the hashes of the crate left alone, nor of the poke at its centre, which doesn't turn it, so
// an address that is ignored can't pass.
//
// The blast: two beads floating at rest, `near` 0.9 m from the origin and `far` 1.1 m from it, and a blast at the
// origin of radius 1 m at step 10, one entry for each bead. `near` is moved and `far` stays exactly as built. With
// the radius written 1.2 m the same entry moves `far` too, so its rest is the radius's doing.
import { describe, expect, test } from 'vitest';
import {
  AC, BLAST_STEP, BLAST_TRACK, HASHES_ONLY, POKE_AT_CENTRE, POKE_AT_POINT, POKE_BY_ADDRESS, POKE_STEP, TIMEOUT, ask, bake, blastWorld,
  entryFailures, firstDifference, hashesOf, movedFailures, pokeWorld, prebuild, restFailures, sameFailures,
} from './helpers.ts';

prebuild();

/** One second for the poked crate, half a second for the blast. */
const POKED = 120;
const BLASTED = 60;

describe(`${AC[2]} a poke by address is a poke at that anchor's point; a blast reaches the bodies within its radius and no farther`, () => {
  test(`${AC[2]} a poke by address crate#rim gives the step hashes of the same poke at the anchor's point (0.25, 0, 0), and not those of a poke at the centre or of no poke`, () => {
    const run = ask([[POKE_BY_ADDRESS], [POKE_AT_POINT], [], [POKE_AT_CENTRE]].map((track) => bake(pokeWorld(), track, POKED, HASHES_ONLY)));
    expect(run.problem, `${run.what} answers`).toBe('');
    const byAddress = hashesOf(run.replies[0], POKED, 'the crate poked by address crate#rim');
    expect(typeof byAddress === 'string' ? byAddress : '', 'the crate poked by address is played, a step hash after each step').toBe('');
    const addressed = byAddress as string[];
    const [atPoint, alone, atCentre] = [
      hashesOf(run.replies[1], POKED, 'the crate poked at the point (0.25, 0, 0)'),
      hashesOf(run.replies[2], POKED, 'the crate left alone'),
      hashesOf(run.replies[3], POKED, 'the crate poked at its centre'),
    ];
    const failures = [atPoint, alone, atCentre].filter((x): x is string => typeof x === 'string');
    if (failures.length === 0) {
      failures.push(...sameFailures(addressed, atPoint as string[], 'the poke by address crate#rim', 'with the poke at the anchor\'s point (0.25, 0, 0)'));
      // Not vacuous: the poke by address changes the world after its step, and not as a poke at the centre does.
      failures.push(...entryFailures(addressed, alone as string[], POKE_BY_ADDRESS));
      if (firstDifference(addressed, atCentre as string[]) === null) failures.push('the poke by address crate#rim gives the step hashes of the same impulse at the crate\'s centre: the address isn\'t where the poke is applied');
    }
    expect(failures, `the poke by address stamped step ${POKE_STEP}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a blast with radius 1 m moves the body 0.9 m away and leaves the one 1.1 m away at rest`, () => {
    const run = ask([bake(blastWorld(1), BLAST_TRACK, BLASTED), bake(blastWorld(1.2), BLAST_TRACK, BLASTED)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [one, wider] = run.replies;
    const played = hashesOf(one, BLASTED, 'the two beads with the blast of radius 1 m');
    expect(typeof played === 'string' ? played : '', 'the two beads and the blast with radius 1 m are played, a state of each bead after each step').toBe('');
    const failures = [
      ...movedFailures(one, 'near', BLAST_STEP, BLASTED, 'the blast with radius 1 m'),
      ...restFailures(one, 'far', BLASTED, 'the blast with radius 1 m'),
      // Not vacuous: the same entry reaches the far bead once the radius holds it.
      ...movedFailures(wider, 'far', BLAST_STEP, BLASTED, 'the blast with radius 1.2 m'),
    ];
    expect(failures, `the blast stamped step ${BLAST_STEP}, its beads 0.9 m and 1.1 m away:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
