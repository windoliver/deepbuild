// AC2 #120.4c1ac190: a promised later check wakes an idle Claude Code session at its time without you typing.
// AC3 #120.5f22a00c: a promise set again a fourth time, or past its end, becomes BLOCKED with a named owner (the
// service or you) and at most one ask, and no further wake-up fires.
//
// The promise is the agent's last words, "I'll check the deploy again in 20 minutes." (README: The promise), so its
// due time is its stop plus 20 minutes. The session stops, idle, its waiter (DeepBuild's asyncRewake Stop entry)
// waiting; time moves on by restarting the hub with its test clock (README: Time), and the waiter, whose life is its
// session's, asks the new hub again (#25, AC6). A wake is the waiter exiting 2 and Claude Code starting a turn from it,
// nobody typing (fixtures/claude.mjs, #80). The wake-up's record carries the quote, its due time, how many times it has
// been set and an end (README: The wake-up record).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, AC3, allEvents, awaitEvent, begin, cleanup, edits, evShown, hubWithSetup, inboxRead, makeHome, MINUTE, moveOn, newSession, numbers, PROMISE_MS, QUOTE, sleep, stop, times,
  waitFor, wakeAfter, wakeupEvents, type Claude, type Ev, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** How far a recorded due time may sit from the stop plus the promise: the promise is read at the stop, give or take. */
const SLACK_MS = 2 * MINUTE;

/** A session that works, promises the check and stops; its waiter is waiting. Returns the stop's time at the hub. */
async function promised(hub: Hub, s: Session, claude: Claude): Promise<{ stopTs: number; wakeup: Ev }> {
  const before = (await allEvents(hub)).length;
  const fired = await stop(claude, s, QUOTE);
  if (fired.blocked) throw Error(`the stop goes through (nothing to send back): ${fired.blocked}`);
  const stopEv = await awaitEvent(hub, s, (e) => e.kind === 'agent.stop' && e.log_pos > before, 'the stop');
  await waitFor(async () => (await claude.liveWaiters(s.id)).length > 0 || undefined, 30_000, `${s.id}'s waiter, waiting once its stop went through`);
  const wakeup = await waitFor(async () => wakeupEvents(await allEvents(hub), s.id)[0], 15_000, `the wake-up recorded with the quote ${JSON.stringify(QUOTE)}`)
    .catch(() => undefined);
  expect(wakeup, `the promise ${JSON.stringify(QUOTE)} is recorded as a wake-up (an event carrying its quote) once the session stopped; the session's events: ${(await allEvents(hub)).filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`).toBeDefined();
  return { stopTs: stopEv.ts, wakeup: wakeup! };
}
/** The wake-up's due time: a time in its data about 20 minutes after the stop. */
const dueOf = (wakeup: Ev, stopTs: number): { key: string; at: number } | undefined => times(wakeup.data).find((t) => Math.abs(t.at - (stopTs + PROMISE_MS)) <= SLACK_MS);

describe(`${AC2} A promised later check wakes an idle Claude Code session at its time without you typing`, () => {
  it(`${AC2} the session that said ${JSON.stringify(QUOTE)} and stopped is not woken before its time; 21 minutes on, its waiter wakes it with the promised check, nobody typing`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
    await edits(claude, s);
    const { stopTs, wakeup } = await promised(hub, s, claude);
    const due = dueOf(wakeup, stopTs);
    expect(due, `${AC2} the wake-up is recorded with its due time, about 20 minutes after the stop (${stopTs}): ${evShown(wakeup)}`).toBeDefined();
    // Not before its time: nothing wakes the session while the promise is young.
    await sleep(3000);
    expect(wakeAfter(claude, s, stopTs - MINUTE), `${AC2} no wake before the promised time: ${JSON.stringify(claude.wakes)}`).toBeUndefined();
    // Its time comes.
    const before = Date.now();
    hub = await moveOn(hub, PROMISE_MS + MINUTE);
    const wake = await waitFor(() => wakeAfter(claude, s, before), 30_000, 'the wake').catch(() => undefined);
    const waiters = await claude.background();
    expect(wake, `${AC2} the idle session wakes within 30 s of its time, from its waiter (exit 2), nobody typing; waiters: ${JSON.stringify(waiters.filter((r) => r.asyncRewake).map((r) => ({ code: r.code, ended: r.ended, stderr: r.stderr.slice(0, 300) })))}; wakes: ${JSON.stringify(claude.wakes)}`).toBeDefined();
    expect(wake!.prompt, `${AC2} the wake's turn carries the promised check (its quote or the deploy it names): ${JSON.stringify(wake!.prompt).slice(0, 600)}`).toMatch(/deploy|check the deploy again/i);
    expect(wake!.prompt, `${AC2} the wake's turn is the waiter's task-notification, not a typed prompt`).toContain('task-notification');
    await claude.end();
  }, 120_000);
});

describe(`${AC3} A promise set again a fourth time, or past its end, becomes BLOCKED with a named owner (the service or you) and at most one ask, and no further wake-up fires`, () => {
  /** The BLOCKED record for the promise: an event about the session saying BLOCKED that names the quote or the deploy. */
  const blockedOf = (events: Ev[], s: Session): Ev[] => events.filter((e) => e.session === s.id && /BLOCKED/.test(JSON.stringify(e.data)) && /deploy/i.test(JSON.stringify(e.data)));
  async function wakeThen(hub: Hub, s: Session, claude: Claude, ms: number): Promise<{ hub: Hub; stopTs: number }> {
    const before = Date.now();
    hub = await moveOn(hub, ms);
    const wake = await waitFor(() => wakeAfter(claude, s, before), 30_000, 'the wake').catch(() => undefined);
    if (!wake) throw Error(`the wake-up must wake the session at its time (as AC2 proves) for the promise to be set again: wakes ${JSON.stringify(claude.wakes)}`);
    // In the woken turn the agent promises the same check again, and stops.
    const count = (await allEvents(hub)).length;
    await stop(claude, s, QUOTE);
    const stopEv = await awaitEvent(hub, s, (e) => e.kind === 'agent.stop' && e.log_pos > count, 'the stop');
    return { hub, stopTs: stopEv.ts };
  }
  async function noFurtherWake(hub: Hub, s: Session, claude: Claude): Promise<Hub> {
    const before = Date.now();
    hub = await moveOn(hub, PROMISE_MS + MINUTE);
    await sleep(5000);
    expect(wakeAfter(claude, s, before), `${AC3} no further wake-up fires once the promise is BLOCKED: ${JSON.stringify(claude.wakes.filter((w) => (w.started ?? 0) >= before))}`).toBeUndefined();
    return hub;
  }
  async function blocked(hub: Hub, s: Session, claude: Claude, what: string): Promise<void> {
    const events = await allEvents(hub);
    const found = blockedOf(events, s);
    const wakeups = wakeupEvents(events, s.id);
    expect(found.length, `${AC3} ${what}: the promise becomes BLOCKED in the record (an event saying BLOCKED about the deploy check); the wake-up events: ${wakeups.map(evShown).join('; ')}`).toBeGreaterThan(0);
    const owner = found.map((e) => JSON.stringify(e.data)).join(' ');
    expect(owner, `${AC3} the BLOCKED names its owner, the service or you: ${owner.slice(0, 600)}`).toMatch(/\b(service|you)\b/);
    const asks = (await inboxRead(hub)).filter((a) => /deploy/i.test(JSON.stringify(a)));
    expect(asks.length, `${AC3} at most one ask about it: ${JSON.stringify(asks).slice(0, 600)}`).toBeLessThanOrEqual(1);
    await claude.end();
  }

  it(`${AC3} set a fourth time (the same promise again in each woken turn) it is BLOCKED with its owner and at most one ask, and the next due time wakes nothing`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
    await edits(claude, s);
    const first = await promised(hub, s, claude);
    const sets = numbers(first.wakeup.data).filter((n) => /set|times|count|attempt/i.test(n.key));
    expect(sets.map((n) => n.n), `${AC3} the first wake-up is recorded as set once: ${evShown(first.wakeup)}`).toContain(1);
    // Set again: the second, third and fourth times.
    for (let n = 2; n <= 4; n++) ({ hub } = await wakeThen(hub, s, claude, PROMISE_MS + MINUTE));
    hub = await noFurtherWake(hub, s, claude);
    await blocked(hub, s, claude, 'set a fourth time');
  }, 300_000);

  it(`${AC3} set again past its end (the record's \`end\`) it is BLOCKED with its owner and at most one ask, and nothing wakes the session again`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
    await edits(claude, s);
    const first = await promised(hub, s, claude);
    const end = times(first.wakeup.data).find((t) => /end/i.test(t.key));
    expect(end, `${AC3} the wake-up is recorded with an end (a time in a field named end): ${evShown(first.wakeup)}`).toBeDefined();
    expect(end!.at, `${AC3} the end comes after the due time`).toBeGreaterThan(first.stopTs + PROMISE_MS - SLACK_MS);
    // Past its end: the wake comes late, and the agent promises again in that turn.
    const past = end!.at - hub.clock + MINUTE;
    ({ hub } = await wakeThen(hub, s, claude, Math.max(past, PROMISE_MS + MINUTE)));
    hub = await noFurtherWake(hub, s, claude);
    await blocked(hub, s, claude, 'set again past its end');
  }, 300_000);
});
