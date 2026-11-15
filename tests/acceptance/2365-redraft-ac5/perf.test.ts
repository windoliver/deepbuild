// #2365 AC5, on #20's perf tasks and on the transcripts of #20's budgets: for every one, archived as its task or
// budget archives it, the parts joined are byte-identical to the one copy the merge base's own archive stores of the
// finished file, and a second pass over the unchanged transcript reads none of it. The perf tasks' transcripts come
// from the merge base's benchmarks/archive.mjs (archive-live, archive-month, archive-backlog); the budgets' from
// #20's generate.ts. The 1 GB backlog and the heavy month run in batches, each in a world of its own that the runner
// removes after it, so the disk holds one batch at a time. Byte identity and bytes read aren't timings: these run, and count, on any machine.
import { afterAll, describe, expect, it } from 'vitest';
import { removeTemps } from '../20/helpers.ts';
import { AC5, BUDGET_LIVE, budgetBacklog, budgetMonthDay, PERF, problemsOf, runScenario, type Scenario } from './scenarios.ts';

afterAll(removeTemps);

async function judged(s: Scenario): Promise<void> {
  const run = await runScenario(s);
  console.log(`${run.scenario}: ${run.seen.length} transcripts, ${run.seen.reduce((n, t) => n + t.size, 0)} bytes; read on the unchanged pass: ${run.seen.reduce((n, t) => n + t.read, 0)} bytes`);
  expect(run.seen.length, `${s.name}: the scenario left its transcripts`).toBeGreaterThan(0);
  expect(problemsOf(run), `${s.name}: against the merge base ${run.base.sha.slice(0, 12)}`).toEqual([]);
}

describe(`AC5 ${AC5} for every transcript of #20's perf tasks, the parts joined equal the merge base's one copy, and an unchanged transcript's second pass reads none of it`, () => {
  for (const s of PERF) it(`AC5 ${s.name}`, () => judged(s), 1_800_000);
});

describe(`AC5 ${AC5} for every transcript of #20's budgets (its suite's budgets.test.ts), the same`, () => {
  it(`AC5 ${BUDGET_LIVE.name}`, () => judged(BUDGET_LIVE), 1_800_000);
  it('AC5 #20 AC7 (budgets.test.ts): the heavy month, both days, 20 sessions a day at half and whole', async () => {
    for (const day of [0, 1]) await judged(budgetMonthDay(day));
  }, 3_600_000);
  it('AC5 #20 AC7 (budgets.test.ts): the 1 GB backlog, 200 sessions of 5 MB, in batches of 20', async () => {
    for (let from = 0; from < 200; from += 20) await judged(budgetBacklog(from, from + 20));
  }, 7_200_000);
});
