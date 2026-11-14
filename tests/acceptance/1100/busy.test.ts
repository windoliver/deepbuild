// AC13: while Set up runs. The replica (`deep-drive`) on a fixture machine whose `deep setup` takes 5 s (the `slow` stand-in
// on the login shell's PATH, which logs each start). A moment after the press the button reads Setting up; a second press
// where the button is, a second later, starts nothing: the stand-in logs one start in all. The wrong programs are planted
// apps: one that hides the button while setup runs, as the merge base draws it, and one that starts setup twice.
import { afterAll, describe, expect, it } from 'vitest';
import {
  busyFailures, centre, cleanup, deepLog, firstLaunch, ID, makeHome, MIN, PLANT, pressSetUp, said, screenOf, setUpButton, setupStarts, until,
} from './helpers.ts';

afterAll(cleanup, 120_000);

async function busyRun(plant?: string): Promise<string[]> {
  const h = makeHome({ deep: 'slow' });
  const { d, screen } = await firstLaunch(h, plant ? { plant } : {});
  try {
    const button = setUpButton(screen);
    if (!button) return [`the first-launch screen has no Set up button: its words are ${said(screen.texts, 600)}`];
    const at = centre(button);
    await pressSetUp(d);
    await d.wait(800);
    const failures = busyFailures(screenOf(await d.see()), 'a moment after the press, while Set up runs');
    // The second press, where the button is, while the 5 s setup still runs.
    await d.clickAt(at);
    await d.wait(800);
    failures.push(...busyFailures(screenOf(await d.see()), 'after a second press, while Set up still runs'));
    await until(d, () => deepLog(h).some((l) => l.startsWith('end ')), 30_000);
    await d.wait(6000);
    const starts = setupStarts(h);
    if (starts !== 1) failures.push(`a second press while Set up ran started setup again: deep setup started ${starts} times (${JSON.stringify(deepLog(h))})`);
    return failures;
  } finally {
    await d.stop();
  }
}

describe(`AC13 ${ID.busy} while Set up runs`, () => {
  it(`AC13 ${ID.busy}: during a fixture Set up that takes 5 s, the button reads Setting up and a second press starts nothing`, async () => {
    expect(await busyRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC13 ${ID.busy} wrong program: an app that hides the button while Set up runs fails`, async () => {
    expect((await busyRun(PLANT.hidesButton)).join('\n')).toMatch(/0 buttons read Setting up/);
  }, 30 * MIN);

  it(`AC13 ${ID.busy} wrong program: an app whose second press starts setup again fails`, async () => {
    expect((await busyRun(PLANT.startsTwice)).join('\n')).toMatch(/started setup again: deep setup started 2 times/);
  }, 30 * MIN);
});
