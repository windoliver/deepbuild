// AC4: the ask's question carries what the registry says of the version, read by the hub from the fixture registry,
// or "couldn't check" with the registry down, and never says old or safe (README, Criteria to tests). On the real hub
// and deep-hook; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, describe, it } from 'vitest';
import { AC4, cleanup, verdict } from './helpers.ts';
import { registryReading } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC4 ${AC4} with a fixture registry, a version published 2 days ago shows that in the question; with the registry down, it says "couldn't check", and it never says old or safe`, () => {
  it(`AC4 ${AC4} the ask for \`npx -y some-pkg@latest\` shows its version was published 2 days ago and names it new; with the registry down the ask for \`npx -y other-pkg@1.2.0\` says "couldn't check"; neither says old or safe`, async (ctx) => {
    await verdict(ctx, () => registryReading());
  }, 600_000);
});
