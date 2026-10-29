// #23.9d16cbb5 a repeated question is answered without reaching the inbox, and #23.6b5caf42 a question of
// another kind or scope reaches the inbox with the nearest decision suggested.

import { test } from 'vitest';
import { inWorld } from './helpers.ts';
import { nearestSuggested, repeated } from './scenarios.ts';

test('#23.9d16cbb5 a question you answered once is answered for you when it is asked again, in another session of the repo and later in the first, without reaching the inbox', async () => {
  await inWorld(async (w) => { await repeated(w); });
});

test('#23.6b5caf42 the same merge question in another repo, and a merge of another kind of change, each reach the inbox with the nearest decision suggested and never applied', async () => {
  await inWorld(nearestSuggested);
});
