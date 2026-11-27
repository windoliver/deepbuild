// AC9: with the hub stopped, one entry says the hub isn't answering, none repeats over the next 60 s, and one more
// comes when it answers.
//
// A real hub's record with one finished session; the replica on a copy of it at the reference window, the session's
// page open. The hub the app reads stops answering (the replica's `hub` call, #1461's), stays stopped for 60 s of the
// replica's clock, through the app's retries every 2 s, and answers again. The app reads that it answers at its
// watch's next read of the hub, which once the hub has been down a minute comes every 30 s (#994): the clock runs
// until the window itself stops saying the hub isn't answering, and 3 s more (README, The fixtures: the hub; Readings
// 16). One run, judged twice: what was said when it stopped, and what the 60 s and its return added.
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { makeWorld } from '../2018/helpers.ts';
import { blocked, cleanup, flicks, MIN, SECOND, Stage } from './helpers.ts';
import { FLICKS, hubDown, hubQuietThenBack, ID, windowSaysDown, type HubRun } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
/** The longest the app's watch leaves between two reads of a hub that has been down a minute (#994: "every 2 s, then every 30 s after a minute"). */
const SLOWEST_RETRY_MS = 30 * SECOND;

async function run(): Promise<HubRun> {
  const w = await makeWorld({
    repos: ['shop'],
    seed: async (s, T) => {
      const at = T - 20 * MIN;
      await s.start('a', 'shop', at);
      await s.task('a', 'Cart totals', at + 1000);
      await s.prompt('a', 'sum the cart', at + 2000);
      await s.stop('a', at + 20_000, false);
    },
  });
  const stage = await Stage.on(w);
  try {
    const saysDown = async (): Promise<boolean> => windowSaysDown((await stage.d.see()).snapshot);
    await stage.d.open(`session/${w.sessions.a?.id ?? blocked('the world has no session a')}`);
    await stage.d.wait(3 * SECOND);
    const base = await stage.read();
    await stage.d.hub('stopped');
    await stage.d.wait(3 * SECOND);
    const down = await stage.read();
    // 60 s more, a frame each 250 ms of the clock, so each of the app's retries of the hub has its frame.
    await stage.d.wait(60 * SECOND, 250);
    const still = await stage.read();
    // What stops the second reading, if anything does: the first test is judged without it.
    let unread = (await saysDown()) ? undefined : 'with the hub stopped for 63 s the window doesn\'t say it isn\'t answering, so when it reads that the hub answers can\'t be told';
    await stage.d.hub('answering');
    // The hub answers from now on, and the app reads so at its watch's next read: a frame each 250 ms until the window
    // stops saying the hub isn't answering, for no longer than the watch's slowest retry and a second.
    const answered = stage.d.t;
    while (!unread && (await saysDown())) {
      if (stage.d.t - answered >= flicks(SLOWEST_RETRY_MS + SECOND)) unread = `${(SLOWEST_RETRY_MS + SECOND) / SECOND} s after the hub answered again the window still says it isn't answering, though the app's watch reads a hub that is down at least every ${SLOWEST_RETRY_MS / SECOND} s`;
      else await stage.d.wait(250, 250);
    }
    const knewAfter = Math.round(((stage.d.t - answered) * 1000) / FLICKS);
    await stage.d.wait(3 * SECOND);
    return { base, down, still, knewAfter, back: await stage.read(), ...(unread ? { unread } : {}) };
  } finally {
    await stage.stop();
  }
}
const made = shared(run);

describe(`AC9 ${ID.hub} the hub not answering is said once, and once more when it answers`, () => {
  it(`AC9 ${ID.hub}: with the hub stopped, one entry says the hub isn't answering`, async () => {
    expect(hubDown(await made())).toEqual([]);
  }, LIMIT);

  it(`AC9 ${ID.hub}: none repeats over the next 60 s, and one more comes when it answers`, async () => {
    expect(hubQuietThenBack(await made())).toEqual([]);
  }, LIMIT);
});
