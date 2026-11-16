// What #2218's blind suite doesn't reach of the spec's counts: a `runs`, `accept` or `min_tests` the hub can't read.
// Each stands on its check as a cause that is yours, so the check is BLOCKED naming the value, never run on one clean
// run as though the key weren't there.
import { expect, it } from 'vitest';
import { specChecks } from '../src/spec-checks.js';

it.each([
  ['runs: 0', { runs: 0 }, 'runs 0'],
  ['accept: 250%', { accept: '250%' }, '250%'],
  ['min_tests: five', { min_tests: 'five' }, 'min_tests five'],
])('a spec check with %s is missing a count the hub can read, naming the value', (_written, counts, named) => {
  // No spec file in this folder: the keys are read from the entry as checksOf hands it.
  const [check] = specChecks('/nowhere', { checks: {} }, new Map([['unit', { run: 'true', ...counts }]]), new Map());
  expect(check?.check).toBe('unit');
  expect(check?.prerequisite?.outcome).toBe('missing');
  expect(check?.prerequisite?.cause).toContain(named);
});
