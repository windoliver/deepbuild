// AC15, AC16, AC17: thirty days of a 500-series source, its files aging and what citations keep.
//
// The shop plug-in's series source `fleet` returns 500 named values a call (svc000 … svc499), each a function of
// the call's time, and declares a 5 s timeout. On the controlled clock from day 1 it is read once a minute, at 5 s past
// each minute, for 30 days (43,200 calls; README, Readings: a row and a rollup file are per window, not per call, so a
// call a minute makes the same 43,920 windows a call every 10 s does), and on day 1 also at 10:00:35, 14:00:00 and
// 15:00:00. The hub's timer ticks after each call. On day 1 a notice cites the 14:00:00 batch (you subscribed; the
// plug-in's ext.shop.notify sends it citing that batch's handle) and a decision cites the 15:00:00 batch (the core
// appends decision.created with that batch's file as its evidence, as the hub records a decision's evidence). "That
// value" is svc000 pinned to the log position of the 10:00:05 batch on day 1. The run goes once; each test waits for
// the point on the clock its criterion reads: day 3 and day 9 at 10:00:30, day 31 at 00:00:10 (the 30 days closed),
// and day 32 at 10:00:30 (no calls after day 30; the timer ticks).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ulid, type Row } from '../../../packages/record/src/index.ts';
import { batchAt, batchHandle, CORE, count, DAY, DAY1, fileOf, LATENCY, metricsWorld, MINUTE, named, notify, rollupEvents, SECOND, seriesOf, t, YOU, type Answers, type Metrics, type MetricsProbe, type RollupData } from './helpers.ts';
import { judgeAged, judgeCitedOpens, judgeRows, type Resolved } from './judges.ts';
import { dropsCited } from './twins.ts';

const SERIES = 500;
const HANDLE = 'reading:ext.shop.fleet#svc000';
const probe: MetricsProbe = {
  sources: [{ name: 'ext.shop.fleet', series: true, timeout: 5 * SECOND, quota: { per_minute: 600, per_day: 100_000 }, freshFor: SECOND }],
  views: [{ name: 'ext.shop.fleet', binds: [HANDLE] }],
};
const valueAt = (at: number, i: number): number => ((Math.floor(at / 1000) * 13 + i * 7) % 1000) / 10;
const answers: Answers = { 'ext.shop.fleet': (_n, at) => seriesOf(named(SERIES, (i) => valueAt(at, i))) };
/** svc000 at 10:00:05 (the raw value), at 10:00:35 (the 10:00 minute's last) and at 10:59:05 (the 10:00 hour's last). */
const RAW = valueAt(t('10:00:05'), 0);
const MINUTE_LAST = valueAt(t('10:00:35'), 0);
const HOUR_LAST = valueAt(t('10:59:05'), 0);
const AT14 = valueAt(t('14:00:00'), 0);
const AT15 = valueAt(t('15:00:00'), 0);
const ROLLUP_BYTES = 250_000_000;

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}
interface Cited { pinned: number; file: string }
interface Day3 { v: Resolved; notice: { held: boolean; got: Resolved }; decision: { held: boolean; got: Resolved }; rawGone: boolean; twinHeld: Record<string, boolean>; notice14: Cited; decision15: Cited }
interface Day31 { rows: number; rollupBytes: number; minuteFiles: number; hourFiles: number }
interface Day32 { v: Resolved; decision: { held: boolean; got: Resolved } }
const seen = { day3: deferred<Day3>(), day9: deferred<Resolved>(), day31: deferred<Day31>(), day32: deferred<Day32>() };

let started: Promise<void> | undefined;
/** The 30 days, run once, resolving each point's observations as the clock reaches it. */
function thirtyDays(): Promise<void> {
  started ??= (async () => {
    const m: Metrics = await metricsWorld(DAY1, probe, answers);
    const { c, w, h } = m;
    await h.subscribeNotice(YOU, LATENCY, 'latency');
    let pinned = 0;
    let notice14: Cited | undefined;
    let decision15: Cited | undefined;
    const resolved = async (pin: number): Promise<Resolved> => (await h.boundValues([HANDLE], { log_pos: pin }))[0]!;
    const opens = async (cited: Cited) => ({ held: (await w.evidence.get(cited.file)) !== undefined, got: await resolved(cited.pinned) });
    const tickAt = async (at: number) => { c.set(at); await h.tick(); await h.idle(); };
    const checkpoints: [number, () => Promise<void>][] = [
      [t('10:00:30', 3), async () => {
        const raw = await batchAt(w, 'ext.shop.fleet', t('10:00:05'));
        seen.day3.resolve({
          v: await resolved(pinned), notice: await opens(notice14!), decision: await opens(decision15!), rawGone: (await w.evidence.get(fileOf(raw))) === undefined,
          twinHeld: await dropsCited(w, [notice14!.file, decision15!.file], c.now()), notice14: notice14!, decision15: decision15!,
        });
      }],
      [t('10:00:30', 9), async () => { seen.day9.resolve(await resolved(pinned)); }],
    ];
    const read = async (at: number) => {
      while (checkpoints.length && checkpoints[0]![0] <= at) {
        const [when, observe] = checkpoints.shift()!;
        await tickAt(when);
        await observe();
      }
      c.set(at);
      const r = await h.readSource('ext.shop.fleet');
      if (r.status === 'failed' || r.status === 'BLOCKED') throw Error(`the fleet call at ${new Date(at).toISOString()} made no batch: ${JSON.stringify(r)}`);
      await h.tick();
      await h.idle();
    };
    for (let day = 1; day <= 30; day++) {
      for (let minute = 0; minute < 1_440; minute++) {
        const at = DAY1 + (day - 1) * DAY + minute * MINUTE;
        if (day === 1 && at === t('14:00:00')) {
          await read(at);
          const batch = await batchAt(w, 'ext.shop.fleet', at);
          notice14 = { pinned: batch.log_pos, file: fileOf(batch) };
          const sent = await notify(h, 'latency', 'latency@14:00', [batchHandle(batch)]);
          if (!sent.ok) throw Error(`the notice citing the 14:00:00 batch wasn't sent: ${JSON.stringify(sent)}`);
        }
        if (day === 1 && at === t('15:00:00')) {
          await read(at);
          const batch = await batchAt(w, 'ext.shop.fleet', at);
          decision15 = { pinned: batch.log_pos, file: fileOf(batch) };
          const now = c.now();
          await w.record.append(CORE, {
            v: 1, id: ulid(now), kind: 'decision.created', ts: now, evidence: [decision15.file],
            data: { key: createHash('sha256').update('keep the 15:00:00 batch').digest('hex'), scope: 'all', answer: 'keep', ask: `ask:${ulid(now)}` },
          });
        }
        await read(at + 5 * SECOND);
        if (day === 1 && at === t('10:00:00')) {
          pinned = (await batchAt(w, 'ext.shop.fleet', t('10:00:05'))).log_pos;
          await read(t('10:00:35'));
        }
      }
    }
    await tickAt(t('00:00:10', 31));
    const rows = (await w.record.table('rollups')).rows.filter((r: Row) => r.source === 'ext.shop.fleet' && (r.start as number) >= DAY1 && (r.start as number) < t('00:00:00', 31)).length;
    let rollupBytes = 0;
    const files = { minute: 0, hour: 0 };
    for (const e of await rollupEvents(w, 'ext.shop.fleet')) {
      const d = e.data as unknown as RollupData;
      const held = await w.evidence.get(d.file);
      if (!held) continue;
      rollupBytes += held.size;
      files[d.span]++;
    }
    seen.day31.resolve({ rows, rollupBytes, minuteFiles: files.minute, hourFiles: files.hour });
    await tickAt(t('10:00:30', 32));
    seen.day32.resolve({ v: await resolved(pinned), decision: await opens(decision15!) });
  })().catch((e) => { for (const d of Object.values(seen)) d.reject(e); throw e; });
  started.catch(() => undefined);
  return started;
}
const LONG = 4 * 3_600_000;

describe('AC15 #262.7b9efe91 On a test clock, a notice cites the 14:00:00 batch on day 1 and a decision cites the 15:00:00 batch. On day 3, a value at 10:00:05 on day 1 resolves to the 10:00 minute rollup and shows its `last`, marked rollup, and the notice still opens the 14:00:00 batch; on day 9 that value resolves to the 10:00 hour rollup', () => {
  it('AC15 the figures tell the raw value, the minute\'s last and the hour\'s last apart', () => {
    expect(new Set([RAW, MINUTE_LAST, HOUR_LAST]).size, `svc000 at 10:00:05 (${RAW}), 10:00:35 (${MINUTE_LAST}) and 10:59:05 (${HOUR_LAST})`).toBe(3);
  });

  it('AC15 on day 3 the 10:00:05 value resolves to the 10:00 minute rollup\'s last, marked rollup, its batch\'s file gone, and the notice still opens the 14:00:00 batch', async () => {
    void thirtyDays();
    const d = await seen.day3.promise;
    expect(judgeAged(HANDLE, 'day 3', d.v, { status: 'rollup', span: 'minute', value: MINUTE_LAST })).toEqual([]);
    expect(d.rawGone, 'the uncited 10:00:05 batch\'s file, past 24 hours').toBe(true);
    expect(judgeCitedOpens('notice', '14:00:00', 'day 3', d.notice.held, d.notice.got, AT14)).toEqual([]);
    expect(judgeCitedOpens('decision', '15:00:00', 'day 3', d.decision.held, d.decision.got, AT15)).toEqual([]);
  }, LONG);

  it('AC15 on day 9 that value resolves to the 10:00 hour rollup\'s last, marked rollup', async () => {
    void thirtyDays();
    expect(judgeAged(HANDLE, 'day 9', await seen.day9.promise, { status: 'rollup', span: 'hour', value: HOUR_LAST })).toEqual([]);
  }, LONG);
});

describe('AC16 #262.ddd70a8f On day 32 that value reads missing, shown as a dash, and the decision still opens the 15:00:00 batch; a host that shows the raw 10:00:05 value on day 3, or drops either cited batch at 24 h, fails, naming it', () => {
  it('AC16 on day 32 that value reads missing, shown as a dash, and the decision still opens the 15:00:00 batch', async () => {
    void thirtyDays();
    const d = await seen.day32.promise;
    expect(judgeAged(HANDLE, 'day 32', d.v, { status: 'missing' })).toEqual([]);
    expect(judgeCitedOpens('decision', '15:00:00', 'day 32', d.decision.held, d.decision.got, AT15)).toEqual([]);
  }, LONG);

  it('AC16 (wrong program) a host that shows the raw 10:00:05 value on day 3 fails, naming the value', async () => {
    const problems = judgeAged(HANDLE, 'day 3', { status: 'reading', value: RAW }, { status: 'rollup', span: 'minute', value: MINUTE_LAST });
    expect(problems.length === 1 && problems[0]!.startsWith(`${HANDLE} on day 3 shows ${RAW}`), JSON.stringify(problems)).toBe(true);
  });

  it('AC16 (wrong program) a host that drops the cited batches at 24 h fails, naming each', async () => {
    void thirtyDays();
    const d = await seen.day3.promise;
    const missing: Resolved = { status: 'missing', value: null };
    const notice = judgeCitedOpens('notice', '14:00:00', 'day 3', d.twinHeld[d.notice14.file]!, d.twinHeld[d.notice14.file] ? d.notice.got : missing, AT14);
    const decision = judgeCitedOpens('decision', '15:00:00', 'day 3', d.twinHeld[d.decision15.file]!, d.twinHeld[d.decision15.file] ? d.decision.got : missing, AT15);
    expect(notice.some((p) => p.includes('the 14:00:00 batch the notice cites is gone')), JSON.stringify(notice)).toBe(true);
    expect(decision.some((p) => p.includes('the 15:00:00 batch the decision cites is gone')), JSON.stringify(decision)).toBe(true);
  }, LONG);
});

describe('AC17 #262.ff200c23 30 days of that source add 43,920 rows to `rollups` (43,200 minutes and 720 hours) and keep under 250 MB of rollup evidence (7 days of minute files and 30 of hour files, at 40 bytes a series); a projection with one row per series and window holds 21,960,000 rows and fails, naming the table', () => {
  it('AC17 30 days add 43,920 rollups rows and keep under 250 MB of rollup evidence', async () => {
    void thirtyDays();
    const d = await seen.day31.promise;
    console.log(`AC17 rollup evidence held on day 31: ${count(d.minuteFiles)} minute files and ${count(d.hourFiles)} hour files, ${count(d.rollupBytes)} bytes`);
    expect(judgeRows('rollups', d.rows, 43_920)).toEqual([]);
    expect(d.rollupBytes, `rollup evidence held, ${count(d.rollupBytes)} bytes`).toBeLessThan(ROLLUP_BYTES);
  }, LONG);

  it('AC17 (wrong program) a projection with one row per series and window holds 21,960,000 rows and fails, naming the table', async () => {
    void thirtyDays();
    const d = await seen.day31.promise;
    const problems = judgeRows('rollups', d.rows * SERIES, 43_920);
    expect(problems).toEqual(['rollups holds 21,960,000 rows for the 30 days, not 43,920']);
  }, LONG);
});
