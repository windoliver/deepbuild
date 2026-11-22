// AC3 #553.265463c7: In that match, across 50 rollbacks that each replace a step whose shot spawned a voice, the audio
// thread renders each output sample once and in order, and both copies' full-state hashes agree at every confirmed step;
// a planted media module that restores its own checkpoint on a rollback renders samples again and fails, naming the
// first, and a planted full-state hash that covers media's state stops the match with net.desync and fails
//
// The duel over 1,600 match steps (README: The duel): 50 cycles, each player 2's entry 5 steps before player 1's shot,
// each reaching copy 1 only once it has run the shot's step, so copy 1 shoots on a prediction, its spawn starts the
// voice, and the late entry rolls it back over that step: 50 rollbacks. In every fourth cycle the entry ends the turn,
// so the corrected run drops the shot and its voice fades over 5 ms; in the others it makes the shot again and the
// voice plays on, one voice for it. The judge (`judge`, below) holds every copy to it: each ran the match to its end
// with no desync and no fault; their full-state hashes agree at every confirmed step; copy 1 rolled back to each
// cycle's entry from its shot or later; each copy's voices are one for each shot it ran, faded exactly where the shot
// was dropped; and each audio thread rendered every output sample once and in order, past the last voice's end. The
// planted media module restores its own checkpoint on a rollback: the judge fails, naming the first sample rendered
// again. The planted full-state hash covers media's state: both copies end with net.desync, and the judge fails.
// Wrong programs it fails: the merge base (no voices, no audio report, no planted names); a media module that renders a
// sample twice or skips one, restarts a voice made again or keeps a dropped one; a hash that covers media's state.
import { describe, expect, it } from 'vitest';
import { CYCLES, DUEL_STEPS, OUT_RATE, SHOT, duelDoc, duelPlays, duelProgram, endsTurn, lateTurns, sha256, shotStep, toneWav, turnStep, type Planted } from './fixtures.ts';
import { AC, FULL, TIMEOUT, audioOf, fadeSamples, none, onceInOrder, play, sameHashes, show, useBuilds, useChildren, useTemp, voicesOf, type Copy551 } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const program = duelProgram();
const tone = toneWav();
const cycles = Array.from({ length: CYCLES }, (_, n) => n);
const ask = {
  document: duelDoc(program, sha256(tone)), steps: DUEL_STEPS, plays: duelPlays(CYCLES), assets: [program, tone],
  relay: { seed: 553, deliver: lateTurns(cycles) },
};
/** The last voice's end: the last shot's time plus the 0.25 s tone, in output samples. */
const LAST_SAMPLE = ((shotStep(CYCLES - 1) + 15) * OUT_RATE) / 60;

/** The criterion, held to both copies of one run. */
function judge(copies: readonly Copy551[], what: string): string[] {
  const [one, two] = copies as [Copy551, Copy551];
  const f: string[] = [];
  for (const c of copies) {
    if (c.end === 'desync' || c.end === 'faulted' || c.raw['desync']) f.push(`${what}: copy ${c.player}'s match ended ${c.end}: net.desync ${show(c.raw['desync'] ?? null, 400)}`);
    if (c.ran < DUEL_STEPS) f.push(`${what}: copy ${c.player} ran ${c.ran} of ${DUEL_STEPS} match steps`);
  }
  const before = Math.min(one.record?.confirmed ?? 0, two.record?.confirmed ?? 0) + 1;
  f.push(...sameHashes(one, two, `${what}: copy 1 and copy 2`, DUEL_STEPS - 40));
  const rolled = one.rolledBack ?? [];
  const missed = cycles.filter((n) => !rolled.some((r) => r.to === turnStep(n) && r.from >= shotStep(n)));
  if (missed.length) f.push(`${what}: copy 1 never rolled back over the shot of cycle ${missed[0]} (to step ${turnStep(missed[0]!)} from step ${shotStep(missed[0]!)} or later); it rolled back ${rolled.length} times`);
  for (const c of copies) {
    const voices = voicesOf(c, what);
    // Copy 1 shot on a prediction in every cycle; copy 2 only where the run makes the shot.
    const ran = cycles.filter((n) => c.player === 1 || !endsTurn(n)).map(shotStep).filter((k) => k < before);
    const steps = voices.filter((v) => v.kind === SHOT && v.step < before).map((v) => v.step);
    if (JSON.stringify(steps) !== JSON.stringify(ran)) f.push(`${what}: copy ${c.player} started voices of shots at steps ${show(steps)}, not one for each shot it ran, ${show(ran)}`);
    const n = fadeSamples(OUT_RATE);
    for (const v of voices) {
      const dropped = endsTurn((v.step - 60) / 30);
      if (dropped && !v.faded) f.push(`${what}: copy ${c.player}'s voice of the dropped shot at step ${v.step} never faded`);
      if (!dropped && v.faded) f.push(`${what}: copy ${c.player}'s voice of the shot at step ${v.step}, which the run makes again, faded at sample ${v.faded.from}`);
      if (v.faded && Math.abs(v.faded.to - v.faded.from - n) > 1) f.push(`${what}: copy ${c.player}'s voice of the shot at step ${v.step} fades over ${v.faded.to - v.faded.from} samples, not 5 ms (${n})`);
    }
    f.push(...onceInOrder(audioOf(c, what), LAST_SAMPLE, `${what}: copy ${c.player}`));
  }
  return f;
}
async function run(what: string, planted?: Planted): Promise<Copy551[]> {
  return (await play(builds.show(), temp(), what, { ...ask, ...(planted ? { planted } : {}) })).copies;
}

describe(`${AC[3]} 50 rollbacks over steps whose shot spawned a voice`, () => {
  it(`${AC[3]} across 50 rollbacks that each replace a step whose shot spawned a voice, the audio thread renders each output sample once and in order, and both copies' full-state hashes agree at every confirmed step`, async () => {
    none(judge(await run('AC3 the duel'), 'AC3'), 'the duel across 50 rollbacks');
  }, TIMEOUT);

  it(`${AC[3]} a planted media module that restores its own checkpoint on a rollback renders samples again and fails, naming the first`, async () => {
    const f = judge(await run('AC3 the duel, planted media', 'media_restores_checkpoint'), 'AC3 planted');
    expect(f.filter((x) => /renders sample \d+ again/.test(x)), `the judge fails the planted media module, naming the first sample it renders again: ${show(f, 1500)}`).not.toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a planted full-state hash that covers media's state stops the match with net.desync and fails`, async () => {
    const copies = await run('AC3 the duel, planted hash', 'net_hash_covers_media');
    for (const c of copies) {
      expect(c.end, `copy ${c.player}'s match stops with net.desync`).toBe('desync');
      expect(c.raw['desync'], `copy ${c.player} reports net.desync`).toBeTruthy();
    }
    expect(judge(copies, 'AC3 planted hash'), 'the judge fails the planted hash').not.toEqual([]);
  }, TIMEOUT);
});
