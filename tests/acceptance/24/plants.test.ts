// The wrong programs criteria 4 and 5 name, planted in the hub (DEEP_HUB_PLANT, README: Wrong programs): each
// criterion's scenario must fail on its plant, naming the ask that counted. A plant the hub doesn't know makes
// the hub refuse to start, so the scenario fails BLOCKED, never naming an ask: the test fails then too.

import { afterEach, expect, test } from 'vitest';
import { cleanup } from './helpers.ts';
import { authorityTypedAndWritten, eachKindWrittenWithTheToken } from './scenarios.ts';

afterEach(cleanup, 30_000);

const NAMES_THE_ASK = /ask ask:[0-9A-Za-z]+ \(.*\) counted with the OS confirmation cancelled/;

test('#24.71112e3b fails on a hub that counts a CLI answer on the peer check, naming the ask', async () => {
  await expect(authorityTypedAndWritten('answer-on-peer-check')).rejects.toThrow(NAMES_THE_ASK);
}, 180_000);

test('#24.71112e3b fails on a hub that counts a CLI answer on the control token alone, naming the ask', async () => {
  await expect(authorityTypedAndWritten('answer-on-token')).rejects.toThrow(NAMES_THE_ASK);
}, 180_000);

test('#24.b58ac6a6 fails on a hub that saves an answer on the control token alone, naming the ask', async () => {
  await expect(eachKindWrittenWithTheToken('answer-on-token')).rejects.toThrow(NAMES_THE_ASK);
}, 180_000);
