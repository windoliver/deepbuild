// Criteria 2, 6 and 11: a dropped connection resumes once by itself; a context overflow compacts once and re-sends
// the turn; a stop followed by a prompt you typed or by a newer stop starts no automatic continue from it. And the
// Scope's Codex line: a turn that ends in an error runs no Stop hook there, so it gets none.

import { expect, test } from 'vitest';
import { inWorld, openTasks, SECOND, STOPS, T0 } from './helpers.ts';
import { droppedOnce, overflowOnce, rowShowsCause, typedOrNewer } from './scenarios.ts';

test('#85.0840911e a dropped connection resumes once by itself: the continued turn dropping again gets no second continue, and the next turn you start gets one again', async () => {
  await droppedOnce();
}, 30_000);

test('#85.9732774d a context overflow compacts once and re-sends the turn; the re-sent turn overflowing again gets no second one', async () => {
  await overflowOnce();
}, 30_000);

test('#85.348d7b85 a dropped-connection stop followed within its 10 minutes by a prompt you typed, or by a newer stop of the same session, starts no automatic continue from it', async () => {
  await typedOrNewer();
}, 30_000);

test('(Scope) a Codex turn that ends in an error runs no Stop hook, so a Codex dropped connection gets no automatic continue; the session stays stopped with its cause on its row', async () => {
  await inWorld(undefined, async (w) => {
    await w.start('X', 'TX', 'codex');
    await w.start('C', 'TC');
    const codex = await w.stop('X', STOPS.dropped());
    const claude = await w.stop('C', STOPS.dropped());
    await w.at(T0 + 5 * SECOND);
    expect((await w.continued('C')).map((c) => c.stop), `the Claude Code session's dropped connection (stop ${claude}) continues once`).toEqual([claude]);
    expect((await w.continued('X')).map((c) => c.stop), `the Codex session's dropped connection (stop ${codex}) gets no automatic continue`).toEqual([]);
    await rowShowsCause(w, 'X', 'timed_out', 'Codex');
    expect(await openTasks(w), 'neither is a task for you').toEqual([]);
  });
}, 30_000);
