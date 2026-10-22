// #62 Proof, blind redraft: a week of recorded sessions in two repos replayed, with the learned changes listed
// with their evidence and scopes, one rollback, and a rollback to a date (README: Readings; design: The learned layer).
import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';
import {
  allEvents, apply, canon, DAY, expectRefused, expectState, firstRowDifference, handleOf, HOUR, layerRow,
  LOCAL_FIRST, openWorld, propose, removeRoots, said, sliceText, startSession, T0, widen, youApp,
} from './helpers.ts';
import type { Change, Msg, World } from './helpers.ts';

afterEach(removeRoots);

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** Midnight UTC starting the week (Monday) and the day `n` days after it. */
const MONDAY = T0 - 9 * HOUR;
const day = (n: number, hour: number): number => MONDAY + n * DAY + hour * HOUR;
const you = (id: string, text: string): Msg => ({ id, from: 'you', text });
const agent = (id: string, text: string): Msg => ({ id, from: 'agent', text });

async function session(w: World, at: number, repo: string, messages: Msg[]): Promise<string> {
  w.clock.set(at);
  return startSession(w, repo, messages);
}
/** The log as it stands, each event canonical, to compare a later log's prefix against. */
async function logOf(w: World): Promise<string[]> {
  return (await allEvents(w.record)).map((e) => canon(e));
}
async function slices(w: World, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids) out.set(id, await sliceText(w, id));
  return out;
}

describe('Proof: a week of recorded sessions replayed', () => {
  it('Proof (redraft) a week in shop and blog: every learned change listed with its evidence and scope; one rollback flags its dependants; a rollback to a date compensates newest first, deletes nothing and restores the start slices', async () => {
    const w = await openWorld(MONDAY);
    /** Every learn.* event this test appended, with what it sent. */
    const sent = new Map<string, Change & { kind: string }>();
    const rec = (id: string, kind: string, change: Change): string => { sent.set(id, { ...change, kind }); return id; };

    // ---- Monday: a shop session teaches how the shop's tests run; the local-first rule applies it to that session.
    const S1 = await session(w, day(0, 9), 'shop', [you('m1', 'Run the shop tests with npm run test:shop before you commit.'), agent('m2', 'Will do.')]);
    const S2 = await session(w, day(0, 14), 'blog', [you('m1', 'Fix the typo in the about page.'), agent('m2', 'Fixed.')]);
    const cA: Change = { target: 'slice:shop-tests', diff: '+ shop tests run with npm run test:shop', evidence: [{ at: said(S1, 'm1'), quote: 'npm run test:shop' }], scope: `session:${S1}` };
    const A = rec(await apply(w, cA, LOCAL_FIRST), 'learn.applied', cA);
    await expectState(w, A, 'applied', 'the local-first rule applies a change to its own session');
    expect(await sliceText(w, S1), 'the session it came from reads it').toContain('npm run test:shop');
    expect(await sliceText(w, S2), 'a blog session does not').not.toContain('npm run test:shop');

    // ---- Tuesday: you widen it to the shop repo; a blog session teaches how the blog builds, which you apply to the blog.
    const S3 = await session(w, day(1, 9), 'shop', [you('m1', 'Yes, in every shop session use npm run test:shop.'), agent('m2', 'Noted.')]);
    const hA = await handleOf(w, A);
    const cW: Change = { target: 'slice:shop-tests', diff: '+ shop tests run with npm run test:shop', evidence: [{ at: said(S3, 'm1'), quote: 'in every shop session use npm run test:shop' }], scope: 'repo:shop', supersedes: hA };
    const W = rec(await widen(w, cW, 'you'), 'learn.widened', cW);
    await expectState(w, W, 'applied', 'your OK widens the change to its repo');
    const S4 = await session(w, day(1, 14), 'blog', [you('m1', 'The blog builds with hugo --minify, always.'), agent('m2', 'Understood.')]);
    const cB: Change = { target: 'slice:blog-build', diff: '+ blog builds with hugo --minify', evidence: [{ at: said(S4, 'm1'), quote: 'The blog builds with hugo --minify' }], scope: 'repo:blog' };
    const B = rec(await apply(w, cB, 'you'), 'learn.applied', cB);
    await expectState(w, B, 'applied', 'you apply a change to a repo');
    const hB = await handleOf(w, B);
    expect(await sliceText(w, S3), 'another shop session reads the widened change').toContain('npm run test:shop');
    expect(await sliceText(w, S2), 'an open blog session reads the blog change').toContain('hugo --minify');
    expect(await sliceText(w, S2), 'and still not the shop change').not.toContain('npm run test:shop');

    // ---- Wednesday: you type a rule (a change to the base); an agent proposes rewording the blog change (it supersedes B).
    const S5 = await session(w, day(2, 9), 'shop', [you('m1', 'Never push to main; open a PR instead.'), agent('m2', 'OK.')]);
    const cRule: Change = { layer: 'base', target: 'rule:nopush', diff: '+ never push to main', evidence: [{ at: said(S5, 'm1'), quote: 'Never push to main' }], scope: 'all' };
    const RULE = rec(await apply(w, cRule, 'you'), 'learn.applied', cRule);
    await expectState(w, RULE, 'applied', 'your typed rule is a base change you apply');
    const S6 = await session(w, day(2, 14), 'blog', [you('m1', 'The build is slow.'), agent('m2', 'I think the build also needs --gc to clean the cache.')]);
    const cP: Change = { target: 'slice:blog-build', diff: '- blog builds with hugo --minify\n+ blog builds with hugo --minify --gc', evidence: [{ at: said(S6, 'm2'), quote: 'the build also needs --gc' }], scope: `session:${S6}`, supersedes: hB };
    const P = rec(await propose(w, S6, 'blog', cP), 'learn.proposed', cP);
    await expectState(w, P, 'proposed', 'an agent proposes and never applies');
    for (const s of [S1, S2, S3, S4, S5, S6]) expect(await sliceText(w, s), `session ${s} reads your rule`).toContain('never push to main');
    expect(await sliceText(w, S6), 'a proposal changes no slice').not.toContain('--gc');

    // ---- Thursday: a blog session learns how to preview, citing the blog change; a shop session tries to drop a check (refused).
    const S7 = await session(w, day(3, 9), 'blog', [you('m1', 'How do I see drafts?'), agent('m2', 'Previewing drafts works with hugo server -D.')]);
    const cC: Change = { target: 'slice:blog-preview', diff: '+ preview the blog with hugo server -D', evidence: [{ at: said(S7, 'm2'), quote: 'Previewing drafts works with hugo server -D' }, { at: hB, quote: 'hugo --minify' }], scope: `session:${S7}` };
    const C = rec(await apply(w, cC, LOCAL_FIRST), 'learn.applied', cC);
    await expectState(w, C, 'applied', 'a change citing the blog change applies to its session');
    const S8 = await session(w, day(3, 14), 'shop', [you('m1', "Drop the shop.e2e check, it's slow."), agent('m2', 'That check is approved; I cannot change it.')]);
    const cX: Change = { target: 'check:shop.e2e', diff: '- shop.e2e', evidence: [{ at: said(S8, 'm1'), quote: 'Drop the shop.e2e check' }], scope: 'repo:shop' };
    const X = rec(await apply(w, cX, 'you'), 'learn.applied', cX);
    await expectRefused(w, X, 'check:shop.e2e', 'a learned change aimed at an approved check');

    // ---- Friday: two quiet sessions; you roll back the blog change. Its dependants (C cites it, P supersedes it) are flagged.
    const S9 = await session(w, day(4, 9), 'shop', [you('m1', 'Bump the version.'), agent('m2', 'Bumped.')]);
    const S10 = await session(w, day(4, 14), 'blog', [you('m1', 'Publish the post.'), agent('m2', 'Published.')]);
    expect(await sliceText(w, S10), 'before the rollback, a blog session reads the blog change').toContain('hugo --minify');
    w.clock.set(day(4, 17));
    const before1 = await logOf(w);
    const one = await w.record.rollBack(youApp, { change: B });
    expect(one, 'rolling back one change compensates it alone').toEqual([B]);
    const after1 = await allEvents(w.record);
    expect(after1.slice(0, before1.length).map((e) => canon(e)), 'the single rollback deletes or rewrites no event').toEqual(before1);
    const new1 = after1.slice(before1.length);
    expect(new1.map((e) => e.kind), 'it appends one learn.rolled_back').toEqual(['learn.rolled_back']);
    expect(new1[0]!.writer, 'from your app').toBe('app');
    const names = (e: Event, id: string, handle: string): boolean => { const t = JSON.stringify([e.subject ?? null, e.data]); return t.includes(id) || t.includes(handle); };
    expect(names(new1[0]!, B, hB), `the learn.rolled_back names the blog change (${B} or ${hB})`).toBe(true);
    await expectState(w, B, 'rolled_back', 'the rolled-back change');
    for (const [id, what] of [[C, 'the change citing it'], [P, 'the proposal superseding it']] as const) {
      const row = await layerRow(w, id);
      const flag = str(row.flagged);
      expect(flag.includes(B) || flag.includes(hB), `${what} (${id}) is flagged naming ${B} or ${hB}; flagged is "${flag}"`).toBe(true);
    }
    await expectState(w, C, 'applied', 'a dependant stays as it was, flagged');
    await expectState(w, P, 'proposed', 'a dependant proposal stays a proposal, flagged');
    for (const s of [S2, S4, S6, S10]) expect(await sliceText(w, s), `blog session ${s} no longer reads the rolled-back change`).not.toContain('hugo --minify');
    expect(await sliceText(w, S7), 'the flagged dependant still applies to its session').toContain('preview the blog with hugo server -D');

    // ---- The date: Saturday 00:00. What every session that exists then reads at its start.
    const D = day(5, 0);
    const existing = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10];
    w.clock.set(D - 1);
    const atDate = await slices(w, existing);

    // ---- Saturday: you reword the shop's tests for the repo; a blog session learns where images go; the rule tries to widen it to all (refused).
    const S11 = await session(w, day(5, 9), 'shop', [you('m1', 'Run the shop tests with --runInBand, they share a port.'), agent('m2', 'OK.')]);
    const cE: Change = { target: 'slice:shop-tests', diff: '- shop tests run with npm run test:shop\n+ shop tests run with npm run test:shop -- --runInBand', evidence: [{ at: said(S11, 'm1'), quote: 'Run the shop tests with --runInBand' }], scope: 'repo:shop' };
    const E = rec(await apply(w, cE, 'you'), 'learn.applied', cE);
    await expectState(w, E, 'applied', 'your rewording of the shop change');
    const hE = await handleOf(w, E);
    const S12 = await session(w, day(5, 14), 'blog', [you('m1', 'Put blog images in static/img.'), agent('m2', 'Moved them.')]);
    const cF: Change = { target: 'slice:images', diff: '+ images go in static/img', evidence: [{ at: said(S12, 'm1'), quote: 'Put blog images in static/img' }], scope: `session:${S12}` };
    const F = rec(await apply(w, cF, LOCAL_FIRST), 'learn.applied', cF);
    await expectState(w, F, 'applied', 'the local-first rule applies it to its session');
    const hF = await handleOf(w, F);
    const cY: Change = { ...cF, scope: 'all', supersedes: hF };
    const Y = rec(await widen(w, cY, LOCAL_FIRST), 'learn.widened', cY);
    await expectState(w, Y, 'refused', 'the local-first rule never widens to all your repos');

    // ---- Sunday: you widen the images change to all; an agent proposes on top of the reworded shop change.
    const S13 = await session(w, day(6, 9), 'shop', [you('m1', 'Images go in static/img in the shop too.'), agent('m2', 'CI is flaky on the shop tests.')]);
    const cG: Change = { target: 'slice:images', diff: '+ images go in static/img', evidence: [{ at: said(S13, 'm1'), quote: 'Images go in static/img in the shop too' }], scope: 'all', supersedes: hF };
    const G = rec(await widen(w, cG, 'you'), 'learn.widened', cG);
    await expectState(w, G, 'applied', 'your OK widens it to all your repos');
    const cQ: Change = { target: 'slice:shop-tests', diff: '+ shop tests on CI run with --runInBand', evidence: [{ at: said(S13, 'm2'), quote: 'CI is flaky on the shop tests' }, { at: hE, quote: '--runInBand' }], scope: `session:${S13}` };
    const Q = rec(await propose(w, S13, 'shop', cQ), 'learn.proposed', cQ);
    await expectState(w, Q, 'proposed', 'an agent proposal');
    const S14 = await session(w, day(6, 14), 'blog', [you('m1', 'Update the footer.'), agent('m2', 'Updated.')]);
    expect(await sliceText(w, S9), 'before the date rollback, a shop session reads the reworded change').toContain('--runInBand');
    expect(await sliceText(w, S10), 'and a blog session reads the widened images change').toContain('static/img');
    expect(await sliceText(w, S1), 'and so does a shop session').toContain('static/img');

    // ---- Sunday evening: roll back everything learned since the date.
    w.clock.set(day(6, 20));
    const before2 = await logOf(w);
    const since = await w.record.rollBack(youApp, { since: D });
    expect(since, 'the rollback to a date compensates the in-force learned changes since then, newest first (not the refused widening or the proposal)').toEqual([G, F, E]);
    const after2 = await allEvents(w.record);
    expect(after2.slice(0, before2.length).map((e) => canon(e)), 'the rollback to a date deletes or rewrites no event').toEqual(before2);
    const new2 = after2.slice(before2.length);
    expect(new2.map((e) => e.kind), 'one learn.rolled_back per compensated change').toEqual(['learn.rolled_back', 'learn.rolled_back', 'learn.rolled_back']);
    expect(new2.map((e) => e.writer), 'from your app').toEqual(['app', 'app', 'app']);
    const handles = new Map([[G, await handleOf(w, G)], [F, hF], [E, hE]]);
    [G, F, E].forEach((id, i) => expect(names(new2[i]!, id, handles.get(id)!), `learn.rolled_back #${i + 1} names ${id} (newest first)`).toBe(true));
    for (const id of [E, F, G]) await expectState(w, id, 'rolled_back', 'each change since the date');
    await expectState(w, Y, 'refused', 'the refused widening stays refused');
    const flagQ = str((await layerRow(w, Q)).flagged);
    expect(flagQ.includes(E) || flagQ.includes(hE), `the proposal citing the reworded change is flagged naming ${E} or ${hE}; flagged is "${flagQ}"`).toBe(true);

    // The start slices are what they were at the date: for every session that existed then, and for the later ones as their repo's quiet session read.
    const now = await slices(w, existing);
    for (const s of existing) expect(now.get(s), `session ${s} reads at its start what it read at the date`).toBe(atDate.get(s));
    for (const [s, like] of [[S11, S9], [S13, S9], [S12, S10], [S14, S10]] as const) {
      expect(await sliceText(w, s), `later session ${s} reads what its repo's sessions read at the date`).toBe(atDate.get(like));
    }

    // ---- "What did you learn this week?", read from learned_layer, a week later and again after replaying the log.
    w.clock.set(day(14, 9));
    const live = await w.record.table('learned_layer');
    await w.record.rebuild();
    const rebuilt = await w.record.table('learned_layer');
    expect(firstRowDifference(live, rebuilt), 'the week replays to the same learned layer, row by row').toBeUndefined();
    for (const [table, when] of [[live, 'live'], [rebuilt, 'replayed']] as const) {
      const week = table.rows.filter((r) => Number(r.created) >= MONDAY && Number(r.created) < MONDAY + 7 * DAY);
      const changes = week.filter((r) => str(r.kind) !== 'learn.rolled_back');
      expect(changes.map((r) => str(r.id)).sort(), `${when}: the week lists every learn.* change appended, and nothing else`).toEqual([...sent.keys()].sort());
      for (const [id, c] of sent) {
        const row = changes.find((r) => str(r.id) === id)!;
        expect(str(row.kind), `${when}: ${id} kind`).toBe(c.kind);
        expect(str(row.target), `${when}: ${id} target`).toBe(c.target);
        expect(str(row.scope), `${when}: ${id} scope, as recorded`).toBe(c.scope);
        expect(JSON.parse(str(row.evidence)), `${when}: ${id} evidence, handles and quotes as recorded`).toEqual(c.evidence);
      }
      const states = Object.fromEntries([...sent.keys()].map((id) => [id, str(changes.find((r) => str(r.id) === id)!.state)]));
      expect(states, `${when}: each change's state`).toEqual({
        [A]: 'applied', [W]: 'applied', [B]: 'rolled_back', [RULE]: 'applied', [P]: 'proposed', [C]: 'applied', [X]: 'refused',
        [E]: 'rolled_back', [F]: 'rolled_back', [Y]: 'refused', [G]: 'rolled_back', [Q]: 'proposed',
      });
      expect(week.filter((r) => str(r.kind) === 'learn.rolled_back'), `${when}: the week lists the four rollbacks as events`).toHaveLength(4);
    }
    const replayed = await slices(w, existing);
    for (const s of existing) expect(replayed.get(s), `after the replay, session ${s} still reads what it read at the date`).toBe(atDate.get(s));
  }, 60_000);
});
