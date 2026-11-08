// AC10: a latency check times the changed journeys on the branch and on the merge base, the same number of runs
// each, and fails when the branch is slower by more than your proof bar's margin, showing both times. Slow: each
// side runs the cart journey `runs` times against its own stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkout, journey, journeyPath, openWorld, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

describe('AC10 #37.892b5a33 a latency check times the changed journeys on the branch and the merge base, the same number of runs each, and fails past the margin showing both times', () => {
  it('AC10 a branch whose every page answers 400 ms late fails the latency check against the base at a 10% margin, with three runs a side and both times shown', async () => {
    const { latencyCheck } = await journey();
    const base = checkout();
    const head = checkout(['slow']);
    const result = await latencyCheck({ host: world.sup, evidence: world.evidence, journey: journeyPath('cart-total'), base, head, runs: 3, margin: '10%' });
    expect(result.base.length, 'three runs on the base').toBe(3);
    expect(result.head.length, 'three runs on the branch').toBe(3);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1]!;
    expect(median(result.head), 'the branch is slower: two pages, each 400 ms late').toBeGreaterThan(median(result.base) * 1.1);
    expect(result.outcome).toBe('failed');
    expect(result.shown, 'both times are shown').toMatch(new RegExp(`${Math.round(median(result.base))}|${median(result.base).toFixed(0)}`));
    expect(result.shown).toMatch(new RegExp(`${Math.round(median(result.head))}|${median(result.head).toFixed(0)}`));
  }, 600_000);

  it('AC10 the same build on both sides passes the check, with the same number of runs each', async () => {
    const { latencyCheck } = await journey();
    const result = await latencyCheck({ host: world.sup, evidence: world.evidence, journey: journeyPath('cart-total'), base: checkout(), head: checkout(), runs: 2, margin: '50%' });
    expect(result.base.length).toBe(2);
    expect(result.head.length).toBe(2);
    expect(result.outcome, `the same build isn't slower than itself past a 50% margin: ${result.shown}`).toBe('passed');
  }, 600_000);
});
