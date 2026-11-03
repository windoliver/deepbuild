// AC18: a journey for a new Export button that first runs expect(page.getByRole('button', { name: 'Export' })).
// toBeVisible() fails on the sample app's base build at that expect by its locator timeout, reported as an
// assertion failure at its line with the selector and a screenshot, before its step's deadline runs out; the same
// journey without the expect times out at click(), reported as an error at that line; a toPass block whose last
// attempt threw a TypeError is reported as an error. A runner that sets the step deadline under the expect timeout
// overruns the step on the first and fails this test, naming the step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun, JourneyRunOptions } from '../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, journey, journeyVariant, openWorld, planted, runOptions, storedPng, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const EXPECT_TIMEOUT = 2000;
const DEADLINE = 6000;
/** The Export journey: an expect that the button is visible, then a click on it. Without the expect, the click alone. */
const exportJourney = (dir: string, withExpect: boolean): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = withExpect ? 'export' : 'export-click';
  doc.steps = [
    { id: 'open', deadline: 10_000, goto: '/cart' },
    ...(withExpect ? [{ id: 'export-shown', deadline: DEADLINE, expect: { role: 'button', name: 'Export', visible: true }, timeout: EXPECT_TIMEOUT }] : []),
    { id: 'export', deadline: DEADLINE, click: { role: 'button', name: 'Export' } },
  ];
  doc.end_state = [{ id: 'total-shown', oracle: 'code', locator: { role: 'status', name: 'Total' }, text: '$18.00' }];
}, withExpect ? 'export' : 'export-click');
/** A toPass block (expect.until) whose every attempt throws a TypeError: reading .value of an element that isn't there. */
const toPassJourney = (dir: string): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = 'to-pass';
  doc.steps = [
    { id: 'open', deadline: 10_000, goto: '/cart' },
    { id: 'poll', deadline: DEADLINE, expect: { until: true, evaluate: "document.querySelector('#never').value", equals: '1' }, timeout: EXPECT_TIMEOUT },
  ];
}, 'to-pass');
async function run(o: JourneyRunOptions): Promise<JourneyRun> {
  const { runJourney } = await journey();
  return runJourney(o);
}
/** The line of the journey file the step's expect or click is written on. */
const lineOf = (dir: string, file: string, text: string): number => readFileSync(join(dir, file), 'utf8').split('\n').findIndex((l) => l.includes(text)) + 1;

describe('AC18 #37.66b03932 an expect on the Export button fails on the base build by its locator timeout as an assertion failure at its line, with the selector and a screenshot, before the step\'s deadline; without it the click times out as an error; a toPass whose last attempt threw a TypeError is an error; a runner with the deadline under the expect timeout fails this test', () => {
  const expectFailsFirst = async (plant?: 'deadline-under-expect'): Promise<void> => {
    const dir = checkout();   // the base build: no Export button
    const file = exportJourney(dir, true);
    const o = runOptions(world, dir, file);
    const started = Date.now();
    const r = await run(plant ? planted(o, plant) : o);
    const elapsed = Date.now() - started;
    expect(r.outcome, `the journey fails, it doesn't overrun: ${JSON.stringify(r.failures)}`).toBe('failed');
    const step = r.steps.find((s) => s.id === 'export-shown')!;
    expect(step.outcome, 'the expect step failed on its expect, not on its deadline').toBe('failed');
    expect(step.endMs - step.startMs, 'the step ended before its deadline').toBeLessThan(DEADLINE);
    expect(elapsed).toBeLessThan(DEADLINE + 30_000);
    const failure = r.failures[0]!;
    expect(failure.assertion, 'a locator timeout inside an expect is that expect\'s assertion failure').toBe(true);
    expect(failure.file).toBe(file);
    expect(failure.line, 'at the expect\'s line').toBe(lineOf(dir, file, "name: Export, visible: true"));
    expect(failure.message, 'with the selector').toMatch(/getByRole\('button', \{ name: 'Export' \}\)|role: button.*name: Export/);
    expect(r.steps.find((s) => s.id === 'export')?.outcome, 'the click never ran').toBe('unrun');
    await storedPng(world, step.screenshot, 'the failing expect\'s screenshot');
  };
  it('AC18 the expect fails first, as an assertion failure at its line with the selector and a screenshot, before the step\'s deadline', () => expectFailsFirst(), 120_000);

  it('AC18 the same journey without the expect times out at the click, reported as an error (not an assertion failure) at the click\'s line', async () => {
    const dir = checkout();
    const file = exportJourney(dir, false);
    const r = await run(runOptions(world, dir, file));
    expect(r.outcome).toBe('failed');
    const failure = r.failures[0]!;
    expect(failure.assertion, 'an action\'s timeout outside an expect is elsewhere').toBe(false);
    expect(failure.file).toBe(file);
    expect(failure.line).toBe(lineOf(dir, file, "click: { role: button, name: Export }"));
    expect(failure.message).toMatch(/click|timeout|Timeout/i);
    expect(r.steps.find((s) => s.id === 'export')?.outcome).toBe('failed');
  }, 120_000);

  it('AC18 a toPass block whose last attempt threw a TypeError is reported as an error, by its last attempt', async () => {
    const dir = checkout();
    const file = toPassJourney(dir);
    const r = await run(runOptions(world, dir, file));
    expect(r.outcome).toBe('failed');
    const failure = r.failures[0]!;
    expect(failure.assertion, 'a TypeError in the last attempt is no assertion failure').toBe(false);
    expect(`${failure.message}\n${failure.stack ?? ''}`).toMatch(/TypeError/);
    expect(failure.line).toBe(lineOf(dir, file, 'until: true'));
  }, 120_000);

  it('AC18 (wrong program) a runner that sets the step deadline under the expect timeout overruns the step on the first journey, naming the step, and fails this test', async () => {
    const error = await assertionFails(() => expectFailsFirst('deadline-under-expect'));
    expect(error.message).toMatch(/overrun|deadline|failed|export-shown/);
    const dir = checkout();
    const r = await run(planted(runOptions(world, dir, exportJourney(dir, true)), 'deadline-under-expect'));
    expect(r.outcome, 'the twin is that twin: it overruns').toBe('overran');
    expect(r.failures.map((f) => `${f.test} ${f.message}`).join('\n'), 'naming the step').toMatch(/export-shown/);
  }, 240_000);
});
