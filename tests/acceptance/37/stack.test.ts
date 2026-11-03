// AC19: on the sample app, a journey on snapshot S1 ($18.00) passes on a stack that served S1, and its evidence
// and receipt line name S1's tree. The same journey, run after a planted environment swapped the stack's app to the
// newer snapshot S2 ($18.01) partway through, is uncounted, naming S2's tree and the process started from it; its
// screenshots stay in the record marked uncounted and never stand as the claim's evidence. A journey runner that
// records only the checkout it asked for reports that run as a FAIL of S1 and fails this test, naming the run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertionFails, checkout, journey, journeyPath, openWorld, planted, runOptions, trees, treeDigest, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

describe('AC19 #37.23f2f878 a journey on S1 passes on a stack that served S1, naming S1\'s tree; swapped to S2 partway it is uncounted naming S2\'s tree and its process, its screenshots marked uncounted; a runner recording only the checkout it asked for fails this test', () => {
  it('AC19 the cart journey passes on a stack started from S1, and its run and receipt line name S1\'s tree as served', async () => {
    const { runJourney, receiptFor } = await journey();
    const s1 = checkout();
    const run = await runJourney(runOptions(world, s1, journeyPath('cart-total')));
    expect(run.outcome).toBe('passed');
    expect(run.served.served, 'the stack served the checkout\'s tree').toBe('checkout');
    expect(run.tree, 'named by its digest').toBe(treeDigest(s1));
    const receipt = receiptFor(run, 'see-total');
    expect(receipt.line, 'the receipt line names S1\'s tree').toContain(treeDigest(s1).slice(0, 12));
    expect(run.steps.every((s) => s.screenshot), 'the screenshots stand as evidence').toBe(true);
  }, 120_000);

  const swappedIsUncounted = async (plant?: 'checkout-as-asked'): Promise<void> => {
    const { runJourney } = await journey();
    const s1 = checkout();
    const s2 = checkout(['s2']);
    // The planted environment swaps the stack's app to S2 once the first step has run, as a newer snapshot would.
    const o = runOptions(world, s1, journeyPath('cart-total'), { trees: trees(s1, [s2]), environment: { plant: 'swap-partway', to: s2 } });
    const run = await runJourney(plant ? planted(o, plant) : o);
    expect(run.outcome, `the run is uncounted, never a FAIL of S1: ${JSON.stringify(run.failures)}`).toBe('uncounted');
    expect(run.served.served).toBe('other');
    if (run.served.served === 'other') {
      expect(run.served.tree, 'naming S2\'s tree').toBe(s2);
      expect(run.served.kind).toBe('process');
      expect(run.served.named, 'and the process started from it').toMatch(/process .*\(pid \d+\)/);
    }
    for (const step of run.steps) if (step.screenshot) {
      const record = await world.evidence.get(step.screenshot);
      expect(record, 'the screenshot stays in the record').toBeDefined();
      expect(record!.kind, 'marked uncounted').toMatch(/uncounted/);
    }
    expect(run.evidence, 'the screenshots never stand as the claim\'s evidence').not.toEqual(expect.arrayContaining(run.steps.map((s) => s.screenshot).filter(Boolean)));
  };
  it('AC19 the same journey after the planted environment swapped the stack\'s app to S2 partway through is uncounted, naming S2\'s tree and its process; its screenshots stay, marked uncounted', () => swappedIsUncounted(), 180_000);

  it('AC19 (wrong program) a runner that records only the checkout it asked for reports the swapped run as a FAIL of S1 naming the run, and fails this test', async () => {
    const error = await assertionFails(() => swappedIsUncounted('checkout-as-asked'));
    expect(error.message).toMatch(/uncounted|FAIL/);
    const { runJourney } = await journey();
    const s1 = checkout();
    const s2 = checkout(['s2']);
    const r = await runJourney(planted(runOptions(world, s1, journeyPath('cart-total'), { trees: trees(s1, [s2]), environment: { plant: 'swap-partway', to: s2 } }), 'checkout-as-asked'));
    expect(r.outcome, 'the twin is that twin: it takes the checkout it asked for as served, so S2\'s $18.01 reads as S1 failing').toBe('failed');
    expect(r.served.served).toBe('checkout');
    expect(r.failures.map((f) => f.message).join('\n')).toMatch(/\$18\.00/);
  }, 240_000);
});
