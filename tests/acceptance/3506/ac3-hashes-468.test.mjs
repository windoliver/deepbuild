// #3506.55c33ada, the frames of tests/acceptance/468/ (ac3.mjs holds the test's body; a suite a file, since a suite
// runs whole and each of its frames is drawn twice).
// Run: DEEP_3506_BASE=<built merge base> node --test tests/acceptance/3506/ac3-hashes-468.test.mjs
import test from 'node:test';
import { sameFrames } from './ac3.mjs';
import { AC } from './judge.mjs';

test(`AC3 ${AC[3]} on Metal, every frame of tests/acceptance/468/ hashes the same as on the merge base`, { timeout: 9 * 3_600_000 }, (t) => sameFrames('468', t));
