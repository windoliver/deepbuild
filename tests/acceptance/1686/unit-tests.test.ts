// #1686: the unit tests of otlp, adapters and the hub's mods pass. Each test runs its package's test files, unchanged,
// through the runner the repo's unit lane uses, and judges every test in them. The runner's are in
// runner-unit-tests.test.ts, a file of their own for the lanes' cap on one file's run.
import { expect, it } from 'vitest';
import { nodeRun, vitestRun } from './run.ts';

it('#1686.1341dfbb the unit tests of otlp pass: every test under packages/otlp/test', () => {
  const { ran, notPassed } = vitestRun(['packages/otlp/test/']);
  expect(ran, 'packages/otlp/test ran a test').toBeGreaterThan(0);
  expect(notPassed, 'otlp\'s tests that didn\'t pass').toEqual([]);
}, 1_000_000);

it('#1686.1341dfbb the unit tests of adapters pass: every test in tests/adapters.test.mjs', () => {
  const { ran, notPassed } = nodeRun('tests/adapters.test.mjs');
  expect(ran, 'tests/adapters.test.mjs ran a test').toBeGreaterThan(0);
  expect(notPassed, 'adapters\' tests that didn\'t pass').toEqual([]);
}, 1_000_000);

it('#1686.1341dfbb the unit tests of the hub\'s mods pass: every test in packages/hub/test/mods.test.ts', () => {
  const { ran, notPassed } = vitestRun(['packages/hub/test/mods.test.ts']);
  expect(ran, 'the hub\'s mods tests ran a test').toBeGreaterThan(0);
  expect(notPassed, 'the hub\'s mods tests that didn\'t pass').toEqual([]);
}, 1_000_000);
