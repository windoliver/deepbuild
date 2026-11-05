// AC6: a five-minute price schedule on a controlled clock, its market key removed at 00:00 and not added back, gives
// in 24 hours one BLOCKED claim naming the key and no runs after the first; a schedule that keeps running records 288
// FAILs and fails this test, naming the count. In a second run, adding the key back at 12:02 starts a run at 12:02,
// and the claim passes on the reading it records.
// AC7: with the recorded source answering 429 to the 10:00 run and to the next two calls, then answering, the 10:00
// run is INCONCLUSIVE, calls go to the source at 10:05, 10:15 and 10:35, the schedule resumes after the third, and no
// run is FAIL; with it answering 400 to every call, runs end FAIL at 10:00, 10:10, 10:30, 11:10 and 12:30, and the
// schedule then pauses with you as the claim's owner and makes no run until you resume it. A schedule that keeps its
// five-minute cadence through either, records the 429s as FAIL, or pauses before the fifth FAIL fails, naming the run.
//
// The market plug-in's watch schedule, every five minutes, loaded at a five-minute mark so every reading of when its
// first run comes puts runs at :00 and :05. The provider standing in for api.market.example answers each call by the
// controlled clock's time (the recorded answers: 200 before 10:00). The wrong schedulers (twins.ts) read the price
// through the same real host, provider and clock, with the host's own schedule never due (a cron line for 1 January).
import { describe, expect, it } from 'vitest';
import {
  at, json, KEY, marketWorld, MARKET_ID, MINUTE, priceProvider, removeKey, rowOf, runsOf, step, WATCH, YOU, type Clock, type Provider, type Reply,
} from './helpers.ts';
import { judgeFailSpacing, judgeMissingKey, judgeRateLimit } from './judges.ts';
import { keepsRunning, wrongScheduler, type Wrong } from './twins.ts';

const DAY0 = '2026-11-03';
const T = (hm: string) => at(`${DAY0}T${hm}`);
const NEVER = { cron: '0 0 1 1 *' };

describe('AC6 #365.84ae7874 A five-minute price schedule on a controlled clock, its market key removed at 00:00 and not added back, gives in 24 hours one BLOCKED claim naming the key and no runs after the first; a schedule that keeps running records 288 FAILs and fails this test, naming the count. In a second run, adding the key back at 12:02 starts a run at 12:02, and the claim passes on the reading it records', () => {
  it('AC6 the key removed at 00:00 and never added back: in 24 hours one BLOCKED claim naming market_key, and no run after it', async () => {
    const { c, h, api } = await marketWorld(at('2026-11-02T23:50'), { cadence: { every: 5 * MINUTE } }, (c) => priceProvider(c));
    await step(h, c, at('2026-11-02T23:50'), at('2026-11-02T23:59'));
    c.set(T('00:00'));
    expect((await removeKey(h)).sort(), 'what removing the key listed').toContain(WATCH);
    await step(h, c, T('00:00'), T('23:59'));
    const runs = await runsOf(h, WATCH);
    expect(judgeMissingKey(runs, T('00:00'), T('00:00') + 24 * 60 * MINUTE, 'market_key')).toEqual([]);
    expect(api.seen.filter((s) => s.at >= T('00:00')).length, 'calls to the source after the key went').toBe(0);
  }, 300_000);

  it('AC6 (wrong program) a schedule that keeps running records 288 FAILs in the 24 hours, named by the count', async () => {
    const { c, h } = await marketWorld(at('2026-11-02T23:50'), { cadence: NEVER }, (c) => priceProvider(c));
    c.set(T('00:00'));
    await removeKey(h);
    const runs = await keepsRunning(h, c, T('00:00'), T('00:00') + 24 * 60 * MINUTE);
    const problems = judgeMissingKey(runs, T('00:00'), T('00:00') + 24 * 60 * MINUTE, 'market_key');
    expect(problems.join('\n')).toMatch(/the schedule recorded 288 runs in the 24 hours after the key went \(288 FAIL, 0 BLOCKED\)/);
  }, 300_000);

  it('AC6 the key removed at 00:00 and added back at 12:02: one BLOCKED claim before, then a run at 12:02 that passes on the reading it records', async () => {
    const { c, w, h } = await marketWorld(at('2026-11-02T23:50'), { cadence: { every: 5 * MINUTE } }, (c) => priceProvider(c));
    await step(h, c, at('2026-11-02T23:50'), at('2026-11-02T23:59'));
    c.set(T('00:00'));
    await removeKey(h);
    await step(h, c, T('00:00'), T('12:01'));
    c.set(T('12:02'));
    const entered = await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
    expect(entered.saved, JSON.stringify(entered)).toBe(true);
    await h.tick();
    await h.idle();

    const runs = await runsOf(h, WATCH);
    expect(judgeMissingKey(runs, T('00:00'), T('12:02'), 'market_key')).toEqual([]);
    const back = runs.find((r) => r.dispatched === T('12:02'));
    expect(back, `a run at 12:02, as the key came back: ${JSON.stringify(runs.filter((r) => r.due >= T('12:00')))}`).toBeDefined();
    expect(back!.verdict, `the 12:02 run: ${JSON.stringify(back)}`).toBe('PASS');
    const readings = (await w.events('reading.recorded')).map((e) => e.data as { reading: string; as_of: number; source: string });
    const cited = back!.changes.filter((ch) => readings.some((r) => r.reading === ch && r.as_of === T('12:02') && r.source === 'ext.market.price'));
    expect(cited.length, `the 12:02 run passes on the reading it recorded at 12:02: changes ${JSON.stringify(back!.changes)}, readings ${JSON.stringify(readings.slice(-3))}`).toBe(1);
  }, 300_000);
});

/** A provider answering by the clock: 200 before 10:00, then `from10(n)` for the n-th call from 10:00 on. */
const byClock = (from10: (n: number) => Reply) => (c: Clock): Promise<Provider> => {
  let n = 0;
  return priceProvider(c, (_i, req) => (req.at < T('10:00') ? json({ price: 187.25 }) : from10(n++)));
};
const limited = byClock((n) => (n < 3 ? json({ error: 'rate limited' }, 429) : json({ price: 187.25 })));
const refused = byClock(() => json({ error: 'bad request' }, 400));
const RATE = { first: T('10:00'), calls: [T('10:00'), T('10:05'), T('10:15'), T('10:35')], resumedBy: T('10:40') };
const FAILS = [T('10:00'), T('10:10'), T('10:30'), T('11:10'), T('12:30')];
const calls = (api: Provider) => api.seen.filter((s) => s.url.startsWith('/q')).map((s) => s.at);

describe('AC7 #365.fe146d14 With the recorded source answering 429 to the 10:00 run and to the next two calls, then answering, the 10:00 run is INCONCLUSIVE, calls go to the source at 10:05, 10:15 and 10:35, the schedule resumes after the third, and no run is FAIL; with it answering 400 to every call, runs end FAIL at 10:00, 10:10, 10:30, 11:10 and 12:30, and the schedule then pauses with you as the claim\'s owner and makes no run until you resume it. A schedule that keeps its five-minute cadence through either, records the 429s as FAIL, or pauses before the fifth FAIL fails, naming the run', () => {
  it('AC7 429 to the 10:00 run and the next two calls: the 10:00 run is INCONCLUSIVE, calls at 10:05, 10:15 and 10:35, then the schedule resumes, and no run is FAIL', async () => {
    const { c, h, api } = await marketWorld(T('09:55'), { cadence: { every: 5 * MINUTE } }, limited);
    await step(h, c, T('09:55'), T('11:00'));
    expect(judgeRateLimit(await runsOf(h, WATCH), calls(api), RATE)).toEqual([]);
  }, 300_000);

  it('AC7 400 to every call: runs end FAIL at 10:00, 10:10, 10:30, 11:10 and 12:30, then the schedule pauses with you as the claim\'s owner and runs nothing until you resume it', async () => {
    const { c, h } = await marketWorld(T('09:55'), { cadence: { every: 5 * MINUTE } }, refused);
    await step(h, c, T('09:55'), T('18:00'));
    expect(judgeFailSpacing(await runsOf(h, WATCH), FAILS, T('18:00'), await rowOf(h, WATCH))).toEqual([]);
    await h.resumeSchedule(YOU, WATCH);
    await step(h, c, T('18:00'), T('18:05'));
    const resumed = (await runsOf(h, WATCH)).filter((r) => r.dispatched !== null && r.dispatched >= T('18:00'));
    expect(resumed.length, 'runs once you resumed it at 18:00').toBeGreaterThanOrEqual(1);
    expect((await rowOf(h, WATCH)).state, 'the schedule after you resumed it').toBe('on');
  }, 300_000);

  const wrong = async (w: Wrong, api: (c: Clock) => Promise<Provider>, until: string) => {
    const { c, h, api: server } = await marketWorld(T('09:55'), { cadence: NEVER }, api);
    const out = await wrongScheduler(h, c, w, T('10:00'), T(until));
    return { ...out, calls: calls(server) };
  };

  it('AC7 (wrong program) a schedule that keeps its five-minute cadence through the 429s fails, naming the run at 10:10', async () => {
    const r = await wrong('keeps-cadence', limited, '11:00');
    expect(judgeRateLimit(r.runs, r.calls, RATE).join('\n')).toMatch(/a call to the source at 10:10 \(run:model1010\) while the schedule should hold/);
  }, 300_000);

  it('AC7 (wrong program) a schedule that keeps its five-minute cadence through the 400s fails, naming the run at 10:05', async () => {
    const r = await wrong('keeps-cadence', refused, '18:00');
    expect(judgeFailSpacing(r.runs, FAILS, T('18:00'), r.row).join('\n')).toMatch(/the 10:05 run \(run:model1005\) ran \(FAIL\) where the schedule should wait or be paused/);
  }, 300_000);

  it('AC7 (wrong program) a schedule that records the 429s as FAIL fails, naming the 10:00 run', async () => {
    const r = await wrong('429-as-fail', limited, '11:00');
    expect(judgeRateLimit(r.runs, r.calls, RATE).join('\n')).toMatch(/the 10:00 run \(run:model1000\) reads FAIL, not INCONCLUSIVE/);
  }, 300_000);

  it('AC7 (wrong program) a schedule that pauses before the fifth FAIL fails, naming the run at 12:30', async () => {
    const r = await wrong('pauses-early', refused, '18:00');
    expect(judgeFailSpacing(r.runs, FAILS, T('18:00'), r.row).join('\n')).toMatch(/no run at 12:30: the schedule paused or waited before its fifth FAIL/);
  }, 300_000);
});
