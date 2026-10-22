// #28 run counts and more runs: AC2, AC8, AC14, AC19, AC20, AC29.
import { describe, expect, it } from 'vitest';
import { moreRuns, runsNeeded, verdict } from '../../../packages/verdicts/src/index.ts';
import type { RunOutcome } from '../../../packages/verdicts/src/index.ts';
import { check, checkOf, claim, COMMIT, run, text } from './helpers.ts';

/** Problems a runs-needed function has against the issue's counts; empty when it is right. */
function countProblems(needed: (accept: string) => number | 'BLOCKED'): string[] {
  const want: [string, number | 'BLOCKED'][] = [['10%', 29], ['45%', 6], ['1%', 299], ['95%', 1], ['0%', 'BLOCKED'], ['100%', 'BLOCKED'], ['-5%', 'BLOCKED'], ['10', 'BLOCKED']];
  return want.filter(([p, n]) => needed(p) !== n).map(([p, n]) => `p = ${p} needs ${n}, got ${needed(p)}`);
}
const engineCount = (accept: string): number | 'BLOCKED' => {
  const r = runsNeeded({ accept });
  return r.ok ? r.needed : 'BLOCKED';
};
const percent = (accept: string): number => Number(accept.replace('%', '')) / 100;

describe('AC2 p = 10% needs 29 clean runs; p = 45% needs 6', () => {
  it('AC2 runsNeeded gives 29 for 10% and 6 for 45%, since 0.55^5 is 5.03%, above 5%', () => {
    expect(runsNeeded({ accept: '10%' })).toEqual({ ok: true, needed: 29 });
    expect(runsNeeded({ accept: '45%' })).toEqual({ ok: true, needed: 6 });
    expect(0.55 ** 5).toBeGreaterThan(0.05);
  });
  it('AC2 a count that rounds ln 0.05 / ln 0.55 = 5.01 down to 5 fails the same check', () => {
    const rounded = (accept: string): number | 'BLOCKED' => {
      const p = percent(accept);
      return p > 0 && p < 1 && accept.endsWith('%') ? Math.round(Math.log(0.05) / Math.log(1 - p)) : 'BLOCKED';
    };
    expect(countProblems(rounded)).toContain('p = 45% needs 6, got 5');
  });
  it('AC2 a check with p = 10% passes on 29 clean runs, saying so, and is INCONCLUSIVE on 28 once its runs end', () => {
    const c = check('unit', { accept: '10%' });
    const runs29 = Array.from({ length: 29 }, () => run(c, COMMIT, 'passed'));
    const v = verdict(claim({ checks: [c], runs: runs29 }));
    expect(v.outcome).toBe('PASS');
    expect(checkOf(v, 'unit')).toMatchObject({ clean: 29, needed: 29 });
    expect(v.requirements[0]!.runs).toMatchObject({ clean: 29, needed: 29 });
    const v28 = verdict(claim({ checks: [{ ...c, state: 'ended' }], runs: runs29.slice(1) }));
    expect(v28.outcome).toBe('INCONCLUSIVE');
    // While runs still come, it is pending, never PASS.
    expect(verdict(claim({ checks: [c], runs: runs29.slice(1) })).outcome).toBe('pending');
  });
});

describe('AC29 p = 1% needs 299 and p = 95% exactly 1; bad rates are BLOCKED; no runs or accept needs 1', () => {
  it('AC29 the engine meets every count the issue gives', () => {
    expect(countProblems(engineCount)).toEqual([]);
    expect(runsNeeded({})).toEqual({ ok: true, needed: 1 });
  });
  it('AC29 each bad rate is not ok, naming the value', () => {
    for (const accept of ['0%', '100%', '-5%', '10']) {
      const r = runsNeeded({ accept });
      expect(r.ok, `p = ${accept}`).toBe(false);
      if (!r.ok) expect(r.reason, `p = ${accept} is named`).toContain(accept);
    }
  });
  it('AC29 a check whose rate is bad is BLOCKED in the verdict, naming the value', () => {
    for (const accept of ['0%', '100%', '-5%', '10']) {
      const c = check('unit', { accept });
      const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }));
      expect(checkOf(v, 'unit').outcome, `p = ${accept}`).toBe('BLOCKED');
      expect(text(checkOf(v, 'unit').reasons), `p = ${accept} is named`).toContain(accept);
      expect(v.outcome).toBe('BLOCKED');
    }
  });
  it('AC29 a check with neither runs nor accept passes on one clean run', () => {
    const c = check('unit');
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'passed')] }));
    expect(v.outcome).toBe('PASS');
    expect(checkOf(v, 'unit').needed).toBe(1);
  });
  it('AC29 Math.ceil(Math.log(0.05) / Math.log(1 - p)) returns 2 for 95% and no runs for 0 and 100%, so it fails the same check', () => {
    const naive = (accept: string): number | 'BLOCKED' => Math.ceil(Math.log(0.05) / Math.log(1 - percent(accept)));
    expect(naive('95%')).toBe(2);
    const problems = countProblems(naive);
    expect(problems).toContain('p = 95% needs 1, got 2');
    expect(problems.some((p) => p.startsWith('p = 0% needs BLOCKED'))).toBe(true);
    expect(problems.some((p) => p.startsWith('p = 100% needs BLOCKED'))).toBe(true);
  });
});

describe('AC8 one real run fails and another passes: INCONCLUSIVE; every real run fails: FAIL; a loaded run counts neither way', () => {
  it('AC8 a fail and a pass on the same commit are INCONCLUSIVE with the failing run attached, never FAIL or PASS', () => {
    const c = check('unit', { runs: 3 });
    const bad = run(c, COMMIT, 'failed');
    const v = verdict(claim({ checks: [c], runs: [bad, run(c, COMMIT, 'passed')] }));
    expect(checkOf(v, 'unit').outcome).toBe('INCONCLUSIVE');
    expect(v.outcome).toBe('INCONCLUSIVE');
    expect(checkOf(v, 'unit').counted).toContain(bad.run);
    expect(v.requirements[0]!.runs.counted).toContain(bad.run);
  });
  it('AC8 a check that fails every real run is FAIL', () => {
    const c = check('unit', { runs: 3, state: 'ended' });
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'failed'), run(c, COMMIT, 'failed')] }));
    expect(checkOf(v, 'unit').outcome).toBe('FAIL');
    expect(v.outcome).toBe('FAIL');
  });
  it('AC8 a timing check\'s run under load is uncounted and counts neither way', () => {
    const c = check('timing:checkout', { inputs: ['src/**'] });
    const loaded = run(c, COMMIT, 'uncounted', { failures: [] });
    const pass = verdict(claim({ checks: [c], runs: [loaded, run(c, COMMIT, 'passed')] }));
    expect(pass.outcome, 'a loaded fail beside a clean pass').toBe('PASS');
    expect(checkOf(pass, 'timing:checkout').counted).not.toContain(loaded.run);
    const fail = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'uncounted'), run(c, COMMIT, 'failed')] }));
    expect(fail.outcome, 'a loaded pass beside a real fail').toBe('FAIL');
    // Alone, the loaded run decides nothing: the check is rerun, so it is still pending.
    expect(verdict(claim({ checks: [c], runs: [loaded] })).outcome).toBe('pending');
    expect(moreRuns({}, ['uncounted'])).toBe(1);
  });
});

describe('AC14 p = 10%: fails on its first run, passes on its second', () => {
  it('AC14 INCONCLUSIVE at once, its open item names no runs still needed, and no third run starts', () => {
    const c = check('unit', { accept: '10%' });
    const outcomes: RunOutcome[] = ['failed', 'passed'];
    expect(moreRuns(c, outcomes), 'no third run').toBe(0);
    const v = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'passed')] }));
    expect(v.outcome, 'at once, with no state set').toBe('INCONCLUSIVE');
    const items = v.open_items.filter((i) => i.check === 'unit');
    expect(items).toHaveLength(1);
    expect(items[0]!.closes_with.runs_needed).toBe(0);
  });
});

describe('AC19 after a failed run, up to two more start, and a pass among them ends its runs', () => {
  const c = check('unit', { accept: '10%' });
  it('AC19 one failure starts two more; two failures leave one; three end it', () => {
    expect(moreRuns(c, ['failed'])).toBe(2);
    expect(moreRuns(c, ['failed', 'failed'])).toBe(1);
    expect(moreRuns(c, ['failed', 'failed', 'failed'])).toBe(0);
    expect(moreRuns(c, ['failed', 'passed'])).toBe(0);
    expect(moreRuns(c, [])).toBe(29);
    expect(moreRuns(c, ['passed'])).toBe(28);
  });
  it('AC19 while the two more run, the check is pending; three failures are FAIL; a pass among them INCONCLUSIVE', () => {
    expect(verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed')] })).outcome).toBe('pending');
    const three = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'failed'), run(c, COMMIT, 'failed')] }));
    expect(three.outcome).toBe('FAIL');
    const passAmong = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'failed'), run(c, COMMIT, 'failed'), run(c, COMMIT, 'passed')] }));
    expect(passAmong.outcome).toBe('INCONCLUSIVE');
  });
});

describe('AC20 an overran run counts as a failed run', () => {
  const c = check('journey:checkout', { accept: '10%', depth: 'journey', proof: 'journey', deadline: '90 s' });
  it('AC20 an overrun starts two more runs', () => {
    expect(moreRuns(c, ['overran'])).toBe(2);
    expect(moreRuns(c, ['overran', 'overran', 'overran'])).toBe(0);
  });
  it('AC20 three overruns make the check FAIL naming its deadline; an overrun and a pass INCONCLUSIVE', () => {
    const three = verdict(claim({ requirements: [{ req: c.covers[0]!, depth: 'journey', oracle: 'code', on_base: 'passes' }], checks: [c], runs: [run(c, COMMIT, 'overran'), run(c, COMMIT, 'overran'), run(c, COMMIT, 'overran')] }));
    expect(checkOf(three, 'journey:checkout').outcome).toBe('FAIL');
    expect(text(checkOf(three, 'journey:checkout').reasons)).toContain('90 s');
    const mixed = verdict(claim({ checks: [c], runs: [run(c, COMMIT, 'overran'), run(c, COMMIT, 'passed')] }));
    expect(checkOf(mixed, 'journey:checkout').outcome).toBe('INCONCLUSIVE');
  });
});
