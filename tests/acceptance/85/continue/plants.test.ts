// The wrong program criterion 14 names, planted around the real asks core: a rule keyed per stop, which continues
// every transient stop that is the session's newest, under 10 minutes old and not followed by a prompt you typed, with
// no count since the last normal end (tests/acceptance/85/plants.ts's `continuesTwice`, the real core with the once
// guard dropped). The scenario first runs on the real program, which must pass, then on the plant, which must fail
// naming the second stop.

import { expect, test } from 'vitest';
import { continuesTwice as keyedPerStop } from '../plants.ts';
import { countedSinceNormalEnd } from './scenarios.ts';

test('#85.281df797 fails on a rule keyed per stop, which continues the second transient stop, naming it', async () => {
  await countedSinceNormalEnd();
  await expect(countedSinceNormalEnd(keyedPerStop)).rejects.toThrow(/the second transient stop \([0-9A-Z]+\), right after a continue with no normal turn end between them, gets none/);
}, 60_000);
