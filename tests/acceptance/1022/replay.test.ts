// AC3: replayed from the recorded hook payloads of that run, an adapter that records two PreCompact readings or a
// user.ask for the command fails the test, naming the duplicate (README).
import { afterAll, expect, test } from 'vitest';
import { AC3, cleanup, duplicates, recorded, replay, settled, world } from './helpers.ts';

afterAll(cleanup);

test(`${AC3} the recorded /compact run, replayed hook by hook, holds the compaction once: no second PreCompact reading and no user.ask for the command`, async () => {
  const w = await world();
  const run = recorded(w);
  await replay(w, run);
  const problems = duplicates(await settled(w, run.session), ['say hi']);
  expect(problems, problems.join('\n')).toEqual([]);
}, 600_000);
