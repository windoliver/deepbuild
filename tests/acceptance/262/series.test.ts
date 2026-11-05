// AC10: a series call's count. AC11: a bound value pinned to a batch's log position, live and on replay. AC12: a
// planted batch file whose bytes changed.
//
// The shop plug-in's series sources (fixtures/shop): `wide`, whose first answer holds 10,001 named values and
// its second 10,000, and `metrics`, whose answers at 10:00:10 and 10:00:20 hold checkout 42.5, then 43.0 (and search
// 7, then 8). Each call is made by readSource on the controlled clock (a series source needs no view to be read).
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { batchAt, batches, batchHandle, citing, evidencePath, fileOf, metricsWorld, named, SECOND, seriesOf, t, tempDir, value, type Answers, type MetricsProbe } from './helpers.ts';
import { judgeReplay } from './judges.ts';
import { newestOnReplay } from './twins.ts';

const probe: MetricsProbe = {
  sources: [
    { name: 'ext.shop.wide', series: true, quota: { per_minute: 600, per_day: 100_000 }, freshFor: SECOND },
    { name: 'ext.shop.metrics', series: true, quota: { per_minute: 600, per_day: 100_000 }, freshFor: SECOND },
  ],
  views: [{ name: 'ext.shop.orders', binds: ['reading:ext.shop.metrics#checkout', 'reading:ext.shop.metrics#search'] }],
};
const answers: Answers = {
  'ext.shop.wide': (n) => seriesOf(named(n === 0 ? 10_001 : 10_000, (i) => i / 4)),
  'ext.shop.metrics': (n) => seriesOf(n === 0 ? { checkout: 42.5, search: 7 } : { checkout: 43.0, search: 8 }),
};
const CHECKOUT = 'reading:ext.shop.metrics#checkout';

describe('AC10 #262.e2bdbc81 A call that returns 10,001 values makes no reading and fails, naming the count; one that returns 10,000 lands as one batch', () => {
  it('AC10 10,001 values make no reading and fail, naming the count; 10,000 land as one reading.batch', async () => {
    const { c, w, h } = await metricsWorld(t('10:00:00'), probe, answers);
    const over = await h.readSource('ext.shop.wide');
    expect(over.status, `the 10,001-value call: ${JSON.stringify(over)}`).toBe('failed');
    expect((over as { cause: string }).cause, 'its cause names the count').toMatch(/\b10,?001\b/);
    expect(await batches(w, 'ext.shop.wide'), 'reading.batch after the 10,001-value call').toEqual([]);
    expect((await w.events('reading.recorded')).filter((e) => (e.data as { source: string }).source === 'ext.shop.wide'), 'reading.recorded after it').toEqual([]);

    c.set(t('10:00:10'));
    const at = await h.readSource('ext.shop.wide');
    expect(['failed', 'BLOCKED'], `the 10,000-value call: ${JSON.stringify(at)}`).not.toContain(at.status);
    const landed = await batches(w, 'ext.shop.wide');
    expect(landed.length, 'reading.batch events of wide').toBe(1);
    expect((landed[0]!.data as { as_of: number }).as_of, 'its as-of time').toBe(t('10:00:10'));
    expect((await w.events('reading.recorded')).filter((e) => (e.data as { source: string }).source === 'ext.shop.wide'), 'no reading.recorded per value').toEqual([]);
  }, 120_000);
});

describe('AC11 #262.4ba2cfdd A bound value for `reading:metrics#checkout` pinned to the log position of the 10:00:10 batch reads 42.5 live, and 42.5 again on replay after the 10:00:20 batch, 43.0, has landed; a host that resolves on replay to the newest batch shows 43.0 and fails, naming the value', () => {
  async function twoBatches() {
    const m = await metricsWorld(t('10:00:10'), probe, answers);
    expect((await m.h.readSource('ext.shop.metrics')).status, 'the 10:00:10 call').not.toBe('failed');
    const first = await batchAt(m.w, 'ext.shop.metrics', t('10:00:10'));
    const live = await value(m.h, CHECKOUT, first.log_pos);
    const unpinned = await value(m.h, CHECKOUT);
    m.c.set(t('10:00:20'));
    expect((await m.h.readSource('ext.shop.metrics')).status, 'the 10:00:20 call').not.toBe('failed');
    await batchAt(m.w, 'ext.shop.metrics', t('10:00:20'));
    return { ...m, first, live, unpinned };
  }

  it('AC11 pinned to the 10:00:10 batch, checkout reads 42.5 live and 42.5 on replay after the 43.0 batch landed', async () => {
    const { h, first, live, unpinned } = await twoBatches();
    expect(judgeReplay(CHECKOUT, 'the 10:00:10 batch, live', live, 42.5)).toEqual([]);
    expect(unpinned, 'the live value, unpinned, after the 10:00:10 batch').toMatchObject({ status: 'reading', value: 42.5, as_of: t('10:00:10') });
    expect(judgeReplay(CHECKOUT, 'the 10:00:10 batch, on replay', await value(h, CHECKOUT, first.log_pos), 42.5)).toEqual([]);
    expect(await value(h, CHECKOUT), 'the live value now (the control)').toMatchObject({ status: 'reading', value: 43.0, as_of: t('10:00:20') });
  }, 120_000);

  it('AC11 (wrong program) a host that resolves on replay to the newest batch shows 43.0 and fails, naming the value', async () => {
    const { h, first } = await twoBatches();
    const problems = judgeReplay(CHECKOUT, 'the 10:00:10 batch, on replay', await newestOnReplay(h)(CHECKOUT, first.log_pos), 42.5);
    expect(problems.length === 1 && problems[0]!.includes(CHECKOUT) && problems[0]!.includes('shows 43'), JSON.stringify(problems)).toBe(true);
  }, 120_000);
});

describe('AC12 #262.190cedac A planted batch file whose bytes changed fails its hash; every value bound to it reads missing, naming the batch and the mismatch, and a check that cites it is INVALID', () => {
  it('AC12 the 10:00:10 batch\'s file, its bytes changed: checkout and search read missing, naming the batch and the mismatch, and a check citing it is INVALID', async () => {
    const { w, h } = await metricsWorld(t('10:00:10'), probe, answers);
    expect((await h.readSource('ext.shop.metrics')).status, 'the 10:00:10 call').not.toBe('failed');
    const batch = await batchAt(w, 'ext.shop.metrics', t('10:00:10'));
    const file = fileOf(batch);
    expect(await value(h, CHECKOUT, batch.log_pos), 'checkout before the plant (the control)').toMatchObject({ status: 'reading', value: 42.5 });
    const cites = citing([file, batchHandle(batch)]);
    const before = await h.judgeCheck('ext.shop.cites', cites, { checkout: tempDir('checkout'), deadline: 60_000 });
    expect(before.verdict, `the check citing the batch before the plant (the control): ${JSON.stringify(before)}`).toBe('PASS');

    const path = evidencePath(w, file);
    const bytes = readFileSync(path);
    const at = bytes.length >> 1;
    bytes[at] = bytes[at]! ^ 0x01;
    writeFileSync(path, bytes);

    const names = (cause: string | undefined) => !!cause && (cause.includes(file) || cause.includes(file.slice(0, 12)) || cause.includes(batchHandle(batch)));
    for (const v of await h.boundValues([CHECKOUT, 'reading:ext.shop.metrics#search'], { log_pos: batch.log_pos })) {
      expect(v, `${v.handle} bound to the planted batch`).toMatchObject({ status: 'missing', value: null });
      expect(names(v.cause), `${v.handle}'s cause names the batch: ${v.cause}`).toBe(true);
      expect(v.cause, `${v.handle}'s cause names the mismatch`).toMatch(/hash|mismatch|match|corrupt/i);
    }
    const after = await h.judgeCheck('ext.shop.cites', cites, { checkout: tempDir('checkout'), deadline: 60_000 });
    expect(after.verdict, `the check citing the planted batch: ${JSON.stringify(after)}`).toBe('INVALID');
    expect(names(after.cause ?? undefined), `its cause names the batch: ${after.cause}`).toBe(true);
  }, 120_000);
});
