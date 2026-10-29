// The eval end to end, on a fixture repo's past tasks, through runEval with the scripted fake Launcher (README: The
// fake agent and judge). Nothing calls a model or spends plan usage.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC3, AC4, AC5, AC7, agentViewProblems, CUTOFF, DAY, evalModule, evalWorld, fakeLauncher, GRADE, gradesIn, ids, judgeViewProblems,
  makePlan, makeTasks, measureOf, pairOf, plainEnv, removeRoots, runOnFake, sorted, T0, TOKENS, type Script,
} from './helpers.ts';

afterAll(removeRoots);
const TIMEOUT = 240_000;
/** n tasks after the cutoff, half a day apart. */
const afterCutoff = (prefix: string, n: number) => ids(prefix, n).map((id, i) => ({ id, at: CUTOFF + (i + 1) * (DAY / 2) }));

describe(`AC1 ${AC1} a change that regresses replayed tasks is held, with the tasks it broke`, () => {
  it(`AC1 ${AC1} on 10 replayed tasks, four fall from 0.9 to 0.1: the change is held, naming those four`, async () => {
    const w = evalWorld();
    const tasks = makeTasks(w.repo, afterCutoff('t', 10));
    const broken = ['t02', 't05', 't06', 't09'];
    const plan = makePlan({ tasks: tasks.map((t) => t.id) });
    const script: Script = (task, side, k) => (k < 3 ? { quality: broken.includes(task) ? (side === 'base' ? 0.9 : 0.1) : 0.7 } : undefined);
    const { report, fake } = await runOnFake(w, plan, tasks, script);
    expect(fake.problems, 'what the fake saw go wrong').toEqual([]);
    for (const t of tasks) {
      for (const side of ['base', 'change'] as const) {
        const q = broken.includes(t.id) ? (side === 'base' ? 0.9 : 0.1) : 0.7;
        expect(gradesIn(report, t.id, side), `${t.id}'s ${side} runs carry the judge's grades`).toEqual([q, q, q]);
      }
    }
    expect(report.after.outcome, `outcome (${report.after.reason})`).toBe('regresses');
    expect(report.held, 'the change is held').toBe(true);
    expect(sorted(report.after.broke), 'the tasks it broke').toEqual(broken);
  }, TIMEOUT);
});

describe(`AC3 ${AC3} replayed tasks come from after the cutoff, and the result reports both sides of it`, () => {
  const fitted = () => ids('f', 4).map((id, i) => ({ id, at: T0 + (i + 1) * DAY }));
  it(`AC3 ${AC3} the decision rests on the 12 tasks after the cutoff; the tasks it was fitted on are reported beside them and never decide`, async () => {
    const w = evalWorld();
    const tasks = makeTasks(w.repo, [...afterCutoff('a', 12), ...fitted()]);
    const after = ids('a', 12), before = ids('f', 4);
    const plan = makePlan({ tasks: after, fitted: before });
    // Before the cutoff the change gains 0.7 to 0.9; after it, five of 12 tasks fall by 0.3. Pooled, the gain is +0.11.
    const fitGain: Record<string, number> = { f01: 0.8, f02: 0.7, f03: 0.8, f04: 0.9 };
    const script: Script = (task, side, k) => {
      if (k >= 3) return undefined;
      if (task in fitGain) return { quality: side === 'base' ? 0.1 : Math.round((0.1 + fitGain[task]!) * 10) / 10 };
      return { quality: Number(task.slice(1)) <= 5 ? (side === 'base' ? 0.7 : 0.4) : 0.6 };
    };
    const { report, fake } = await runOnFake(w, plan, tasks, script);
    expect(fake.problems, 'what the fake saw go wrong').toEqual([]);
    expect(report.after.n, 'after the cutoff: the 12 replayed tasks').toBe(12);
    expect(sorted(report.after.tasks.map((p) => p.task)), 'the deciding side holds only tasks after the cutoff').toEqual(after);
    expect(report.before.n, 'before the cutoff: the 4 tasks it was fitted on').toBe(4);
    expect(sorted(report.before.tasks.map((p) => p.task)), 'the fitted side holds only tasks before the cutoff').toEqual(before);
    expect(report.before.outcome, `before the cutoff the change gains (${report.before.reason})`).toBe('adopt');
    expect(report.after.outcome, `after it, the change regresses, and that decides (${report.after.reason})`).toBe('regresses');
    expect(report.held, 'held on the tasks after the cutoff, whatever the fitted tasks show').toBe(true);
    expect(sorted(report.after.broke), 'the tasks it broke are after the cutoff').toEqual(ids('a', 5));
    for (const f of before) expect(gradesIn(report, f, 'change').length, `${f} was replayed, 3 times a side`).toBe(3);
  }, TIMEOUT);

  it(`AC3 ${AC3} a plan deciding on a task from before the cutoff, or fitting on one after it, is refused before anything runs`, async () => {
    const w = evalWorld();
    const ev = await evalModule();
    const tasks = makeTasks(w.repo, [...afterCutoff('a', 12), ...fitted()]);
    const script: Script = () => ({ quality: 0.5 });
    for (const [what, plan] of [
      ['a task from before the cutoff among the deciding tasks', makePlan({ tasks: [...ids('a', 11), 'f01'], fitted: ids('f', 4).slice(1) })],
      ['a task from after the cutoff among the fitted tasks', makePlan({ tasks: ids('a', 11), fitted: [...ids('f', 4), 'a12'] })],
    ] as const) {
      const fake = fakeLauncher(tasks, script);
      const report = await ev.runEval({ plan, tasks, root: w.root, env: plainEnv(w.home), launcher: fake.launcher });
      expect(report.after.outcome, `${what} (${report.after.reason})`).toBe('refused');
      expect(fake.views.length + fake.judged.length, `${what}: no agent or judge started`).toBe(0);
      expect(report.runs, `${what}: no runs`).toEqual([]);
    }
  }, TIMEOUT);
});

describe(`AC4 ${AC4} agents under test don't know it's an eval; the judge sees only unlabeled outputs, from another model family`, () => {
  it(`AC4 ${AC4} each agent starts on the task's own words in a plain checkout of its commit; the judge sees outputs with no side, name or order to tell them by`, async () => {
    const w = evalWorld();
    const tasks = makeTasks(w.repo, afterCutoff('t', 12));
    const plan = makePlan({ tasks: tasks.map((t) => t.id) });
    const script: Script = (task, side, k) => (k < 3 ? { quality: side === 'base' ? 0.5 + Number(task.slice(1)) / 100 : 0.6 } : undefined);
    const { report, fake } = await runOnFake(w, plan, tasks, script, true);
    expect(fake.problems, 'what the fake saw go wrong').toEqual([]);
    expect(fake.views.length, 'every repeat of every side ran once: 12 × 2 × 3').toBe(72);
    const agent = fake.views.flatMap((v) => agentViewProblems(v, tasks, plan, report.hash, w.repo));
    expect(agent.slice(0, 12), `what told an agent it was in an eval (${agent.length} in all)`).toEqual([]);
    expect(fake.judged.length, 'the judge graded the outputs').toBeGreaterThan(0);
    const shown = new Set(fake.judged.flatMap((r) => r.outputs.map((o) => /nonce=([0-9a-f]{16})/.exec(o.text)?.[1])));
    expect([...fake.outputs.keys()].filter((n) => !shown.has(n)).length, 'every output was shown to the judge').toBe(0);
    const judge = judgeViewProblems(fake, plan, report.hash);
    expect(judge.slice(0, 12), `what told the judge a side (${judge.length} in all)`).toEqual([]);
  }, TIMEOUT);

  it(`AC4 ${AC4} a plan naming a judge of the agents' own family is refused before anything runs`, async () => {
    const w = evalWorld();
    const ev = await evalModule();
    const tasks = makeTasks(w.repo, afterCutoff('t', 12));
    for (const models of [{ agent: 'claude-sonnet-5-5', judge: 'claude-opus-5-5' }, { agent: 'gpt-reserve', judge: 'gpt-reserve-mini' }]) {
      const fake = fakeLauncher(tasks, () => ({ quality: 0.5 }));
      const report = await ev.runEval({ plan: makePlan({ tasks: tasks.map((t) => t.id), models }), tasks, root: w.root, env: plainEnv(w.home), launcher: fake.launcher });
      expect(report.after.outcome, `a ${models.agent} agent judged by ${models.judge} (${report.after.reason})`).toBe('refused');
      expect(fake.views.length + fake.judged.length, 'no agent or judge started').toBe(0);
    }
  }, TIMEOUT);
});

describe(`AC5 ${AC5} a failed side stays in the count; a metric not captured stays missing`, () => {
  it(`AC5 ${AC5} usage an agent didn't report reads missing, never 0; a side that failed keeps its task in the denominator`, async () => {
    const w = evalWorld();
    const tasks = makeTasks(w.repo, afterCutoff('t', 12));
    const plan = makePlan({ tasks: tasks.map((t) => t.id), measures: [GRADE, TOKENS] });
    const script: Script = (task, side, k) => {
      if (k >= 3) return undefined;
      if (task === 't09' && side === 'base') return { fail: true };
      const n = Number(task.slice(1));
      return side === 'base' ? { quality: 0.5, tokens: 1200 } : { quality: 0.7 + (n % 3) * 0.01, tokens: task === 't05' && k === 1 ? null : 900 };
    };
    const { report, fake } = await runOnFake(w, plan, tasks, script);
    expect(fake.problems, 'what the fake saw go wrong').toEqual([]);
    const t05 = report.runs.filter((r) => r.task === 't05' && r.side === 'change');
    expect(t05.filter((r) => r.metrics.tokens === null).length, "t05's change run whose usage wasn't reported reads tokens missing").toBe(1);
    expect(report.runs.filter((r) => r.metrics.tokens === 0).length, 'no run reads 0 tokens').toBe(0);
    for (const r of report.runs.filter((x) => x.ok && !(x.task === 't05' && x.metrics.tokens === null))) {
      expect(r.metrics.tokens, `${r.task} ${r.side} repeat ${r.repeat}: the tokens it reported, input plus output`).toBe(r.side === 'base' ? 1200 : 900);
    }
    const t09 = report.runs.filter((r) => r.task === 't09' && r.side === 'base');
    expect(t09.map((r) => r.ok), "t09's base side failed on every repeat").toEqual([false, false, false]);
    expect(report.after.n, 'the failed pair stays in the denominator').toBe(12);
    const p09 = pairOf(report.after, 't09');
    expect(p09.failed, 't09 has a failed side').toBe(true);
    expect(p09.diff.grade!, "t09's difference shows no improvement").toBeLessThanOrEqual(0);
    const tokens = measureOf(report.after, 'tokens');
    expect(tokens.missing, 'the tokens measure names t05 missing').toContain('t05');
    expect(tokens.mean, 'and has no mean').toBeNull();
    expect(report.after.outcome, `grade gains, tokens can't decide (${report.after.reason})`).toBe('INCONCLUSIVE');
  }, TIMEOUT);
});

describe(`AC7 ${AC7} repeats are averaged, never maxed`, () => {
  it(`AC7 ${AC7} the eval runs three repeats a side and keeps them all: best-of-three wins on 15 of 20 tasks, the mean is lower, it is not adopted`, async () => {
    const w = evalWorld();
    const tasks = makeTasks(w.repo, afterCutoff('t', 20));
    const plan = makePlan({ tasks: tasks.map((t) => t.id) });
    const change = (task: string) => (Number(task.slice(1)) <= 15 ? [0.9, 0.2, 0.2] : [0.5, 0.5, 0.5]);
    const script: Script = (task, side, k) => (k < 3 ? { quality: side === 'base' ? 0.6 : change(task)[k]! } : undefined);
    const { report, fake } = await runOnFake(w, plan, tasks, script);
    expect(fake.problems, 'what the fake saw go wrong, such as a side run more than three times').toEqual([]);
    let bestWins = 0;
    for (const t of tasks) {
      const c = gradesIn(report, t.id, 'change'), b = gradesIn(report, t.id, 'base');
      expect(c, `${t.id}'s three change runs, each kept`).toEqual([...change(t.id)].sort((x, y) => x - y));
      expect(b, `${t.id}'s three base runs`).toEqual([0.6, 0.6, 0.6]);
      if (Math.max(...(c as number[])) > Math.max(...(b as number[]))) bestWins++;
    }
    expect(bestWins, 'best-of-three wins on 15 of 20').toBe(15);
    expect(measureOf(report.after, 'grade').mean!, 'the mean gain of the repeats averaged').toBeCloseTo(-0.15, 9);
    expect(report.after.outcome, `outcome (${report.after.reason})`).not.toBe('adopt');
  }, TIMEOUT);
});
