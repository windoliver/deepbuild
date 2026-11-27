// #1686: the unit tests of runner pass. Runs packages/runner/test, unchanged, through the repo's vitest and judges
// every test in it.
import { expect, it } from 'vitest';
import { vitestRun } from './run.ts';

it('#1686.1341dfbb the unit tests of runner pass: every test under packages/runner/test', () => {
  const { ran, notPassed } = vitestRun(['packages/runner/test/']);
  expect(ran, 'packages/runner/test ran a test').toBeGreaterThan(0);
  expect(notPassed, 'runner\'s tests that didn\'t pass').toEqual([]);
}, 1_000_000);
