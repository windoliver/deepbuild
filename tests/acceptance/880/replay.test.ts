// #880.64e218e8: a helper that returns a valid signature captured for an earlier ask, or for the same ask at an older
// revision, is refused, naming the ask (README: The contract per criterion, 2).

import { afterEach, test } from 'vitest';
import { cleanup } from './helpers.ts';
import { replayedSignatures } from './scenarios.ts';

afterEach(cleanup, 60_000);

test('#880.64e218e8 valid signatures captured for an earlier ask, for the same ask over an earlier nonce, and at an older revision are refused naming the ask; a fresh one counts', async () => {
  await replayedSignatures();
}, 600_000);
