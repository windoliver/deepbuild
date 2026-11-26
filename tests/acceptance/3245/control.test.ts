// The control before any agent runs, through the real runEval with scripted agents and a scripted judge (README: The
// surface under test; The control). Nothing calls a model.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC6, AC8, controlProblems, controlsLast, evaluate, JUDGE, planOf, PLAIN, removeRoots, sorted, stub, tasksOf, world,
  type Judge, type Script,
} from './helpers.ts';

afterAll(removeRoots);
/** An eval checks out each run's commit with git, which a loaded machine takes its time over. */
const TIMEOUT = 600_000;
const script: Script = (task) => ({ files: { 'src/cart.js': `// ${task}\nexport const total = (items) => items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);\n` }, reply: 'I changed total().' });
/** A score in words: the number itself, never a digit of another. */
const score = (n: number): RegExp => new RegExp(`(?<![\\d.])${String(n).replace('.', '\\.')}0*(?!\\d)`);

describe(`AC6 ${AC6} a judge that scores no change as done decides nothing`, () => {
  it(`AC6 ${AC6} no change scored 0.9 refuses the eval before any agent starts, naming the judge and the score; 0.1, with the right change 0.9, goes on with the control in its report; a planted eval that runs the control after the agents fails, naming the first agent run`, async () => {
    const w = world(), tasks = tasksOf(w, 2);
    const under = async (control: NonNullable<Judge['control']>) => {
      const s = stub(tasks, script, { ...PLAIN, control });
      return { s, report: await evaluate(w, planOf(tasks), tasks, s) };
    };
    const refused = await under({ right: 0.95, none: 0.9 });
    expect(refused.report.after.outcome, `a judge that scores no change at 0.9 (${refused.report.after.reason})`).toBe('refused');
    expect(refused.s.trace, 'it was asked for the control, and no agent started').toEqual(['the control']);
    for (const named of [JUDGE, score(0.9), score(0.95)]) expect(refused.report.after.reason, 'the reason names the judge and both scores').toMatch(named);
    expect(refused.report.runs, 'no run').toEqual([]);
    expect(refused.report.control, "the refused eval's report holds the control's scores").toMatchObject({ right: 0.95, none: 0.9 });
    const others: [string, NonNullable<Judge['control']>][] = [
      ['no change at 0.5', { right: 0.9, none: 0.5 }], ['no change at the right change', { right: 0.4, none: 0.4 }], ['no change above the right change', { right: 0.3, none: 0.4 }],
      ['no score for no change', { right: 0.9 }], ['no score for the right change', { none: 0.1 }], ['a score for no change that is no number', { right: 0.9, none: NaN }], ['a judge that fails', 'fails'],
    ];
    for (const [what, control] of others) {
      const { s, report } = await under(control);
      expect(report.after.outcome, `${what} (${report.after.reason})`).toBe('refused');
      expect(s.ran, `${what}: no agent started`).toEqual([]);
      for (const named of [JUDGE, ...(control === 'fails' ? [] : Object.values(control).filter(Number.isFinite).map(score))]) expect(report.after.reason, `${what}: the reason names the judge and each score it gave`).toMatch(named);
    }

    const on = await under({ right: 0.9, none: 0.1 });
    expect(on.report.after.outcome, `0.1 and 0.9 (${on.report.after.reason})`).not.toBe('refused');
    expect(controlProblems(on.s), "the eval's first judge request, before any agent, is a change and no change").toEqual([]);
    expect(on.report.control, 'the control is in its report, as it was sent, with its scores').toMatchObject({ request: on.s.judged[0]!.request, right: 0.9, none: 0.1 });
    expect(on.s.judged[0]!.request.model, "the plan's judge is asked").toBe(JUDGE);
    expect(sorted(on.s.judged[0]!.request.outputs.map((o) => o.label)), 'its labels are those of any other request of two outputs').toEqual(sorted(on.s.judged[1]?.request.outputs.map((o) => o.label) ?? []));
    // One request, the package's own: another eval, of other tasks, sends the same words and the same two outputs.
    const edge = stub(tasks.slice(0, 1), script, { ...PLAIN, control: { right: 0.5, none: 0.49 } });
    const just = await evaluate(w, planOf(tasks.slice(0, 1), { id: 'trial-other' }), tasks, edge);
    expect(just.after.outcome, `0.49 and 0.5 (${just.after.reason})`).not.toBe('refused');
    const own = ({ prompt, outputs }: { prompt: string; outputs: { text: string }[] }) => ({ prompt, outputs: sorted(outputs.map((o) => o.text)) });
    expect(own(edge.judged[0]!.request), 'the control is the same in every eval').toEqual(own(on.s.judged[0]!.request));

    const planted = stub(tasks, script);
    await evaluate(w, planOf(tasks), tasks, planted, controlsLast);
    expect(controlProblems(planted)[0], 'the planted eval that runs the control after the agents fails, naming the first agent run').toBe(`${planted.trace[0]} started before the control`);
  }, TIMEOUT);
});

describe(`AC8 ${AC8} budgets`, () => {
  it(`AC8 ${AC8} the control adds one judge request to the merge base's 6 and no agent run to its 12; an eval that grades nothing asks its judge nothing, as on the merge base`, async () => {
    const w = world(), tasks = tasksOf(w, 6);
    const s = stub(tasks, script);
    const report = await evaluate(w, planOf(tasks), tasks, s);
    expect({ 'judge requests': s.judged.length, 'agent runs': s.ran.length }, `of one eval of six tasks (${report.after.reason})`).toEqual({ 'judge requests': 6 + 1, 'agent runs': 12 });
    const unjudged = stub(tasks, script);
    const tokens = await evaluate(w, planOf(tasks, { measures: [{ name: 'tokens', better: 'lower' }] }), tasks, unjudged);
    expect({ outcome: tokens.after.outcome, 'judge requests': unjudged.judged.length, 'agent runs': unjudged.ran.length, control: tokens.control }, 'of an eval whose plan declares no grade').toEqual({ outcome: 'INCONCLUSIVE', 'judge requests': 0, 'agent runs': 12, control: undefined });
  }, TIMEOUT);
});
