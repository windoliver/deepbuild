// Criterion 5: sessions stopped by a plan-window limit share one task whose check is the reset time, and resume
// within 60 s of it.

import { expect, test } from 'vitest';
import { HOUR, inboxRow, inWorld, MINUTE, nothingTyped, openTasks, SECOND, STOPS, T0, theOneTask } from './helpers.ts';
import { FIVE, rowShowsCause } from './scenarios.ts';

test('#85.6ba34710 five sessions stopped by a plan-window limit share one task whose check is the reset time: it waits for the reset, with no continue before it, and all five resume within 60 s of it, with no verdict and nothing typed', async () => {
  await inWorld(undefined, async (w) => {
    const resets = T0 + 2 * HOUR;
    const stops = new Map<string, string>();
    for (const [i, s] of FIVE.entries()) {
      await w.start(s, `T${i + 1}`);
      stops.set(s, await w.stop(s, { ...STOPS.planWindow(resets), at: T0 + i * SECOND }));
    }
    await w.at(T0 + 5 * SECOND);
    const task = await theOneTask(w, FIVE, 'a plan window spent');
    for (const s of FIVE) await rowShowsCause(w, s, 'plan_window_spent', 'a plan window spent');

    // The window's task waits for its reset: an hour on, nothing has moved.
    await w.at(T0 + HOUR);
    expect((await inboxRow(w, task))?.outcome, `task ${task} waits for the reset`).toBe('unanswered');
    expect(await w.continued(), 'no session resumes before the reset').toEqual([]);
    await w.at(resets - SECOND);
    expect(await w.continued(), 'no session resumes a second before the reset').toEqual([]);
    expect((await inboxRow(w, task))?.outcome, `task ${task} is still open a second before the reset`).toBe('unanswered');

    await w.at(resets + MINUTE);
    expect((await inboxRow(w, task))?.outcome, `task ${task} closes at the reset: its check is the reset time`).toBe('moot');
    expect(await w.events('verdict.made'), 'no check ran: the reset time alone closed it').toEqual([]);
    const resumed = await w.continued();
    expect(resumed.map((c) => c.session).sort(), 'all five sessions resume within 60 s of the reset').toEqual([...FIVE].sort());
    for (const c of resumed) expect([c.because, c.task, c.stop], `session ${c.session} resumes from its stop because the task closed`).toEqual(['task_closed', task, stops.get(c.session)]);
    expect(await openTasks(w), 'no task stays open').toEqual([]);
    await nothingTyped(w, 'a plan window spent');
  });
}, 30_000);
