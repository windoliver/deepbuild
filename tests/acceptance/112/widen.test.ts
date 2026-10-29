// The learned layer widens a change from its session to the repo only by the comparison rule, read from the replay
// its widening cites; a cohort that can't decide leaves the standing rules as they are (README: The learned layer's
// widening). Every world is a real record over a real evidence store.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC5, AC8, GRADE, handleOf, ids, layerRow, learn, LOCAL_FIRST, makePlan, openWorld, putReplay, removeRoots, rule, runsOf, said, sliceText,
  startSession, steady, TOKENS, type ReplayResult, type TaskSpec, type World,
} from './helpers.ts';

afterAll(removeRoots);

/** A replay's result over 20 tasks with the given gains in grade (and tokens per task when given), under its frozen plan. */
function replay(gains: number[], tokens?: (i: number) => number, id = 'trial-0417'): ReplayResult {
  const { planHash } = rule();
  const tasks = ids('t', gains.length);
  const measures = tokens ? [GRADE, TOKENS] : [GRADE];
  const plan = makePlan({ id, tasks, measures });
  const specs: TaskSpec[] = tasks.map((t, i) => ({ ...steady(t, 0.5, gains[i]!), ...(tokens ? { tokens: { base: [1000, 1000, 1000], change: Array(3).fill(tokens(i)) } } : {}) }));
  return { plan, runs: runsOf(planHash(plan), specs, measures) };
}
/** 12 tasks gain 0.3, 8 lose 0.3: a higher mean gain (0.06) whose bound is below 0. */
const NOISY = Array.from({ length: 20 }, (_, i) => (i < 12 ? 0.3 : -0.3));
/** 17 tasks gain 0.3, 3 lose 0.1: a bound well above 0. */
const CLEAR = Array.from({ length: 20 }, (_, i) => (i < 17 ? 0.3 : -0.1));

interface Learned { world: World; first: string; change: string; handle: string; target: string; line: string; repo: string }
/** A change the local-first rule applied to the session it came from, in `repo`, from your own words there. */
async function learnedInSession(w: World, repo: string, target: string, line: string): Promise<Learned> {
  const first = await startSession(w, repo, [{ id: 'm1', text: `${line} That's how it works here.` }]);
  const change = await learn(w, 'learn.applied', { target, diff: `+ ${line}`, evidence: [{ at: said(first, 'm1'), quote: line }], scope: `session:${first}` }, LOCAL_FIRST);
  expect((await layerRow(w, change)).state, `${target} applies to the session it came from`).toBe('applied');
  return { world: w, first, change, handle: await handleOf(w, change), target, line, repo };
}
/** Later sessions in the repo where it helped again: your words saying so. Returns their quotes. */
async function helpedAgain(w: World, repo: string, n: number) {
  const quotes = [];
  for (let i = 0; i < n; i++) {
    const s = await startSession(w, repo, [{ id: 'm1', text: `The tip helped again, the e2e run passed first time (${i + 1}).` }]);
    quotes.push({ at: said(s, 'm1'), quote: 'The tip helped again' });
  }
  return quotes;
}
/** The local-first rule's widening of a change to its repo, citing what it gives. */
const widen = (l: Learned, evidence: { at: string; quote: string }[]) =>
  learn(l.world, 'learn.widened', { target: l.target, diff: `+ ${l.line}`, evidence, scope: `repo:${l.repo}`, replay: { tasks: 20, regressions: 0 }, supersedes: l.handle }, LOCAL_FIRST);
const reads = async (w: World, session: string, line: string) => (await sliceText(w, session)).includes(line);

describe(`AC8 ${AC8} a learned change widens from its session to the repo only by the comparison rule`, () => {
  it(`AC8 ${AC8} after three sessions where it helped again, 20 replayed tasks with a higher mean gain whose bound is below 0 keep it at its session, INCONCLUSIVE; a decisive replay widens it`, async () => {
    const w = await openWorld();
    const seed = await learnedInSession(w, 'shop', 'slice:seed-first', 'Run npm run seed before the e2e tests.');
    const again = await helpedAgain(w, 'shop', 3);

    // Helped again in three sessions, with no replay to decide: it doesn't widen.
    const bare = await widen(seed, again);
    const s2 = await startSession(w, 'shop', [{ id: 'm1', text: 'Start on the checkout page.' }]);
    expect(await reads(w, s2, seed.line), 'a widening citing only sessions where it helped again: a later shop session does not read it').toBe(false);
    expect((await layerRow(w, bare)).state, 'that widening is not in force').not.toBe('applied');

    // A replay of 20 tasks: mean gain 0.06, bound below 0.
    const noisy = await putReplay(w, replay(NOISY));
    const inconclusive = await widen(seed, [...again, { at: noisy, quote: 'trial-0417' }]);
    const row = await layerRow(w, inconclusive);
    expect(row.state, `the widening on an INCONCLUSIVE replay is not in force (reason: ${String(row.reason)})`).not.toBe('applied');
    expect(String(row.reason), 'its reason reads INCONCLUSIVE').toMatch(/INCONCLUSIVE/);
    const s3 = await startSession(w, 'shop', [{ id: 'm1', text: 'Fix the cart badge.' }]);
    expect(await reads(w, s3, seed.line), 'a later shop session does not read it').toBe(false);
    expect(await reads(w, seed.first, seed.line), 'the session it came from still reads it').toBe(true);

    // Decided on grade, not on tokens: every declared measure must beat the base.
    const docs = await learnedInSession(w, 'docs', 'slice:docs-build', 'Build the docs with make html.');
    const half = await putReplay(w, replay(CLEAR, (i) => (i < 12 ? 900 : 1100), 'trial-0418'));
    const partly = await widen(docs, [...(await helpedAgain(w, 'docs', 3)), { at: half, quote: 'trial-0418' }]);
    const d2 = await startSession(w, 'docs', [{ id: 'm1', text: 'Fix the index page.' }]);
    expect(await reads(w, d2, docs.line), 'a replay decisive on grade and not on tokens: a later docs session does not read it').toBe(false);
    expect(String((await layerRow(w, partly)).reason), 'its reason reads INCONCLUSIVE').toMatch(/INCONCLUSIVE/);

    // A decisive replay widens it, with no session where it helped again at all.
    const blog = await learnedInSession(w, 'blog', 'slice:blog-drafts', 'Keep drafts under content/drafts.');
    const clear = await putReplay(w, replay(CLEAR, undefined, 'trial-0419'));
    const widened = await widen(blog, [{ at: clear, quote: 'trial-0419' }]);
    expect((await layerRow(w, widened)).state, `a widening on a decisive replay is in force (reason: ${String((await layerRow(w, widened)).reason)})`).toBe('applied');
    const b2 = await startSession(w, 'blog', [{ id: 'm1', text: 'Publish the October post.' }]);
    expect(await reads(w, b2, blog.line), 'a later blog session reads it').toBe(true);
    const s4 = await startSession(w, 'shop', [{ id: 'm1', text: 'Fix the footer.' }]);
    expect(await reads(w, s4, blog.line), 'a shop session does not: it widened to its own repo').toBe(false);

    // The judgments are in the log: a rebuild reads the same.
    await w.record.rebuild();
    expect(await reads(w, s3, seed.line), 'after a rebuild, the shop session still does not read the INCONCLUSIVE widening').toBe(false);
    expect(await reads(w, b2, blog.line), 'after a rebuild, the blog session still reads the decisive one').toBe(true);
    await w.record.close();
  }, 120_000);
});

describe(`AC5 ${AC5} a complete cohort too small to decide leaves the standing rules as they are`, () => {
  it(`AC5 ${AC5} three complete replayed tasks, INCONCLUSIVE, neither widen a change in its session nor revoke one in force for the repo`, async () => {
    const w = await openWorld();
    const seed = await learnedInSession(w, 'shop', 'slice:seed-first', 'Run npm run seed before the e2e tests.');
    // A standing rule for the whole repo, which you applied.
    const s1 = await startSession(w, 'shop', [{ id: 'm1', text: 'Name branches after the issue. Always.' }]);
    const standing = await learn(w, 'learn.applied', { target: 'slice:branch-names', diff: '+ Name branches after the issue.', evidence: [{ at: said(s1, 'm1'), quote: 'Name branches after the issue.' }], scope: 'repo:shop' }, 'you');
    expect((await layerRow(w, standing)).state, 'the repo rule you applied is in force').toBe('applied');
    const later = await startSession(w, 'shop', [{ id: 'm1', text: 'Fix the cart badge.' }]);
    const before = { first: await sliceText(w, seed.first), later: await sliceText(w, later) };
    expect(before.later.includes('Name branches after the issue.'), 'a later shop session reads the repo rule').toBe(true);

    const { planHash } = rule();
    const plan = makePlan({ id: 'trial-0420', tasks: ['t01', 't02', 't03'] });
    const small = await putReplay(w, { plan, runs: runsOf(planHash(plan), [steady('t01', 0.5, 0.3), steady('t02', 0.5, 0.1), steady('t03', 0.5, -0.05)]) });
    await widen(seed, [{ at: small, quote: 'trial-0420' }]);
    // The core's attempt to revoke the repo rule on the same cohort.
    await learn(w, 'learn.rolled_back', { target: 'slice:branch-names', diff: '+ Name branches after the issue.', evidence: [{ at: small, quote: 'trial-0420' }], scope: 'repo:shop', supersedes: await handleOf(w, standing) }, LOCAL_FIRST);

    const row = await layerRow(w, standing);
    expect(row.state, 'the repo rule is still in force').toBe('applied');
    expect(row.scope, 'at its own scope').toBe('repo:shop');
    expect((await layerRow(w, seed.change)).state, 'the session change is still in force').toBe('applied');
    expect(await sliceText(w, seed.first), 'the session it came from reads what it read').toBe(before.first);
    expect(await sliceText(w, later), 'the later shop session reads what it read').toBe(before.later);
    const fresh = await startSession(w, 'shop', [{ id: 'm1', text: 'Fix the footer.' }]);
    const text = await sliceText(w, fresh);
    expect(text.includes('Name branches after the issue.'), 'a new shop session reads the repo rule').toBe(true);
    expect(text.includes(seed.line), 'and not the session change').toBe(false);
    await w.record.close();
  }, 120_000);
});
