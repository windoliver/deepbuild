// AC8, AC9, AC14 and AC18's sizes: one day of a 500-series source read every 10 s while a view is kept shown.
//
// The shop plug-in's series source `fleet` returns 500 named values a call (svc000 … svc499), declares a 5 s
// timeout and `while_shown: {every: 10 s}`, under a quota of 6 calls a minute and 10,000 a day; its view
// ext.shop.fleet binds reading:ext.shop.fleet#svc000. On the controlled clock from 00:00:00 on day 1 the app keeps the view
// shown, reporting views/shown every 5 s, and the hub's timer ticks every 5 s to 24:00:10, past the last hour's end
// plus the timeout. The day runs once, before the file's tests, which read what it left.
import { copyFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Event, Row } from '../../../packages/record/src/index.ts';
import { App, batches, count, fileOf, HOUR, metricsWorld, MINUTE, named, rollupEvents, SECOND, seriesOf, t, tempDir, type Answers, type Metrics, type MetricsProbe, type RollupData } from './helpers.ts';
import { judgeEventsPerCall, judgeRebuilt } from './judges.ts';
import { rebuiltWithoutRollupEvents } from './twins.ts';

const VIEW = 'ext.shop.fleet';
const SERIES = 500;
const CALLS = 8_640;
const probe: MetricsProbe = {
  sources: [{ name: 'ext.shop.fleet', series: true, while_shown: { every: 10 * SECOND }, timeout: 5 * SECOND, quota: { per_minute: 6, per_day: 10_000 }, freshFor: 10 * SECOND }],
  views: [{ name: VIEW, binds: ['reading:ext.shop.fleet#svc000'] }],
};
const answers: Answers = { 'ext.shop.fleet': (n) => seriesOf(named(SERIES, (i) => ((n * 31 + i * 7) % 1000) / 10)) };

let m: Metrics;
/** Every event the day added, from the first step to the last. */
let added: Event[];
/** The rollups table before and after the rebuild. */
let before: Row[];
let after: Row[];
const END = t('24:00:00');
const inDay = (e: Event) => { const d = e.data as { as_of: number }; return d.as_of >= t('00:00:00') && d.as_of <= t('23:59:50'); };
const closedByEnd = (e: Event) => { const d = e.data as unknown as RollupData; return d.start >= t('00:00:00') && d.start + (d.span === 'hour' ? HOUR : MINUTE) <= END; };
/**
 * Rows as they were read, each value kept apart by its type: the record reads every INTEGER column as a BigInt
 * (`table()`'s `safeIntegers`), which JSON can't write, so a BigInt is written as `{"bigint":"<its digits>"}`, which no
 * stored number, text or null writes, and a number and a BigInt of the same value don't compare equal by accident.
 */
const bigints = (_key: string, v: unknown): unknown => (typeof v === 'bigint' ? { bigint: v.toString() } : v);
const exact = (rows: Row[]): Row[] => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, bigints(k, v)])));
const sorted = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify([a.source, a.span, a.start], bigints).localeCompare(JSON.stringify([b.source, b.span, b.start], bigints)));

beforeAll(async () => {
  m = await metricsWorld(t('00:00:00'), probe, answers);
  const { c, w, h } = m;
  const head = (await w.events()).at(-1)?.log_pos ?? 0;
  const app = new App(h, c);
  app.show(VIEW);
  for (let at = t('00:00:00'); at <= END + 10 * SECOND; at += 5 * SECOND) {
    c.set(at);
    await app.report();
    await h.tick();
    await h.idle();
    // Stops at once on a host that makes no batch, rather than running the day for nothing.
    if (at === t('00:00:30') && !(await batches(w, 'ext.shop.fleet')).length) throw Error(`no reading.batch of ext.shop.fleet by 00:00:30 with ${VIEW} shown (${m.api.calls('ext.shop.fleet').length} calls)`);
  }
  added = (await w.events()).filter((e) => e.log_pos > head);
  before = sorted((await w.record.table('rollups')).rows);
  await w.record.rebuild();
  after = sorted((await w.record.table('rollups')).rows);
}, 3 * 3_600_000);

describe('AC8 #262.2a3a744d One source whose call returns 500 series, read every 10 s with a 5 s timeout by a view kept shown with `while_shown: {every: 10 s}` on a test clock from 00:00:00, adds exactly 8,640 `reading.batch` events for the calls from 00:00:00 to 23:59:50 and, once they have closed, exactly 1,464 `reading.rollup` events for the windows that end by 24:00:00 (1,440 minutes and 24 hours)', () => {
  it('AC8 8,640 reading.batch events for the calls from 00:00:00 to 23:59:50, one per call', async () => {
    const day = (await batches(m.w, 'ext.shop.fleet')).filter(inDay);
    expect(day.length, 'reading.batch events of fleet as of 00:00:00 to 23:59:50').toBe(CALLS);
    expect(new Set(day.map((e) => (e.data as { as_of: number }).as_of)).size, 'their as-of times, each once').toBe(CALLS);
    expect(m.api.calls('ext.shop.fleet').filter((x) => x >= t('00:00:00') && x <= t('23:59:50')).length, 'calls to the provider from 00:00:00 to 23:59:50').toBe(CALLS);
  });

  it('AC8 1,464 reading.rollup events for the windows that end by 24:00:00: 1,440 minutes and 24 hours, one each', async () => {
    const closed = (await rollupEvents(m.w, 'ext.shop.fleet')).filter(closedByEnd);
    const spans = (span: string) => closed.filter((e) => (e.data as unknown as RollupData).span === span);
    expect(spans('minute').length, 'minute rollups').toBe(1_440);
    expect(spans('hour').length, 'hour rollups').toBe(24);
    expect(new Set(closed.map((e) => JSON.stringify([(e.data as unknown as RollupData).span, (e.data as unknown as RollupData).start]))).size, 'one event per window').toBe(1_464);
  });
});

describe('AC9 #262.99400a8b That day adds no event per value or per series; a host that appends one event per value adds 4,320,000 and fails, naming the count', () => {
  const byKind = (events: Event[]) => events.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc; }, {});

  it('AC9 no event kind has an event per value or per series: none more than three a call, and no reading.recorded of fleet', () => {
    expect(judgeEventsPerCall(byKind(added), CALLS)).toEqual([]);
    expect(added.filter((e) => e.kind === 'reading.recorded' && (e.data as { source: string }).source === 'ext.shop.fleet').length, 'reading.recorded events of fleet').toBe(0);
  });

  it('AC9 (wrong program) a host that appends one event per value adds 4,320,000 and fails, naming the count', () => {
    // The day as such a host records it: each value the provider answered as one reading.recorded, beside the rest.
    const values = m.api.calls('ext.shop.fleet').filter((x) => x <= t('23:59:50')).length * SERIES;
    const problems = judgeEventsPerCall({ ...byKind(added.filter((e) => e.kind !== 'reading.batch')), 'reading.recorded': values }, CALLS);
    expect(problems.some((p) => p.includes('4,320,000 reading.recorded')), JSON.stringify(problems)).toBe(true);
  });
});

describe('AC14 #262.2d291fb4 Dropping `rollups` after the 24 h run and rebuilding it from the log gives the same 1,464 rows, byte for byte; a host that writes rollups only into the table loses them on rebuild and fails, naming the table', () => {
  it('AC14 the rollups table rebuilt from the log holds the same rows, byte for byte: 1,464 for the day\'s windows', () => {
    const day = before.filter((r) => r.source === 'ext.shop.fleet' && Number(r.start) + (r.span === 'hour' ? HOUR : MINUTE) <= END && Number(r.start) >= t('00:00:00'));
    expect(day.length, 'rollups rows of fleet for the windows that end by 24:00:00').toBe(1_464);
    expect(judgeRebuilt('rollups', exact(before), exact(after))).toEqual([]);
  });

  it('AC14 (wrong program) a host that writes rollups only into the table loses them on rebuild and fails, naming the table', async () => {
    const problems = judgeRebuilt('rollups', exact(before), exact(sorted((await rebuiltWithoutRollupEvents()) as Row[])));
    expect(problems.length === 1 && problems[0]!.startsWith('rollups held'), JSON.stringify(problems)).toBe(true);
  });
});

describe('AC18 #262.7859de09 Budgets, on the reference Mac in the local preflight, compared with the merge base: the 500-series day\'s batch files sum to under 60 MB of file bytes (4,320,000 values at 12 bytes is 51.84 MB); its 8,640 batch and 1,464 rollup events, with their indexes, add under 5 MB to the record, the driver\'s own events counted apart; a landed batch refreshes its 500 bound values in under 1 ms in all; a value at a past log position resolves in under 1 ms at p50, with p95 reported', () => {
  it('AC18 the day\'s 8,640 batch files sum to under 60 MB of file bytes', async () => {
    const files = (await batches(m.w, 'ext.shop.fleet')).filter(inDay).map(fileOf);
    let bytes = 0;
    const missing: string[] = [];
    for (const sha of files) {
      const e = await m.w.evidence.get(sha);
      if (e) bytes += e.size; else missing.push(sha);
    }
    console.log(`AC18 the day's batch files: ${count(files.length)} files, ${count(bytes)} bytes`);
    expect(missing.length, 'batch files the day\'s events name that the store doesn\'t hold').toBe(0);
    expect(bytes, `the day's batch files, ${count(bytes)} bytes`).toBeLessThan(60_000_000);
  });

  it('AC18 the 8,640 batch and 1,464 rollup events, with their indexes, add under 5 MB to the record, the driver\'s events apart', async () => {
    // A copy of the record through its own online backup, compacted; then the same copy without the source's batch
    // and rollup events and the rollups rows they made, compacted. The difference is what those events cost; every
    // other event the day added (the driver's: the app's reports, the calls' records) is in both.
    const dir = tempDir('size');
    const full = join(dir, 'full.db');
    await m.w.record.backup(full);
    const lean = join(dir, 'lean.db');
    copyFileSync(full, lean);
    const size = (path: string, strip: boolean): number => {
      const db = new DatabaseSync(path);
      try {
        if (strip) {
          for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]) db.exec(`DROP TRIGGER "${name}"`);
          db.prepare("DELETE FROM events WHERE kind IN ('reading.batch', 'reading.rollup') AND json_extract(data, '$.source') = 'ext.shop.fleet'").run();
          db.prepare("DELETE FROM rollups WHERE source = 'ext.shop.fleet'").run();
        }
        db.exec('VACUUM');
      } finally {
        db.close();
      }
      return statSync(path).size;
    };
    const grew = size(full, false) - size(lean, true);
    rmSync(dir, { recursive: true, force: true });
    console.log(`AC18 the day's batch and rollup events with their indexes: ${count(grew)} bytes of the record`);
    expect(grew, `the day's batch and rollup events with their indexes, ${count(grew)} bytes`).toBeLessThan(5_000_000);
  });
});

