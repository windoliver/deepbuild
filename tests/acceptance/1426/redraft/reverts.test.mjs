// #1426 AC2: "Each row's test fails with that row's change reverted, for the sRGB layer tag, the exact gradient mode,
// the BGRA surface and the surface reports". For each of the four rows of vendor/gpui-pre-apple/upstream/README.md's
// carried-patch table, its Test runs on a private copy of this tree: it must pass as the tree stands and fail with
// that behavior reverted in the files the row lists (reverts-judge.mjs; README.md, How each criterion is read).
// Heavy: it builds what each row's test builds, in the copy's own target/, cold. Needs macOS (the four behaviors are
// gpui-pre-apple's Metal renderer), cargo, node_modules and a Metal device; whatever is missing reads INCONCLUSIVE.
// Run: node --test tests/acceptance/1426/redraft/reverts.test.mjs
import { test } from 'node:test';
import { AC, repoRoot, verdict } from './common.mjs';
import { judgeReverts } from './reverts-judge.mjs';

test(`${AC[2]} each row's test passes as the tree stands and fails with that row's change reverted, for the sRGB layer tag, the exact gradient mode, the BGRA surface and the surface reports`, { timeout: Infinity }, async (t) => {
  verdict(await judgeReverts(repoRoot, { log: (line) => t.diagnostic(line) }));
});
