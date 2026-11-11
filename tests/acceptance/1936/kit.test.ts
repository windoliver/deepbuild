// #1936.188aa3d2: "A kit piece 0.05 m off the grid fails, naming the item, with a snap as the fix. A kit room with
// one wall moved 2 mm fails `seams`, naming a 0.002 m gap and both items; its fix applied passes. A planted audit
// that checks only overlaps passes the moved wall and fails this test"
//
// Fixtures (helpers.ts `kitRoom`): stored scenes in the working agent alpha's layer, each a kit room open at the
// front: a floor and three walls standing on it, wall-back, wall-left and wall-right, each a 4 × 2 m `plate@1`
// sheet, listed in the collection `kit`. With wall-right's origin at x = 2 every origin is on whole metres, every
// yaw is 0, 90 or −90, and each side wall's back edge lies on an end edge of the back wall. The fixtures slide
// wall-right along the floor, away from the back wall's end:
//   - to x = 2.05: its origin is 0.05 m off the grid, and 0.05 m from the back wall, too far to be a seam;
//   - to x = 2.002: every edge of it within 0.01 m of an edge of wall-back is 0.002 m from it, twice `max_gap`.
// Either way it still stands on the floor, which runs 1 m past every wall, and it passes into nothing: it moves
// away from the one wall it touched, and a sheet that meets another along an edge is 0 m deep in it.
//
// asserts: each document is the one deliverable of a claim of alpha's with one `geometry.audit` requirement,
// judged with `verdict`:
//   - the piece 0.05 m off the grid, under `grid: {unit: 1, sub: 0.5, items: kit}`: FAIL, and its errors and
//     warnings are exactly one, an error `geometry.off_grid` naming wall-right; its `fix` is patch ops, each a `set`
//     at wall-right's `at`; the fix, sent by alpha as a patch in a second run, is applied, and the verdict after it
//     is PASS with nothing raised;
//   - the wall moved 2 mm, under `seams: {pairs: [[kit, kit]]}`: FAIL, with at least one error, and every error
//     and warning is `geometry.seam` naming wall-back and wall-right with `gap` 0.002 m (within 0.00001 m); the
//     first one's `fix` is patch ops, each a `set` at the `at` of one of the two; the fix, sent as a patch in a
//     second run, is applied, and the verdict after it is PASS with nothing raised;
//   - the planted `audit_checks_overlaps_only`: the same claim on the wall moved 2 mm is PASS, with nothing raised.
// Wrong programs: the base, which reads neither `grid` nor `seams` and passes both rooms; the planted audit that
// checks only overlaps, which passes the moved wall; a fix as text, or one that removes an item; a seam's fix that
// moves the back wall, which opens its seam with wall-left; a gap read as anything but the distance between the
// edges.
import { describe, expect, it } from 'vitest';
import {
  GRID_CHECK, MOVED, OFF_GRID, OVERLAPS_ONLY, SEAM, SEAMS_CHECK, SEAM_PAIR, TIMEOUT, achieved, brief, claimId, claimOf, docId, exactFaultFailures, fixOps,
  gapFailures, kitRoom, movesFailures, none, passFailures, patch, raised, reqId, rowOf, run, scenarioOf, useBuild, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1936.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1936.188aa3d2';
const bin = useBuild();
const folder = useFolders();

describe(`${ID} a kit piece off its grid and a kit room whose seam doesn't meet`, () => {
  it(`${ID} a kit piece 0.05 m off the grid fails, naming the item, with a snap as its fix, and the snap applied passes`, () => {
    const [doc, claim, req] = [docId(1), claimId(1), reqId(1)];
    const claims = { [claim]: claimOf(doc, req, GRID_CHECK) };
    const room = { [doc]: kitRoom(2.05) };
    const [off] = run(bin(), scenarioOf(folder(), room, claims, [verdict(claim)]));
    const row = rowOf(off!, req, 'the kit room with a piece off the grid');
    none(exactFaultFailures(row, [[OFF_GRID, [MOVED]]], 'the scene audit of the kit piece 0.05 m off the grid'), 'the kit piece 0.05 m off the grid fails, naming the item');
    const failure = raised(row)[0]!;
    const ops = fixOps(failure);
    expect(ops, `the off-grid failure's fix is patch ops: ${brief(failure.raw['fix'])}`).not.toBeNull();
    none(movesFailures(ops!, [MOVED], "the off-grid failure's fix"), 'the fix is a snap of the item it names');

    // The snap as the audit named it, through the product's own patch path, on the same stored document.
    const [patched, after] = run(bin(), scenarioOf(folder(), room, claims, [patch(doc, ops!), verdict(claim)]));
    achieved(patched!, "the off-grid failure's fix, sent as a patch");
    none(passFailures(rowOf(after!, req, 'the kit room after the snap'), 'the scene audit after the snap'), 'the snap applied puts the piece on the grid');
  }, TIMEOUT);

  it(`${ID} a kit room with one wall moved 2 mm fails seams, naming a 0.002 m gap and both items; its fix applied passes; the planted audit that checks only overlaps passes the moved wall`, () => {
    const [doc, claim, req] = [docId(1), claimId(1), reqId(1)];
    const claims = { [claim]: claimOf(doc, req, SEAMS_CHECK) };
    const room = { [doc]: kitRoom(2.002) };
    const [moved] = run(bin(), scenarioOf(folder(), room, claims, [verdict(claim)]));
    const row = rowOf(moved!, req, 'the kit room with one wall moved 2 mm');
    none(gapFailures(row, SEAM, SEAM_PAIR, 0.002, 'the scene audit of the kit room with one wall moved 2 mm'), 'the wall moved 2 mm fails seams, naming a 0.002 m gap and both items');
    const failure = raised(row)[0]!;
    const ops = fixOps(failure);
    expect(ops, `the seam failure's fix is patch ops: ${brief(failure.raw['fix'])}`).not.toBeNull();
    none(movesFailures(ops!, SEAM_PAIR, "the seam failure's fix"), 'the fix is a move of one of the two items');

    // The move as the audit named it, through the product's own patch path, on the same stored document.
    const [patched, after] = run(bin(), scenarioOf(folder(), room, claims, [patch(doc, ops!), verdict(claim)]));
    achieved(patched!, "the seam failure's fix, sent as a patch");
    none(passFailures(rowOf(after!, req, 'the kit room after the move'), 'the scene audit after the move'), "the seam failure's fix applied passes");

    // The wrong program the criterion names: it passes the moved wall, so the assertion on `seams` above fails on it.
    const [planted] = run(bin(), scenarioOf(folder(), room, claims, [verdict(claim)], OVERLAPS_ONLY));
    none(passFailures(rowOf(planted!, req, 'the moved wall under the planted audit'), 'the planted audit that checks only overlaps, on the wall moved 2 mm'), 'the planted audit that checks only overlaps passes the moved wall');
  }, TIMEOUT);
});
