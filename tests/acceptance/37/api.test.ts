// AC14: an API journey drives the running service with real requests, with no browser, and passes only on the end
// state it reads back from the real system.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertionFails, checkout, journey, journeyPath, openWorld, planted, runOptions, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

describe('AC14 #37.d6f5f71b an API journey drives the running service with real requests and passes only on the end state it reads back from the real system', () => {
  it('AC14 POST /api/cart then GET /api/cart: the journey passes on the working build, whose cart then totals $36.00, with no browser, no video and no screenshot', async () => {
    const { runJourney } = await journey();
    const run = await runJourney(runOptions(world, checkout(), journeyPath('cart-api')));
    expect(run.outcome, `the API journey passes: ${JSON.stringify(run.failures)}`).toBe('passed');
    expect(run.endState.find((e) => e.id === 'cart-holds-two')).toMatchObject({ outcome: 'passed', readback: { total: '$36.00' } });
    expect(run.video, 'no browser, so no video').toBeNull();
    expect(run.steps.every((s) => s.screenshot === null), 'and no screenshot').toBe(true);
    expect(run.steps.find((s) => s.id === 'add')?.outcome).toBe('passed');
  }, 120_000);

  const onlyTheEndStateCounts = async (plant?: 'end-state-only' | 'response-as-end-state'): Promise<void> => {
    const { runJourney } = await journey();
    // The planted service answers 200 to the POST but stores nothing: the response says yes, the system says no.
    const o = runOptions(world, checkout(['no-store']), journeyPath('cart-api'));
    const run = await runJourney(plant ? planted(o, plant) : o);
    expect(run.steps.find((s) => s.id === 'add')?.outcome, 'the request itself got its 200').toBe('passed');
    expect(run.outcome, 'the end state read back is $18.00, not $36.00: the journey fails').toBe('failed');
    expect(run.endState.find((e) => e.id === 'cart-holds-two')).toMatchObject({ outcome: 'failed', readback: { total: '$18.00' } });
    expect(run.failures.some((f) => f.assertion && /36\.00/.test(f.message))).toBe(true);
  };
  it('AC14 on the build whose POST answers 200 but stores nothing, the journey fails on the end state it reads back', () => onlyTheEndStateCounts(), 120_000);

  it('AC14 (wrong program) a runner that passes on the responses alone passes the planted service, and fails this test', async () => {
    const error = await assertionFails(() => onlyTheEndStateCounts('response-as-end-state'));
    expect(error.message).toMatch(/end state|failed|36\.00/);
  }, 120_000);
});
