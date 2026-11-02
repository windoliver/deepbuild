// #31 AC1 #31.5a0437de, AC2 #31.f79bde6b, AC4 #31.9afbd40a and AC7 #31.79cb5a05: what a fix's run on the merge base proves. Real git repos, the real command check kind
// through the real supervisor running the real Vitest, and a test kind that isn't the command check.
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CheckSpec, Failure } from '../../../packages/conformance/src/index.ts';
import { commit, MAIN_ONLY, mustFail, openWorld, presenceKind, REAL_FIX, REGRESSION_TEST, sampleBranch, spec, vitestSpec, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const fix = (id: string, s: CheckSpec, own: string[]) => ({ check: id, spec: s, deadline: 120_000, on_base: 'fails' as const, own });

describe('AC1 #31.5a0437de a fix whose check passes on the base is INVALID', () => {
  it('AC1 a real change with a check that also holds on the merge base is INVALID, naming the base', async () => {
    await withWorld(async (w) => {
      const always = "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('no discount, no change', () => {\n  expect(total({ items: [100], discount: 0 })).toBe(100);\n});\n";
      const { repo } = sampleBranch('fix', { 'src/cart.ts': REAL_FIX['src/cart.ts'], 'test/always.test.ts': always });
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac1', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [fix('always', vitestSpec(), ['test/always.test.ts'])] });
      const c = r.checks[0]!;
      expect(c.head.outcome, 'it holds on the claim').toBe('passed');
      expect(c.base?.outcome, 'and it ran on the base, where it holds too').toBe('passed');
      expect(r.verdict).toBe('INVALID');
      expect(r.reasons.join('\n')).toMatch(/passe[sd] on the (merge )?base/);
    });
  }, 240_000);
});

describe('AC2 #31.f79bde6b a real fix is FAIL on the base and PASS on the branch', () => {
  it('AC2 the sample repo\'s real fix: its check fails on the merge base at its assertion, passes on the branch, and the claim is PASS', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX);
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac2', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [fix('regression', vitestSpec(), ['test/cart.test.ts'])] });
      const c = r.checks[0]!;
      expect(c.base?.outcome, 'FAIL on the base').toBe('failed');
      expect(c.base?.on_assertion, 'at an assertion its check names').toBe(true);
      expect(c.base?.failures.map((f: Failure) => `${f.file}:${f.line}`), 'at the regression test\'s expect').toEqual(['test/cart.test.ts:5']);
      expect(c.head.outcome, 'PASS on the branch').toBe('passed');
      expect(c.head.testsRun).toBe(1);
      expect(r.verdict).toBe('PASS');
      expect(r.reasons).toEqual([]);
    });
  }, 240_000);
});

describe('AC4 #31.9afbd40a the seeded bug with no fix applied is FAIL, never BLOCKED as inherited', () => {
  it('AC4 the regression check fails on the base and on the branch, and the claim is FAIL with the smallest failing case', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('no-fix', { 'test/cart.test.ts': REGRESSION_TEST });
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac4', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [fix('regression', vitestSpec(), ['test/cart.test.ts'])] });
      const c = r.checks[0]!;
      expect(c.base?.outcome, 'fails on the base').toBe('failed');
      expect(c.head.outcome, 'fails on the branch').toBe('failed');
      expect(r.verdict, `never BLOCKED as inherited: ${r.reasons.join('; ')}`).toBe('FAIL');
      expect(r.reasons.join('\n')).not.toMatch(/inherited/);
      expect(r.smallest, 'the smallest failing case').toContain('total takes the discount off');
    });
  }, 240_000);
});

describe('AC7 #31.79cb5a05 a kind other than the command check gets its base run from this service', () => {
  const claimOf = (id: string, repo: string, runner: string) => ({
    claim: `claim:${id}`, worktree: repo, onto: 'main',
    checks: [{ check: id, spec: spec('presence', runner), deadline: 60_000, on_base: 'fails' as const, own: [] }],
  });

  it('AC7 a fix claim whose check of the test kind passes on the base is INVALID: the kind ran on a temporary checkout of the merge base, and that checkout is gone', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim(claimOf('holds-on-base', repo, 'src/cart.ts'));
      const c = r.checks[0]!;
      expect(kind.calls.length, 'one run on the claim, one on the base').toBe(2);
      expect(kind.calls.map((call) => call.checkout), 'neither in your worktree').not.toContain(repo);
      const onBase = kind.calls.find((call) => !call.files.includes('test/cart.test.ts'));
      expect(onBase, 'a run on a checkout without the fix').toBeDefined();
      expect(onBase!.files, 'the merge base, not main\'s tip').not.toContain(MAIN_ONLY);
      expect(c.base?.checkout, 'the base run the service reports is that one').toBe(onBase!.checkout);
      expect(c.base?.outcome).toBe('passed');
      expect(r.verdict).toBe('INVALID');
      expect(r.reasons.join('\n')).toMatch(/passe[sd] on the (merge )?base/);
      expect(existsSync(onBase!.checkout), 'and its checkout is gone').toBe(false);
    });
  }, 120_000);

  it('AC7 the same kind\'s check of what the fix adds fails on the base at its assertion and proves the fix: PASS', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', { 'src/coupon.ts': 'export const coupon = 10;\n' }, { dependencies: false });
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim(claimOf('adds-coupon', repo, 'src/coupon.ts'));
      expect(r.checks[0]!.base?.outcome).toBe('failed');
      expect(r.checks[0]!.base?.on_assertion).toBe(true);
      expect(r.verdict).toBe('PASS');
    });
  }, 120_000);

  it('AC7 (wrong program) a service built into the command check gives the kind no base run, and fails this test', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind], plant: 'base-in-command-check' });
      const r = await service.runClaim(claimOf('holds-on-base', repo, 'src/cart.ts'));
      await mustFail('base-in-command-check', () => {
        expect(r.checks[0]!.base?.outcome, 'presence had no base run').toBe('passed');
        expect(kind.calls.length, 'presence ran on its base').toBe(2);
      }, ['presence']);
    });
  }, 120_000);
});

describe('AC2 #31.f79bde6b the base run is on the merge base, with the check\'s own files from the claim', () => {
  it('AC2 a test the fix edits in place runs on the base in the claim\'s bytes, with the code from the merge base', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX);
      commit(repo, { 'test/cart.test.ts': REGRESSION_TEST.replace('total takes the discount off', 'total takes the discount off, edited') }, 'edit the test');
      const service = await w.service();
      const r = await service.runClaim({ claim: 'claim:ac2b', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [fix('regression', vitestSpec(), ['test/cart.test.ts'])] });
      expect(r.checks[0]!.base?.failures.map((f: Failure) => f.test).join(), 'the claim\'s test').toContain('edited');
      expect(r.verdict).toBe('PASS');
      expect(readdirSync(w.root), 'no checkout left').toEqual([]);
    });
  }, 240_000);
});
