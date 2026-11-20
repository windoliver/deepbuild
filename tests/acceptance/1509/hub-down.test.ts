// AC5: with the hub stopped, a package run straight from a registry is allowed and recorded, as a dependency is today
// (README, Criteria to tests): deep-hook alone, then the record once the hub replays its spool.
import { afterEach, describe, it } from 'vitest';
import { AC5, cleanup, verdict } from './helpers.ts';
import { hubStopped } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC5 ${AC5} with the hub stopped, the call is allowed and recorded, as a dependency is today`, () => {
  it(`AC5 ${AC5} with the hub stopped, \`npx -y some-pkg@latest\` is allowed, and once the hub is back the record holds it as a dependency, matched as \`npm install left-pad@1.3.0\` is`, async (ctx) => {
    await verdict(ctx, () => hubStopped());
  }, 600_000);
});
