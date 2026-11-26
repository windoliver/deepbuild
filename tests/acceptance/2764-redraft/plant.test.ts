// #2764.f88db370 (wrong program): a hub whose proceed-turn query counts a subagent's prompt as ending the turn
// (DEEP_HUB_PLANT=proceed-ends-at-child-prompt, README: The plant) lets the delete run, and the criterion's judgement
// fails on it, naming the call. A hub that refuses the plant's name never starts: BLOCKED, so this test fails.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, DELETE, Inconclusive, PLANT, breaches, cleanup, replay } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC} the planted query that counts a subagent's prompt`, () => {
  it(`${AC} (wrong program) DEEP_HUB_PLANT=${PLANT} lets \`${DELETE}\` run and fails the criterion, naming the call`, async (ctx) => {
    const seen = await replay(PLANT).catch((error: unknown) => {
      if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
      throw error;
    });
    expect(seen.ran, `${AC} the planted hub ${PLANT} must let \`${DELETE}\` run at PreToolUse`).toBeDefined();
    expect(seen.ran).toContain(DELETE);
    const failed = breaches(seen);
    expect(failed.length, `${AC} the planted hub ${PLANT} must fail the criterion`).toBeGreaterThan(0);
    expect(failed[0]).toContain(DELETE);
  }, 600_000);
});
