// #3507.f3ae7c70, the frames of tests/acceptance/428/ (ac4.mjs holds the test's body; a suite a file, since a suite
// runs whole and each of its frames is drawn twice).
// Run: DEEP_3507_BASE=<built merge base> node --test tests/acceptance/3507/ac4-hashes-428.test.mjs
import test from 'node:test';
import { sameFrames } from './ac4.mjs';

test('AC4 #3507.f3ae7c70 on Metal, every frame of tests/acceptance/428/ hashes the same as on the merge base', { timeout: 9 * 3_600_000 }, (t) => sameFrames('428', t));
