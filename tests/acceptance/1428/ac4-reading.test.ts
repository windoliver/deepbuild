import { describe, expect, it } from 'vitest';
import { AC, cleanProblems, passesTable, requireGpu, runFixtures, useBin, useOut } from './helpers.ts';

const bin = useBin();
const out = useOut();

describe(`${AC[4]} the result reads as a reading unless the pass's analytic fixture ran, and a planted run with the fixture skipped never reads PASS`, () => {
  it(`${AC[4]} every pass whose analytic fixture ran reads PASS and says its fixture ran`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    expect(cleanProblems(runFixtures(bin(), out(), rows.map((r) => r.pass))), 'every pass with its analytic fixture run').toEqual([]);
  }, 7_200_000);

  it(`${AC[4]} with every pass's analytic fixture skipped (--planted skips_fixture), each pass's comparison against its CPU reference reads as a reading, never PASS, and says its fixture did not run`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const results = runFixtures(bin(), out(), rows.map((r) => r.pass), 'skips_fixture');
    const passed = results.filter((r) => r.result === 'PASS').map((r) => r.pass);
    expect(passed, 'passes that read PASS with their analytic fixture skipped').toEqual([]);
    const problems: string[] = [];
    for (const r of results) {
      if (r.result !== 'reading') problems.push(`pass ${r.pass}: reads ${r.result} with its analytic fixture skipped, not reading`);
      if (r.fixtureRan) problems.push(`pass ${r.pass}: says its fixture ran under skips_fixture`);
    }
    expect(problems, 'every pass with its analytic fixture skipped').toEqual([]);
  }, 7_200_000);
});
