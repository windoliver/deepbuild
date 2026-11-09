// AC5 #505.91640dd4: "A bar set of n = 4 rows with computed columns x = (i + 0.5) ÷ n and y = x² gives heights
// 0.015625, 0.140625, 0.390625 and 0.765625 within 1e-12, and a counter on sum(y) ÷ n shows 0.328125, then 0.333325
// with n driven to 100; a role column `y < 0 ? 1 : 0` colors bars below the axis with the set's second role and the
// rest with its first; and n declared with max 4,097 is refused at check, naming the set"
//
// A `marks@1` bar set whose columns are `{expr}` (Mark set and columns: a computed column), written as the issue
// writes them (`x ^ 2` names the set's own x), with n the slider `count` (`n: "controls/count/value"`, declared over
// [1, 100] at 4) and one entry of yours driving it to 100 at 1 s. `geometry` gives the set's rows (#167's `rows`, keyed
// by the row index: the set has no key column) with their columns and places; the counter is a `text@1` whose
// counter's source is a driver `s / n`, s bound to `items/bars#sum/y` (README: the sum anchor), shown through
// `raster`'s `texts`. The heights are the y column, and each bar's top is placed by the y scale at it. The role column
// is a column named `role` over the set's `roles` [ink, accent], on bars of sin(2πx) at n = 8 (four above the axis,
// four below), read from the rows' colors and the drawn pixels. Closed forms here: the midpoint sum ((4n² − 1) ÷ 12n²)
// is 21/64 = 0.328125 at n = 4 and 0.333325 at n = 100. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { T, barsU, declaredDoc, riemannDoc, wavesDoc, wavesU } from './docs.ts';
import {
  AC, ROLES, TIMEOUT, check, codeDiff, deltaEok, entry, geometry, near, num, oklab, passes, pixel, rasterAt, readPng, rowsOf, shownIssues, shownText,
  useRender, useTemp, type Row,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('columns');
const ID = AC[5];
const INPUT = [entry(T, 1, 'count', 100)];
const HEIGHTS = [0.015625, 0.140625, 0.390625, 0.765625];
const midpointSum = (n: number): number => { let s = 0; for (let i = 0; i < n; i++) s += ((i + 0.5) / n) ** 2; return s / n; };

/** The rows in index order, exactly n of them. */
function ordered(rows: Record<string, Row>, n: number, what: string): Row[] {
  expect(Object.keys(rows).sort((a, b) => Number(a) - Number(b)), `${what}: rows keyed 0 to ${n - 1}`).toEqual(Array.from({ length: n }, (_, i) => String(i)));
  return Array.from({ length: n }, (_, i) => rows[String(i)]!);
}

describe(`${ID} mark-set columns computed from a formula over the row index`, () => {
  it(`${ID} n = 4 gives the four heights within 1e-12 and the counter 0.328125, then 0.333325 with n driven to 100`, () => {
    // The closed form and the issue's numbers agree.
    HEIGHTS.forEach((h, i) => near(((i + 0.5) / 4) ** 2, h, 0, `((${i} + 0.5) ÷ 4)²`));
    near(midpointSum(4), 0.328125, 1e-15, 'the midpoint sum at n = 4');
    near(midpointSum(100), 0.333325, 1e-15, 'the midpoint sum at n = 100');
    const bin = render();
    const doc = riemannDoc();
    passes(bin, doc, 'the Riemann bars', { input: INPUT });
    const [atFour, atHundred] = geometry(bin, doc, 'bars', [{ t: T - 1, input: INPUT }, { t: T, input: INPUT }]).map((a, i) => rowsOf(a, `the bars (${i})`));
    const four = ordered(atFour!, 4, 'n = 4');
    four.forEach((r, i) => {
      near(num(r.columns['x'], `row ${i}: x`), (i + 0.5) / 4, 1e-12, `n = 4, row ${i}: x = (i + 0.5) ÷ n`);
      near(num(r.columns['y'], `row ${i}: y`), HEIGHTS[i]!, 1e-12, `n = 4, row ${i}: the height y = x²`);
      near(r.place.y, barsU.y(HEIGHTS[i]!), 1e-6, `n = 4, row ${i}: the bar's top, placed by the y scale at its height`);
    });
    const hundred = ordered(atHundred!, 100, 'n driven to 100');
    hundred.forEach((r, i) => near(num(r.columns['y'], `row ${i}: y`), ((i + 0.5) / 100) ** 2, 1e-12, `n = 100, row ${i}: y`));
    const [shownFour, shownHundred] = rasterAt(bin, doc, [{ t: T - 1, input: INPUT }, { t: T, input: INPUT }], temp(), 'riemann');
    expect(shownText(shownFour!.answer, 'count', 'n = 4'), 'the counter on sum(y) ÷ n at n = 4').toBe('0.328125');
    expect(shownText(shownHundred!.answer, 'count', 'n = 100'), 'the counter on sum(y) ÷ n in the frame n is driven to 100').toBe('0.333325');
  }, TIMEOUT);

  it(`${ID} a role column y < 0 ? 1 : 0 colors bars below the axis with the set's second role and the rest with its first`, () => {
    const bin = render();
    const doc = wavesDoc();
    passes(bin, doc, 'the sine bars');
    const rows = ordered(rowsOf(geometry(bin, doc, 'waves', [{}])[0]!, 'the sine bars'), 8, 'n = 8');
    const image = readPng(rasterAt(bin, doc, [{}], temp(), 'waves')[0]!.out);
    const wrong: string[] = [];
    rows.forEach((r, i) => {
      const x = (i + 0.5) / 8;
      const y = Math.sin(2 * Math.PI * x);
      const below = y < 0;
      const want = below ? 'accent' : 'ink';
      near(num(r.columns['role'], `row ${i}: role`), below ? 1 : 0, 0, `row ${i} (y = ${y.toFixed(3)}): the role column`);
      if (!r.oklab || deltaEok(r.oklab, oklab(ROLES[want]!)) > 1e-4) wrong.push(`row ${i} (y = ${y.toFixed(3)}): its color ${JSON.stringify(r.oklab)} is not ${want}'s`);
      // The drawn bar, at its middle: from the axis to its top.
      const px = wavesU.x(x); const py = (wavesU.y(0) + wavesU.y(y)) / 2;
      const c = pixel(image, px, py);
      if (codeDiff(c, ROLES[want]!) > 1) wrong.push(`row ${i}: the bar draws ${c.join(',')} at (${px.toFixed(1)}, ${py.toFixed(1)}), not ${want} ${ROLES[want]!.join(',')}`);
    });
    expect(wrong, `the bars below the axis take the second role (accent), the rest the first (ink):\n  ${wrong.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} n declared with max 4,097 is refused at check, naming the set`, () => {
    const bin = render();
    const refused = check(bin, declaredDoc(4097), 'n up to 4,097');
    expect(refused.errors.filter((e) => e.ids.includes('bars')).length, `the check refuses it, an error naming the set: ${shownIssues(refused)}`).toBeGreaterThan(0);
    expect(refused.ok, 'the check does not pass').toBe(false);
    // The declared max may be 4,096: the same set with n up to 4,096 passes.
    passes(bin, declaredDoc(4096), 'n up to 4,096');
  }, TIMEOUT);
});
