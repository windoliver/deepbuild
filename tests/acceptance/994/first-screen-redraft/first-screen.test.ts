// #994's first screen on the real window: the count while the hub isn't answering, and an open ask's row with
// notifications denied. The real `deep-app` beside a real hub in a temp home, read from outside its process (nodes,
// pixels, menu bar) at the size it opens at and at the reference window. Never the replica. The OS's setting is the one
// stand-in, DEEP_APP_NOTIFICATION_SETTING, since no test may change System Settings. macOS only: elsewhere each fails BLOCKED.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, cleanup, rootOf, setUpWorld, sleep, startHub, stopHub } from '../helpers.ts';
import { atBothSizes, inconclusive, loaded, type Seen } from '../../1002/first-screen-redraft/window.ts';
import { answeringFailures, askedRow, hubCountFailures, notifiedRowFailures, open, rowFailures } from './helpers.ts';

afterAll(cleanup, 60_000);

const MINUTES = 60_000;
/** Two retries of the 2 s schedule, and a tick: how soon the count follows the hub on a machine that isn't overloaded. */
const FOLLOWS_MS = 8000;
const holds = (failures: string[]): void => { if (failures.length) expect.fail(`#994 ${failures.join('\n')}`); };
/** The count must follow within FOLLOWS_MS; late on a loaded machine is a reading, not a failure; never is a failure. */
async function follows(app: Awaited<ReturnType<typeof open>>, judge: (s: Seen) => string[]): Promise<void> {
  const quick = await app.settled(judge, FOLLOWS_MS);
  if (!quick.failures.length) return;
  if (!loaded()) holds(quick.failures);
  const late = await app.settled(judge, 2 * MINUTES);
  holds(late.failures);
  inconclusive(`the count followed the hub, but past ${FOLLOWS_MS} ms on a loaded machine`);
}

describe('#994 the real window\'s count says the hub isn\'t answering', () => {
  it('#994 scope: started with no hub answering, the count says so, with no number', async () => {
    const { home, hub } = await setUpWorld();
    await stopHub(hub);
    const app = await open(home, 'allowed');
    holds((await atBothSizes(app, hubCountFailures)).failures);
    await app.stop();
  }, 15 * MINUTES);

  it('#994 scope: the count follows the hub: a number while it answers, the hub isn\'t answering once it stops, a number again once it\'s back', async () => {
    const { home, hub } = await setUpWorld();
    const app = await open(home, 'allowed');
    holds((await app.settled((s) => answeringFailures(s, 0))).failures);
    await stopHub(hub);
    await follows(app, hubCountFailures);
    await startHub(home);
    await follows(app, (s) => answeringFailures(s, 0));
    await app.stop();
  }, 15 * MINUTES);

  it('#994 scope: a refused read is shown the same way: with a hub up that refuses the app\'s token, the count says the hub isn\'t answering', async () => {
    const { home, hub } = await setUpWorld();
    writeFileSync(join(rootOf(home), 'control.token'), 'a token this hub never wrote\n');
    const app = await open(home, 'allowed');
    holds((await atBothSizes(app, hubCountFailures)).failures);
    await app.stop();
    await stopHub(hub);
  }, 15 * MINUTES);

  it('#994 (wrong program) a planted spike window, whose made-up count knows no hub, fails naming the count', async () => {
    const { home, hub } = await setUpWorld();
    await stopHub(hub);
    const app = await open(home, 'allowed', 'plant-spike-window');
    const { failures } = await app.settled(hubCountFailures, 20_000);
    await app.stop();
    expect(failures.join('\n')).toMatch(/the count must say the hub isn't answering/);
  }, 30 * MINUTES);
});

describe(`${AC3} the real window's row`, () => {
  it(`${AC3} with notifications denied, an open ask's row on the real window says not notified`, async () => {
    const { home, repo, hub } = await setUpWorld();
    const app = await open(home, 'denied');
    await sleep(3000);
    const ask = await askedRow(hub, repo);
    holds((await atBothSizes(app, (s) => rowFailures(s, ask))).failures);
    await app.stop();
  }, 15 * MINUTES);

  it(`${AC3} (control) with notifications allowed, the same row says nothing of the kind`, async () => {
    const { home, repo, hub } = await setUpWorld();
    const app = await open(home, 'allowed');
    await sleep(3000);
    const ask = await askedRow(hub, repo);
    holds((await app.settled((s) => notifiedRowFailures(s, ask))).failures);
    await app.stop();
  }, 15 * MINUTES);

  it(`${AC3} planted: an app that posts without checking draws a row that doesn't say so, and fails naming the ask`, async () => {
    const { home, repo, hub } = await setUpWorld();
    const app = await open(home, 'denied', 'plant-posts-unchecked');
    await sleep(3000);
    const ask = await askedRow(hub, repo);
    const { failures } = await app.settled((s) => rowFailures(s, ask), 20_000);
    await app.stop();
    const said = failures.join('\n');
    expect(said).toContain(ask.handle);
    expect(said).toMatch(/must say not notified/);
  }, 30 * MINUTES);
});
