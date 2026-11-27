import { afterAll, describe, it } from 'vitest';
import { cleanup } from '../25/routes/helpers.ts';
import { MINUTE, judgeRoute } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#3243.53a4911b #25 AC1 and AC4 pass on main', () => {
  it('#3243.53a4911b #25 AC4 #25.1eae4ef9: the one-route check passes, and fails on both-routes', async (ctx) => {
    await judgeRoute(ctx, { criterion: '#25.1eae4ef9', named: 'tests/acceptance/25/routes/one-route.test.ts', wrong: 'both-routes' }, 17 * MINUTE);
  }, 19 * MINUTE);
});
