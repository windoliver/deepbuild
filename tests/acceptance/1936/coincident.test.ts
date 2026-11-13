// #1936.ce1f055b: "A wall that the same patch added twice fails the scene audit as coincident, naming both IDs, with
// a fix that removes one, and the overlap pass doesn't report the pair; applying the fix leaves one wall that passes,
// and the same pair 1 mm apart is never coincident"
//
// Fixtures (helpers.ts `wallTwice`): stored scenes in the working agent alpha's layer, each a floor and one wall, a
// 4 × 2 × 0.2 m `mark.box@1` standing on it, held under two IDs, `wall` and `wall-again`, with the same kind, params
// and `at`, as a patch that adds the wall twice leaves them. In the first document the two are in one place: every
// corner of one is on the same corner of the other, and each is 0.2 m deep in the other, so an overlap pass that
// ran on the pair would report it. In the second, `wall-again` is 0.001 m along +x: every corner 1 mm from its
// twin's, ten times the 0.1 mm the design allows a coincident pair.
//
// asserts: each document is the one deliverable of its own claim of alpha's, whose one requirement is the check
// `{kind: geometry.audit, scope: scene, support: {floating: [floor]}}`, judged with `verdict`:
//   - the wall added twice: FAIL, and its errors and warnings are exactly one, an error `geometry.coincident` naming
//     wall and wall-again, so no `geometry.overlap` on the pair and nothing else;
//   - that failure's `fix` is patch ops, each a `delete` of wall or of wall-again, one of the two deleted in all:
//     no op that moves anything;
//   - the same pair 1 mm apart: the row is decided (PASS or FAIL) and holds no `geometry.coincident` issue;
//   - the fix, sent by alpha as a patch of the same stored document in a second run, is applied and achieves one
//     item deleted, none updated and none created; the verdict after it is PASS with nothing raised.
// Wrong programs: the base, which reports the pair as an overlap and has no coincident pass; a coincident pass
// after the overlap pass (both are reported); a fix as text or as a move; a pass that calls the 1 mm pair
// coincident; a fix whose ops the product's own patch path refuses, or that leaves a fault behind.
import { describe, expect, it } from 'vitest';
import {
  COINCIDENT, TIMEOUT, WALLS, WALL_CHECK, achieved, brief, claimId, claimOf, docId, exactFaultFailures, fixOps, none, passFailures, patch, raised,
  removesOneFailures, reqId, rowOf, run, scenarioOf, useBuild, useFolders, verdict, wallTwice,
} from './helpers.ts';

/** The criterion's ID: `#1936.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1936.ce1f055b';
const bin = useBuild();
const folder = useFolders();

describe(`${ID} a wall added twice is coincident, and its fix removes one`, () => {
  it(`${ID} the wall added twice fails as coincident naming both IDs, with a fix that removes one, and the overlap pass doesn't report the pair; the fix applied leaves one wall that passes; the same pair 1 mm apart is never coincident`, () => {
    const [twice, apart] = [docId(1), docId(2)];
    const onTwice = { [claimId(1)]: claimOf(twice, reqId(1), WALL_CHECK) };
    const claims = { ...onTwice, [claimId(2)]: claimOf(apart, reqId(2), WALL_CHECK) };
    const [first, second] = run(bin(), scenarioOf(folder(), { [twice]: wallTwice(0), [apart]: wallTwice(0.001) }, claims, [verdict(claimId(1)), verdict(claimId(2))]));

    const row = rowOf(first!, reqId(1), 'the wall added twice');
    none(exactFaultFailures(row, [[COINCIDENT, WALLS]], 'the scene audit of the wall added twice'), "the wall added twice fails as coincident, naming both IDs, and the overlap pass doesn't report the pair");
    const failure = raised(row)[0]!;
    const ops = fixOps(failure);
    expect(ops, `the coincident failure's fix is patch ops: ${brief(failure.raw['fix'])}`).not.toBeNull();
    none(removesOneFailures(ops!, WALLS, "the coincident failure's fix"), 'the fix removes one of the two walls, never a move');

    const rowApart = rowOf(second!, reqId(2), 'the same pair 1 mm apart');
    expect(['PASS', 'FAIL'], `the scene audit of the same pair 1 mm apart is decided: ${brief(rowApart.raw)}`).toContain(rowApart.result);
    expect(rowApart.issues.filter((i) => i.code === COINCIDENT).map((i) => brief(i.raw, 600)), 'the same pair 1 mm apart is never coincident').toEqual([]);

    // The fix as the audit named it, through the product's own patch path, on the same stored document.
    const [patched, after] = run(bin(), scenarioOf(folder(), { [twice]: wallTwice(0) }, onTwice, [patch(twice, ops!), verdict(claimId(1))]));
    expect(achieved(patched!, "the coincident failure's fix, sent as a patch"), 'the fix removes one item and moves none').toEqual({ created: 0, updated: 0, deleted: 1 });
    none(passFailures(rowOf(after!, reqId(1), 'the wall after its fix'), 'the scene audit after the fix'), 'the fix applied leaves one wall that passes');
  }, TIMEOUT);
});
