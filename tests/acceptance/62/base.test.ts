// #62 AC1 and AC9: the base learning never changes. A learned change aimed at a kernel rule, an invariant, a
// spec, an approved check, a decision or a rule you typed is refused, naming the target, and the refused
// attempt is recorded; so is one that would take your rule out of the start slice. Only you change the base,
// as a change of layer `base` you apply. Wrong program: a core that checks only the `layer` field.
import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, apply, decide, expectRefused, expectState, LOCAL_FIRST, openWorld, removeRoots, said, sliceText, startSession, widen } from './helpers.ts';

afterEach(removeRoots);

describe('AC9 learned changes aimed at the base are refused, naming the target', () => {
  it("AC9 layer: learned aimed at spec:shop, a decision, an approved check and a rule you typed are each refused, naming the target, and so is one removing your rule 'never push without asking' from the start slice", async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: 'never push without asking' },
      { id: 'm2', from: 'you', text: 'the checkout spec should allow guest checkout' },
    ]);
    const S2 = await startSession(w, 'blog', [{ id: 'm1', from: 'you', text: 'write the release notes' }]);
    // The rule you typed: a change to the base, layer base, applied by you (README: Readings).
    const nopush = await apply(w, { layer: 'base', target: 'rule:nopush', diff: '+ never push without asking', evidence: [{ at: said(S1, 'm1'), quote: 'never push without asking' }], scope: 'all' }, 'you');
    await expectState(w, nopush, 'applied', 'the rule you typed');
    const decision = await decide(w, 'merge with a squash');
    const evidence = [{ at: said(S1, 'm2'), quote: 'allow guest checkout' }];
    const attempts: { target: string; diff: string; by: 'you' | typeof LOCAL_FIRST }[] = [
      { target: 'spec:shop', diff: '+ guests may check out', by: 'you' },
      { target: `decision:${decision}`, diff: '- merge with a squash\n+ merge with a rebase', by: LOCAL_FIRST },
      { target: 'check:app.e2e', diff: '- expect(total).toBeVisible()', by: LOCAL_FIRST },
      { target: 'rule:nopush', diff: '- never push without asking\n+ push when the tests pass', by: 'you' },
    ];
    const ids: string[] = [];
    for (const a of attempts) {
      // Every one carries layer: learned, as a core that checks only the layer field would accept.
      const id = await apply(w, { layer: 'learned', target: a.target, diff: a.diff, evidence, scope: `session:${S1}` }, a.by);
      ids.push(id);
      await expectRefused(w, id, a.target, `a learned change aimed at ${a.target}`);
    }
    // Removing your typed rule through a start-slice entry: refused, naming the rule (its target or its words).
    const removal = await apply(w, { target: 'slice:git', diff: '- never push without asking', evidence: [{ at: said(S1, 'm1'), quote: 'never push without asking' }], scope: `session:${S1}` }, LOCAL_FIRST);
    ids.push(removal);
    await expectRefused(w, removal, ['rule:nopush', 'never push without asking'], 'a learned change removing your rule from the start slice');
    for (const s of [S1, S2]) expect(await sliceText(w, s), `session ${s} still reads your rule at its start`).toContain('never push without asking');
    // Recorded: each refused attempt stays in the log.
    const logged = new Set((await allEvents(w.record)).map((e) => e.id));
    for (const id of ids) expect(logged.has(id), `the refused attempt ${id} is in the record`).toBe(true);
    await w.record.close();
  });
});

describe('AC1 no learned change can edit a check, a decision, a kernel rule or an invariant', () => {
  it('AC1 each attempt, applied or widened, is refused and recorded, stays refused after a rebuild, and a base change you apply goes through', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'a PASS should not need three runs here' }]);
    const decision = await decide(w, 'ship on Fridays');
    const evidence = [{ at: said(S1, 'm1'), quote: 'a PASS should not need three runs' }];
    const targets = ['kernel:pass-needs-real-runs', 'invariant:nothing-unrun-passes', 'check:app.unit', `decision:${decision}`];
    const ids: [string, string][] = [];
    for (const target of targets) {
      ids.push([await apply(w, { target, diff: '- needs 3 clean runs\n+ needs 1 clean run', evidence, scope: `session:${S1}` }, LOCAL_FIRST), target]);
      ids.push([await widen(w, { target, diff: '- needs 3 clean runs\n+ needs 1 clean run', evidence, scope: 'repo:shop' }, 'you'), target]);
    }
    for (const [id, target] of ids) await expectRefused(w, id, target, `a learned change aimed at ${target}`);
    // Only you change the base, as a change of layer base you apply: not refused. Wrong program: a core that
    // refuses every change to these targets, whoever makes it, which would leave you no way to change them.
    const yours = await apply(w, { layer: 'base', target: 'check:app.unit', diff: '- needs 3 clean runs\n+ needs 2 clean runs', evidence, scope: 'all' }, 'you');
    await expectState(w, yours, 'applied', 'your own base change');
    const logged = new Set((await allEvents(w.record)).map((e) => e.id));
    for (const [id] of ids) expect(logged.has(id), `the refused attempt ${id} is in the record`).toBe(true);
    // Recorded, not remembered: a refusal kept only in memory or only in the table is lost to a rebuild.
    await w.record.rebuild();
    for (const [id, target] of ids) await expectRefused(w, id, target, `after a rebuild, the change aimed at ${target}`);
    await expectState(w, yours, 'applied', 'after a rebuild, your own base change');
    await w.record.close();
  });
});
