// #1408 AC1 and AC2 (README): the release binaries of deep-hook, deep-app and deep-replica, byte-searched for both
// plant variables, and the release build with the plant feature on, which must fail to compile naming the feature.
// Their wrong program is the pinned merge base's deep-hook, which reads DEEP_HUB_PLANT and has no such feature.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC1, AC2, BINS, BUILD_MS, FEATURE, baseReleaseHook, failureOf, judgeBytes, judgeRefused, refusedBuild, releaseBuild, type Crate } from './helpers.ts';

const CRATES = Object.keys(BINS) as Crate[];

describe(`${AC1} a release build holds neither DEEP_HUB_PLANT nor DEEP_DRIVE_PLANT`, () => {
  for (const crate of CRATES) {
    for (const bin of BINS[crate]) {
      it(`${AC1} the release binary ${bin} (cargo build --locked --release -p ${crate}) holds neither string`, async () => {
        judgeBytes(join(await releaseBuild(crate), bin), bin);
      }, BUILD_MS);
    }
  }
  it(`${AC1} (wrong program) the merge base's release deep-hook, which reads DEEP_HUB_PLANT, fails the byte search naming it`, async () => {
    const message = await failureOf(async () => judgeBytes(await baseReleaseHook(), 'deep-hook'));
    expect(message, 'the byte search must fail on the merge base, or it proves nothing').toMatch(/the release binary deep-hook holds DEEP_HUB_PLANT/);
  }, BUILD_MS);
});

describe(`${AC2} a release build with the plant feature on fails to compile, naming the feature`, () => {
  for (const crate of CRATES) {
    it(`${AC2} cargo build --locked --release --features ${FEATURE} -p ${crate} fails on a compile error naming ${FEATURE}`, async () => {
      judgeRefused(await refusedBuild(crate), crate);
    }, BUILD_MS);
  }
  it(`${AC2} (wrong program) the merge base's deep-hook, which has no ${FEATURE} feature, fails this test: cargo's own feature error is no refusal`, async () => {
    const message = await failureOf(async () => judgeRefused(await refusedBuild('deep-hook', true), 'deep-hook'));
    expect(message, 'a build cargo stops for a missing feature must not pass as the refused build').toMatch(/failed only because cargo found no such feature/);
  }, BUILD_MS);
});
