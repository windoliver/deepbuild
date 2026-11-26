// #3262.55d4e80f, the harness's 4-session run (ac1.mjs holds the test's body; a run a file, so each has a file's
// whole time).
// Run: DEEP_3262_BASE=<built merge base> node --test tests/acceptance/3262/ac1-sessions-4.test.mjs
import test from 'node:test';
import { growth } from './ac1.mjs';

test('AC1 #3262.55d4e80f with #3222\'s harness, in its 4-session run, the median service of the last 20 calls is at most 1.25 times the first 20\'s, and the harness\'s output on the merge base is kept beside it', { timeout: 30 * 60_000 }, (t) => growth(4, t));
