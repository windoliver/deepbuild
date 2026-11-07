// AC15: a journey fails on the page's own errors, not only on what it shows. On the sample app, a journey whose end
// state passes but whose page threw an uncaught error at step 3, and one whose image request returned 404, each
// fail, naming the error or the URL and the step; the same errors declared expected are listed in the evidence and
// pass; a planted runner that reads only the end state passes the broken page and fails this test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun, JourneyRunOptions } from '../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, journey, journeyVariant, openWorld, planted, runOptions, type Doc, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** /errors: One, Two, Confirm; the end state is the Done status. On the error-step3 build, Confirm throws. */
const stepsJourney = (dir: string, expected?: Doc[]): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = 'three-steps';
  doc.steps = [
    { id: 'open', deadline: 10_000, goto: '/errors' },
    { id: 'one', deadline: 5000, click: { role: 'button', name: 'One' } },
    { id: 'two', deadline: 5000, click: { role: 'button', name: 'Two' } },
    { id: 'confirm', deadline: 5000, click: { role: 'button', name: 'Confirm' } },
  ];
  doc.end_state = [{ id: 'done', oracle: 'code', locator: { role: 'status', name: 'Done' }, text: 'Confirmed' }];
  if (expected) doc.expected_errors = expected;
}, 'three-steps');
/** /cart, whose end state passes; on the missing-image build its hero image's request answers 404. */
const imageJourney = (dir: string, expected?: Doc[]): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = 'cart-image';
  if (expected) doc.expected_errors = expected;
}, 'cart-image');

async function run(o: JourneyRunOptions): Promise<JourneyRun> {
  const { runJourney } = await journey();
  return runJourney(o);
}

describe('AC15 #37.8d57abb1 an uncaught error at step 3 and a 404 for an image each fail the journey naming the error or the URL and the step; declared expected they are listed and pass; a runner reading only the end state fails this test', () => {
  const uncaughtErrorFails = async (plant?: 'end-state-only'): Promise<void> => {
    const dir = checkout(['error-step3']);
    const o = runOptions(world, dir, stepsJourney(dir));
    const r = await run(plant ? planted(o, plant) : o);
    expect(r.endState.find((e) => e.id === 'done')?.outcome, 'the end state itself passes').toBe('passed');
    expect(r.outcome, 'the page\'s own error fails the journey').toBe('failed');
    const confirm = r.steps.find((s) => s.id === 'confirm')!;
    expect(confirm.outcome, 'the step the error happened in').toBe('failed');
    expect(confirm.errors.some((e) => e.kind === 'uncaught' && /boom at step 3/.test(e.message)), `the step records the uncaught error: ${JSON.stringify(confirm.errors)}`).toBe(true);
    expect(r.failures.some((f) => /boom at step 3/.test(f.message) && /confirm/.test(`${f.test} ${f.message}`)), `the failure names the error and the step: ${JSON.stringify(r.failures)}`).toBe(true);
    expect(r.steps.filter((s) => s.id !== 'confirm').every((s) => s.errors.length === 0), 'no other step records it').toBe(true);
  };
  it('AC15 an uncaught error thrown at the third step fails the journey, naming the error and the step, though the end state passes', () => uncaughtErrorFails(), 120_000);

  it('AC15 an image request that answered 404 fails the journey, naming the URL and the step it loaded in, though the end state passes', async () => {
    const dir = checkout(['missing-image']);
    const r = await run(runOptions(world, dir, imageJourney(dir)));
    expect(r.endState.find((e) => e.id === 'total-shown')?.outcome).toBe('passed');
    expect(r.outcome).toBe('failed');
    const open = r.steps.find((s) => s.id === 'open')!;
    expect(open.errors.some((e) => e.kind === 'request' && /\/img\/missing\.png$/.test(e.url) && e.status === 404), `the step records the failed request: ${JSON.stringify(open.errors)}`).toBe(true);
    expect(r.failures.some((f) => /\/img\/missing\.png/.test(f.message) && /open/.test(`${f.test} ${f.message}`)), `the failure names the URL and the step: ${JSON.stringify(r.failures)}`).toBe(true);
  }, 120_000);

  it('AC15 the same errors declared expected by the journey are listed in its evidence and the journey passes; an error not declared still fails', async () => {
    const dir = checkout(['error-step3', 'missing-image']);
    const expected = [{ step: 'confirm', message: 'boom at step 3' }];
    const r = await run(runOptions(world, dir, stepsJourney(dir, expected)));
    expect(r.outcome, `the declared error is expected: ${JSON.stringify(r.failures)}`).toBe('passed');
    expect(r.expectedErrors.some((e) => e.kind === 'uncaught' && /boom at step 3/.test(e.message) && e.step === 'confirm'), `listed in the evidence: ${JSON.stringify(r.expectedErrors)}`).toBe(true);
    const image = await run(runOptions(world, dir, imageJourney(dir, [{ step: 'open', url: '/img/missing.png', status: 404 }])));
    expect(image.outcome, `the declared 404 is expected: ${JSON.stringify(image.failures)}`).toBe('passed');
    expect(image.expectedErrors.some((e) => e.kind === 'request' && /missing\.png/.test(e.url) && e.step === 'open')).toBe(true);
    const wrongStep = await run(runOptions(world, dir, imageJourney(dir, [{ step: 'see-total', url: '/img/missing.png', status: 404 }])));
    expect(wrongStep.outcome, 'declared for another step, the 404 still fails the step it happened in').toBe('failed');
  }, 180_000);

  it('AC15 (wrong program) a planted runner that reads only the end state passes the broken page, and fails this test', async () => {
    const error = await assertionFails(() => uncaughtErrorFails('end-state-only'));
    expect(error.message).toMatch(/own error|failed|boom/);
  }, 120_000);
});
