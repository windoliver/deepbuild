// #12 AC5: the local preflight fails a change whose p50 is more than 50% above the merge base's, with 20 samples on
// each side; p95 is reported, not gated. Where a budget's value is an estimate, a measurement made before the change it
// judges may move it once, with the reason recorded.
//
// The fixture's benchmarks/budgets.json holds Node programs as tasks, judged by the perf lane against the merge base:
//   regressed   the change makes every run 700 ms slower, so its p50 rises far past 50%
//   tail        the change makes two runs in each twenty 1 s slower, so its p95 rises and its p50 doesn't
//   estimated   an estimated peak-memory limit, which the change moves once, recording the reason in changeReason, the
//               field benchmarks/budgets.json already gives a moved budget (its preflight entry)
// Under load a reading can hide what was planted; then the test says INCONCLUSIVE, never PASS or FAIL.
// The second test is the wrong case of the move: a second move, and a move with no reason, are refused.
import { afterAll, expect, it } from 'vitest';
import {
  AC5, MINUTE, benchProgram, benchRuns, benchTask, declaredPreflightBudget, fixture, makeBox, needNode, preflight, reading, refusals, removeBoxes, shown, sideOf, taskReports,
} from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

const MB = 1_000_000;
const ESTIMATE = 'An estimate, not yet measured: the design gives no figure for this program, so the limit is a guess until it is measured on the merge base.';

it(`${AC5} the local preflight fails a p50 more than 50% above the merge base's from 20 samples a side, reports p95 without gating it, and lets an estimated budget move once with its reason`, () => {
  needNode(AC5);
  const box = makeBox('ac5');
  const preflightBudget = declaredPreflightBudget();
  fixture(box, {
    budgets: {
      base: { preflight: preflightBudget, tasks: [benchTask('regressed'), benchTask('tail'), benchTask('estimated', { limits: { peakBytes: 400 * MB }, initialReason: ESTIMATE })] },
      change: {
        preflight: preflightBudget,
        tasks: [benchTask('regressed'), benchTask('tail'), benchTask('estimated', {
          limits: { peakBytes: 600 * MB }, initialReason: ESTIMATE,
          changeReason: 'Moved once, from 400 MB to 600 MB: measured on the merge base before this change, the program peaked near 50 MB under the load this machine runs at, and the estimate left too little room for a busier Node.',
        })],
      },
    },
    base: { 'bench/regressed.mjs': benchProgram('regressed'), 'bench/tail.mjs': benchProgram('tail'), 'bench/estimated.mjs': benchProgram('estimated') },
    change: { 'bench/regressed.mjs': benchProgram('regressed', 700), 'bench/tail.mjs': benchProgram('tail', 1000, 10) },
  });
  const ran = preflight(box, 12 * MINUTE);

  // The estimate moved once with its reason: perf judges the task, and nothing refuses the move.
  expect(refusals(ran.out, 'estimated'), `${AC5} an estimated budget moved once, with its reason recorded, is not refused: ${shown(ran)}`).toEqual([]);
  expect(taskReports(ran.out, 'estimated').length, `${AC5} the moved budget's task is judged: ${shown(ran)}`).toBeGreaterThan(0);

  // 20 samples a side: each task ran at least 20 times in the change and in its merge base's copy.
  for (const id of ['regressed', 'tail']) {
    const sides = [...benchRuns(box, id).values()].filter((runs) => runs >= 20);
    expect(sides.length, `${AC5} ${id} ran at least 20 times on each side, the change and its merge base: ${JSON.stringify([...benchRuns(box, id)])}; ${shown(ran)}`).toBeGreaterThanOrEqual(2);
  }

  // p50 more than 50% above the merge base's fails.
  const [regressed] = taskReports(ran.out, 'regressed');
  const now = reading(sideOf(regressed ?? {}, 'change'), /p50/i), then = reading(sideOf(regressed ?? {}, 'base'), /p50/i);
  expect(now !== undefined && then !== undefined, `${AC5} the regressed task's report gives the p50 of the change and of the merge base: ${shown(ran)}`).toBe(true);
  if (!(now! > then! * 1.5)) throw new Error(`INCONCLUSIVE ${AC5}: the planted 700 ms slowdown read p50 ${now} ms against the merge base's ${then} ms, not above 50%, so the machine's load hid it; run again on a quieter machine`);
  expect(refusals(ran.out, 'regressed').filter((line) => /^FAIL\b/.test(line) && /p50/i.test(line)), `${AC5} a p50 ${now} ms against the merge base's ${then} ms (more than 50% above) fails, naming p50: ${shown(ran)}`).not.toEqual([]);

  // p95 is reported, not gated.
  const [tail] = taskReports(ran.out, 'tail');
  const tailNow = { p50: reading(sideOf(tail ?? {}, 'change'), /p50/i), p95: reading(sideOf(tail ?? {}, 'change'), /p95/i) };
  const tailThen = { p50: reading(sideOf(tail ?? {}, 'base'), /p50/i), p95: reading(sideOf(tail ?? {}, 'base'), /p95/i) };
  expect(tailNow.p95 !== undefined && tailThen.p95 !== undefined, `${AC5} the tail task's report gives the p95 of the change and of the merge base: ${shown(ran)}`).toBe(true);
  if (!(tailNow.p95! > tailThen.p95! * 1.5) || !(tailNow.p50! <= tailThen.p50! * 1.5)) throw new Error(`INCONCLUSIVE ${AC5}: the planted tail read p95 ${tailNow.p95} ms against ${tailThen.p95} ms and p50 ${tailNow.p50} ms against ${tailThen.p50} ms, so the load hid a rise in p95 alone; run again on a quieter machine`);
  expect(refusals(ran.out, 'tail'), `${AC5} a p95 ${tailNow.p95} ms against the merge base's ${tailThen.p95} ms, with p50 within 50%, fails nothing: ${shown(ran)}`).toEqual([]);

  expect(ran.status, `${AC5} the local preflight exits non-zero for the regressed p50: ${shown(ran)}`).not.toBe(0);
}, 15 * MINUTE);

it(`${AC5} an estimated budget moves only once and only with its reason: a second move, or a move with no reason, is refused`, () => {
  needNode(AC5);
  const preflightBudget = declaredPreflightBudget();
  const cases = [
    {
      id: 'moved-twice',
      base: benchTask('moved-twice', { limits: { peakBytes: 600 * MB }, initialReason: ESTIMATE, changeReason: 'Moved once, from 400 MB to 600 MB, by a measurement on the merge base before the change it judged.' }),
      change: benchTask('moved-twice', { limits: { peakBytes: 800 * MB }, initialReason: ESTIMATE, changeReason: 'Moved again, from 600 MB to 800 MB.' }),
    },
    {
      id: 'no-reason',
      base: benchTask('no-reason', { limits: { peakBytes: 400 * MB }, initialReason: ESTIMATE }),
      change: benchTask('no-reason', { limits: { peakBytes: 600 * MB }, initialReason: ESTIMATE }),
    },
  ];
  for (const { id, base, change } of cases) {
    const box = makeBox(`ac5-${id}`);
    fixture(box, {
      budgets: { base: { preflight: preflightBudget, tasks: [base] }, change: { preflight: preflightBudget, tasks: [change] } },
      base: { [`bench/${id}.mjs`]: benchProgram(id) },
    });
    const ran = preflight(box, 10 * MINUTE);
    expect(refusals(ran.out, id), `${AC5} the ${id === 'no-reason' ? 'move with no reason recorded' : 'second move'} of an estimated budget is refused, naming ${id}: ${shown(ran)}`).not.toEqual([]);
    expect(ran.status, `${AC5} the local preflight exits non-zero when it refuses a budget's move: ${shown(ran)}`).not.toBe(0);
  }
}, 15 * MINUTE);
