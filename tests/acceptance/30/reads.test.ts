// AC11: each run records the files in the checkout it read, which count as the check's inputs with the paths it
// declares (#28). A Vitest test reads fixtures/prices.json with readFileSync in a check that declares only src/**:
// the read set lists it, and not fixtures/unused.json, which nothing opens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';
import { readsDeclaredOnly, readsEveryFile } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const DECLARED = ['src/**'];

/** The criterion's assertion on one run's read set. */
function readSetHolds(r: CommandRun): void {
  expect(r.read.includes('fixtures/prices.json'), `fixtures/prices.json, which the test read, is in the read set (${r.read.filter((p) => !p.startsWith('node_modules/')).join(', ')})`).toBe(true);
  expect(r.read.includes('fixtures/unused.json'), 'fixtures/unused.json, which nothing opens, is in the read set').toBe(false);
}

describe('AC11 #30.ec919953 a Vitest test that reads fixtures/prices.json, in a check that declares only src/**, lists it among the files its run read, and not fixtures/unused.json', () => {
  let checkout: string;
  let r: CommandRun;
  beforeAll(async () => {
    checkout = project('prices');
    r = await runCommandCheck(command(world.sup, checkout, VITEST, { inputs: DECLARED }));
  }, 180_000);

  it('AC11 the run passes and its read set holds fixtures/prices.json and the test\'s own files, relative to the checkout, and not fixtures/unused.json', () => {
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('passed');
    readSetHolds(r);
    expect(r.read, 'the test file it ran').toContain('src/prices.test.ts');
    expect(r.read, 'the module it loaded').toContain('src/prices.ts');
    for (const path of r.read) expect(path, 'paths are relative to the checkout').not.toMatch(/^(\/|\.\.)/);
  });

  it('AC11 (wrong program) a runner that records only the declared paths fails this test on fixtures/prices.json', () => {
    expect(() => readSetHolds(readsDeclaredOnly(r, checkout, DECLARED))).toThrow(/fixtures\/prices\.json/);
  });

  it('AC11 (wrong program) a runner that lists every file in the checkout fails this test on fixtures/unused.json', () => {
    const wrong = readsEveryFile(r, checkout);
    expect(wrong.read, 'the wrong program lists fixtures/prices.json, so it passes the first file').toContain('fixtures/prices.json');
    expect(() => readSetHolds(wrong)).toThrow(/fixtures\/unused\.json/);
  });
});
