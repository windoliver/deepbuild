// #994's three real runs (the issue's Proof): the real deep-app beside a real hub, judged on the app's log. Each test's
// wrong program runs through the same judge. Written blind from the issue, the design and the base commit 58862789.
//
// The merge base is its own wrong program for AC1 and AC2, and these tests fail on it there; the planted runs are
// what the same judges do to a program that has every new surface but still posts twice or posts unchecked.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, CONNECTED_MS, HUB_NOT_ANSWERING, SETTLE_MS, anotherHomeOn, attemptTimes, cleanup, doctor, failsNaming, failsNamingSetting, firstScreen,
  hangingUp, holds, makeHome, neverNotified, notifiedInTime, notifiedOnce, onMac, openAsk, setUpWorld, sleep, startApp, startHub, stopHub, tempDir, windowUp,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} the notifier keeps trying a hub that came up late`, () => {
  it(`${AC1} an ask opened 5 s after a hub that started 20 s after the app is notified within the notification delay`, async () => {
    onMac();
    const { home, repo, hub: setUp } = await setUpWorld();
    await stopHub(setUp);
    const app = await startApp(home, 'allowed');
    await sleep(20_000);
    const hub = await startHub(home);
    await sleep(5000);
    const ask = await openAsk(hub, repo);
    holds(await notifiedInTime(app, ask));
  }, 600_000);

  it('#994 scope: the app tries every 2 s, then every 30 s after a minute', async () => {
    onMac();
    const { home } = makeHome();
    const hub = await hangingUp(home);
    await startApp(home, 'allowed');
    const started = Date.now();
    while (!hub.attempts.length && Date.now() - started < 60_000) await sleep(100);
    const first = hub.attempts[0];
    if (first === undefined) expect.fail('#994 the app should try the hub at its socket: it never connected');
    await sleep(Math.max(0, first + 100_000 - Date.now()));
    hub.close();
    const at = attemptTimes(hub.attempts).map((t) => (t - first) / 1000);
    const shown = JSON.stringify(at);
    const early = at.filter((s) => s <= 55);
    if (early.length < 14) expect.fail(`#994 the app should try the hub every 2 s for a minute; in the first 55 s it tried ${early.length} times, at ${shown} s`);
    const gap = Math.max(...early.slice(1).map((s, i) => s - early[i]!));
    if (gap > 4) expect.fail(`#994 the app should try the hub every 2 s for a minute; it waited ${gap} s, at ${shown} s`);
    const between = at.filter((s) => s > 66 && s < 85);
    if (between.length) expect.fail(`#994 after a minute the app should try the hub every 30 s; it tried at ${JSON.stringify(between)} s, of ${shown} s`);
    if (!at.some((s) => s >= 85 && s <= 100)) expect.fail(`#994 after a minute the app should keep trying the hub every 30 s; it didn't between 85 and 100 s, of ${shown} s`);
  }, 300_000);

  it('#994 scope: with no hub answering, the window\'s count says so', async () => {
    onMac();
    const { home, hub } = await setUpWorld();
    await stopHub(hub);
    const screen = await firstScreen(home, join(tempDir(), 'out'));
    if (!screen.names.some((n) => HUB_NOT_ANSWERING.test(n))) expect.fail(`#994 the count should say the hub isn't answering: the first screen's names are ${JSON.stringify(screen.names.slice(0, 40))}`);
  }, 600_000);
});

describe(`${AC2} one app per user`, () => {
  it(`${AC2} launching the app twice, the second brings the first forward and exits, and one ask is notified once`, async () => {
    onMac();
    const { home, repo, hub } = await setUpWorld();
    const first = await startApp(home, 'allowed');
    await windowUp(first);
    await sleep(CONNECTED_MS);
    const second = await startApp(home, 'allowed');
    const left = await Promise.race([second.exit, sleep(30_000).then(() => 'still running' as const)]);
    const ask = await openAsk(hub, repo);
    await sleep(SETTLE_MS);
    // The count is judged first: the merge base's second notifier posts it twice.
    holds(notifiedOnce([first, second], ask.handle));
    if (left !== 0) expect.fail(`#994 the second launch should exit 0; it ${left === 'still running' ? 'is still running' : `exited ${left}`}: ${second.log().slice(-600)}`);
    if (first.exited()) expect.fail(`#994 the first app should keep running: ${first.log().slice(-600)}`);
    if (!first.lines.some((l) => l.text === 'deep-app: brought forward')) expect.fail(`#994 the second launch should bring the first window forward ("deep-app: brought forward" in the first app's log): ${first.log().slice(-600)}`);
  }, 600_000);

  it(`${AC2} planted: a second notifier on the same hub posts the ask twice and fails, naming it`, async () => {
    onMac();
    const { home, repo, hub } = await setUpWorld();
    const first = await startApp(home, 'allowed');
    const second = await startApp(anotherHomeOn(hub), 'allowed');
    await windowUp(first);
    await windowUp(second);
    await sleep(CONNECTED_MS);
    const ask = await openAsk(hub, repo);
    await sleep(SETTLE_MS);
    failsNaming(notifiedOnce([first, second], ask.handle), ask.handle, /notified 2 times/);
  }, 600_000);
});

describe(`${AC3} with notifications denied, nothing says notified`, () => {
  it(`${AC3} the log never says notified, says it wasn't, and deep doctor fails app.notifications naming the setting`, async () => {
    onMac();
    const { home, repo, hub } = await setUpWorld();
    const app = await startApp(home, 'denied');
    await windowUp(app);
    await sleep(CONNECTED_MS);
    const ask = await openAsk(hub, repo);
    await sleep(SETTLE_MS);
    holds(neverNotified(app, ask.handle));
    failsNamingSetting(await doctor(home), /allow notifications/i);
  }, 600_000);

  it(`${AC3} planted: an app that posts without checking logs notified and fails, naming the ask`, async () => {
    onMac();
    const { home, repo, hub } = await setUpWorld();
    const app = await startApp(home, 'denied', { plant: 'plant-posts-unchecked' });
    await windowUp(app);
    await sleep(CONNECTED_MS);
    const ask = await openAsk(hub, repo);
    await sleep(SETTLE_MS);
    failsNaming(neverNotified(app, ask.handle), ask.handle, /was notified/);
  }, 1_800_000);
});
