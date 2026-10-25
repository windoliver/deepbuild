// The wrong programs the Proof names, planted around the real asks core and the real schemas (plants.ts). Each
// test first runs its criterion's scenario on the real program, which must pass, then on the plant, which must
// fail, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { draftsNoRequest, listsEveryAsk, listsMayBeEmpty, showsAsDrafted } from './plants.ts';
import { blockKeptOut, requestRechecked, taskSchemaRefuses } from './scenarios.ts';

test('#320.424a72ad fails on a task schema in which a list may be empty, naming the steps', async () => {
  await taskSchemaRefuses();
  await expect(taskSchemaRefuses(listsMayBeEmpty)).rejects.toThrow(/a task whose steps is empty \(\[\]\) fails ask\.created@\d+, at \/data\/steps/);
}, 30_000);

test('#320.dbf54286 fails on a hub whose inbox lists every ask, whoever owns it, naming the block', async () => {
  await blockKeptOut();
  await expect(blockKeptOut(listsEveryAsk)).rejects.toThrow(/block ask:[0-9A-Za-z]+, owned by someone else, never reaches your inbox/);
}, 30_000);

test('#320.dbf54286 fails on a hub that keeps the block away from you but drafts no request, naming the block', async () => {
  await blockKeptOut();
  await expect(blockKeptOut(draftsNoRequest)).rejects.toThrow(/the drafted request for block ask:[0-9A-Za-z]+ reaches your inbox/);
}, 30_000);

test('#320.ce2e38fe fails on a hub that shows a drafted request as it stood when drafted, never re-checked, naming the block', async () => {
  await requestRechecked();
  await expect(requestRechecked(showsAsDrafted)).rejects.toThrow(/the drafted request for block ask:[0-9A-Za-z]+, whose item changed after it was drafted, says so when it's shown/);
}, 30_000);
