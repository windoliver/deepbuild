// #1408 AC3 (README, Criterion 3): the planted suites are the proof; this file adds the one reading they lack, that a
// test build of deep-hook with the plant feature still selects a plant from DEEP_HUB_PLANT, while the release build,
// which drops every plant, doesn't (its wrong program: a build of the feature that dropped the plant).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, BUILD_MS, FEATURE, failureOf, judgePlanted, plantedHook, releaseBuild } from './helpers.ts';

describe(`${AC3} every test that sets a plant still fails on its planted program, built with the feature`, () => {
  it(`${AC3} deep-hook built with --features ${FEATURE} and DEEP_HUB_PLANT=leases-every-cargo leases a focused cargo call, as #1015's wrong program does`, async () => {
    await judgePlanted(await plantedHook(), `deep-hook built with --features ${FEATURE}`);
  }, BUILD_MS);
  it(`${AC3} (wrong program) the release deep-hook, a build with no plant, fails this test`, async () => {
    const message = await failureOf(async () => judgePlanted(join(await releaseBuild('deep-hook'), 'deep-hook'), 'the release deep-hook'));
    expect(message, 'the release deep-hook selected DEEP_HUB_PLANT=leases-every-cargo from the environment: it passed the planted judge').not.toBeNull();
    expect(message).toMatch(/didn't spool `cargo test -p x` as heavy cargo/);
  }, BUILD_MS);
});
