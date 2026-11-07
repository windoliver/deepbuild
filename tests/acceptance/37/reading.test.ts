// AC20: an end-state assertion whose oracle is a model reads only its requirement and the step's redacted screen
// (the text snapshot of roles, names and values, and a screenshot only when none of the run's screenshots is marked
// incomplete), never the steps before it, the working agent's words or another model's account. It is a reading and
// never one of the assertions a check names: a false reading that quotes screen text found in the snapshot can send
// the claim back; a requirement it alone covers is INCONCLUSIVE with one taste ask that shows the screenshot beside
// the reading, never PASS; a false reading whose quote isn't in the snapshot is dropped and counted; a runner that
// counts a true reading as a pass fails this test. The model is a fake the test supplies; never a real one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun } from '../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, fakeModel, journey, journeyVariant, openWorld, planted, runOptions, testSecret, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const REQUIREMENT = 'the cart total reads $18.00';
/** The cart journey with a model reading beside its code checks (or alone, `only`). */
const readingJourney = (dir: string, only: boolean): string => journeyVariant(dir, 'cart-total', (doc) => {
  const reading = { id: 'looks-right', oracle: 'model', requirement: REQUIREMENT };
  doc.end_state = only ? [reading] : [...(doc.end_state as unknown[]), reading];
  if (only) doc.journey = 'cart-reading-only';
}, only ? 'cart-reading-only' : 'cart-total');
const reading = (run: JourneyRun) => run.endState.find((e) => e.id === 'looks-right');

describe('AC20 #37.51b3f942 a model reading reads only its requirement and the step\'s redacted screen, is never a named assertion, sends back on a quote found in the snapshot, leaves a requirement it alone covers INCONCLUSIVE with one taste ask, drops a quote not in the snapshot, and a runner counting it as a pass fails this test', () => {
  it('AC20 the model is given the requirement, the end step\'s text snapshot (roles, names, values) and the screenshot, and nothing else: no earlier step, no agent words, no other account', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const model = fakeModel(() => ({ answer: true, quote: '$18.00' }));
    const run = await runJourney(runOptions(world, dir, readingJourney(dir, false), { model }));
    expect(run.outcome).toBe('passed');
    expect(model.inputs.length, 'read once').toBe(1);
    const input = model.inputs[0]!;
    expect(Object.keys(input).sort(), 'only the requirement and the screen').toEqual(['requirement', 'screenshot', 'snapshot']);
    expect(input.requirement).toBe(REQUIREMENT);
    expect(input.snapshot, 'the snapshot holds the end step\'s roles, names and values').toMatch(/status.*Total.*\$18\.00|Total[\s\S]*\$18\.00/);
    expect(input.snapshot, 'never the steps before it').not.toMatch(/open|see-total|goto/);
    expect(input.screenshot, 'a screenshot, since no screenshot of the run is incomplete').toBeInstanceOf(Uint8Array);
    expect(reading(run)?.outcome, 'the reading is a reading, never passed').toBe('reading');
  }, 120_000);

  it('AC20 after a secret typed into a plain field, the model gets the snapshot and no screenshot', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const file = journeyVariant(dir, 'login', (doc) => {
      doc.end_state = [...(doc.end_state as unknown[]), { id: 'looks-right', oracle: 'model', requirement: 'the page says Signed in' }];
    });
    const model = fakeModel(() => ({ answer: true, quote: 'Signed in' }));
    const run = await runJourney(runOptions(world, dir, file, { model, secrets: { TEST_PASSWORD: testSecret() } }));
    expect(run.outcome).toBe('passed');
    expect(model.inputs[0]?.screenshot, 'no screenshot: one of the run\'s is incomplete').toBeNull();
    expect(model.inputs[0]?.snapshot).toMatch(/Signed in/);
  }, 120_000);

  const readingNeverPasses = async (plant?: 'reading-as-pass'): Promise<void> => {
    const { runJourney, requirementCover } = await journey();
    // The broken build: the model says true of a page that shows $18.01.
    const dir = checkout(['s2']);
    const model = fakeModel(() => ({ answer: true, quote: '$18.01' }));
    const o = runOptions(world, dir, readingJourney(dir, true), { model });
    const run = await runJourney(plant ? planted(o, plant) : o);
    expect(run.outcome, 'with no code check, nothing passed: the run ran no assertion it could count').not.toBe('passed');
    expect(reading(run)?.outcome).toBe('reading');
    const cover = requirementCover(run, { req: REQUIREMENT, depth: 'journey', oracle: 'code' }, plant ? { plant } : {});
    expect(cover.counted, 'no counted check covers the requirement').toEqual([]);
    expect(cover.wouldBe, 'a requirement a reading alone covers is INCONCLUSIVE, never PASS').toBe('INCONCLUSIVE');
    expect(cover.ask, 'with one taste ask').toMatchObject({ kind: 'taste' });
    expect(cover.ask?.screenshot, 'that shows the screenshot').toMatch(/^[0-9a-f]{64}$/);
    expect(cover.ask?.reading, 'beside the reading').toMatch(/\$18\.01|true/);
  };
  it('AC20 a planted journey whose only end-state check is a model reading that says true on the broken build leaves its claim INCONCLUSIVE with one taste ask', () => readingNeverPasses(), 120_000);

  it('AC20 a false reading whose quote is in the snapshot sends the claim back; one whose quote isn\'t there is dropped and counted', async () => {
    const { runJourney, requirementCover } = await journey();
    const dir = checkout();
    const found = fakeModel(() => ({ answer: false, quote: '$18.00' }));
    const sendBack = await runJourney(runOptions(world, dir, readingJourney(dir, false), { model: found }));
    expect(sendBack.endState.filter((e) => e.oracle === 'code').every((e) => e.outcome === 'passed'), 'the code checks pass').toBe(true);
    expect(reading(sendBack)).toMatchObject({ outcome: 'reading', reading: { answer: false, found: true, sendBack: true } });
    expect(requirementCover(sendBack, { req: REQUIREMENT, depth: 'journey', oracle: 'code' }).sendBack, 'the claim goes back').toBe(true);
    const invented = fakeModel(() => ({ answer: false, quote: 'Total $99.99' }));
    const dropped = await runJourney(runOptions(world, dir, readingJourney(dir, false), { model: invented }));
    expect(reading(dropped)).toMatchObject({ outcome: 'reading', reading: { answer: false, found: false, counted: true, sendBack: false } });
    expect(dropped.outcome, 'a dropped reading changes nothing: the code checks passed').toBe('passed');
    expect(requirementCover(dropped, { req: REQUIREMENT, depth: 'journey', oracle: 'code' }).sendBack).toBe(false);
  }, 180_000);

  it('AC20 (wrong program) a runner that counts a true reading as a pass fails this test', async () => {
    const error = await assertionFails(() => readingNeverPasses('reading-as-pass'));
    expect(error.message).toMatch(/passed|INCONCLUSIVE|counted/);
  }, 120_000);
});
