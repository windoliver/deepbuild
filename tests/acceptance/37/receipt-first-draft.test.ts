// AC7's first draft, moved here unchanged from evidence.test.ts and kept by hand only: its precondition needs the
// cart journey's first step to take more than one frame, which a fast machine no longer gives (31–34 ms on the
// reference Mac). Its blind redraft, redraft-ac7/, runs in its place (README, Approved changes after the draft).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun } from '../../../packages/checks-journey/src/index.ts';
import { checkout, FRAME_MS, journey, journeyPath, openWorld, runOptions, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The cart journey on the working build, once per file: its run passes. */
let cart: { dir: string; run: JourneyRun } | undefined;
async function cartRun(): Promise<{ dir: string; run: JourneyRun }> {
  if (cart) return cart;
  const { runJourney } = await journey();
  const dir = checkout();
  const run = await runJourney(runOptions(world, dir, journeyPath('cart-total')));
  cart = { dir, run };
  return cart;
}

describe('AC7 #37.8b056f27 a receipt opens the journey\'s video within one frame of the checked step', () => {
  it('AC7 the video evidence carries each step\'s start and end, in order, and the receipt for see-total opens the video within one frame (1000/15 ms) of that step\'s start', async () => {
    const { receiptFor } = await journey();
    const { run } = await cartRun();
    const record = await world.evidence.get(run.video!);
    expect(record?.steps, 'the video carries its steps').toBeDefined();
    const recorded = record!.steps!;
    expect(recorded.map((s) => s.step)).toEqual(run.steps.map((s) => s.id));
    for (let i = 0; i < recorded.length; i++) {
      expect(recorded[i]!.endMs, `step ${recorded[i]!.step} ends after it starts`).toBeGreaterThanOrEqual(recorded[i]!.startMs);
      if (i) expect(recorded[i]!.startMs, 'steps follow each other in the video').toBeGreaterThanOrEqual(recorded[i - 1]!.endMs);
    }
    const seeTotal = recorded.find((s) => s.step === 'see-total')!;
    expect(seeTotal.startMs, 'the checked step starts after the first step, so a receipt at 0 would miss it').toBeGreaterThan(FRAME_MS);
    const receipt = receiptFor(run, 'see-total');
    expect(receipt.video).toBe(run.video);
    expect(Math.abs(receipt.atMs - seeTotal.startMs), `the receipt opens at ${receipt.atMs} ms, the step starts at ${seeTotal.startMs} ms`).toBeLessThanOrEqual(FRAME_MS);
  }, 120_000);
});
