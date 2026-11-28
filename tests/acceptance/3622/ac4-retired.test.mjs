// AC4 of #3622: each row retired for 0.1.19 names the upstream change that meets its removal condition, and a planted
// removal of a row 0.1.19 does not cover fails that row's check. The removal runs in a copy of the tree against the
// pristine 0.1.19 releases (DEEP_VENDOR_RELEASES). Needs the network for the releases.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, judgeRetired, judgeRowRemoval, releases, repoRoot } from './common.mjs';

test(`AC4 ${AC[4]} each row the base carries on gpui-pre is carried onto 0.1.19, or retired for 0.1.19 naming the upstream change`, () => {
  assert.deepEqual(judgeRetired(repoRoot), []);
});

test(`AC4 ${AC[4]} a planted removal of a row 0.1.19 does not cover fails check, naming its carried file`, { timeout: 30 * 60_000 }, async () => {
  assert.deepEqual(judgeRowRemoval(repoRoot, await releases()), []);
});
