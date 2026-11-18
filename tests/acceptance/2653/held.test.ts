// AC1: one session that makes 50,000 stops and never ends, with one open ask-task covering its tenth: the core holds
// under 1,000 stops for it (drafted), counted by the test, and every ask, task and outcome equals the merge base's at
// each step. On the merge base it holds 50,000, and the test fails, naming the count.

import { expect, test } from 'vitest';
import { Count2653, HERE, makeClock, mergeBaseCore, openWorld, stateOf, stopId, stopsHeld } from './helpers.ts';
import { BOUND, COVERED, oneSession, S1, stopAt, STOPS } from './scenarios.ts';

test("AC1 #2653.8086bb1d one session that makes 50,000 stops and never ends, with one open ask-task covering its tenth: the core holds under 1,000 stops for it, counted by the test, and every ask, task and outcome equals the merge base's at each step", async () => {
  const clock = makeClock();
  const base = await openWorld(await mergeBaseCore(), clock);
  const here = await openWorld(HERE, clock);
  try {
    await oneSession([base, here], STOPS, async (n, input) => {
      const [theirs, ours] = [await stateOf(base), await stateOf(here)];
      if (ours !== theirs) expect(JSON.parse(ours), `at step ${n} (${input.what}), ${HERE.label}'s asks, tasks and outcomes are the merge base's`).toEqual(JSON.parse(theirs));
    });
    const held = await stopsHeld([new Count2653('merge base', base.asks, base.record), new Count2653('here', here.asks, here.record)], S1);
    const ours = held.get('here')!;
    const theirs = held.get('merge base')!;
    // The count finds what any core must still hold: S1's newest stop, and the one its open task covers.
    const unseen = [COVERED, STOPS].filter((n) => !ours.has(stopId(S1, n, stopAt(n)))).map((n) => `stop ${n}`);
    expect(unseen, `BLOCKED unless the count finds S1's newest stop and the one its open task covers in ${HERE.label}`).toEqual([]);
    expect(ours.size, `${HERE.label} holds ${ours.size} of the ${STOPS} stops S1 made (the merge base's holds ${theirs.size})`).toBeLessThan(BOUND);
  } finally {
    await base.close();
    await here.close();
  }
}, 2_400_000);
