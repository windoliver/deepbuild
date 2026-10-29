// The comparison rule itself, through the record's public entry: compareReplay over a frozen plan and its runs
// (README: The surface under test, The comparison rule). Every number here is the issue's or follows from the
// README's formula; nothing runs an agent.
import { describe, expect, it } from 'vitest';
import {
  AC1, AC4, AC5, AC7, AC8, expectedBound, GRADE, ids, makePlan, measureOf, pairOf, rule, runsOf, sorted, steady, TOKENS,
  type ReplayPlan, type TaskSpec,
} from './helpers.ts';

describe(`AC1 ${AC1} a change that regresses replayed tasks is held, with the tasks it broke`, () => {
  it(`AC1 ${AC1} six of 20 tasks fall from 0.9 to 0.1 and the rest hold: the comparison regresses and names exactly those six`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const broken = ['t03', 't07', 't08', 't12', 't15', 't19'];
    const plan = makePlan({ tasks });
    const specs = tasks.map((t) => (broken.includes(t) ? steady(t, 0.9, -0.8) : steady(t, 0.7, 0)));
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs) });
    expect(c.outcome, `outcome (${c.reason})`).toBe('regresses');
    expect(sorted(c.broke), 'the tasks it broke: those whose mean fell, and no other').toEqual(broken);
  });
});

describe(`AC4 ${AC4} the judge comes from a different model family than the agents under test`, () => {
  it(`AC4 ${AC4} a plan naming a judge of the agents' own family is refused; one of another family compares`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const specs = tasks.map((t, i) => steady(t, 0.5, 0.2 + (i % 3) * 0.01));
    for (const models of [{ agent: 'claude-sonnet-5-5', judge: 'claude-opus-5-5' }, { agent: 'gpt-reserve', judge: 'gpt-reserve-mini' }]) {
      const plan = makePlan({ tasks, models });
      const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs) });
      expect(c.outcome, `a ${models.agent} agent judged by ${models.judge} (${c.reason})`).toBe('refused');
    }
    const plan = makePlan({ tasks, models: { agent: 'claude-sonnet-5-5', judge: 'gpt-reserve' } });
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs) });
    expect(c.outcome, `a claude-sonnet-5-5 agent judged by gpt-reserve (${c.reason})`).toBe('adopt');
  });
});

describe(`AC5 ${AC5} plans frozen, failed pairs kept, missing metrics missing, small cohorts INCONCLUSIVE`, () => {
  it(`AC5 ${AC5} a comparison whose plan changed after either side ran is refused, whichever part changed; the plan as frozen compares`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const plan = makePlan({ tasks });
    // t20 is where the change lost: dropping it is the edit that would flatter the change.
    const specs: TaskSpec[] = tasks.map((t, i) => (t === 't20' ? steady(t, 0.8, -0.5) : steady(t, 0.5, 0.2 + (i % 4) * 0.01)));
    const hash = planHash(plan);
    expect(typeof hash === 'string' && hash.length > 0, 'planHash gives a non-empty string').toBe(true);
    const asFrozen = compareReplay({ plan, runs: runsOf(hash, specs) });
    expect(asFrozen.outcome, `the plan as frozen (${asFrozen.reason})`).toBe('adopt');
    // The same plan, its keys in another order, is the same plan.
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(plan).reverse()))) as ReplayPlan;
    expect(planHash(reordered), 'the same plan with its keys in another order hashes the same').toBe(hash);
    expect(compareReplay({ plan: reordered, runs: runsOf(hash, specs) }).outcome, 'the same plan, keys reordered').toBe('adopt');

    const edits: [string, ReplayPlan][] = [
      ['a task dropped', { ...plan, tasks: tasks.slice(0, 19) }],
      ['the repeats', { ...plan, repeats: 2 }],
      ['the measures', { ...plan, measures: [GRADE, TOKENS] }],
      ['the judge model', { ...plan, models: { ...plan.models, judge: 'gpt-reserve-mini' } }],
      ['the agent model', { ...plan, models: { ...plan.models, agent: 'claude-opus-5-5' } }],
      ['the change variant', { ...plan, variants: { ...plan.variants, change: { ...plan.variants.change, files: { 'CLAUDE.md': '# Shop\n\nAnswer briefly.\n' } } } }],
      ['the base variant', { ...plan, variants: { ...plan.variants, base: { ...plan.variants.base, name: 'egret' } } }],
      ['the cutoff', { ...plan, cutoff: plan.cutoff + 86_400_000 }],
      ['the fitted tasks', { ...plan, fitted: ['f01'] }],
    ];
    for (const [what, edited] of edits) {
      const after = planHash(edited);
      expect(after, `planHash changes when ${what} changes`).not.toBe(hash);
      const base = runsOf(hash, specs).filter((r) => r.side === 'base');
      const change = runsOf(after, specs).filter((r) => r.side === 'change');
      for (const [when, p, runs] of [
        ['the change side ran under the edited plan, compared under it', edited, [...base, ...change]],
        ['the change side ran under the edited plan, compared under the first', plan, [...base, ...change]],
        ['both sides ran, then the plan was edited', edited, runsOf(hash, specs)],
      ] as const) {
        const c = compareReplay({ plan: p, runs: [...runs] });
        expect(c.outcome, `${what}: ${when} (${c.reason})`).toBe('refused');
      }
    }
  });

  it(`AC5 ${AC5} a pair with a failed side stays in the denominator and never shows improvement`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const plan = makePlan({ tasks });
    const specs: TaskSpec[] = [
      ...ids('t', 6).map((t) => steady(t, 0.5, 0.2)),
      ...['t07', 't08', 't09', 't10', 't11', 't12'].map((t) => steady(t, 0.5, -0.1)),
      // The base side failed on every repeat; the change's side reads 0.9. Read as zero, it would be a gain of 0.9.
      ...['t13', 't14', 't15', 't16'].map((task): TaskSpec => ({ task, base: 'fail', change: [0.9, 0.9, 0.9] })),
      // The change's side failed on every repeat.
      ...['t17', 't18', 't19', 't20'].map((task): TaskSpec => ({ task, base: [0.5, 0.5, 0.5], change: 'fail' })),
    ];
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs) });
    expect(c.n, `every task the plan names is in the denominator (${c.reason})`).toBe(20);
    expect(c.tasks.length, 'one pair per task').toBe(20);
    for (const t of ['t13', 't14', 't15', 't16', 't17', 't18', 't19', 't20']) {
      const p = pairOf(c, t);
      expect(p.failed, `${t} has a failed side`).toBe(true);
      expect(typeof p.diff.grade, `${t}'s difference is a number in the count`).toBe('number');
      expect(p.diff.grade!, `${t}'s difference shows no improvement`).toBeLessThanOrEqual(0);
    }
    for (const t of ids('t', 12)) expect(pairOf(c, t).failed, `${t} has no failed side`).toBe(false);
    const grade = measureOf(c, 'grade');
    // Twelve complete pairs sum to 6 × 0.2 − 6 × 0.1 = 0.6; over 20 tasks with no failed pair above 0, the mean is at most 0.03.
    expect(grade.mean, 'the mean gain is a number').not.toBeNull();
    expect(grade.mean!, 'the mean gain counts the failed pairs at no more than 0, over all 20 tasks').toBeLessThanOrEqual(0.03 + 1e-9);
    expect(c.outcome, `outcome (${c.reason})`).not.toBe('adopt');
  });

  it(`AC5 ${AC5} a missing metric is reported missing, not zero, and the measure it is missing from can't decide`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const plan = makePlan({ tasks, measures: [GRADE, TOKENS] });
    const measures = [GRADE, TOKENS];
    const specs: TaskSpec[] = tasks.map((t, i) => ({
      ...steady(t, 0.5, 0.15 + (i % 5) * 0.025),
      tokens: { base: [1000, 1000, 1000], change: t === 't05' ? [800, null, 800] : [800 - (i % 4) * 10, 800, 800] },
    }));
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs, measures) });
    const tokens = measureOf(c, 'tokens');
    expect(tokens.missing, 'the tokens measure names the task its value is missing from').toEqual(['t05']);
    expect(pairOf(c, 't05').diff.tokens, "t05's tokens difference is missing, not a number").toBeNull();
    expect(typeof pairOf(c, 't05').diff.grade, "t05's grade difference is there: only tokens is missing").toBe('number');
    expect(tokens.mean, 'a measure with a missing value has no mean').toBeNull();
    expect(tokens.bound, 'nor a bound').toBeNull();
    const grade = measureOf(c, 'grade');
    expect(grade.bound!, 'grade alone would decide for the change').toBeGreaterThan(0);
    expect(c.outcome, `outcome: a declared measure can't decide (${c.reason})`).toBe('INCONCLUSIVE');
  });

  it(`AC5 ${AC5} a complete cohort too small to decide reports INCONCLUSIVE, with the README's bound`, () => {
    const { compareReplay, planHash } = rule();
    const three = makePlan({ tasks: ['t01', 't02', 't03'] });
    const diffs = [0.3, 0.1, -0.05];
    const c = compareReplay({ plan: three, runs: runsOf(planHash(three), ['t01', 't02', 't03'].map((t, i) => steady(t, 0.5, diffs[i]!))) });
    const want = expectedBound(diffs);
    const grade = measureOf(c, 'grade');
    expect(grade.mean!, 'the mean gain').toBeCloseTo(want.mean, 6);
    expect(grade.bound!, 'the one-sided 95% t bound over 3 tasks').toBeCloseTo(want.bound, 6);
    expect(c.n).toBe(3);
    expect(c.outcome, `three complete tasks with a mean gain of ${want.mean.toFixed(3)} (${c.reason})`).toBe('INCONCLUSIVE');
    const one = makePlan({ tasks: ['t01'] });
    const single = compareReplay({ plan: one, runs: runsOf(planHash(one), [steady('t01', 0.5, 0.3)]) });
    expect(single.outcome, `one complete task gaining 0.3 (${single.reason})`).toBe('INCONCLUSIVE');
  });
});

describe(`AC7 ${AC7} repeats are averaged, never maxed`, () => {
  it(`AC7 ${AC7} a change that wins best-of-three on 15 of 20 tasks but whose mean over the three repeats is lower is not adopted`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const plan = makePlan({ tasks });
    // 15 tasks: the change's best repeat (0.9) beats the base's (0.6), its mean (0.433) doesn't. 5 tasks: it loses outright.
    const specs: TaskSpec[] = tasks.map((task, i) => ({ task, base: [0.6, 0.6, 0.6], change: i < 15 ? [0.9, 0.2, 0.2] : [0.5, 0.5, 0.5] }));
    const bestWins = specs.filter((s) => Math.max(...(s.change as number[])) > Math.max(...(s.base as number[]))).length;
    expect(bestWins, 'the planted cohort: best-of-three wins on 15 of 20').toBe(15);
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), specs) });
    expect(pairOf(c, 't01').diff.grade!, "t01's difference is its repeats' means: 0.433 − 0.6").toBeCloseTo(1.3 / 3 - 0.6, 9);
    expect(pairOf(c, 't20').diff.grade!, "t20's difference: 0.5 − 0.6").toBeCloseTo(-0.1, 9);
    expect(measureOf(c, 'grade').mean!, 'the mean gain over 20 tasks of the repeats averaged').toBeCloseTo(-0.15, 9);
    expect(c.outcome, `outcome (${c.reason})`).not.toBe('adopt');
  });
});

describe(`AC8 ${AC8} the one rule: adopted only when the one-sided 95% bound beats the base on every declared measure`, () => {
  it(`AC8 ${AC8} 20 replayed tasks with a higher mean gain whose bound is below 0 read INCONCLUSIVE; a bound above 0 adopts`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const plan = makePlan({ tasks });
    const noisy = tasks.map((_, i) => (i < 12 ? 0.3 : -0.3));
    const c = compareReplay({ plan, runs: runsOf(planHash(plan), tasks.map((t, i) => steady(t, 0.5, noisy[i]!))) });
    const want = expectedBound(noisy);
    const grade = measureOf(c, 'grade');
    expect(grade.mean!, 'a higher mean gain').toBeCloseTo(want.mean, 6);
    expect(grade.mean!).toBeGreaterThan(0);
    expect(grade.bound!, 'the bound: mean − t(0.95, 19) · sd / √20').toBeCloseTo(want.bound, 6);
    expect(grade.bound!).toBeLessThan(0);
    expect(c.outcome, `outcome (${c.reason})`).toBe('INCONCLUSIVE');

    const clear = tasks.map((_, i) => (i < 17 ? 0.3 : -0.1));
    const d = compareReplay({ plan, runs: runsOf(planHash(plan), tasks.map((t, i) => steady(t, 0.5, clear[i]!))) });
    expect(measureOf(d, 'grade').bound!, 'the decisive cohort\'s bound').toBeCloseTo(expectedBound(clear).bound, 6);
    expect(d.outcome, `a bound above 0 (${d.reason})`).toBe('adopt');
  });

  it(`AC8 ${AC8} a bound above 0 on one declared measure and not the other is INCONCLUSIVE; a bound worse on any measure regresses`, () => {
    const { compareReplay, planHash } = rule();
    const tasks = ids('t', 20);
    const measures = [GRADE, TOKENS];
    const plan = makePlan({ tasks, measures });
    const hash = planHash(plan);
    const spec = (tokensChange: (i: number) => number) => tasks.map((t, i) => ({
      ...steady(t, 0.5, i < 17 ? 0.3 : -0.1),
      tokens: { base: [1000, 1000, 1000], change: Array(3).fill(tokensChange(i)) },
    }));
    // tokens: 12 tasks 100 fewer, 8 tasks 100 more: a gain on average, bound below 0.
    const mixed = compareReplay({ plan, runs: runsOf(hash, spec((i) => (i < 12 ? 900 : 1100)), measures) });
    expect(mixed.outcome, `grade decides, tokens can't (${mixed.reason})`).toBe('INCONCLUSIVE');
    // tokens: every task 300 to 400 more: worse beyond doubt.
    const worse = compareReplay({ plan, runs: runsOf(hash, spec((i) => 1300 + (i % 3) * 50), measures) });
    expect(worse.outcome, `grade gains, tokens worse (${worse.reason})`).toBe('regresses');
  });
});
