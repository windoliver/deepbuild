// AC6, AC7: a notice you create on a source that runs only while shown.
//
// The shop plug-in's source `errors` declares `while_shown: {every: 10 s}`; its view ext.shop.board binds
// reading:ext.shop.errors; its job ext.shop.watch_rate checks the notice kind ext.shop.rate_passed and has no cadence of
// its own (fixtures/shop). You create "tell me when the error rate passes 2%" on the trusted path, on the source
// (README, The surface under test: subscribeNotice's fourth argument). The provider answers 1 (%) but for its third,
// fourth and fifth calls, which answer 3. The glance plug-in (fixtures/glance) has the same source and view and a
// notice kind of its own, whose only check is in its panel.
import { describe, expect, it } from 'vitest';
import { API, App, clock, GLANCE_ID, metricsApi, metricsWorld, num, openHost, openWorld, PASSED, pkg, routedClient, run, SECOND, t, tryInstall, WATCH, YOU, type Answers, type MetricsProbe } from './helpers.ts';
import { judgeCalls, judgeNoticeSchedule } from './judges.ts';
import { modelNoticeJob } from './twins.ts';

const BOARD = 'ext.shop.board';
const KEY = 'error_rate>2%';
const WORDS = 'tell me when the error rate passes 2%';
const probe: MetricsProbe = {
  sources: [{ name: 'ext.shop.errors', while_shown: { every: 10 * SECOND }, quota: { per_minute: 12, per_day: 100_000 }, freshFor: 10 * SECOND }],
  views: [{ name: BOARD, binds: ['reading:ext.shop.errors'] }],
  watch: { source: 'ext.shop.errors', threshold: 2, key: KEY },
};
const answers: Answers = { 'ext.shop.errors': (n) => num(n >= 2 && n <= 4 ? 3 : 1) };

async function created() {
  const m = await metricsWorld(t('10:00:00'), probe, answers);
  await m.h.subscribeNotice(YOU, PASSED, KEY, { source: 'ext.shop.errors', words: WORDS });
  return m;
}
/** The notices sent: the shop plug-in is the only one loaded, and the notice's job the only sender. */
const sentFor = async (m: Awaited<ReturnType<typeof created>>) => (await m.w.events('notice.sent')).length;

describe('AC6 #262.afbd91fe Creating "tell me when the error rate passes 2%" on a source that runs only while shown, every 10 s, gives the plug-in\'s checking job a schedule every 10 s, which the notice\'s sentence names; with every view hidden the job keeps reading the source, and a recorded rate of 3% notifies once; a host that leaves the job unscheduled sends no notice and fails, naming the notice', () => {
  it('AC6 the notice\'s sentence names its 10 s schedule; with no view shown the job reads the source every 10 s and the recorded 3% notifies once', async () => {
    const m = await created();
    const row = (await m.h.listNotices()).find((n) => n.kind === PASSED && n.key === KEY);
    expect(row, `the notice ${KEY} among ${JSON.stringify(await m.h.listNotices())}`).toBeDefined();
    expect(row!.sentence, 'the notice\'s sentence').toMatch(/\bevery 10 ?s\b|\bevery 10 seconds\b/i);
    await run(m.h, m.c, null, t('10:00:00'), t('10:01:59'));
    const runs = (await m.h.runs(WATCH)).map((r) => r.dispatched).filter((x): x is number => x !== null);
    expect(judgeNoticeSchedule({ key: KEY, words: WORDS, runs, from: t('10:00:00'), to: t('10:01:00'), calls: m.api.calls('ext.shop.errors'), sent: await sentFor(m) })).toEqual([]);
  }, 180_000);

  it('AC6 (wrong program) a host that leaves the job unscheduled sends no notice and fails, naming the notice', async () => {
    // The checking job on the scenario's own timeline and answers, with every view hidden (twins.ts, modelNoticeJob).
    // The hub has no seam to withhold the schedule a notice gives, and #365's idle() runs any schedule that is due, so
    // the wrong host is the model with the job given no schedule; the same model given the notice's 10 s passes.
    const job = (every: number | null) => modelNoticeJob({ source: 'ext.shop.errors', answers, threshold: probe.watch!.threshold, every, from: t('10:00:00'), to: t('10:01:59') });
    const judge = (r: Awaited<ReturnType<typeof job>>) => judgeNoticeSchedule({ key: KEY, words: WORDS, runs: r.runs, from: t('10:00:00'), to: t('10:01:00'), calls: r.calls, sent: r.sent });
    expect(judge(await job(10 * SECOND)), 'the model given the notice\'s 10 s schedule').toEqual([]);
    const problems = judge(await job(null));
    expect(problems.some((p) => p.includes(`the notice "${KEY}"`) && p.includes('notified 0 times')), JSON.stringify(problems)).toBe(true);
  }, 180_000);
});

describe('AC7 #262.96530f6d With the view shown and that schedule running, the source makes 6 calls a minute, not 12; a test plug-in whose only check for the notice is in its panel has the notice refused when it is created, naming the notice', () => {
  it('AC7 with the view shown and the notice\'s schedule running, errors makes 6 calls a minute, not 12', async () => {
    const m = await created();
    const app = new App(m.h, m.c);
    app.show(BOARD);
    await run(m.h, m.c, app, t('10:00:00'), t('10:00:59'));
    const runs = (await m.h.runs(WATCH)).map((r) => r.dispatched).filter((x): x is number => x !== null);
    expect(judgeCalls(`${WATCH}'s runs`, runs, t('10:00:00'), t('10:01:00'), 6, 'with the view shown')).toEqual([]);
    expect(judgeCalls('ext.shop.errors', m.api.calls('ext.shop.errors'), t('10:00:00'), t('10:01:00'), 6, 'with the view shown and the notice\'s schedule running')).toEqual([]);
  }, 180_000);

  it('AC7 a plug-in whose only check for the notice is in its panel has the notice refused when it is created, naming the notice', async () => {
    const c = clock(t('10:00:00'));
    const api = await metricsApi(c, { 'ext.glance.errors': answers['ext.shop.errors']! });
    const w = await openWorld(c);
    const h = await openHost(w, routedClient({ [API]: api }));
    const { refusal } = await tryInstall(h, await pkg('glance', {}));
    expect(refusal, `${GLANCE_ID} installs`).toBeNull();
    const kind = 'ext.glance.rate_passed';
    let refused: string | null = null;
    try {
      await h.subscribeNotice(YOU, kind, KEY, { source: 'ext.glance.errors', words: WORDS });
    } catch (e) {
      refused = (e as Error).message;
    }
    expect(refused, `creating "${WORDS}" on ${GLANCE_ID}'s errors`).not.toBeNull();
    expect(refused!.includes(kind) || refused!.includes(KEY) || refused!.includes(WORDS), `the refusal names the notice: ${refused}`).toBe(true);
    const subscribed = (await w.events('notice.subscribed')).filter((e) => (e.data as { notice_kind: string }).notice_kind === kind);
    expect(subscribed, 'notice.subscribed for the refused notice').toEqual([]);
  }, 120_000);
});
