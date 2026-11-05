// AC1, AC2: Read now on a view that binds three recorded sources.
//
// The shop plug-in's view ext.shop.board binds reading:ext.shop.fresh, reading:ext.shop.spent and reading:ext.shop.ready, three number
// sources the local provider answers (fixtures/shop). On the controlled clock from 10:00:00: `spent`, whose quota
// is one call a minute, and `ready`, ten a minute, are read at 10:00:00, so `spent`'s quota is spent until 10:01:00;
// `fresh` is read at 10:00:29. Each stays fresh for 1 s, so at 10:00:30 none is fresh, and only Read now's own 2 s rule
// keeps `fresh`'s answer. `ready` also runs on the 5-minute schedule ext.shop.poll, loaded at 10:00:00, whose next
// run is 10:05:00. At 10:00:30 you click Read now: the panel calls ext.shop.read_now, which calls deep.readNow.
import { describe, expect, it } from 'vitest';
import { metricsWorld, MINUTE, num, readNow, run, SECOND, t, value, waitUntil, type Answers, type MetricsProbe } from './helpers.ts';
import { judgeReadNow } from './judges.ts';
import { readsEverything } from './twins.ts';

const BOARD = 'ext.shop.board';
const POLL = 'ext.shop.poll';
const BINDS = ['ext.shop.fresh', 'ext.shop.spent', 'ext.shop.ready'];
const probe: MetricsProbe = {
  sources: [
    { name: 'ext.shop.fresh', quota: { per_minute: 600, per_day: 100_000 }, freshFor: SECOND },
    { name: 'ext.shop.spent', quota: { per_minute: 1, per_day: 100_000 }, freshFor: SECOND },
    { name: 'ext.shop.ready', quota: { per_minute: 10, per_day: 100_000 }, freshFor: SECOND },
  ],
  views: [{ name: BOARD, binds: BINDS.map((s) => `reading:${s}`) }],
  polls: [{ name: POLL, every: 5 * MINUTE, reads: 'ext.shop.ready' }],
};
/** fresh answers 10, 11 …; spent 20, 21 …; ready 30, 31 …. */
const answers: Answers = { 'ext.shop.fresh': (n) => num(10 + n), 'ext.shop.spent': (n) => num(20 + n), 'ext.shop.ready': (n) => num(30 + n) };

/** The scenario up to Read now's click at 10:00:30. */
async function upToReadNow() {
  const m = await metricsWorld(t('10:00:00'), probe, answers);
  const { c, h } = m;
  await run(h, c, null, t('10:00:00'), t('10:00:00'));
  for (const s of ['ext.shop.spent', 'ext.shop.ready']) {
    const r = await h.readSource(s);
    expect(r.status, `${s} read at 10:00:00: ${JSON.stringify(r)}`).toBe('reading');
  }
  c.set(t('10:00:29'));
  const f = await h.readSource('ext.shop.fresh');
  expect(f.status, `fresh read at 10:00:29: ${JSON.stringify(f)}`).toBe('reading');
  c.set(t('10:00:30'));
  return m;
}
const nextOf = async (h: Awaited<ReturnType<typeof upToReadNow>>['h']) => (await h.schedules()).find((r) => r.name === POLL)?.next ?? null;

describe('AC1 #262.9d1a9fcb At 10:00:30, Read now on a view that binds three recorded sources, one answered 1 s before, one whose quota is spent until 10:01 and one ready, makes exactly one call, to the third; the first keeps its answer, the second\'s values read `quota` with 10:01, and the third\'s update within one frame of its reading', () => {
  it('AC1 Read now at 10:00:30 calls only the ready source; fresh keeps its 10:00:29 answer, spent reads quota until 10:01:00, ready updates as its reading lands', async () => {
    const { c, h, api } = await upToReadNow();
    const clicked = await readNow(h, BOARD);
    expect(clicked.ok, `Read now on ${BOARD}: ${JSON.stringify(clicked)}`).toBe(true);
    // The third's value updates as its reading lands: on the test clock, which doesn't move, the bound value shows the
    // reading as of 10:00:30 with no time between them, inside one frame.
    const ready = await waitUntil(async () => { const v = await value(h, 'reading:ext.shop.ready'); return v.as_of === t('10:00:30') ? v : null; }, 10_000, 'reading:ext.shop.ready as of 10:00:30');
    expect(c.now(), 'the test clock while the value updated').toBe(t('10:00:30'));
    expect(ready, 'reading:ext.shop.ready after Read now').toMatchObject({ status: 'reading', value: 31, as_of: t('10:00:30') });

    expect(judgeReadNow({
      at: t('10:00:30'), calls: Object.fromEntries(BINDS.map((s) => [s, api.calls(s)])),
      kept: { 'ext.shop.fresh': t('10:00:29') }, quota: { 'ext.shop.spent': t('10:01:00') }, ready: ['ext.shop.ready'],
    })).toEqual([]);
    expect(api.seen.filter((s) => s.at === t('10:00:30')).map((s) => s.source), 'every call Read now made').toEqual(['ext.shop.ready']);

    expect(await value(h, 'reading:ext.shop.fresh'), 'reading:ext.shop.fresh keeps its answer').toMatchObject({ status: 'reading', value: 10, as_of: t('10:00:29') });
    expect(await value(h, 'reading:ext.shop.spent'), 'reading:ext.shop.spent').toMatchObject({ status: 'quota', until: t('10:01:00') });
  }, 120_000);
});

describe('AC2 #262.acafafac The third also runs on a 5-minute schedule whose next run is 10:05:00, and after Read now it is still 10:05:00; a Read now that calls the first again, or the second inside its quota window, fails, naming the source', () => {
  it('AC2 the 5-minute schedule\'s next run is 10:05:00 before Read now and after it, and it runs then', async () => {
    const { c, h, api } = await upToReadNow();
    expect(await nextOf(h), 'ext.shop.poll\'s next run before Read now').toBe(t('10:05:00'));
    const clicked = await readNow(h, BOARD);
    expect(clicked.ok, `Read now on ${BOARD}: ${JSON.stringify(clicked)}`).toBe(true);
    await waitUntil(async () => (await value(h, 'reading:ext.shop.ready')).as_of === t('10:00:30'), 10_000, 'reading:ext.shop.ready as of 10:00:30');
    expect(await nextOf(h), 'ext.shop.poll\'s next run after Read now').toBe(t('10:05:00'));
    await run(h, c, null, t('10:00:40'), t('10:05:00'), 10 * SECOND);
    expect(api.calls('ext.shop.ready').filter((x) => x > t('10:00:30')), 'ready\'s calls after Read now, to 10:05:00').toEqual([t('10:05:00')]);
  }, 120_000);

  it('AC2 (wrong program) a Read now that calls every source the view binds fails, naming fresh and spent', async () => {
    const calls = await readsEverything(answers, [{ source: 'ext.shop.spent', at: t('10:00:00') }, { source: 'ext.shop.ready', at: t('10:00:00') }, { source: 'ext.shop.fresh', at: t('10:00:29') }], t('10:00:30'), BINDS);
    const problems = judgeReadNow({ at: t('10:00:30'), calls, kept: { 'ext.shop.fresh': t('10:00:29') }, quota: { 'ext.shop.spent': t('10:01:00') }, ready: ['ext.shop.ready'] });
    expect(problems.some((p) => p.includes('called ext.shop.fresh again')), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => p.includes('called ext.shop.spent') && p.includes('quota window')), JSON.stringify(problems)).toBe(true);
  }, 60_000);
});
