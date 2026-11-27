import { afterEach, describe, test } from 'vitest';
import { cleanup, deepHook } from './helpers.ts';
import { scenario } from './scenario.ts';

afterEach(cleanup);

describe('#321.70212996 a "proceed" never covers a call that needs authority', () => {
  test('#321.70212996 the planted sorter proceeds on "want me to push to main?", recorded with its rule; the push in its turn is held at PreToolUse with an authority ask until your yes and its 10 s hold, a try during the hold is refused, the push then runs; after its proceed on "want me to run the tests?", npm test runs with no ask', async () => {
    await deepHook();
    await scenario();
  }, 600_000);
});
