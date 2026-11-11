// AC2: reduce motion on and off with twenty working sessions (README, The fixture: `motionRun`). Headless: the real
// `deep-drive` launched with `reduced_motion` (#1427), on a copy of a real hub's record, the hooks real.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, ID, MIN, motionRun } from './helpers.ts';

afterAll(cleanup);

describe(`AC2 ${ID.motion} Reduce motion on: no mark moves for 10 s while each row's last-event time updates; off: marks move only on events`, () => {
  it('AC2 twenty working sessions, an event each in 10 s: with reduce motion on every mark holds and each row says when its event came; off, each mark moves at its own event only', async () => {
    const failures = [...(await motionRun(true)), ...(await motionRun(false))];
    expect(failures).toEqual([]);
  }, 240 * MIN);
});
