import { afterEach, describe, it } from 'vitest';
import { cleanup, ID } from './helpers.ts';
import { heldPush, openWorld } from './scenario.ts';

afterEach(cleanup, 60_000);

describe(`${ID} a "proceed" never covers a call that needs authority`, () => {
  it(`${ID} after the planted sorter's "proceed" for "want me to push to main?", \`git push origin main\` is held at PreToolUse with an authority ask until your yes, a try during the hold is refused, the push runs once the hold ends, and \`npm test\` after a "proceed" runs with no ask`, async () => {
    await heldPush(await openWorld());
  }, 300_000);
});
