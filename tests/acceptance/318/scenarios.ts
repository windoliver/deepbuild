// The scenarios of the criteria whose wrong programs the issue names. Each test runs one on a real world,
// and plants.test.ts runs it on the world with that wrong program planted, where it must fail naming
// what the criterion says it names.

import { expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { AskRefused, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskSource, Delivery } from '../../../packages/asks/src/index.ts';
import {
  DAY, HOUR, KINDS, MINUTE, T0, about, ask, card, core, created, deliveredFor, agent, inbox, isObj, plan, refused,
  planShown, sha256, shown, shownAsks, sourceOf, stored, type Obj, type World,
} from './helpers.ts';

/** #318.d249acdc: decision only from the option chosen on the trusted path. */
export async function pushAnsweredInWords(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const a = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', now, { subject: 'push-a' }), plan('feature/a'));
  const ha = await planShown(w, a);
  // An answer carrying its own decision is refused, naming the field.
  await refused(w.asks.answer(card, a, { option: 'hold', decision: 'allow', plan_hash: ha, token: 'click-0' }), { field: 'decision' });
  expect(about(await w.events('ask.answered'), a), `ask ${a}: an answer carrying decision was recorded`).toHaveLength(0);
  // Words alone are none, and the push never runs.
  await w.asks.answer(card, a, { words: 'yes but not on main' });
  const [answered] = about(await w.events('ask.answered'), a);
  expect(isObj(answered?.data) && answered.data.decision, `ask ${a} answered in words records decision none`).toBe('none');
  expect(await w.asks.authorized(a, ha), `ask ${a}: the push runs after words alone`).toBeNull();
  expect(deliveredFor(w, a).map((d) => [d.decision, d.words]), `ask ${a}: the agent hears none, with the words as the reason`).toEqual([['none', 'yes but not on main']]);
  // Choosing the allow option records allow and runs only the plan whose digest it showed.
  const b = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', now, { subject: 'push-b' }), plan('feature/b'));
  const hb = await planShown(w, b);
  await w.asks.answer(card, b, { option: 'push', plan_hash: hb, token: 'click-1' });
  const [allowed] = about(await w.events('ask.answered'), b);
  expect(isObj(allowed?.data) && [allowed.data.decision, allowed.data.plan_hash], `ask ${b} answered with its allow option`).toEqual(['allow', hb]);
  expect(await w.asks.authorized(b, hb), `ask ${b}: the plan it showed runs, bound to the click`).toBe('click-1');
  expect(await w.asks.authorized(b, sha256('another plan')), `ask ${b}: a plan it never showed runs`).toBeNull();
}

/** #318.e4675a8d: the four fields live in the log, so a rebuilt ask still ends at its deadline. */
export async function rebuildFromLog(w: World): Promise<void> {
  await w.start('S1', 'T1');
  await w.start('S2', 'T2');
  const now = w.clock.now();
  const raised: { handle: string; data: Obj }[] = [];
  for (const [session, kind, subject, fallback] of [['S1', 'authority', 'push', 'you'], ['S1', 'taste', 'header', 'queue:design'], ['S2', 'choice', 'store', 'queue:storage']] as const) {
    const data = ask(kind, now, { subject, fallback });
    raised.push({ handle: await w.asks.raise(core(session), sourceOf(kind), data, kind === 'authority' ? plan('feature/rebuilt') : undefined), data });
  }
  await w.record.rebuild();
  for (const { handle, data } of raised) {
    const row = await w.row(handle);
    for (const field of ['fallback', 'owner', 'key', 'pinned_to'] as const) {
      expect(stored(row?.[field]), `rebuilt ask ${handle} keeps its ${field}`).toEqual(data[field]);
    }
  }
  // A new core on the rebuilt record, past every deadline: each ask goes to its fallback.
  const deliveries: Delivery[] = [];
  const again = await openAsks({ record: w.record, now: w.clock.now, deliver: (d) => { deliveries.push(d); } });
  w.clock.set(now + 3 * DAY);
  await again.tick();
  const closing = (await w.events()).filter((e) => e.kind === 'ask.defaulted' || e.kind === 'ask.escalated');
  for (const { handle } of raised) {
    expect(about(closing, handle), `rebuilt ask ${handle} past its deadline goes to its fallback`).toHaveLength(1);
    expect(['defaulted', 'escalated'], `rebuilt ask ${handle}'s outcome`).toContain((await w.row(handle))?.outcome);
  }
}

/** #318.b4c25197, first rule: supersede follows the thread across /compact. */
export async function supersedeAcrossCompact(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const first = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header' }));
  await w.start('S2', 'T1'); // /compact: the same thread under a rotated ID
  const newer = await w.asks.raise(agent('S2'), sourceOf('taste'), ask('taste', now, { subject: 'header', question: 'Which header, after the compact?', pinned_to: shown('header v2') }));
  await w.asks.tick();
  const cards = (await shownAsks(w)).filter((h) => h === first || h === newer);
  expect(cards, 'thread T1: one card for its subject across /compact').toEqual([newer]);
  const [superseded] = about(await w.events('ask.superseded'), first);
  expect(isObj(superseded?.data) && superseded.data.by, 'thread T1: the first ask is superseded by the newer').toBe(newer);
}

/** #318.b4c25197, second rule: the fold counts the thread's open asks across /clear. */
export async function foldAcrossClear(w: World): Promise<void> {
  await w.start('S3', 'T2');
  const now = w.clock.now();
  const raise = (session: string, i: number) => w.asks.raise(agent(session), sourceOf('taste'), ask('taste', now, { subject: `screen-${i}` }));
  for (const i of [1, 2, 3]) await raise('S3', i);
  await w.start('S4', 'T2'); // /clear: the same thread under a rotated ID
  for (const i of [4, 5]) await raise('S4', i);
  const sixth = await raise('S4', 6);
  await w.asks.tick();
  const cards = await w.asks.needsYou();
  expect(cards.map((c) => c.ask), 'thread T2: the sixth open ask has a card of its own').not.toContain(sixth);
  const exception = cards.find((c) => c.folded.includes(sixth));
  expect(exception?.kind, 'thread T2: the sixth open ask folds into the exception').toBe('exception');
}

/** #318.898ac861: a late allow after the default is refused, and nothing more reaches the agent. */
export async function lateAllow(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const a = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', T0, { subject: 'push-late' }), plan('feature/late'));
  const hash = await planShown(w, a);
  const noon = T0 + DAY; // 2026-10-21 12:00 UTC
  w.clock.set(noon);
  await w.asks.tick();
  const [defaulted] = about(await w.events('ask.defaulted'), a);
  expect(isObj(defaulted?.data) && [defaulted.data.decision, defaulted.ts], `ask ${a} takes its default no at 12:00`).toEqual(['deny', noon]);
  expect(deliveredFor(w, a).map((d) => d.decision), `ask ${a}: the agent hears the default no`).toEqual(['deny']);
  w.clock.set(noon + MINUTE);
  let error: unknown;
  try {
    await w.asks.answer(inbox, a, { option: 'push', plan_hash: hash });
  } catch (e) {
    error = e;
  }
  expect(deliveredFor(w, a).map((d) => d.decision), `ask ${a}: the late allow reached the agent`).toEqual(['deny']);
  expect(about(await w.events('ask.answered'), a), `ask ${a}: the late allow is recorded as answered`).toHaveLength(0);
  const refusal = await refused(Promise.reject(error), { outcome: 'defaulted' });
  expect(refusal.closed_at, `ask ${a}: the refusal names when it closed`).toBe(noon);
  const after = about(await w.events(), a).filter((e) => e.log_pos > defaulted!.log_pos);
  const named = after.filter((e) => /defaulted/.test(JSON.stringify(e.data)) && (JSON.stringify(e.data).includes(String(noon)) || JSON.stringify(e.data).includes('2026-10-21T12:00')));
  expect(named, `ask ${a}: the refused answer is recorded, naming defaulted and 12:00`).toHaveLength(1);
  expect((await w.row(a))?.outcome, `ask ${a} stays defaulted`).toBe('defaulted');
  expect(await w.asks.authorized(a, hash), `ask ${a}: the push runs after a late allow`).toBeNull();
  expect((await w.asks.card(a)).undo, `ask ${a}: its card offers the undo`).toBe(true);
}

/** #318.af2a2599: one row per place that raises an ask, each with a fixture that takes its default. */
export async function sourcesTable(rows: AskSource[], open: () => Promise<World>): Promise<void> {
  expect(validate('ask.sources@1', rows), 'the table holds to ask.sources@1').toEqual({ ok: true });
  expect(new Set(rows.map((r) => r.source)).size, 'one row per place').toBe(rows.length);
  for (const kind of KINDS) expect(rows.some((r) => r.kind === kind), `some place raises a ${kind} ask`).toBe(true);
  for (const name of ['budget.raise', 'generation.paid']) {
    const row = rows.find((r) => r.source === name);
    expect(row?.kind, `row ${name} files an authority ask`).toBe('authority');
  }
  for (const row of rows) {
    const data = row.fixture.ask as Obj;
    expect(data.kind, `row ${row.source}: its fixture is an ask of the row's kind`).toBe(row.kind);
    expect(validate('ask.created@1', created(data)), `row ${row.source}: its fixture is a valid ask.created`).toEqual({ ok: true });
    if (row.kind === 'authority') expect(row.fixture.at_deadline.decision, `row ${row.source}: an authority ask defaults to no`).toBe('deny');
    // Raised as DeepBuild raises it, then left to its deadline on the virtual clock.
    const w = await open();
    try {
      const deadline = data.deadline as number;
      w.clock.set(deadline - HOUR);
      await w.start('R1', 'TR');
      const handle = await w.asks.raise(core('R1'), row.source, data);
      w.clock.set(deadline);
      await w.asks.tick();
      const [taken] = about(await w.events('ask.defaulted'), handle);
      expect(isObj(taken?.data) && taken.data.decision, `row ${row.source}: its ask takes its default at the deadline`).toBe(row.fixture.at_deadline.decision);
    } finally {
      await w.close();
    }
  }
  // As authority asks, a budget raise and a paid generation take no at their deadline, even when the
  // ask's own default names an option that approves (or such an ask is refused and never raised).
  for (const name of ['budget.raise', 'generation.paid']) {
    const data = structuredClone(rows.find((r) => r.source === name)!.fixture.ask) as Obj;
    data.options = [...(data.options as Obj[]), { id: 'approve_twin', label: 'Approve', decision: 'allow' }];
    data.default = 'approve_twin';
    const w = await open();
    try {
      w.clock.set((data.deadline as number) - HOUR);
      await w.start('R3', 'TR');
      const handle = await w.asks.raise(core('R3'), name, data).catch((error: unknown) => {
        expect(error, `row ${name}: an ask defaulting to approve failed otherwise than by refusal`).toBeInstanceOf(AskRefused);
        return null;
      });
      if (handle === null) continue;
      w.clock.set(data.deadline as number);
      await w.asks.tick();
      const [taken] = about(await w.events('ask.defaulted'), handle);
      expect(isObj(taken?.data) && taken.data.decision, `row ${name}: takes no at its deadline`).toBe('deny');
    } finally {
      await w.close();
    }
  }
  // A planted place with no row can't raise one.
  const w = await open();
  try {
    await w.start('R2', 'TR');
    const before = (await w.events('ask.created')).length;
    await refused(w.asks.raise(core('R2'), 'planted.no_row', ask('taste', w.clock.now())), { source: 'planted.no_row' });
    expect((await w.events('ask.created')).length, 'a source with no row raised an ask').toBe(before);
  } finally {
    await w.close();
  }
}

