// #31 AC8 #31.81951b2c and AC11 #31.e96da3bd: a base run proves a fix only when it fails on an assertion its check names. Real Vitest through the
// real command check kind; the journey is a test kind whose run reads the real page in its checkout.
import { describe, expect, it } from 'vitest';
import { journeyKind, mustFail, openWorld, REAL_FIX, sampleBranch, spec, vitestSpec, type World } from './helpers.ts';
import type { ClaimRun } from '../../../packages/gate/src/index.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const BEFORE_TESTS = 'failed on the base before its tests ran';
const ELSEWHERE = 'failed on the base only elsewhere: TypeError at test/coupon.test.ts:7';
const isInvalid = (r: ClaimRun, reason: string): void => {
  expect(r.verdict, `${r.verdict}: ${r.reasons.join('; ')}`).toBe('INVALID');
  expect(r.reasons.join('\n')).toContain(reason);
};
const realFixPass = (r: ClaimRun): void => {
  expect(r.checks[0]!.base?.on_assertion).toBe(true);
  expect(r.verdict, r.reasons.join('; ')).toBe('PASS');
};

// A fix that adds test/fix.test.ts, asserting 1 === 1 and importing src/helper.ts, which the fix adds.
const HELPER_FIX = {
  'src/helper.ts': 'export const helper = 1;\n',
  'test/fix.test.ts': "import { expect, it } from 'vitest';\nimport { helper } from '../src/helper.ts';\n\nit('one is one', () => {\n  void helper;\n  expect(1 === 1).toBe(true);\n});\n",
};
const FIX_TEST = { check: 'fix', spec: vitestSpec(), deadline: 120_000, on_base: 'fails' as const, own: ['test/fix.test.ts'] };
const REAL = { check: 'regression', spec: vitestSpec(), deadline: 120_000, on_base: 'fails' as const, own: ['test/cart.test.ts'] };
const deps = { dependencies: ['node_modules'] };

describe('AC8 #31.81951b2c a base run that failed before its tests ran is INVALID', () => {
  it(`AC8 test/fix.test.ts, importing src/helper.ts the fix adds, is INVALID naming '${BEFORE_TESTS}'`, async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', HELPER_FIX);
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac8a', worktree: repo, onto: 'main', ...deps, checks: [FIX_TEST] });
      expect(r.checks[0]!.head.outcome, 'it holds on the claim').toBe('passed');
      expect(r.checks[0]!.base?.outcome, 'and failed on the base').toBe('failed');
      isInvalid(r, BEFORE_TESTS);
    });
  }, 240_000);

  it(`AC8 a base checkout with no dependencies installed, where vitest isn't found, is INVALID with the same reason`, async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX);
      const service = await w.service();
      // The claim's own checkout gets the install; its base checkout gets none.
      const r = await service.runClaim({ claim: 'claim:ac8b', worktree: repo, onto: 'main', dependencies: ['node_modules'], baseDependencies: [], checks: [REAL] });
      expect(r.checks[0]!.head.outcome).toBe('passed');
      expect(r.checks[0]!.base?.outcome, 'vitest is not found there').toBe('missing');
      isInvalid(r, BEFORE_TESTS);
    });
  }, 240_000);

  it('AC8 the sample repo\'s real fix, whose test fails its assertion on the base, is PASS', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX);
      const service = await w.service();
      realFixPass(await service.runClaim({ claim: 'claim:ac8c', worktree: repo, onto: 'main', ...deps, checks: [REAL] }));
    });
  }, 240_000);

  it('AC8 (wrong program) a service that counts any non-zero base exit as failing passes the first two as proven and fails this test', async () => {
    await withWorld(async (w) => {
      const service = await w.service({ plant: 'any-nonzero-base-exit' });
      const first = sampleBranch('fix', HELPER_FIX);
      const helper = await service.runClaim({ claim: 'claim:ac8d', worktree: first.repo, onto: 'main', ...deps, checks: [FIX_TEST] });
      expect(helper.verdict, 'the wrong program reads the crash as proof').toBe('PASS');
      await mustFail('any-nonzero-base-exit, on the import', () => isInvalid(helper, BEFORE_TESTS), ['INVALID']);
      const second = sampleBranch('fix', REAL_FIX);
      const missing = await service.runClaim({ claim: 'claim:ac8e', worktree: second.repo, onto: 'main', dependencies: ['node_modules'], baseDependencies: [], checks: [REAL] });
      expect(missing.verdict, 'the wrong program reads a missing vitest as proof').toBe('PASS');
      await mustFail('any-nonzero-base-exit, on the missing vitest', () => isInvalid(missing, BEFORE_TESTS), ['INVALID']);
    });
  }, 300_000);
});

// Line 7 is the expect: the criterion's place.
const COUPON_TEST = `import { expect, it } from 'vitest';
import { applyCoupon } from '../src/cart.ts';

const cart = { items: [100], discount: 0 };

it('a coupon takes ten off', () => {
  expect(applyCoupon(cart)).toBe(90);
});
`;
const COUPON_FIX = {
  'src/cart.ts': `${REAL_FIX['src/cart.ts']}export function applyCoupon(cart: Cart): number {\n  return total(cart) - 10;\n}\n`,
  'test/coupon.test.ts': COUPON_TEST,
};
const COUPON = { check: 'coupon', spec: vitestSpec(), deadline: 120_000, on_base: 'fails' as const, own: ['test/coupon.test.ts'] };
const JOURNEY = { check: 'apply-coupon', spec: spec('journey', 'Apply coupon'), deadline: 60_000, on_base: 'fails' as const, own: ['journeys/coupon.journey.ts'] };
const JOURNEY_FIX = { 'src/page.html': '<main><button>Apply coupon</button></main>\n', 'journeys/coupon.journey.ts': '// the journey the test kind plays\n' };

// A fix for a hang: on the base `settle` never resolves, and the test, with a timeout of its own far past the check's
// deadline, is still running when the check's 5 s deadline ends the run. The check names that deadline in `asserts`.
const HANGS = 'export function settle(): Promise<number> {\n  return new Promise(() => undefined);\n}\n';
const SETTLES = 'export function settle(): Promise<number> {\n  return Promise.resolve(1);\n}\n';
const HANG_TEST = "import { expect, it } from 'vitest';\nimport { settle } from '../src/settle.ts';\n\nit('settle ends', async () => {\n  expect(await settle()).toBe(1);\n}, 120_000);\n";
const HANG_FIX = { 'src/settle.ts': SETTLES, 'test/settle.test.ts': HANG_TEST };
const HANG = { check: 'hang', spec: vitestSpec(), deadline: 5_000, on_base: 'fails' as const, own: ['test/settle.test.ts'], asserts: ['deadline:5s'] };

describe('AC11 #31.e96da3bd a base run that failed only elsewhere proves nothing; a named assertion does', () => {
  it(`AC11 test/coupon.test.ts, whose expect calls applyCoupon the fix adds, is INVALID naming '${ELSEWHERE}'`, async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', COUPON_FIX);
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac11a', worktree: repo, onto: 'main', ...deps, checks: [COUPON] });
      expect(r.checks[0]!.head.outcome).toBe('passed');
      expect(r.checks[0]!.base?.testsRun, 'the test was collected and started on the base').toBeGreaterThan(0);
      isInvalid(r, ELSEWHERE);
    });
  }, 240_000);

  it('AC11 a fix journey whose base run overran at click() on a button the fix adds is INVALID the same way', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', JOURNEY_FIX, { dependencies: false });
      const kind = journeyKind();
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim({ claim: 'claim:ac11b', worktree: repo, onto: 'main', checks: [JOURNEY] });
      expect(kind.calls.map((c) => c.result.outcome).sort(), 'passed on the claim, overran on the base').toEqual(['overran', 'passed']);
      isInvalid(r, 'failed on the base only elsewhere');
      expect(r.reasons.join('\n')).toContain('journeys/coupon.journey.ts:9');
    });
  }, 120_000);

  it('AC11 a drafted fix for a hang, whose check names its 5 s deadline in asserts and overran past it on the base after its test started, proves the fix', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', HANG_FIX, { seed: { 'src/settle.ts': HANGS } });
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac11c', worktree: repo, onto: 'main', ...deps, checks: [HANG] });
      expect(r.checks[0]!.base?.outcome, 'it overran on the base').toBe('overran');
      expect(r.checks[0]!.base?.on_assertion, 'the deadline is its named assertion').toBe(true);
      expect(r.verdict, r.reasons.join('; ')).toBe('PASS');
    });
  }, 240_000);

  it('AC11 the same hang, with no deadline named in asserts, proves nothing', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', HANG_FIX, { seed: { 'src/settle.ts': HANGS } });
      const service = await w.service();
      const { asserts: _named, ...unnamed } = HANG;
      const r = await service.runClaim({ claim: 'claim:ac11d', worktree: repo, onto: 'main', ...deps, checks: [unnamed] });
      expect(r.checks[0]!.base?.outcome).toBe('overran');
      expect(r.verdict, r.reasons.join('; ')).toBe('INVALID');
    });
  }, 240_000);

  it('AC11 the sample repo\'s real fix, failing its assertion on the base, stays PASS', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX);
      const service = await w.service();
      realFixPass(await service.runClaim({ claim: 'claim:ac11e', worktree: repo, onto: 'main', ...deps, checks: [REAL] }));
    });
  }, 240_000);

  it('AC11 (wrong program) a service that counts any failure or overrun of a collected test as failing on the base passes the first two and fails this test', async () => {
    await withWorld(async (w) => {
      const kind = journeyKind();
      const service = await w.service({ kinds: [kind], plant: 'any-failure-of-collected-test' });
      const coupon = sampleBranch('fix', COUPON_FIX);
      const typeError = await service.runClaim({ claim: 'claim:ac11f', worktree: coupon.repo, onto: 'main', ...deps, checks: [COUPON] });
      expect(typeError.verdict, 'the wrong program reads the TypeError as proof').toBe('PASS');
      await mustFail('any-failure-of-collected-test, on the TypeError', () => isInvalid(typeError, ELSEWHERE), ['INVALID']);
      const journey = sampleBranch('fix', JOURNEY_FIX, { dependencies: false });
      const overran = await service.runClaim({ claim: 'claim:ac11g', worktree: journey.repo, onto: 'main', checks: [JOURNEY] });
      expect(overran.verdict, 'the wrong program reads the overrun at click() as proof').toBe('PASS');
      await mustFail('any-failure-of-collected-test, on the click()', () => isInvalid(overran, 'failed on the base only elsewhere'), ['INVALID']);
    });
  }, 300_000);
});
