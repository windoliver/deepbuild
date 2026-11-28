import { describe, expect, it } from 'vitest';
import { AC2, AC3, MODEL_SUITES, editedModelSuites, modelSuites, notPassed } from './helpers.ts';

const PROXIED_ROUTE = `${MODEL_SUITES}/proxied-route.test.ts`;

describe('#87\'s model suites, unchanged', () => {
  it(`${AC2} #87's model suites are unchanged from the merge base (byte for byte), and every test in them passes`, async () => {
    expect(editedModelSuites(), `${AC2} files of ${MODEL_SUITES} that differ from the merge base`).toEqual([]);
    const byFile = await modelSuites();
    expect(byFile.size, `${AC2} the run reported no file of ${MODEL_SUITES}`).toBeGreaterThan(0);
    for (const [file, tests] of byFile) {
      expect(tests.length, `${AC2} ${file} ran a test`).toBeGreaterThan(0);
      expect(notPassed(tests), `${AC2} ${file}'s tests that didn't pass`).toEqual([]);
    }
  }, 3_100_000);

  it(`${AC3} the planted trusts-proxied-transcript still fails #87's proxied-route scenario where it does: its wrong-program test passes`, async () => {
    const tests = (await modelSuites()).get(PROXIED_ROUTE) ?? [];
    const plant = tests.filter((t) => t.fullName.includes('(wrong program)') && t.fullName.includes('trusts the proxied transcript'));
    expect(plant.length, `${AC3} ${PROXIED_ROUTE} holds the wrong-program test of trusts-proxied-transcript: ${tests.map((t) => t.fullName).join(' | ')}`).toBe(1);
    expect(plant[0]!.status, `${AC3} under trusts-proxied-transcript the proxied-route scenario must still fail with "the proxied transcript's model trusted": ${plant[0]!.failureMessages?.[0]?.slice(0, 1500) ?? ''}`).toBe('passed');
    const correct = tests.filter((t) => !t.fullName.includes('(wrong program)'));
    expect(notPassed(correct), `${AC3} ${PROXIED_ROUTE}'s scenario without the plant`).toEqual([]);
  }, 3_100_000);
});
