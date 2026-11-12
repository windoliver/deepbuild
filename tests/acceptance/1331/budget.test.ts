// AC5: a requirement only a budget window can settle doesn't hold a landing; every other non-PASS does.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, requirement, World } from './helpers.ts';

const BUDGET = 'p95 of checkout under 5 ms on the reference Mac';
const budget = (id: string) => requirement(id, BUDGET, null, { settled_by: 'budget-window' });

describe(`${AC[5]} a change whose only open requirement is a budget lands and its issue stays open naming it; an open FAIL, INCONCLUSIVE or BLOCKED on anything else doesn't land`, () => {
  it('lands the budget-only change, naming the requirement on its open issue; holds FAIL, INCONCLUSIVE and BLOCKED', async () => {
    const w = await World.open({
      drafts: [
        draftFor(100, [requirement('R1', 'x3 works', checkFile('own3')), budget('R2')]),
        draftFor(101, [requirement('R1', 'x2 works', checkFile('own2')), budget('R2')]),
        draftFor(102, [requirement('R1', 'x1 is stable', checkFile('flaky'), { runs: 2 })]),
        draftFor(103, [requirement('R1', 'c is checked', '.deepbuild/checks/missing.sh')]),
      ],
    });
    const only = await w.change('budget-only', { 'src/x3.ts': "export const v = 'three';\n" }, { body: 'Part of #100' });
    const fail = await w.change('fails', { 'src/x2.ts': "export const v = 'BROKEN';\n" }, { body: 'Part of #101' });
    const flaky = await w.change('flaky', { 'src/x1.ts': "export const v = 'one';\n" }, { body: 'Part of #102' });
    const blocked = await w.change('blocked', { 'src/c.ts': "export const v = 'cee';\n" }, { body: 'Part of #103' });
    await w.judge();
    const round = await w.land();
    expect(round.code, `deep land exited ${round.code}: ${round.stderr.slice(0, 600)}`).toBe(0);

    const merged = w.forge.merges.map((m) => m.pr);
    expect(merged, `only PR #${only.pr} (issue #${only.issue}, whose only open requirement is a budget) lands; these landed: ${merged.join(', ')}`).toEqual([only.pr]);
    const issue = w.forge.issues.get(only.issue)!;
    expect(issue.state, `issue #${only.issue} stays open: its budget requirement is settled by the window`).toBe('open');
    expect(w.issueText(only.issue), `issue #${only.issue} must name the requirement the window settles`).toContain(BUDGET);

    const held = round.json?.held as { issue: number; reason: string }[] | undefined;
    for (const [c, word] of [[fail, 'FAIL'], [flaky, 'INCONCLUSIVE'], [blocked, 'BLOCKED']] as const) {
      expect(w.forge.pulls.get(c.pr)!.merged, `PR #${c.pr} (issue #${c.issue}) has an open ${word} on a requirement a budget window cannot settle: it must not land`).toBe(false);
      const why = held?.find((h) => h.issue === c.issue)?.reason ?? '';
      expect(why.toUpperCase(), `the round must report why issue #${c.issue} is held, naming ${word}; it reports ${JSON.stringify(held)}`).toContain(word);
      expect(w.forge.issues.get(c.issue)!.state, `issue #${c.issue} stays open`).toBe('open');
    }
  }, 30 * 60_000);
});
