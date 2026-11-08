// AC12: a step whose deadline runs out is an overran run, which counts as a failed run; one that waited on an
// environment that never came up makes its check BLOCKED with the cause, never FAIL (the run is missing); and a
// run that dies keeps what it captured.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkout, journey, journeyPath, journeyVariant, openWorld, runOptions, sleep, steps, storedPng, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

describe('AC12 #37.08d1098f a step past its deadline is an overran run (a failed run); a wait on an environment that never came up is missing, so BLOCKED with the cause, never FAIL; a run that dies keeps what it captured', () => {
  it('AC12 a step that goes to a route that never answers, with a 1500 ms deadline, is overran, naming the step, and ends near its deadline', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const file = journeyVariant(dir, 'cart-total', (doc) => {
      steps(doc).splice(1, 0, { id: 'hang', deadline: 1500, goto: '/hang' });
    }, 'cart-hang');
    const started = Date.now();
    const run = await runJourney(runOptions(world, dir, file));
    const elapsed = Date.now() - started;
    expect(run.outcome).toBe('overran');
    expect(run.steps.find((s) => s.id === 'hang')?.outcome).toBe('overran');
    expect(run.failures.some((f) => /hang/.test(f.test) || /hang/.test(f.message)), `the overrun names the step: ${JSON.stringify(run.failures)}`).toBe(true);
    expect(run.steps.find((s) => s.id === 'see-total')?.outcome, 'the steps after it never ran').toBe('unrun');
    expect(elapsed, 'the run ended on the step\'s deadline, not on a longer wait').toBeLessThan(30_000);
    expect(run.steps[0]!.screenshot, 'the step before it was captured').toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it('AC12 a stack whose health route never answers 200 leaves the run missing, with the cause naming the route, never failed; nothing of the journey ran', async () => {
    const { runJourney } = await journey();
    const dir = checkout(['unhealthy']);
    const run = await runJourney(runOptions(world, dir, journeyPath('cart-total')));
    expect(run.outcome, 'a wait on the environment is missing (BLOCKED), not failed').toBe('missing');
    expect(run.cause, 'the cause').toMatch(/health|503/);
    expect(run.steps.every((s) => s.outcome === 'unrun'), 'no step ran').toBe(true);
    expect(run.testsRun).toBe(0);
  }, 120_000);

  it('AC12 a run stopped partway (the hub going down, as its stop signal) ends stopped and keeps the screenshot of the step it had captured', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const file = journeyVariant(dir, 'cart-total', (doc) => {
      steps(doc).splice(1, 0, { id: 'linger', deadline: 20_000, goto: '/hang' });
    }, 'cart-linger');
    const stop = new AbortController();
    const running = runJourney(runOptions(world, dir, file, { stop: stop.signal }));
    await sleep(4000);
    stop.abort();
    const run = await running;
    expect(run.outcome).toBe('stopped');
    const open = run.steps.find((s) => s.id === 'open');
    expect(open?.outcome).toBe('passed');
    await storedPng(world, open!.screenshot, 'the captured step\'s screenshot');
    expect(run.evidence).toContain(open!.screenshot);
  }, 120_000);
});
