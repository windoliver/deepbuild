// Criterion 4: a refusal stop gets no automatic continue, and a stop whose last message only says "usage limit
// reached" is sent back like any other: its cause comes from structure, never from the agent's text.

import { test } from 'vitest';
import { refusalStop } from './scenarios.ts';

test('#85.65bcfca8 a refusal stop gets no automatic continue while a dropped connection beside it does, and a stop whose last message only says "usage limit reached" raises no task and gets no continue: its cause is read from structure, so it is sent back like any other', async () => {
  await refusalStop();
}, 30_000);
