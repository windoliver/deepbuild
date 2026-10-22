// #28 pinned to a commit: staleness, which checks run again, carried results and their keys: AC4 (pure),
// AC17, AC18, AC21, AC28, AC31.
import { describe, expect, it } from 'vitest';
import { selectReruns, staleReason, verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimInput } from '../../../packages/verdicts/src/index.ts';
import { referenceSelect, referenceVerdict } from './reference.ts';
import { check, checkOf, claim, commitOf, failure, reqId, reqOf, requirement, run, selectionProblems, text } from './helpers.ts';

const P = commitOf('parent');
const N = commitOf('next');

describe('AC4 a new commit makes the old verdict stale', () => {
  it('AC4 the verdict covers its own commit and is stale on any other', () => {
    const c = check('unit');
    const v = verdict(claim({ commit: P, checks: [c], runs: [run(c, P, 'passed')] }));
    expect(v.outcome).toBe('PASS');
    expect(staleReason(v, P)).toBeNull();
    const why = staleReason(v, N);
    expect(typeof why).toBe('string');
    expect(why!.length).toBeGreaterThan(0);
  });
});

describe('AC17 which checks run again: declared inputs, and a path no check declares', () => {
  const A = check('A', { inputs: ['src/**'], covers: [reqId(1)] });
  const B = check('B', { inputs: ['docs/**'], covers: [reqId(2)] });
  const parentRuns = [run(A, P, 'passed'), run(B, P, 'passed')];
  const at = (paths: string[]): ClaimInput => claim({ commit: N, requirements: [requirement(1), requirement(2)], checks: [A, B], runs: parentRuns, changes: [{ from: P, paths }] });
  it('AC17 a commit that changes only scripts/build.sh reruns A and B', () => {
    const c = at(['scripts/build.sh']);
    expect(selectionProblems(selectReruns(c), ['A', 'B'], [])).toEqual([]);
    // A selection that matches changed paths only against declared inputs reruns nothing and carries both.
    expect(selectionProblems(referenceSelect(c, 'declared-only'), ['A', 'B'], [])).toEqual(['A must run again', 'B must run again']);
  });
  it('AC17 a commit that changes only src/a.ts reruns A and keeps B\'s result', () => {
    const c = at(['src/a.ts']);
    const sel = selectReruns(c);
    expect(selectionProblems(sel, ['A'], ['B'])).toEqual([]);
    expect(sel.kept.B).toEqual([parentRuns[1]!.run]);
    const v = verdict(c);
    expect(checkOf(v, 'B')).toMatchObject({ outcome: 'PASS', counted: [parentRuns[1]!.run] });
    expect(checkOf(v, 'A').outcome, 'A waits for its new run').toBe('pending');
  });
});

describe('AC18 the files a check\'s last runs read are inputs too', () => {
  const C = check('fixtures-lint', { inputs: ['fixtures/**'], covers: [reqId(1)] });
  const T = check('test:prices', { inputs: ['src/**'], covers: [reqId(2)] });
  const reqs = [requirement(1), requirement(2)];
  const parentRuns = [run(C, P, 'passed'), run(T, P, 'passed', { reads: ['src/prices.ts', 'fixtures/prices.json'] })];
  const changes = [{ from: P, paths: ['fixtures/prices.json'] }];
  it('AC18 a commit that only changes a price in the fixture T read reruns C and T; a selection by declared inputs alone reruns only C', () => {
    const c = claim({ commit: N, requirements: reqs, checks: [C, T], runs: parentRuns, changes });
    expect(selectionProblems(selectReruns(c), ['fixtures-lint', 'test:prices'], [])).toEqual([]);
    expect(selectionProblems(referenceSelect(c, 'declared-only'), ['fixtures-lint', 'test:prices'], [])).toEqual(['test:prices must run again']);
  });
  it('AC18 when T\'s assertion then breaks, the claim is FAIL naming T', () => {
    const broken = run(T, N, 'failed', { failures: [failure('prices.test.ts › totals the cart', { message: 'expected 18.00 to be 18.01' })] });
    const v = verdict(claim({ commit: N, requirements: reqs, checks: [C, T], runs: [...parentRuns, run(C, N, 'passed'), broken], changes }));
    expect(v.outcome).toBe('FAIL');
    expect(checkOf(v, 'test:prices').outcome).toBe('FAIL');
    expect(checkOf(v, 'test:prices').counted).not.toContain(parentRuns[1]!.run);
    expect(text(v.reasons)).toContain('test:prices');
  });
});

describe('AC21 a check INCONCLUSIVE on the parent commit', () => {
  const X = check('X', { inputs: ['src/**'], covers: [reqId(1)] });
  const docs = check('docs', { inputs: ['docs/**'], covers: [reqId(2)] });
  const reqs = [requirement(1), requirement(2)];
  const parentRuns = [run(X, P, 'failed'), run(X, P, 'passed'), run(docs, P, 'passed')];
  it('AC21 stays INCONCLUSIVE on a new commit that changes none of its inputs, with no new run', () => {
    const c = claim({ commit: N, requirements: reqs, checks: [X, docs], runs: parentRuns, changes: [{ from: P, paths: ['docs/guide.md'] }] });
    const sel = selectReruns(c);
    expect(selectionProblems(sel, ['docs'], ['X'])).toEqual([]);
    const v = verdict(c);
    expect(checkOf(v, 'X').outcome).toBe('INCONCLUSIVE');
    expect([...checkOf(v, 'X').counted].sort()).toEqual([parentRuns[0]!.run, parentRuns[1]!.run].sort());
  });
  it('AC21 a commit that changes one of its inputs runs it again', () => {
    const c = claim({ commit: N, requirements: reqs, checks: [X, docs], runs: parentRuns, changes: [{ from: P, paths: ['src/cart.ts'] }] });
    expect(selectionProblems(selectReruns(c), ['X'], ['docs'])).toEqual([]);
    expect(checkOf(verdict(c), 'X').counted).toEqual([]);
  });
});

describe('AC28 a result never carries across another environment profile or tool version', () => {
  it('AC28 a PASS on Node 20 doesn\'t carry to the same commit run on Node 22', () => {
    const u = check('unit', { tools: { node: '22.11.0', vitest: '5.0.5' } });
    const old = run(u, P, 'passed', { tools: { node: '20.18.0', vitest: '5.0.5' } });
    const c = claim({ commit: P, checks: [u], runs: [old] });
    expect(selectionProblems(selectReruns(c), ['unit'], [])).toEqual([]);
    const v = verdict(c);
    expect(v.outcome).not.toBe('PASS');
    expect(checkOf(v, 'unit').counted).not.toContain(old.run);
    // A cache keyed by commit and check digest alone carries it.
    expect(selectionProblems(referenceSelect(c, 'commit-and-digest'), ['unit'], [])).toEqual(['unit must run again']);
  });
  it('AC28 nor to a journey whose viewport changed from 1280×720 to 1440×900', () => {
    const env = { browser: 'chromium-140.0.7339.0', locale: 'en-US', tz: 'UTC' };
    const j = check('journey:checkout', { depth: 'journey', proof: 'journey', environment: { ...env, viewport: '1440x900' } });
    const old = run(j, P, 'passed', { environment: { ...env, viewport: '1280x720' } });
    const c = claim({ commit: P, requirements: [requirement(1, { depth: 'journey' })], checks: [j], runs: [old] });
    expect(selectionProblems(selectReruns(c), ['journey:checkout'], [])).toEqual([]);
    expect(verdict(c).outcome).not.toBe('PASS');
    expect(selectionProblems(referenceSelect(c, 'commit-and-digest'), ['journey:checkout'], [])).toEqual(['journey:checkout must run again']);
  });
});

describe('AC31 each requirement outcome lists the runs it counted, by handle', () => {
  const C = commitOf('C');
  const D = commitOf('D-31');
  const A = check('A', { inputs: ['src/**'], covers: [reqId(1)] });
  const B = check('B', { inputs: ['docs/**'], covers: [reqId(2)] });
  const aAtC = run(A, C, 'passed'), bAtC = run(B, C, 'passed'), aAtD = run(A, D, 'passed');
  const c = claim({ commit: D, requirements: [requirement(1), requirement(2)], checks: [A, B], runs: [aAtC, bAtC, aAtD], changes: [{ from: C, paths: ['src/a.ts'] }] });
  it('AC31 B\'s PASS at C carries to D: B\'s requirement on D lists B\'s run at C', () => {
    const v = verdict(c);
    expect(v.outcome).toBe('PASS');
    expect(reqOf(v, reqId(2)).outcome).toBe('PASS');
    expect(reqOf(v, reqId(2)).runs.counted, `${reqId(2)} lists the carried run`).toContain(bAtC.run);
    expect(reqOf(v, reqId(1)).runs.counted).toContain(aAtD.run);
    expect(reqOf(v, reqId(1)).runs.counted, 'A\'s run at C doesn\'t carry: its input changed').not.toContain(aAtC.run);
    // An engine that counts only runs made on D leaves B with no run.
    const noCarry = referenceVerdict(c, 'no-carry');
    expect(noCarry.checks.find((r) => r.check === 'B')!.counted).not.toContain(bAtC.run);
    expect(noCarry.outcome).not.toBe('PASS');
  });
  it('AC31 the reference function recomputes D\'s verdict from exactly the listed runs', () => {
    const v = verdict(c);
    const listed = new Set([...v.requirements.flatMap((r) => r.runs.counted), ...v.checks.flatMap((r) => r.counted)]);
    const again = referenceVerdict({ ...c, runs: c.runs.filter((r) => listed.has(r.run)) });
    expect(again.outcome).toBe(v.outcome);
    for (const r of again.checks) expect([...r.counted].sort(), r.check).toEqual([...checkOf(v, r.check).counted].sort());
  });
});
