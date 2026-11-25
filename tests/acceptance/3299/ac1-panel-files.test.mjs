// #3299, the first criterion: gpui-shell's gitignored panel files, written into or deleted from a panel folder of
// crates/deep-app after a build of deep-show, leave the next build fresh, and the source digest is the same with and
// without them. README.md beside this file says what each test reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstCriterion } from './helpers.mjs';

const AC1 = 'AC1 #3299.44ab2e7a';

let readings;
/** The criterion's builds, made once for the three tests below. */
const read = () => (readings ??= firstCriterion());

test(`${AC1}: writing gpui-kit.d.ts, jsconfig.json and @deepbuild/panel into the panel folders leaves the next build of deep-show fresh`, () => {
  assert.deepEqual(read().failures.writing, []);
});

test(`${AC1}: deleting them leaves the next build of deep-show fresh`, () => {
  assert.deepEqual(read().failures.deleting, []);
});

test(`${AC1}: deep-show's source digest is the same with and without them`, () => {
  assert.deepEqual(read().failures.digest, []);
});
