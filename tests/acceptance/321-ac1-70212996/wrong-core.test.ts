import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, ID, localHead, originMain, PUSH, WRONG_CORE } from './helpers.ts';
import { heldPush, openWorld } from './scenario.ts';

afterEach(cleanup, 60_000);

describe(`${ID} the wrong program: a core that lets a "proceed" cover the calls of the turn it starts`, () => {
  it(`${ID} with DEEP_HUB_PLANT=${WRONG_CORE} the push goes through, and the scenario fails naming \`${PUSH}\``, async () => {
    const world = await openWorld(WRONG_CORE);
    const failure = await heldPush(world).then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error)));
    expect(failure, 'the scenario fails on the planted core').not.toBeNull();
    expect(failure, 'the failure is the planted core letting the push through, not a blocked run').not.toMatch(/^BLOCKED/);
    expect(failure, 'the failure names the call').toContain(PUSH);
    expect(originMain(world.repo), 'the planted core let the push through to origin').toBe(localHead(world.repo));
  }, 300_000);
});
