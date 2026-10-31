// AC2: a schedule never overlaps itself and catches up once after sleep. AC12: a schedule last run at 08:00 and
// edited at 09:00 shows its last result from 08:00; a list that shows 09:00 as the last run fails this test.
//
// The market plug-in's watch schedule on a controlled clock: each step moves the clock, runs the hub's timer (`tick`)
// and waits for what it started (`idle`), except where a run is held on purpose. The plug-in counts the watch jobs it
// has running at once, so an overlap shows on its side too, whatever the hub's records say.
import { describe, expect, it } from 'vitest';
import { at, gate, json, marketWorld, MINUTE, priceProvider, report, rowOf, runsOf, sleep, step, WATCH, waitUntil, YOU, type MarketReport } from './helpers.ts';
import { judgeCatchUp, judgeLast, judgeOverlap } from './judges.ts';
import { lastFromSaved } from './twins.ts';

describe('AC2 #365.97c8a041 A schedule never overlaps itself and catches up once after sleep', () => {
  it('AC2 a five-minute run held from 10:00 to 10:20 has no second run beside it, and at most one follows it for the slots it covered', async () => {
    const held = gate();
    const { c, h, api } = await marketWorld(at('2026-11-03T09:55'), { cadence: { every: 5 * MINUTE }, deadline: 60 * MINUTE }, (c) => priceProvider(c, async (_n, req) => {
      if (req.at === at('2026-11-03T10:00')) await held.wait;
      return json({ price: 187.25 });
    }));
    await step(h, c, at('2026-11-03T09:55'), at('2026-11-03T09:59'));
    c.set(at('2026-11-03T10:00'));
    await h.tick();
    await waitUntil(() => api.seen.some((s) => s.at === at('2026-11-03T10:00')), 20_000, 'the 10:00 run\'s price call');
    // The run is held at its price call while the clock passes four more slots.
    for (let t = at('2026-11-03T10:01'); t <= at('2026-11-03T10:20'); t += MINUTE) {
      c.set(t);
      await h.tick();
      await sleep(25);
    }
    await sleep(500);
    const during = (await runsOf(h, WATCH)).filter((r) => r.dispatched !== null && r.dispatched > at('2026-11-03T10:00'));
    expect(during.map((r) => r.run), 'runs started while the 10:00 run was held').toEqual([]);
    held.open();
    await h.idle();
    await step(h, c, at('2026-11-03T10:21'), at('2026-11-03T10:24'));

    const runs = await runsOf(h, WATCH);
    const { most } = await report<MarketReport>(h, 'ext.market.report');
    expect(judgeOverlap(runs, most)).toEqual([]);
    const after = runs.filter((r) => r.dispatched !== null && r.dispatched >= at('2026-11-03T10:20') && r.dispatched < at('2026-11-03T10:25'));
    expect(after.length, `runs between the held run's end at 10:20 and 10:25, for the four slots it covered: ${JSON.stringify(after)}`).toBeLessThanOrEqual(1);
  }, 180_000);

  it('AC2 after an hour asleep from 10:01 to 11:02, the five-minute schedule runs once on waking, then keeps its cadence', async () => {
    const { c, h } = await marketWorld(at('2026-11-03T09:55'), { cadence: { every: 5 * MINUTE } }, (c) => priceProvider(c));
    await step(h, c, at('2026-11-03T09:55'), at('2026-11-03T10:01'));
    // Asleep: no tick between 10:01 and 11:02, as the computer's timers don't fire.
    await step(h, c, at('2026-11-03T11:02'), at('2026-11-03T11:11'));

    const runs = await runsOf(h, WATCH);
    const { most } = await report<MarketReport>(h, 'ext.market.report');
    expect(judgeOverlap(runs, most)).toEqual([]);
    expect(judgeCatchUp(runs, at('2026-11-03T11:02'), at('2026-11-03T11:05'), 'on waking at 11:02 after 12 slots missed')).toEqual([]);
    const later = runs.filter((r) => r.dispatched !== null && r.dispatched >= at('2026-11-03T11:05'));
    expect(later.length, `runs from 11:05 to 11:11, the cadence again: ${JSON.stringify(later)}`).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

describe('AC12 #365.3ca5abe2 A schedule last run at 08:00 and edited at 09:00 shows its last result from 08:00; a list that shows 09:00 as the last run fails this test', () => {
  const scenario = async () => {
    const { c, h } = await marketWorld(at('2026-11-03T07:58'), { cadence: { cron: '0 8 * * *' } }, (c) => priceProvider(c));
    await step(h, c, at('2026-11-03T07:58'), at('2026-11-03T08:01'));
    const ran = (await runsOf(h, WATCH)).filter((r) => r.dispatched !== null);
    expect(ran.map((r) => ({ at: r.dispatched, verdict: r.verdict })), 'the schedule ran once, at 08:00').toEqual([{ at: at('2026-11-03T08:00'), verdict: 'PASS' }]);
    c.set(at('2026-11-03T09:00'));
    await h.editSchedule(YOU, WATCH, { cron: '0 10 * * *' });
    await h.tick();
    await h.idle();
    return h;
  };

  it('AC12 edited at 09:00, the row\'s last result is the 08:00 run\'s', async () => {
    const h = await scenario();
    const row = await rowOf(h, WATCH);
    expect(judgeLast(row, at('2026-11-03T08:00'), at('2026-11-03T09:00'))).toEqual([]);
    expect(row.last?.verdict, 'the last result is the 08:00 run\'s verdict').toBe('PASS');
  }, 120_000);

  it('AC12 (wrong program) a list that takes the last run from when the schedule was saved fails, showing 09:00', async () => {
    const h = await scenario();
    const row = lastFromSaved(await h.schedules(), WATCH, at('2026-11-03T09:00')).find((r) => r.name === WATCH);
    const problems = judgeLast(row, at('2026-11-03T08:00'), at('2026-11-03T09:00'));
    expect(problems.join('\n')).toMatch(/shows 09:00, when the schedule was edited, as the last run/);
  }, 120_000);
});
