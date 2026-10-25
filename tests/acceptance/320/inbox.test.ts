// Criterion 1: a block owned by someone else never reaches your inbox; its drafted request does.

import { test } from 'vitest';
import { blockKeptOut } from './scenarios.ts';

test('#320.dbf54286 a block owned by someone else never reaches your inbox or Needs you; its drafted request, for that owner, does', async () => {
  await blockKeptOut();
}, 30_000);
