// AC7: a planted forge reports a landing as merged but drops a file an earlier landing added; the read-back names the file
// within 60 s, and landings stop.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, must, mustFail, requirement, World } from './helpers.ts';

const ADDED = 'docs/added-by-first.txt';
const own = (n: number) => requirement('R1', `x${n} works`, checkFile(`own${n}`));

async function scenario(plant?: string): Promise<{ w: World; prs: number[]; round: Awaited<ReturnType<World['land']>>; again: Awaited<ReturnType<World['land']>>; heads: { afterRound: string; afterAgain: string } }> {
  // The planted forge drops ADDED from the commit of the second merge; every test still passes on main, as no check reads it.
  const w = await World.open({ drafts: [draftFor(100, [own(1)]), draftFor(101, [own(2)]), draftFor(102, [own(3)])], drop: { nth: 2, path: ADDED }, ...(plant ? { plant } : {}) });
  const a = await w.change('adds-a-file', { 'src/x1.ts': "export const v = 'one';\n", [ADDED]: 'added by the first landing\n' });
  await w.judge();
  const b = await w.change('second', { 'src/x2.ts': "export const v = 'two';\n" });
  await w.judge();
  const c = await w.change('third', { 'src/x3.ts': "export const v = 'three';\n" });
  await w.judge();
  const round = await w.land();
  const afterRound = await w.mainHead();
  const again = await w.land();
  return { w, prs: [a.pr, b.pr, c.pr], round, again, heads: { afterRound, afterAgain: await w.mainHead() } };
}
async function judge(s: Awaited<ReturnType<typeof scenario>>): Promise<void> {
  const { w, round } = s;
  const second = w.forge.merges[1];
  must(second !== undefined, 'the second change must land (the planted forge drops its file from that landing); main holds fewer than two landings');
  must(!(await w.filesOf(second.sha)).includes(ADDED), `the planted forge did not drop ${ADDED} from ${second.sha}`);
  const stopped = round.json?.stopped as { commit?: string; files?: string[] } | null | undefined;
  must(!!stopped && Array.isArray(stopped.files) && stopped.files.includes(ADDED), `the read-back of landing ${second.sha} must name the dropped file ${ADDED} and stop landings; the forge said merged, and the round reports stopped=${JSON.stringify(stopped)}`);
  must(round.ms <= 60_000, `the read-back of ${second.sha} named ${ADDED} only after ${round.ms} ms, past 60 s`);
  must(!w.forge.pulls.get(s.prs[2]!)!.merged, `landings must stop after ${second.sha}: PR #${s.prs[2]} landed behind a main that lost ${ADDED}`);
  must(s.heads.afterAgain === s.heads.afterRound, `landings must stay stopped: main moved from ${s.heads.afterRound} to ${s.heads.afterAgain} on the next round`);
  const watch = await w.watchStatus();
  must(watch.code === 1 && /landings paused/.test(watch.out), `the stop takes the path a red main takes: \`main-watch.mjs status\` must read \`landings paused\` (exit 1) after ${second.sha}; it printed exit ${watch.code}: ${watch.out.trim()}`);
}

describe(`${AC[7]} a planted forge reports a landing as merged but drops a file; the read-back names the file within 60 s and landings stop`, () => {
  it('stops landings naming the dropped file; a lander that trusts the forge\'s merged state fails, naming the commit', async () => {
    const s = await scenario();
    await judge(s);
    expect(s.round.code, `deep land exited ${s.round.code}`).toBe(0);
    const planted = await scenario('trusts-forge-merged');
    const dropped = planted.w.forge.merges[1]?.sha ?? '';
    expect(dropped, 'the planted lander must have landed the second change').not.toBe('');
    await mustFail('a lander that trusts the forge\'s merged state', () => judge(planted), [dropped]);
  }, 30 * 60_000);
});
