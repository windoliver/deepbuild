import { describe, it } from 'vitest';
import { BOOKS, ON_SHELF, booksDoc, booksOnShelf } from './fixtures.ts';
import {
  TIMEOUT, claimId, claimOf, docId, none, presented, relations, reqId, run, scenarioOf, show, showBin, useFolders, verdict,
} from './helpers.ts';
import { countFailures, rowOf } from './judges.ts';

const ID = 'AC4 #3225.561aacf0';
const folder = useFolders();
const [DOC, CLAIM] = [docId(1), claimId(1)];
const [FOUR, RANGE] = [booksOnShelf(4), booksOnShelf([3, 5])];
const claims = { [CLAIM]: claimOf(DOC, [{ id: reqId(1), check: relations([FOUR]) }, { id: reqId(2), check: relations([RANGE]) }]) };
const READ = { members: BOOKS, holding: ON_SHELF, count: 3 } as const;

describe(`${ID} a collection reads one result per member and the count of those that hold`, () => {
  it(`${ID} three books on a shelf and a fourth on the floor read count 3 for on shelf; a requirement of 4 fails scene.relation_count, naming 3, and a requirement of [3, 5] passes`, () => {
    const [shown, judged] = run(showBin(), scenarioOf(folder(), [DOC], claims, [show(DOC, booksDoc()), verdict(CLAIM)]));
    presented(shown!, 'the books');
    none(countFailures(rowOf(judged!, reqId(1)), FOUR, { result: 'FAIL', ...READ }, 'books on shelf, required of 4'), 'a requirement of 4 fails scene.relation_count, naming 3');
    none(countFailures(rowOf(judged!, reqId(2)), RANGE, { result: 'PASS', ...READ }, 'books on shelf, required of [3, 5]'), 'a requirement of [3, 5] passes on a count of 3');
  }, TIMEOUT);
});
