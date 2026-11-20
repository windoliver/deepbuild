// #1604 acceptance: the wait ratchet (AC3), the lint lane running the guard as a command of its own, and the guard
// passing on this checkout as it stands, with its checked-in ceilings the checkout's own.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CEILINGS, LISTED, SCRIPT, assertFailsNaming, assertPasses, base, ceilings, git, guard, guardCommand, isTestPath, lint, listed, put, root, runsScript } from './helpers.mjs';

test('the lint lane runs scripts/wait-ratchet.mjs as a command of its own, beside the size ratchet', () => {
  assert.ok(lint, 'no lint lane in checks');
  const command = guardCommand();
  for (const part of command) assert.ok(!['-e', '--eval', '-p', '--print'].includes(part), `inline code in the guard's command: ${JSON.stringify(command.slice(1))}`);
  assert.ok(lint.commands.some((candidate) => runsScript(candidate, 'scripts/size-ratchet.mjs')), 'the lint lane no longer runs scripts/size-ratchet.mjs');
});

test("AC3: a listed file whose count rises by one fails the lint lane, naming it, and raising its ceiling in the same change doesn't help; at its ceiling it passes", (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), `(${LISTED} at its ceiling of 2)`);
  put(cwd, LISTED, listed(3));
  assertFailsNaming(guard(cwd), LISTED, '(3 fixed waits, over its ceiling of 2)');
  // A count may drop, never rise: the merge base's ceiling of 2 still holds when the change writes 3.
  put(cwd, CEILINGS, ceilings({ [LISTED]: 3 }));
  assertFailsNaming(guard(cwd), LISTED, "(3 fixed waits, with its ceiling raised to 3 in the same change over the merge base's 2)");
});

test('AC3: a listed file whose count drops fails, naming it, until its ceiling is lowered to its count in the same change', (t) => {
  guardCommand();
  const cwd = base(t);
  put(cwd, LISTED, listed(1));
  assertFailsNaming(guard(cwd), LISTED, '(1 fixed wait, under its unchanged ceiling of 2)');
  put(cwd, CEILINGS, ceilings({ [LISTED]: 1 }));
  assertPasses(guard(cwd), '(its ceiling lowered to 1, its count)');
});

/**
 * Acceptance files on the base that hold a fixed wait in code, not in a string or comment, read by hand from the base
 * commit. Acceptance files are never edited, so each keeps its wait and must be listed with a count of at least 1.
 * One for each JavaScript form the issue names; Rust's thread::sleep has its planted test in waits.test.mjs.
 */
const KNOWN = {
  'tests/acceptance/1015/focused.test.ts': 'await sleep(1000) at line 26',
  'tests/acceptance/1808/shown.test.ts': 'await new Promise((resolve) => setTimeout(resolve, 800)) at line 55',
  'tests/acceptance/172/reproducible.test.ts': 'Atomics.wait in pause at line 65',
};

test("on this checkout the guard passes without changing git status, and the checked-in ceilings are the checkout's own", () => {
  const status = () => git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const before = status();
  const result = guard(root);
  assert.equal(status(), before, `the guard changed git status\n${result.stdout}`);
  assertPasses(result, '(this checkout as it stands)');

  assert.doesNotThrow(() => git(root, 'ls-files', '--error-unmatch', '--', CEILINGS), `${CEILINGS} is not checked in`);
  const listedHere = JSON.parse(readFileSync(join(root, CEILINGS), 'utf8'));
  assert.ok(listedHere && typeof listedHere === 'object' && !Array.isArray(listedHere), `${CEILINGS} isn't a JSON object`);
  // Independent of the script: each entry is a test file the work tree holds, with a count of at least 1.
  const wrong = [];
  for (const [path, count] of Object.entries(listedHere)) {
    if (!Number.isInteger(count) || count < 1) wrong.push(`${path} has a count of ${JSON.stringify(count)}, not a whole number of at least 1`);
    if (!isTestPath(path)) wrong.push(`${path} is not under the repo's declared test paths`);
    else if (!existsSync(join(root, path)) || !statSync(join(root, path)).isFile()) wrong.push(`${path} is not a file in the work tree`);
  }
  for (const [path, why] of Object.entries(KNOWN))
    if (!(listedHere[path] >= 1)) wrong.push(`${path} holds a fixed wait (${why}) but its ceiling is ${JSON.stringify(listedHere[path])}`);
  assert.deepEqual(wrong, [], `${SCRIPT} passes, but ${CEILINGS} doesn't match the checkout`);
});
