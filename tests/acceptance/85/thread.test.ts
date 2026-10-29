// Criterion 7: after you post a test question in your chat app, the task closes from the thread without you typing,
// and a missing or wrong bot reply sends the claim back with the thread link.

import { test } from 'vitest';
import { threadTask } from './scenarios.ts';

test('#85.e12ca936 after you post the test question, the task closes from the thread, read through the read-only connector, without you typing; while the bot has not replied, or replied wrong, it stays open, sent back with the thread link', async () => {
  await threadTask();
}, 30_000);
