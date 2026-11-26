// Which tasks are work and which are graded on words: read from each original session's own tool calls in the archive
// when the plan is made, frozen in it, and followed by the eval (README: The surface under test). The archive, its
// reader, both plan makers, the eval and the comparison are the repo's own. Nothing calls a model.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removalPlan, type ReplayTask } from '../../../packages/config-eval/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { compareReplay, openRecordReader, planHash, type ReplayRun } from '../../../packages/record/src/index.ts';
import {
  AC4, AC7, archive, evaluate, outputsFor, plannedByScript, removeRoots, repliesHidden, repliesShown, showsChange, sorted, stub, world,
  type Archived, type Plan, type Report, type Script, type Stub, type World,
} from './helpers.ts';

afterAll(removeRoots);
/** An eval checks out each run's commit with git, which a loaded machine takes its time over. */
const TIMEOUT = 600_000;
const kindsOf = (sessions: Archived[], ids: readonly string[]): string[] => ids.map((id) => `${sessions.find((s) => s.id === id)?.kind ?? 'unknown'} ${id}`).sort();

interface Made { w: World; sessions: Archived[]; plan: Plan; tasks: ReplayTask[]; words: string[]; work: string[] }
let made: Promise<Made> | undefined;
/** The archive, and the plan `config-eval.mjs plan` froze over its newest 8 sessions and the 2 before them. */
const planned = (): Promise<Made> => (made ??= (async () => {
  const w = world(), sessions = await archive(w);
  const named = sessions.slice(-10);
  return { w, sessions, ...plannedByScript(w, sessions), words: named.filter((s) => !s.work).map((s) => s.id), work: named.filter((s) => s.work).map((s) => s.id) };
})());
/** Agents that change a file on every task but the one named, and say so on all. */
const script = (m: Made, idle: string): Script => (task) => ({ ...(task === idle ? {} : { files: { 'notes.txt': `qty is counted in ${m.sessions.find((s) => s.id === task)!.kind}\n` } }), reply: 'The total leaves out the qty: it sums the prices alone.' });
let ran: Promise<{ m: Made; s: Stub; report: Report; victim: string }> | undefined;
/** The eval on that plan, run once. */
const evaluated = () => (ran ??= (async () => {
  const m = await planned(), victim = m.sessions.findLast((s) => s.kind === 'none')!.id;
  const s = stub(m.tasks, script(m, victim));
  return { m, s, victim, report: await evaluate(m.w, m.plan, m.tasks, s) };
})());

describe(`AC4 ${AC4} a task whose original session changed no file is graded on words`, () => {
  it(`AC4 ${AC4} both plan makers mark the sessions that changed no file; the eval shows their replies and the report lists them as graded on words; a planted plan that marks one a work task shows its judge no change on both sides and fails, naming the task`, async () => {
    const m = await planned();
    const { w, sessions, plan } = m;
    expect(sorted([...plan.tasks, ...plan.fitted]), 'the plan names the newest 8 sessions and the 2 before them').toEqual(sorted(sessions.slice(-10).map((s) => s.id)));
    expect(kindsOf(sessions, plan.words ?? []), "config-eval.mjs plan marks as graded on words the sessions whose own tool calls changed no file").toEqual(kindsOf(sessions, m.words));

    // A removal's plan, over all 24: the newest 20 decide, and the 4 before them are fitted.
    const evidence = await openEvidenceStore({ root: join(w.home, '.deepbuild', 'evidence'), readOnly: true });
    const reader = openRecordReader({ path: join(w.home, '.deepbuild', 'ledger.db'), evidence });
    try {
      const removal = (await removalPlan(reader, (sha) => evidence.read(sha), { id: 'removal-3245', repo: w.repo, file: 'CLAUDE.md', before: '- rule\n', after: '' })).plan as Plan;
      expect([removal.tasks.length, removal.fitted.length], "the removal's plan names every archived session").toEqual([20, 4]);
      expect(kindsOf(sessions, removal.words ?? []), 'removalPlan marks them too, deciding and fitted').toEqual(kindsOf(sessions, sessions.filter((s) => !s.work).map((s) => s.id)));
    } finally {
      reader.close();
    }

    const { s, report, victim } = await evaluated();
    expect(report.after.outcome, `the eval runs (${report.after.reason})`).not.toBe('refused');
    expect(repliesHidden(s, m.words), 'each task graded on words shows both its replies').toEqual([]);
    expect(m.words.flatMap((t) => outputsFor(s, t)).filter((text) => text.includes('qty is counted in')), 'its output is the reply, not a file its replay wrote').toEqual([]);
    expect(repliesShown(s, m.work), 'and no work task does').toEqual([]);
    expect(m.work.every((t) => outputsFor(s, t).length === 2 && outputsFor(s, t).every(showsChange)), 'each work task shows both its changes').toBe(true);
    expect(sorted(report.words ?? []), 'the report lists the tasks graded on words').toEqual(sorted(m.words));

    // The planted plan: the same one, over the task and one work task, with its mark taken away.
    const pair = [victim, plan.tasks.find((t) => m.work.includes(t))!];
    const planted: Plan = { ...plan, tasks: pair, fitted: [], words: m.words.filter((t) => t !== victim && pair.includes(t)) };
    const p = stub(m.tasks, script(m, victim));
    await evaluate(w, planted, m.tasks, p);
    expect(outputsFor(p, victim).map(showsChange), 'the planted plan shows its judge no change on both sides').toEqual([false, false]);
    expect(repliesShown(p, [victim]), 'and no reply').toEqual([]);
    expect(repliesHidden(p, [victim]), 'and fails, naming the task').toEqual([expect.stringContaining(victim)]);
  }, TIMEOUT);
});

describe(`AC7 ${AC7} a task marked the other way after either side ran is refused`, () => {
  it(`AC7 ${AC7} once either side ran, a task graded on words marked a work task, or a work task marked as graded on words, is refused, as any change to the plan is`, async () => {
    const m = await planned();
    const words = m.plan.words ?? [];
    expect(kindsOf(m.sessions, words), "the frozen plan holds each task's mark").toEqual(kindsOf(m.sessions, m.words));
    const { report } = await evaluated();
    expect(report.hash, 'the report carries the hash of the plan as it was made').toBe(planHash(m.plan));
    expect(compareReplay({ plan: m.plan, runs: report.runs }).outcome, 'the plan as it ran compares').not.toBe('refused');
    const task = m.plan.tasks.find((t) => words.includes(t))!, work = m.plan.tasks.find((t) => !words.includes(t))!;
    const flipped: Record<string, Plan> = { [`${task} marked a work task`]: { ...m.plan, words: words.filter((t) => t !== task) }, [`${work} marked as graded on words`]: { ...m.plan, words: [...words, work] } };
    for (const [what, plan] of Object.entries(flipped)) {
      const ranUnder: Record<string, ReplayRun[]> = { 'both sides': report.runs, 'the base side': report.runs.filter((r) => r.side === 'base'), 'the change side': report.runs.filter((r) => r.side === 'change') };
      for (const [sides, runs] of Object.entries(ranUnder)) {
        const c = compareReplay({ plan, runs });
        expect(c.outcome, `${what} after ${sides} ran (${c.reason})`).toBe('refused');
        expect(c.reason, `${what} after ${sides} ran: refused for the plan it ran under`).toMatch(/plan/);
      }
    }
  }, TIMEOUT);
});
