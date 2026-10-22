// #28 the rule table, whose checks count, send-backs, inheritance, asks and open items: AC1, AC3, AC5, AC6,
// AC7, AC9, AC10, AC11, AC12, AC13 (verdict half), AC15, AC16, AC23, AC24, AC26, AC32, the Oct 9 additions
// and Done when.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Result, Run, Waiver } from '../../../packages/verdicts/src/index.ts';
import { genClaim } from './generate.ts';
import { referenceVerdict } from './reference.ts';
import { check, checkOf, claim, COMMIT, commitOf, DAY, failure, highest, reqId, reqOf, requirement, RESULTS, run, T0, text } from './helpers.ts';

const SEED = 0x28_0001;
const RUNS = 1000;

/** A check covering requirement n that ends as `result`. */
function shaped(result: Result, n: number): { check: ClaimCheck; runs: Run[] } {
  const c = check(`c${n}`, { covers: [reqId(n)] });
  switch (result) {
    case 'PASS': return { check: c, runs: [run(c, COMMIT, 'passed')] };
    case 'FAIL': return { check: c, runs: [run(c, COMMIT, 'failed')] };
    case 'INVALID': return { check: c, runs: [run(c, COMMIT, 'ran_nothing')] };
    case 'BLOCKED': return { check: c, runs: [run(c, COMMIT, 'missing')] };
    case 'INCONCLUSIVE': return { check: c, runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'passed')] };
    case 'pending': return { check: { ...c, state: 'running' }, runs: [] };
  }
}
function claimOf(parts: { check: ClaimCheck; runs: Run[] }[], over: Partial<ClaimInput> = {}): ClaimInput {
  return claim({
    requirements: parts.map((_, i) => requirement(i + 1)),
    checks: parts.map((p) => p.check), runs: parts.flatMap((p) => p.runs), ...over,
  });
}

describe('AC1 property tests cover every precedence pair', () => {
  it(`AC1 for ${RUNS} seeded claims, two checks ending a and b give the higher of the two, and every pair is reached`, () => {
    const reached = new Set<string>();
    fc.assert(fc.property(
      fc.constantFrom(...RESULTS), fc.constantFrom(...RESULTS), fc.integer({ min: 0, max: 2 }), fc.boolean(),
      (a, b, extra, swap) => {
        const parts = [shaped(a, 1), shaped(b, 2)];
        for (let i = 0; i < extra; i++) parts.push(shaped('PASS', 3 + i));
        if (swap) parts.reverse();
        const v = verdict(claimOf(parts));
        reached.add([a, b].sort().join('+'));
        expect(v.outcome, `${a} with ${b}`).toBe(highest([a, b]));
      },
    ), { seed: SEED, numRuns: RUNS });
    expect(reached.size, 'all 21 pairs of the six results, each with itself').toBe(21);
  });
});

describe('AC3 a different error than the accepted one still fails', () => {
  const c = check('unit');
  const failing = (message: string) => run(c, COMMIT, 'failed', { failures: [failure('cart.test.ts › rounds tax', { message })] });
  const waiver = (over: Partial<Waiver> = {}): Waiver => ({ check: 'unit', error: 'Expected 42, received 41', owner: 'you', approved_by: 'you', ends: { date: T0 + 90 * DAY }, ...over });
  it('AC3 the accepted error, exact or after normalization, is not FAIL, and its run stays recorded', () => {
    for (const message of ['Expected 42, received 41', '  expected 42,   RECEIVED 41.']) {
      const r = failing(message);
      const v = verdict(claim({ checks: [c], runs: [r], waivers: [waiver()] }));
      expect(v.outcome, message).not.toBe('FAIL');
      expect(checkOf(v, 'unit').counted, 'the waived run keeps recording').toContain(r.run);
    }
  });
  it('AC3 another error under the same waiver is FAIL', () => {
    const v = verdict(claim({ checks: [c], runs: [failing('TypeError: total is undefined')], waivers: [waiver()] }));
    expect(v.outcome).toBe('FAIL');
  });
  it('AC3 a waiver the claimant\'s own agent approved accepts nothing', () => {
    const own = claim().agent;
    const v = verdict(claim({ checks: [c], runs: [failing('Expected 42, received 41')], waivers: [waiver({ approved_by: own })] }));
    expect(v.outcome).toBe('FAIL');
  });
});

describe('AC23 a known failure past its expiry date fails again', () => {
  it('AC23 past its end date, or once its end condition is met, the same error is FAIL', () => {
    const c = check('unit');
    const r = run(c, COMMIT, 'failed', { failures: [failure('cart.test.ts › rounds tax', { message: 'Expected 42, received 41' })] });
    const base = { check: 'unit', error: 'Expected 42, received 41', owner: 'you', approved_by: 'you' };
    const now = T0 + 40 * DAY;
    expect(verdict(claim({ checks: [c], runs: [r], now, waivers: [{ ...base, ends: { date: T0 + 30 * DAY } }] })).outcome).toBe('FAIL');
    expect(verdict(claim({ checks: [c], runs: [r], now, waivers: [{ ...base, ends: { condition: 'upstream fix lands', met: true } }] })).outcome).toBe('FAIL');
    expect(verdict(claim({ checks: [c], runs: [r], now, waivers: [{ ...base, ends: { condition: 'upstream fix lands', met: false } }] })).outcome).not.toBe('FAIL');
  });
});

describe('AC5 a FAIL says where it points', () => {
  it('AC5 the file and line of each stack frame, the code its failing test covers, and the first journey step that differs from the last PASS', () => {
    const j = check('journey:checkout', { depth: 'journey', proof: 'journey', covers: [reqId(1)] });
    const steps = [{ id: 'open-cart', digest: 'a1' }, { id: 'apply-coupon', digest: 'b2' }, { id: 'pay', digest: 'c3' }];
    const lastPass = run(j, commitOf('C'), 'passed', { steps, ended: T0 - DAY });
    const failed = run(j, COMMIT, 'failed', {
      steps: [steps[0]!, { id: 'apply-coupon', digest: 'XX' }, { id: 'pay', digest: 'YY' }],
      failures: [failure('checkout.spec.ts › pays', { frames: [{ file: 'src/cart.ts', line: 42 }, { file: 'src/coupon.ts', line: 7 }], covers: ['src/coupon.ts'] })],
    });
    const v = verdict(claim({ requirements: [requirement(1, { depth: 'journey' })], checks: [j], runs: [lastPass, failed] }));
    expect(v.outcome).toBe('FAIL');
    expect(v.points_to).not.toBeNull();
    expect(v.points_to!.frames).toEqual(expect.arrayContaining(['src/cart.ts:42', 'src/coupon.ts:7']));
    expect(v.points_to!.covers).toContain('src/coupon.ts');
    expect(v.points_to!.step).toBe('apply-coupon');
    expect(v.smallest).not.toBeNull();
  });
});

describe('AC6 a claim covered only by its own agent\'s checks never passes', () => {
  it('AC6 an own check that passes leaves the claim INCONCLUSIVE', () => {
    const c = check('own:unit', { source: 'own' });
    expect(verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] })).outcome).toBe('INCONCLUSIVE');
  });
  it(`AC6 for ${RUNS} seeded claims whose every check is the agent's own, none passes`, () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      const g = genClaim(seed);
      if (!g.checks.length || g.requirements.some((q) => q.oracle === 'person')) return;
      const own = { ...g, checks: g.checks.map((c) => ({ ...c, source: 'own' as const, state: 'ended' as const })) };
      expect(verdict(own).outcome, `seed ${seed}`).not.toBe('PASS');
    }), { seed: SEED + 6, numRuns: RUNS });
  });
});

describe('AC7 three failures with one cause make one send-back', () => {
  it('AC7 three failing checks traced to one change: one send-back naming all three', () => {
    const parts = ['lint', 'typecheck', 'unit'].map((id, i) => {
      const c = check(id, { covers: [reqId(i + 1)] });
      return { check: c, runs: [run(c, COMMIT, 'failed', { failures: [failure(`${id} › holds`, { cause: 'change:c9' })] })] };
    });
    const v = verdict(claimOf(parts));
    expect(v.outcome).toBe('FAIL');
    expect(v.send_backs).toHaveLength(1);
    expect(v.send_backs[0]!.cause).toBe('change:c9');
    expect([...v.send_backs[0]!.checks].sort()).toEqual(['lint', 'typecheck', 'unit']);
  });
  it('AC7 two causes make two send-backs', () => {
    const a = check('lint', { covers: [reqId(1)] }), b = check('unit', { covers: [reqId(2)] });
    const v = verdict(claimOf([
      { check: a, runs: [run(a, COMMIT, 'failed', { failures: [failure('lint › holds', { cause: 'change:c1' })] })] },
      { check: b, runs: [run(b, COMMIT, 'failed', { failures: [failure('unit › holds', { cause: 'change:c2' })] })] },
    ]));
    expect(v.send_backs.map((s) => s.cause).sort()).toEqual(['change:c1', 'change:c2']);
  });
  it(`AC7 for ${RUNS} seeded claims, no two send-backs share a cause and each names only FAIL checks`, () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      const v = verdict(genClaim(seed));
      const causes = v.send_backs.map((s) => s.cause);
      expect(new Set(causes).size, `seed ${seed}: one send-back per cause`).toBe(causes.length);
      for (const s of v.send_backs) for (const id of s.checks) expect(checkOf(v, id).outcome, `seed ${seed}: ${id}`).toBe('FAIL');
    }), { seed: SEED + 7, numRuns: RUNS });
  });
});

const KEEPS = 'total.test.ts › keeps total';
const TAX = 'cart.test.ts › rounds tax';
const COUPON = 'checkout.test.ts › applies coupon';
function npmTest(failing: string[], over: Partial<ClaimCheck> = {}): { check: ClaimCheck; runs: Run[] } {
  const c = check('npm test', { source: 'spec', covers: [reqId(2)], base: { outcome: 'failed', on_assertion: true, failed_tests: [TAX] }, ...over });
  const causes: Record<string, string> = { [TAX]: 'change:main-red', [COUPON]: 'change:mine' };
  return { check: c, runs: [run(c, COMMIT, 'failed', { failures: failing.map((t) => failure(t, { cause: causes[t] ?? 'change:main-red' })) })] };
}

describe('AC9 a fix claim whose own check still fails is FAIL, never BLOCKED as inherited', () => {
  it('AC9 the fix check fails on every real run: FAIL with its smallest case; npm test\'s base failure becomes one inherited fix task, not part of the send-back', () => {
    const fix = check('test:keeps-total', { covers: [reqId(1)], base: { outcome: 'failed', on_assertion: true, failed_tests: [KEEPS] } });
    const fixRun = run(fix, COMMIT, 'failed', { failures: [failure(KEEPS, { cause: 'change:mine', case: 'total of [] is 0' })] });
    const npm = npmTest([TAX]);
    const v = verdict(claim({
      requirements: [requirement(1, { on_base: 'fails' }), requirement(2, { on_base: 'passes' })],
      checks: [fix, npm.check], runs: [fixRun, ...npm.runs],
    }));
    expect(v.outcome).toBe('FAIL');
    expect(checkOf(v, 'test:keeps-total')).toMatchObject({ outcome: 'FAIL', inherited: false });
    expect(v.smallest).toBe('total of [] is 0');
    expect(checkOf(v, 'npm test')).toMatchObject({ outcome: 'BLOCKED', inherited: true });
    expect(v.fix_tasks).toHaveLength(1);
    expect(v.fix_tasks[0]!.checks).toContain('npm test');
    expect(v.send_backs.flatMap((s) => s.checks)).not.toContain('npm test');
    expect(v.send_backs.flatMap((s) => s.checks)).toContain('test:keeps-total');
  });
});

describe('AC10 on a red main, a claim whose only failures are inherited is BLOCKED with one fix task per cause', () => {
  it('AC10 two inherited causes across two checks, three failures: BLOCKED, two fix tasks, no send-back', () => {
    const npm = npmTest([TAX], { base: { outcome: 'failed', on_assertion: true, failed_tests: [TAX, 'cart.test.ts › rounds shipping'] } });
    npm.runs[0]!.failures.push(failure('cart.test.ts › rounds shipping', { cause: 'change:main-red' }));
    const lint = check('lint', { source: 'spec', covers: [], base: { outcome: 'failed', on_assertion: true, failed_tests: ['eslint › no-unused'] } });
    const unit = check('unit', { covers: [reqId(1)] });
    const v = verdict(claim({
      requirements: [requirement(1), requirement(2)],
      checks: [unit, npm.check, lint],
      runs: [run(unit, COMMIT, 'passed'), ...npm.runs, run(lint, COMMIT, 'failed', { failures: [failure('eslint › no-unused', { cause: 'change:main-lint' })] })],
    }));
    expect(v.outcome).toBe('BLOCKED');
    expect(v.fix_tasks.map((t) => t.cause).sort()).toEqual(['change:main-lint', 'change:main-red']);
    expect(v.send_backs).toEqual([]);
  });
});

describe('AC26 on a red main, inheritance is judged per test', () => {
  it('AC26 a claim failing the tax test and the coupon test, which passes on the base, is FAIL naming the coupon test; one failing only the tax test is BLOCKED as inherited', () => {
    const reqs = [requirement(1), requirement(2)];
    const unit = check('unit', { covers: [reqId(1)] });
    const both = npmTest([TAX, COUPON]);
    const one = npmTest([TAX]);
    const v1 = verdict(claim({ requirements: reqs, checks: [unit, both.check], runs: [run(unit, COMMIT, 'passed'), ...both.runs] }));
    const v2 = verdict(claim({ requirements: reqs, checks: [unit, one.check], runs: [run(unit, COMMIT, 'passed'), ...one.runs] }));
    // A judge of inheritance per check (the base failed, so the check is inherited) returns BLOCKED for the first.
    const perCheck = (c: ClaimCheck): Result => (c.base?.outcome === 'failed' ? 'BLOCKED' : 'FAIL');
    expect(perCheck(both.check)).toBe('BLOCKED');
    expect(v1.outcome, 'tax and coupon').toBe('FAIL');
    expect(text(v1.reasons)).toContain(COUPON);
    expect(v2.outcome, 'tax alone').toBe('BLOCKED');
    expect(checkOf(v2, 'npm test').inherited).toBe(true);
  });
});

describe('AC11 no check, or an uncovered requirement, is INVALID; own-only cover at depth is INCONCLUSIVE with one ask', () => {
  it('AC11 a claim with no check selected is INVALID naming the requirement', () => {
    const v = verdict(claim({ checks: [] }));
    expect(v.outcome).toBe('INVALID');
    expect(text(v.reasons)).toContain(reqId(1));
  });
  it('AC11 a requirement no check covers is INVALID naming it, beside one that passes', () => {
    const c = check('unit', { covers: [reqId(1)] });
    const v = verdict(claim({ requirements: [requirement(1), requirement(2)], checks: [c], runs: [run(c, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('INVALID');
    expect(reqOf(v, reqId(2)).outcome).toBe('INVALID');
    expect(text(v.reasons)).toContain(reqId(2));
  });
  it('AC11 covered at its depth only by the agent\'s own passing check: INCONCLUSIVE with one ask to approve that check, never INVALID or PASS', () => {
    const own = check('own:repro', { source: 'own', covers: [reqId(1)] });
    const v = verdict(claim({ checks: [own], runs: [run(own, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(reqOf(v, reqId(1)).outcome).toBe('INCONCLUSIVE');
    expect(v.asks).toHaveLength(1);
    expect(v.asks[0]!.check).toBe('own:repro');
  });
});

describe('AC12 a verdict other than pending is made at once', () => {
  const unit = check('unit', { covers: [reqId(1)] });
  const journey = check('journey:checkout', { depth: 'journey', proof: 'journey', covers: [reqId(2)] });
  const reqs = [requirement(1), requirement(2, { depth: 'journey' })];
  it('AC12 a unit check that fails beside a six-minute journey still running: FAIL at once, with a send-back', () => {
    const v = verdict(claim({ requirements: reqs, checks: [unit, journey], runs: [run(unit, COMMIT, 'failed')] }));
    expect(v.outcome).toBe('FAIL');
    expect(checkOf(v, 'journey:checkout').outcome).toBe('pending');
    expect(v.send_backs.length).toBeGreaterThan(0);
  });
  it('AC12 with the unit check passing, the claim stays pending, with no INCONCLUSIVE verdict or open item for the running journey', () => {
    const v = verdict(claim({ requirements: reqs, checks: [unit, journey], runs: [run(unit, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('pending');
    expect(checkOf(v, 'journey:checkout').outcome).toBe('pending');
    expect(v.open_items.filter((i) => i.check === 'journey:checkout')).toEqual([]);
  });
  it('AC12 while a requirement waits on your taste answer, a missing secret makes the claim BLOCKED at once with one unblock ask, none for the taste call', () => {
    const taste = requirement(2, { oracle: 'person', ask: 'ask:TASTE1' });
    const v = verdict(claim({ requirements: [requirement(1), taste], checks: [unit], runs: [run(unit, COMMIT, 'missing')] }));
    expect(v.outcome).toBe('BLOCKED');
    expect(reqOf(v, reqId(2)).outcome).toBe('pending');
    expect(v.asks).toHaveLength(1);
    expect(v.asks[0]!.kind).toBe('unblock');
    expect(v.asks[0]!.question).toContain('STRIPE_TEST_KEY');
    expect(v.asks.filter((a) => a.kind === 'taste' || a.req === reqId(2))).toEqual([]);
  });
});

describe('AC13 how each run outcome reads in the verdict', () => {
  const c = check('unit');
  const one = (outcome: Run['outcome']) => verdict(claim({ checks: [c], runs: [run(c, COMMIT, outcome)] }));
  it('AC13 missing makes its check BLOCKED with the cause; overran counts as failed; stopped INCONCLUSIVE; ran nothing INVALID', () => {
    const missing = one('missing');
    expect(checkOf(missing, 'unit').outcome).toBe('BLOCKED');
    expect(text(checkOf(missing, 'unit').reasons)).toContain('STRIPE_TEST_KEY');
    expect(checkOf(one('overran'), 'unit').outcome).toBe('FAIL');
    expect(checkOf(one('stopped'), 'unit').outcome).toBe('INCONCLUSIVE');
    expect(checkOf(one('ran_nothing'), 'unit').outcome).toBe('INVALID');
  });
});

describe('AC15 proof depth', () => {
  const reqs = [requirement(1, { depth: 'journey' })];
  const unit = check('unit', { covers: [reqId(1)] });
  const journey = check('journey:checkout', { depth: 'journey', proof: 'journey', covers: [reqId(1)] });
  it('AC15 a journey requirement covered by a passing unit test and a passing journey is PASS', () => {
    const v = verdict(claim({ requirements: reqs, checks: [unit, journey], runs: [run(unit, COMMIT, 'passed'), run(journey, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('PASS');
    expect(reqOf(v, reqId(1)).outcome).toBe('PASS');
  });
  it('AC15 covered by the passing unit test alone, it is INVALID, naming the depth it needs', () => {
    const v = verdict(claim({ requirements: reqs, checks: [unit], runs: [run(unit, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('INVALID');
    expect(reqOf(v, reqId(1)).outcome).toBe('INVALID');
    expect(text(v.reasons)).toContain('journey');
    expect(text(v.reasons)).toContain(reqId(1));
  });
});

describe('AC16 open items as records', () => {
  const c = check('unit');
  it('AC16 a BLOCKED claim with a missing secret records one open item naming the evidence that would close it; raised again it is one record', () => {
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'missing')] }));
    expect(v.outcome).toBe('BLOCKED');
    const items = v.open_items.filter((i) => i.check === 'unit');
    expect(items).toHaveLength(1);
    expect(items[0]!.closes_with.evidence).toContain('STRIPE_TEST_KEY');
    expect(items[0]!.needs_you).toBe(true);
    // The same claim judged again, and the next claim on the task blocked the same way, raise the same item.
    expect(verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'missing')] })).open_items.map((i) => i.id)).toEqual(v.open_items.map((i) => i.id));
    const next = verdict(claim({ claim: 'claim:01K74H9Z3X5V7T9R1P3N5M7K9H', commit: commitOf('E'), checks: [c], runs: [run(c, commitOf('E'), 'missing')] }));
    expect(next.open_items.filter((i) => i.check === 'unit').map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  it('AC16 a flaky check\'s INCONCLUSIVE open item adds nothing to Needs you', () => {
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('INCONCLUSIVE');
    const items = v.open_items.filter((i) => i.check === 'unit');
    expect(items).toHaveLength(1);
    expect(items[0]!.needs_you).toBe(false);
    expect(v.asks).toEqual([]);
  });
});

describe('AC24 every rule is tested and the highest by precedence wins', () => {
  const R1 = requirement(1);
  const rows: { row: string; build: () => ClaimInput; want: Result }[] = [
    { row: 'missing', want: 'BLOCKED', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'missing')] }); } },
    { row: 'bad rate', want: 'BLOCKED', build: () => { const c = check('u', { accept: '0%' }); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'evidence outside the code', want: 'BLOCKED', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed', { evidence: [{ slot: 'screenshot', state: 'missing', reason: 'simulator unavailable', outside_code: true }] })] }); } },
    { row: 'inherited', want: 'BLOCKED', build: () => { const n = npmTest([TAX]); return claim({ requirements: [R1, requirement(2)], checks: [check('u'), n.check], runs: [run(check('u'), COMMIT, 'passed'), ...n.runs] }); } },
    { row: 'can\'t fail', want: 'INVALID', build: () => { const c = check('u', { cant_fail: 'exit status masked by `|| true`' }); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'ran nothing', want: 'INVALID', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'ran_nothing')] }); } },
    { row: 'zero tests', want: 'INVALID', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed', { tests_run: 0 })] }); } },
    { row: 'fix passes on base', want: 'INVALID', build: () => { const c = check('u', { base: { outcome: 'passed', on_assertion: false, failed_tests: [] } }); return claim({ requirements: [requirement(1, { on_base: 'fails' })], checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'fix fails off its assertions', want: 'INVALID', build: () => { const c = check('u', { base: { outcome: 'failed', on_assertion: false, failed_tests: [KEEPS] } }); return claim({ requirements: [requirement(1, { on_base: 'fails' })], checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'uncovered', want: 'INVALID', build: () => { const c = check('u', { covers: [] }); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'no check', want: 'INVALID', build: () => claim({ checks: [] }) },
    { row: 'all failed', want: 'FAIL', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'failed')] }); } },
    { row: 'flaky', want: 'INCONCLUSIVE', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'passed')] }); } },
    { row: 'stopped', want: 'INCONCLUSIVE', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'stopped')] }); } },
    { row: 'too few', want: 'INCONCLUSIVE', build: () => { const c = check('u', { runs: 3, state: 'ended' }); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'evidence gap', want: 'INCONCLUSIVE', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed', { evidence: [{ slot: 'video', state: 'truncated', counts: { kept: 3, expected: 5 } }] })] }); } },
    { row: 'own only', want: 'INCONCLUSIVE', build: () => { const c = check('u', { source: 'own' }); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'your answer unanswered', want: 'INCONCLUSIVE', build: () => { const c = check('u'); return claim({ requirements: [R1, requirement(2, { oracle: 'person', ask: 'ask:TASTE1', answer: 'unanswered' })], checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'your answer pending', want: 'pending', build: () => { const c = check('u'); return claim({ requirements: [R1, requirement(2, { oracle: 'person', ask: 'ask:TASTE1' })], checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
    { row: 'running', want: 'pending', build: () => claim({ checks: [check('u', { state: 'running' })] }) },
    { row: 'otherwise', want: 'PASS', build: () => { const c = check('u'); return claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }); } },
  ];
  for (const { row, build, want } of rows) {
    it(`AC24 row "${row}" gives ${want}`, () => {
      const c = build();
      expect(verdict(c).outcome, row).toBe(want);
      expect(referenceVerdict(c).outcome, `the reference, ${row}`).toBe(want);
    });
  }
  it('AC24 one check BLOCKED as inherited and another failing every real run is FAIL; a missing secret and one that ran nothing is INVALID; the first-match engine returns BLOCKED for both', () => {
    const n = npmTest([TAX]);
    const u = check('unit', { covers: [reqId(1)] });
    const first = claim({ requirements: [requirement(1), requirement(2)], checks: [u, n.check], runs: [run(u, COMMIT, 'failed'), ...n.runs] });
    const a = check('journey:pay', { covers: [reqId(1)] }), b = check('unit', { covers: [reqId(2)] });
    const second = claim({ requirements: [requirement(1), requirement(2)], checks: [a, b], runs: [run(a, COMMIT, 'missing'), run(b, COMMIT, 'ran_nothing')] });
    expect(verdict(first).outcome).toBe('FAIL');
    expect(verdict(second).outcome).toBe('INVALID');
    expect(referenceVerdict(first, 'first-match').outcome).toBe('BLOCKED');
    expect(referenceVerdict(second, 'first-match').outcome).toBe('BLOCKED');
  });
});

describe('AC32 a check that never started on a claim\'s snapshot', () => {
  const unit = check('unit', { covers: [reqId(1)] });
  const journey = check('journey:checkout', { depth: 'journey', proof: 'journey', covers: [reqId(2)], state: 'never_started', never_started: 'newer_claim' });
  const reqs = [requirement(1), requirement(2, { depth: 'journey' })];
  it('AC32 with every other check passed, a journey the next claim\'s change kept from starting is pending and reads stale, never PASS or INVALID, with no open item for it', () => {
    const c = claim({ requirements: reqs, checks: [unit, journey], runs: [run(unit, COMMIT, 'passed')] });
    const v = verdict(c);
    expect(v.outcome, c.claim).toBe('pending');
    expect(v.stale).toBe(true);
    expect(checkOf(v, 'journey:checkout')).toMatchObject({ outcome: 'pending', never_started: true });
    expect(v.open_items.filter((i) => i.check === 'journey:checkout')).toEqual([]);
    // The two wrong engines the criterion names fail the same check.
    expect(referenceVerdict(c, 'never-started-as-ran-nothing').outcome).toBe('INVALID');
    expect(referenceVerdict(c, 'leave-out-never-started').outcome).toBe('PASS');
  });
  it('AC32 a journey that never started because its reproduction check failed: FAIL naming that check, no INVALID for the journey', () => {
    const repro = check('repro', { covers: [reqId(1)] });
    const j = { ...journey, never_started: 'quick_check_failed' as const };
    const c = claim({ requirements: [requirement(1, { on_base: 'fails' }), requirement(2, { depth: 'journey' })], checks: [{ ...repro, base: { outcome: 'failed', on_assertion: true, failed_tests: ['repro › totals'] } }, j], runs: [run(repro, COMMIT, 'failed')] });
    const v = verdict(c);
    expect(v.outcome, c.claim).toBe('FAIL');
    expect(text(v.reasons)).toContain('repro');
    expect(checkOf(v, 'journey:checkout').outcome).not.toBe('INVALID');
    expect(v.checks.filter((r) => r.outcome === 'INVALID')).toEqual([]);
  });
});

describe('Oct9 added on October 9: depth, coverage, evidence states and pinning', () => {
  it('Oct9 a deeper proof satisfies a shallower requirement, never the reverse', () => {
    const j = check('journey:checkout', { depth: 'journey', proof: 'journey' });
    expect(verdict(claim({ requirements: [requirement(1, { depth: 'integration' })], checks: [j], runs: [run(j, COMMIT, 'passed')] })).outcome).toBe('PASS');
    const i = check('api', { depth: 'integration' });
    expect(verdict(claim({ requirements: [requirement(1, { depth: 'journey' })], checks: [i], runs: [run(i, COMMIT, 'passed')] })).outcome).toBe('INVALID');
  });
  it('Oct9 only captured, complete evidence supports PASS: missing outside the code BLOCKED, any other gap INCONCLUSIVE', () => {
    const c = check('unit');
    const withSlot = (slot: Run['evidence'][number]) => verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'passed', { evidence: [slot] })] })).outcome;
    expect(withSlot({ slot: 'screenshot', state: 'captured', sha256: 'b'.repeat(64) })).toBe('PASS');
    expect(withSlot({ slot: 'screenshot', state: 'missing', reason: 'simulator unavailable', outside_code: true })).toBe('BLOCKED');
    expect(withSlot({ slot: 'screenshot', state: 'missing', reason: 'the page never rendered' })).toBe('INCONCLUSIVE');
    expect(withSlot({ slot: 'video', state: 'truncated', counts: { kept: 3, expected: 5 } })).toBe('INCONCLUSIVE');
  });
  it('Oct9 the key names the commit and each check\'s digest; each PASS says how many clean runs confirm it', () => {
    const c = check('unit', { runs: 2 });
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'passed'), run(c, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('PASS');
    expect(v.commit).toBe(COMMIT);
    expect(v.key.commit).toBe(COMMIT);
    expect(v.key.check_digests).toContain(c.digest);
    expect(reqOf(v, reqId(1)).runs.clean).toBe(2);
  });
});

describe('DONE done when', () => {
  it('DONE a unit-only check can\'t pass a journey-depth claim', () => {
    const u = check('unit');
    expect(verdict(claim({ requirements: [requirement(1, { depth: 'journey' })], checks: [u], runs: [run(u, COMMIT, 'passed')] })).outcome).not.toBe('PASS');
  });
  it('DONE a missing screenshot makes the claim BLOCKED or INCONCLUSIVE, never PASS', () => {
    const j = check('journey:checkout', { depth: 'journey', proof: 'journey' });
    for (const outside of [true, false]) {
      const r = run(j, COMMIT, 'passed', { evidence: [{ slot: 'screenshot:pay', state: 'missing', reason: outside ? 'simulator unavailable' : 'not written', outside_code: outside }] });
      expect(['BLOCKED', 'INCONCLUSIVE']).toContain(verdict(claim({ checks: [j], runs: [r] })).outcome);
    }
  });
});
