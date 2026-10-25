// Criterion 4: a drafted request for someone else is re-checked against its source before it's shown, and one
// whose item has changed says so.

import { test } from 'vitest';
import { requestRechecked } from './scenarios.ts';

test('#320.ce2e38fe a drafted request is re-checked against its source each time it shows: one whose item changed says what changed, one unchanged says nothing', async () => {
  await requestRechecked();
}, 30_000);
