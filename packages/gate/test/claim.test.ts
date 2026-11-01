// A claim's verdict from command runs (#30): each recorded run becomes the engine's run record and the core's
// masked-exit rule makes a masked command one that can't fail. These are the mapping's own regressions on recorded
// runs; the acceptance suite (tests/acceptance/30/claims.test.ts) makes every run for real.
import { describe, expect, it } from 'vitest';
import type { NumericContract } from '@deepbuild/verdicts';
import { claimVerdict, type ClaimedCheck, type ClaimedRuns, type RecordedRun } from '../src/index.ts';

const REQ = 'req:30#R1';
const sha = (c: string): string => c.repeat(64);
let n = 0;
function recorded(outcome: RecordedRun['outcome'], over: Partial<RecordedRun> = {}): RecordedRun {
  n++;
  return {
    run: `run:R${n}`, outcome, testsRun: outcome === 'passed' || outcome === 'failed' ? 2 : 0, failures: [], evidence: [], read: ['src/cart.ts'], mask: null,
    exit: outcome === 'missing' ? null : { code: outcome === 'passed' ? 0 : 1, signal: null, cause: outcome === 'overran' ? 'deadline' : outcome === 'stopped' ? 'stop' : 'exit' },
    output: { stdout: 'out', stderr: '', sha256: { stdout: sha(String(n % 10)), stderr: sha('e') } }, attempts: [], seeded: [], contract: null, ...over,
  };
}
const failing = (test: string, file = 'src/cart.test.ts', line = 30) => ({ test, file, line, stack: null, assertion: true, message: `expected 12 to be 11` });
function claimOf(check: Partial<ClaimedCheck> & { runs: RecordedRun[] }, requirement: Record<string, unknown> = {}): ClaimedRuns {
  return {
    claim: 'claim:30', agent: 'session:A', repo: 'repo:dh30', task: 'task:30', commit: '0'.repeat(40),
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes', ...requirement }],
    checks: [{ check: 'cart', command: 'node_modules/.bin/vitest run', source: 'spec', covers: [REQ], ...check }], now: 1_700_000_000_000,
  };
}
const said = (v: { reasons: string[] }): string => v.reasons.join('\n');

describe('claimVerdict (#30)', () => {
  it('a masked command can\'t fail: the claim is INVALID naming "exit status masked by `|| true`", and its uncounted run counts for nothing', () => {
    const v = claimVerdict(claimOf({ command: 'npm test || true', runs: [recorded('uncounted', { mask: '|| true' })] }));
    expect(v.outcome).toBe('INVALID');
    expect(said(v)).toMatch(/cart: can't fail: exit status masked by `\|\| true`/);
  });
  it('the planted gate reads the exit alone: no masked-exit rule, a clean exit passes', () => {
    const v = claimVerdict(claimOf({ command: 'npm test || true', runs: [recorded('passed')] }), { plant: 'exit-code-only' });
    expect(v.outcome).toBe('PASS');
    expect(claimVerdict(claimOf({ command: 'npm test || true', runs: [recorded('passed', { exit: { code: 1, signal: null, cause: 'exit' } })] }), { plant: 'exit-code-only' }).outcome).toBe('FAIL');
  });
  it('a run that ran nothing is INVALID naming the check', () => {
    const v = claimVerdict(claimOf({ check: 'skipped-suite', runs: [recorded('ran_nothing')] }));
    expect(v.outcome).toBe('INVALID');
    expect(said(v)).toMatch(/skipped-suite: ran nothing/);
  });
  it('an overran run is a failed run naming the deadline; a crash is failed; a stopped run is INCONCLUSIVE', () => {
    const over = claimVerdict(claimOf({ deadline: '25 s', runs: [recorded('overran')] }));
    expect(over.outcome).toBe('FAIL');
    expect(said(over)).toMatch(/overran its deadline 25 s/);
    expect(claimVerdict(claimOf({ runs: [recorded('failed')] })).outcome).toBe('FAIL');
    const stopped = claimVerdict(claimOf({ runs: [recorded('stopped')] }));
    expect(stopped.outcome).toBe('INCONCLUSIVE');
    expect(said(stopped)).toMatch(/stopped/);
  });
  it('a FAIL points to the failure\'s file and line from the record, and its smallest case names the test', () => {
    const v = claimVerdict(claimOf({ runs: [recorded('failed', { failures: [failing('totals the prices')] })] }));
    expect(v.outcome).toBe('FAIL');
    expect(v.points_to?.frames).toEqual(['src/cart.test.ts:30']);
    expect(v.requirements[0]!.points_to).toContain('src/cart.test.ts:30');
    expect(v.smallest).toMatch(/totals the prices/);
  });
  it('every run is counted and each run\'s output digests are the requirement\'s evidence', () => {
    const runs = [recorded('passed'), recorded('passed'), recorded('failed', { failures: [failing('the trial is still open', 'test/trial.test.ts', 5)] })];
    const v = claimVerdict(claimOf({ runs }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(said(v)).toMatch(/the trial is still open/);
    expect([...v.requirements[0]!.runs.counted].sort()).toEqual(runs.map((r) => r.run).sort());
    expect(v.requirements[0]!.evidence).toContain(runs[2]!.output.sha256.stdout);
  });
  it('a test that failed and passed on its attempts leaves the claim INCONCLUSIVE naming it', () => {
    const v = claimVerdict(claimOf({ runs: [recorded('passed', { attempts: [{ test: 'settles the order', outcome: 'failed' }, { test: 'settles the order', outcome: 'passed' }] })] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(said(v)).toMatch(/settles the order/);
  });
  it('a stand-in the run seeded leaves a requirement about real users INCONCLUSIVE naming the table and file', () => {
    const seeded = recorded('passed', { seeded: [{ name: 'policies', by: 'scripts/seed.ts', standIn: true }, { name: 'users', by: 'scripts/seed.ts', standIn: false }] });
    const v = claimVerdict(claimOf({ runs: [seeded] }, { real_users: true }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(said(v)).toMatch(/`policies` from `scripts\/seed\.ts` as a stand-in/);
    expect(said(v)).not.toMatch(/`users`/);
    expect(claimVerdict(claimOf({ runs: [recorded('passed', { seeded: [{ name: 'policies', by: 'scripts/seed.ts', standIn: false }] })] }, { real_users: true })).outcome).toBe('PASS');
  });
  describe('a numeric contract', () => {
    const CONTRACT: NumericContract = { reference: { precision: 'fp64' }, accumulate: 'fp32', tolerances: [{ output: 'out', size: 4_096_000, atol: 1e-3, rtol: 1e-4, unit: '1' }], twin: { accumulate: 'fp16' }, assert: 'matmul matches' };
    const count = (compared: number | null) => [{ output: 'out', size: 4_096_000, compared, largest_error: compared === null ? null : 1e-5 }];
    it('a count below the output\'s size is INVALID naming the output; a missing count too; the full count counts', () => {
      const sample = claimVerdict(claimOf({ contract: CONTRACT, runs: [recorded('passed', { contract: count(40_960) })] }, { numbers: true }));
      expect(sample.outcome).toBe('INVALID');
      expect(said(sample)).toMatch(/output out: 40960 of 4096000 elements compared/);
      const silent = claimVerdict(claimOf({ contract: CONTRACT, runs: [recorded('passed', { contract: count(null) })] }, { numbers: true }));
      expect(silent.outcome).toBe('INVALID');
      expect(said(silent)).toMatch(/output out: no count in the report/);
      const full = claimVerdict(claimOf({ contract: CONTRACT, runs: [recorded('passed', { contract: count(4_096_000) })] }, { numbers: true }));
      expect(full.outcome).toBe('PASS');
      expect(full.requirements[0]!.outcome).toBe('PASS');
    });
  });
  it('a check whose only run is uncounted is pending while the gate may start more, and short of clean runs once it ended', () => {
    const uncounted = recorded('uncounted', { mask: 'untraced program grep in .deepbuild/checks/a.sh' });
    expect(claimVerdict(claimOf({ runs: [uncounted] })).outcome).toBe('pending');
    const ended = claimVerdict(claimOf({ runs: [uncounted], state: 'ended' }));
    expect(ended.outcome).toBe('INCONCLUSIVE');
    expect(said(ended)).toMatch(/0 of 1 clean runs/);
    expect(ended.key.check_digests[0], 'the check\'s digest as the record names one').toMatch(/^d1:[0-9a-f]{64}$/);
  });
  it('a run that never started is missing, and the claim is BLOCKED naming its cause', () => {
    const v = claimVerdict(claimOf({ runs: [recorded('missing', { failures: [{ ...failing('(run)'), message: 'pnpm isn\'t on the run\'s PATH' }] })] }));
    expect(v.outcome).toBe('BLOCKED');
    expect(said(v)).toMatch(/pnpm isn't on the run's PATH/);
  });
});
