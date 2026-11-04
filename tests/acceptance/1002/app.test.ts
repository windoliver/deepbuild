// #1002, the app half (README): the app's Set up (`deep-app --set-up`, #326's surface) and the app reopened, its first
// screen drawn headless for the home (`deep-replica --first-screen`, pinned here) and read by accessibility names,
// never by pixels. macOS only: elsewhere every test fails BLOCKED.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appSetUp, breakSettings, cleanup, deep, finishedRecord, firstScreen, fixSettings, hubAnswers, makeHome, noRecord, offeredAgain,
  offersSetUp, onMac, ranNoSetup, rootOf, settingsFile, shown, written,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const SET_UP = 'the app\'s Set up (deep-app --set-up)';

describe('#1002 the app offers Set up again until setup finished, and its count says so', () => {
  it('#1002.4273b842 with Claude Code\'s settings file unparseable, the app\'s Set up fails naming the file; reopening the app offers Set up again with that reason, and the count reads setup didn\'t finish, never 0', async () => {
    onMac();
    const h = makeHome();
    breakSettings(h.home);
    const file = settingsFile(h.home);
    const click = await appSetUp(h.home);
    if (click.code === 0 || !`${click.stdout}\n${click.stderr}`.includes(file)) expect.fail(`#1002 with Claude Code's settings file unparseable, ${SET_UP} must fail naming ${file}: ${shown(click)}`);
    noRecord(h.home, SET_UP);
    // Whatever else exists: the folder is there when the app reopens, as the merge base leaves it.
    mkdirSync(rootOf(h.home), { recursive: true });
    offeredAgain(await firstScreen(h.home, join(h.tmp, 'out')), { file });
  }, 600_000);

  it('#1002.8e3f037e after the file is fixed, Set up from the app finishes and writes its record, the next deep command runs no setup, and the app no longer offers Set up', async () => {
    onMac();
    const h = makeHome();
    breakSettings(h.home);
    const failed = await appSetUp(h.home);
    if (failed.code === 0) expect.fail(`#1002 with Claude Code's settings file unparseable, ${SET_UP} must fail: ${shown(failed)}`);
    fixSettings(h.home);
    const click = await appSetUp(h.home);
    if (click.code !== 0) expect.fail(`#1002 after the file is fixed, ${SET_UP} must finish, exit 0: ${shown(click)}`);
    await finishedRecord(h.home, `after the file is fixed, ${SET_UP}`);
    await hubAnswers(h.home, `after the file is fixed, ${SET_UP}`);
    const before = written(h.home);
    ranNoSetup('the next deep command (deep status)', await deep(h.home, ['status']), before, written(h.home));
    const screen = await firstScreen(h.home, join(h.tmp, 'out'));
    if (offersSetUp(screen)) expect.fail(`#1002 once setup finished, reopening the app must not offer Set up again: the first screen still has the Set up button`);
    if (screen.names.some((n) => /set ?up did(n['’]t| not) finish/i.test(n))) expect.fail(`#1002 once setup finished, the count must not read setup didn't finish: ${JSON.stringify(screen.names.slice(0, 60))}`);
  }, 600_000);

  it('#1002.8e3f037e a setup from the app whose hub doesn\'t start writes no finished record; reopening the app offers Set up again with the reason naming the hub, and the count reads setup didn\'t finish, never 0', async () => {
    onMac();
    const h = makeHome();
    fixSettings(h.home);
    const click = await appSetUp(h.home, { hub: 'dead' });
    if (click.code === 0 || !/\bhub\b/i.test(`${click.stdout}\n${click.stderr}`)) expect.fail(`#1002 with a login service that starts no hub, ${SET_UP} must fail naming the hub: ${shown(click)}`);
    noRecord(h.home, `${SET_UP}, whose hub didn't start,`);
    offeredAgain(await firstScreen(h.home, join(h.tmp, 'out')), 'hub');
  }, 600_000);
});
