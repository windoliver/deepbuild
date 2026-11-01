// The scenarios the criteria name, shared by their own tests and plants.test.ts: each opens its own world, with the
// planted wrong program when one is given, and closes it. Every deadline and window runs on the virtual clock.

import { expect } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import {
  BOT, cardIn, chatTask, CONTINUE_WINDOW, core, EXPECTED_REPLY, HOUR, inboxRow, inWorld, isObj, MINUTE, nothingTyped, openTasks, provesOf, QUESTION, raised, SECOND, STOPS, T0,
  tasksFor, theOneTask, THREAD_LINK, YOU, type Cause, type Planting, type StopInput, type World,
} from './helpers.ts';

/** The five sessions one block stops. */
export const FIVE = ['S1', 'S2', 'S3', 'S4', 'S5'];
/** How soon after its check passes a shared task's sessions resume (criteria 8 and 9). */
export const RESUME_WITHIN = 30 * SECOND;

/** Each session's row shows the stop with its cause. */
export async function rowShowsCause(w: World, session: string, cause: Cause, what: string): Promise<void> {
  const row = await w.sessionRow(session);
  expect(row, `${what}: session ${session} has a row`).toBeDefined();
  expect(row!.cause, `${what}: session ${session}'s row shows its stop's cause`).toBe(cause);
}

/**
 * Criteria 1, 8 and 9: five sessions stopped by one cause (a revoked sign-in, a VPN you must reconnect, a spend
 * limit) share one task; when its check passes, every one of them resumes within 30 s, with nothing typed.
 */
export const sharedTask = (stop: StopInput, label: string, plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    const stops = new Map<string, string>();
    for (const [i, s] of FIVE.entries()) {
      await w.start(s, `T${i + 1}`);
      stops.set(s, await w.stop(s, { ...stop, at: T0 + i * SECOND }));
      await w.at(T0 + i * SECOND + SECOND);
    }
    const task = await theOneTask(w, FIVE, `${label}, five sessions stopped`);
    for (const s of FIVE) await rowShowsCause(w, s, stop.cause, label);
    expect(await w.continued(), `${label}: nothing resumes before the task's check passes`).toEqual([]);
    const row = await inboxRow(w, task);
    expect(row?.outcome, `${label}: task ${task} waits in your inbox`).toBe('unanswered');

    // Its check passes (after /login, the VPN reconnected, the limit raised): the task closes by itself.
    const passedAt = T0 + 5 * MINUTE;
    w.clock.set(passedAt);
    await w.passed(await provesOf(w, task));
    await w.at(passedAt + RESUME_WITHIN);
    expect((await inboxRow(w, task))?.outcome, `${label}: task ${task} closes when its check passes`).toBe('moot');
    expect((await w.events('ask.moot')).map((e) => e.subject), `${label}: task ${task} is recorded closed on its check`).toContain(task);
    await nothingTyped(w, label);
    const resumed = await w.continued();
    expect(resumed.map((c) => c.session).sort(), `${label}: all five sessions resume within ${RESUME_WITHIN / SECOND} s of the check passing`).toEqual([...FIVE].sort());
    for (const c of resumed) {
      expect(c.because, `${label}: session ${c.session} resumes because its task closed`).toBe('task_closed');
      expect(c.task, `${label}: session ${c.session}'s resume names task ${task}`).toBe(task);
      expect(c.stop, `${label}: session ${c.session} resumes from its stop`).toBe(stops.get(c.session));
    }
    expect(await openTasks(w), `${label}: no task stays open`).toEqual([]);
  });

/** Criterion 2: a dropped connection resumes once by itself; a second drop in the continued turn doesn't; after you type again, the next drop does. */
export const droppedOnce = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('S1', 'T1');
    const first = await w.stop('S1', STOPS.dropped());
    await w.at(T0 + 5 * SECOND);
    let resumed = await w.continued('S1');
    expect(resumed.map((c) => [c.because, c.stop]), `a dropped connection (stop ${first}) resumes once by itself`).toEqual([['transient', first]]);
    expect(await openTasks(w), 'a dropped connection is no task for you').toEqual([]);
    expect(await w.asks.needsYou(), 'a dropped connection never reaches Needs you').toEqual([]);

    const second = await w.stop('S1', { ...STOPS.dropped(), at: T0 + MINUTE });
    await w.at(T0 + MINUTE + 5 * SECOND);
    resumed = await w.continued('S1');
    expect(resumed.map((c) => c.stop), `the continued turn dropped again (stop ${second}): no second automatic continue; it resumes once`).toEqual([first]);
    await rowShowsCause(w, 'S1', 'timed_out', 'stopped again');

    await w.typed('S1', 'try again', T0 + 2 * MINUTE);
    const third = await w.stop('S1', { ...STOPS.dropped(), at: T0 + 3 * MINUTE });
    await w.at(T0 + 3 * MINUTE + 5 * SECOND);
    resumed = await w.continued('S1');
    expect(resumed.map((c) => c.stop), `after you typed, the turn you started dropped (stop ${third}): it gets its one automatic continue`).toEqual([first, third]);
  });

/** Criterion 6: a context overflow compacts once and re-sends the turn; a second overflow of the re-sent turn gets no second one. */
export const overflowOnce = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('S1', 'T1');
    const first = await w.stop('S1', STOPS.overflow());
    await w.at(T0 + 5 * SECOND);
    expect((await w.continued('S1')).map((c) => [c.because, c.stop]), `a context overflow (stop ${first}) compacts once and re-sends the turn`).toEqual([['context_overflow', first]]);
    const second = await w.stop('S1', { ...STOPS.overflow(), at: T0 + MINUTE });
    await w.at(T0 + MINUTE + 5 * SECOND);
    expect((await w.continued('S1')).map((c) => c.stop), `the re-sent turn overflowed again (stop ${second}): it compacts once, not twice`).toEqual([first]);
    await rowShowsCause(w, 'S1', 'context_overflow', 'overflowed again');
    expect(await openTasks(w), 'a context overflow is no task for you').toEqual([]);
  });

/**
 * Criterion 10: a dropped-connection stop that reaches the hub 9 hours after its stamp (deep-hook's spool, after the
 * laptop slept) starts no automatic continue; the same stop arriving 2 minutes after its stamp continues once.
 */
export const lateStop = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('L', 'TL');
    await w.start('M', 'TM');
    const late = await w.stop('L', { ...STOPS.dropped(), at: T0 - 9 * HOUR });
    const fresh = await w.stop('M', { ...STOPS.dropped(), at: T0 - 2 * MINUTE });
    await w.at(T0 + 5 * SECOND);
    expect((await w.continued('L')).map((c) => c.stop), `stop ${late}, 9 hours old by its stamp when it reached the hub, starts no automatic continue`).toEqual([]);
    await rowShowsCause(w, 'L', 'timed_out', '9 hours late');
    expect(await w.asks.needsYou(), 'nothing reaches Needs you for the late stop').toEqual([]);
    expect(await openTasks(w), 'no task opens for the late stop').toEqual([]);
    expect((await w.continued('M')).map((c) => c.stop), `stop ${fresh}, 2 minutes old by its stamp when it reached the hub, continues once`).toEqual([fresh]);
    // Nor later: the window is the stop's age, not the time since the hub saw it.
    await w.at(T0 + CONTINUE_WINDOW + MINUTE);
    expect((await w.continued('L')).map((c) => c.stop), `stop ${late} never continues`).toEqual([]);
    expect((await w.continued('M')).map((c) => c.stop), `stop ${fresh} continues once only`).toEqual([fresh]);
  });

/** Criterion 11: a dropped-connection stop followed within its 10 minutes by a prompt you typed, or by a newer stop of the same session, starts no automatic continue from it. */
export const typedOrNewer = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    for (const s of ['P', 'Q', 'Q2', 'C']) await w.start(s, `T${s}`);
    const p = await w.stop('P', STOPS.dropped());
    await w.typed('P', 'use the staging key instead', T0 + MINUTE);
    const q = await w.stop('Q', STOPS.dropped());
    const qNewer = await w.stop('Q', { ...STOPS.refusal(), at: T0 + MINUTE });
    const q2 = await w.stop('Q2', STOPS.dropped());
    const q2Newer = await w.stop('Q2', { ...STOPS.dropped(), at: T0 + MINUTE });
    const c = await w.stop('C', STOPS.dropped());
    await w.at(T0 + 2 * MINUTE);
    expect((await w.continued('C')).map((c) => c.stop), `the control stop ${c}, with nothing after it, continues once`).toEqual([c]);
    expect((await w.continued('P')).map((c) => c.stop), `stop ${p}, followed by a prompt you typed, starts no automatic continue`).toEqual([]);
    expect((await w.continued('Q')).map((c) => c.stop), `stop ${q}, followed by a newer stop (${qNewer}, a refusal), starts no automatic continue from it`).toEqual([]);
    expect((await w.continued('Q2')).map((c) => c.stop), `stop ${q2}, followed by a newer dropped-connection stop ${q2Newer}, starts none from it; the newest stop continues once`).toEqual([q2Newer]);
  });

/** Criterion 4: a refusal gets no automatic continue, while a dropped connection beside it does; and the cause comes from structure, never from the agent's text. */
export const refusalStop = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('R', 'TR');
    await w.start('D', 'TD');
    await w.start('U', 'TU');
    const refused = await w.stop('R', STOPS.refusal());
    const dropped = await w.stop('D', STOPS.dropped());
    // A turn that ended normally, whose last message only says "usage limit reached": Claude Code's adapter reads its
    // cause from the Stop payload and the transcript, never from that text.
    const mapped = shipped().mapHook({
      v: 1, agent: 'claude', event: 'Stop', seq: String(BigInt(T0) * 1_000_000n), id: '01K8R0Z3X5V7T9R1P3N5M7K9HA', pid: 81234, ppid: 81200, matched: [],
      payload: { session_id: 'U', transcript_path: `${w.dir}/U.jsonl`, cwd: w.dir, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'usage limit reached' },
    }, '2.1.304', []).events.filter((e) => e.kind === 'agent.stop');
    expect(mapped, 'the Stop maps to one agent.stop').toHaveLength(1);
    const said = mapped[0]!.data;
    expect(['plan_window_spent', 'rate_limited'], `an agent that writes "usage limit reached" doesn't make its stop a spent window: its cause is ${JSON.stringify(said.cause)}`).not.toContain(said.cause);
    const textual = await w.stop('U', { cause: said.cause as Cause, outcome: said.outcome === 'failed' ? 'failed' : 'finished', did_work: true, claim: true });

    await w.at(T0 + 5 * SECOND);
    expect((await w.continued('D')).map((c) => c.stop), `the dropped connection beside it (stop ${dropped}) continues once`).toEqual([dropped]);
    expect((await w.continued('R')).map((c) => c.stop), `the refusal (stop ${refused}) gets no automatic continue`).toEqual([]);
    await rowShowsCause(w, 'R', 'refusal', 'refused');
    expect(await tasksFor(w, 'R'), 'a refusal is no task for you').toEqual([]);
    expect(await w.asks.needsYou(), 'a refusal never reaches Needs you').toEqual([]);
    expect((await w.continued('U')).map((c) => c.stop), `the stop that only said "usage limit reached" (${textual}) gets no automatic continue`).toEqual([]);
    expect(await tasksFor(w, 'U'), 'the stop that only said "usage limit reached" raises no task: it is sent back like any other').toEqual([]);
    await rowShowsCause(w, 'U', said.cause as Cause, 'said "usage limit reached"');
  });

/**
 * Criterion 7: after you post a test question in your chat app, the task closes from the thread without you
 * typing; a missing or a wrong bot reply keeps it open, sent back with the thread link.
 */
export const threadTask = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('S1', 'T1');
    const task = await raised(w, core('S1'), chatTask(), 'a step you take in a chat app, with the thread its check reads');
    expect((await w.asks.needsYou()).map((c) => c.ask), `task ${task} waits in Needs you`).toContain(task);
    const missing = async (when: string): Promise<void> => {
      expect((await inboxRow(w, task))?.outcome, `${when}: task ${task} stays open`).toBe('unanswered');
      const card = cardIn(await w.asks.needsYou(), task);
      expect(card, `${when}: task ${task} shows in Needs you`).toBeDefined();
      expect(card!.missing, `${when}: task ${task} is sent back with what's missing`).not.toBeNull();
      expect(card!.missing!.link, `${when}: the send-back carries the thread link`).toBe(THREAD_LINK);
      expect(card!.missing!.reasons.length, `${when}: the send-back says what's missing`).toBeGreaterThan(0);
    };
    await w.at(T0 + MINUTE);
    expect((await inboxRow(w, task))?.outcome, `task ${task} stays open before you post`).toBe('unanswered');
    w.threads.post(THREAD_LINK, YOU, QUESTION);
    await w.at(T0 + 2 * MINUTE);
    await missing('you posted, and the bot has not replied');
    w.threads.post(THREAD_LINK, BOT, 'Oslo: sunny, 20°C');
    await w.at(T0 + 3 * MINUTE);
    await missing('the bot replied wrong');
    w.threads.post(THREAD_LINK, BOT, EXPECTED_REPLY);
    await w.at(T0 + 4 * MINUTE);
    expect((await inboxRow(w, task))?.outcome, `task ${task} closes from the thread once the bot's reply is what it expects`).toBe('moot');
    expect(w.threads.reads, 'the check read the thread through the connector').toContain(THREAD_LINK);
    await nothingTyped(w, 'the thread task');
  });

/** The stops in the adapter's structure the plants key on. */
export const isTransient = (d: Record<string, unknown>): boolean => (d.cause === 'timed_out' || d.cause === 'rate_limited') && d.owner !== 'you';
export const isTask = (d: Record<string, unknown>): boolean => d.owner === 'you' || d.cause === 'plan_window_spent';
export const dataOfEvent = (e: { data: unknown }): Record<string, unknown> => (isObj(e.data) ? e.data : {});
