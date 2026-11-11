// Criterion 5 (no upstream test): "With one checkpoint's store planted to fail, the next checkpoint holds the pages
// of both intervals, and a restore from it gives the same deep hash as a straight run"
//
// Through `deep-logic bake` (its restores, and this suite's `ring`; README). `intervals` (programs.ts) writes page 4
// in steps 0 to 59, page 5 in 60 to 119, page 6 in 120 to 179 and so on, besides page 0. With
// `store_fails_at_step_120` the store of checkpoint 120 fails: the ring has no checkpoint 120, checkpoint 180 holds
// pages 0, 5 and 6 (both intervals' pages), checkpoint 240 holds 0 and 7 again (the record clears once a store
// succeeds), and a restore from 180 gives the straight run's full-state hashes at 180, 240 and 300, its step hashes
// and its arrays. Without the plant, 120 holds 0 and 5 and 180 holds 0 and 6, and playing is the same.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, checkCall, deepAt, firstDiff, logicBin, offsetOf, onMac, piece, prebuild, rows, type JsonObject } from './helpers.ts';
import { intervalPage, intervals } from './programs.ts';

prebuild(() => { logicBin(); intervals(); });

const ID = 'iv';
const STEPS = 300;
const pieceOf = (): JsonObject => piece({ seed: 547, items: { [ID]: { program: intervals(), writes: { tick: { type: 'i32' } } } } });
const pagesOf = (b: ReturnType<typeof bakeOf>, step: number): number[] | undefined => b.ring[ID]?.checkpoints.find((c) => c.step === step)?.pages;

describe(`${AC[5]} the record of written pages clears only once a checkpoint is stored`, () => {
  it(`${AC[5]} with checkpoint 120's store planted to fail (store_fails_at_step_120), checkpoint 180 holds the pages of both intervals, and a restore from it gives the straight run's deep hash`, () => {
    const [checked] = onMac([checkCall(pieceOf())]);
    expect(offsetOf(checked!, ID, 'writes', 'tick'), 'tick is at offset 0 of the write region').toBe(0);
    expect([intervalPage(59), intervalPage(60), intervalPage(119), intervalPage(120), intervalPage(179), intervalPage(180)], 'each 60-step interval writes its own page').toEqual([4, 5, 5, 6, 6, 7]);

    const planted = bakeOf(onMac([bakeCall(pieceOf(), { steps: STEPS, restores: [{ from: 180, steps: 120 }] })], ['store_fails_at_step_120'])[0]!, 'the bake with store_fails_at_step_120');
    expect(planted.traps, 'intervals never traps').toEqual([]);
    expect(planted.ring[ID]!.checkpoints.map((c) => [c.step, c.whole]), 'the ring holds no checkpoint 120, whose store failed; 0 is whole, the rest pages').toEqual([[0, true], [60, false], [180, false], [240, false], [300, false]]);
    expect(pagesOf(planted, 60), 'checkpoint 60 holds page 0 and page 4, written in steps 0 to 59').toEqual([0, 4]);
    expect(pagesOf(planted, 180), 'checkpoint 180 holds the pages of both intervals, 60 to 119 (page 5) and 120 to 179 (page 6), with page 0').toEqual([0, 5, 6]);
    expect(pagesOf(planted, 240), 'once 180 is stored the record clears: checkpoint 240 holds page 0 and page 7').toEqual([0, 7]);

    const [restore] = planted.restores;
    expect(restore?.from, 'the restore is from checkpoint 180').toBe(180);
    const at = (restore!.checkpoints[ID] ?? []).map((c) => `${c.step} ${c.deep_hash}`);
    expect(at, 'the restore from 180 gives the straight run\'s full-state hashes at 180, 240 and 300').toEqual([180, 240, 300].map((k) => `${k} ${deepAt(planted, ID, k) ?? 'none'}`));
    expect(firstDiff(rows(restore!.steps, ID), rows(planted.steps.filter((s) => s.step >= 180), ID)), 'the restore from 180 gives the straight run\'s step hashes and arrays').toBeNull();

    const straight = bakeOf(onMac([bakeCall(pieceOf(), { steps: STEPS })])[0]!, 'the bake without the plant');
    expect(straight.ring[ID]!.checkpoints.map((c) => c.step), 'without the plant the ring holds every checkpoint').toEqual([0, 60, 120, 180, 240, 300]);
    expect([pagesOf(straight, 120), pagesOf(straight, 180)], 'without the plant, 120 holds pages 0 and 5, and 180 pages 0 and 6').toEqual([[0, 5], [0, 6]]);
    expect([180, 240, 300].map((k) => deepAt(planted, ID, k)), 'the planted store changes no full-state hash of playing').toEqual([180, 240, 300].map((k) => deepAt(straight, ID, k)));
  }, TIMEOUT);
});
