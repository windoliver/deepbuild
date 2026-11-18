// The wrong program the Proof names (plants.ts): a core that keeps only the newest 100 stops of a session. AC2's
// scenario must fail on it, naming the task; AC3's, which passes on the merge base by design, must fail on it too,
// naming the step. The real program's runs are AC2's and AC3's own tests.

import { expect, test } from 'vitest';
import { mergeBaseCore } from './helpers.ts';
import { newestHundred } from './plants.ts';
import { COVERED, judged, readings, STOPS } from './scenarios.ts';

test('AC2 #2653.7105a3cb fails on a core that keeps only the newest 100 stops of a session, naming the task', async () => {
  await expect(judged(await newestHundred())).rejects.toThrow(new RegExp(`task ask:[0-9A-Z]{26}, which covers stop ${COVERED} of S1 .*, is judged ${STOPS - COVERED} stops later: it closes at the reset that stop carries`));
}, 2_400_000);

test('AC3 #2653.d3fb687c fails on a core that keeps only the newest 100 stops of a session, naming the step', async () => {
  await expect(readings(await mergeBaseCore(), await newestHundred())).rejects.toThrow(/at step \d+ \(A's stop \d+ \(timed_out, failed\) at [0-9T:.Z-]+\), a core that keeps only the newest 100 stops of a session reads what the merge base's doesn't/);
}, 1_800_000);
