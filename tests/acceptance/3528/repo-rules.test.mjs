// #3528's second criterion: the lint lane's repo rules refuse a tracked file whose name ends in .orig or .rej outside
// vendor/, naming it. Three runs of `node scripts/repo-rules.mjs` with cwd at this checkout, started together and each
// awaited by its test: over the merge base's tree, over the change as it stands, and over the change's index with
// crates/deep-app/src/main.rs.rej planted in it (README: readings 2 to 4).
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { LEFTOVERS, PLANT, RULE, VENDORED, failing, git, mergeBase, repoRules, root, scratch, show } from './helpers.mjs';

const dir = scratch();
after(() => rmSync(dir, { recursive: true, force: true }));

// Each run is a promise; one that rejects before its test awaits it is marked handled here and fails in its test.
const settle = (start) => {
  const run = Promise.resolve().then(start);
  run.catch(() => {});
  return run;
};

const onBase = settle(() => {
  const index = join(dir, 'base.index');
  git(['read-tree', mergeBase()], { GIT_INDEX_FILE: index });
  return repoRules({ GIT_INDEX_FILE: index });
});
const onChange = settle(() => repoRules());
const planted = settle(() => {
  const index = join(dir, 'planted.index'), own = resolve(root, git(['rev-parse', '--git-path', 'index']).trim());
  if (!existsSync(own)) throw new Error("BLOCKED: this checkout has no index to plant in");
  copyFileSync(own, index);
  const blob = git(['rev-parse', 'HEAD:crates/deep-app/src/main.rs']).trim();
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${PLANT}`], { GIT_INDEX_FILE: index });
  assert.ok(git(['ls-files', '--', PLANT], { GIT_INDEX_FILE: index }).includes(PLANT), `the plant isn't in the index`);
  return repoRules({ GIT_INDEX_FILE: index });
});

test(`${RULE} the repo rules over the merge base's tree fail, naming both .orig files under crates/ and none of the five under vendor/`, async () => {
  const run = await onBase;
  assert.equal(run.status, 1, `the merge base's tree tracks both files, so the repo rules exit 1\n${show(run)}`);
  for (const path of LEFTOVERS) assert.ok(failing(run).some((line) => line.includes(path)), `no failing line names ${path}\n${show(run)}`);
  for (const path of VENDORED) assert.ok(!failing(run).some((line) => line.includes(path)), `a failing line names ${path}, which is Cargo's own and stays\n${show(run)}`);
});

test(`${RULE} on the change the repo rules pass, with the five vendor/**/Cargo.toml.orig still tracked`, async () => {
  const run = await onChange;
  assert.equal(run.status, 0, `the repo rules fail on the change\n${show(run)}`);
  assert.deepEqual(failing(run), [], show(run));
  assert.ok(run.lines.some((line) => line.startsWith('PASS ')), `no PASS line\n${show(run)}`);
  assert.deepEqual(git(['ls-files', '--', 'vendor/**/Cargo.toml.orig']).split('\n').filter(Boolean).sort(), VENDORED);
});

test(`${RULE} a crates/deep-app/src/main.rs.rej planted in the change's index fails the repo rules, naming the file`, async () => {
  const run = await planted;
  assert.equal(run.status, 1, `a tracked .rej outside vendor/ exits the repo rules 1\n${show(run)}`);
  assert.ok(failing(run).some((line) => line.includes(PLANT)), `no failing line names ${PLANT}\n${show(run)}`);
});
