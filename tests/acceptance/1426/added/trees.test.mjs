// #1426: "A planted changed file under `vendor/quickjs-jit-runtime` with no row fails the lint, naming the file".
// Scope: "The table and its lint cover every tree under `vendor/`: today `gpui-pre`, `gpui-pre-apple`,
// `quickjs-jit-runtime` and `unicode-17.0.0`, and any wgpu patch #1552 or #475 carries". README.md, The added surface,
// pins how a tree with no Cargo.toml names its release.
// Run: node --test tests/acceptance/1426/added/trees.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot, SCRIPT } from './common.mjs';
import { judgeEveryTree, judgeLane, judgeQuickjs, judgeRealQuickjs } from './trees-judge.mjs';

const script = join(repoRoot, SCRIPT);

test(`${AC.quickjs} a changed file under vendor/quickjs-jit-runtime with no row, top-level, nested, its build.rs or new, fails check naming it; with a row it passes`, () => {
  assert.deepEqual(judgeQuickjs(script), []);
});

test(`${AC.quickjs} the lint lane runs check: a planted changed quickjs-jit-runtime file with no row fails the lane, naming the file`, async () => {
  assert.deepEqual(await judgeLane(join(repoRoot, 'scripts/lanes.mjs')), []);
});

test(`${AC.quickjs} (scope) every tree under vendor/: a changed or new file in unicode-17.0.0, and in a crate vendored later, fails check naming it`, () => {
  assert.deepEqual(judgeEveryTree(script), []);
});

test(`${AC.quickjs} (scope) the real table has a row for quickjs-jit-runtime's src/lib.rs, which the base carries a change in`, () => {
  assert.deepEqual(judgeRealQuickjs(), []);
});
