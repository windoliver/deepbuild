// AC11: a kit's requirement set is frozen per contract revision. A case added in a later revision runs only for
// fills that declare that revision; a fill installed against the earlier one is judged on that revision's set alone.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Case, Fill } from '../../../packages/conformance/src/index.ts';
import { adapterKit, clean, everyCaseRunKit, kitWith, run, RUNS, testCase } from './helpers.ts';

const kit = adapterKit();
const installed = (fill: Fill, revision: number): Fill => ({ ...fill, revision });
/** A case of a later revision that no fill passes: it fails on its own finding. */
const later = (revision: number): Case => testCase(`test/added-in-${revision}`, {}, (h) => h.fail(`added in revision ${revision}`, []), revision);

describe('AC11 a kit\'s requirement set is frozen per contract revision', () => {
  it('AC11 the kit and its cases name revisions, every case at or below the kit\'s', () => {
    expect(Number.isInteger(kit.revision) && kit.revision >= 1).toBe(true);
    for (const c of kit.cases) {
      expect(Number.isInteger(c.revision) && c.revision >= 1, `${c.id} names a revision`).toBe(true);
      expect(c.revision, `${c.id} is not newer than the kit`).toBeLessThanOrEqual(kit.revision);
    }
    expect(clean(kit).revision).toBe(kit.revision);
  });

  it('AC11 a case added in a later revision runs only for fills that declare that revision', () => {
    const next = kit.revision + 1;
    const grown = kitWith(kit, { revision: next, cases: [...kit.cases, later(next)] });
    const onEarlier = run(grown, installed(clean(kit), kit.revision));
    const onNext = run(grown, installed(clean(kit), next));
    expect(onEarlier.cases.map((c) => c.id), 'the earlier fill never meets the new case').not.toContain(later(next).id);
    expect(onEarlier.cases.map((c) => c.id).sort()).toEqual(kit.cases.map((c) => c.id).sort());
    expect(onEarlier.revision).toBe(kit.revision);
    expect(onNext.cases.map((c) => c.id)).toContain(later(next).id);
    expect(onNext.cases.find((c) => c.id === later(next).id)!.outcome).toBe('FAIL');
  });

  it('AC11 a fill installed against the earlier revision is judged on that revision\'s set alone: it passes, and a runner that runs every case on every fill fails it on the new case', () => {
    const next = kit.revision + 1;
    const grown = kitWith(kit, { revision: next, cases: [...kit.cases, later(next)] });
    const fill = installed(clean(kit), kit.revision);
    const report = run(grown, fill);
    expect(report.verdict, `the earlier fill passes the earlier set (failures: ${report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.message}`).join(' | ')})`).toBe('PASS');
    // Wrong program: a runner that ignores revisions fails the installed fill on the new case; this test names the
    // case and both revisions.
    const wrong = everyCaseRunKit(grown, fill);
    const failedNew = wrong.cases.find((c) => c.id === later(next).id);
    expect(failedNew?.outcome, `the every-case stand-in fails ${later(next).id} (kit revision ${next}, fill revision ${fill.revision})`).toBe('FAIL');
    expect(() => expect(wrong.cases.map((c) => c.id), `case ${later(next).id} of revision ${next} ran against a fill of revision ${fill.revision}`).not.toContain(later(next).id))
      .toThrow(new RegExp(`${later(next).id} of revision ${next} ran against a fill of revision ${fill.revision}`));
  });

  it('AC11 a fill that declares a revision the kit does not have yet is still judged on every case up to the kit\'s', () => {
    const report = run(kit, installed(clean(kit), kit.revision + 5));
    expect(report.cases.map((c) => c.id).sort()).toEqual(kit.cases.map((c) => c.id).sort());
  });

  it('AC11 for any kit revision and fill revision, a case runs exactly when its revision is at or below the fill\'s (1,000 cases)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }), (kitRevision, caseRevision, fillRevision) => {
      fc.pre(caseRevision <= kitRevision);
      const added = later(caseRevision);
      const report = run(kitWith(kit, { revision: kitRevision, cases: [added] }), installed(clean(kit), fillRevision));
      expect(report.cases.some((c) => c.id === added.id), `case ${added.id} of revision ${caseRevision} against a fill of revision ${fillRevision}`).toBe(caseRevision <= fillRevision);
    }), RUNS);
  });
});
