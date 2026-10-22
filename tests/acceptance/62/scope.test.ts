// #62 AC3 and AC6: local first. A change learned in one session reaches another repo only after it widened
// through its repo or you approved it; agents only propose; a rule you typed reaches every open session at
// its next prompt; claims learned at install start at the scope their evidence covers.
import { afterEach, describe, expect, it } from 'vitest';
import { RecordError } from '../../../packages/record/src/index.ts';
import { agentIn, apply, expectState, handleOf, INSTALL, learnEvent, LOCAL_FIRST, openWorld, propose, removeRoots, said, sliceText, startSession, widen } from './helpers.ts';

afterEach(removeRoots);

describe('AC3 a change learned in one session stays local until it widens or you approve it', () => {
  it("AC3 a session's change reaches neither its repo's other sessions nor another repo; a rule's own widening to all is refused; your OK widens it to the repo, then to all", async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: "shop's api starts with npm run dev:api" }]);
    const S2 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'add a coupon field' }]);
    const S3 = await startSession(w, 'blog', [{ id: 'm1', from: 'you', text: 'write the release notes' }]);
    const line = 'shop api: npm run dev:api';
    const change = { target: 'slice:shop-api', diff: `+ ${line}`, evidence: [{ at: said(S1, 'm1'), quote: 'api starts with npm run dev:api' }] };
    const c1 = await apply(w, { ...change, scope: `session:${S1}` }, LOCAL_FIRST);
    await expectState(w, c1, 'applied', 'the local-first rule applies a change to its own session');
    const h1 = await handleOf(w, c1);
    expect(await sliceText(w, S1), 'the session it came from reads it').toContain(line);
    expect(await sliceText(w, S2), "the repo's other session doesn't, yet").not.toContain(line);
    expect(await sliceText(w, S3), "another repo's session doesn't").not.toContain(line);

    // The rule can't take it to all repos on its own. Wrong program: a core that honours any event's scope.
    const w0 = await widen(w, { ...change, scope: 'all', supersedes: h1 }, LOCAL_FIRST);
    await expectState(w, w0, 'refused', 'a widening to all repos with neither your OK nor a rule you approved');
    expect(await sliceText(w, S3), 'the refused widening reaches no other repo').not.toContain(line);
    expect(await sliceText(w, S2)).not.toContain(line);

    // An agent proposes; it can't apply or widen. Its proposal reaches no slice.
    const p = await propose(w, S2, 'shop', { target: 'slice:shop-web', diff: '+ shop web: npm run dev:web', evidence: [{ at: said(S2, 'm1'), quote: 'coupon' }], scope: `session:${S2}` });
    await expectState(w, p, 'proposed', "an agent's proposal");
    expect(await sliceText(w, S2)).not.toContain('shop web: npm run dev:web');
    let caught: unknown;
    try { await w.record.append(agentIn(S2, 'shop'), learnEvent('learn.widened', w.clock.tick(1000), { ...change, scope: 'repo:shop', supersedes: h1 }, LOCAL_FIRST)); } catch (e) { caught = e; }
    expect(caught, 'an agent widening a change is refused').toBeInstanceOf(RecordError);

    // With your OK it widens through the repo: the repo's sessions read it, another repo's still don't.
    const w1 = await widen(w, { ...change, scope: 'repo:shop', supersedes: h1 }, 'you');
    await expectState(w, w1, 'applied', 'your widening to the repo');
    expect(await sliceText(w, S2), 'the repo reads it once you widened it').toContain(line);
    expect(await sliceText(w, S3), 'another repo still does not').not.toContain(line);
    // Then to all, with your OK.
    const w2 = await widen(w, { ...change, scope: 'all', supersedes: h1 }, 'you');
    await expectState(w, w2, 'applied', 'your widening to all repos');
    expect(await sliceText(w, S3), 'another repo reads it once you widened it to all').toContain(line);
    await w.record.close();
  });

  it('AC3 a rule you typed reaches every open session, in every repo, at its next prompt, and every session started after', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'from now on: never push without asking' }]);
    const S2 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'add a coupon field' }]);
    const S3 = await startSession(w, 'blog', [{ id: 'm1', from: 'you', text: 'write the release notes' }]);
    for (const s of [S1, S2, S3]) expect(await sliceText(w, s)).not.toContain('never push without asking');
    const rule = await apply(w, { layer: 'base', target: 'rule:nopush', diff: '+ never push without asking', evidence: [{ at: said(S1, 'm1'), quote: 'never push without asking' }], scope: 'all' }, 'you');
    await expectState(w, rule, 'applied', 'the rule you typed');
    // Wrong program: a slice fixed when its session started, which the rule reaches only in new sessions.
    for (const s of [S1, S2, S3]) expect(await sliceText(w, s), `open session ${s} reads your rule at its next prompt`).toContain('never push without asking');
    const S4 = await startSession(w, 'docs', [{ id: 'm1', from: 'you', text: 'fix the typo' }]);
    expect(await sliceText(w, S4), 'a session started after reads it at its start').toContain('never push without asking');
    await w.record.close();
  });
});

describe('AC6 claims learned at install start at the scope their evidence covers', () => {
  it("AC6 a claim from one repo's sessions applies only to that repo; a habit seen across repos applies everywhere", async () => {
    const w = await openWorld();
    const A1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'the shop api listens on 4100' }, { id: 'm2', from: 'you', text: 'shop web is on 4200' }, { id: 'm3', from: 'you', text: 'write small commits please' }]);
    const A2 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'is the api still on 4100?' }]);
    const B1 = await startSession(w, 'blog', [{ id: 'm1', from: 'you', text: 'deploy the blog' }, { id: 'm2', from: 'you', text: 'again: write small commits please' }]);
    const D1 = await startSession(w, 'docs', [{ id: 'm1', from: 'you', text: 'fix the typo' }]);

    // A fact seen in one repo's sessions: that repo.
    const fact = await apply(w, { target: 'slice:shop-port', diff: '+ shop api listens on 4100', evidence: [{ at: said(A1, 'm1'), quote: 'listens on 4100' }, { at: said(A2, 'm1'), quote: 'on 4100' }], scope: 'repo:shop' }, INSTALL);
    await expectState(w, fact, 'applied', 'an install claim at the repo its evidence covers');
    const later = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'start the api' }]);
    for (const s of [A1, A2, later]) expect(await sliceText(w, s), `shop session ${s} reads the shop fact`).toContain('shop api listens on 4100');
    for (const s of [B1, D1]) expect(await sliceText(w, s), `session ${s} of another repo doesn't`).not.toContain('shop api listens on 4100');

    // A claim from one repo's sessions that claims every repo still reaches no other repo (refused or narrowed).
    // Wrong program: a core that takes an install claim's scope as written.
    await apply(w, { target: 'slice:shop-web', diff: '+ shop web listens on 4200', evidence: [{ at: said(A1, 'm2'), quote: 'shop web is on 4200' }], scope: 'all' }, INSTALL);
    for (const s of [B1, D1]) expect(await sliceText(w, s), `session ${s} of another repo doesn't read a one-repo fact`).not.toContain('shop web listens on 4200');

    // A habit seen across repos: everywhere, a repo with no evidence of its own included. Wrong program: a core
    // that starts every install claim at a session, or at one repo.
    const habit = await apply(w, { target: 'slice:commits', diff: '+ you like small commits', evidence: [{ at: said(A1, 'm3'), quote: 'write small commits' }, { at: said(B1, 'm2'), quote: 'write small commits' }], scope: 'all' }, INSTALL);
    await expectState(w, habit, 'applied', 'an install habit seen across repos');
    for (const s of [A1, B1, D1]) expect(await sliceText(w, s), `session ${s} reads the habit`).toContain('you like small commits');
    await w.record.close();
  });
});
