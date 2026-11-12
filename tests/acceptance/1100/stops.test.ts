// AC5 and AC10: a Set up that stops, in the replica (`deep-drive`) on a fixture machine, its Set up running the `deep` on
// the login shell's PATH. AC5's machine has Claude Code's settings file unparseable and runs the real `deep setup`; its
// wrong program is the merge base, whose window drops the button and shows setup's failure with its exit status. AC10's
// `deep setup` is a fixture that fails with a stack trace on stderr (fixtures/trace.txt); its wrong program is the planted
// screen that prints setup's output.
import { afterAll, describe, expect, it } from 'vitest';
import {
  blocked, cleanup, deepLog, firstLaunch, ID, makeHome, MIN, PLANT, pressSetUp, screenOf, setUpButton, setupEnded, setupStarts, stopFailures,
  traceFailures, until,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** Claude Code's settings file, named by its path from your home or in full. */
const FILE = /\.claude\/settings\.json/;

describe(`AC5 ${ID.stops} a Set up that stops on a file it can't read`, () => {
  it(`AC5 ${ID.stops}: with Claude Code's settings file unparseable, the click shows one line naming the file with no exit status, and Set up can be pressed again without reopening the app`, async () => {
    const h = makeHome({ brokenSettings: true });
    const { d } = await firstLaunch(h);
    try {
      await pressSetUp(d);
      await until(d, () => setupEnded(h) !== undefined, 3 * MIN);
      if (setupEnded(h) === undefined) blocked(`the click ran no deep setup to its end: the deep it ran logged ${JSON.stringify(deepLog(h))}`);
      await d.wait(3000);
      const stopped = screenOf(await d.see());
      const failures = stopFailures(stopped, FILE);
      if (setUpButton(stopped)) {
        const before = setupStarts(h);
        await pressSetUp(d);
        await until(d, () => setupStarts(h) > before, 30_000);
        if (setupStarts(h) === before) failures.push(`a second press of Set up, in the same window, started no setup: the deep it runs logged ${JSON.stringify(deepLog(h))}`);
      }
      expect(failures).toEqual([]);
    } finally {
      await d.stop();
    }
  }, 30 * MIN);
});

/** Set up on a machine whose `deep setup` fails with a stack trace; what the screen shows once it said so. */
async function traceRun(plant?: string): Promise<string[]> {
  const h = makeHome({ deep: 'trace' });
  const { d } = await firstLaunch(h, plant ? { plant } : {});
  try {
    await pressSetUp(d);
    await until(d, () => setupEnded(h) !== undefined, 3 * MIN);
    if (setupEnded(h) !== 1) blocked(`the fixture setup didn't run to its failure: the deep it ran logged ${JSON.stringify(deepLog(h))}`);
    await d.wait(3000);
    return traceFailures(screenOf(await d.see()));
  } finally {
    await d.stop();
  }
}

describe(`AC10 ${ID.noTrace} setup's error output stays off the screen`, () => {
  it(`AC10 ${ID.noTrace}: with a fixture setup whose error output holds a stack trace, the screen shows none of it`, async () => {
    expect(await traceRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC10 ${ID.noTrace} wrong program: a planted screen that prints setup's output fails, naming the line`, async () => {
    expect((await traceRun(PLANT.printsOutput)).join('\n')).toMatch(/its line "TypeError: Cannot read properties of undefined/);
  }, 30 * MIN);
});
