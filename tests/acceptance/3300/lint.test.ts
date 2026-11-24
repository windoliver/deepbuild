// #3300 criterion 3: "A lint over `tests/acceptance` fails a made-up reading handed to `canvas.mjs judge` whose runs give
// no `loadStart` and `loadEnd`, naming the file and line; it lists none once the redraft lands"
//
// The lint is #1830's, `node scripts/loads-lint.mjs [--root <checkout>]`, which reads tests/acceptance (README:
// Criterion 3). Two plants in a scratch checkout: a suite that hands the judge a made-up reading whose runs give no loads
// (fixtures/no-loads.test.ts.txt, its line marked `// finding`), and its twin whose runs give them
// (fixtures/with-loads.test.ts.txt). The lint lists exactly the marked line and fails. Over copies of #854's and #896's
// first drafts, with no redraft beside them, it lists each suite, by file and line; over this checkout, where the
// redrafts have landed, it lists nothing under either suite. The wrong programs: the merge base's lint, which looks for
// judgeLimit calls only and so lists nothing; a lint that lists the twin that gives the loads; one that names no line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC3, copyFolder, lint, plant, scratch } from './helpers.ts';

const SUITES = ['tests/acceptance/854', 'tests/acceptance/896'] as const;

test(`${AC3} the loads lint fails a planted suite that hands canvas.mjs judge a made-up reading whose runs give no loadStart and loadEnd, naming its file and line, and lists nothing of the same suite whose runs give them`, () => {
  const at = scratch();
  const planted = plant(at, 'no-loads.test.ts', 'tests/acceptance/9300');
  expect(plant(at, 'with-loads.test.ts', 'tests/acceptance/9300'), 'the twin gives the loads, so nothing in it is marked').toEqual([]);
  expect(planted, 'one made-up reading gives no loads').toHaveLength(1);
  const { status, fails, passes, output } = lint(at);
  expect(fails, `the lint lists exactly the planted reading, by file and line:\n${output}`).toEqual(planted);
  expect(status, `and fails:\n${output}`).toBe(1);
  expect(passes, `no PASS line beside a finding:\n${output}`).toBe(0);
});

test(`${AC3} the loads lint lists #854's and #896's first drafts, by file and line, where no redraft sits beside them, and lists nothing of either suite in this checkout, where the redrafts have landed`, () => {
  const at = scratch();
  for (const suite of SUITES) copyFolder(at, suite, ['redraft-3300']);
  const first = lint(at);
  for (const suite of SUITES) {
    const named = first.fails.filter((fail) => fail.startsWith(`${suite}/`));
    expect(named.length, `the lint lists ${suite}'s first draft, whose made-up runs give no loads:\n${first.output}`).toBeGreaterThan(0);
    const lineless = named.filter((fail) => {
      const [, path, line] = /^(.+):(\d+)$/.exec(fail) ?? [];
      return !path || !(Number(line) >= 1 && Number(line) <= readFileSync(join(at, path), 'utf8').split('\n').length);
    });
    expect(lineless, `each names a file of the suite and a line in it:\n${first.output}`).toEqual([]);
  }
  expect(first.status, `and fails:\n${first.output}`).toBe(1);

  const here = lint();
  console.log(`#3300 loads lint over this checkout:\n${here.output}`);
  expect(here.fails.filter((fail) => SUITES.some((suite) => fail.startsWith(`${suite}/`))), `once the redrafts land the lint lists nothing of either suite:\n${here.output}`).toEqual([]);
});
