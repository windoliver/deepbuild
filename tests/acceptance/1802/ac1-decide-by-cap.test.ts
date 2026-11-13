// #1802.1c4f47ee: "A preview entry with no `decide_by`, or one more than 3 releases after its `preview_since`, fails the
// preflight, naming the entry"
//
// asserts: on a fixture tree whose one entry is deep.capped, a preview since R1 whose `decide_by` is R4 (3 releases
// after, the cap), the preflight's contract step passes. The same tree with deep.undated, a preview since R1 that
// records no `decide_by`, fails, and a FAIL line names deep.undated and none names deep.capped. The same tree with
// deep.late, a preview since R1 whose `decide_by` is R5 (4 releases after), fails, and a FAIL line names deep.late
// and none names deep.capped.
// Wrong program: the merge base, whose step reads neither field and passes all three trees.

import { expect, it } from 'vitest';
import { addApi, check, emptyTree, expectFailNaming, expectPass, failLines, previewEntry, type Tree } from './helpers.ts';

/** A tree whose one entry is deep.capped: a preview since R1, to be decided by R4, 3 releases after. It passes. */
function cappedTree(): Tree {
  const t = emptyTree('cap');
  addApi(t, previewEntry('deep.capped', { preview_since: 'R1', decide_by: 'R4' }));
  expectPass(check(t, 'R1'), 'deep.capped, a preview since R1 whose decide_by is R4, 3 releases after');
  return t;
}

it('#1802.1c4f47ee a preview entry with no decide_by fails the preflight, naming the entry', () => {
  const t = cappedTree();
  addApi(t, previewEntry('deep.undated', { preview_since: 'R1', decide_by: null }));
  const r = check(t, 'R1');
  expectFailNaming(r, 'deep.undated, a preview since R1 that records no decide_by', 'deep.undated');
  expect(failLines(r).filter((l) => l.includes('deep.capped')), 'the entry that records both, within the cap, is not failed').toEqual([]);
}, 120_000);

it('#1802.1c4f47ee a preview entry whose decide_by is 4 releases after its preview_since fails the preflight, naming the entry; one at 3 releases passes', () => {
  const t = cappedTree();
  addApi(t, previewEntry('deep.late', { preview_since: 'R1', decide_by: 'R5' }));
  const r = check(t, 'R1');
  expectFailNaming(r, 'deep.late, a preview since R1 whose decide_by is R5, 4 releases after', 'deep.late');
  expect(failLines(r).filter((l) => l.includes('deep.capped')), 'the entry at the cap, 3 releases after, is not failed').toEqual([]);
}, 120_000);
