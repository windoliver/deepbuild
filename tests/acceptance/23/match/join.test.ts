// #23.6d3abd93 two sessions that raise the same taste question on the same screen show one card and your answer
// reaches both; the same question pinned to two different commits shows as two cards; an ask already open when
// you saved an answer matching it by kind and scope closes as decided for you.

import { test } from 'vitest';
import { inWorld } from './helpers.ts';
import { sameScreen } from './scenarios.ts';

test('#23.6d3abd93 the same taste question on one screen from two sessions is one card and your answer reaches both; pinned to two commits it is two cards, and the one still open closes as decided for you once you answer the other', async () => {
  await inWorld(sameScreen);
});
