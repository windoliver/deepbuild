// AC2: the stop the open ask-task covers is still read when the task is judged, 49,990 stops later. Its plant, a core
// that keeps only the newest 100 stops, is in plants.test.ts.

import { test } from 'vitest';
import { HERE } from './helpers.ts';
import { judged } from './scenarios.ts';

test('AC2 #2653.7105a3cb the stop the open ask-task covers is still read when the task is judged, 49,990 stops later: the task closes at the reset that stop carries', async () => {
  await judged(HERE);
}, 2_400_000);
