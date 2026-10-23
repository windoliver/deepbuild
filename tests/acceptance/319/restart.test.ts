// #319.1ad1ab09: the hub stopped across a batch time. The batches and deadlines move on the virtual clock;
// the 5 s from the hub's start is real elapsed time.

import { test } from 'vitest';
import { hubStoppedAcrossBatch } from './scenarios.ts';

test('#319.1ad1ab09 with the hub stopped across a batch time, each open ask whose deadline comes before the next batch shows in Needs you within 5 s of the hub\'s start', async () => {
  await hubStoppedAcrossBatch();
}, 30_000);
