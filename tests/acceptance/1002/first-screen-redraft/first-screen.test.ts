// #1002's AC1 and AC2, the first screen's parts, on the real window: the real `deep-app` in a temp home, Set up pressed
// as a screen reader presses it, the app reopened, and the window read from outside its process (nodes, pixels, menu
// bar) at the size it opens at and at the reference window. Never the replica. macOS only: elsewhere each fails BLOCKED.
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  breakSettings, cleanup, deep, finishedRecord, fixSettings, hubAnswers, makeHome, noRecord, ranNoSetup, recordFile, settingsFile, sleep, written, type Home,
} from '../helpers.ts';
import { atBothSizes } from './window.ts';
import { finishedFailures, leftByMergeBase, namesTheFile, namesTheHub, offeredFailures, open, pressSetUp, SETUP_MS, startHub } from './helpers.ts';

afterAll(cleanup, 60_000);

const MINUTES = 60_000;
const holds = (failures: string[]): void => { if (failures.length) expect.fail(`#1002 ${failures.join('\n')}`); };

/** Set up pressed in the real window, with the settings file unparseable: it fails naming the file, on the window. */
async function failOnSettings(h: Home): Promise<void> {
  breakSettings(h.home);
  const app = await open(h);
  await pressSetUp(app);
  holds((await app.settled(namesTheFile, SETUP_MS)).failures);
  await app.stop();
  noRecord(h.home, 'the app\'s Set up');
}
async function waitForRecord(h: Home): Promise<void> {
  const deadline = Date.now() + SETUP_MS;
  while (!existsSync(recordFile(h.home)) && Date.now() < deadline) await sleep(250);
}

describe('#1002 the real window offers Set up again until setup finished, and its count says so', () => {
  it('#1002.4273b842 with Claude Code\'s settings file unparseable, Set up on the real window fails naming the file; reopening the app offers Set up again with that reason, and the count reads setup didn\'t finish, never 0', async () => {
    const h = makeHome();
    await failOnSettings(h);
    const app = await open(h);
    holds((await atBothSizes(app, (s) => offeredFailures(s, { file: settingsFile(h.home) }))).failures);
    await app.stop();
  }, 12 * MINUTES);

  it('#1002.4273b842 whatever else exists: a folder a setup left behind, with a hub answering and no finished record, opens on Set up and setup didn\'t finish, never on "0 asks need you"', async () => {
    const h = makeHome();
    breakSettings(h.home);
    leftByMergeBase(h);
    await startHub(h);
    const app = await open(h);
    holds((await atBothSizes(app, (s) => offeredFailures(s, 'none'))).failures);
    await app.stop();
  }, 12 * MINUTES);

  it('#1002.8e3f037e after the file is fixed, Set up on the real window finishes and writes its record, the next deep command runs no setup, and the window stops offering Set up', async () => {
    const h = makeHome();
    await failOnSettings(h);
    fixSettings(h.home);
    const app = await open(h);
    await pressSetUp(app);
    await waitForRecord(h);
    await finishedRecord(h.home, 'after the file is fixed, the app\'s Set up');
    await hubAnswers(h.home, 'after the file is fixed, the app\'s Set up');
    holds((await app.settled(finishedFailures)).failures);
    await app.stop();
    const before = written(h.home);
    ranNoSetup('the next deep command (deep status)', await deep(h.home, ['status']), before, written(h.home));
    const reopened = await open(h);
    holds((await atBothSizes(reopened, finishedFailures)).failures);
    await reopened.stop();
  }, 15 * MINUTES);

  it('#1002.8e3f037e a setup on the real window whose hub doesn\'t start writes no record; reopening offers Set up again with the reason naming the hub and the count, and with a hub that starts it finishes', async () => {
    const h = makeHome();
    fixSettings(h.home);
    const app = await open(h, { hub: 'dead' });
    await pressSetUp(app);
    holds((await app.settled(namesTheHub, SETUP_MS)).failures);
    await app.stop();
    noRecord(h.home, 'the app\'s Set up, whose hub didn\'t start,');
    const reopened = await open(h, { hub: 'dead' });
    holds((await atBothSizes(reopened, (s) => offeredFailures(s, 'hub'))).failures);
    await reopened.stop();
    const again = await open(h);
    await pressSetUp(again);
    await waitForRecord(h);
    await finishedRecord(h.home, 'the app\'s Set up, once the hub starts,');
    await again.stop();
  }, 15 * MINUTES);
});
