// AC2: after another change lands, a change touching other files re-runs only the checks whose keys changed.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, must, mustFail, requirement, World } from './helpers.ts';

const MIN = 60_000;
/**
 * #1 changes src/c.ts and is proven by `cc`. #2 changes src/x2.ts and is proven by `own2` (reads src/x2.ts) and `c` (reads
 * src/c.ts, which #1's landing changes). Both are judged on today's head; #1 lands; #2 is judged again on its merge with the
 * new head. The record then holds: cc once, own2 once (carried the second time), c twice (its key changed).
 */
async function scenario(plant?: string): Promise<World> {
  const w = await World.open({
    drafts: [draftFor(100, [requirement('R1', 'c changes', checkFile('cc'))]), draftFor(101, [requirement('R1', 'x2 works', checkFile('own2')), requirement('R2', 'c holds', checkFile('c'))])],
    ...(plant ? { plant } : {}),
  });
  await w.change('moves-c', { 'src/c.ts': "export const v = 'moved';\n" });
  await w.judge();
  await w.change('other-files', { 'src/x2.ts': "export const v = 'two';\n" });
  await w.judge();
  const round = await w.land();
  expect(round.code, `deep land exited ${round.code}: ${round.stderr.slice(0, 600)}`).toBe(0);
  return w;
}
async function judge(w: World): Promise<void> {
  const landed = await w.landings();
  must(landed.length === 2, `both changes must land (the second on a head that moved); main holds ${landed.length} landings`);
  const counts = await w.runCounts();
  must(counts.own2 === 1, `check own2 ran ${counts.own2 ?? 0} times; its key is unchanged by the landing of src/c.ts, so its result from the earlier judgement must carry, and a lander that re-runs everything ran it again`);
  must(counts.c === 2, `check c ran ${counts.c ?? 0} times; src/c.ts changed under it, so it runs once on the new head and once before`);
  must(counts.cc === 1, `check cc ran ${counts.cc ?? 0} times; the change it proves was judged once, and its landing is not a new run`);
}

describe(`${AC[2]} after another change lands, a change touching other files re-runs only the checks whose keys changed`, () => {
  it('re-runs c, carries own2; a lander that re-runs everything fails, naming a carried check', async () => {
    await judge(await scenario());
    const planted = await scenario('lander-reruns-all');
    expect((await planted.runCounts()).c, 'the planted lander must have run c again as well').toBe(2);
    await mustFail('a lander that re-runs every check after the head moved', () => judge(planted), ['own2']);
  }, 30 * MIN);
});
