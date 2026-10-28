// The stop and answer rule (#303), on recorded turns: a stop right after startup, a resume or /clear, and an answer
// to a question you typed that opened no task, with reads only, are no claim; the same question's turn with one
// edit is a claim.

import { afterEach, test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { stopRule } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#303.fd687f1e the stop rule reads a stop after startup, after a resume, after /clear and an answer with two reads as no claim, and the same question\'s turn with one edit as a claim', async () => {
  world = await openWorld();
  await stopRule(world);
});
