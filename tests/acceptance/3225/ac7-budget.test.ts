import { describe, expect, it } from 'vitest';
import { BUDGET, budgetDoc, budgetRelations } from './fixtures.ts';
import {
  TIMEOUT, claimId, claimOf, docId, inconclusive, judgeLimit, load, none, presented, relations, releaseBin, reqId, run, scenarioOf,
  show, showBin, useFolders, verdict,
} from './helpers.ts';
import { brief, heldFailures, rowOf, timingOf } from './judges.ts';

const ID = 'AC7 #3225.ecf55c06';
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const EXPECTED = budgetRelations();
const claims = { [CLAIM]: claimOf(DOC, [{ id: REQ, check: relations(EXPECTED) }]) };
const RUNS = 5;
const WHAT = `${BUDGET.relations} relations over the ${BUDGET.items}-item scene`;

function reading(binary: string): number {
  const [shown, judged] = run(binary, scenarioOf(folder(), [DOC], claims, [show(DOC, budgetDoc()), verdict(CLAIM)]));
  presented(shown!, `the ${BUDGET.items}-item scene`);
  const row = rowOf(judged!, REQ);
  none(heldFailures(row, EXPECTED, WHAT), `${WHAT} read, each one held`);
  const ms = timingOf(row, 'check_ms');
  expect(ms, `the row reports its own time, timing.check_ms: ${brief(row?.raw['timing'] ?? null)}`).not.toBeNull();
  return ms!;
}

describe(`${ID} scene.relations' budget on the reference Mac`, () => {
  it(`${ID} 64 relations over a 1,000-item scene read in under 5 ms, on the reference Mac`, async () => {
    expect(EXPECTED.length, 'the check reads 64 relations').toBe(BUDGET.relations);
    reading(showBin());
    const now = (): { start: number; end: number }[] => Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const gate = await judgeLimit(BUDGET.ms, Array.from({ length: RUNS }, () => 0), now());
    if (gate['status'] !== 'PASS') inconclusive(`the timing: this machine can't judge it now: ${String(gate['reason'])}`);

    const built = releaseBin(folder());
    expect(built.error, 'deep-show builds in release').toBe('');
    reading(built.bin);
    const times: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) {
      const start = load();
      times.push(reading(built.bin));
      loads.push({ start, end: load() });
    }
    const judged = await judgeLimit(BUDGET.ms, times, loads);
    console.log(`${ID} ${WHAT}, check_ms per run: ${times.map((x) => x.toFixed(3)).join(', ')} → ${String(judged['status'])}`);
    expect(judged['status'], `${WHAT} against ${BUDGET.ms} ms: ${JSON.stringify(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`${WHAT}: ${JSON.stringify(judged)}`);
  }, 4 * TIMEOUT);
});
