// AC1: a notice on a stale reading is refused. AC4: a plug-in can't send a notice nobody subscribed to.
//
// The market plug-in's watch job reads the price each run and sends a notice of kind ext.market.crossed for each
// subscription its probe lists (fixtures/market). You subscribe on the trusted path. A notice it may send cites the
// reading its run just got, fresh for one minute; the stale case cites, from the second run on, the reading the
// previous run got five minutes before. The controls are the notices the criteria let out.
import { describe, expect, it } from 'vitest';
import {
  at, CROSSED, marketWorld, MINUTE, priceProvider, report, step, YOU, type MarketReport,
} from './helpers.ts';
import { judgeNotices, type Attempt } from './judges.ts';

describe('AC1 #365.e88a0414 A notice on a stale reading is refused', () => {
  it('AC1 a notice citing the run\'s own fresh reading is sent; one citing a reading past its freshness is refused, and nothing records it', async () => {
    const { c, w, h } = await marketWorld(at('2026-11-03T09:55'), {
      cadence: { every: 5 * MINUTE }, freshFor: MINUTE, notices: { subscriptions: ['NVDA>200'], cite: 'previous-after-first' },
    }, (c) => priceProvider(c));
    await h.subscribeNotice(YOU, CROSSED, 'NVDA>200');
    await step(h, c, at('2026-11-03T09:55'), at('2026-11-03T10:10'));

    const { jobs } = await report<MarketReport>(h, 'ext.market.report');
    const attempts: Attempt[] = jobs.flatMap((j) => j.notices.map((n) => ({
      ...n, allowed: n.cited === j.handle, why: n.cited === j.handle ? 'the run\'s own reading, fresh' : `a reading from an earlier run, past its freshness of ${MINUTE / 1000} s`,
    })));
    expect(attempts.filter((a) => a.allowed).length, `notices citing a fresh reading (the control): ${JSON.stringify(jobs)}`).toBeGreaterThanOrEqual(1);
    expect(attempts.filter((a) => !a.allowed).length, `notices citing a stale reading: ${JSON.stringify(jobs)}`).toBeGreaterThanOrEqual(2);
    expect(judgeNotices(attempts, await w.events('notice.sent'))).toEqual([]);
  }, 180_000);
});

describe('AC4 #365.77db7849 A plug-in can\'t send a notice nobody subscribed to', () => {
  it('AC4 with you subscribed to NVDA>200 only, the plug-in\'s notice for NVDA>200 is sent and its notice for AAPL>100 is refused, and nothing records it', async () => {
    const { c, w, h } = await marketWorld(at('2026-11-03T09:55'), {
      cadence: { every: 5 * MINUTE }, notices: { subscriptions: ['AAPL>100', 'NVDA>200'], cite: 'fresh' },
    }, (c) => priceProvider(c));
    await h.subscribeNotice(YOU, CROSSED, 'NVDA>200');
    // Up to the first watch run only, so no limit on how often notices go out can refuse the control.
    let jobs: MarketReport['jobs'] = [];
    for (let t = at('2026-11-03T09:55'); !jobs.length && t <= at('2026-11-03T10:05'); t += MINUTE) {
      await step(h, c, t, t);
      jobs = (await report<MarketReport>(h, 'ext.market.report')).jobs;
    }
    const attempts: Attempt[] = jobs.flatMap((j) => j.notices.map((n) => ({
      ...n, allowed: n.subscription === 'NVDA>200', why: n.subscription === 'NVDA>200' ? 'you subscribed to it' : 'nobody subscribed to it',
    })));
    expect(attempts.filter((a) => a.subscription === 'AAPL>100').length, `notices for AAPL>100 the plug-in tried: ${JSON.stringify(jobs)}`).toBeGreaterThanOrEqual(1);
    expect(attempts.filter((a) => a.subscription === 'NVDA>200').length, `notices for NVDA>200 (the control): ${JSON.stringify(jobs)}`).toBeGreaterThanOrEqual(1);
    expect(judgeNotices(attempts, await w.events('notice.sent'))).toEqual([]);
  }, 180_000);
});
