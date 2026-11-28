// AC2 of #3622: a planted unmarked hunk in a vendored gpui-fast file, a planted changed file with no row, and a planted
// 9-line hunk over budget each fail `node scripts/vendor-rebase.mjs check`, naming file and line. Each plant runs in a
// copy of the tree against the pristine 0.1.19 releases (DEEP_VENDOR_RELEASES). Needs the network for the releases.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, judgePlants, releases, repoRoot } from './common.mjs';

test(`AC2 ${AC[2]} a planted unmarked hunk in a vendored gpui-fast file, a changed file with no row and a 9-line hunk over budget each fail check, naming file and line`, { timeout: 30 * 60_000 }, async () => {
  assert.deepEqual(judgePlants(repoRoot, await releases()), []);
});
