// #994, the hub's side: `deep doctor`'s app.notifications through the real doctor. The app's half of the report is the pinned `notifications.report`,
// sent here by a connection that says hello as the app; app.test.ts proves the real app sends it. No Rust beyond
// deep-hook is built. Written blind from the issue, the design and the base commit 58862789.
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, cleanup, connectAsApp, doctor, failsNamingSetting, notificationsItem, setUpWorld } from './helpers.ts';

afterAll(cleanup, 60_000);

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

// The Scope line's deadline tests moved to deadline-redraft/, the blind redraft that replaced them on the owner's call
// (Nov 5): a single step past the deadline raced the ask's first showing and its minimum notice.
