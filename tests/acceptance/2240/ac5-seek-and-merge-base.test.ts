// #2240.e07f41f3: "The 45° world sought to 1.5 s and played on gives the same step hashes as a straight run, and every
// world with no `centre_of_mass` gives step hashes byte-identical to the merge base's"
//
// The 45° world is criterion 1's box with `centre_of_mass: (0, −0.75, 0)` on the 45° slope, sleep off, a checkpoint
// every 70 steps. It is baked 3 s into a store; `seek` (#522's call) to step 180 restores the ring's checkpoint at step
// 140, steps to 180 and plays on to step 360, and its step hashes from 140 through 360 are the straight run's. The
// comparison isn't vacuous: the same world with no `centre_of_mass` topples, and from step 180 on none of its step
// hashes is the standing box's, so a seek that lost the centre would show.
//
// "Every world" is held by worlds this suite writes with no `centre_of_mass` (README: The fixtures): criterion 1's box
// on the 20° and 33° slopes and on level ground, the bar, #251's lap (a vehicle body) and eight worlds drawn from
// recorded seeds, whose bodies hold one shape or two and declare their mass or leave it to their shapes. Each one's
// step hashes on this checkout's release build are the same strings as on the merge base's (`git merge-base HEAD
// origin/main`, exported by `git archive` and built apart by #191's `mergeBasePhysics`). That isn't vacuous either: on
// this checkout the 33° world gives other step hashes once it writes the field.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, FIELD, LAP_STEPS, LAP_TRACK, LOW, TIMEOUT, ask, bakeCall, barWorld, drawnWorld, firstDiffering, hashesOf, lapWorld, none, onBase,
  prebuildBuilds, scratch, seekCall, seekOf, standWorld, stepAt, withBase, type JsonObject,
} from './helpers.ts';

prebuildBuilds(['release']);
withBase();

const ID = CRITERIA[5];
const STEPS = stepAt(3);
const TO = stepAt(1.5);
const EVERY = 70;
const FROM = 140;

/** A world with no `centre_of_mass`, the steps it is baked and its input track. */
interface Case { name: string; world: JsonObject; steps: number; track?: JsonObject[] }
const SEEDS = [224001, 224002, 224003, 224004, 224005, 224006, 224007, 224008];
const SLOPE_33: Case = { name: 'the box on the 33° slope', world: standWorld(33), steps: STEPS };
const CASES: Case[] = [
  { name: 'the box on the 20° slope', world: standWorld(20), steps: STEPS },
  SLOPE_33,
  { name: 'the box on level ground', world: standWorld(0), steps: stepAt(1) },
  { name: 'the bar', world: barWorld(), steps: stepAt(5) },
  { name: '#251\'s lap', world: lapWorld(), steps: LAP_STEPS, track: LAP_TRACK },
  ...SEEDS.map((seed) => ({ name: `the world drawn from seed ${seed}`, world: drawnWorld(seed), steps: stepAt(2) })),
];
const bakeOf = (c: Case): JsonObject => bakeCall(c.world, c.track ?? [], c.steps, { read: [] });

describe(`${ID} seeking equals playing with a centre_of_mass written, and worlds without one run as they did on the merge base`, () => {
  it(`${ID} the 45° world sought to 1.5 s and played on gives the same step hashes as a straight run`, () => {
    const tilted = standWorld(45, LOW, { checkpoint: { every: EVERY } });
    const store = scratch('ac5');
    const [baked, sought, toppling] = ask([
      bakeCall(tilted, [], STEPS, { store, read: [] }),
      seekCall(tilted, [], STEPS, store, TO, STEPS - TO),
      bakeCall(standWorld(45, undefined, { checkpoint: { every: EVERY } }), [], STEPS, { read: [] }),
    ]);
    const straight = hashesOf(baked, 'the 45° world\'s straight run');
    expect(straight.length, 'the straight run holds a step hash for the built state and each of its 360 steps').toBe(STEPS + 1);
    const seek = seekOf(sought, STEPS - FROM + 1, `the seek to step ${TO}`);
    expect(seek.from, `the seek to 1.5 s (step ${TO}) restores the ring's checkpoint at step ${FROM}, the nearest at or before it`).toBe(FROM);
    const k = firstDiffering(straight.slice(FROM), seek.hashes);
    console.log(`the 45° world: ${seek.hashes.length} step hashes after the seek, from step ${seek.from}; the last is ${String(seek.hashes.at(-1))} and the straight run's ${String(straight.at(-1))}`);
    none(k === null ? [] : [`step ${FROM + k}: the step hash is ${String(seek.hashes[k])} after the seek and ${String(straight[FROM + k])} in the straight run`], 'the seek against the straight run');
    // Not vacuous: with no centre_of_mass the box topples, and none of its step hashes from 1.5 s on is the standing box's.
    const bare = hashesOf(toppling, 'the 45° world with no centre_of_mass');
    const shared = straight.flatMap((h, step) => (step >= TO && h === bare[step] ? [step] : []));
    expect(shared, 'the steps from 180 on whose hash the standing box shares with the box that topples with no centre_of_mass').toEqual([]);
  }, TIMEOUT);

  it(`${ID} every world with no centre_of_mass gives step hashes byte-identical to the merge base's`, () => {
    expect(CASES.filter((c) => JSON.stringify(c.world).includes(FIELD)).map((c) => c.name), 'no world of the comparison writes centre_of_mass (its premise)').toEqual([]);
    const here = ask(CASES.map(bakeOf));
    const { sha, replies: there } = onBase(CASES.map(bakeOf));
    const base = sha.slice(0, 12);
    let total = 0;
    const failures = CASES.flatMap((c, i) => {
      const [a, b] = [hashesOf(here[i], `${c.name} here`), hashesOf(there[i], `${c.name} on the merge base ${base}`)];
      total += a.length;
      if (a.length !== c.steps + 1) return [`${c.name}: ${a.length} step hashes here, not one for the built state and each of its ${c.steps} steps`];
      const k = firstDiffering(a, b);
      return k === null ? [] : [`${c.name}: the step hash at step ${k} is ${String(a[k])} here and ${String(b[k])} on the merge base ${base} (${a.length} and ${b.length} hashes)`];
    });
    console.log(`${CASES.length} worlds with no centre_of_mass, ${total} step hashes here: ${failures.length ? `${failures.length} worlds differ from` : 'each the same string as on'} the merge base ${base}`);
    none(failures, 'the step hashes of worlds with no centre_of_mass against the merge base\'s');
    // Not vacuous: on this checkout the 33° world gives other step hashes once it writes the field, where its box stands.
    const [written] = ask([bakeOf({ ...SLOPE_33, world: standWorld(33, LOW) })]);
    const low = hashesOf(written, 'the box on the 33° slope with centre_of_mass (0, −0.75, 0)');
    const bare = hashesOf(here[CASES.indexOf(SLOPE_33)], `${SLOPE_33.name} here`);
    expect(low.length, 'the 33° world that writes the field holds as many step hashes').toBe(bare.length);
    expect(low.at(-1), 'after 3 s the 33° world that writes centre_of_mass has another step hash than the one that doesn\'t').not.toBe(bare.at(-1));
  }, 4 * TIMEOUT);
});
