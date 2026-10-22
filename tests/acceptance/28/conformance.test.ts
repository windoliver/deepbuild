// #28 AC13, the check runner's half: every run ends as one of seven outcomes, and a runner that returns
// anything else, or a verdict, fails conformance; a runner that crashes mid-run leaves its run stopped.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { conductRun } from '../../../packages/verdicts/src/index.ts';
import { RUN_OUTCOMES } from './helpers.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('AC13 every run ends as passed, failed, ran nothing, missing, overran, stopped or uncounted', () => {
  it('AC13 a runner that returns each of the seven conforms, and the run ends so', async () => {
    for (const outcome of RUN_OUTCOMES) {
      const r = await conductRun(async () => ({ outcome, tests_run: 1 }));
      expect(r, outcome).toEqual({ outcome, conforms: true, reason: null });
    }
  });
  it('AC13 a runner that returns a verdict fails conformance', async () => {
    for (const returned of [{ outcome: 'PASS' }, { outcome: 'FAIL', reasons: ['x'], requirements: [] }, 'PASS', { verdict: 'INCONCLUSIVE' }]) {
      const r = await conductRun(async () => returned);
      expect(r.conforms, JSON.stringify(returned)).toBe(false);
      expect(r.outcome).toBeNull();
      expect(typeof r.reason).toBe('string');
    }
  });
  it('AC13 for 1,000 seeded returns outside the closed set, the runner fails conformance', async () => {
    const closed = new Set<string>(RUN_OUTCOMES);
    await fc.assert(fc.asyncProperty(fc.oneof(fc.string(), fc.constantFrom('flaky', 'skipped', 'PASS', 'error', 'Passed', 'timed_out')), async (outcome) => {
      fc.pre(!closed.has(outcome));
      const r = await conductRun(async () => ({ outcome }));
      expect(r.conforms, outcome).toBe(false);
    }), { seed: 0x28_0013, numRuns: 1000 });
    for (const returned of [undefined, null, 42, [], {}]) expect((await conductRun(async () => returned)).conforms, String(returned)).toBe(false);
  });
  it('AC13 a stub runner that crashes mid-run leaves its run stopped, never failed or ran nothing', async () => {
    const r = await conductRun(async () => { await tick(); throw new Error('runner crashed: segmentation fault'); });
    expect(r.outcome).toBe('stopped');
    const sync = await conductRun(() => { throw new Error('runner crashed before its first await'); });
    expect(sync.outcome).toBe('stopped');
  });
  it('AC13 a test that crashes under the runner is failed', async () => {
    const r = await conductRun(async () => {
      await tick();
      // The runner catches the crash of what it runs and reports the test failed.
      try { throw new TypeError('cannot read properties of undefined'); } catch (e) {
        return { outcome: 'failed', tests_run: 3, failures: [{ test: 'cart.test.ts › rounds tax', message: (e as Error).message }] };
      }
    });
    expect(r).toEqual({ outcome: 'failed', conforms: true, reason: null });
  });
});
