// The two wrong programs the issue's Proof names, planted in the hub (DEEP_HUB_PLANT, README: Wrong programs). Each
// runs its criterion's own scenario against the planted hub, which must fail naming the criterion (and, for a
// deadline, the ask). A plant the hub doesn't know makes it refuse to start, so the scenario fails BLOCKED, naming
// neither: these tests fail then too.

import { afterEach, expect, test } from 'vitest';
import { AC, cleanup } from './helpers.ts';
import { authorityAnswers, defaultsAtDeadlines, foldedPastDeadline } from './scenarios.ts';

afterEach(cleanup, 30_000);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test(`${AC[3]} fails on an inbox that counts an answer from a process inside the asking session's process tree (answer-inside-session), naming the criterion`, async () => {
  await expect(authorityAnswers('answer-inside-session')).rejects.toThrow(new RegExp(`${esc(AC[3])}: ask ask:[0-9A-Za-z]+ \\(answered by deep inbox answer run inside session \\S+'s process tree`));
}, 240_000);

test(`${AC[4]} fails on a hub that skips the default at the deadline (skip-default-at-deadline), naming the criterion and the ask`, async () => {
  await expect(defaultsAtDeadlines('skip-default-at-deadline')).rejects.toThrow(new RegExp(`${esc(AC[4])}: ask ask:[0-9A-Za-z]+ \\(the choice ask\\) is still open \\d+ s past its deadline`));
}, 360_000);

test(`${AC[5]} fails on a hub that skips the default at the deadline (skip-default-at-deadline), naming the criterion and the ask`, async () => {
  await expect(foldedPastDeadline('skip-default-at-deadline')).rejects.toThrow(new RegExp(`${esc(AC[5])}: ask ask:[0-9A-Za-z]+ \\(the sixth ask, folded into the exception\\) is still open \\d+ s past its deadline`));
}, 360_000);
