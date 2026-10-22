// Regressions the acceptance suite (tests/acceptance/28) doesn't reach: exact run counts at the edges of a
// decimal rate, claims with no requirements, waived runs, open item IDs, where a FAIL points, and `**/` globs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import { conductRun, markStale, recordVerdict, runContract, runsNeeded, selectReruns, staleReason, verdict, verdictHash } from '../src/index.js';
import type { ClaimCheck, ClaimInput, Failure, Run } from '../src/index.js';

const D = 'd'.repeat(40), C = 'c'.repeat(40);
const REQ = 'req:DEF#R1';
function check(id: string, over: Partial<ClaimCheck> = {}): ClaimCheck {
  return { check: id, digest: `d1:${'0'.repeat(64)}`, source: 'definition', depth: 'unit', proof: 'test_run', covers: [REQ], inputs: ['src/**'], environment: {}, tools: {}, ...over };
}
let n = 0;
function run(c: ClaimCheck, outcome: Run['outcome'], over: Partial<Run> = {}): Run {
  n++;
  return {
    run: `run:R${n}`, check: c.check, claim: 'claim:X', commit: D, digest: c.digest, environment: {}, tools: {}, outcome, ended: n,
    tests_run: outcome === 'passed' || outcome === 'failed' ? 1 : 0, reads: [], failures: [], evidence: [], kept: true, ...over,
  };
}
const failure = (test: string, over: Partial<Failure> = {}): Failure =>
  ({ test, message: `${test} broke`, cause: 'change:mine', frames: [{ file: `src/${test}.ts`, line: 1 }], covers: [`src/${test}.ts`], case: `${test} case`, ...over });
function claim(over: Partial<ClaimInput>): ClaimInput {
  return {
    claim: 'claim:X', agent: 'session:A', repo: 'shop', task: 'task:T', commit: D,
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes' }], checks: [], runs: [], changes: [], waivers: [], now: 0, ...over,
  };
}

describe('runsNeeded at the edges of a decimal rate', () => {
  it('a rate whose 1 − p rounds to 1 in floating point is BLOCKED at once, never a hang', () => {
    const started = performance.now();
    expect(runsNeeded({ accept: '0.0000000000000001%' }).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('a rate written with 400 trailing zeros is still exactly 10%', () => {
    expect(runsNeeded({ accept: `10.${'0'.repeat(400)}%` })).toEqual({ ok: true, needed: 29 });
  });
  it('a rate that needs tens of thousands of runs is counted in well under a verdict budget', () => {
    const started = performance.now();
    const r = runsNeeded({ accept: '0.0046%' });
    expect(r.ok && r.needed > 60_000).toBe(true);
    expect(performance.now() - started).toBeLessThan(10);
  });
});

describe('runsNeeded on a long rate whose estimate lands near a whole number', () => {
  it('is counted exactly and fast', () => {
    const p = 1 - Math.pow(0.05, 1 / 50000);
    const accept = `${(p * 100).toPrecision(17)}${'0'.repeat(200)}1%`;
    const started = performance.now();
    expect(runsNeeded({ accept })).toEqual({ ok: true, needed: 50000 });
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('needs you', () => {
  it('a flaky own check\'s item stays out of it, and so does its requirement\'s, with no approval asked for a check that didn\'t pass', () => {
    const own = check('own', { source: 'own', runs: 3 });
    const v = verdict(claim({ checks: [own], runs: [run(own, 'passed'), run(own, 'failed', { failures: [failure('t')] })] }));
    expect(v.open_items.find((i) => i.check === 'own')?.needs_you).toBe(false);
    expect(v.open_items.find((i) => i.check === null)?.needs_you).toBe(false);
  });
  it('a passing own check\'s requirement item is in it, with the approval ask', () => {
    const own = check('own', { source: 'own' });
    const v = verdict(claim({ checks: [own], runs: [run(own, 'passed')] }));
    expect(v.open_items.find((i) => i.check === null)?.needs_you).toBe(true);
    expect(v.asks.map((a) => a.kind)).toEqual(['authority']);
  });
  it('a FAIL check raises no unblock ask for a missing run its FAIL outranks', () => {
    const c = check('u', { runs: 2 });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('t')] }), run(c, 'missing', { missing: { cause: 'secret K', owner: 'you', since: 0 } })] }));
    expect(v.outcome).toBe('FAIL');
    expect(v.asks).toEqual([]);
    expect(v.open_items.map((i) => i.needs_you)).toEqual([false]);
  });
});

describe('runContract', () => {
  it('keeps a NaN as the largest error', () => {
    const contract = { reference: { precision: 'fp64' as const }, accumulate: 'fp32' as const, tolerances: [{ output: 'y', size: 2, atol: 1e-3, rtol: 0, unit: 'value' }], twin: { accumulate: 'fp16' as const }, assert: 'assert_close' };
    const r = runContract(contract, { reference: () => ({ y: [1, 1] }), underTest: () => ({ y: [Number.NaN, 1.0002] }) });
    expect(r.run.largest_error.y).toBeNaN();
  });
  it('fails the run when the code under test returns more elements than the reference', () => {
    const contract = { reference: { precision: 'fp64' as const }, accumulate: 'fp32' as const, tolerances: [{ output: 'y', size: 2, atol: 1e-3, rtol: 0, unit: 'value' }], twin: { accumulate: 'fp16' as const }, assert: 'assert_close' };
    const r = runContract(contract, { reference: () => ({ y: [1, 2] }), underTest: () => ({ y: [1, 2, 999, Number.NaN] }) });
    expect(r.run.outcome).toBe('failed');
    expect(r.run.failed_at).toBe('assert_close');
  });
});

describe('predictions first', () => {
  const c = check('unit', { runs: 2 });
  it('a run that disagrees with a prediction recorded before it is a contradiction, and the verdict is the runs\' alone', () => {
    const runs = [run(c, 'passed', { started: 10, ended: 11 }), run(c, 'failed', { started: 12, ended: 13, failures: [failure('t')] })];
    const v = verdict(claim({ checks: [c], runs, predictions: [{ check: 'unit', expects: 'passed', at: 5 }] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(v.contradictions).toEqual([{ check: 'unit', run: runs[1]!.run, predicted: 'passed', outcome: 'failed', late: false }]);
    expect(v.reasons.join(' ')).toContain('predicted');
  });
  it('a prediction recorded after a run started predicts nothing, and is shown as late', () => {
    const runs = [run(c, 'failed', { started: 10, ended: 20, failures: [failure('t')] }), run(c, 'failed', { started: 21, ended: 22, failures: [failure('t')] })];
    const v = verdict(claim({ checks: [c], runs, predictions: [{ check: 'unit', expects: 'failed', at: 15 }] }));
    expect(v.contradictions).toEqual([{ check: 'unit', run: runs[0]!.run, predicted: 'failed', outcome: 'failed', late: true }]);
  });
  it('a prediction never moves a verdict or its hash: a passing claim predicted to fail still passes', () => {
    const runs = [run(c, 'passed', { started: 10, ended: 11 }), run(c, 'passed', { started: 12, ended: 13 })];
    const v = verdict(claim({ checks: [c], runs, predictions: [{ check: 'unit', expects: 'failed', at: 1 }, { check: 'unit', expects: 'failed', at: 1 }] }));
    expect(v.outcome).toBe('PASS');
    expect(v.contradictions.map((x) => x.run)).toEqual(runs.map((r) => r.run));
    expect(verdictHash(v)).toBe(verdictHash(verdict(claim({ checks: [c], runs }))));
  });
  it('a run whose start is recorded after its end can\'t be shown to follow its prediction either', () => {
    const runs = [run(c, 'failed', { started: 100, ended: 50, failures: [failure('t')] }), run(c, 'failed', { started: 100, ended: 51, failures: [failure('t')] })];
    const v = verdict(claim({ checks: [c], runs, predictions: [{ check: 'unit', expects: 'failed', at: 75 }] }));
    expect(v.contradictions.map((x) => x.late)).toEqual([true, true]);
  });
  it('a thousand predictions on a thousand runs are judged in well under a verdict budget', () => {
    const wide = check('unit', { runs: 1000 });
    const runs = Array.from({ length: 1000 }, (_, i) => run(wide, 'passed', { started: 10, ended: i + 11 }));
    const predictions = Array.from({ length: 1000 }, (_, i) => ({ check: 'unit', expects: 'failed' as const, at: i % 7 }));
    const started = performance.now();
    const v = verdict(claim({ checks: [wide], runs, predictions }));
    expect(performance.now() - started).toBeLessThan(100);
    expect(v.outcome).toBe('PASS');
    expect(v.contradictions).toHaveLength(1000);
  });
  it('a run with no start time can\'t be shown to follow its prediction, so the prediction reads late', () => {
    const runs = [run(c, 'failed', { ended: 20, failures: [failure('t')] }), run(c, 'failed', { ended: 22, failures: [failure('t')] })];
    const v = verdict(claim({ checks: [c], runs, predictions: [{ check: 'unit', expects: 'failed', at: 1 }] }));
    expect(v.contradictions.map((x) => x.late)).toEqual([true, true]);
  });
});

describe('a verdict on a workspace', () => {
  const c = check('unit');
  const state = ['1'.repeat(64), '2'.repeat(64)];
  it('pins to the digests of what its state sources read, and reads stale when one drifts', () => {
    const v = verdict(claim({ checks: [c], runs: [run(c, 'passed')], state }));
    expect(v.key.state_digests).toEqual(state);
    expect(staleReason(v, D, [...state].reverse())).toBeNull();
    expect(staleReason(v, D, [state[0]!, '3'.repeat(64)])).toContain('3'.repeat(64));
  });
  it('a state digest that isn\'t a sha256 makes the claim INVALID naming it, never a verdict that can\'t be recorded', () => {
    const v = verdict(claim({ checks: [c], runs: [run(c, 'passed')], state: ['host:gpu-box sha256:' + '1'.repeat(64)] }));
    expect(v.outcome).toBe('INVALID');
    expect(v.reasons.join(' ')).toContain('host:gpu-box');
    expect(v.open_items).toHaveLength(1);
    expect(v.open_items[0]!.closes_with.evidence).toContain('sha256');
  });
  it('is recorded, and marked stale on drift, through the record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deep-verdicts-'));
    try {
      const record = await openRecord({ path: join(dir, 'record.db'), now: () => 1 });
      const v = verdict(claim({ claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9K', checks: [c], runs: [run(c, 'passed')], state }));
      const recorded = await recordVerdict(record, v, 2);
      await expect(markStale(record, recorded, v, D, 3, state)).resolves.toBe(false);
      await expect(markStale(record, recorded, v, D, 4, [state[0]!, '3'.repeat(64)])).resolves.toBe(true);
      await record.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evidence that isn\'t captured and complete', () => {
  it.each<[string, Run['evidence'][number], string]>([
    ['captured with no digest', { slot: 'screenshot', state: 'captured' }, 'no digest'],
    ['captured with a digest that isn\'t one', { slot: 'screenshot', state: 'captured', sha256: 'nope' }, 'no digest'],
    ['in a state outside the closed set', { slot: 'screenshot', state: 'weird' as 'captured' }, 'unknown state weird'],
  ])('%s never supports a PASS', (_, slot, words) => {
    const c = check('unit');
    const v = verdict(claim({ checks: [c], runs: [run(c, 'passed', { evidence: [slot] })] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(v.open_items[0]!.closes_with.evidence).toContain('screenshot');
    expect(v.reasons.join(' ')).toContain(words);
  });
});

describe('the engine is pure', () => {
  it('judges a claim object changed between calls from what it holds now, not from what it held', () => {
    const c = check('unit', { runs: 1, base: { outcome: 'failed', on_assertion: true, failed_tests: ['tax'] } });
    const input = claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('tax', { cause: 'red-main' })] })] });
    expect(verdict(input).outcome).toBe('BLOCKED');
    input.requirements[0]!.on_base = 'fails';
    const again = verdict(input);
    expect(again.outcome).toBe('FAIL');
    expect(again.send_backs.map((b) => b.cause)).toEqual(['red-main']);
    expect(again.fix_tasks).toEqual([]);
  });
});

describe('a claim with no requirements', () => {
  it('covered only by its own agent\'s checks never passes', () => {
    const own = check('own', { source: 'own', covers: [] });
    const v = verdict(claim({ requirements: [], checks: [own], runs: [run(own, 'passed')] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(v.asks.map((a) => a.check)).toEqual(['own']);
  });
});

describe('a waived failure', () => {
  it('ends a check\'s runs as the hub\'s count does, so a check whose only failures are waived is never left pending', () => {
    const c = check('a');
    const waived = run(c, 'failed', { failures: [failure('tax', { message: 'known' })] });
    const v = verdict(claim({ checks: [c], runs: [waived], waivers: [{ check: 'a', error: 'known', owner: 'you', approved_by: 'you', ends: { condition: 'upstream', met: false } }] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
  });
});

describe('a run with one waived failure and one new one', () => {
  it('fails on the new one alone: one send-back, the new failure the smallest case, the waived test unnamed', () => {
    const c = check('unit', { runs: 1 });
    const runs = [run(c, 'failed', { failures: [failure('upstream', { message: 'ECONNRESET upstream', cause: 'change:upstream', case: 'known reset' }), failure('total', { cause: 'change:c1' })] })];
    const v = verdict(claim({ checks: [c], runs, waivers: [{ check: 'unit', error: 'ECONNRESET upstream', owner: 'you', approved_by: 'you', ends: { condition: 'upstream', met: false } }] }));
    expect(v.outcome).toBe('FAIL');
    expect(v.send_backs.map((b) => b.cause)).toEqual(['change:c1']);
    expect(v.smallest).toBe('total case');
    expect(v.reasons.join(' ')).not.toContain('upstream');
  });
});

describe('a fix check', () => {
  it('with no run on the merge base never passes', () => {
    const c = check('fix');
    const v = verdict(claim({ requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'fails' }], checks: [c], runs: [run(c, 'passed')] }));
    expect(v.outcome).toBe('INVALID');
  });
});

describe('a check with a numeric contract', () => {
  it('whose passed run has no contract report never passes', () => {
    const c = check('kernel', { contract: { reference: { precision: 'fp64' }, accumulate: 'fp32', tolerances: [{ output: 'o', size: 1, atol: 1e-3, rtol: 1e-3, unit: 'value' }], twin: { accumulate: 'fp16' }, assert: 'assert_close' } });
    const v = verdict(claim({ requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes', numbers: true }], checks: [c], runs: [run(c, 'passed')] }));
    expect(v.outcome).toBe('INVALID');
  });
});

describe('recording a verdict', () => {
  it('holds a clean count past 65535 within verdict.made\'s u16 field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deep-verdicts-'));
    try {
      const record = await openRecord({ path: join(dir, 'record.db'), now: () => 1 });
      const c = check('unit', { runs: 65535 });
      const runs = Array.from({ length: 65536 }, (_, i) => run(c, 'passed', { run: `run:B${i}` }));
      const v = verdict(claim({ claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', checks: [c], runs }));
      expect(v.outcome).toBe('PASS');
      await expect(recordVerdict(record, v, 2)).resolves.toMatchObject({ handle: expect.stringMatching(/^verdict:/) });
      // Sixty checks, each with its own environment profile, make a key longer than one field holds.
      const many = Array.from({ length: 60 }, (_, i) => check(`c${i}`, { environment: { browser: `chromium-140.0.${i}`, viewport: '1440x900', locale: 'en-US', tz: 'UTC', ua: 'x'.repeat(120) } }));
      const wide = verdict(claim({ claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9J', checks: many, runs: many.map((k) => run(k, 'passed', { environment: k.environment })) }));
      expect(wide.outcome).toBe('PASS');
      const recorded = await recordVerdict(record, wide, 3);
      expect(recorded.handle).toMatch(/^verdict:/);
      // A stale reason past verdict.stale's field still lands, cut to fit.
      await expect(markStale(record, recorded, wide, 'x'.repeat(9000), 4)).resolves.toBe(true);
      await record.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a send-back\'s smallest case', () => {
  it('comes from its own cause: an overrun beside an inherited failure points at the overrun', () => {
    const c = check('unit', { runs: 2, deadline: '90 s', base: { outcome: 'failed', on_assertion: true, failed_tests: ['tax'] } });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('tax', { cause: 'red-main' })] }), run(c, 'overran')] }));
    expect(v.outcome).toBe('FAIL');
    expect(v.send_backs).toEqual([{ cause: 'unit', checks: ['unit'], smallest: 'unit overran its deadline 90 s' }]);
    expect(v.smallest).toBe('unit overran its deadline 90 s');
  });
});

describe('an open item\'s ID', () => {
  it('doesn\'t depend on the order its runs ended', () => {
    const c = check('a');
    const missing = (cause: string, ended: number) => run(c, 'missing', { ended, missing: { cause, owner: 'ops', since: 0 } });
    const one = verdict(claim({ checks: [c], runs: [missing('secret X', 1), missing('secret Y', 2)] }));
    const two = verdict(claim({ checks: [c], runs: [missing('secret X', 2), missing('secret Y', 1)] }));
    expect(two.open_items.map((i) => i.id)).toEqual(one.open_items.map((i) => i.id));
  });
});

describe('where a FAIL points', () => {
  it('at a failure the merge base doesn\'t share, even when an earlier run failed only on inherited tests', () => {
    const c = check('npm test', { runs: 3, base: { outcome: 'failed', on_assertion: true, failed_tests: ['tax'] } });
    const v = verdict(claim({
      checks: [c],
      runs: [run(c, 'failed', { failures: [failure('tax')] }), run(c, 'failed', { failures: [failure('tax'), failure('coupon')] }), run(c, 'failed', { failures: [failure('coupon')] })],
    }));
    expect(v.outcome).toBe('FAIL');
    expect(v.smallest).toBe('coupon case');
    expect(v.points_to?.frames).toEqual(['src/coupon.ts:1']);
  });
});

describe('a glob that a backtracking matcher takes exponential time on', () => {
  it('is matched in linear time, so no check\'s inputs can stall a verdict', () => {
    const a = check('A'), b = check('B', { source: 'own', inputs: [`${'**/'.repeat(8)}z`] });
    const started = performance.now();
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C })], changes: [{ from: C, paths: [`${'a/'.repeat(40)}y`] }] }));
    expect(performance.now() - started).toBeLessThan(100);
    expect(sel.rerun).toEqual(['A', 'B']);
  });
});

describe('approving the agent\'s own check', () => {
  const own = check('own', { source: 'own' });
  it.each<[string, Run[], Partial<ClaimCheck>]>([
    ['failed', [run(own, 'failed', { failures: [failure('t')] })], {}],
    ['ran nothing', [run(own, 'passed', { tests_run: 0 })], {}],
    ['still running', [], { state: 'running' }],
  ])('isn\'t asked while it %s', (_, runs, over) => {
    const v = verdict(claim({ checks: [{ ...own, ...over }], runs }));
    expect(v.asks).toEqual([]);
    expect(v.open_items.every((i) => !i.needs_you)).toBe(true);
  });
});

describe('never the same question twice', () => {
  it('one missing secret two checks need is one unblock ask, and both checks\' items need you', () => {
    const unit = check('unit'), journey = check('journey', { depth: 'journey' });
    const missing = (c: ClaimCheck) => run(c, 'missing', { missing: { cause: 'secret STRIPE_KEY not set', owner: 'you', since: 0 } });
    const v = verdict(claim({ checks: [unit, journey], runs: [missing(unit), missing(journey)] }));
    expect(v.outcome).toBe('BLOCKED');
    expect(v.asks).toHaveLength(1);
    expect(v.asks[0]!.question).toContain('STRIPE_KEY');
    expect(v.open_items.map((i) => i.needs_you)).toEqual([true, true]);
  });
  it('one passing own check covering two requirements is one approve ask, and both requirements\' items need you', () => {
    const own = check('own', { source: 'own', covers: ['req:DEF#R1', 'req:DEF#R2'] });
    const reqs = ['req:DEF#R1', 'req:DEF#R2'].map((req) => ({ req, depth: 'unit' as const, oracle: 'code' as const, on_base: 'passes' as const }));
    const v = verdict(claim({ requirements: reqs, checks: [own], runs: [run(own, 'passed')] }));
    expect(v.asks).toHaveLength(1);
    expect(v.asks[0]!.question).toContain('req:DEF#R2');
    expect(v.open_items.filter((i) => i.check === null).map((i) => i.needs_you)).toEqual([true, true]);
  });
});

describe('a flaky check\'s open item', () => {
  it('names no clean runs still needed, since no more start on this commit', () => {
    const c = check('unit', { accept: '10%' });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('t')] }), run(c, 'passed')] }));
    const item = v.open_items.find((i) => i.check === 'unit')!;
    expect(item.text).not.toMatch(/clean runs/);
    expect(item.closes_with.evidence).not.toMatch(/clean runs/);
  });
});

describe('a stopped check\'s open item', () => {
  it('names no clean runs still needed, since no more start on this commit', () => {
    const c = check('unit', { runs: 3 });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'passed'), run(c, 'stopped')] }));
    const item = v.open_items.find((i) => i.check === 'unit')!;
    expect(item.closes_with.runs_needed).toBe(0);
    expect(item.text).not.toMatch(/clean runs/);
  });
});

describe('an own-only requirement\'s open item', () => {
  it('keeps one ID as its own checks\' runs land', () => {
    const a = check('A', { source: 'own' }), b = check('B', { source: 'own' });
    const id = (runs: Run[]) => verdict(claim({ checks: [a, b], runs })).open_items.find((i) => i.check === null)?.id;
    expect(id([run(b, 'passed')])).toBe(id([]));
  });
});

describe('a check with many missing causes', () => {
  it('judges twenty thousand of them in well under a second', () => {
    const c = check('unit');
    const runs = Array.from({ length: 20_000 }, (_, i) => run(c, 'missing', { missing: { cause: `secret K${i}`, owner: 'ops', since: 0 } }));
    const started = performance.now();
    expect(verdict(claim({ checks: [c], runs })).outcome).toBe('BLOCKED');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('a claim with no checks', () => {
  it('is INVALID with an open item, and its reason names each requirement', () => {
    const v = verdict(claim({ requirements: [{ req: 'req:DEF#R9', depth: 'unit', oracle: 'person', on_base: 'passes', ask: 'ask:A', answer: 'PASS' }] }));
    expect(v.outcome).toBe('INVALID');
    expect(v.open_items).toHaveLength(1);
    expect(v.reasons.join(' ')).toContain('req:DEF#R9');
  });
});

describe('a glob in syntax the matcher doesn\'t know', () => {
  it.each(['src/**/*.{ts,tsx}', './src/**', 'src/[ab].ts', 'src/?.ts'])('%s matches every path, so its check runs again rather than keep a stale PASS', (glob) => {
    const a = check('A', { inputs: [glob] }), b = check('B', { inputs: ['src/**'] });
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C }), run(b, 'passed', { commit: C }), run(b, 'passed')], changes: [{ from: C, paths: ['src/a.ts'] }] }));
    expect(sel.rerun).toEqual(['A']);
  });
});

describe('a glob the matcher can\'t read covers nothing for the other checks', () => {
  it('so a change no readable glob covers still reruns every check', () => {
    const a = check('A', { inputs: ['src/{a,b}.ts'] }), b = check('B', { inputs: ['docs/**'] });
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C }), run(b, 'passed', { commit: C })], changes: [{ from: C, paths: ['scripts/build.sh'] }] }));
    expect(sel.rerun).toEqual(['A', 'B']);
  });
});

describe('carrying from an earlier commit', () => {
  it('reads every Change named for that commit, so a later empty one hides no changed path', () => {
    const a = check('A', { inputs: ['src/**'] });
    const sel = selectReruns(claim({ checks: [a], runs: [run(a, 'passed', { commit: C })], changes: [{ from: C, paths: ['src/a.ts'] }, { from: C, paths: [] }] }));
    expect(sel.rerun).toEqual(['A']);
  });
  it('`src/**` doesn\'t cover the bare path `src`, so a change to it reruns every check', () => {
    const a = check('A', { inputs: ['src/**'] }), b = check('B', { inputs: ['docs/**'] });
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C }), run(b, 'passed', { commit: C })], changes: [{ from: C, paths: ['src'] }] }));
    expect(sel.rerun).toEqual(['A', 'B']);
  });
});

describe('a send-back for a failure with no shrunk case', () => {
  it('names the failing test as the verdict does', () => {
    const c = check('unit', { runs: 1 });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('t2', { case: null, message: 'm' })] })] }));
    expect(v.smallest).toBe('t2: m');
    expect(v.send_backs.map((b) => b.smallest)).toEqual(['t2: m']);
  });
});

describe('an inherited failure on a check another rule decides', () => {
  it('still gets its fix task', () => {
    const c = check('unit', { runs: 2, base: { outcome: 'failed', on_assertion: true, failed_tests: ['tax'] } });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'failed', { failures: [failure('tax', { cause: 'red-main' })] }), run(c, 'ran_nothing')] }));
    expect(v.outcome).toBe('INVALID');
    expect(v.fix_tasks).toEqual([{ cause: 'red-main', checks: ['unit'], tests: ['tax'] }]);
  });
});

describe('selecting reruns on a wide change', () => {
  it('ten checks and a thousand changed paths take well under a verdict budget', () => {
    const checks = Array.from({ length: 10 }, (_, i) => check(`c${i}`, { inputs: [`pkg${i}/**`, `pkg${i}/**/*.ts`] }));
    const paths = Array.from({ length: 1000 }, (_, i) => `pkg9/deep/folder/file${i}.ts`);
    const started = performance.now();
    const sel = selectReruns(claim({ checks, runs: checks.map((c) => run(c, 'passed', { commit: C })), changes: [{ from: C, paths }] }));
    expect(performance.now() - started).toBeLessThan(200);
    expect(sel.rerun).toEqual(['c9']);
  });
});

describe('runs carried from many earlier commits', () => {
  it('four thousand, each on its own commit, are selected in well under a verdict budget', () => {
    const a = check('a', { inputs: ['src/**'] }), b = check('b', { inputs: ['docs/**'] });
    const runs = Array.from({ length: 4000 }, (_, i) => run(a, 'passed', { commit: `${i}`.padStart(40, 'e') }));
    const changes = runs.map((r) => ({ from: r.commit, paths: ['docs/x.md'] }));
    const started = performance.now();
    const sel = selectReruns(claim({ checks: [a, b], runs, changes }));
    expect(performance.now() - started).toBeLessThan(100);
    expect(sel.rerun).toEqual(['b']);
  });
});

describe('a red main with a large suite', () => {
  it('three runs each failing the three thousand tests the base fails are judged in well under a second', () => {
    const tests = Array.from({ length: 3000 }, (_, i) => `t${i}`);
    const c = check('unit', { runs: 3, base: { outcome: 'failed', on_assertion: true, failed_tests: tests } });
    const runs = [0, 1, 2].map(() => run(c, 'failed', { failures: tests.map((t) => failure(t, { cause: 'red-main' })) }));
    const started = performance.now();
    const v = verdict(claim({ checks: [c], runs }));
    expect(performance.now() - started).toBeLessThan(150);
    expect(v.outcome).toBe('BLOCKED');
    expect(v.fix_tasks.map((t) => t.tests.length)).toEqual([3000]);
  });
});

describe('a glob literal outside the BMP', () => {
  it('matches its path, so only its own check runs again', () => {
    const a = check('a', { inputs: ['docs/😀.md'] }), b = check('b', { inputs: ['src/**'] });
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C }), run(b, 'passed', { commit: C })], changes: [{ from: C, paths: ['docs/😀.md'] }] }));
    expect(sel.rerun).toEqual(['a']);
  });
});

describe('conductRun', () => {
  it('fails conformance when the value a runner returns can\'t be read', async () => {
    const bad = { get outcome(): never { throw new Error('getter'); }, toJSON(): never { throw new Error('x'); }, [Symbol.toPrimitive](): never { throw new Error('x'); } };
    await expect(conductRun(async () => bad)).resolves.toMatchObject({ outcome: null, conforms: false });
  });
  it('leaves a run stopped when a runner throws a value that can\'t be printed', async () => {
    const odd = Object.create(null) as object;
    await expect(conductRun(async () => { throw odd; })).resolves.toMatchObject({ outcome: 'stopped', conforms: true });
    const error = new Error('x');
    Object.defineProperty(error, 'message', { get(): never { throw new Error('getter'); } });
    await expect(conductRun(async () => { throw error; })).resolves.toMatchObject({ outcome: 'stopped', conforms: true });
  });
});

describe('a waiver\'s error', () => {
  it('matches a failure that differs only by a space before its trailing full stop', () => {
    const c = check('a', { runs: 2 });
    const v = verdict(claim({ checks: [c], runs: [run(c, 'passed'), run(c, 'failed', { failures: [failure('t', { message: 'Expected 1 to be 2 .' })] }), run(c, 'passed')],
      waivers: [{ check: 'a', error: 'expected 1 to be 2', owner: 'you', approved_by: 'you', ends: { condition: 'upstream', met: false } }] }));
    expect(v.outcome).toBe('PASS');
  });
});

describe('`**/` matches zero folders', () => {
  it('a change to src/a.ts is an input of src/**/*.ts, so that check runs again', () => {
    const a = check('A', { inputs: ['src/**/*.ts'] }), b = check('B', { inputs: ['src/*.ts'] });
    const sel = selectReruns(claim({ checks: [a, b], runs: [run(a, 'passed', { commit: C }), run(b, 'passed', { commit: C })], changes: [{ from: C, paths: ['src/a.ts'] }] }));
    expect(sel.rerun.sort()).toEqual(['A', 'B']);
  });
});
