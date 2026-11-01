// Criterion 14: continues are counted per session since its last turn that ended normally.

import { test } from 'vitest';
import { countedSinceNormalEnd } from './scenarios.ts';

test('#85.281df797 two transient stops in a row with no normal turn end between them: the first gets the one continue, the second none; after a turn that ends normally the next transient stop gets one again', async () => {
  await countedSinceNormalEnd();
}, 30_000);
