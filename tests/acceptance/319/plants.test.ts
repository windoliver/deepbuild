// The wrong programs the issue names, planted around the real asks core and record (plants.ts): each
// criterion's scenario must fail on its plant, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { escalatesWithNobody, repoBlockWhole, waitsForNextBatch } from './plants.ts';
import { authorityAtDeadline, choiceFromYourSettings, hubStoppedAcrossBatch } from './scenarios.ts';

test('#319.1ad1ab09 fails on a hub that waits for the next batch after its start, naming the ask', async () => {
  await expect(hubStoppedAcrossBatch(waitsForNextBatch)).rejects.toThrow(/ask ask:[0-9A-Za-z]+, whose deadline comes before the next batch, didn't show in Needs you within 5 s/);
}, 30_000);

test('#319.466f1905 fails on a hub that records the defaulted authority ask as escalated with nobody to take it, naming the ask', async () => {
  await expect(authorityAtDeadline(escalatesWithNobody)).rejects.toThrow(/ask ask:[0-9A-Za-z]+ is recorded as defaulted at its deadline, never as escalated/);
});

test('#319.d452dc28 fails on a hub that takes the repo\'s asks block in place of your settings, naming the choice ask', async () => {
  await expect(choiceFromYourSettings(repoBlockWhole)).rejects.toThrow(/the choice ask/);
});
