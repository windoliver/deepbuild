// AC5 #553.7ab062d9: In a two-player co-op piece with `ends`, a late shield entry that undoes a predicted death leaves
// the slot's earlier save in place and the record ends healthy; a planted module that saves on predicted steps fails,
// naming the slot and the step; and a trap only a predicted step reached leaves both copies playing with equal hashes
//
// The co-op piece (README: The co-op piece) over 900 match steps on the test relay, each copy keeping its saves in a
// folder of its own (`match`'s `saves_dir`, this job's). Step 119 asks for slot 1's save (the save at step 120). An
// unshielded hero dies at step 300, writing slot 1 into `ends`; an unshielded hero meets the trap at step 700, and the
// program traps. Player 2 shields at steps 295 and 695, and each shield reaches copy 1 only once it has run the step the
// shield guards (#551's `relay.deliver`): copy 1 runs step 300 on a prediction, where the hero dies, and step 700, where
// it traps; each late shield rolls it back. The judge holds both copies to the criterion: each wrote exactly one save,
// slot 1's at step 120, not ended, and its folder keeps exactly that save, whole; each ran the match to its end, and its
// record ends healthy (no fault, no desync, no timeout); copy 1 rolled back over steps 300 and 700; their full-state
// hashes agree at every confirmed step. The planted module saves on predicted steps: the judge fails, naming slot 1 and
// the step of the ended save the predicted death wrote. Wrong programs it fails: the merge base (no saves in a match);
// a save, an ended slot or its deletion of the earlier save made from an unconfirmed step; a trap in an unconfirmed
// step that ends the match.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COOP, COOP_STEPS, DEATH_STEP, SAVE_SLOT, SAVE_STEP, SHIELDS, TRAP_STEP, coopDoc, coopPlays, coopProgram, lateShields, type Planted } from './fixtures.ts';
import { AC, FULL, TIMEOUT, keptSaves, none, play, sameHashes, savesOf, show, useBuilds, useChildren, useTemp, type Copy551 } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const program = coopProgram();

/** The criterion, held to both copies of one run, each with its saves folder. */
function judge(copies: readonly Copy551[], dir: string, what: string): string[] {
  const f: string[] = [];
  for (const c of copies) {
    const saves = savesOf(c, what);
    const earlier = saves.filter((s) => s.item === COOP && s.slot === SAVE_SLOT && s.step === SAVE_STEP && !s.ended);
    if (earlier.length !== 1) f.push(`${what}: copy ${c.player} wrote ${earlier.length} saves of slot ${SAVE_SLOT} at step ${SAVE_STEP}, not one: ${show(saves)}`);
    for (const s of saves.filter((x) => !earlier.includes(x))) f.push(`${what}: copy ${c.player} wrote slot ${s.slot}'s ${s.ended ? 'ended ' : ''}save at step ${s.step}, which no confirmed step asked for`);
    const kept = keptSaves(join(dir, String(c.player)), what);
    const header = kept[0]?.header;
    if (kept.length !== 1 || kept[0]!.hash !== earlier[0]?.hash || header?.['slot'] !== SAVE_SLOT || header?.['step'] !== SAVE_STEP || header?.['ended'] === true) {
      f.push(`${what}: copy ${c.player}'s saves folder keeps ${show(kept.map((k) => ({ hash: k.hash.slice(0, 12), slot: k.header['slot'], step: k.header['step'], ended: k.header['ended'] ?? false })))}, not slot ${SAVE_SLOT}'s save at step ${SAVE_STEP} alone`);
    }
    const ended = [c.end, c.record?.end ?? null].filter((e) => e !== null && e !== 'left');
    if (ended.length || c.raw['fault'] || c.raw['desync']) f.push(`${what}: copy ${c.player}'s record doesn't end healthy: end ${show(c.end)}, record.end ${show(c.record?.end ?? null)}, fault ${show(c.raw['fault'] ?? null)}, desync ${show(c.raw['desync'] ?? null)}`);
    if (c.ran < COOP_STEPS) f.push(`${what}: copy ${c.player} ran ${c.ran} of ${COOP_STEPS} match steps`);
  }
  const one = copies.find((c) => c.player === 1)!;
  for (const [shield, guarded] of [[SHIELDS[0], DEATH_STEP], [SHIELDS[1], TRAP_STEP]] as const) {
    if (!(one.rolledBack ?? []).some((r) => r.to === shield && r.from >= guarded)) f.push(`${what}: copy 1 never rolled back to the shield at step ${shield} after running step ${guarded} on a prediction: ${show(one.rolledBack)}`);
  }
  f.push(...sameHashes(copies[0]!, copies[1]!, `${what}: copy 1 and copy 2`, COOP_STEPS - 40));
  return f;
}
async function run(what: string, planted?: Planted): Promise<{ copies: Copy551[]; dir: string }> {
  const dir = temp();
  const { copies } = await play(builds.show(), temp(), what, {
    document: coopDoc(program), steps: COOP_STEPS, plays: coopPlays(), assets: [program], relay: { seed: 553, deliver: lateShields() }, savesDir: dir,
    ...(planted ? { planted } : {}),
  });
  return { copies, dir };
}

describe(`${AC[5]} saves, ends and a trap held to confirmed steps in a co-op match`, () => {
  it(`${AC[5]} a late shield that undoes a predicted death leaves the slot's earlier save in place and the record ends healthy, and a trap only a predicted step reached leaves both copies playing with equal hashes`, async () => {
    const { copies, dir } = await run('AC5 the co-op piece');
    none(judge(copies, dir, 'AC5'), 'the co-op match with two late shields');
  }, TIMEOUT);

  it(`${AC[5]} a planted module that saves on predicted steps fails, naming the slot and the step`, async () => {
    const { copies, dir } = await run('AC5 the co-op piece, planted', 'net_saves_predicted');
    const f = judge(copies, dir, 'AC5 planted');
    const named = f.filter((x) => new RegExp(`slot ${SAVE_SLOT}'s ended save at step (\\d+)`).test(x)).map((x) => Number(/at step (\d+)/.exec(x)![1]));
    expect(named.filter((k) => k > SHIELDS[0] && k <= DEATH_STEP + 1), `the judge fails the planted module, naming slot ${SAVE_SLOT} and the step of the ended save its predicted death wrote: ${show(f, 1500)}`).not.toEqual([]);
  }, TIMEOUT);
});
