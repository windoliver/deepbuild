// The wrong programs AC1, AC2, AC3, AC4, AC6, AC7 and AC14 name, each run in the replica's planted build (`deep-drive
// --features env-plants`, its plant selected by DEEP_HUB_PLANT, README, Pinned 6) on the journey's fixture machine, and
// each failing the same judge journey.test.ts holds the shipped app to, naming what its criterion says it names. The
// `deep` the app runs drops DEEP_HUB_PLANT, so a real `deep setup` and its hub run as shipped.
import { afterAll, describe, expect, it } from 'vitest';
import {
  agentFailures, blocked, cleanup, controlFailures, deepLog, feedAsk, FIRST_LAUNCH, firstLaunch, ID, leavesFailures, listedOf, makeHome, MIN,
  notificationFailures, opensFailures, PLANT, pressSetUp, routeFailures, setupEnded, termFailures, undoLineOf, until, wordTable,
  type Drive, type Home, type Screen,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** The planted app's first-launch screen on the journey's fixture machine. */
async function plantedScreen(plant: string): Promise<{ h: Home; screen: Screen }> {
  const h = makeHome({ history: true });
  const { d, screen } = await firstLaunch(h, { plant });
  await d.stop();
  return { h, screen };
}
/** Presses Set up, lets the real setup end, and lets the clock run as the journey does; the window then. */
async function afterSetUp(h: Home, d: Drive): Promise<Screen> {
  await pressSetUp(d);
  await until(d, (s) => s.page?.id !== FIRST_LAUNCH || setupEnded(h) !== undefined, 6 * MIN);
  const after = await until(d, (s) => s.page?.id !== FIRST_LAUNCH, 30_000);
  if (setupEnded(h) !== 0) blocked(`Set up didn't work on the fixture machine, so the planted app can't be judged after it: the deep it ran logged ${JSON.stringify(deepLog(h))}`);
  return after;
}

describe(`AC1 ${ID.agents} wrong program`, () => {
  it(`AC1 ${ID.agents} wrong program: a screen built from a written list that names pi fails, naming the agent`, async () => {
    const { screen } = await plantedScreen(PLANT.writtenList);
    expect(agentFailures(screen).join('\n')).toMatch(/names pi\b|row for pi\b/);
  }, 30 * MIN);
});

describe(`AC2 ${ID.oneButton} wrong program`, () => {
  it(`AC2 ${ID.oneButton} wrong program: a screen with a second Set up option fails, naming the control`, async () => {
    const { screen } = await plantedScreen(PLANT.secondOption);
    expect(controlFailures(screen).join('\n')).toMatch(/second control that writes: button .*"Set up without history"/);
  }, 30 * MIN);
});

describe(`AC3 ${ID.undo} wrong program`, () => {
  it(`AC3 ${ID.undo} wrong program: a take-it-back line naming a route that doesn't exist fails`, async () => {
    const { h, screen } = await plantedScreen(PLANT.missingRoute);
    const { line, failures } = undoLineOf(screen);
    const routes = line === undefined ? [] : await routeFailures(h, line, listedOf(screen).agents, false);
    expect([...failures, ...routes].join('\n')).toMatch(/names deep uninstall, a route deep doesn't have/);
  }, 30 * MIN);
});

describe(`AC4 ${ID.words} wrong program`, () => {
  it(`AC4 ${ID.words} wrong program: a screen saying "PreToolUse hooks" with no gloss is refused by the check that reads the table, naming the term`, async () => {
    const { screen } = await plantedScreen(PLANT.pretooluse);
    if (!screen.texts.some((t) => t.includes('PreToolUse hooks'))) blocked(`the planted screen doesn't say "PreToolUse hooks" (README, Pinned 6): ${JSON.stringify(screen.texts)}`);
    expect(termFailures(screen, wordTable()).join('\n')).toMatch(/says "(PreToolUse|PreToolUse hooks?|hooks?)" with no gloss beside it/i);
  }, 30 * MIN);
});

describe(`AC6 ${ID.opens} wrong program`, () => {
  it(`AC6 ${ID.opens} wrong program: an app that stays on the first-launch screen after a Set up that works fails`, async () => {
    const h = makeHome({ history: true });
    const { d } = await firstLaunch(h, { plant: PLANT.staysOnFirstLaunch });
    try {
      expect(opensFailures(await afterSetUp(h, d)).join('\n')).toMatch(/stays on the first-launch screen/);
    } finally {
      await d.stop();
    }
  }, 30 * MIN);
});

describe(`AC7 ${ID.notifications} wrong program`, () => {
  it(`AC7 ${ID.notifications} wrong program: an app that first asks for notifications when an ask comes due fails, naming the ask`, async () => {
    const h = makeHome({ history: true });
    const { d, screen } = await firstLaunch(h, { plant: PLANT.asksAtFirstPost, notifications: 'not_asked' });
    try {
      const after = await afterSetUp(h, d);
      const ask = await feedAsk(d);
      await d.wait(4000);
      const trace = await d.close();
      const failures = notificationFailures({ before: screen.seen.notifications?.setting, after: after.seen.notifications?.setting, ask, trace });
      expect(failures.join('\n')).toContain(`when ${ask} came due`);
    } finally {
      await d.stop();
    }
  }, 30 * MIN);
});

describe(`AC14 ${ID.leaves} wrong program`, () => {
  it(`AC14 ${ID.leaves} wrong program: with a reading job listed, a screen that says nothing leaves this Mac fails, naming the job`, async () => {
    const { screen } = await plantedScreen(PLANT.nothingLeaves);
    expect(leavesFailures(screen).join('\n')).toMatch(/nothing leaves this Mac.*the reading job history:/i);
  }, 30 * MIN);
});
