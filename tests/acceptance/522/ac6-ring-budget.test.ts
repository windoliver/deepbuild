// #522.ab65f8d2: "A resting stack of 200 boxes stepped 7,200 steps with a checkpoint every 60 steps and its budget forced
// to 20 checkpoints' bytes keeps its ring within that budget, with checkpoints 480 steps apart, and seeks to 20 seeded
// steps each restore one at most 480 steps back and equal playing by step hash; a planted ring that drops its oldest
// checkpoint instead keeps none before step 6,060 and fails the first seek before it, naming the step"
//
// The stack: 5 × 8 × 5 boxes 0.5 m on a side resting on a floor (README: Worlds). "20 checkpoints' bytes" is 20 times
// the byte length of the stack's checkpoint at step 60, read from a 60-step bake with a ring too wide to thin (1 GiB).
// With a checkpoint every 60 steps the ring passes that budget at its 21st and doubles its spacing, to 120, 240 and
// then 480, where the 15 checkpoints 480 … 7,200 fit. The bake answers its ring (README: `ring`) and the checkpoints
// it keeps; the 20 seeks are to steps drawn by a generator seeded 522 from 480 … 7,200 (so each has a checkpoint at
// or before it on the real ring). `--planted ring_drops_oldest` keeps the newest 20 at spacing 60, 6,060 … 7,200.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, ask, bakeCall, caught, checkpointsOf, hashesOf, none, prebuild, ringOf, scratch, seededFrames, seekCall, seekOf, stack,
  type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[6];
const STEPS = 7200;
const EVERY = 60;
const KEEP = 20;
const SPACING = 480;
const FIRST_KEPT_BY_DROPPING = STEPS - (KEEP - 1) * EVERY; // 6,060
/** 20 distinct steps in 480 … 7,200, in the order the seeded generator draws them. */
const SEEKS = seededFrames(522, 20, STEPS - SPACING + 1).map((k) => k + SPACING - 1);

/** 20 checkpoints' bytes: twenty times the byte length of the stack's checkpoint at step 60. */
function budgetOf(planted?: Planted): number {
  const [probe] = ask([bakeCall(stack(5, 8, 5, { checkpoint: { every: EVERY, budget: 2 ** 30 } }), [], EVERY, { checkpoints: true, read: [] })], planted ? { planted } : {});
  const kept = checkpointsOf(probe, 'the 60-step bake');
  expect(kept.map((c) => c.step), 'the 60-step bake keeps its checkpoint at step 60').toEqual([EVERY]);
  return KEEP * kept[0]!.bytes;
}
interface Ran { budget: number; straight: string[]; ring: ReturnType<typeof ringOf>; kept: ReturnType<typeof checkpointsOf>; seeks: ReturnType<typeof seekOf>[] }
function ran(planted?: Planted): Ran {
  const budget = budgetOf(planted);
  const w = stack(5, 8, 5, { checkpoint: { every: EVERY, budget } });
  const store = scratch('ac6');
  const [baked, ...sought] = ask([bakeCall(w, [], STEPS, { store, checkpoints: true, read: [] }), ...SEEKS.map((s) => ({ ...seekCall(w, [], STEPS, store, s), read: [] }))], planted ? { planted, where: planted } : {});
  const straight = hashesOf(baked, 'the 200-box bake');
  expect(straight.length, 'the bake holds a step hash for the built state and each of its 7,200 steps').toBe(STEPS + 1);
  return {
    budget, straight, ring: ringOf(baked, 'the 200-box bake'), kept: checkpointsOf(baked, 'the 200-box bake'),
    seeks: sought.map((r, i) => {
      const s = SEEKS[i]!;
      const from = typeof r['from'] === 'number' ? r['from'] : s;
      return seekOf(r, s - from + 1, `seek ${i + 1}, to step ${s}`);
    }),
  };
}
/** Each seek, in order: it restores a checkpoint the ring keeps, at most 480 steps back, and its step hashes are the straight run's. */
function seekFailures(r: Ran): string[] {
  const kept = new Set(r.kept.map((c) => c.step));
  const f: string[] = [];
  r.seeks.forEach((sk, i) => {
    const s = SEEKS[i]!;
    const back = s - sk.from;
    if (!kept.has(sk.from) || back > SPACING || back < 0) f.push(`seek ${i + 1}, to step ${s}: it restored step ${sk.from}, ${back} steps back${kept.has(sk.from) ? '' : ', which the ring keeps no checkpoint at'}; a seek restores a checkpoint at most ${SPACING} steps back`);
    const want = r.straight.slice(sk.from, s + 1);
    const k = want.findIndex((h, j) => h !== sk.hashes[j]);
    if (k >= 0) f.push(`seek ${i + 1}, to step ${s}: its step hash at step ${sk.from + k} differs from playing`);
  });
  return f;
}

describe(`${ID} a 200-box stack's checkpoint ring keeps within a budget of 20 checkpoints' bytes, 480 steps apart, and every seek restores one at most 480 steps back`, () => {
  it(`${ID} the ring keeps within its budget with checkpoints ${SPACING} steps apart, and 20 seeded seeks each restore one at most ${SPACING} steps back and equal playing by step hash`, () => {
    const r = ran();
    expect(r.ring.budget, 'the ring\'s budget is the world\'s: 20 checkpoints\' bytes').toBe(r.budget);
    expect(r.ring.peak, `the ring never held more than its budget (${r.budget} bytes)`).toBeLessThanOrEqual(r.budget);
    expect(r.ring.bytes, 'the ring holds its checkpoints\' bytes').toBe(r.kept.reduce((n, c) => n + c.bytes, 0));
    expect(r.ring.bytes, 'and they are within its budget').toBeLessThanOrEqual(r.budget);
    expect(r.ring.every, `its spacing doubled to ${SPACING} steps`).toBe(SPACING);
    expect(r.kept.map((c) => c.step), `the checkpoints it keeps are ${SPACING} steps apart, ${SPACING} … ${STEPS}`).toEqual(Array.from({ length: STEPS / SPACING }, (_, i) => (i + 1) * SPACING));
    none(seekFailures(r), 'the 20 seeded seeks');
  }, TIMEOUT);

  it(`${ID} a planted ring that drops its oldest checkpoint instead (ring_drops_oldest) keeps none before step ${FIRST_KEPT_BY_DROPPING} and fails the first seek before it, naming the step`, () => {
    const r = ran('ring_drops_oldest');
    const before = r.kept.filter((c) => c.step < FIRST_KEPT_BY_DROPPING);
    expect(before.map((c) => c.step), `the planted ring keeps no checkpoint before step ${FIRST_KEPT_BY_DROPPING}`).toEqual([]);
    expect(r.kept.length, 'it keeps checkpoints').toBeGreaterThan(0);
    const first = SEEKS.findIndex((s) => s < FIRST_KEPT_BY_DROPPING);
    expect(first, `a seeded seek is to a step before ${FIRST_KEPT_BY_DROPPING}`).toBeGreaterThanOrEqual(0);
    const failures = seekFailures(r);
    caught(failures, 'ring_drops_oldest');
    expect(failures[0], `the first failure is the first seek before step ${FIRST_KEPT_BY_DROPPING}, naming its step ${SEEKS[first]}`).toMatch(new RegExp(`^seek ${first + 1}, to step ${SEEKS[first]}:`));
  }, TIMEOUT);
});
