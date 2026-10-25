// Criterion 3: a task without its steps, where to take them, what it unblocks and the check that proves it
// fails its schema, and the asks core refuses to raise it.

import { expect, test } from 'vitest';
import { core, inWorld, refusal } from './helpers.ts';
import { lackingTasks, taskSchemaName, taskSchemaRefuses } from './scenarios.ts';

test('#320.424a72ad a task that lacks its steps, where to take them, what it unblocks or the check that proves it, left out or empty, fails its schema at that part', async () => {
  await taskSchemaRefuses();
});

test('#320.424a72ad the asks core refuses to raise a task that lacks any of the four, naming the part, and records nothing', async () => {
  await inWorld(undefined, async (w) => {
    await taskSchemaName(w);
    await w.start('S1', 'T1');
    for (const { part, how, data } of lackingTasks()) {
      const before = (await w.events('ask.created')).length;
      const refused = await refusal(w, core('S1'), data);
      expect(refused?.field, `a task whose ${part} is ${how} is refused at raise, naming /data/${part}`).toBe(`/data/${part}`);
      expect((await w.events('ask.created')).length, `a task whose ${part} is ${how} is never recorded`).toBe(before);
    }
  });
});
