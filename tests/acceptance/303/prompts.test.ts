// Prompts and their origins (#303): each prompt's user.ask with its from; a task only for a person's prompt that
// asks for new or changed behavior, whether the session's first, a later one or a message typed mid-turn; a
// rename opens none; a /loop iteration, a subagent's report and another session's message open nothing.

import { afterEach, expect, test } from 'vitest';
import { AUTOMATIC, CHANGE, isObj, OPENS, openWorld, RENAME, since, type World } from './helpers.ts';
import { firstPrompts, midTurn } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#303.1bdbea79 a first prompt that only asks a question opens no task, recording tasks: []; one that asks for a change opens one task', async () => {
  world = await openWorld();
  await firstPrompts(world);
});

test('#303.0ca34012 typed while the agent works, a question opens no task and a change opens one within one hook', async () => {
  world = await openWorld();
  await midTurn(world);
});

test('#303.c7678fa6 a message typed mid-turn that asks for new behavior becomes a task within one hook', async () => {
  const w = (world = await openWorld());
  await w.start('S1', 'T1');
  const first = await w.prompt('S1', CHANGE);
  expect(first.task, `${first.handle}: the turn's prompt opens a task`).toBe(first.handle);
  await w.call('S1', 'read', 'src/auth/middleware.ts');
  const before = await w.tail();
  // The hook: one UserPromptSubmit for the queued message. Nothing else runs between it and the reading below.
  const typed = await w.prompt('S1', 'also add a test for expired tokens');
  const added = since(await w.events(), before);
  expect(typed.task, `${typed.handle}: the message becomes a task`).toBe(typed.handle);
  const created = added.filter((e) => e.kind === 'task.created' && isObj(e.data) && e.data.task_ref === typed.handle);
  expect(created, `${typed.handle}: its task.created is in the record when the hook's call returns`).toHaveLength(1);
  expect(created[0]!.data, `${typed.handle}: the task sits under the session's thread`).toMatchObject({ task_ref: typed.handle, thread: 'T1' });
  const ask = added.find((e) => e.kind === 'user.ask');
  expect(ask, `${typed.handle}: the hook recorded the message`).toBeDefined();
  expect(ask!.log_pos, `${typed.handle}: the task follows its message in the log`).toBeLessThan(created[0]!.log_pos);
  const row = (await w.table('tasks')).find((r) => r.task_ref === typed.handle);
  expect(row, `${typed.handle}: the tasks table holds it under the thread`).toMatchObject({ task_ref: typed.handle, thread: 'T1' });
});

test('#303.64edb131 a rename-only prompt opens no task', async () => {
  const w = (world = await openWorld());
  await w.start('S1', 'T1');
  // As the session's first prompt, and as a later one after a change the session worked on.
  const first = await w.prompt('S1', RENAME);
  expect(first.task, `${first.handle}: a rename-only first prompt opens no task`).toBeNull();
  await w.stop('S1');
  const change = await w.prompt('S1', CHANGE);
  expect(change.task, `${change.handle}: the change opens a task`).toBe(change.handle);
  await w.call('S1', 'edit', 'src/auth/middleware.ts');
  await w.stop('S1');
  const before = await w.tail();
  const later = await w.prompt('S1', RENAME);
  expect(later.task, `${later.handle}: a rename-only later prompt opens no task`).toBeNull();
  const asks = (await w.events('user.ask')).filter((e) => isObj(e.data) && e.data.text === RENAME);
  expect(asks, 'both rename prompts are recorded').toHaveLength(2);
  for (const ask of asks) expect(ask.data, `${ask.id}: its user.ask records tasks: []`).toMatchObject({ from: 'person', tasks: [] });
  expect(since(await w.events(), before).filter((e) => OPENS(e.kind)), `${later.handle}: nothing opened`).toEqual([]);
  const rows = (await w.table('tasks')).map((r) => r.task_ref);
  expect(rows, 'only the change has a task').toEqual([change.handle]);
});

test('#303.f3b51cf5 a /loop iteration, a subagent\'s report and another session\'s message each fire the prompt hook, open nothing, and are recorded with their from', async () => {
  const w = (world = await openWorld());
  await w.start('S1', 'T1');
  for (const { from, text } of AUTOMATIC) {
    const before = await w.tail();
    const prompted = await w.prompt('S1', text, from);
    expect(prompted.task, `${prompted.handle} (${from}): opens no task`).toBeNull();
    const added = since(await w.events(), before);
    const asks = added.filter((e) => e.kind === 'user.ask');
    expect(asks, `${prompted.handle} (${from}): the prompt is recorded once`).toHaveLength(1);
    expect(asks[0]!.data, `${prompted.handle} (${from}): recorded with its from and no task`).toMatchObject({ from, text, tasks: [] });
    expect(added.filter((e) => OPENS(e.kind)).map((e) => e.kind), `${prompted.handle} (${from}): opens no ask, task or drafting job`).toEqual([]);
  }
  expect(await w.table('tasks'), 'no task was opened').toEqual([]);
  expect((await w.events('user.ask')).map((e) => (e.data as { from: string }).from), 'each prompt keeps its origin').toEqual(AUTOMATIC.map((a) => a.from));
});
