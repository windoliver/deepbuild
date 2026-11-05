// The wrong program criterion 2 names, planted in the hub (DEEP_HUB_PLANT, README: Wrong programs): a hub that accepts
// any signature by the stored key, whatever it covers, must fail the scenario naming the ask that counted. A plant the
// hub doesn't know makes it refuse to start, so the scenario fails BLOCKED, never naming an ask: the test fails then too.

import { afterEach, expect, test } from 'vitest';
import { cleanup } from './helpers.ts';
import { replayedSignatures } from './scenarios.ts';

afterEach(cleanup, 60_000);

test('#880.64e218e8 fails on a hub that accepts any signature by the stored key, whatever it covers, naming the ask', async () => {
  await expect(replayedSignatures('signature-covers-anything')).rejects.toThrow(/ask ask:[0-9A-Za-z]+ \(answered with the valid signature captured for the earlier ask ask:[0-9A-Za-z]+\) counted/);
}, 600_000);
