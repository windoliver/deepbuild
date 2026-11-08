// #1426, two Scope lines, under AC1's tag as the first draft tags its Scope tests: "vendor/gpui-pre-apple/upstream/
// README.md records the refusal with its date and link" (zed-industries/zed#66114, closed unmerged on October 28,
// 2026, and the file no longer calling the pull request open), and "The design's line on patches is corrected" (the
// toolkit's Decided row no longer calls rquickjs the only patch, and names the vendored GPUI patches). Fast; reads two
// files of this tree (scope-judge.mjs; README.md, How each criterion is read).
// Run: node --test tests/acceptance/1426/redraft/scope.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, DESIGN, README, repoRoot } from './common.mjs';
import { judgeDesign, judgeRefusal } from './scope-judge.mjs';

const read = (path) => (existsSync(join(repoRoot, path)) ? readFileSync(join(repoRoot, path), 'utf8') : '');

test(`${AC[1]} (Scope) ${README} records zed's refusal of zed-industries/zed#66114, with the link, the date October 28, 2026 and a word saying it was refused, and no longer calls the pull request open`, () => {
  assert.deepEqual(judgeRefusal(read(README)), []);
});

test(`${AC[1]} (Scope) the design's toolkit Decided row no longer calls rquickjs the only patch and names the vendored GPUI patches`, () => {
  assert.deepEqual(judgeDesign(read(DESIGN)), []);
});
