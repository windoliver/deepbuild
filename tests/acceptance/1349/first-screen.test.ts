// AC7 and AC8's screen half: the first screen on a machine with no agent found, before any click. The replica opens as
// a fresh account would open the download; nothing is pressed, so no runtime folder is needed. The planted screen
// (an install button beside Set up) runs in a world of its own, through the replica's env-plants build.
import { afterEach, describe, expect, it } from 'vitest';
import { closeWorlds, controlFailures, CRITERION, firstLaunch, installOnScreen, MIN, mustName, named, openWorld, PLANT } from './helpers.ts';

afterEach(closeWorlds, 2 * MIN);

describe(`${named(7)} ${CRITERION[7]}`, () => {
  it(`${named(7)} with no agent found, the first screen's only control that writes is the one Set up button`, async () => {
    const w = await openWorld();
    const { d, screen } = await firstLaunch(w);
    await d.stop();
    expect(controlFailures(screen), 'the first-launch page holds one button, Set up, and no other control that writes').toEqual([]);
  }, 30 * MIN);

  it(`${named(7)} (wrong program) a planted screen with an install button beside Set up, DEEP_HUB_PLANT=${PLANT.installButton}, fails, naming the control`, async () => {
    const w = await openWorld({ plant: PLANT.installButton });
    const { d, screen } = await firstLaunch(w, true);
    await d.stop();
    mustName(PLANT.installButton, controlFailures(screen), ['a second control that writes', 'button', 'Install']);
  }, 30 * MIN);
});

describe(`${named(8)} ${CRITERION[8]} (the screen's half)`, () => {
  it(`${named(8)} with no agent found, the first screen's Claude Code row says Set up installs it, from the install step of setup's list`, async () => {
    const w = await openWorld();
    const { d, screen } = await firstLaunch(w);
    await d.stop();
    const { agent, failures } = installOnScreen(screen);
    expect(failures, 'the first screen lists one install step, setup-step:install:<agent>, and that agent\'s row says Set up installs it').toEqual([]);
    expect(agent, 'the agent the row names is the first in the adapters\' order, Claude Code').toBe('claude-code');
  }, 30 * MIN);
});
