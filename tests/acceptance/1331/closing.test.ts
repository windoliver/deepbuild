// AC4: an issue stays open until its change lands.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, must, mustFail, requirement, World } from './helpers.ts';

async function scenario(plant?: string): Promise<{ w: World; held: { issue: number; pr: number }; fine: { issue: number; pr: number }; seen: { afterOpening: string; afterHold: string } }> {
  const w = await World.open({
    drafts: [draftFor(100, [requirement('R1', 'x1 works', checkFile('own1'))]), draftFor(101, [requirement('R1', 'x2 works', checkFile('own2'))])],
    ...(plant ? { plant } : {}),
  });
  // #100's change is broken (its check FAILs): it is held. #101's is fine.
  const held = await w.change('broken', { 'src/x1.ts': "export const v = 'BROKEN';\n" });
  const fine = await w.change('fine', { 'src/x2.ts': "export const v = 'two';\n" });
  await w.judge();
  const afterOpening = `${w.forge.issues.get(held.issue)!.state}/${w.forge.issues.get(fine.issue)!.state}`;
  await w.land();
  const afterHold = w.forge.issues.get(held.issue)!.state;
  return { w, held, fine, seen: { afterOpening, afterHold } };
}
function judge(s: Awaited<ReturnType<typeof scenario>>): void {
  const { w, held, fine, seen } = s;
  const open = (n: number) => w.forge.issues.get(n)!;
  must(seen.afterOpening === 'open/open', `issue #${held.issue} or #${fine.issue} closed when its pull request was opened and judged, before any landing (${seen.afterOpening})`);
  must(seen.afterHold === 'open' && open(held.issue).state === 'open', `issue #${held.issue} closed although its change did not land (its check fails and its PR #${held.pr} is held)`);
  const merge = w.forge.merges.find((m) => m.pr === fine.pr);
  must(merge !== undefined, `the fine change (PR #${fine.pr}, issue #${fine.issue}) did not land, so there is nothing to close`);
  const closed = open(fine.issue);
  must(closed.state === 'closed', `issue #${fine.issue} must close when its change lands, and it is ${closed.state}`);
  must(closed.closedAt !== null && closed.closedAt >= merge.began, `issue #${fine.issue} closed at ${closed.closedAt}, before its change landed at ${merge.began}`);
}

describe(`${AC[4]} an issue stays open until its change lands`, () => {
  it('keeps the issue open through opening and a hold, and closes it when the change lands; a closer on the PR\'s opening fails, naming the issue', async () => {
    judge(await scenario());
    const planted = await scenario('closes-on-open');
    const early = [planted.held.issue, planted.fine.issue].filter((n) => { const i = planted.w.forge.issues.get(n)!; return i.closedAt !== null && i.closedAt < (planted.w.forge.merges.find((m) => m.pr === (n === planted.fine.issue ? planted.fine.pr : -1))?.began ?? Infinity); });
    expect(early.length, 'the planted closer must close an issue before its change lands').toBeGreaterThan(0);
    await mustFail('a closer that acts on the PR\'s opening', () => judge(planted), [`#${planted.held.issue}`]);
  }, 30 * 60_000);
});
