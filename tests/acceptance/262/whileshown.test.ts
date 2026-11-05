// AC3, AC4: a source that runs only while a view that binds it is shown. AC5: while-shown cadences refused at install.
//
// The shop plug-in's source `rate` declares `while_shown: {every: 10 s}`; its views ext.shop.board and
// ext.shop.detail bind reading:ext.shop.rate. The app (helpers.ts, App) reports views/shown for each view it shows at once
// and every 5 s after, and views/hidden when one closes, on the app's connection; the hub's timer ticks every second
// of the controlled clock. A minimized window, a replica's view and a silent app are what the app's reports say or
// leave out (README, Readings): the report's `minimized`, its `replica`, and no report at all while the socket stays
// open. Calls are counted at the provider.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { App, clock, metricsWorld, num, openHost, openWorld, pkg, routedClient, metricsApi, API, run, SECOND, t, tryInstall, type Answers, type Clock, type MetricsProbe } from './helpers.ts';
import { judgeCalls, judgeNoneFrom, judgeRefused, judgeStopped } from './judges.ts';
import { modelCadence, type ShownRule } from './twins.ts';

const BOARD = 'ext.shop.board';
const DETAIL = 'ext.shop.detail';
const EVERY = 10 * SECOND;
const probe = (over: Partial<MetricsProbe['sources'][number]> = {}): MetricsProbe => ({
  sources: [{ name: 'ext.shop.rate', while_shown: { every: EVERY }, quota: { per_minute: 6, per_day: 10_000 }, freshFor: EVERY, ...over }],
  views: [{ name: BOARD, binds: ['reading:ext.shop.rate'] }, { name: DETAIL, binds: ['reading:ext.shop.rate'] }],
});
const answers: Answers = { 'ext.shop.rate': (n) => num(n) };

/** Steps the clock a second at a time, the app reporting; with a host, its timer ticks too. */
async function play(h: ExtensionHost | null, c: Clock, app: App, from: number, to: number): Promise<void> {
  if (h) return run(h, c, app, from, to);
  for (let at = from; at <= to; at += SECOND) { c.set(at); await app.report(); }
}

/** AC3's timeline: board shown from 10:00, detail too from 10:01, both hidden at 10:02, on to 10:03. */
async function ac3(h: ExtensionHost | null, c: Clock): Promise<App> {
  const app = new App(h, c);
  app.show(BOARD);
  await play(h, c, app, t('10:00:00'), t('10:00:59'));
  app.show(DETAIL);
  await play(h, c, app, t('10:01:00'), t('10:01:59'));
  c.set(t('10:02:00'));
  await app.hide(BOARD);
  await app.hide(DETAIL);
  await play(h, c, app, t('10:02:00'), t('10:03:00'));
  return app;
}
function judgeAc3(calls: number[]): string[] {
  return [
    ...judgeCalls('ext.shop.rate', calls, t('10:00:00'), t('10:01:00'), 6, `while ${BOARD} was shown`),
    ...judgeCalls('ext.shop.rate', calls, t('10:01:00'), t('10:02:00'), 6, `while ${BOARD} and ${DETAIL}, which both bind it, were shown`),
    ...judgeNoneFrom('ext.shop.rate', calls, t('10:02:10'), 'from 10 s after the last view that binds it was hidden at 10:02:00'),
  ];
}

describe('AC3 #262.19fbe9a5 A source with `while_shown: {every: 10 s}` bound by one view makes 6 calls, plus or minus one, in 60 s while the view is shown, still 6 with two views shown that bind it, and none from 10 s after the last is hidden; a host that keeps calling for a hidden view, or runs one cadence per view, fails, naming the source', () => {
  it('AC3 6 calls in the minute one view is shown, 6 in the minute two are, none from 10 s after both are hidden', async () => {
    const { c, h, api } = await metricsWorld(t('10:00:00'), probe(), answers);
    await ac3(h, c);
    expect(judgeAc3(api.calls('ext.shop.rate'))).toEqual([]);
  }, 180_000);

  it('AC3 (wrong program) a host that keeps calling for a hidden view, or runs one cadence per view, fails, naming the source', async () => {
    const sent = (await ac3(null, clock(t('10:00:00')))).sent;
    const model = (rule: ShownRule, perView: boolean) => modelCadence({ source: 'ext.shop.rate', answers, sent, views: [BOARD, DETAIL], rule, perView, every: EVERY, from: t('10:00:00'), to: t('10:03:00') });
    expect(judgeAc3(await model('right', false)), 'the model with the right rule, one cadence for the source').toEqual([]);
    const keeps = judgeAc3(await model('ignores-hidden', false));
    expect(keeps.some((p) => p.startsWith('ext.shop.rate was called at 10:02:10')), JSON.stringify(keeps)).toBe(true);
    const perView = judgeAc3(await model('right', true));
    expect(perView.some((p) => p.startsWith('ext.shop.rate made 12 calls') || p.startsWith('ext.shop.rate made 11 calls') || p.startsWith('ext.shop.rate made 13 calls')), JSON.stringify(perView)).toBe(true);
  }, 60_000);
});

/** AC4's three timelines, each with the board alone. */
const ac4 = {
  /** Shown from 09:59:00; from 10:00:00 the app reports its window minimized. */
  minimized: async (h: ExtensionHost | null, c: Clock): Promise<App> => {
    const app = new App(h, c);
    app.show(BOARD);
    await play(h, c, app, t('09:59:00'), t('09:59:59'));
    app.change(BOARD, { minimized: true });
    await play(h, c, app, t('10:00:00'), t('10:01:00'));
    return app;
  },
  /** Only a replica draws the board, from 10:00:00. */
  replica: async (h: ExtensionHost | null, c: Clock): Promise<App> => {
    const app = new App(h, c);
    app.show(BOARD, { replica: true });
    await play(h, c, app, t('10:00:00'), t('10:01:00'));
    return app;
  },
  /** Shown from 09:59:00, its last report at 10:00:00; then the app draws nothing and reports nothing, its socket open. */
  silent: async (h: ExtensionHost | null, c: Clock): Promise<App> => {
    const app = new App(h, c);
    app.show(BOARD);
    await play(h, c, app, t('09:59:00'), t('10:00:00'));
    app.goSilent();
    await play(h, c, app, t('10:00:01'), t('10:01:00'));
    return app;
  },
};
const ac4Judge = {
  minimized: (calls: number[]) => judgeStopped(BOARD, 'ext.shop.rate', calls, t('10:00:10'), 'while its window was minimized from 10:00:00'),
  replica: (calls: number[]) => judgeStopped(BOARD, 'ext.shop.rate', calls, t('10:00:00') - 1, 'while only a replica drew it'),
  silent: (calls: number[]) => judgeStopped(BOARD, 'ext.shop.rate', calls, t('10:00:20'), 'while the app\'s window drew nothing from 10:00:00 and its socket stayed open'),
};

describe('AC4 #262.457c2b67 With that view\'s window minimized at 10:00:00, the source\'s calls stop by 10:00:10; a replica that draws the same view makes none; and with the app\'s window drawing nothing while its socket stays open, calls stop within 10 s plus one period; a host that counts a minimized window, a replica or a silent app as shown fails, naming the view', () => {
  it('AC4 the window minimized at 10:00:00: calls stop by 10:00:10', async () => {
    const { c, h, api } = await metricsWorld(t('09:59:00'), probe(), answers);
    await ac4.minimized(h, c);
    expect(api.calls('ext.shop.rate').filter((x) => x < t('10:00:00')).length, 'calls while the window was shown, before 10:00:00 (the control)').toBeGreaterThanOrEqual(5);
    expect(ac4Judge.minimized(api.calls('ext.shop.rate'))).toEqual([]);
  }, 180_000);

  it('AC4 a replica that draws the view makes no call', async () => {
    const { c, h, api } = await metricsWorld(t('10:00:00'), probe(), answers);
    await ac4.replica(h, c);
    expect(ac4Judge.replica(api.calls('ext.shop.rate'))).toEqual([]);
  }, 180_000);

  it('AC4 the app\'s window draws nothing from 10:00:00 while its socket stays open: calls stop by 10:00:20', async () => {
    const { c, h, api } = await metricsWorld(t('09:59:00'), probe(), answers);
    await ac4.silent(h, c);
    expect(api.calls('ext.shop.rate').filter((x) => x <= t('10:00:00')).length, 'calls while the app reported the view, to 10:00:00 (the control)').toBeGreaterThanOrEqual(5);
    expect(ac4Judge.silent(api.calls('ext.shop.rate'))).toEqual([]);
  }, 180_000);

  it('AC4 (wrong program) a host that counts a minimized window, a replica or a silent app as shown fails, naming the view', async () => {
    for (const [name, wrong] of [['minimized', 'counts-every-report'], ['replica', 'counts-every-report'], ['silent', 'shown-until-hidden']] as const) {
      const from = name === 'replica' ? t('10:00:00') : t('09:59:00');
      const sent = (await ac4[name](null, clock(from))).sent;
      const model = (rule: ShownRule) => modelCadence({ source: 'ext.shop.rate', answers, sent, views: [BOARD], rule, perView: false, every: EVERY, from, to: t('10:01:00') });
      expect(ac4Judge[name](await model('right')), `${name}: the model with the right rule`).toEqual([]);
      const problems = ac4Judge[name](await model(wrong));
      expect(problems.length === 1 && problems[0]!.startsWith(`${BOARD} was counted as shown`), `${name}: ${JSON.stringify(problems)}`).toBe(true);
    }
  }, 60_000);
});

describe('AC5 #262.d7c7f941 A source that declares `while_shown: {every: 5 s}` is refused at install, naming the field; one with `while_shown: {every: 10 s}`, 6 calls a minute, under a quota of 5 calls a minute is refused, naming both limits', () => {
  const attempt = async (over: Partial<MetricsProbe['sources'][number]>) => {
    const c = clock(t('10:00:00'));
    const api = await metricsApi(c, answers);
    const w = await openWorld(c);
    const h = await openHost(w, routedClient({ [API]: api }));
    return (await tryInstall(h, await pkg('shop', probe(over)))).refusal;
  };

  it('AC5 while_shown every 5 s is refused at install, naming while_shown', async () => {
    expect(judgeRefused(await attempt({ while_shown: { every: 5 * SECOND } }), 'a source declaring while_shown every 5 s', [{ label: 'the field while_shown', test: /while_shown/ }])).toEqual([]);
  }, 120_000);

  it('AC5 while_shown every 10 s under a quota of 5 calls a minute is refused, naming both limits; under a quota of 6 it installs', async () => {
    const refusal = await attempt({ quota: { per_minute: 5, per_day: 10_000 } });
    expect(judgeRefused(refusal, 'a source with while_shown every 10 s under a quota of 5 calls a minute', [
      { label: 'the quota of 5 calls a minute', test: /\b5\b/ },
      { label: 'the cadence of 6 calls a minute (every 10 s)', test: /\b6\b|\b10 ?s\b|\b10,?000 ?ms\b/ },
    ])).toEqual([]);
    expect(await attempt({ quota: { per_minute: 6, per_day: 10_000 } }), 'the same source under a quota of 6 calls a minute (the control)').toBeNull();
  }, 120_000);
});
