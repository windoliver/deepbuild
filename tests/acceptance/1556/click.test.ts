// #1556, the click (README): one Set up click through the replica (`deep-replica --first-screen --click "Set up"`,
// pinned here) with a planted `deep` first on PATH, judged on the frames the window draws after it, by their wall-clock
// time and accessibility names. macOS only: elsewhere every test fails BLOCKED.

import { afterAll, describe, it } from 'vitest';
import { cleanup, clickSetUp, judgeFailing, judgeSlow, makeHome, onMac } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#1556 the Set up click runs setup off the UI thread', () => {
  it('#1556.784e6b2f with a planted deep that sleeps 3 s, the window draws a frame within 100 ms of the click and shows it\'s working, keeps drawing until setup ends, then shows the one line', async () => {
    onMac();
    judgeSlow(await clickSetUp(makeHome('slow')));
  }, 1_800_000);

  it('#1556.ff055ca3 a planted failing deep still shows its one-line error', async () => {
    onMac();
    judgeFailing(await clickSetUp(makeHome('failing')));
  }, 1_800_000);
});
