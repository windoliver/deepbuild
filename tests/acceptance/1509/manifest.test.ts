// AC3: a bare install is read through the diff: the names the manifest adds since the base count, and an install that
// adds none is no decision (README, Criteria to tests). On the real hub and deep-hook; INCONCLUSIVE (a hook the machine
// made late) is a skip, never a pass.
import { afterEach, describe, it } from 'vitest';
import { AC3, cleanup, verdict } from './helpers.ts';
import { installsThroughTheDiff } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC3 ${AC3} after an agent's Write adds left-pad to package.json, npm install is held naming left-pad; npm install, npm ci and pip install -r requirements.txt with no manifest change run; on the merge base the pip call is read as a new dependency, and this test fails naming it`, () => {
  it(`AC3 ${AC3} \`npm install\`, \`npm ci\` and \`pip install -r requirements.txt\` with no manifest change run with no ask; after the agent's Write adds left-pad to package.json, \`npm install\` is held with an ask naming left-pad`, async (ctx) => {
    await verdict(ctx, () => installsThroughTheDiff());
  }, 600_000);
});
