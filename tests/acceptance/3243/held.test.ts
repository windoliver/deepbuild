import { afterAll, describe, it } from 'vitest';
import { cleanup } from '../25/routes/helpers.ts';
import { MINUTE, judgeRoute } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#3243.53a4911b #25 AC1 and AC4 pass on main', () => {
  it('#3243.53a4911b #25 AC1 #25.0215da31: the held-stop check passes, and fails on answer-skips-held-stop', async (ctx) => {
    await judgeRoute(ctx, { criterion: '#25.0215da31', named: 'tests/acceptance/25/routes/held.test.ts', wrong: 'answer-skips-held-stop' }, 17 * MINUTE);
  }, 19 * MINUTE);
});
