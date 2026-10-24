// The scenarios of the criteria that name a wrong program, shared by their own tests and plants.test.ts:
// each opens its own world, with the planted wrong program when one is given, and closes it.

import { expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import {
  ask, CLOSING, core, createdData, DAY, HOUR, MINUTE, noDefaultBeforeShown, openWorld, repoWith, settings, sourceOf, T0,
  type Planting, type World,
} from './helpers.ts';

async function inWorld(options: Parameters<typeof openWorld>[0], run: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld(options);
  try {
    await run(w);
  } finally {
    await w.close();
  }
}

export const EVERY_8H = 8 * HOUR;
/** The hub is stopped from 12:30 on 2026-10-20 to 09:00 on 2026-10-21: the batches at 16:00, 00:00 and 08:00 pass while it's down. */
export const STOPPED_UNTIL = Date.UTC(2026, 9, 21, 9, 0, 0);
export const START_BUDGET_MS = 5000;

/**
 * #319.1ad1ab09: two authority asks (1-day deadlines, 2026-10-21 12:00) and a taste call are raised at 12:00 and
 * wait for the 16:00 batch. The hub stops, and starts at 09:00 the next day, when the next batch is 16:00: both
 * authority deadlines come before it, so each shows in Needs you within 5 s of the start, by the wall clock.
 */
export const hubStoppedAcrossBatch = (plant?: Planting): Promise<void> =>
  inWorld({ settings: settings({ batch: { every: '8h', cap: 10 } }), ...(plant ? { plant } : {}) }, async (w) => {
    await w.start('S1', 'T1');
    await w.start('S2', 'T2');
    await w.start('S3', 'T3');
    const a = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'feature/login'));
    const b = await w.asks.raise(core('S2'), sourceOf('authority'), ask('authority', 'feature/billing'));
    await w.asks.raise(core('S3'), sourceOf('taste'), ask('taste', 'header'));
    expect((await createdData(w, a)).deadline, `ask ${a} takes the 1-day authority deadline`).toBe(T0 + DAY);
    expect(await w.shown(), 'asks whose deadlines come after the 16:00 batch wait for it').toEqual([]);
    await w.at(T0 + 30 * MINUTE);
    await w.stop();
    w.clock.set(STOPPED_UNTIL);
    const started = performance.now();
    await w.restart();
    const due = [a, b];
    const late: string[] = [];
    for (;;) {
      const shown = await w.shown();
      const elapsed = performance.now() - started;
      const missing = due.filter((h) => !shown.includes(h));
      if (!missing.length) break;
      if (elapsed > START_BUDGET_MS) { late.push(...missing); break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const h of late) expect.fail(`ask ${h}, whose deadline comes before the next batch, didn't show in Needs you within 5 s of the hub's start`);
    // The taste call's deadline is days away, after the next batch: it may wait for it either way.
    await w.at(T0 + DAY);
    for (const h of due) expect((await w.about(h)).filter((e) => e.kind === 'ask.defaulted'), `ask ${h} takes no at its deadline`).toHaveLength(1);
    await noDefaultBeforeShown(w);
  });

/**
 * #319.466f1905: for one person (fallback and owner you, no queue named), an authority ask raised under the
 * drafted settings takes no at its 1-day deadline: one ask.defaulted, deny, stamped at the deadline, and no
 * ask.escalated, since nobody is there to take it.
 */
export const authorityAtDeadline = (plant?: Planting): Promise<void> =>
  inWorld({ settings: settings(), ...(plant ? { plant } : {}) }, async (w) => {
    await w.start('S1', 'T1');
    const h = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'feature/login'));
    const deadline = (await createdData(w, h)).deadline;
    expect(deadline, `ask ${h} takes the 1-day authority deadline drafted at setup`).toBe(T0 + DAY);
    await w.shown();
    await w.at(T0 + DAY - 1);
    expect((await w.about(h)).filter((e) => CLOSING.includes(e.kind)), `ask ${h} stays open until its deadline`).toEqual([]);
    await w.at(T0 + DAY);
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    expect(closing.map((e) => e.kind), `ask ${h} is recorded as defaulted at its deadline, never as escalated with nobody to take it`).toEqual(['ask.defaulted']);
    expect(closing[0]!.ts, `ask ${h} takes no at its deadline`).toBe(T0 + DAY);
    expect((closing[0]!.data as { decision: string }).decision, `ask ${h} takes no`).toBe('deny');
    expect((await w.row(h))?.outcome, `ask ${h}'s outcome`).toBe('defaulted');
    const row = await w.inboxRow(h);
    expect([row?.status, row?.outcome], `ask ${h} reads as defaulted in the inbox`).toEqual(['closed', 'defaulted']);
    expect(w.deliveries.filter((d) => d.ask === h).map((d) => d.decision), `ask ${h}: the agent hears the no once`).toEqual(['deny']);
    await noDefaultBeforeShown(w);
  });

export const DONE_YAML = `# .deepbuild/done.yaml: drafted, approved once, then protected
claims:
  done:
    checks: [unit]
checks:
  unit: { type: command, run: "npm test", min_tests: 1 }
asks:
  deadline: { taste: 5d, authority: 12h }
`;

/**
 * #319.d452dc28: your settings change the choice deadline to 36 hours; the repo's done.yaml sets deadlines
 * only for taste (5 days) and authority (12 hours). A choice ask in that repo takes 36 hours and its
 * recommended option from your settings, the taste call and the authority ask take the repo's deadlines, and
 * none fails its schema or reads as undeclared.
 */
export const choiceFromYourSettings = (plant?: Planting): Promise<void> =>
  inWorld({ settings: settings({ deadline: { choice: '36h' } }), ...(plant ? { plant } : {}) }, async (w) => {
    await w.start('S1', 'T1', repoWith(w.dir, DONE_YAML));
    let choice: string | undefined;
    let refusal: unknown;
    try {
      choice = await w.asks.raise(core('S1'), sourceOf('choice'), ask('choice', 'storage'));
    } catch (error) {
      refusal = error;
    }
    expect(refusal, `the choice ask in a repo whose done.yaml declares no choice deadline is raised, not refused as undeclared`).toBeUndefined();
    const created = (await w.events('ask.created')).find((e) => e.id === choice!.replace(/^ask:/, ''))!;
    const data = created.data as { deadline: number; default: string };
    expect(data.deadline, `the choice ask ${choice} takes the choice deadline from your own settings`).toBe(T0 + 36 * HOUR);
    expect(data.default, `the choice ask ${choice} takes its recommended option, your settings' choice default`).toBe('files');
    const { v, id, kind, writer, actor, scope, ts } = created;
    const checked = validate('ask.created@1', { v, id, kind, writer, actor, scope, ts, data: created.data });
    expect(checked.ok, `the choice ask ${choice} passes ask.created@1`).toBe(true);
    const row = await w.inboxRow(choice!);
    expect(row?.status, `the choice ask ${choice} reads as waiting on you, never as blocked or undeclared`).toMatch(/^(queued|shown)$/);
    const taste = await w.asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    const authority = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'feature/login'));
    expect((await createdData(w, taste)).deadline, `the taste ask ${taste} takes the repo's 5-day deadline`).toBe(T0 + 5 * DAY);
    expect((await createdData(w, authority)).deadline, `the authority ask ${authority} takes the repo's 12-hour deadline`).toBe(T0 + 12 * HOUR);
    await w.shown();
    await w.at(T0 + 36 * HOUR);
    const defaulted = (await w.about(choice!)).filter((e) => e.kind === 'ask.defaulted');
    expect(defaulted.map((e) => [(e.data as { answer: string }).answer, e.ts]), `the choice ask ${choice} takes its recommended option at 36 hours`).toEqual([['files', T0 + 36 * HOUR]]);
  });
