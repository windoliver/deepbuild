import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BLIND, CEILINGS, LISTED, assertFailsNaming, assertNotNamed, assertPasses, commentedSuite, commitAll, guard, guardCommand, listedUnderBlind, put, repo, root, suite, suiteFiles, writers } from './helpers.mjs';

const NEW = '9002';
const LANDED = '9001';
const TWINNED = '9003';

const plantEachFile = (cwd, why) => {
  for (const [kind, path] of Object.entries(suiteFiles(NEW))) {
    put(cwd, path, writers[kind](true));
    const result = guard(cwd);
    assertFailsNaming(result, path, `(one comment line in ${path}, a file of a suite new since the merge base, ${why})`);
    for (const other of Object.values(suiteFiles(NEW))) if (other !== path) assertNotNamed(result, other, `(it holds no comment, ${why})`);
    put(cwd, path, writers[kind](false));
  }
};

test('#3455.1e33643c a planted new suite under tests/acceptance/ with one comment fails the lint lane, naming the file, and the same suite with none passes, its files untracked', (t) => {
  guardCommand();
  const cwd = repo(t, {});
  for (const [path, content] of Object.entries(suite(NEW))) put(cwd, path, content);
  assertPasses(guard(cwd), `(the new suite tests/acceptance/${NEW}/ with no comment, untracked)`);
  plantEachFile(cwd, 'untracked');
  assertPasses(guard(cwd), `(the new suite with its comments taken out again)`);
});

test('#3455.1e33643c a planted new suite under tests/acceptance/ with one comment fails the lint lane, naming the file, and the same suite with none passes, committed on top of the merge base', (t) => {
  guardCommand();
  const cwd = repo(t, {});
  for (const [path, content] of Object.entries(suite(NEW))) put(cwd, path, content);
  commitAll(cwd, 'add the new suite');
  assertPasses(guard(cwd), `(the new suite tests/acceptance/${NEW}/ with no comment, committed after the merge base)`);
  for (const [kind, path] of Object.entries(suiteFiles(NEW))) {
    put(cwd, path, writers[kind](true));
    commitAll(cwd, `plant a comment in ${path}`);
    const result = guard(cwd);
    assertFailsNaming(result, path, `(one comment line in ${path}, committed on top of the merge base)`);
    put(cwd, path, writers[kind](false));
    commitAll(cwd, `take the comment out of ${path}`);
  }
  assertPasses(guard(cwd), '(the new suite with its comments taken out again, committed)');
});

test('#3455.7da213af a suite the merge base holds passes the lint lane with its comments and gets no entry in scripts/comment-ceilings.json, while a new suite beside it with one comment fails naming only its own file', (t) => {
  guardCommand();
  const listedHere = Object.keys(JSON.parse(readFileSync(join(root, CEILINGS), 'utf8'))).filter((path) => path.startsWith(BLIND));
  const cwd = repo(t, commentedSuite(LANDED));
  const landed = Object.values(suiteFiles(LANDED));
  const planted = suiteFiles(NEW).helper;
  for (const [path, content] of Object.entries(suite(NEW, 'helper'))) put(cwd, path, content);
  const mixed = guard(cwd);
  assertFailsNaming(mixed, planted, `(one comment line in ${planted}, new since the merge base, beside the landed suite tests/acceptance/${LANDED}/)`);
  for (const path of landed) assertNotNamed(mixed, path, '(a landed suite file with its comments)');
  assert.deepEqual(listedUnderBlind(cwd), [], `the scratch ceilings list files under ${BLIND} after a plain run`);
  guard(cwd, '--write');
  assert.deepEqual(listedUnderBlind(cwd), [], `the scratch ceilings list files under ${BLIND} after --write with the new suite's comment in place`);
  const still = guard(cwd);
  assertFailsNaming(still, planted, '(the new suite file still holds its comment after --write)');
  for (const path of landed) assertNotNamed(still, path, '(a landed suite file with its comments, after --write)');
  put(cwd, planted, writers.helper(false));
  const clean = guard(cwd);
  assertPasses(clean, `(the landed suite tests/acceptance/${LANDED}/ with its comments, the new suite with none)`);
  guard(cwd, '--write');
  assert.deepEqual(listedUnderBlind(cwd), [], `the scratch ceilings list files under ${BLIND} after --write with the new suite clean`);
  assertPasses(guard(cwd), '(after --write, the landed suite with its comments)');
  assert.ok(JSON.parse(readFileSync(join(cwd, CEILINGS), 'utf8'))[LISTED] === 1, `--write dropped the ceiling of ${LISTED}, a listed file outside ${BLIND}`);
  assert.deepEqual(listedHere, [], `this checkout's ${CEILINGS} lists files under ${BLIND}`);
});

test("#3455.868c2194 a planted file under a new suite's twins/ folder passes the lint lane with its comments, while a commented file directly in the same new suite fails naming only that file", (t) => {
  guardCommand();
  const cwd = repo(t, {});
  const twins = {
    [`tests/acceptance/${TWINNED}/twins/drops-check/packages/fixture/src/sum.ts`]: '// a twin comment\nexport const sum = (a: number, b: number): number => a + b; // and another\n',
    [`tests/acceptance/${TWINNED}/twins/drops-check/crates/fixture/src/lib.rs`]: '/* a twin block\n   comment */\npub fn one() -> u32 {\n    1 // after code\n}\n',
    [`tests/acceptance/${TWINNED}/twins/first.mjs`]: '// a twin comment\nexport const first = (list) => list[0];\n',
  };
  for (const [path, content] of Object.entries(twins)) put(cwd, path, content);
  const direct = suiteFiles(TWINNED);
  for (const [path, content] of Object.entries(suite(TWINNED, 'test'))) put(cwd, path, content);
  const mixed = guard(cwd);
  assertFailsNaming(mixed, direct.test, `(one comment line in ${direct.test}, directly in the new suite tests/acceptance/${TWINNED}/)`);
  for (const path of Object.keys(twins)) assertNotNamed(mixed, path, `(a planted twin under tests/acceptance/${TWINNED}/twins/, with its comments)`);
  put(cwd, direct.test, writers.test(false));
  assertPasses(guard(cwd), `(the twins under tests/acceptance/${TWINNED}/twins/ with their comments, the suite's own files with none)`);
});
