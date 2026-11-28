import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, TOLERANCE, TWO_CRATES, cleanProblems, namedFailureProblems, passesTable, requireGpu, runFixtures, useBin, useOut, wgslFilesUnder,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

describe(`${AC[1]} every WGSL file under the two crates has an analytic fixture and a planted twin that fails it, naming the pass and the item`, () => {
  it(`${AC[1]} every WGSL file under crates/deep-effects-render and crates/deep-gpu-layer is a pass in the fixture table, each pass with an analytic fixture file in the checkout and a planted twin of its own file`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const files = wgslFilesUnder(TWO_CRATES);
    expect(files.length, 'the two crates hold WGSL files').toBeGreaterThan(0);
    const problems: string[] = [];
    for (const file of files) if (!rows.some((r) => r.file === file)) problems.push(`${file} is a pass in no row of the fixture table`);
    for (const r of rows) {
      const fixtureFile = r.fixture.split('#')[0]!;
      if (!existsSync(join(REPO, fixtureFile))) problems.push(`pass ${r.pass}: its fixture ${r.fixture} names no file in the checkout`);
      if (!existsSync(join(REPO, r.file))) problems.push(`pass ${r.pass}: its file ${r.file} is not in the checkout`);
      for (const other of rows) if (other.file !== r.file && other.twin === r.twin) problems.push(`pass ${r.pass} (${r.file}) shares its twin ${r.twin} with pass ${other.pass} (${other.file})`);
    }
    expect([...new Set(problems)], 'the fixture table against the WGSL files under the two crates').toEqual([]);
  }, 7_200_000);

  it(`${AC[1]} every pass's analytic fixture runs and reads PASS: the pass within ${TOLERANCE} of 255 per channel of its hand-written values and of its CPU reference, with zero outlier pixels`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const results = runFixtures(bin(), out(), rows.map((r) => r.pass));
    expect(cleanProblems(results), 'every pass\'s analytic fixture on the clean build').toEqual([]);
  }, 7_200_000);

  it(`${AC[1]} every pass's planted twin fails its analytic fixture, naming the pass and the item for the worst 16 pixels, worst first, with their expected and actual values`, () => {
    requireGpu();
    const rows = passesTable(bin(), out());
    const problems: string[] = [];
    for (const r of rows) {
      const [result] = runFixtures(bin(), out(), [r.pass], r.twin);
      problems.push(...namedFailureProblems(result!, [r.pass]).map((p) => `--planted ${r.twin}: ${p}`));
    }
    expect(problems, 'each pass\'s analytic fixture under its planted twin').toEqual([]);
  }, 7_200_000);
});
