// #3139 AC2 on this checkout (README: AC2, on this checkout): the three lints, run as the lint lane runs them, print no
// finding under tests/acceptance/ that the decision excuses. Other findings, such as those outside tests/acceptance/
// that belong to other open issues, or a suite file a change adds, are left alone, and so is the exit code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC2, RULES, SIZE, SIZE_CEILINGS, WAITS, WAIT_CEILINGS, assertDepsRan, findings, git, isTwin, pathOf, root, run } from './helpers.mjs';

/** The files under tests/acceptance/ that the merge base of HEAD with origin/main holds. */
function heldAtMergeBase() {
  let base;
  try {
    base = git(root, 'merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    throw new Error('INCONCLUSIVE: this checkout has no merge base with origin/main, so which acceptance files it holds is unknown');
  }
  return new Set(git(root, 'ls-tree', '-r', '-z', '--name-only', base, '--', 'tests/acceptance').split('\0').filter(Boolean));
}

const readCeilings = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const list = (lines, max = 30) => `${lines.length} lines${lines.length > max ? `, the first ${max}` : ''}:\n${lines.slice(0, max).join('\n')}`;

/**
 * The lines of a ratchet's findings that the decision excuses: each names a planted twin, or a suite's own file under
 * tests/acceptance/ that the merge base holds and that has no ceiling.
 */
function excusedByRatchet(result, check, ceilings, held) {
  return findings(result, check).filter((line) => {
    const path = pathOf(line);
    return isTwin(path) || (path.startsWith('tests/acceptance/') && !Object.hasOwn(ceilings, path) && held.has(path));
  });
}

test(`${AC2} AC2: on this checkout the wait ratchet prints no finding the decision excuses, none naming a twin or a suite's own file the merge base holds with no ceiling, and no twin keeps a ceiling`, () => {
  const ceilings = readCeilings(WAIT_CEILINGS);
  const held = heldAtMergeBase();
  const result = run(WAITS, root);
  const excused = excusedByRatchet(result, 'waits', ceilings, held);
  assert.equal(excused.length, 0, `the wait ratchet prints findings under tests/acceptance/ that the decision excuses: ${list(excused)}`);
  const twins = Object.keys(ceilings).filter(isTwin);
  assert.equal(twins.length, 0, `${WAIT_CEILINGS} still gives ${twins.length} twins a ceiling; the decision drops them: ${list(twins)}`);
});

test(`${AC2} AC2: on this checkout the size ratchet prints no finding the decision excuses, none naming a twin or a suite's own file the merge base holds with no ceiling, and no twin keeps a ceiling`, () => {
  const ceilings = readCeilings(SIZE_CEILINGS);
  const held = heldAtMergeBase();
  const result = run(SIZE, root);
  const excused = excusedByRatchet(result, 'size', ceilings, held);
  assert.equal(excused.length, 0, `the size ratchet prints findings under tests/acceptance/ that the decision excuses: ${list(excused)}`);
  const twins = Object.keys(ceilings).filter(isTwin);
  assert.equal(twins.length, 0, `${SIZE_CEILINGS} still gives ${twins.length} twins a ceiling; the decision drops them: ${list(twins)}`);
});

/**
 * The suites' own tooling crates whose dependencies had no row at the base (c52dc3e73), read from its run of
 * `node scripts/repo-rules.mjs`: two FAIL deps lines each. The decision gives them rows like the earlier ones.
 */
const TOOLING = [
  'tests/acceptance/189/carry/wat/Cargo.toml',
  'tests/acceptance/189/saves/wat/Cargo.toml',
  'tests/acceptance/192/dungeon/wat/Cargo.toml',
  'tests/acceptance/276/match/wat/Cargo.toml',
  'tests/acceptance/276/record/wat/Cargo.toml',
  'tests/acceptance/276/web/wat/Cargo.toml',
  'tests/acceptance/416/interfaces/wat/Cargo.toml',
  'tests/acceptance/416/layouts/wat/Cargo.toml',
  'tests/acceptance/851/wat/Cargo.toml',
];
/** #2651's suite file with two made-up key-shaped strings, which the decision gives allowedFindings rows. */
const TOKENS = 'tests/acceptance/2651/lib.mjs';
/** The paths under tests/acceptance/ a line names anywhere in it. */
const acceptancePaths = (line) => [...line.matchAll(/tests\/acceptance\/[^\s:,;)]+/g)].map(([path]) => path);

test(`${AC2} AC2: on this checkout the repo rules print no finding the decision excuses: no deps line names a twin's manifest or a suite's own tooling crate given its row, and no secrets line names #2651's made-up tokens`, () => {
  const result = run(RULES, root);
  assertDepsRan(result);
  const twins = findings(result, 'deps').filter((line) => acceptancePaths(line).some(isTwin));
  const tooling = findings(result, 'deps').filter((line) => TOOLING.some((path) => line.includes(path)));
  const tokens = findings(result, 'secrets').filter((line) => line.includes(TOKENS));
  assert.equal(twins.length + tooling.length + tokens.length, 0, `the repo rules print findings under tests/acceptance/ that the decision excuses (twins' manifests ${twins.length}, tooling crates ${tooling.length}, #2651's tokens ${tokens.length}): ${list([...twins, ...tooling, ...tokens])}`);
});
