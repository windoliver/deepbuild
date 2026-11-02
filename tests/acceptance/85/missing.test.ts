// Criterion 3: a task whose check still fails stays open with what's missing.

import { expect, test } from 'vitest';
import { cardIn, inboxRow, inWorld, MINUTE, nothingTyped, provesOf, SECOND, STOPS, T0, theOneTask } from './helpers.ts';

test("#85.eb30d189 a task whose check still fails stays open in your inbox and Needs you with what's missing, and closes once the check passes", async () => {
  await inWorld(undefined, async (w) => {
    await w.start('S1', 'T1');
    const stop = await w.stop('S1', STOPS.signIn());
    await w.at(T0 + SECOND);
    const task = await theOneTask(w, ['S1'], 'a revoked sign-in');
    const check = await provesOf(w, task);

    // You ran /login against the wrong account: the check runs and still fails.
    const reasons = ['gh auth status: not logged in to github.com as the release account'];
    w.clock.set(T0 + MINUTE);
    await w.failed(check, reasons);
    await w.at(T0 + MINUTE + 30 * SECOND);
    expect((await inboxRow(w, task))?.outcome, `task ${task} stays open while its check fails`).toBe('unanswered');
    const card = cardIn(await w.asks.needsYou(), task);
    expect(card, `task ${task} stays in Needs you`).toBeDefined();
    expect(card!.missing, `task ${task} shows what's still missing`).toMatchObject({ check, reasons });
    expect(card!.missing?.link, `task ${task} is no chat-app step, so its send-back carries no thread link`).toBeNull();
    expect((await w.continued('S1')).map((c) => c.stop), `session S1 doesn't resume on a failing check (stop ${stop})`).toEqual([]);

    // Then it passes.
    w.clock.set(T0 + 2 * MINUTE);
    await w.passed(check);
    await w.at(T0 + 2 * MINUTE + 30 * SECOND);
    expect((await inboxRow(w, task))?.outcome, `task ${task} closes once its check passes`).toBe('moot');
    expect((await w.continued('S1')).map((c) => [c.because, c.task]), 'session S1 resumes').toEqual([['task_closed', task]]);
    await nothingTyped(w, 'a task whose check failed first');
  });
}, 30_000);
