// AC4 #2039.2e193c48: 500 such rows from one atlas draw in one instanced draw for their atlas, and a set with `slice`
// on `place: cell` is refused, naming the set. Budgets, on the reference Mac in the local preflight, compared with the
// merge base: the 500 rows add under 0.2 ms a frame (drafted, a target to be measured)
// (this file carries the second clause; ac4-one-draw.test.ts the first and ac4-budget.test.ts the third)
//
// Through `deep-canvas-render check` (the document check, every platform), as #2386's suite reads a refusal. The set
// `tiles` (fixtures.ts `cells`): two rows of the fixture atlas on a square grid of 24 u cells, at cells (1, 1) and
// (2, 1), with `place: "cell"` written out. It passes the check. The refused document is the same set with the issue's
// `slice` and with columns `w` and `h`, so `slice` on `place: cell` is the one thing check can refuse it for: a check
// that refused only a `slice` with no `w` and `h` would take it. A refusal names the set when an error issue's `ids`
// hold `tiles` or its `path` is `items/tiles` or under it (#536's and #2386's reading). Codes are the implementer's.
import { describe, expect, it } from 'vitest';
import { cells, figure, type Pt } from './fixtures.ts';
import { setRefusalProblems } from './judges.ts';
import { AC, TIMEOUT, atlasPng, checked, describeErrors, none, putAssets, useBin, useTemp } from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
const PAGE: Pt = [96, 48];
const CELLS: Pt[] = [[1, 1], [2, 1]];

describe(`${ID} slice on a set with place: cell is refused`, () => {
  it(`${ID} a set with slice on place: cell is refused, naming the set`, () => {
    const store = temp();
    const [atlas] = putAssets(store, [atlasPng()]);
    const [plain, sliced] = checked(bin(), [
      figure('cells', PAGE, [cells({ id: 'tiles', asset: atlas!, cells: CELLS })]),
      figure('cells-sliced', PAGE, [cells({ id: 'tiles', asset: atlas!, cells: CELLS, sliced: true })]),
    ], store);
    expect(plain!.ok, `the set with place: cell and no slice passes the check: ${describeErrors(plain!.errors)}`).toBe(true);
    none(setRefusalProblems(sliced!, 'tiles', 'set tiles, with slice on place: cell'), 'a set with slice on place: cell is refused at check, naming the set');
  }, TIMEOUT);
});
