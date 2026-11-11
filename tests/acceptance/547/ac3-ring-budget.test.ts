// Criterion 3 (no upstream test): "A logic item that writes one byte in each of its 64 memory pages every step, so
// every checkpoint has one size, run 7,200 steps with a checkpoint every 60 steps and its ring's budget forced to
// 20 checkpoints' bytes, keeps the ring within that budget with checkpoints 480 steps apart, and seeks to 20 seeded
// steps each restore one at most 480 steps back and give the same full-state hashes and continuation probes as a
// straight run; a planted ring that drops its oldest checkpoint instead keeps none before step 6,060 and fails the
// first seek before it, naming the step"
//
// Through `deep-logic bake` (its seeks and probes, and this suite's `ring`; README). `bytes64` (programs.ts) writes
// a byte in each of its 64 pages every step, on a seeded nudge track. A 60-step bake gives one checkpoint's bytes B
// (checkpoints 0 and 60, whole and of pages, are the same size); the 7,200-step bake runs with checkpoint.budget
// 20 × B. Its ring ends within 20 × B, 480 steps apart (0, 480, …, 7,200: the spacing doubled three times), and 20
// seeded seeks each restore a checkpoint at most 480 steps before them and give playing's step hashes up to the next
// one, its full-state hash and a continuation probe's. With `ring_drops_oldest` the ring keeps its 20 newest
// checkpoints 60 apart, none before 6,060, and the first seek before 6,060 fails, naming its step.
import { describe, expect, it } from 'vitest';
import {
  AC, MIB, PAGE, TIMEOUT, bakeCall, bakeOf, checkCall, entryAt, judgeSeeks, logicBin, none, offsetOf, onMac, piece, prebuild, ringOf, seeded,
  seeksAndProbes, sliderTrack, type Entry, type JsonObject, type Planted,
} from './helpers.ts';
import { bytes64 } from './programs.ts';

prebuild(() => { logicBin(); bytes64(); });

const ID = 'bytes';
const EVERY = 60;
const STEPS = 7200;
const SPACING = 480;
const KEPT = 20;
const OLDEST_KEPT = STEPS - (KEPT - 1) * EVERY;   // 6,060
const track = (): Entry[] => sliderTrack('nudge', 547_03, STEPS, 100, 10);
const probeEntries = (s: number): Entry[] => [entryAt('nudge', s + 1, 7)];
const pieceOf = (budget: number): JsonObject => piece({
  seed: 547, controls: ['nudge'],
  items: { [ID]: { program: bytes64(), reads: ['nudge'], writes: { sum: { type: 'i32' } }, checkpoint: { every: EVERY, budget } } },
});
/** 20 seeded steps of the 7,200, in a seeded order. */
function targets(): number[] {
  const r = seeded(547_031);
  return Array.from({ length: 20 }, () => Math.floor(r() * STEPS));
}

/** One checkpoint's bytes, from a 60-step bake whose budget keeps both its checkpoints; both have that one size. */
function oneCheckpoint(planted: Planted[]): number {
  const [reply] = onMac([bakeCall(pieceOf(1024 * MIB), { steps: EVERY, track: track() })], planted);
  const ring = ringOf(reply!, 'the 60-step bake')[ID];
  expect(ring?.checkpoints.map((c) => [c.step, c.whole, c.pages.length, c.memory]), 'checkpoint 0 is whole and 60 holds pages: all 64 of them, 4 MiB each').toEqual([[0, true, 64, 64 * PAGE], [60, false, 64, 64 * PAGE]]);
  expect(ring!.checkpoints[1]!.bytes, 'every checkpoint has one size: 60 counts the bytes 0 does').toBe(ring!.checkpoints[0]!.bytes);
  return ring!.checkpoints[0]!.bytes;
}

describe(`${AC[3]} a ring past its budget doubles its spacing, and seeks restore within it`, () => {
  it(`${AC[3]} 7,200 steps with the ring's budget forced to 20 checkpoints' bytes keep it within that budget, 480 steps apart, and 20 seeded seeks restore one at most 480 steps back and equal playing`, () => {
    const [checked] = onMac([checkCall(pieceOf(64 * MIB))]);
    expect(offsetOf(checked!, ID, 'reads', 'nudge'), 'the nudge slider\'s slot is at offset 0 of the read region').toBe(0);
    expect(offsetOf(checked!, ID, 'writes', 'sum'), 'sum is at offset 0 of the write region').toBe(0);
    const one = oneCheckpoint([]);
    const budget = KEPT * one;
    const seeks = targets();
    const b = bakeOf(onMac([bakeCall(pieceOf(budget), { steps: STEPS, track: track(), ...seeksAndProbes(seeks, probeEntries, 20) })])[0]!, 'the 7,200-step bake');
    expect(b.traps, 'bytes64 never traps').toEqual([]);
    const ring = b.ring[ID]!;
    expect(ring.budget, 'the ring\'s budget is the forced 20 checkpoints\' bytes').toBe(budget);
    expect(ring.bytes, 'the ring counts its checkpoints\' bytes').toBe(ring.checkpoints.reduce((n, c) => n + c.bytes, 0));
    expect(ring.bytes, `the ring keeps within its budget of ${budget} bytes`).toBeLessThanOrEqual(budget);
    expect(ring.spacing, 'the ring\'s spacing is 480 steps').toBe(SPACING);
    expect(ring.checkpoints.map((c) => c.step), 'the ring\'s checkpoints are 480 steps apart, from 0 to 7,200').toEqual(Array.from({ length: STEPS / SPACING + 1 }, (_, i) => i * SPACING));
    expect(ring.checkpoints.filter((c) => c.bytes !== one).map((c) => `${c.step}: ${c.bytes}`), `every checkpoint has one size, ${one} bytes`).toEqual([]);
    none(judgeSeeks(b, ID, seeks, SPACING), 'each seek restores a checkpoint at most 480 steps back and gives playing\'s full-state hashes and continuation probes');
  }, TIMEOUT);

  it(`${AC[3]} a planted ring that drops its oldest checkpoint instead (ring_drops_oldest) keeps none before step 6,060 and fails the first seek before it, naming the step`, () => {
    const one = oneCheckpoint(['ring_drops_oldest']);
    const seeks = targets();
    const first = seeks.find((s) => s < OLDEST_KEPT);
    expect(first, 'a seeded seek lands before step 6,060').toBeDefined();
    const b = bakeOf(onMac([bakeCall(pieceOf(KEPT * one), { steps: STEPS, track: track(), ...seeksAndProbes(seeks, probeEntries, 20) })], ['ring_drops_oldest'])[0]!, 'the 7,200-step bake with ring_drops_oldest');
    const kept = b.ring[ID]!.checkpoints.map((c) => c.step);
    expect(kept.length, 'the planted ring keeps checkpoints').toBeGreaterThan(0);
    expect(kept.filter((k) => k < OLDEST_KEPT), 'the planted ring keeps none before step 6,060').toEqual([]);
    const failures = judgeSeeks(b, ID, seeks, SPACING);
    expect(failures.find((f) => f.startsWith(`seek to ${first}:`)), `the first seek before 6,060, to step ${first}, fails, naming its step: ${failures.slice(0, 5).join('; ')}`).toBeDefined();
    for (const s of seeks.filter((x) => x < OLDEST_KEPT)) expect(failures.some((f) => f.startsWith(`seek to ${s}:`)), `the seek to ${s}, before 6,060, fails`).toBe(true);
  }, TIMEOUT);
});
