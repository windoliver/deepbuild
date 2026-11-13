// #1802.b515e798: "With the stale file deleted, removing the method again fails as a break with no file, naming the
// method. A planted tree that keeps the stale file passes the same removal, and the test that expects the failure
// catches it"
//
// asserts: the scene of criterion 8: R1 recorded with the stable method deep.gone, the fixture release R2 that removed
// it with contracts/breaks/R1_R2/1802.txt quoting the removal, and deep.gone restored, so the step fails naming that
// file. With the file deleted the step passes. deep.gone is then removed again: the step fails, and a FAIL line names
// deep.gone as a break with no break file, as it does for any unreviewed removal (#139). In the planted tree the stale
// file is kept: the same removal passes, since the kept file quotes it, and this criterion's check fails on that tree,
// naming deep.gone.
// Wrong programs: `tree-keeps-stale-file`, the planted tree; the merge base, whose step never calls the file stale.

import { rmSync } from 'node:fs';
import { it } from 'vitest';
import { GONE, GONE_FILE, at, check, expectFailNaming, expectPass, failLines, failsNaming, none, removeApi, restoredTree, shown, type Tree } from './helpers.ts';

/**
 * The scene up to the second removal. With deep.gone restored the step calls the break file stale; the file is then
 * deleted, and the step passes, unless `keepStaleFile`, the planted tree; then deep.gone is removed again.
 */
function removedAgain(keepStaleFile: boolean): Tree {
  const t = restoredTree();
  expectFailNaming(check(t, 'R2'), 'with deep.gone restored, the break file that quotes its removal is stale', GONE_FILE);
  if (!keepStaleFile) {
    rmSync(at(t, GONE_FILE));
    expectPass(check(t, 'R2'), 'with the stale file deleted and deep.gone restored');
  }
  removeApi(t, GONE);
  return t;
}
/** The criterion's check on a tree in which deep.gone was removed again: the step fails it as a break with no file, naming the method. */
function removedAgainFailures(t: Tree): string[] {
  const r = check(t, 'R2');
  const named = r.code === 1 && failLines(r).some((l) => l.includes(GONE) && l.includes('no break file'));
  return named ? [] : [`removing ${GONE} again doesn't fail as a break with no break file, naming ${GONE}: ${shown(r)}`];
}

it('#1802.b515e798 with the stale file deleted, removing the method again fails as a break with no file, naming the method', () => {
  none(removedAgainFailures(removedAgain(false)), 'deep.gone removed again, the stale file deleted');
}, 300_000);

it('#1802.b515e798 a planted tree that keeps the stale file passes the same removal, and the check that expects the failure catches it', () => {
  none(removedAgainFailures(removedAgain(false)), 'the tree with the stale file deleted, held to the same check first');
  const planted = removedAgain(true);
  expectPass(check(planted, 'R2'), 'the planted tree: the kept file quotes the removal, so the same removal passes');
  failsNaming(removedAgainFailures(planted), [GONE], 'a tree that keeps the stale file');
}, 300_000);
