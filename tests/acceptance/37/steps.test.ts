// AC21: each step records its route, with IDs, tokens and timestamps in the path or query read as one placeholder,
// and the controls that appeared, went away or changed state, by role, name and test ID; a replayed step matches
// only when at least one of those changes happened during it, and the first step whose route or changes differ from
// the last PASS is the one a regression names. AC22: a saved journey replayed against the stack is a real run at
// journey depth; one answered from a recording is a recorded run, which can't pass a live-depth requirement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun } from '../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, journey, journeyPath, openWorld, planted, runOptions, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

let passes: JourneyRun[] | undefined;
/** Two passing checkout runs, on two stacks: their order IDs differ. */
async function twoPasses(): Promise<JourneyRun[]> {
  if (passes) return passes;
  const { runJourney } = await journey();
  passes = [];
  for (let i = 0; i < 2; i++) {
    const run = await runJourney(runOptions(world, checkout(), journeyPath('checkout')));
    expect(run.outcome, `checkout run ${i + 1} passes: ${JSON.stringify(run.failures)}`).toBe('passed');
    passes.push(run);
  }
  return passes;
}

describe('AC21 #37.38cbc4c5 each step records its route with IDs as one placeholder and the controls that appeared, left or changed; a second passing checkout whose only difference is the order ID names no step, one with the Pay button gone names the Pay step, and a comparison by raw URL fails this test', () => {
  it('AC21 the confirmation step\'s route reads /order/{id}, with the order ID as a placeholder; the pay step recorded the Pay button and the Order status that appeared', async () => {
    const [first] = await twoPasses();
    const confirmed = first!.steps.find((s) => s.id === 'confirmed')!;
    expect(confirmed.route, 'the ID in the path is one placeholder').toMatch(/^\/order\/\{[a-z_]+\}$/);
    expect(confirmed.route).not.toMatch(/[0-9a-f]{12}/);
    const open = first!.steps.find((s) => s.id === 'open')!;
    expect(open.route).toBe('/cart');
    expect(open.controls.appeared, 'the controls that appeared on the cart page, by role and name').toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'button', name: 'Pay' }), expect.objectContaining({ role: 'button', name: 'Add tea' }),
    ]));
    const pay = first!.steps.find((s) => s.id === 'pay')!;
    const changes = [...pay.controls.appeared, ...pay.controls.left, ...pay.controls.changed, ...confirmed.controls.appeared];
    expect(changes.some((c) => c.role === 'status' && c.name === 'Order'), 'the Order status appeared in the pay step or the one after').toBe(true);
    expect(pay.controls.left.some((c) => c.role === 'button' && c.name === 'Pay') || confirmed.controls.left.some((c) => c.role === 'button' && c.name === 'Pay'), 'the Pay button went away').toBe(true);
  }, 240_000);

  const comparesByPlaceholderAndControls = async (plant?: 'raw-url'): Promise<void> => {
    const { runJourney, compareSteps } = await journey();
    const [first, second] = await twoPasses();
    const same = compareSteps(first!, second!, plant ? { plant } : {});
    expect(same.step, `a second run whose only difference is the order ID names no step: ${JSON.stringify(same)}`).toBeNull();
    const gone = await runJourney(runOptions(world, checkout(['no-pay']), journeyPath('checkout')));
    expect(gone.outcome).not.toBe('passed');
    const differs = compareSteps(first!, gone, plant ? { plant } : {});
    expect(differs.step, 'with the Pay button gone, the Pay step is the first that differs').toBe('pay');
    expect(differs.why).toMatch(/Pay/);
  };
  it('AC21 a second passing checkout names no step; the same run with the Pay button gone names the Pay step', () => comparesByPlaceholderAndControls(), 240_000);

  it('AC21 (wrong program) a comparison by raw URL names the confirmation step on the order ID, and fails this test', async () => {
    const error = await assertionFails(() => comparesByPlaceholderAndControls('raw-url'));
    expect(error.message).toMatch(/names no step|confirmed|order/i);
    const { compareSteps } = await journey();
    const [first, second] = await twoPasses();
    expect(compareSteps(first!, second!, { plant: 'raw-url' }).step, 'the twin is that twin').toBe('confirmed');
  }, 240_000);
});

describe('AC22 #37.9ea050d3 a saved journey replayed against the stack is a real run at journey depth; one answered from a recording is a recorded run that can\'t pass a live-depth requirement; a rule treating every replay as recorded fails this test', () => {
  const replayIsReal = async (plant?: 'every-replay-recorded'): Promise<void> => {
    const { runJourney, replayJourney, requirementCover } = await journey();
    const dir = checkout();
    const saved = await runJourney(runOptions(world, dir, journeyPath('checkout')));
    expect(saved.outcome).toBe('passed');
    expect(saved.script, 'a passing journey is saved as a replayable script').toMatch(/^[0-9a-f]{64}$/);
    const script = Buffer.from(await world.evidence.read(saved.script!)).toString('utf8');
    expect(script, 'a plain Playwright script').toMatch(/getByRole\(/);
    expect(script, 'never a CSS path').not.toMatch(/locator\('#|querySelector/);
    const o = runOptions(world, checkout(), journeyPath('checkout'));
    const replayed = await replayJourney({ ...(plant ? planted(o, plant) : o), script: saved.script! });
    expect('status' in replayed && replayed.status === 'refused' ? replayed.reason : 'ran', 'a replay against the stack runs').toBe('ran');
    const run = replayed as JourneyRun;
    expect(run.outcome, `the replay passes: ${JSON.stringify(run.failures)}`).toBe('passed');
    expect(run.recorded, 'a replay against the deployed server is a real run').toBe(false);
    expect(run.depth).toBe('journey');
    const live = requirementCover(run, { req: 'paying places an order on the deployed server', depth: 'live', oracle: 'code' });
    expect(live.wouldBe, 'it passes a live-depth requirement').toBe('PASS');
  };
  it('AC22 a saved checkout replayed against the stack passes a live-depth requirement, as a real run at journey depth', () => replayIsReal(), 240_000);

  it('AC22 the same script with its responses served from a recording is refused for a live-depth requirement, naming the depth', async () => {
    const { runJourney, replayJourney, requirementCover } = await journey();
    const saved = await runJourney(runOptions(world, checkout(), journeyPath('checkout')));
    expect(saved.outcome).toBe('passed');
    expect(saved.recording, 'the run\'s requests and responses are recorded').toMatch(/^[0-9a-f]{64}$/);
    const replayed = await replayJourney({ ...runOptions(world, checkout(), journeyPath('checkout')), script: saved.script!, recording: saved.recording! });
    if ('status' in replayed && replayed.status === 'refused') {
      expect(replayed.reason, 'refused naming the depth').toMatch(/live/);
    } else {
      const run = replayed as JourneyRun;
      expect(run.recorded, 'a run answered from a recording is a recorded run').toBe(true);
      const live = requirementCover(run, { req: 'paying places an order on the deployed server', depth: 'live', oracle: 'code' });
      expect(live.wouldBe, 'which can\'t pass a live-depth requirement').not.toBe('PASS');
      expect(live.reasons.join('\n'), 'naming the depth').toMatch(/live|recorded/);
    }
  }, 240_000);

  it('AC22 (wrong program) a rule that treats every replay as recorded fails this test on the first', async () => {
    const error = await assertionFails(() => replayIsReal('every-replay-recorded'));
    expect(error.message).toMatch(/real run|recorded|live/);
  }, 240_000);
});
