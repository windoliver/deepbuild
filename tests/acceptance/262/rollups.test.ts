// AC13: a series' minute and hour rollups.
//
// The shop plug-in's series source `metrics`, with a 5 s timeout, is read every 10 s by readSource on the
// controlled clock: in the 10:00 minute its checkout values arrive as 4, 1, 15, 2, 5 and 3; in the 10:01 minute the
// calls at 10:01:00, 10:01:10 and 10:01:20 get a 500 and those at 10:01:30, 10:01:40 and 10:01:50 bring 2, 2 and 2.
// Nothing else is read that hour. The hub's timer ticks after each call and then every minute to 11:00:10, past the
// hour's end plus the timeout, and the rollups are read back through the host (README, The surface under test).
import { describe, expect, it } from 'vitest';
import { json, metricsWorld, MINUTE, rollupEvents, SECOND, seriesOf, t, type Answers, type MetricsProbe } from './helpers.ts';
import { judgeRollup, type Stats } from './judges.ts';
import { wrongRollups } from './twins.ts';

const probe: MetricsProbe = {
  sources: [{ name: 'ext.shop.metrics', series: true, timeout: 5 * SECOND, quota: { per_minute: 600, per_day: 100_000 }, freshFor: SECOND }],
  views: [{ name: 'ext.shop.orders', binds: ['reading:ext.shop.metrics#checkout'] }],
};
const ARRIVALS = [[4, 1, 15, 2, 5, 3], [2, 2, 2]];
const BY_CALL = [4, 1, 15, 2, 5, 3, null, null, null, 2, 2, 2];
const answers: Answers = { 'ext.shop.metrics': (n) => (BY_CALL[n] === null || BY_CALL[n] === undefined ? json({ error: 'unavailable' }, 500) : seriesOf({ checkout: BY_CALL[n]! })) };
const WANT: { window: string; want: Partial<Stats> }[] = [
  { window: '10:00 minute', want: { min: 1, max: 15, mean: 5, last: 3, count: 6 } },
  { window: '10:01 minute', want: { mean: 2, count: 3 } },
  { window: '10:00 hour', want: { min: 1, max: 15, mean: 4, last: 2, count: 9 } },
];
const judgeAll = (got: (Partial<Stats> | undefined)[]) => WANT.flatMap((w, i) => judgeRollup(w.window, 'checkout', got[i], w.want));

describe('AC13 #262.edf5ecc6 For one series whose values in the 10:00 minute arrive in the order 4, 1, 15, 2, 5 and 3, the minute\'s rollup is min 1, max 15, mean 5, last 3 and count 6; in the 10:01 minute three calls fail and the values 2, 2 and 2 arrive, so that minute\'s rollup is mean 2 and count 3, and the 10:00 hour\'s rollup, with no other values, is min 1, max 15, mean 4, last 2 and count 9; a host that reports the median 3.5 as the mean, the maximum as last, or the hour\'s mean as the mean of minute means, 3.5, fails, naming the field', () => {
  it('AC13 the 10:00 minute: min 1, max 15, mean 5, last 3, count 6; the 10:01 minute: mean 2, count 3; the 10:00 hour: min 1, max 15, mean 4, last 2, count 9', async () => {
    const { c, w, h } = await metricsWorld(t('10:00:00'), probe, answers);
    const failed: number[] = [];
    for (let i = 0; i < BY_CALL.length; i++) {
      const at = t('10:00:00') + i * 10 * SECOND;
      c.set(at);
      const r = await h.readSource('ext.shop.metrics');
      if (r.status === 'failed') failed.push(at);
      await h.tick();
      await h.idle();
    }
    expect(failed, 'the calls that failed').toEqual([t('10:01:00'), t('10:01:10'), t('10:01:20')]);
    for (let at = t('10:02:00'); at <= t('11:00:00'); at += MINUTE) { c.set(at); await h.tick(); await h.idle(); }
    c.set(t('11:00:10'));
    await h.tick();
    await h.idle();

    const rollups = await rollupEvents(w, 'ext.shop.metrics');
    for (const [span, start] of [['minute', t('10:00:00')], ['minute', t('10:01:00')], ['hour', t('10:00:00')]] as const) {
      expect(rollups.filter((e) => (e.data as { span: string; start: number }).span === span && (e.data as { start: number }).start === start).length, `reading.rollup events for the ${span} from ${span === 'hour' ? '10:00' : new Date(start).toISOString().slice(11, 16)}`).toBe(1);
    }
    const got = [
      (await h.rollup('ext.shop.metrics', 'minute', t('10:00:00')))?.checkout,
      (await h.rollup('ext.shop.metrics', 'minute', t('10:01:00')))?.checkout,
      (await h.rollup('ext.shop.metrics', 'hour', t('10:00:00')))?.checkout,
    ];
    expect(judgeAll(got)).toEqual([]);
  }, 180_000);

  it('AC13 (wrong program) a host that reports the median as the mean, the maximum as last, or the hour\'s mean as the mean of minute means fails, naming the field', () => {
    const shown = (rule: Parameters<typeof wrongRollups>[0]) => { const r = wrongRollups(rule, ARRIVALS); return judgeAll([r.minutes[0], r.minutes[1], r.hour]); };
    expect(shown('right'), 'the right figures pass the judge').toEqual([]);
    expect(shown('median-as-mean')).toContain('the 10:00 minute rollup\'s mean of checkout is 3.5, not 5');
    expect(shown('max-as-last')).toContain('the 10:00 minute rollup\'s last of checkout is 15, not 3');
    expect(shown('mean-of-means')).toContain('the 10:00 hour rollup\'s mean of checkout is 3.5, not 4');
  });
});
