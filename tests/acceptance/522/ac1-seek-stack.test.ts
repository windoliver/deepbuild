// #522.e8dd3a56: "Seeking into a resting stack of 20 boxes from a checkpoint equals playing by step hash for the 600
// steps after it, and a planted checkpoint that keeps only poses and velocities fails that comparison, naming the first
// step and field that differ"
//
// The stack: 2 × 5 × 2 boxes 0.5 m on a side resting on a floor, sleep off, so every contact stays awake in the solver
// with its warm-start impulses (README: Worlds). It is baked 960 steps, a checkpoint every 60, into a store; `seek` to
// step 330 restores the ring's checkpoint at step 300, the nearest at or before it, and plays on to step 900: its step
// hashes from 300 through 900 (the 600 steps after the checkpoint) equal the bake's, and so do its states.
// `--planted checkpoint_poses_only` bakes and seeks the same in its own process and store; the judge that passes the
// real program fails it, naming the first step whose state differs and, at it, the first body and field.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, allStates, ask, bakeCall, caught, firstDiffering, firstStateDifference, hashesOf, keyOf, none, prebuild, scratch,
  seekCall, seekOf, stack, type Planted, type Seek, type State,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const STEPS = 960;
const TO = 330;
const FROM = 300;
const LAST = FROM + 600;
const PLAY = LAST - TO;
const STACK = stack(2, 5, 2, { solver: { sleep: { on: false } } });

interface Ran { key: string; straight: string[]; states: Record<string, State[]>; seek: Seek }
function ran(planted?: Planted): Ran {
  const store = scratch('ac1');
  const [baked, sought] = ask([bakeCall(STACK, [], STEPS, { store }), seekCall(STACK, [], STEPS, store, TO, PLAY)], planted ? { planted, where: planted } : {});
  const straight = hashesOf(baked, 'the stack\'s bake');
  expect(straight.length, 'the bake holds a step hash for the built state and each of its 960 steps').toBe(STEPS + 1);
  return { key: keyOf(baked!, 'the stack\'s bake'), straight, states: allStates(baked!, STEPS + 1, 'the stack\'s bake'), seek: seekOf(sought, LAST - FROM + 1, `the seek to step ${TO}`) };
}
/** Seek equals play: the checkpoint at or before the seek restored, and every step hash after it the straight run's; a failure names the first step, body and field that differ. */
function judge(r: Ran): string[] {
  const f: string[] = [];
  if (r.seek.from !== FROM) f.push(`the seek to step ${TO} restored step ${r.seek.from}, not the ring's checkpoint at step ${FROM}, the nearest at or before it`);
  const k = firstDiffering(r.straight.slice(r.seek.from, r.seek.from + r.seek.hashes.length), r.seek.hashes);
  if (k !== null) {
    const at = firstStateDifference(r.states, r.seek.bodies, r.seek.from, r.seek.from);
    f.push(`seeking doesn't equal playing: ${at ?? `step ${r.seek.from + k}: its step hash differs, though no state field does`}`);
  }
  return f;
}

describe(`${ID} seeking into a resting stack of 20 boxes from a checkpoint equals playing by step hash; a checkpoint of poses and velocities alone fails, naming the step and field`, () => {
  it(`${ID} a seek to step ${TO} restores the checkpoint at step ${FROM} and plays the 600 steps after it with the straight run's step hashes`, () => {
    const r = ran();
    expect(r.seek.key, 'the seek reads the bake kept under the stack\'s key').toBe(r.key);
    none(judge(r), 'the seek against the straight run');
    expect(r.seek.hashes, `step hashes ${FROM} to ${LAST}`).toEqual(r.straight.slice(FROM, LAST + 1));
  }, TIMEOUT);

  it(`${ID} a planted checkpoint that keeps only poses and velocities (checkpoint_poses_only) fails that comparison, naming the first step and field that differ`, () => {
    const failures = judge(ran('checkpoint_poses_only'));
    caught(failures, 'checkpoint_poses_only');
    expect(failures.some((x) => /step \d+: box_\d\d_\d\d_\d\d (pos|rot|linear|angular)\.[xyzw] /.test(x)), `the failure names the first step, body and field that differ: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
