// #1686: the agents' facts are read through @deepbuild/adapters' readFacts, never by a path into the repo's adapters/
// folder. The first test runs the issue's own proof, tests/facts-entry.test.mjs, on the live checkout; the second
// calls readFacts as any package does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFacts } from '@deepbuild/adapters';
import { expect, it } from 'vitest';
import { nodeRun, REPO } from './run.ts';

it('#1686.b9fba25b tests/facts-entry.test.mjs, which lists every line in a package\'s src outside adapters and the CLI that names the adapters/ folder by path, passes on this checkout', () => {
  const { ran, notPassed } = nodeRun('tests/facts-entry.test.mjs');
  expect(ran, 'tests/facts-entry.test.mjs ran a test').toBeGreaterThan(0);
  expect(notPassed, 'tests/facts-entry.test.mjs\'s tests that didn\'t pass').toEqual([]);
}, 1_000_000);

it('#1686.0140ed0a readFacts(\'loops.facts.json\') equals the file on disk, and readFacts(\'../package.json\') is refused', () => {
  const onDisk: unknown = JSON.parse(readFileSync(join(REPO, 'adapters', 'loops.facts.json'), 'utf8'));
  expect(readFacts('loops.facts.json')).toEqual(onDisk);
  let refused = false;
  try {
    readFacts('../package.json');
  } catch {
    refused = true;
  }
  expect(refused, 'readFacts refused ../package.json').toBe(true);
}, 120_000);
