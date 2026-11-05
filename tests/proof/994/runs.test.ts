// #994's Proof: the three runs on this branch with the app's log, kept in out/. Run by hand; the judges are the blind
// suite's (tests/acceptance/994), and tests/acceptance/994/BASE-FAILURE.txt holds the same runs on the merge base.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, it } from 'vitest';
import {
  CONNECTED_MS, SETTLE_MS, cleanup, doctor, holds, neverNotified, notifiedInTime, notifiedOnce, notificationsItem, openAsk, setUpWorld, sleep, startApp, startHub,
  stopHub, windowUp, type App,
} from '../../acceptance/994/helpers.ts';

afterAll(cleanup, 60_000);
const OUT = join(import.meta.dirname, 'out');
const keep = (name: string, apps: App[], extra = '') => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.log`), `${apps.map((app, i) => `# app ${i + 1}\n${app.log()}`).join('\n')}\n${extra}`);
};

it('a late hub', async () => {
  const { home, repo, hub: first } = await setUpWorld();
  await stopHub(first);
  const app = await startApp(home, 'allowed');
  await sleep(20_000);
  const hub = await startHub(home);
  await sleep(5000);
  const ask = await openAsk(hub, repo);
  const failure = await notifiedInTime(app, ask);
  keep('late-hub', [app], `# ${ask.handle} ${failure ?? 'notified in time'}\n`);
  holds(failure);
}, 600_000);

it('two launches', async () => {
  const { home, repo, hub } = await setUpWorld();
  const first = await startApp(home, 'allowed');
  await windowUp(first);
  await sleep(CONNECTED_MS);
  const second = await startApp(home, 'allowed');
  const exit = await second.exit;
  const ask = await openAsk(hub, repo);
  await sleep(SETTLE_MS);
  const failure = notifiedOnce([first, second], ask.handle);
  keep('two-launches', [first, second], `# the second exited ${exit}\n# ${ask.handle} ${failure ?? 'notified once'}\n`);
  holds(failure);
}, 600_000);

it('notifications denied', async () => {
  const { home, repo, hub } = await setUpWorld();
  const app = await startApp(home, 'denied');
  await windowUp(app);
  await sleep(CONNECTED_MS);
  const ask = await openAsk(hub, repo);
  await sleep(SETTLE_MS);
  const failure = neverNotified(app, ask.handle);
  const item = notificationsItem(await doctor(home));
  keep('denied', [app], `# ${ask.handle} ${failure ?? 'never said notified'}\n# deep doctor: ${JSON.stringify(item)}\n`);
  holds(failure);
}, 600_000);
