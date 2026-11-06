// Nothing a journey names goes unrun and passes (#37, review of PR #1153): a hover is driven, a key the runner doesn't
// know is refused rather than skipped, an API journey's step without a request or end-state check without a readback
// is refused, and a run whose end state holds only readings (a model's or a person's) is never passed.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkout, fakeModel, journey, journeyVariant, openWorld, runOptions, type World } from '../../../tests/acceptance/37/helpers.ts';
import { parseJourney, reviewJourney } from '../src/journey.ts';
import { saveScript } from '../src/replay.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const END = `end_state:
  - id: shown
    oracle: code
    locator: { role: status, name: Total }
`;
const reasons = (text: string): string[] => { const r = reviewJourney(text); return r.ok ? [] : r.reasons; };

it('drives a hover step, and saves it as a hover', () => {
  const text = `journey: menu
steps:
  - id: point
    deadline: 5000
    hover: { role: button, name: Menu }
${END}`;
  const j = parseJourney(text);
  expect(j.steps[0]!.actions).toEqual([{ line: 5, hover: { role: 'button', name: 'Menu' } }]);
  expect(saveScript(j, text, {})).toContain(`await page.getByRole("button", { name: "Menu" }).hover();`);
});

it('refuses a step or end-state key it does not know, naming it, rather than running the step without it', () => {
  expect(() => parseJourney(`journey: typo
steps:
  - id: see
    deadline: 5000
    expects: { role: status, name: Total }
${END}`)).toThrow(/step see: expects is not a step key/);
  expect(() => parseJourney(`journey: typo
steps:
  - id: open
    deadline: 5000
    goto: /
end_state:
  - id: stored
    oracle: code
    readback: { path: /api/cart }
    equal: { total: "$18.00" }
`)).toThrow(/end_state stored: equal is not an end-state key/);
});

it('refuses an API journey whose step makes no request, whose end-state check reads nothing back, or whose readback checks nothing', () => {
  const r = reasons(`journey: api
api: true
steps:
  - id: add
    deadline: 5000
    request: { method: POST, path: /api/cart }
  - id: look
    deadline: 5000
    goto: /cart
end_state:
  - id: shown
    oracle: code
    locator: { role: status, name: Total }
  - id: fetched
    oracle: code
    readback: { path: /api/cart }
`);
  expect(r).toContain('step look of an API journey makes no request, so it would never run');
  expect(r).toContain('end_state shown of an API journey reads nothing back from the system, so it would never run');
  expect(r).toContain('end_state fetched reads back /api/cart but checks nothing in it: name equals or count');
});

it('runs an API journey with a step it cannot drive as a refusal, starting no stack', async () => {
  const { runJourney } = await journey();
  const dir = checkout();
  const file = journeyVariant(dir, 'cart-api', (doc) => {
    (doc.steps as unknown[]).push({ id: 'look', deadline: 5000, goto: '/cart' });
    (doc.end_state as unknown[]).push({ id: 'shown', oracle: 'code', locator: { role: 'status', name: 'Total' } });
  }, 'cart-api-unrun');
  const run = await runJourney(runOptions(world, dir, file));
  expect(run.outcome).toBe('failed');
  expect(run.stack, 'no stack started').toBeNull();
  expect(run.failures.map((f) => f.message)).toEqual([
    'step look of an API journey makes no request, so it would never run',
    'end_state shown of an API journey reads nothing back from the system, so it would never run',
  ]);
}, 60_000);

it('never passes a run whose end state holds only readings, a model\'s and a person\'s, on a build where every step passes', async () => {
  const { runJourney } = await journey();
  const dir = checkout();
  const file = journeyVariant(dir, 'cart-total', (doc) => {
    doc.journey = 'cart-readings-only';
    doc.end_state = [{ id: 'looks-right', oracle: 'model', requirement: 'the cart total reads $18.00' }, { id: 'asked', oracle: 'person', requirement: 'the cart total reads $18.00' }];
  }, 'cart-readings-only');
  const run = await runJourney(runOptions(world, dir, file, { model: fakeModel(() => ({ answer: true, quote: '$18.00' })) }));
  expect(run.steps.map((s) => s.outcome), 'every step ran and passed').toEqual(['passed', 'passed']);
  expect(run.endState.map((e) => e.outcome)).toEqual(['reading', 'reading']);
  expect(run.outcome).toBe('uncounted');
  expect(run.mask).toBe('no code check of the end state ran: a model\'s reading or a person\'s answer never passes a journey on its own');
}, 120_000);
