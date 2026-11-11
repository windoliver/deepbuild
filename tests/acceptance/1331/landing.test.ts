// AC1 and AC8: the queue lands in turn, each change on a head its verdict covers; a landing whose tree equals its
// verdict's tree starts no check run and raises no ask.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, must, mustFail, requirement, World } from './helpers.ts';

const own = (n: number) => requirement('R1', `x${n} works`, checkFile(`own${n}`));
const MIN = 60_000;

/** Three changes, each its own issue and file; judged in the order 3, 1, 2; then #1's branch gets a new commit the gate has not judged. */
async function threeChanges(plant?: string): Promise<{ w: World; prs: number[]; ms: number; round: Awaited<ReturnType<World['land']>> }> {
  const w = await World.open({ drafts: [draftFor(100, [own(3)]), draftFor(101, [own(1)]), draftFor(102, [own(2)])], ...(plant ? { plant } : {}) });
  const c3 = await w.change('s3', { 'src/x3.ts': "export const v = 'three';\n" });
  await w.judge();
  const c1 = await w.change('s1', { 'src/x1.ts': "export const v = 'one';\n" });
  await w.judge();
  const c2 = await w.change('s2', { 'src/x2.ts': "export const v = 'two';\n" });
  await w.judge();
  // A commit pushed to #1's branch after its verdict: the verdict does not cover it, so it is judged before it lands.
  await w.branch('s1', { 'src/x1.ts': "export const v = 'one-again';\n" });
  const round = await w.land();
  return { w, prs: [c3.pr, c1.pr, c2.pr], ms: round.ms, round };
}

/** The judgement of the first criterion: three landings, in PASS order, one at a time, each a commit whose tree a verdict covers. */
async function judgeThree(w: World, prs: number[]): Promise<void> {
  const landed = await w.landings();
  must(landed.length === 3, `three changes with a PASS must land; main holds ${landed.length} landings after the first-parent line from the base`);
  const trees = await w.verdictTrees();
  for (const sha of landed) {
    must(trees.has(await w.treeOf(sha)), `the landed commit ${sha} was not judged by the gate: no commit with a success deepbuild/verdict status has its tree`);
    const verdict = w.forge.statusesOf(trees.get(await w.treeOf(sha))!).find((s) => s.state === 'success')!;
    const merge = w.forge.merges.find((m) => m.sha === sha)!;
    must(verdict.at <= merge.began, `the landed commit ${sha} was merged before the verdict that covers its tree was posted`);
  }
  const order = w.forge.merges.map((m) => m.pr);
  must(JSON.stringify(order) === JSON.stringify(prs), `changes must land in the order their PASSes came (${prs.join(', ')}); they landed as ${order.join(', ')}`);
  must(w.forge.maxInFlight === 1, `the hub lands one change at a time: ${w.forge.maxInFlight} merges were in flight at once`);
}

describe(`${AC[1]} three changes with a PASS land one at a time, each on a head its verdict covers`, () => {
  it('lands three changes in turn; a landing of a commit the gate did not judge fails, naming the commit', async () => {
    const good = await threeChanges();
    expect(good.round.code, `deep land exited ${good.round.code}: ${good.round.stderr.slice(0, 600)}`).toBe(0);
    await judgeThree(good.w, good.prs);
    expect(good.ms, 'the round took too long').toBeLessThan(10 * MIN);

    const planted = await threeChanges('lands-unjudged-commit');
    const trees = await planted.w.verdictTrees();
    const unjudged: string[] = [];
    for (const sha of await planted.w.landings()) if (!trees.has(await planted.w.treeOf(sha))) unjudged.push(sha);
    must(unjudged.length > 0, 'the planted lander landed no commit the gate did not judge, so the scenario proves nothing (its extra commit on #1\'s branch must reach main unjudged)');
    await mustFail('a lander that merges the branch head it never judged', () => judgeThree(planted.w, planted.prs), [unjudged[0]!]);
  }, 30 * MIN);
});

describe(`${AC[8]} a landing whose tree equals its verdict's tree starts no check run and raises no ask`, () => {
  it('lands one change with no run and no ask after the landing', async () => {
    const w = await World.open({ drafts: [draftFor(100, [own(1)])] });
    await w.change('only', { 'src/x1.ts': "export const v = 'only';\n" });
    await w.judge();
    const runs = (await w.runs()).length;
    const asks = (await w.asks()).length;
    expect(runs, '`deep land judge` must judge the change on its merge with the head: it started no check run').toBeGreaterThan(0);
    const round = await w.land();
    expect(round.code, `deep land exited ${round.code}: ${round.stderr.slice(0, 600)}`).toBe(0);
    const landed = await w.landings();
    expect(landed.length, 'the one change with a PASS must land').toBe(1);
    expect((await w.verdictTrees()).has(await w.treeOf(landed[0]!)), `the landed commit ${landed[0]} must have the tree its verdict covered`).toBe(true);
    const after = await w.runs();
    expect(after.length, `a landing whose tree equals its verdict's tree starts no check run; these started after it: ${after.slice(runs).map((r) => `${r.check} on ${r.commit}`).join(', ')}`).toBe(runs);
    expect((await w.asks()).length, 'a landing whose tree equals its verdict\'s tree raises no ask').toBe(asks);
    expect(round.json?.stopped ?? null, 'the read-back finds no difference, so landings are not stopped').toBeNull();
  }, 15 * MIN);
});
