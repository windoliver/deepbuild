// AC1 #1964.437d15d8: In `H2O is water` a run that makes the 2 a subscript draws it at the font's subscript offset and
// size, the glyphs before it keep the plain run's positions, and a run that names a status role is refused naming the
// run
//
// This file holds the third clause; subscript.test.ts holds the first two. Through `deep-canvas-render check` and
// `raster` with #467's look. The text carries two runs: run 0 makes the 2 a subscript, run 1 sets "water" (graphemes 7
// to 12) in a role. With a status role (`status.fail`) the check refuses it with an error whose path is run 1's,
// `items/formula/params/runs/1` or under it (README: Readings); a status color comes only through a status binding
// (the status-color rule). The control is the same text with run 1 in `wine`, an ordinary role of the look: it passes
// the check and draws, so the refusal is the status role's, not the runs'.
import { describe, expect, it } from 'vitest';
import { AC, SUB_RUN, check, describeErrors, drawAll, formula, useBin, useDir, type JsonObject } from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();

/** "water", graphemes 7 to 12 of `H2O is water`, in `role`: run 1, after the subscript run. */
const water = (role: string): JsonObject => ({ from: 7, to: 12, role });
const RUN = 'items/formula/params/runs/1';

describe(`${ID} a run that names a status role`, () => {
  it(`${ID} a run that names a status role is refused, naming the run`, () => {
    const { answer, errors } = check(bin(), formula('status-run', 'body', [SUB_RUN, water('status.fail')]));
    expect(answer['ok'], `the text whose run 1 names status.fail is refused at check: ${describeErrors(errors)}`).toBe(false);
    expect(errors.some((e) => e.path === RUN || e.path.startsWith(`${RUN}/`)), `an error names the run, ${RUN}: ${describeErrors(errors)}`).toBe(true);

    const ordinary = formula('wine-run', 'body', [SUB_RUN, water('wine')]);
    const passed = check(bin(), ordinary);
    expect(passed.answer['ok'], `the same runs with run 1 in wine, an ordinary role of the look, pass the check: ${describeErrors(passed.errors)}`).toBe(true);
    drawAll(bin(), dir(), [ordinary], ['the text whose run 1 is in wine']);
  });
});
