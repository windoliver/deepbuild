// #2243.369a5712: "The head-on world sought to 0.5 s and played on gives the same step hashes as a straight run. With
// the two bodies' priorities swapped, each run is the same by hash on a second run, and the point midway between them
// at rest moves by no more than two steps' walk, 0.0333 m"
//
// The head-on world (README: The world) and the same world with the two priorities swapped (`guard` 1, `hero` 0), each
// baked 3 s with both moves stamped at step 0.
//
// The seek is #522's: the straight run is baked into a store with its checkpoints (one every 60 steps, so one at
// 0.5 s), then `seek` restores the checkpoint at step 60 and plays the 300 steps to 3 s; its 301 step hashes must be
// the straight run's from step 60 on, string for string. The order: one process bakes the world as written and
// swapped, and a second process bakes both again; each order's 361 step hashes must be the same strings on the second
// run, and the midpoint of the two axes after step 360 may differ between the orders by at most 2 × 2 ÷ 120 m.
//
// The criterion names no planted program. Both tests hold the runs they compare to the head-on world at rest, by
// criterion 1's measure (from 1 s to 3 s neither body more than 1 mm from where it stood at 1 s): the criterion reads
// the midpoint "at rest", and a seek played on over two bodies that never rest isn't the head-on world's. That is
// what fails at the base (README: What the base already does). No comparison is hollow: each run holds its 361 hashes,
// a hash changes with every step the bodies walk, the seek starts from the checkpoint at step 60 and not from step 0,
// and the swapped world has a bake key of its own.
import { describe, expect, it } from 'vitest';
import {
  AC, GUARD, HERO, STEPS, TIMEOUT, TWO_STEPS, ask, bakeCall, fmt, hashFailures, hashesOf, headOnTrack, headOnWorld, hollowHashes, midway,
  missing, pairOf, prebuild, restFailures, seekCall, show, useTemp,
} from './helpers.ts';

prebuild(['release']);
const temp = useTemp();

const ID = AC[3];
/** 0.5 s at 120 Hz. */
const SOUGHT = 60;
const ORDERS = ['the head-on world as written', 'the head-on world with its priorities swapped'] as const;

describe(`${ID} the head-on world seeks as it plays, and repeats itself whichever body moves first`, () => {
  it(`${ID} the head-on world sought to 0.5 s and played on gives the same step hashes as a straight run`, () => {
    const [store, world, track] = [temp(), headOnWorld(), headOnTrack()];
    const run = ask([bakeCall(world, track, { store, checkpoints: true }), seekCall(world, track, store, SOUGHT)]);
    expect(run.problem, 'deep-physics bakes the head-on world into a store and seeks it to 0.5 s').toBe('');
    const [straight, sought] = [pairOf(run.replies[0]!, ORDERS[0]), run.replies[1]!];
    const failures = [
      ...restFailures(straight, ORDERS[0]),
      ...hollowHashes(straight.hashes, ORDERS[0]),
      ...(sought['from'] === SOUGHT ? [] : [`the seek to 0.5 s starts from step ${show(sought['from'])}, not from the checkpoint at step ${SOUGHT}`]),
      ...hashFailures(hashesOf(sought, 'the seek'), straight.hashes.slice(SOUGHT), SOUGHT, 'the world sought to 0.5 s and played on, against the straight run'),
    ];
    expect(failures, `the head-on world, straight and sought to 0.5 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} with the two bodies' priorities swapped, each run is the same by hash on a second run, and the point midway between them at rest moves by no more than two steps' walk, 0.0333 m`, () => {
    const calls = [bakeCall(headOnWorld(), headOnTrack()), bakeCall(headOnWorld(true), headOnTrack())];
    const [first, second] = [ask(calls), ask(calls)];
    expect(first.problem, 'a first deep-physics process bakes the head-on world as written and with its priorities swapped').toBe('');
    expect(second.problem, 'a second deep-physics process bakes both again').toBe('');
    const failures: string[] = [];
    if (first.replies[0]!['key'] === first.replies[1]!['key']) failures.push('INCONCLUSIVE: the world with its priorities swapped has the bake key of the world as written, so the swap reached nothing; this is not a pass');
    const pairs = ORDERS.map((order, i) => {
      const p = pairOf(first.replies[i]!, order);
      failures.push(
        ...restFailures(p, order),
        ...hollowHashes(p.hashes, order),
        ...hashFailures(p.hashes, hashesOf(second.replies[i]!, `${order}, on a second run`), 0, `${order}, its first run against its second`),
      );
      return p;
    });
    if (pairs.every((p) => missing(p, '').length === 0)) {
      const [m, n] = [midway(pairs[0]!, STEPS), midway(pairs[1]!, STEPS)];
      const moved = Math.hypot(m[0] - n[0], m[1] - n[1]);
      if (!(moved <= TWO_STEPS)) failures.push(`the point midway between ${GUARD} and ${HERO} at 3 s moves ${fmt(moved)} m when their priorities are swapped (from x ${fmt(m[0])} m to x ${fmt(n[0])} m), more than two steps' walk, ${fmt(TWO_STEPS)} m`);
    }
    expect(failures, `the head-on world as written and with its priorities swapped, each run twice:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
