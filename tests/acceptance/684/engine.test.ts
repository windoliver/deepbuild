// #684 AC5, AC6 and AC7 (the engine's side): the three engine fixes, through @deepbuild/verdicts' public entry.
// Each is a fix, so each test fails on the merge base at its assertion: the base engine runs, and gives the
// order-dependent verdict, the PASS, or the silent fall to pending that the issue describes.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { selectReruns, verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, ContractResult, NumericContract, Requirement, Run, RunOutcome, Verdict } from '../../../packages/verdicts/src/index.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** 2026-10-01 12:00 UTC. */
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const commitOf = (name: string): string => sha256(`commit ${name}`).slice(0, 40);
const DEF = 'req:01K7G684A1B2C3D4E5F6G7H8J9';
const reqId = (n: number): string => `${DEF}#R${n}`;
const ENV = { os: 'darwin-arm64', locale: 'en-US', tz: 'UTC' };
const TOOLS = { node: '24.22.0', vitest: '5.0.5' };
const D = commitOf('D');

function requirement(n: number, over: Partial<Requirement> = {}): Requirement {
  return { req: reqId(n), depth: 'unit', oracle: 'code', on_base: 'passes', ...over };
}
function check(id: string, over: Partial<ClaimCheck> = {}): ClaimCheck {
  return {
    check: id, digest: `d1:${sha256(`check ${id}`)}`, source: 'definition', depth: 'unit', proof: 'test_run', covers: [reqId(1)],
    inputs: ['src/**'], environment: { ...ENV }, tools: { ...TOOLS }, ...over,
  };
}
function run(c: ClaimCheck, commit: string, outcome: RunOutcome, handle: string, over: Partial<Run> = {}): Run {
  const r: Run = {
    run: handle, check: c.check, claim: 'claim:01K7G684Z3X5V7T9R1P3N5M7K9', commit, digest: c.digest,
    environment: { ...c.environment }, tools: { ...c.tools }, outcome, ended: T0 + 1000, tests_run: outcome === 'passed' || outcome === 'failed' ? 12 : 0,
    reads: [], failures: outcome === 'failed'
      ? [{ test: `${c.check}.test.ts › holds`, message: 'expected 1800 to be 1801', cause: 'change:c1', frames: [{ file: 'src/total.ts', line: 42 }], covers: ['src/total.ts'], case: null }]
      : [],
    evidence: [{ slot: 'report', state: 'captured', sha256: sha256(`report ${handle}`) }], kept: true,
  };
  return { ...r, ...over };
}
function claim(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim: 'claim:01K7G684Z3X5V7T9R1P3N5M7K9', agent: 'session:01K7G684S1T2V3W4X5Y6Z7A8B9', repo: 'shop', task: 'task:01K7G684B4D6F8H0K2M4P6R8T0',
    commit: D, requirements: [requirement(1)], checks: [], runs: [], changes: [], waivers: [], now: T0 + 10 * 86_400_000, ...over,
  };
}
const checkOf = (v: Verdict, id: string) => {
  const found = v.checks.find((c) => c.check === id);
  if (!found) throw new Error(`the verdict has no result for check ${id}`);
  return found;
};
/** The per-check stale mark (README: The surface under test): a text naming each file, or null. */
const staleOf = (v: Verdict, id: string): unknown => (checkOf(v, id) as { stale?: unknown }).stale;
const said = (v: Verdict): string => v.reasons.join('\n');

describe('AC5 two records with one run ID and different outcomes', () => {
  const unit = check('unit');
  const passed = run(unit, D, 'passed', 'run:01K7G684DUP0000000000001');
  const failed = run(unit, D, 'failed', 'run:01K7G684DUP0000000000001');

  it('AC5 give the same verdict in both orders: INVALID, naming the run ID, while one record sent twice changes nothing (on the merge base, PASS in one order and FAIL in the other)', () => {
    const first = verdict(claim({ checks: [unit], runs: [passed, failed] }));
    const second = verdict(claim({ checks: [unit], runs: [failed, passed] }));
    const both = `passed then failed: ${first.outcome}; failed then passed: ${second.outcome}`;
    expect(first.outcome, both).toBe('INVALID');
    expect(second.outcome, both).toBe('INVALID');
    for (const v of [first, second]) {
      expect(checkOf(v, 'unit').outcome, 'the run\'s check is INVALID').toBe('INVALID');
      expect(said(v), 'the reasons name the run ID').toContain('run:01K7G684DUP0000000000001');
    }
    // Clean twins: one record sent twice changes nothing.
    expect(verdict(claim({ checks: [unit], runs: [passed, passed] })).outcome, 'a passed record sent twice').toBe('PASS');
    expect(verdict(claim({ checks: [unit], runs: [failed, failed] })).outcome, 'a failed record sent twice').toBe('FAIL');
  });
});

describe('AC6 a contract report INVALID with empty reasons', () => {
  const CONTRACT: NumericContract = {
    reference: { precision: 'fp64' }, accumulate: 'fp32', twin: { accumulate: 'fp16' }, assert: 'assert_close',
    tolerances: [{ output: 'sum', size: 4, atol: 1e-3, rtol: 1e-3, unit: 'value' }],
  };
  const report = (outcome: ContractResult['outcome']): ContractResult => ({
    run: { outcome: 'passed', failed_at: null, compared: { sum: 4 }, largest_error: { sum: 0 } },
    twin: { outcome: 'failed', failed_at: 'assert_close', compared: { sum: 4 }, largest_error: { sum: 0.0039 } },
    outcome, reasons: [],
  });
  const kernel = check('kernel:softmax', { contract: CONTRACT, covers: [reqId(1)] });
  const numbers = [requirement(1, { numbers: true })];

  it('AC6 makes a passed run\'s check INVALID, naming the check, while one whose report counts passes (on the merge base, PASS)', () => {
    const v = verdict(claim({ requirements: numbers, checks: [kernel], runs: [run(kernel, D, 'passed', 'run:01K7G684CON0000000000001', { contract: report('INVALID') })] }));
    expect(checkOf(v, 'kernel:softmax').outcome).toBe('INVALID');
    expect(v.outcome).toBe('INVALID');
    expect(said(v), 'the reasons name the check').toContain('kernel:softmax');
    // Clean twin: the same run whose report counts passes.
    const twin = verdict(claim({ requirements: numbers, checks: [kernel], runs: [run(kernel, D, 'passed', 'run:01K7G684CON0000000000002', { contract: report('counts') })] }));
    expect(twin.outcome, 'the same run whose report counts').toBe('PASS');
  });
});

describe('AC7 a late run on the parent whose reads withdraw a carried result (the spike\'s counterexample)', () => {
  // Check k declares lib/** and needs 2 runs; check s declares src/**. The claim is on D, whose change from its
  // parent C touches only src/x.ts: no input k declares, and covered by s's src/**, so k's runs on C carry to D.
  const C = commitOf('C');
  const k = check('k', { inputs: ['lib/**'], runs: 2, covers: [reqId(1)] });
  const s = check('s', { inputs: ['src/**'], covers: [reqId(2)] });
  const sPass = run(s, D, 'passed', 'run:01K7G684S00000000000000001', { ended: T0 + 2 });
  const late = run(k, C, 'passed', 'run:01K7G684K00000000000000002', { reads: ['lib/k.ts', 'src/x.ts'], ended: T0 + 3 });
  const base = (carried: Run[]): ClaimInput => claim({
    requirements: [requirement(1), requirement(2)], checks: [k, s], runs: [...carried, sPass], changes: [{ from: C, paths: ['src/x.ts'] }],
  });

  it('AC7 a carried missing run, then a late run of k on C that read src/x.ts: k is stale naming src/x.ts, runs again on the claim\'s commit, and the claim never passes on the withdrawn carry (on the merge base it falls from BLOCKED to pending, with no stale mark)', () => {
    const carried = run(k, C, 'missing', 'run:01K7G684K00000000000000001', { ended: T0 + 1, missing: { cause: 'secret STRIPE_TEST_KEY not set', owner: 'you', since: T0 } });
    const before = verdict(base([carried]));
    expect(before.outcome, 'the carried missing run makes the claim BLOCKED').toBe('BLOCKED');
    expect(checkOf(before, 'k').counted).toContain(carried.run);

    const withLate: ClaimInput = { ...base([carried]), runs: [...base([carried]).runs, late] };
    const after = verdict(withLate);
    const stale = staleOf(after, 'k');
    expect(typeof stale === 'string' && stale.includes('src/x.ts'), `k is marked stale, naming src/x.ts; stale is ${JSON.stringify(stale)}`).toBe(true);
    expect(checkOf(after, 'k').counted, 'k counts no run: neither the withdrawn carry nor the late run on C').toEqual([]);
    expect(checkOf(after, 'k').outcome).toBe('pending');
    expect(after.outcome).not.toBe('PASS');
    expect(selectReruns(withLate).rerun, 'k runs again on the claim\'s commit, s keeps its run').toEqual(['k']);

    // Once k's runs on D land, it is judged on them alone.
    const fresh = [run(k, D, 'passed', 'run:01K7G684K00000000000000003', { ended: T0 + 4 }), run(k, D, 'passed', 'run:01K7G684K00000000000000004', { ended: T0 + 5 })];
    const done = verdict({ ...withLate, runs: [...withLate.runs, ...fresh] });
    expect([...checkOf(done, 'k').counted].sort()).toEqual(fresh.map((r) => r.run));
    expect(done.outcome).toBe('PASS');
  });

  it('AC7 a carried PASS withdrawn the same way is stale, never PASS', () => {
    const carried = [
      run(k, C, 'passed', 'run:01K7G684K00000000000000005', { ended: T0 + 1 }),
      run(k, C, 'passed', 'run:01K7G684K00000000000000006', { ended: T0 + 1 }),
    ];
    expect(verdict(base(carried)).outcome, 'two clean runs on C carry to D').toBe('PASS');
    const withLate: ClaimInput = { ...base(carried), runs: [...base(carried).runs, late] };
    const after = verdict(withLate);
    const stale = staleOf(after, 'k');
    expect(typeof stale === 'string' && stale.includes('src/x.ts'), `k is marked stale, naming src/x.ts; stale is ${JSON.stringify(stale)}`).toBe(true);
    expect(checkOf(after, 'k').counted).toEqual([]);
    expect(after.outcome).not.toBe('PASS');
    expect(selectReruns(withLate).rerun).toEqual(['k']);
  });
});
