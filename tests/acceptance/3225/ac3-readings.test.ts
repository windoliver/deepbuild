import { describe, it } from 'vitest';
import { CHAIR_15, CHAIR_90, CRATES_APART, CRATES_NEAR, RUG_INSIDE, RUG_OUT, chairsDoc, cratesDoc, rugDoc } from './fixtures.ts';
import {
  TIMEOUT, claimId, claimOf, docId, none, presented, relations, reqId, run, scenarioOf, show, showBin, useFolders, verdict,
  type Requirement,
} from './helpers.ts';
import { holdsFailures, missedFailures, rowOf, type Expected } from './judges.ts';

const ID = 'AC3 #3225.288ab799';
const folder = useFolders();
const [CHAIRS, RUG, CRATES] = [docId(1), docId(2), docId(3)];
const one = (id: string, e: Expected): Requirement => ({ id, check: relations([e]) });
const claims = {
  [claimId(1)]: claimOf(CHAIRS, [one(reqId(1), CHAIR_90), one(reqId(2), CHAIR_15)]),
  [claimId(2)]: claimOf(RUG, [one(reqId(3), RUG_INSIDE)]),
  [claimId(3)]: claimOf(CRATES, [one(reqId(4), CRATES_APART), one(reqId(5), CRATES_NEAR)]),
};
const FACING_MISS_DEG = 70;
const APART_MISS_M = 0.2;

describe(`${ID} facing, inside, apart and near read from where the items stand`, () => {
  it(`${ID} a chair turned 90° from the table's centre reads facing missed by 70° within 1e-9° and one turned 15° reads held; the rug with one corner 0.3 m outside the room reads inside missed by 0.3 m; two crates 0.3 m apart read apart with d 0.5 missed by 0.2 m and near with d 0.5 held`, () => {
    const calls = [show(CHAIRS, chairsDoc()), show(RUG, rugDoc()), show(CRATES, cratesDoc()), verdict(claimId(1)), verdict(claimId(2)), verdict(claimId(3))];
    const [shownChairs, shownRug, shownCrates, chairs, rug, crates] = run(showBin(), scenarioOf(folder(), [CHAIRS, RUG, CRATES], claims, calls));
    presented(shownChairs!, 'the turned chairs');
    presented(shownRug!, 'the rug across the wall');
    presented(shownCrates!, 'the crates');

    none(
      missedFailures(rowOf(chairs!, reqId(1)), CHAIR_90, { deg: { near: FACING_MISS_DEG, within: 1e-9 } }, 'the chair turned 90° from the table\'s centre'),
      'a chair turned 90° from the table\'s centre reads facing missed by 70° within 1e-9°',
    );
    none(holdsFailures(rowOf(chairs!, reqId(2)), CHAIR_15, 'the chair turned 15° from the table\'s centre'), 'a chair turned 15° reads facing held');
    none(
      missedFailures(rowOf(rug!, reqId(3)), RUG_INSIDE, { m: { near: RUG_OUT, within: 1e-9 } }, 'the rug with one corner 0.3 m outside the room'),
      'the rug with one corner 0.3 m outside the room reads inside missed by 0.3 m',
    );
    none(
      missedFailures(rowOf(crates!, reqId(4)), CRATES_APART, { m: { near: APART_MISS_M, within: 1e-9 } }, 'the crates whose bounds are 0.3 m apart'),
      'two crates whose bounds are 0.3 m apart read apart with d 0.5 missed by 0.2 m',
    );
    none(holdsFailures(rowOf(crates!, reqId(5)), CRATES_NEAR, 'the crates whose bounds are 0.3 m apart'), 'the same crates read near with d 0.5 held');
  }, TIMEOUT);
});
