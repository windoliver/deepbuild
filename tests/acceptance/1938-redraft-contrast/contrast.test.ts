// #1938.f19b61dd: "Each loop check fires on its planted fault with its code and a fix as patch ops, and its clean twin
// passes: a subject cut by the frame, clipped highlights, text under 4.5:1, two items passing into each other, an item
// floating 0.2 m above the floor, a 20 m door, a missing texture, a fill that reseeds each frame, and a scene over its
// class". This file holds one of the nine: text under 4.5:1, which render.contrast holds (`{text: wcag, min: 4.5}`).
//
// Fixtures (helpers.ts `captionBoard`): stored 640 × 360 boards in the working agent alpha's layer, no look named, so
// the shipped clean look draws them on its ground (#ffffff in its light theme). Each holds two lines of text in the
// look's body face at 20 u, regular weight: `title`, "Weekly checks" in ink (#1b1d22, 16.86:1), and below it `caption`,
// "Updated every hour".
//   - The planted fault: `caption` in muted (#8b8f97), 3.24:1 by WCAG 2's ratio: under 4.5:1, over 3:1.
//   - Its clean twin: the same board with `caption` in ink, 16.86:1. Nothing else differs.
//
// asserts: each board is the one deliverable of its own claim of alpha's, whose one requirement is
// `{kind: render.contrast}`, every field at its default, judged with `verdict`:
//   - the fault: the row FAILs, and every error and warning on it is an error of render.contrast (its `check`) with a
//     non-empty `code`, naming exactly `caption`, never `title`; the first one's fix is patch ops (`fix_ops`, else
//     `fix` as a list);
//   - the twin: the row PASSes with no error or warning;
//   - the fix, sent unchanged by alpha as a patch of the same stored fault board in a second run, is applied, and the
//     verdict after it PASSes with no error or warning;
//   - the planted `contrast_min_3` (render.contrast held to 3:1): the fault board's row PASSes, so the first assertion
//     fails on that program.
// Wrong programs: the base, where no module registers render.contrast and the row is BLOCKED `module_missing`; a
// check held to 3:1, WCAG's large-text minimum (`contrast_min_3`); a check that fails all text, or names the title; a
// fix as text, or ops that leave the caption under 4.5:1 or that the product's own patch path refuses.
import { describe, expect, it } from 'vitest';
import {
  CAPTION, CLEAR, MIN_3, TIMEOUT, UNDER, applied, brief, captionBoard, claimId, claimOf, decided, docId, faultFailures, fixOps,
  none, passFailures, patch, raised, reqId, rowOf, run, scenarioOf, useBuild, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1938.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1938.f19b61dd';
const bin = useBuild();
const folder = useFolders();

describe(`${ID} render.contrast: text under 4.5:1 and its clean twin`, () => {
  it(`${ID} text under 4.5:1 fails render.contrast with its code, naming the text, and a fix as patch ops that passes once applied; its clean twin passes; a check held to 3:1 misses it`, () => {
    const [fault, twin] = [docId(1), docId(2)];
    const onFault = { [claimId(1)]: claimOf(fault, reqId(1)) };
    const claims = { ...onFault, [claimId(2)]: claimOf(twin, reqId(2)) };
    const boards = { [fault]: captionBoard(UNDER), [twin]: captionBoard(CLEAR) };
    const [first, second] = run(bin(), scenarioOf(folder(), boards, claims, [verdict(claimId(1)), verdict(claimId(2))]));

    const row = rowOf(first!, reqId(1), 'the caption in muted');
    decided(row, 'render.contrast on the caption in muted');
    none(faultFailures(row, CAPTION, 'render.contrast on the caption in muted (3.24:1)'), 'text under 4.5:1 fails render.contrast with its code, naming the text and nothing else');
    const failure = raised(row)[0]!;
    const ops = fixOps(failure);
    expect(ops, `the failure's fix is patch ops: fix_ops ${brief(failure.raw['fix_ops'])}, fix ${brief(failure.raw['fix'])}`).not.toBeNull();

    const clean = rowOf(second!, reqId(2), 'the caption in ink');
    decided(clean, 'render.contrast on the caption in ink');
    none(passFailures(clean, 'render.contrast on the caption in ink (16.86:1)'), 'its clean twin passes');

    // The fix as the check named it, through the product's own patch path, on the same stored board.
    const [patched, after] = run(bin(), scenarioOf(folder(), { [fault]: captionBoard(UNDER) }, onFault, [patch(fault, ops!), verdict(claimId(1))]));
    applied(patched!, "the failure's fix, sent as a patch");
    none(passFailures(rowOf(after!, reqId(1), 'the caption after its fix'), 'render.contrast after the fix'), 'the fix applied passes');

    // The wrong program held to 3:1: it passes the caption at 3.24:1, so the fault assertion above fails on it.
    const [planted] = run(bin(), scenarioOf(folder(), { [fault]: captionBoard(UNDER) }, onFault, [verdict(claimId(1))], MIN_3));
    none(passFailures(rowOf(planted!, reqId(1), 'the caption in muted under contrast_min_3'), `render.contrast under ${MIN_3}`), 'a check held to 3:1 passes the caption at 3.24:1');
  }, TIMEOUT);
});
