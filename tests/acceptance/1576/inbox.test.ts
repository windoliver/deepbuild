// #1576's `deep inbox` through the pages (README): on a record of 30 live sessions, each with an open ask, and 60
// settled ones, each with an ask answered on the question card, the real `deep inbox` lists every open ask, and
// paging inbox.read from its first page finds every settled ask once (AC6).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { asApp, cleanup, deep, inboxPages, judgeListed, judgePages, onRecord, started, stopHubs, template } from './helpers.ts';

afterEach(stopHubs, 120_000);
afterAll(cleanup, 120_000);

describe('AC6 #1576.84557f89 `deep inbox` still lists every open ask, and paging finds every settled one', () => {
  it('AC6 #1576.84557f89 with 30 open asks and 60 settled, deep inbox lists the 30, and inbox.read\'s pages, followed from the first, hold each of the 60 once', async () => {
    const t = await template({ sessions: 90, live: 30, asks: 60 });
    const hub = started(await onRecord(t));
    expect(judgeListed(t.fixture.open, await deep(hub.home, ['inbox'], { timeoutMs: 120_000 }))).toBeNull();
    const app = await asApp(hub);
    expect(judgePages(t.fixture.open, t.fixture.settled, await inboxPages(app))).toBeNull();
  }, 1_800_000);
});
