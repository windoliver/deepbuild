// #1404 acceptance, fourth criterion: a host with no counter still reads INCONCLUSIVE, as it does today.
// These hold on the base by the issue's own words, so each is shown to fail on a named mutant instead
// (README: Tests that hold on the base). The first is the reading on data, and the judge on data runs
// from tests/acceptance/1404-redraft-1405/ under #1405's rule; the last is perf on a Node wrapper with a child, on a stand-in for a /usr/bin/time that reports no counter.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { benchmark, buildSpin, fileScope, macOnly, perfLane, reading, readsInconclusive, scratch } from './helpers.mjs';

// Recorded from this Mac's /usr/bin/time -l, trimmed; the same with its counter's two lines gone; and
// GNU time's report in the format the lane asks for on Linux, which has no counter at all.
const WITH_COUNTER = `        0.13 real         0.07 user         0.00 sys
             1589248  maximum resident set size
           914317498  instructions retired
           240155432  cycles elapsed
             1115272  peak memory footprint
`;
const WITHOUT_COUNTER = `        0.13 real         0.07 user         0.00 sys
             1589248  maximum resident set size
             1115272  peak memory footprint
`;
const GNU_TIME = 'peak_rss_kb=1552\ncpu_s=0.07 0.00\n';

test('a report with no counter reads as a missing count: null, never 0, beside a report that has one', async () => {
  const { parseInstructions } = await benchmark('parseInstructions');
  assert.equal(parseInstructions(WITH_COUNTER, 'darwin'), 914_317_498);
  assert.equal(parseInstructions(WITHOUT_COUNTER, 'darwin'), null);
  assert.equal(parseInstructions(GNU_TIME, 'linux'), null);
});

const scope = fileScope();
let lane;

before(() => {
  if (process.platform !== 'darwin') return;
  const box = scratch(scope);
  const spin = buildSpin(box);
  const wrapper = (iterations) => `import { spawnSync } from 'node:child_process';
const out = spawnSync(${JSON.stringify(spin)}, ['${iterations}'], { input: '', encoding: 'utf8' });
process.exit(out.status ?? 9);
`;
  lane = perfLane(scope, {
    noCounter: true,
    tasks: [{ id: 'no-counter', command: ['node', 'benchmarks/no-counter.mjs'], base: { 'benchmarks/no-counter.mjs': wrapper(10_000_000) }, current: { 'benchmarks/no-counter.mjs': wrapper(30_000_000) } }],
  });
});

test('perf on a host with no counter reads a budget with a child INCONCLUSIVE, naming it, with every count missing', (t) => {
  macOnly();
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
  readsInconclusive(lane, 'no-counter');
  const pairs = lane.line('no-counter')?.instructions?.pairs;
  assert.equal(pairs?.length, 20, reading(lane, 'no-counter'));
  for (const [round, pair] of pairs.entries()) assert.deepEqual([pair?.current, pair?.base], [null, null], `round ${round} records the missing count as null: ${JSON.stringify(pair)}`);
});
