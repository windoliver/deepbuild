import test from 'node:test';
import { CRITERION_TAG, PLANTED_GROWTH_BYTES, RECORD, assertNoFailures, differingRecordFailures, missingFileFailures, passingTreeFailures, pinnedCeilingFailures, plantTree, plantedFiles, raisedCeilingFailures, readCheckout, recordedPathsOf, reportListFailures, reportOf, runTaskCommand, setOverCeilingFailures } from './helpers.mjs';

const TEST_TIMEOUT = { timeout: 600_000 };

function readCheckoutOrFail(tag) {
  const here = readCheckout();
  assertNoFailures(here.problems, `${tag} the checkout holds the web-export task and the size record`);
  return here;
}

test(`${CRITERION_TAG[1]} each set has a ceiling equal to its compressed size on the pinned base, and a planted sets.json whose game2d is 100,000 B larger fails, naming the set, both sizes and the difference`, TEST_TIMEOUT, (t) => {
  const here = readCheckoutOrFail(CRITERION_TAG[1]);
  const { files, sizes, largerGame2d } = plantedFiles();
  const level = plantTree(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  const larger = plantTree(t, here, { sets: { ...files, game2d: largerGame2d }, recorded: { ...sizes, game2d: sizes.game2d + PLANTED_GROWTH_BYTES }, ceilings: sizes });
  assertNoFailures([
    ...pinnedCeilingFailures(here),
    ...passingTreeFailures(runTaskCommand(level), level, here, 'a tree whose three sets are at their ceilings, with no built binary'),
    ...setOverCeilingFailures(runTaskCommand(larger), larger, here, 'game2d'),
  ], `${CRITERION_TAG[1]} each set's ceiling is its size on the pinned base, and game2d 100,000 B over its ceiling fails, naming the set, both sizes and the difference`);
});

test(`${CRITERION_TAG[2]} a planted record whose size for a set differs from the Brotli 11 size of the two files it names fails, naming the set and both numbers`, TEST_TIMEOUT, (t) => {
  const here = readCheckoutOrFail(CRITERION_TAG[2]);
  const { files, sizes, largerGame2d } = plantedFiles();
  const level = plantTree(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  const shaved = plantTree(t, here, { sets: files, recorded: { ...sizes, full: sizes.full - 1 }, ceilings: sizes });
  const edited = plantTree(t, here, { sets: { ...files, game2d: largerGame2d }, recorded: sizes, ceilings: sizes });
  assertNoFailures([
    ...passingTreeFailures(runTaskCommand(level), level, here, 'the same files under a record that gives their Brotli 11 sizes'),
    ...differingRecordFailures(runTaskCommand(shaved), 'full', sizes.full - 1, sizes.full, `a planted ${RECORD} that records full 1 B under its two files`),
    ...differingRecordFailures(runTaskCommand(edited), 'game2d', sizes.game2d, sizes.game2d + PLANTED_GROWTH_BYTES, `a planted ${RECORD} that records game2d at its ceiling over two files 100,000 B larger`),
  ], `${CRITERION_TAG[2]} a record that differs from the Brotli 11 size of its two files fails, naming the set and both numbers`);
});

test(`${CRITERION_TAG[3]} a change that raises a ceiling with no approval is refused, naming the task and the field`, TEST_TIMEOUT, () => {
  const here = readCheckoutOrFail(CRITERION_TAG[3]);
  assertNoFailures(raisedCeilingFailures(here), `${CRITERION_TAG[3]} a raised ceiling is refused with no approval, naming web-export and the field`);
});

test(`${CRITERION_TAG[4]} a count that can't be read, such as a set whose file is missing, is missing and never 0, and its ceiling reads INCONCLUSIVE`, TEST_TIMEOUT, (t) => {
  const here = readCheckoutOrFail(CRITERION_TAG[4]);
  const { files, sizes } = plantedFiles();
  const level = plantTree(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  const gone = { figure: recordedPathsOf('figure').wasm, full: recordedPathsOf('full').glue };
  const holed = plantTree(t, here, { sets: files, recorded: sizes, ceilings: sizes, without: Object.values(gone) });
  assertNoFailures([
    ...passingTreeFailures(runTaskCommand(level), level, here, 'the same tree with every file there'),
    ...missingFileFailures(runTaskCommand(holed), holed, here, gone),
  ], `${CRITERION_TAG[4]} a set whose file is missing has no count, never 0, and its ceiling reads INCONCLUSIVE`);
});

test(`${CRITERION_TAG[5]} the report lists each set's bytes, its ceiling and its share of the 12 MB limit`, TEST_TIMEOUT, (t) => {
  const here = readCheckoutOrFail(CRITERION_TAG[5]);
  const { files, sizes } = plantedFiles();
  const roomy = plantTree(t, here, { sets: files, recorded: sizes, ceilings: { figure: sizes.figure + 1_000, game2d: sizes.game2d + 2_000, full: sizes.full + 3_000 } });
  const ran = runTaskCommand(roomy);
  t.diagnostic(`the task's report in the planted tree: ${JSON.stringify(reportOf(ran))}`);
  assertNoFailures(reportListFailures(ran, roomy, here), `${CRITERION_TAG[5]} the report lists each set's bytes, its ceiling and its share of the 12 MB limit`);
});
