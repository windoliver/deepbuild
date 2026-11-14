// AC1 (amended Nov 14): "`deep_kinds read guide: patches` returns every op the patch schema lists, each with an example.
// Each example applies through `deep-show run` with outcome `applied`: `break_out`'s to #306's chart board
// (`tests/acceptance/306/fixtures/chart-board.json`, with its test pack `test/chart@1.0.0` installed), and every other
// op's to the gallery's product reveal; a planted guide missing `reorder` fails, naming it."
//
// asserts: the patch schema's ops are read from `deep_kinds op: field` (path `patch`, then `patch.<op>`, which the
// issue's scope says answer from the same schema), and must hold the six the issue's parent names. The guide, read in
// pages through `deep_kinds {op: read, guide: patches}`, holds a patch (an envelope with `ops`) for every one of them.
// For every op, one of the guide's patches holding it applies with outcome `applied`, sent as you through `deep-show
// run` to a fresh copy of its target, stored under the doc ID the patch names, at revision 0: for break_out, #306's
// chart board read from its fixture file, with test/chart@1.0.0 installed from #306's pack folder in the scenario's
// `packs`; for every other op, the gallery's product reveal (read through deep_kinds), with no pack. The planted guide
// `patches_guide_without_reorder` fails the first check, naming reorder and only reorder, while `op: field` on the
// same build still lists reorder.

import { describe, expect, it } from 'vitest';
import {
  BREAK_OUT, GUIDE, PLANTS, applyEach, appliedFailures, chartBoardTarget, exampleFailures, failsNaming, guideText, none, opsOf, outcomeOf, patchesIn,
  revealTarget, schemaOps, show, useCleanup, useFullBuild,
} from './helpers.ts';

const bin = useFullBuild();
useCleanup();

describe('AC1 the patches guide: every op the patch schema lists, each with an example that applies', () => {
  it(`AC1 deep_kinds read guide: ${GUIDE} returns every op the patch schema lists, each with an example`, () => {
    const b = bin();
    const schema = schemaOps(b);
    console.log(`the patch schema's ops, by deep_kinds op: field: ${schema.ops.join(', ') || 'none'}`);
    expect.soft(schema.failures, `the patch schema's ops, read through deep_kinds op: field:\n  ${schema.failures.join('\n  ')}`).toEqual([]);
    const guide = guideText(b);
    expect.soft(guide.failure, `deep_kinds read guide: ${GUIDE}`).toBeUndefined();
    const patches = patchesIn(guide.text);
    console.log(`the guide holds ${patches.length} patch(es): ${patches.map((p) => opsOf(p).join('+')).join(', ')}`);
    none(exampleFailures(schema.ops, patches), `every op the patch schema lists has an example in the ${GUIDE} guide`);
  }, 3_600_000);

  it('AC1 each example applies through deep-show run with outcome applied: break_out\'s to #306\'s chart board with test/chart@1.0.0 installed, every other op\'s to the gallery\'s product reveal', () => {
    const b = bin();
    const schema = schemaOps(b);
    expect.soft(schema.failures, `the patch schema's ops, read through deep_kinds op: field:\n  ${schema.failures.join('\n  ')}`).toEqual([]);
    const guide = guideText(b);
    expect.soft(guide.failure, `deep_kinds read guide: ${GUIDE}`).toBeUndefined();
    const patches = patchesIn(guide.text);
    const reveal = revealTarget(b);
    const board = chartBoardTarget();
    // A patch is sent to each target one of its ops is held to: the board for break_out, the reveal for any other op.
    const onReveal = applyEach(b, reveal, patches, (p) => opsOf(p).some((o) => o !== BREAK_OUT));
    const onBoard = applyEach(b, board, patches, (p) => opsOf(p).includes(BREAK_OUT));
    patches.forEach((p, i) => console.log(`${opsOf(p).join('+')}: on the product reveal ${outcomeOf(onReveal[i]!)}; on the chart board ${outcomeOf(onBoard[i]!)}`));
    expect(patches.length, `the ${GUIDE} guide holds at least one patch to apply: ${show(guide.text, 600)}`).toBeGreaterThan(0);
    none(appliedFailures(schema.ops, patches, { target: reveal, outcomes: onReveal }, { target: board, outcomes: onBoard }), 'every op\'s example applies to its document with outcome applied');
  }, 3_600_000);

  it(`AC1 a planted guide missing reorder (${PLANTS.guideWithoutReorder}) fails, naming it`, () => {
    const b = bin();
    const schema = schemaOps(b, PLANTS.guideWithoutReorder);
    expect(schema.ops, `the plant changes only the guide: op: field still lists reorder (${show(schema.answer, 600)})`).toContain('reorder');
    const guide = guideText(b, PLANTS.guideWithoutReorder);
    expect(guide.failure, `the planted build still serves the ${GUIDE} guide`).toBeUndefined();
    const failures = exampleFailures(schema.ops, patchesIn(guide.text));
    failsNaming(failures, ['reorder'], `the planted guide ${PLANTS.guideWithoutReorder}`);
    expect(failures.filter((f) => !f.includes('reorder')), 'the plant leaves out reorder alone: no other op fails').toEqual([]);
  }, 3_600_000);
});
