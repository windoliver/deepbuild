// AC18 (blind redraft, see REDRAFT.md): a journey for a new Export button that first runs
// `expect(page.getByRole('button', { name: 'Export' })).toBeVisible()` fails on the sample app's base build at that
// expect by its locator timeout, reported as an assertion failure at its line with the selector and a screenshot,
// before its step's deadline runs out; the same journey without the expect times out at `click()`, reported as an
// error at that line; a `toPass` block whose last attempt threw a `TypeError` is reported as an error. A runner that
// sets the step deadline under the expect timeout overruns the step on the first and fails this test, naming the step.
//
// "At its line" is read on the journey file as helpers.ts's `journeyVariant` writes it (the `yaml` package's
// block style, each key on its own line): the expect's line is the line of the step's `expect:` key, or any line
// of the nested map under it (`role`, `name`, `visible`), as a Playwright expect that spans lines is at any of
// them; the click's line is the step's `click:` key and the lines nested under it; the toPass block's line is the
// `expect:` key of the step whose expect carries `until: true`, and the lines nested under it. The step's `id:`,
// `deadline:` and `timeout:` lines are not the statement, so a failure placed on one of them is not at its line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Failure } from '../../../../packages/conformance/src/index.ts';
import type { JourneyRun, JourneyRunOptions } from '../../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, journey, journeyVariant, openWorld, planted, runOptions, storedPng, steps, type World } from '../helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const EXPECT_TIMEOUT = 2000;
const STEP_DEADLINE = 5000;
/** Playwright's selector for the button, as the criterion writes it: `getByRole('button', { name: 'Export' })`. */
const EXPORT = { role: 'button', name: 'Export' };

/** The Export journey on the cart: open /cart, expect the Export button visible, then click it. `withExpect: false` leaves the expect out. */
const exportJourney = (dir: string, withExpect: boolean): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = 'export';
  doc.steps = [
    steps(doc)[0]!,   // open: goto /cart, as the fixture has it
    ...(withExpect ? [{ id: 'export-shown', deadline: STEP_DEADLINE, expect: { ...EXPORT, visible: true }, timeout: EXPECT_TIMEOUT }] : []),
    { id: 'export', deadline: STEP_DEADLINE, click: { ...EXPORT } },
  ];
}, 'export');

/** A journey whose second step is a toPass block (`expect: { until: true, ... }`) whose every attempt throws a TypeError: it reads a property of `undefined`. */
const typeErrorJourney = (dir: string): string => journeyVariant(dir, 'cart-total', (doc) => {
  doc.journey = 'to-pass-type-error';
  doc.steps = [
    steps(doc)[0]!,
    { id: 'until-exported', deadline: STEP_DEADLINE, expect: { until: true, evaluate: 'window.exported.count', equals: '1' }, timeout: EXPECT_TIMEOUT },
  ];
}, 'to-pass-type-error');

/**
 * The lines, 1-based, of a step's `key:` in the journey file as written, and of the map nested under it: from the
 * key's line to the last line indented deeper than it. Read from the file, never from the document given to the
 * writer, so the reading holds whatever style the writer chose.
 */
function linesOf(dir: string, file: string, stepId: string, key: string): { from: number; to: number } {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  const indentOf = (line: string): number => line.search(/\S/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*- id: ${stepId}\\s*$`).test(line));
  expect(start, `the step ${stepId} is in ${file}`).toBeGreaterThanOrEqual(0);
  const item = lines[start]!.indexOf('-');
  let at = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (indentOf(line) <= item) break;   // the next step, or the next top-level key
    if (new RegExp(`^\\s*${key}:`).test(line) && indentOf(line) === item + 2) { at = i; break; }
  }
  expect(at, `the step ${stepId} has a ${key}: key in ${file}`).toBeGreaterThanOrEqual(0);
  let end = at;
  while (end + 1 < lines.length && lines[end + 1]!.trim() !== '' && indentOf(lines[end + 1]!) > indentOf(lines[at]!)) end++;
  return { from: at + 1, to: end + 1 };
}
/** The failure's file is the journey file: as written, relative to the checkout, or that file's path under it. */
const inFile = (failure: Failure, dir: string, file: string): boolean => failure.file === file || failure.file === join(dir, file) || failure.file.endsWith(`/${file}`);
const atLine = (failure: Failure, span: { from: number; to: number }): boolean => failure.line >= span.from && failure.line <= span.to;
/** The selector in a message, as Playwright writes it: the role and the name, `getByRole('button', { name: 'Export' })` or its `role=button[name="Export"]` form. */
const namesSelector = (message: string): boolean => /button/.test(message) && /Export/.test(message);
const describeFailures = (run: JourneyRun): string => JSON.stringify(run.failures.map(({ test, file, line, assertion, message }) => ({ test, file, line, assertion, message })));

async function run(o: JourneyRunOptions): Promise<JourneyRun> {
  const { runJourney } = await journey();
  return runJourney(o);
}

describe('AC18 #37.66b03932 an Export journey fails on the base build at its expect by the locator timeout, an assertion failure at its line with the selector and a screenshot, before the step\'s deadline; without the expect the click times out as an error at its line; a toPass whose last attempt threw a TypeError is an error; a runner with the deadline under the expect timeout overruns the step on the first and fails this test', () => {
  /** The criterion's first assertion, on a run of the Export journey on the base build (no Export button): the expect fails first, as an assertion failure, not an overrun. */
  const expectFailsFirst = async (r: JourneyRun, dir: string, file: string): Promise<void> => {
    const step = r.steps.find((s) => s.id === 'export-shown');
    expect(step, 'the step export-shown ran').toBeDefined();
    expect(r.outcome, `the run failed at the step export-shown, it did not overrun: ${describeFailures(r)}`).toBe('failed');
    expect(step!.outcome, 'the step export-shown failed before its deadline, it did not overrun').toBe('failed');
    expect(step!.endMs - step!.startMs, `the step export-shown ended (${step!.endMs - step!.startMs} ms) before its deadline of ${STEP_DEADLINE} ms`).toBeLessThan(STEP_DEADLINE);
    expect(step!.endMs - step!.startMs, 'the expect waited for its locator timeout before failing').toBeGreaterThanOrEqual(EXPECT_TIMEOUT / 2);
    expect(r.steps.find((s) => s.id === 'export')?.outcome, 'the click after the failing expect never ran').toBe('unrun');
    const span = linesOf(dir, file, 'export-shown', 'expect');
    const failure = r.failures.find((f) => inFile(f, dir, file) && atLine(f, span));
    expect(failure, `a failure at the expect's line (${file}:${span.from}-${span.to}): ${describeFailures(r)}`).toBeDefined();
    expect(failure!.assertion, 'a locator timeout inside an expect is that expect failing: an assertion failure').toBe(true);
    expect(failure!.message, 'the failure says the locator timed out').toMatch(/timed? ?out|timeout/i);
    expect(namesSelector(failure!.message), `the failure carries the selector, the button named Export: ${failure!.message}`).toBe(true);
    const image = await storedPng(world, step!.screenshot, 'the failing step\'s screenshot');
    expect(image.width, 'the screenshot has pixels').toBeGreaterThan(0);
    expect(r.evidence, 'the screenshot is in the run\'s evidence').toContain(step!.screenshot);
  };

  it('AC18 the expect on the Export button fails on the base build by its locator timeout, as an assertion failure at the expect\'s line with the selector and a screenshot, before the step\'s deadline runs out', async () => {
    const dir = checkout();
    const file = exportJourney(dir, true);
    await expectFailsFirst(await run(runOptions(world, dir, file)), dir, file);
  }, 120_000);

  it('AC18 the same journey without the expect times out at the click, reported as an error, not an assertion failure, at the click\'s line', async () => {
    const dir = checkout();
    const file = exportJourney(dir, false);
    const r = await run(runOptions(world, dir, file));
    expect(r.outcome, `the run failed at the click: ${describeFailures(r)}`).toBe('failed');
    expect(r.steps.find((s) => s.id === 'export')?.outcome, 'the click step failed').toBe('failed');
    const span = linesOf(dir, file, 'export', 'click');
    const failure = r.failures.find((f) => inFile(f, dir, file) && atLine(f, span));
    expect(failure, `a failure at the click's line (${file}:${span.from}-${span.to}): ${describeFailures(r)}`).toBeDefined();
    expect(failure!.assertion, 'a timeout in an action outside an expect is elsewhere: an error, not an assertion failure').toBe(false);
    expect(failure!.message, 'the failure says the click timed out').toMatch(/timed? ?out|timeout/i);
    expect(namesSelector(failure!.message), `the failure names what the click waited for: ${failure!.message}`).toBe(true);
    expect(r.failures.some((f) => f.assertion), `no failure of this run is an assertion failure: ${describeFailures(r)}`).toBe(false);
  }, 120_000);

  it('AC18 a toPass block whose last attempt threw a TypeError is reported as an error, by that last attempt, naming the TypeError at the block\'s line', async () => {
    const dir = checkout();
    const file = typeErrorJourney(dir);
    const r = await run(runOptions(world, dir, file));
    expect(r.outcome, `the run failed at the toPass block: ${describeFailures(r)}`).toBe('failed');
    expect(r.steps.find((s) => s.id === 'until-exported')?.outcome, 'the toPass step failed').toBe('failed');
    const span = linesOf(dir, file, 'until-exported', 'expect');
    const failure = r.failures.find((f) => inFile(f, dir, file) && atLine(f, span));
    expect(failure, `a failure at the toPass block's line (${file}:${span.from}-${span.to}): ${describeFailures(r)}`).toBeDefined();
    expect(failure!.assertion, 'a toPass counts by its last attempt\'s failure, a TypeError, so it is an error, not an assertion failure').toBe(false);
    expect(failure!.message, 'the failure names the TypeError the last attempt threw').toMatch(/TypeError/);
    expect(r.failures.some((f) => f.assertion), `no failure of this run is an assertion failure: ${describeFailures(r)}`).toBe(false);
  }, 120_000);

  it('AC18 (wrong program) a runner that sets the step deadline under the expect timeout overruns the step on the first journey, naming the step, and fails this test', async () => {
    const dir = checkout();
    const file = exportJourney(dir, true);
    const r = await run(planted(runOptions(world, dir, file), 'deadline-under-expect'));
    expect(r.outcome, `the planted runner overruns the step: ${describeFailures(r)}`).toBe('overran');
    expect(r.steps.find((s) => s.id === 'export-shown')?.outcome, 'the step the planted runner overran').toBe('overran');
    expect(r.failures.some((f) => /export-shown/.test(`${f.test} ${f.message}`)), `the overrun names the step export-shown: ${describeFailures(r)}`).toBe(true);
    const error = await assertionFails(() => expectFailsFirst(r, dir, file));
    expect(error.message, 'the criterion\'s assertion fails on it, naming the step').toMatch(/export-shown/);
    expect(error.message).toMatch(/overr[au]n|failed|deadline/);
  }, 180_000);
});
