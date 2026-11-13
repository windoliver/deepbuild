// #1802.3f79e4e6: "A break file that quotes two lines, one still in the diff and one not, fails, naming the one that
// isn't"
//
// asserts: R1 is recorded with the stable methods deep.first and deep.second. The candidate R2 removes both, and
// contracts/breaks/R1_R2/1802.txt quotes both removals, `diff: R1_R2 api:deep.first / removed` and
// `diff: R1_R2 api:deep.second / removed`, with a workaround: the step passes. Then deep.second is restored as it
// was, so only deep.first's line is still in R1_R2's diff. The step fails, one FAIL line holds the file's path and
// deep.second's line, and no FAIL line holds deep.first's.
// Wrong program: the merge base, whose step passes the tree with deep.second restored.

import { expect, it } from 'vitest';
import { addApi, breakFile, check, emptyTree, expectFailNaming, expectPass, failLines, record, removalLine, removeApi, stableEntry } from './helpers.ts';

const FIRST = 'deep.first';
const SECOND = 'deep.second';
const FIRST_LINE = removalLine('R1', 'R2', FIRST);
const SECOND_LINE = removalLine('R1', 'R2', SECOND);

it('#1802.3f79e4e6 a break file that quotes two lines, one still in the diff and one not, fails, naming the one that isn\'t', () => {
  const t = emptyTree('two');
  for (const method of [FIRST, SECOND, 'deep.stays']) addApi(t, stableEntry(method));
  record(t, 'R1');
  removeApi(t, FIRST);
  removeApi(t, SECOND);
  const file = breakFile(t, 'R1', 'R2', '1802', [FIRST_LINE, SECOND_LINE], 'Call deep.stays instead.');
  expectPass(check(t, 'R2'), 'both removals, each quoted by the one break file');

  addApi(t, stableEntry(SECOND));
  const r = check(t, 'R2');
  expectFailNaming(r, 'the break file with deep.second restored', file, SECOND_LINE);
  expect(failLines(r).filter((l) => l.includes(FIRST_LINE)), 'the line still in the diff, deep.first\'s, is in no FAIL line').toEqual([]);
}, 120_000);
