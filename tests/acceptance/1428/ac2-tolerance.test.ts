import { describe, expect, it } from 'vitest';
import { AC, diffOf, passesTable, requireGpu, runFixtures, useBin, useOut } from './helpers.ts';

const bin = useBin();
const out = useOut();

describe(`${AC[2]} a one-code-value error in one channel of one pixel inside the tolerance passes; a three-value error in one pixel fails, naming the item`, () => {
  it(`${AC[2]} with one channel of one pixel of every pass's analytic fixture one code value off (--planted pixel_one_code), every pass reads PASS with zero outlier pixels`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const results = runFixtures(bin(), out(), rows.map((r) => r.pass), 'pixel_one_code');
    const problems: string[] = [];
    for (const r of results) {
      if (r.result !== 'PASS') problems.push(`pass ${r.pass}: reads ${r.result} with a one-code error in one channel of one pixel (outliers ${r.outliers}; worst ${JSON.stringify(r.worst.slice(0, 2))})`);
      if (r.outliers !== 0) problems.push(`pass ${r.pass}: counts ${r.outliers} outlier pixels for a one-code error`);
      if (!r.fixtureRan) problems.push(`pass ${r.pass}: its analytic fixture did not run`);
    }
    expect(problems, 'every pass with a one-code error in one channel of one pixel').toEqual([]);
  }, 7_200_000);

  it(`${AC[2]} with one pixel of every pass's analytic fixture three code values off (--planted pixel_three_codes), every pass fails with that one pixel, naming the pass and the item drawn there, three code values from its expected value`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const results = runFixtures(bin(), out(), rows.map((r) => r.pass), 'pixel_three_codes');
    const problems: string[] = [];
    for (const r of results) {
      const at = `pass ${r.pass}`;
      if (r.result !== 'FAIL') problems.push(`${at}: reads ${r.result} with a three-value error in one pixel, not FAIL`);
      if (r.outliers !== 1) problems.push(`${at}: counts ${r.outliers} outlier pixels for an error in one pixel, not 1`);
      if (r.worst.length !== 1) { problems.push(`${at}: lists ${r.worst.length} failing pixels for an error in one pixel, not 1`); continue; }
      const w = r.worst[0]!;
      if (w.pass !== r.pass) problems.push(`${at}: the failing pixel names pass ${w.pass}`);
      if (r.items.length === 0 || !r.items.includes(w.item)) problems.push(`${at}: the failing pixel at (${w.x}, ${w.y}) names item ${w.item}, which is not one its fixture draws (${r.items.join(', ')})`);
      if (diffOf(w) !== 3) problems.push(`${at}: the failing pixel at (${w.x}, ${w.y}) is ${diffOf(w)} code values from its expected value, not 3 (expected ${JSON.stringify(w.expected)}, actual ${JSON.stringify(w.actual)})`);
    }
    expect(problems, 'every pass with a three-value error in one pixel').toEqual([]);
  }, 7_200_000);
});
