import { describe, expect, it } from 'vitest';
import { TIPPED_FACING, tippedDoc } from './fixtures.ts';
import {
  PLANTED, TIMEOUT, claimId, claimOf, docId, none, presented, relations, reqId, run, scenarioOf, show, showBin, useFolders, verdict,
} from './helpers.ts';
import { brief, rowOf, unknownFailures, type Row } from './judges.ts';

const ID = 'AC5 #3225.441d60b6';
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const claims = { [CLAIM]: claimOf(DOC, [{ id: REQ, check: relations([TIPPED_FACING]) }]) };
const WHAT = 'the chair tipped 30° on its back legs';

function judged(planted?: string): Row | null {
  const [shown, verdictOn] = run(showBin(), scenarioOf(folder(), [DOC], claims, [show(DOC, tippedDoc()), verdict(CLAIM)], planted));
  presented(shown!, WHAT);
  return rowOf(verdictOn!, REQ);
}

describe(`${ID} a relation that needs a tipped item's side faces reads unknown, and its requirement INCONCLUSIVE`, () => {
  it(`${ID} a chair tipped 30° on its back legs reads unknown for facing, and the requirement reads INCONCLUSIVE; a planted check that reads its bounds as if upright returns a number and fails, naming the chair`, () => {
    none(unknownFailures(judged(), TIPPED_FACING, WHAT), 'the tipped chair reads unknown for facing, and the requirement INCONCLUSIVE');

    const planted = judged(PLANTED.upright);
    const result = planted?.readings.find((r) => r.a === TIPPED_FACING.a && r.rel === TIPPED_FACING.rel && r.b === TIPPED_FACING.b);
    expect(result?.deg, `${PLANTED.upright} returns a number for the tipped chair's facing: ${brief(planted?.raw)}`).toBeTypeOf('number');
    const failures = unknownFailures(planted, TIPPED_FACING, WHAT);
    expect(failures, `${PLANTED.upright} fails this test`).not.toEqual([]);
    expect(failures.filter((f) => !f.includes(TIPPED_FACING.a)), `each failure names the chair: ${failures.join('; ')}`).toEqual([]);
  }, TIMEOUT);
});
