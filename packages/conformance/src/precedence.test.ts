// The published runner must aggregate mixed cases using the design's verdict order, not case order.
import { expect, it } from 'vitest';
import { cleanFill, runKit, type Case, type Kit } from '@deepbuild/conformance';

const invalid: Case = { id: 'unreached', revision: 1, declares: { flags: ['answerPermission'], operations: [], kinds: [] }, run() {} };
const blocked: Case = { id: 'no-geometry', revision: 1, declares: { flags: [], operations: [], kinds: [] }, run(h) { h.bounds('panel'); } };
const failed: Case = { id: 'failed', revision: 1, declares: { flags: [], operations: [], kinds: [] }, run(h) { h.fail('a measured failure'); } };
const kit = (cases: Case[]): Kit => ({ name: 'adapter@1', revision: 1, cases, fakes: [], planted: [] });

for (const cases of [[invalid, blocked], [blocked, invalid]]) {
  it(`INVALID outranks BLOCKED with ${cases[0]!.id} first`, () => {
    const k = kit(cases);
    const report = runKit(k, cleanFill(k), { headless: true });
    expect(report.cases.map(c => c.outcome).sort()).toEqual(['BLOCKED', 'INVALID']);
    expect(report.verdict).toBe('INVALID');
  });
}
it('FAIL still outranks both missing coverage and a blocked probe', () => {
  const k = kit([blocked, invalid, failed]);
  const report = runKit(k, cleanFill(k), { headless: true });
  expect(report.cases.map(c => c.outcome)).toEqual(['BLOCKED', 'INVALID', 'FAIL']);
  expect(report.verdict).toBe('FAIL');
});
it('an empty kit remains INCONCLUSIVE, never PASS', () => {
  const k = kit([]);
  expect(runKit(k, cleanFill(k), { headless: true }).verdict).toBe('INCONCLUSIVE');
});
