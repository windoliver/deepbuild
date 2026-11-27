// #3518: each web player set's compressed size is a ceiling of the web-export task that only moves down.
//
// One file, five tests, one per criterion. Each reads this checkout's benchmarks/budgets.json, and all but AC3 run the
// web-export task's command in planted trees of the test's own (README: The planted tree): small seeded files stand in
// for the sets' WebAssembly and page glue, the planted size record names them, and the planted manifest holds their
// ceilings, so no committed set is compressed and nothing is built. A count's ceiling is judged by
// scripts/benchmark.mjs's `judgeCount` and a change to one by its `validateBudgets`, as perf and a window call them.
//
//   node --test tests/acceptance/3518/ceilings.test.mjs
import test from 'node:test';
import { AC, OVER, RECORD, checkout, listFailures, none, overFailures, pathsOf, pinnedFailures, plant, plants, raiseFailures, recordFailures, reportOf, run, standsFailures, unreadFailures } from './helpers.mjs';

// Each test starts three node processes at most and compresses under 250 kB: seconds, and a few minutes at a load of 200.
const LIMIT = { timeout: 600_000 };

/** This checkout's manifest and size record, read whole, or the test fails naming what isn't there. */
function read(tag) {
  const here = checkout();
  none(here.problems, `${tag} the checkout holds the web-export task and the size record`);
  return here;
}

test(`${AC[1]} each set has a ceiling equal to its compressed size on the pinned base, and a planted sets.json whose game2d is 100,000 B larger fails, naming the set, both sizes and the difference`, LIMIT, (t) => {
  const here = read(AC[1]);
  const { files, sizes, grown } = plants();
  // The control: every set at its ceiling, in a tree with no built binary.
  const level = plant(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  // The plant: game2d's files, and so its record, 100,000 B over the same ceilings.
  const larger = plant(t, here, { sets: { ...files, game2d: grown }, recorded: { ...sizes, game2d: sizes.game2d + OVER }, ceilings: sizes });
  none([
    ...pinnedFailures(here),
    ...standsFailures(run(level), level, here, 'a tree whose three sets are at their ceilings, with no built binary'),
    ...overFailures(run(larger), larger, here, 'game2d'),
  ], `${AC[1]} each set's ceiling is its size on the pinned base, and game2d 100,000 B over its ceiling fails, naming the set, both sizes and the difference`);
});

test(`${AC[2]} a planted record whose size for a set differs from the Brotli 11 size of the two files it names fails, naming the set and both numbers`, LIMIT, (t) => {
  const here = read(AC[2]);
  const { files, sizes, grown } = plants();
  // The control: the same files under a true record pass, so a failure below is the record's.
  const honest = plant(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  // The smallest difference: full recorded 1 B under what its two files measure, both within its ceiling.
  const shaved = plant(t, here, { sets: files, recorded: { ...sizes, full: sizes.full - 1 }, ceilings: sizes });
  // What the check is for: game2d's files 100,000 B over its ceiling, its record edited down to the ceiling.
  const edited = plant(t, here, { sets: { ...files, game2d: grown }, recorded: sizes, ceilings: sizes });
  none([
    ...standsFailures(run(honest), honest, here, 'the same files under a record that gives their Brotli 11 sizes'),
    ...recordFailures(run(shaved), 'full', sizes.full - 1, sizes.full, `a planted ${RECORD} that records full 1 B under its two files`),
    ...recordFailures(run(edited), 'game2d', sizes.game2d, sizes.game2d + OVER, `a planted ${RECORD} that records game2d at its ceiling over two files 100,000 B larger`),
  ], `${AC[2]} a record that differs from the Brotli 11 size of its two files fails, naming the set and both numbers`);
});

test(`${AC[3]} a change that raises a ceiling with no approval is refused, naming the task and the field`, LIMIT, () => {
  const here = read(AC[3]);
  none(raiseFailures(here), `${AC[3]} a raised ceiling is refused with no approval, naming web-export and the field`);
});

test(`${AC[4]} a count that can't be read, such as a set whose file is missing, is missing and never 0, and its ceiling reads INCONCLUSIVE`, LIMIT, (t) => {
  const here = read(AC[4]);
  const { files, sizes } = plants();
  // The control: with every file there, every count is read.
  const whole = plant(t, here, { sets: files, recorded: sizes, ceilings: sizes });
  // The plant: figure's WebAssembly and full's page glue are missing; the record still names both, and game2d is whole.
  const gone = { figure: pathsOf('figure').wasm, full: pathsOf('full').glue };
  const holed = plant(t, here, { sets: files, recorded: sizes, ceilings: sizes, without: Object.values(gone) });
  none([
    ...standsFailures(run(whole), whole, here, 'the same tree with every file there'),
    ...unreadFailures(run(holed), holed, here, gone),
  ], `${AC[4]} a set whose file is missing has no count, never 0, and its ceiling reads INCONCLUSIVE`);
});

test(`${AC[5]} the report lists each set's bytes, its ceiling and its share of the 12 MB limit`, LIMIT, (t) => {
  const here = read(AC[5]);
  const { files, sizes } = plants();
  // Each set under its ceiling by its own amount, so no field can stand in for another.
  const roomy = plant(t, here, { sets: files, recorded: sizes, ceilings: { figure: sizes.figure + 1_000, game2d: sizes.game2d + 2_000, full: sizes.full + 3_000 } });
  const ran = run(roomy);
  t.diagnostic(`the task's report in the planted tree: ${JSON.stringify(reportOf(ran))}`);
  none(listFailures(ran, roomy, here), `${AC[5]} the report lists each set's bytes, its ceiling and its share of the 12 MB limit`);
});
