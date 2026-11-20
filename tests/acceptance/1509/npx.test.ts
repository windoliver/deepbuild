// AC1: a package run straight from a registry that the lockfile doesn't hold, in a session whose plan doesn't name it,
// is a dependency decision: held with an ask naming the package (README, Criteria to tests). The hub leg runs on the
// real hub and deep-hook against the fixture registry; the spellings leg asks deep-hook's check mode alone.
// INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, describe, it } from 'vitest';
import { AC1, cleanup, verdict } from './helpers.ts';
import { registryRunHeld, spellingsRead } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC1 ${AC1} \`npx -y some-pkg@latest\` not in the lockfile, in a session whose plan doesn't name it, is held with an ask naming the package; on the merge base it runs, and this test fails naming the call`, () => {
  it(`AC1 ${AC1} \`npx -y some-pkg@latest\`, which the repo's lockfile doesn't hold, in a session working on no task, is held with an authority ask naming some-pkg`, async (ctx) => {
    await verdict(ctx, () => registryRunHeld());
  }, 600_000);

  it(`AC1 ${AC1} the dependency effect reads the same call and the Scope's other spellings of running a package straight from a registry (deep-hook check)`, async (ctx) => {
    await verdict(ctx, () => spellingsRead());
  }, 600_000);
});
