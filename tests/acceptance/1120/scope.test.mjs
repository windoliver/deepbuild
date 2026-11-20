// #1120 (T6): per mutant, StrykerJS builds the mutated package and its dependents only, and the lane's killed and
// survived sets are those of the unscoped run. Real proof CLI, real bays, real npm, tsc and StrykerJS on a fixture
// workspace (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { laneLines, machineRepo, proof, sandbox, show, survivors } from './helpers.mjs';

// The unscoped reference run: the mutation lane at the base commit, which builds every workspace package per mutant,
// on this same fixture (BASE-FAILURE.txt). Five mutants of the added line; the tests read b's and d's dist, and kill
// every mutant but `n >= 10`, which neither checks.
const REFERENCE = {
  lane: ['PASS mutation: 5 mutants of the added lines, 1 surviving on a line a tagged test executes'],
  survivors: [
    [
      'SURVIVED packages/a/src/f.ts:2 (EqualityOperator)',
      "    -  if (n > 10) return 'big';",
      "    +  if (n >= 10) return 'big';",
    ].join('\n'),
  ],
};

test("#1120.1f2e20de per mutant StrykerJS builds only the mutated package and its dependents, and the killed and survived sets equal the unscoped reference run's", { timeout: 900_000 }, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const result = await proof(box, fixture);

  const underMutant = result.runs.filter(({ mutant }) => mutant !== null);
  assert.ok(new Set(underMutant.map(({ mutant }) => mutant)).size >= 2, `the tagged tests ran under fewer than two mutants\n${show(result)}`);

  // The run compared is the scoped one: c, which is neither a nor a dependent of a, is never built under a mutant,
  // by its build script's log and by the stamp of its dist as each mutant's test run saw it.
  assert.deepEqual(result.builds.filter(({ package: name }) => name === 'c').map(({ mutant }) => mutant), [], `packages/c (neither the mutated package nor a dependent) was built under these mutants\n${show(result)}`);
  assert.equal(new Set(underMutant.map(({ stamps }) => stamps.c)).size, 1, `packages/c's dist was rewritten between mutants' test runs: ${JSON.stringify(underMutant.map(({ mutant, stamps }) => [mutant, stamps.c]))}\n${show(result)}`);

  // The killed and survived sets: the same five mutants, the same one survivor with its diff, so the same four killed.
  assert.deepEqual(laneLines(result.stdout), REFERENCE.lane, `the lane's mutant count or state differs from the unscoped reference run's\n${show(result)}`);
  assert.deepEqual(survivors(result.stdout), REFERENCE.survivors, `the survived set differs from the unscoped reference run's\n${show(result)}`);
});
