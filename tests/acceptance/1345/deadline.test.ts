// AC4: a call nobody answers takes its recommended answer at its deadline, recorded as a default, and its issue
// closes. The record reads default, never your answer: no answer and no decision of yours. Your visits come once a day
// and the hub's clock is the test's: the call shows at the next visit, then its deadline passes.
import { expect, test } from 'vitest';
import { closing, deadlineOf, FIRST, lists, MIN, named, openCallsOf, said, waitUntil, World, type Ev } from './helpers.ts';

const N = 100;

test(named(4), async () => {
  const w = await World.open({ issues: [{}], atOnce: 'one', visits: true, clock: true });
  await w.startRun();
  const merged = await waitUntil(() => w.mergeOf(N), FIRST, 2000);
  expect(merged, `#${N}'s reversible change, its taste call open, lands within ${FIRST / MIN} minutes of the approval (${await w.about(N)})`).toBeDefined();
  const call = await waitUntil(async () => openCallsOf(await w.events(), N)[0], 5 * MIN, 2000);
  expect(call, `#${N}'s taste call is open in the record once its change landed`).toBeDefined();

  // Your next visit comes, which shows it; then its deadline passes with no answer: stepped past it, and again if the
  // core moved it, as it does for an ask that first showed with less than its notice left (#908).
  await w.toNextVisit();
  await waitUntil(async () => (await w.events()).some((e) => lists(e, call!.handle)), 2 * MIN, 2000);
  let defaulted: Ev | undefined;
  for (let round = 0; round < 3 && !defaulted; round++) {
    const deadline = deadlineOf(await w.events(), call!);
    expect(Number.isFinite(deadline), `${call!.handle} has a deadline: ${JSON.stringify(call!.data.deadline)}`).toBe(true);
    await w.clock(deadline + 2 * MIN - (await w.clock(0)));
    defaulted = await waitUntil(async () => (await w.events()).find((e) => e.kind === 'ask.defaulted' && e.subject === call!.handle), 5 * MIN, 2000);
  }
  expect(defaulted, `${call!.handle}, unanswered at its deadline, takes its default`).toBeDefined();
  expect(defaulted!.data.answer, `the answer it takes is ${call!.handle}'s recommended one`).toBe(call!.data.recommended);
  const closed = await waitUntil(() => w.state(N) === 'closed', 5 * MIN, 2000);
  expect(closed, `#${N} closes once its call took its recommended answer`).toBe(true);
  const events = await w.events();
  expect(closing(events, call!.handle)?.kind, `${call!.handle} closed as a default`).toBe('ask.defaulted');
  expect(events.filter((e) => e.kind === 'ask.answered' && e.subject === call!.handle).map(said), 'the record never reads your answer').toEqual([]);
  expect(events.filter((e) => e.kind === 'decision.created' && e.subject === call!.handle).map(said), 'a default is saved as no decision of yours').toEqual([]);
}, 90 * MIN);
