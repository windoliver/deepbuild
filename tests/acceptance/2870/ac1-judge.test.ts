// #2870 AC1: "`canvas.mjs judge` gives `judgeLimit` each run's `{start: loadStart, end: loadEnd}`, for plain targets and
// floors alike, so a time target on a reference Mac at rest reads PASS or FAIL, not INCONCLUSIVE. A planted judge that
// drops the loads fails, naming the target"
//
// The issue's Proof: a judge run on a recorded efficiency report from a reference Mac at rest, before and after. Two
// recorded reports (reports/), a plain target's and a floor's, each judged in five cases (helpers.ts CASES): every run
// meeting the target (PASS), every run missing it by far more than the margin (FAIL), and three that stay INCONCLUSIVE
// because a run's own load is above the cores at its start, at its end, or is missing. In order:
//   1. This checkout's judge reads every case of both targets as the issue says.
//   2. The planted judge: this checkout's own judge, run from a scratch checkout beside a scripts/benchmark.mjs that
//      drops the loads (twins/drops-loads.mjs.txt). The same check catches it on each case at rest, naming the target.
import { expect, test } from 'vitest';
import { AC1, CASES, TARGETS, droppingLoads, misreadings, root } from './helpers.ts';

test(`${AC1} on recorded reports from a reference Mac at rest, canvas.mjs judge reads a plain target and a floor PASS when every run meets it and FAIL when every run misses it, and INCONCLUSIVE when a run's own load at its start or end is above the cores or missing; the same check fails a planted judge that drops the loads, naming each target`, () => {
  const found = misreadings(root);
  expect(found.map(({ line }) => line), "this checkout's canvas.mjs judge reads each case of each target as the issue says").toEqual([]);

  const planted = misreadings(droppingLoads());
  const atRest = TARGETS.flatMap(({ target }) => CASES.filter(({ want }) => want !== 'INCONCLUSIVE').map(({ name }) => `${target} (${name}): INCONCLUSIVE`));
  expect(planted.map(({ target, name, read }) => `${target} (${name}): ${read}`),
    `the planted judge that drops the loads reads each case at rest INCONCLUSIVE, and the check names its target:\n${planted.map(({ line }) => line).join('\n')}`).toEqual(atRest);
});
