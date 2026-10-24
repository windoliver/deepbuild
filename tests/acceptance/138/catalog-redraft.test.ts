// Blind redraft of three tests in catalog.test.ts (criteria 7 and 29), which no implementation could pass:
// each asked for one failure whose `code` was both its failure code (`uncatalogued`, `ops_fix`,
// `unproved_fix`) and the check code it names. Here a failure's `code` stays its failure code (README:
// Failure codes) and the check code it names is read from `issue_code`, the `code` of the issue the check
// raises (canvas-primitives.md, Check input: issues are `{check, code, …}`). Everything else each test
// asserts is as in the original. CATALOG-REDRAFT.md says why; the originals stay until the owner swaps them.
import { describe, expect, it } from 'vitest';
import { expectFailure, failuresIn, kit, moduleOf, useBuilds, useEvidence, type Build } from './helpers.ts';

const ROGUE: Build = { set: 'full', with: ['test-kit-rogue'] };
const DANGLES: Build = { set: 'full', with: ['test-kit-fixer-dangles'] };
const UNPROVED: Build = { set: 'full', with: ['test-kit-fixer-unproved'] };
const builds = useBuilds([ROGUE, DANGLES, UNPROVED]);
const evidence = useEvidence();

describe('#138.9e9940d1 a code the catalog doesn\'t list fails the kit; every catalog code has a planted fixture that emits it with its meaning and fix', () => {
  it('#138.9e9940d1 test.kit.rogue, whose check can emit test.kit.rogue.unlisted, fails the kit\'s catalog part naming the code', () => {
    const r = kit(builds.bin(ROGUE), evidence(), { modules: ['test.kit.rogue'], parts: ['catalog'] });
    const m = moduleOf(r, 'test.kit.rogue');
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m, 'catalog'), 'uncatalogued', { issue_code: 'test.kit.rogue.unlisted' }, 'the rogue module');
  }, 1_800_000);
});

describe('#138.c7f79e24 a fix given as patch ops is applied on each kit fixture raising its code, and the second check returns only that fixture\'s other codes', () => {
  it('#138.c7f79e24 a planted ops fix that clears its issue but adds ref_unresolved (test-kit-fixer-dangles) fails, naming the code', () => {
    const r = kit(builds.bin(DANGLES), evidence(), { modules: ['test.kit.fixer'], parts: ['catalog'] });
    const m = moduleOf(r, 'test.kit.fixer');
    expect(m.verdict).toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'catalog'), 'ops_fix', { issue_code: 'test.kit.fixer.y_over' }, 'the dangling fix');
    expect(f['added'], 'it names the code the fix added').toEqual(['ref_unresolved']);
  }, 1_800_000);

  it('#138.c7f79e24 an ops fix that no fixture applied (test-kit-fixer-unproved) fails the kit, naming the code', () => {
    const r = kit(builds.bin(UNPROVED), evidence(), { modules: ['test.kit.fixer'], parts: ['catalog'] });
    const m = moduleOf(r, 'test.kit.fixer');
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m, 'catalog'), 'unproved_fix', { issue_code: 'test.kit.fixer.y_under' }, 'the unproved ops fix');
  }, 1_800_000);
});
