// What the judge is shown of a run, through the real runEval with scripted agents and a scripted judge (README: The
// surface under test). Nothing calls a model.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC5, CAP, evaluate, gradeOf, outputsFor, planOf, removeRoots, repliesShown, showsChange, showsTheReply, sorted, stub, tasksOf, world,
  type Oversize, type Script,
} from './helpers.ts';

afterAll(removeRoots);
/** An eval checks out each run's commit with git, which a loaded machine takes its time over. */
const TIMEOUT = 600_000;
const FIX = { 'src/cart.js': 'export const total = (items) => items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);\n' };

describe(`AC1 ${AC1} a judge that believes a reply has none to believe`, () => {
  it(`AC1 ${AC1} six work tasks with the same change on both sides, the change side's replies ending "Done. All tests pass": each pair's outputs are equal byte for byte and the eval reads INCONCLUSIVE`, async () => {
    const w = world(), tasks = tasksOf(w, 6);
    const script: Script = (_task, side) => ({ files: FIX, reply: `I counted each item's qty in total().${side === 'change' ? ' Done. All tests pass' : ''}` });
    const s = stub(tasks, script, { score: (text) => (/Done\. All tests pass/.test(text) ? 1 : 0.4) });
    const report = await evaluate(w, planOf(tasks), tasks, s);
    const differ = tasks.filter((t) => { const [a, b, ...more] = outputsFor(s, t.id); return a === undefined || a !== b || more.length > 0; }).map((t) => t.id);
    expect({ outcome: report.after.outcome, 'pairs whose two outputs differ': differ }, `the same change on both sides (${report.after.reason})`).toEqual({ outcome: 'INCONCLUSIVE', 'pairs whose two outputs differ': [] });
    // INCONCLUSIVE on a gain of 0 the judge gave, not on a grade it never gave.
    expect(report.runs.map((r) => r.metrics.grade), 'every run is graded on its change').toEqual(Array.from({ length: 12 }, () => 0.4));
    expect(report.after.measures, 'the gain, over six pairs').toMatchObject([{ name: 'grade', mean: 0, missing: [] }]);
    for (const j of s.judged.filter((x) => x.task)) {
      expect(j.request.outputs.every((o) => showsChange(o.text)), `the change is in ${j.task}'s outputs`).toBe(true);
      expect(j.request.prompt.replace(tasks.find((t) => t.id === j.task)!.prompt, ''), "the judge's prompt says the outputs are changes").toMatch(/\bchanges?\b/i);
    }
  }, TIMEOUT);
});

describe(`AC2 ${AC2} no word of an agent's in an output of a work task`, () => {
  it(`AC2 ${AC2} a marker planted in a run's final reply, and in its commit's message, is in no output of a work task, in any request; a planted eval that shows the reply fails, naming the request`, async () => {
    const w = world(), tasks = tasksOf(w, 2);
    const script: Script = (_task, side) => ({ files: FIX, ...(side === 'base' ? { commits: true as const } : {}), reply: 'I counted each item\'s qty and ran every test.' });
    const work = tasks.map((t) => t.id);
    const s = stub(tasks, script);
    await evaluate(w, planOf(tasks), tasks, s);
    expect(repliesShown(s, work), 'where the judge was shown what a run said').toEqual([]);
    expect(work.map((t) => outputsFor(s, t).filter(showsChange).length), 'both runs of each task, the committed change among them, are shown').toEqual([2, 2]);

    const planted = stub(tasks, script);
    await evaluate(w, planOf(tasks), tasks, planted, showsTheReply);
    for (const task of work) expect(repliesShown(planted, work).join('\n'), 'the planted eval that shows the reply fails, naming the request').toMatch(new RegExp(`judge request \\d+ \\(${task}\\) shows what ${task}'s`));
  }, TIMEOUT);
});

describe(`AC3 ${AC3} a run that changed nothing is shown as no change`, () => {
  it(`AC3 ${AC3} a run of a work task that changed no file and replied that it was done is shown as no change, without the reply, and is graded as that`, async () => {
    const w = world(), tasks = tasksOf(w, 2);
    const idle = (task: string, side: string) => task === 't01' && side === 'change';
    const s = stub(tasks, (task, side) => (idle(task, side) ? { reply: 'Done: I implemented and verified the fix.' } : { files: FIX, reply: 'I changed total().' }), { score: (text) => (showsChange(text) ? 0.9 : 0.1) });
    const report = await evaluate(w, planOf(tasks), tasks, s);
    const shown = outputsFor(s, 't01');
    expect(shown.filter(showsChange).length, `t01's outputs: one change, one none (${JSON.stringify(shown)})`).toBe(1);
    expect(shown.length, "both of t01's runs are shown").toBe(2);
    expect(shown.find((text) => !showsChange(text)), 'no change is shown without the reply').not.toMatch(/implemented and verified|mark[0-9a-f]{16}/);
    expect([gradeOf(report, 't01', 'base'), gradeOf(report, 't01', 'change')], 'the run that changed nothing carries the grade of no change').toEqual([0.9, 0.1]);
  }, TIMEOUT);
});

describe(`AC5 ${AC5} an output past the cap is never sent cut`, () => {
  it(`AC5 ${AC5} a run whose change is 30,000 characters gets no grade, the report names 30,000 and the cap, and the comparison reads INCONCLUSIVE, naming the task; a change of exactly the cap is sent whole, and a reply past it isn't`, async () => {
    const w = world(), tasks = tasksOf(w, 6);
    const s = stub(tasks, (task, side) => {
      if (side === 'change' && task === 't03') return { chars: 30_000, reply: 'I changed the prices.' };
      if (side === 'change' && task === 't04') return { chars: CAP, reply: 'I changed the prices.' };
      if (task === 't05') return { reply: side === 'base' ? `The prices are in cents. ${'z'.repeat(25_000)}` : 'The prices are in cents.' };
      return { files: FIX, reply: 'I changed total().' };
    });
    const report = await evaluate(w, planOf(tasks, { words: ['t05'] }), tasks, s);
    const [big, whole, long] = ([['t03', 'change'], ['t04', 'change'], ['t05', 'base']] as const).map(([task, side]) => s.ran.find((r) => r.task === task && r.side === side)!);
    expect([big!.diff.length, whole!.diff.length], "the fixture's two changes, as git diff prints them").toEqual([30_000, 20_000]);
    expect(gradeOf(report, 't03', 'change'), "the 30,000-character run's grade").toBeNull();
    expect(report.runs.find((r) => r.task === 't03' && r.side === 'change')!.ok, 'it is a run that ended, whose grade is missing').toBe(true);
    expect(outputsFor(s, 't03').filter((text) => /x{50}/.test(text)).length, 'no part of it was sent to the judge').toBe(0);
    expect(outputsFor(s, 't05').filter((text) => /z{50}/.test(text)).length, 'nor any part of a reply past the cap, where the reply is the output').toBe(0);
    expect(outputsFor(s, 't04').some((text) => text.includes(whole!.diff.trimEnd())), 'a change of exactly the cap is sent whole').toBe(true);
    expect([gradeOf(report, 't04', 'change'), gradeOf(report, 't05', 'base'), gradeOf(report, 't05', 'change')], 'and graded; the long reply is not').toEqual([0.5, null, 0.5]);
    const listed = [...(report.oversize ?? [])].sort((a, b) => a.task.localeCompare(b.task));
    expect(listed, 'the report names each run past the cap, its size and the cap').toMatchObject([
      { task: 't03', side: 'change', repeat: 1, size: 30_000, cap: CAP }, { task: 't05', side: 'base', repeat: 1, size: long!.reply.length, cap: CAP },
    ] satisfies Oversize[]);
    expect(report.after.outcome, `the comparison (${report.after.reason})`).toBe('INCONCLUSIVE');
    expect(report.after.reason, 'the comparison names the task').toContain('t03');
    expect(report.after.n, 'its pair stays in the count').toBe(6);
    expect(report.after.measures, 'grade is missing, never a number for it').toMatchObject([{ name: 'grade', mean: null, bound: null }]);
    expect(sorted(report.after.measures[0]!.missing), 'the tasks whose grade is missing').toEqual(['t03', 't05']);
  }, TIMEOUT);
});
