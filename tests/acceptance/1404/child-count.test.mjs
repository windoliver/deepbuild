// #1404 acceptance, first criterion: under a Node wrapper, a child that retires N instructions reads at
// least 95% of N in the budget's instructions. One test per way the budgets' benches start a child,
// each on a real child and the real counter, read by `measureOnce` as a budget's run is.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { benchmark, buildSpin, chained, counted, fileScope, macOnly, millions, plantBench, scratch, WRAPPER_COMMAND, wrappers } from './helpers.mjs';

// About 1,010 M: three times what the wrapper retires alone, so a reading of the wrapper can't reach 95%.
const ITERATIONS = 100_000_000;
const scope = fileScope();
let box, spin, N;

before(() => {
  if (process.platform !== 'darwin') return;
  box = scratch(scope);
  spin = buildSpin(box);
  N = counted([spin, String(ITERATIONS)], box);
});

async function reads(cwd) {
  macOnly();
  const { measureOnce } = await benchmark('measureOnce');
  const run = measureOnce(WRAPPER_COMMAND, cwd);
  // The wrapper exits 9 if its child's own answer didn't reach it: being counted must not change what a bench sees.
  assert.equal(run.status, 0, `the budget's command exited ${run.status}: ${run.output}`);
  assert.ok(run.instructions >= 0.95 * N, `the budget read ${millions(run.instructions)}; its child alone retires ${millions(N)}, so at least ${millions(0.95 * N)}`);
}

for (const [style, wrapper] of Object.entries(wrappers)) {
  test(`a child a Node wrapper starts with ${style} reads at least 95% of its instructions in the budget's`, async () => {
    macOnly();
    await reads(plantBench(join(box, style), spin, ITERATIONS, wrapper));
  });
}

test('a child of a Node child, waited for at each step, reads at least 95% of its instructions in the budget\'s', async () => {
  macOnly();
  await reads(plantBench(join(box, 'chained'), spin, ITERATIONS, chained, { 'wrap-inner.mjs': wrappers.spawnSync }));
});
