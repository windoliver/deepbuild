// #882 AC2: "crates/deep-app/src holds no color literal outside the look, and a planted rgb(0x2563eb) in views.rs
// fails the lint lane, naming the file, the line and the role to use; the merge base has 21 such lines and fails
// it". Scope: "an exception names its exact place, a reason and a review date". The guard is
// scripts/color-literal-guard.mjs in the lint lane of scripts/lanes.mjs's checks; README.md, The surface, pins how.
// Run: node --test tests/acceptance/882/lint.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot } from './common.mjs';
import { GUARD, judgeBase, judgeLint, judgeWiring, literalsIn } from './lint-judge.mjs';

test(`${AC[2]} crates/deep-app/src holds no color literal: no rgb(0x, rgba(0x, hsla(, hex inside rgb(...) or "#rrggbb" line`, () => {
  assert.deepEqual(literalsIn(repoRoot), []);
});

test(`${AC[2]} the guard passes the app, and fails each planted literal naming its file and line (the views.rs one with the role to use); an exception at its place with a reason and a review date passes`, () => {
  assert.deepEqual(judgeLint(join(repoRoot, GUARD)), []);
});

test(`${AC[2]} the lint lane runs the guard: a planted rgb(0x2563eb) in views.rs fails the lane, naming views.rs and the line`, async () => {
  assert.deepEqual(await judgeWiring(join(repoRoot, 'scripts/lanes.mjs')), []);
});

test(`${AC[2]} the merge base's app has the issue's 21 rgb(0x lines and fails the guard, naming each one and its two hsla( lines`, () => {
  assert.deepEqual(judgeBase(join(repoRoot, GUARD)), []);
});
