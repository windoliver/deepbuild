// #994, the hub's side: `deep doctor`'s app.notifications through the real doctor, and an ask's deadline while
// notifications are off, on the hub's test clock. The app's half of the report is the pinned `notifications.report`,
// sent here by a connection that says hello as the app; app.test.ts proves the real app sends it. No Rust beyond
// deep-hook is built. Written blind from the issue, the design and the base commit 58862789.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC3, allEvents, cleanup, connectAsApp, doctor, failsNamingSetting, inboxRows, notificationsItem, openAsk, setUpWorld, sleep, startSteppingHub, control,
  within, type Hub, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const stepClock = (hub: Hub, ms: number) => control(hub, (conn) => conn.call('test.clock', { advance_ms: ms }));
const defaulted = async (hub: Hub, ask: string) => (await allEvents(hub)).find((e) => e.kind === 'ask.defaulted' && e.subject === ask);
const editDeadline = (config: Line) => { config.asks = { ...(config.asks ?? {}), deadline: { taste: '1m', authority: '1m', unblock: '1m', exception: '1m', choice: '1m', definition: '1m' } }; };
/** Past the 1 m wait your settings give, plus the 1 s job that applies a default. */
const PAST_DEADLINE_MS = 90_000;
const TICK_MS = 8000;
/** On a loaded machine the 1 s job has been seen to take well over 8 s to apply a default that was due. */
const ENDS_WITHIN_MS = 30_000;

describe(`${AC3} deep doctor reads the app's setting`, () => {
  it(`${AC3} app.notifications fails naming the setting for denied and for alerts set to none, reads ok when allowed, and never ok with no reading`, async () => {
    const { home, hub } = await setUpWorld();
    const unread = notificationsItem(await doctor(home));
    if (unread?.level === 'ok') expect.fail(`#994 with no reading from the app, app.notifications must not read ok: ${JSON.stringify(unread)}`);
    const app = await connectAsApp(hub);
    await app.report('denied');
    failsNamingSetting(await doctor(home), /allow notifications/i);
    await app.report('alerts_none');
    failsNamingSetting(await doctor(home), /alert style/i);
    await app.report('allowed');
    const ok = notificationsItem(await doctor(home));
    if (ok?.level !== 'ok') expect.fail(`#994 allowed, app.notifications should read ok: ${JSON.stringify(ok)}`);
    app.close();
  }, 900_000);
});

describe('#994 scope: with notifications off, an ask\'s deadline counts only time it was seen', () => {
  it('#994 scope: unseen with notifications off, an ask stays open past its deadline, and takes its default once they are allowed and its wait has passed', async () => {
    const { repo, hub } = await setUpWorld(startSteppingHub, editDeadline);
    const app = await connectAsApp(hub);
    await app.report('denied');
    const ask = await openAsk(hub, repo);
    await stepClock(hub, PAST_DEADLINE_MS);
    await sleep(TICK_MS);
    const early = await defaulted(hub, ask.handle);
    if (early) expect.fail(`#994 ${ask.handle} was never seen, with notifications off, so its deadline must not run out: ${JSON.stringify(early).slice(0, 400)}`);
    const row = (await inboxRows(hub)).find((r) => r.ask === ask.handle);
    if (!row || row.status === 'closed') expect.fail(`#994 ${ask.handle} should still be open: ${JSON.stringify(row)}`);
    // Every ask ends: allowed again, it notifies, and its wait counts.
    await app.report('allowed');
    await stepClock(hub, PAST_DEADLINE_MS);
    const ended = await within(ENDS_WITHIN_MS, () => defaulted(hub, ask.handle));
    if (!ended) expect.fail(`#994 ${ask.handle}: with notifications allowed again and its wait past, it should take its default`);
    app.close();
  }, 900_000);

  it('#994 scope (the control): with notifications allowed, the same ask takes its default at its deadline', async () => {
    const { repo, hub } = await setUpWorld(startSteppingHub, editDeadline);
    const app = await connectAsApp(hub);
    await app.report('allowed');
    const ask = await openAsk(hub, repo);
    await stepClock(hub, PAST_DEADLINE_MS);
    const ended = await within(ENDS_WITHIN_MS, () => defaulted(hub, ask.handle));
    if (!ended) expect.fail(`#994 ${ask.handle}: allowed, it should take its default at its deadline`);
    app.close();
  }, 900_000);
});
