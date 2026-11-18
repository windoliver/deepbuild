// The scenarios the criteria name, shared by their tests and plants.test.ts. Every world runs on the virtual clock,
// on its own record, and closes at the end.

import { expect } from 'vitest';
import {
  continues, CRASHED, DROPPED, FINISHED, HOUR, inboxRow, iso, land, makeClock, MINUTE, openTasks, openWorld, OVERFLOW, prompt, passed, SECOND, session,
  SIGNED_OUT, start, stateOf, stop, stopId, T0, tool, WINDOW, type Core, type Input, type Session, type StopShape, type World,
} from './helpers.ts';

/** The issue's session: it makes 50,000 stops and never ends. */
export const STOPS = 50_000;
/** Its tenth stop is the one the open ask-task covers. */
export const COVERED = 10;
/** The drafted bound: the core holds under 1,000 stops for the session. */
export const BOUND = 1_000;
export const S1 = session('S1', 1);
/** The nth stop of S1 lands at T0 plus n seconds: the 50,000th about 13.9 hours on. */
export const stopAt = (n: number): number => T0 + n * SECOND;
/** When the window S1's tenth stop spent resets: after its last stop, so the task stays open through every one. */
export const RESETS = T0 + 16 * HOUR;
/** A step's time and what it reads, for the failure that names it. */
export type Each = (n: number, input: Input) => Promise<void>;

/**
 * AC1's session, in every world in lockstep: S1 starts, then makes `count` stops a second apart and never ends. Its
 * tenth is a spent plan window resetting at RESETS, whose one task covers it; every other is a turn that ended
 * normally. Each stop lands and each core ticks, as the hub ticks the asks core when a stop lands; `each` runs after
 * every step (step 0 is the start). Returns each world's task.
 */
export async function oneSession(worlds: World[], count = STOPS, each?: Each): Promise<string[]> {
  const first = start(S1, T0);
  await land(worlds, first, T0);
  await each?.(0, first);
  let tasks: string[] = [];
  for (let n = 1; n <= count; n++) {
    const input = stop(S1, n, stopAt(n), n === COVERED ? WINDOW(RESETS) : FINISHED);
    await land(worlds, input, stopAt(n));
    if (n === COVERED) {
      tasks = await Promise.all(worlds.map(async (w) => {
        const open = await openTasks(w);
        expect(open.map((r) => r.ask), `${w.core.label}: S1's tenth stop, a spent plan window, raises one task`).toHaveLength(1);
        return open[0]!.ask;
      }));
    }
    await each?.(n, input);
  }
  return tasks;
}

/**
 * AC2: the task is judged 49,990 stops after the stop it covers. Its check is the reset time that stop carries
 * (#85): a second before it the task is open, and a minute after it the task has closed at that reset. A core that
 * no longer holds the stop has no reset to read, and the task stays open.
 */
export async function judged(core: Core, count = STOPS): Promise<void> {
  const w = await openWorld(core, makeClock());
  try {
    const [task] = await oneSession([w], count);
    const covered = `stop ${COVERED} of S1 (a spent plan window resetting at ${iso(RESETS)})`;
    await land([w], null, RESETS - SECOND);
    expect((await inboxRow(w, task!))?.outcome, `task ${task}, which covers ${covered}, is still open a second before that reset`).toBe('unanswered');
    await land([w], null, RESETS + MINUTE);
    const moot = (await w.events('ask.moot')).filter((e) => e.subject === task).map((e) => e.data);
    expect({ outcome: (await inboxRow(w, task!))?.outcome, moot }, `task ${task}, which covers ${covered}, is judged ${count - COVERED} stops later: it closes at the reset that stop carries`)
      .toEqual({ outcome: 'moot', moot: [{ because: 'window_reset', at: RESETS }] });
  } finally {
    await w.close();
  }
}

// ---- AC3: the two readings that come from a session's earlier stops, where they decide.

/** Stops between the ones whose readings decide: past AC1's drafted bound, so a core that holds fewer has let them go. */
export const GAP = 1_200;
export const A = session('A', 2);
export const B = session('B', 3);
export const C = session('C', 4);
export const D = session('D', 5);
/** One stop that decides, by its session and number, and what the merge base's rules make of it (README: AC3). */
interface Decided { s: Session; n: number; at: number; because: 'transient' | 'context_overflow' | 'task_closed' | null }

/**
 * AC3's sessions, the merge base's core and `core` side by side. A works through the turn kinds #340's and #84's suites
 * drive (a prompt you typed, a goal's continuation, tool calls, a message typed mid-turn, a subagent's stop, turns
 * that end normally or crash), with dropped connections and context overflows whose one automatic continue is counted
 * since the session's last finished stop, the time the first of the two readings gives, and since the stops earlier
 * continues came from; GAP stops lie between each such stop and what it is counted against. D's revoked sign-in (#84's
 * StopFailure) is a task whose sessions resume when its check passes. B and C share one spent plan window's task, which
 * covers a stop of each, resetting two hours apart; GAP stops of each follow, and the task closes at the later reset,
 * the second reading. At every step, every ask, task, continue, reading and delivery equals the merge base's.
 */
export async function readings(merge: Core, core: Core, gap = GAP): Promise<void> {
  const clock = makeClock();
  const base = await openWorld(merge, clock);
  const here = await openWorld(core, clock);
  try {
    let at = T0;
    let step = 0;
    const count = new Map<Session, number>();
    const decided: Decided[] = [];
    const next = async (input: Input | null, when = (at += SECOND)): Promise<void> => {
      at = when;
      await land([base, here], input, at);
      step++;
      const [theirs, ours] = [await stateOf(base), await stateOf(here)];
      if (ours !== theirs) expect(JSON.parse(ours), `at step ${step} (${input?.what ?? `the clock at ${iso(at)}`}), ${core.label} reads what the merge base's doesn't`).toEqual(JSON.parse(theirs));
    };
    const stopOf = async (s: Session, shape: StopShape, because: Decided['because'] | undefined = undefined): Promise<void> => {
      const n = (count.get(s) ?? 0) + 1;
      count.set(s, n);
      await next(stop(s, n, at + SECOND, shape));
      if (because !== undefined) decided.push({ s, n, at, because });
    };
    const many = async (s: Session, shape: StopShape, times: number): Promise<void> => { for (let i = 0; i < times; i++) await stopOf(s, shape); };

    // A: a prompt you typed, a turn that ends normally, then a goal's continuation whose turn drops.
    await next(start(A, at + SECOND));
    await next(prompt(A, at + SECOND, 'person', 'fix the failing tests'));
    await next(tool(A, at + SECOND, 'tool.before'));
    await next(tool(A, at + SECOND, 'tool.after'));
    await stopOf(A, FINISHED);
    await next(prompt(A, at + SECOND, 'continuation', 'continue with the plan'));
    await next(tool(A, at + SECOND, 'tool.before'));
    await stopOf(A, DROPPED, 'transient');
    // The continued turn crashes GAP times and then drops: its one continue was taken, from a stop GAP stops back.
    await next(tool(A, at + SECOND, 'tool.before'));
    await many(A, CRASHED, gap);
    await stopOf(A, DROPPED, null);
    // A turn ends normally, then GAP more: a drop after them is a new turn's, and continues.
    await many(A, FINISHED, gap + 1);
    await stopOf(A, DROPPED, 'transient');
    // The last turn that ended normally is GAP stops back when the next drop lands: counted from it, that drop continues.
    await stopOf(A, FINISHED);
    await many(A, CRASHED, gap);
    await stopOf(A, DROPPED, 'transient');
    await stopOf(A, OVERFLOW, null);
    // A prompt you typed starts the count again; so does a message you type mid-turn. A subagent's stop is no turn end.
    await next(prompt(A, at + SECOND, 'person', 'use the staging key'));
    await next(tool(A, at + SECOND, 'tool.before'));
    await stopOf(A, OVERFLOW, 'context_overflow');
    await next(tool(A, at + SECOND, 'tool.before'));
    await next(prompt(A, at + SECOND, 'person', 'and keep the old fixtures'));
    await stopOf(A, { ...FINISHED, child: 'agent-7f3a' });
    await stopOf(A, DROPPED, 'transient');
    await stopOf(A, FINISHED);

    // D: a revoked sign-in, its task, its check passing, the resumed turn dropping.
    await next(start(D, at + SECOND));
    await next(prompt(D, at + SECOND, 'person', 'deploy the preview'));
    await next(tool(D, at + SECOND, 'tool.before'));
    await stopOf(D, SIGNED_OUT, 'task_closed');
    const [signIn] = await openTasks(base);
    const proves = (await base.events('ask.created')).find((e) => `ask:${e.id}` === signIn?.ask)?.data;
    expect(signIn && typeof proves === 'object' && proves !== null && !Array.isArray(proves) ? proves.proves : undefined, "BLOCKED: on the merge base D's revoked sign-in raises a task that names its check").toBeTypeOf('string');
    const checked = at + 30 * SECOND;
    await next(passed(String((proves as { proves: string }).proves), checked), checked);
    await next(tool(D, at + SECOND, 'tool.before'));
    await stopOf(D, DROPPED, 'transient');

    // B and C: one window spent, resetting at two times; GAP stops of each after their windows' stops.
    await next(start(B, at + SECOND));
    await next(start(C, at + SECOND));
    await next(prompt(B, at + SECOND, 'person', 'run the migration'));
    const early = at + 3 * HOUR;
    const late = at + 5 * HOUR;
    await stopOf(B, WINDOW(early));
    await stopOf(C, WINDOW(late));
    for (let i = 0; i < gap; i++) {
      await stopOf(B, FINISHED);
      await stopOf(C, FINISHED);
    }
    await next(null, early + MINUTE);
    await next(null, late - SECOND);
    await next(null, late + MINUTE);

    // The scenario decides by the two readings: on the merge base each stop above that decides does as its rules say.
    const window = (await base.events('ask.moot')).filter((e) => typeof e.data === 'object' && e.data !== null && !Array.isArray(e.data) && e.data.because === 'window_reset').map((e) => e.data);
    const theirs = (await continues(base)).map((c) => [c.session, c.stop, c.because]);
    const expected = decided.filter((d) => d.because !== null).map((d) => [d.s.id, stopId(d.s, d.n, d.at), d.because]);
    expect({ continues: theirs, window }, 'BLOCKED unless, on the merge base, the stops of this scenario continue, resume and close as the design\'s rules say').toEqual({ continues: expected, window: [{ because: 'window_reset', at: late }] });
  } finally {
    await base.close();
    await here.close();
  }
}
