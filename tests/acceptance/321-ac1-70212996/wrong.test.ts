import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, deepHook, failureOf } from './helpers.ts';
import { LET_THROUGH, PUSH, scenario } from './scenario.ts';

afterEach(cleanup);

describe('#321.70212996 a "proceed" never covers a call that needs authority: the wrong program', () => {
  test('#321.70212996 a core that lets a "proceed" cover the calls of the turn it starts lets the push through and fails this test, naming the call', async () => {
    await deepHook();
    const failure = await failureOf(() => scenario({ plant: 'proceed-covers-turn' }));
    expect(failure, 'the scenario must fail against the planted core').not.toBeNull();
    expect(failure, `the scenario must fail because the push was let through, naming the call \`${PUSH}\``).toContain(LET_THROUGH);
  }, 600_000);
});
