// #3243.53a4911b #25 AC1 and AC4 pass on main: the AC1 half, #25's held-stop check.
//
// #25 AC1 (#25.0215da31) is decided by tests/acceptance/25/routes/held.test.ts, unchanged, or, once that file is run by
// hand, by the tests of the blind redraft tests/acceptance/25-redraft-3243/ that carry #25.0215da31 (helpers.ts). They
// run in a child Vitest and each must pass. The wrong program `answer-skips-held-stop` is proved by the named file's
// passing `(wrong program)` test, or by the redraft's twins.json naming a product-source twin of that name.
// At the base the held stop isn't held for the provisional ask the file raises, so its tests
// fail and so does this one (BASE-RESULTS.txt).
import { afterAll, describe, it } from 'vitest';
import { cleanup } from '../25/routes/helpers.ts';
import { MINUTE, judgeRoute } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#3243.53a4911b #25 AC1 and AC4 pass on main', () => {
  it('#3243.53a4911b #25 AC1 #25.0215da31: the held-stop check passes, and fails on answer-skips-held-stop', async (ctx) => {
    await judgeRoute(ctx, { criterion: '#25.0215da31', named: 'tests/acceptance/25/routes/held.test.ts', wrong: 'answer-skips-held-stop' }, 17 * MINUTE);
  }, 19 * MINUTE);
});
