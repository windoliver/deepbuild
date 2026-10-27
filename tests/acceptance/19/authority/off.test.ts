// AC1 #19.a897085d `deep off` makes the next hook reply watch-only within a second.
//
// Run by you (a child of this test, no agent above it) with the OS confirmation stubbed `confirmed`. "Watch-only" is
// read off the hook replies setup's entries get (README: Gated and watch-only): your own block entry in rules.json is
// no longer denied, the hub acknowledging the call, and the stop of a session with an open ask is acknowledged with
// `hold_until_ms: null`. Both are gated before `deep off`, or the test is BLOCKED.

import { afterAll, it } from 'vitest';
import { cleanup } from './helpers.ts';
import { offWithinASecond } from './scenarios.ts';

afterAll(cleanup, 60_000);

it('AC1 #19.a897085d `deep off` makes the next hook reply watch-only within a second: your gate\'s block is let through by a hook started within 1 s of deep off exiting, and the next stop of a session with an open ask is not held', async () => {
  await offWithinASecond();
}, 600_000);
