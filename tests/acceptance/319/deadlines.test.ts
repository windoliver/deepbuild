// #319.466f1905, #319.ba0ff138 and #319.3699b37e: what happens at a deadline, for one person, on the virtual
// clock. Your settings are the drafted ones with no batch schedule, so every ask shows when it's raised.

import { afterEach, expect, test } from 'vitest';
import { AskRefused } from '../../../packages/asks/src/index.ts';
import {
  ask, AT_DEADLINE, card, CLOSING, core, createdData, DAY, DEADLINE_MS, HOUR, KINDS, MINUTE, noDefaultBeforeShown, openWorld,
  settings, sourceOf, T0, type World,
} from './helpers.ts';
import { authorityAtDeadline } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#319.466f1905 for one person, an authority ask past its 1-day deadline takes no at that deadline, recorded as defaulted, never as escalated', async () => {
  await authorityAtDeadline();
});

test('#319.ba0ff138 at its deadline an ask takes its default, announced to the agent and undoable from Needs you', async () => {
  const w = (world = await openWorld({ settings: settings() }));
  await w.start('S1', 'T1');
  const h = await w.asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
  expect(await w.shown(), `ask ${h} shows`).toContain(h);
  await w.at(T0 + 3 * DAY);
  const defaulted = (await w.about(h)).filter((e) => e.kind === 'ask.defaulted');
  expect(defaulted.map((e) => [e.ts, (e.data as { answer: string }).answer]), `ask ${h} takes its recommended option at its deadline`).toEqual([[T0 + 3 * DAY, 'green']]);
  expect(w.deliveries.filter((d) => d.ask === h).map((d) => [d.option, d.decision]), `ask ${h}: the default is announced to the agent once`).toEqual([['green', 'none']]);
  expect((await w.asks.card(h)).undo, `ask ${h}: Needs you offers the default's undo`).toBe(true);
  await noDefaultBeforeShown(w);
});

test('#319.ba0ff138 anything irreversible defaults to no, and a default never makes a claim pass', async () => {
  const w = (world = await openWorld({ settings: settings() }));
  for (const n of [1, 2, 3, 4]) await w.start(`S${n}`, `T${n}`);
  // An authority ask whose own default names its allow option still takes no.
  const push = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'feature/login', { default: 'push' }));
  // A choice whose recommended option approves (declares allow) takes no too, or is refused when raised.
  let paid: string | undefined;
  try {
    paid = await w.asks.raise(core('S2'), sourceOf('choice'), ask('choice', 'render', {
      options: [{ id: 'generate', label: 'Generate it (paid)', decision: 'allow' }, { id: 'skip', label: 'Skip it', decision: 'none' }],
      recommended: 'generate',
    }));
  } catch (error) {
    expect(error, 'a choice whose recommended option approves is refused, or defaults to no').toBeInstanceOf(AskRefused);
  }
  const unblock = await w.asks.raise(core('S3'), sourceOf('unblock'), ask('unblock', 'github sign-in'));
  const exception = await w.asks.raise(core('S4'), sourceOf('exception'), ask('exception', 'lint waiver'));
  await w.shown();
  await w.at(T0 + 3 * DAY);
  for (const h of [push, ...(paid ? [paid] : [])]) {
    const decisions = (await w.about(h)).filter((e) => e.kind === 'ask.defaulted').map((e) => (e.data as { decision: string }).decision);
    expect(decisions, `ask ${h}, whose default would approve, takes no at its deadline`).toEqual(['deny']);
    expect(w.deliveries.filter((d) => d.ask === h).map((d) => d.decision), `ask ${h}: the agent hears no`).toEqual(['deny']);
  }
  expect(await w.asks.authorized(push, 'f'.repeat(64)), `ask ${push}: nothing is authorized by a default`).toBeNull();
  for (const [h, answer] of [[unblock, 'wait'], [exception, 'keep']] as const) {
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    expect(closing.map((e) => [e.kind, (e.data as { answer?: string }).answer, (e.data as { decision?: string }).decision]), `ask ${h} takes its default, which changes nothing`).toEqual([['ask.defaulted', answer, 'none']]);
  }
  const passing = (await w.events()).filter((e) => ['verdict.made', 'claim.made', 'decision.created', 'decision.applied', 'run.finished'].includes(e.kind));
  expect(passing.map((e) => e.kind), 'no default records a verdict, a claim, a run or a decision').toEqual([]);
});

test('#319.ba0ff138 Later hides an ask until a time you pick and never past its deadline', async () => {
  const w = (world = await openWorld({ settings: settings() }));
  await w.start('S1', 'T1');
  const h = await w.asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
  const deadline = T0 + 3 * DAY;
  expect(await w.shown(), `ask ${h} shows`).toContain(h);
  await w.asks.later(card, h, T0 + HOUR);
  expect(await w.shown(), `ask ${h} hides until the time you picked`).not.toContain(h);
  expect((await w.inboxRow(h))?.status, `ask ${h} reads as later in the inbox`).toBe('later');
  await w.at(T0 + HOUR);
  expect(await w.shown(), `ask ${h} is back at the time you picked`).toContain(h);

  // A time past the deadline: refused naming the time, or recorded no later than the deadline.
  try {
    await w.asks.later(card, h, deadline + DAY);
  } catch (error) {
    expect(error, `ask ${h}: a Later past the deadline is refused`).toBeInstanceOf(AskRefused);
    expect((error as AskRefused).field, 'the refusal names the time').toMatch(/(^|\/)until$/);
  }
  for (const e of (await w.about(h)).filter((x) => x.kind === 'ask.later')) {
    expect((e.data as { until: number }).until, `ask ${h}: no Later is recorded past its deadline`).toBeLessThanOrEqual(deadline);
  }
  await w.at(deadline - MINUTE);
  expect((await w.about(h)).filter((e) => CLOSING.includes(e.kind)), `ask ${h} is still open before its deadline`).toEqual([]);
  await w.at(deadline);
  expect((await w.about(h)).filter((e) => e.kind === 'ask.defaulted').map((e) => e.ts), `ask ${h} takes its default at its deadline, not at the later time`).toEqual([deadline]);
});

test('#319.3699b37e no ask is ever closed silently: past its deadline each goes to its fallback, then its announced default, and each step is recorded', async () => {
  // Raised at 12:30 with batches every 8 hours and a cap of one: the early question's deadline, 16:30, comes
  // after the 16:00 batch, which has room for only one of the six; the hub runs every half hour.
  const raisedAt = T0 + 30 * MINUTE;
  const w = (world = await openWorld({ settings: settings({ batch: { every: '8h', cap: 1 } }), start: raisedAt }));
  const raised = new Map<string, (typeof KINDS)[number]>();
  for (const [i, kind] of KINDS.entries()) {
    await w.start(`S${i}`, `T${i}`);
    raised.set(await w.asks.raise(core(`S${i}`), sourceOf(kind), ask(kind, `subject ${i}`)), kind);
  }
  for (let t = raisedAt; t <= raisedAt + 3 * DAY + HOUR; t += 30 * MINUTE) {
    await w.at(t);
    await w.shown();
  }
  for (const [h, kind] of raised) {
    const deadline = (await createdData(w, h)).deadline as number;
    expect(deadline, `ask ${h} (${kind}) takes its drafted deadline`).toBe(raisedAt + DEADLINE_MS[kind]);
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    // For one person the fallback is you, with no one above: the default applies, recorded at the deadline.
    expect(closing.map((e) => [e.kind, e.ts, (e.data as { answer: string }).answer, (e.data as { decision: string }).decision]), `ask ${h} (${kind}) is recorded taking its default at its deadline`)
      .toEqual([['ask.defaulted', deadline, AT_DEADLINE[kind].answer, AT_DEADLINE[kind].decision]]);
    expect(w.deliveries.filter((d) => d.ask === h).map((d) => d.option), `ask ${h} (${kind}): its default is announced to the agent`).toEqual([AT_DEADLINE[kind].answer]);
    expect((await w.asks.card(h)).undo, `ask ${h} (${kind}): its default can be undone from Needs you`).toBe(true);
  }
  // Every ask the inbox reads as closed has the event that closed it.
  const inbox = await w.asks.inbox();
  for (const h of raised.keys()) expect(inbox.find((r) => r.ask === h)?.outcome, `ask ${h} reads as defaulted in the inbox`).toBe('defaulted');
  for (const row of inbox.filter((r) => r.status === 'closed')) {
    const closing = (await w.about(row.ask)).filter((e) => CLOSING.includes(e.kind));
    expect(closing, `ask ${row.ask} reads as ${row.outcome} with an event that closed it`).toHaveLength(1);
  }
  await noDefaultBeforeShown(w);
});
