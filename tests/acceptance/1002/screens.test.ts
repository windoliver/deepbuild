// #1002.1f6f1740, the screenshots shown to you (README: The taste call): the app's first screen offering Set up again
// with the reason, and the count reading setup didn't finish, captured by the check from the app at the reference
// window (1512 x 982 points at 2x, light), once for the settings file and once for the hub. They are written to
// $DA1002_SCREENS (a temp folder otherwise) to attach to the PR. Whether they look right is one taste call, a person's,
// recorded in docs/evidence/1002/taste.json on exactly these screenshots; without it the test fails INCONCLUSIVE,
// never passes. The screenshot is judged by nobody's code: the criteria above read the accessibility snapshot.
// macOS only: elsewhere it fails BLOCKED.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appSetUp, atReferenceWindow, breakSettings, cleanup, firstScreen, fixSettings, makeHome, offeredAgain, onMac, rootOf, settingsFile,
  sha, shown, tasteCall, tempDir,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#1002 the first screen after a setup that stopped, shown to you', () => {
  it('#1002.1f6f1740 screenshots of the app offering Set up again with the reason and the count reading setup didn\'t finish, taken at the reference window, stay INCONCLUSIVE until a taste call on them is recorded', async () => {
    onMac();
    const where = process.env.DA1002_SCREENS ?? join(tempDir(), 'screens');
    mkdirSync(where, { recursive: true });
    const screens: Record<string, string> = {};

    const settings = makeHome();
    breakSettings(settings.home);
    const failed = await appSetUp(settings.home);
    if (failed.code === 0) expect.fail(`#1002 with Claude Code's settings file unparseable, the app's Set up must fail: ${shown(failed)}`);
    mkdirSync(rootOf(settings.home), { recursive: true });
    const a = await firstScreen(settings.home, join(settings.tmp, 'out'));
    atReferenceWindow(a);
    offeredAgain(a, { file: settingsFile(settings.home) });
    copyFileSync(a.png, join(where, 'first-screen-settings.png'));
    screens['first-screen-settings.png'] = sha(readFileSync(a.png));

    const hub = makeHome();
    fixSettings(hub.home);
    const stopped = await appSetUp(hub.home, { hub: 'dead' });
    if (stopped.code === 0) expect.fail(`#1002 with a login service that starts no hub, the app's Set up must fail: ${shown(stopped)}`);
    const b = await firstScreen(hub.home, join(hub.tmp, 'out'));
    atReferenceWindow(b);
    offeredAgain(b, 'hub');
    copyFileSync(b.png, join(where, 'first-screen-hub.png'));
    screens['first-screen-hub.png'] = sha(readFileSync(b.png));

    tasteCall(screens, where);
  }, 900_000);
});
