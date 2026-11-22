// AC2 #553.369b7549: In a two-player match on the test relay, a late entry from player 2 at step 295 that ends the
// shooter's turn removes player 1's shot occurrence at step 300: the row is dropped, its voice fades out over 5 ms, and
// both copies' occurrence lists and full-state hashes agree; a planted rollback that keeps the replaced step's row fails
// net.rollback, naming the step and the kind
//
// The duel (README: The duel) over 400 match steps on the test relay (`match`, in one process): player 1 fires every
// 30 steps from step 60, player 2's entry lands 5 steps before each shot and ends the turn in every fourth cycle. Every
// message is on time but player 2's for step 295, which reaches copy 1 only once it has run step 300 (#551's
// `relay.deliver`), so copy 1 shoots at step 300 on a prediction and its spawn starts the shot's voice. Played with
// net.rollback, which must pass: copy 1 rolls back to 295; neither copy holds a shot at step 300 and their occurrence
// lists are row for row the same; their full-state hash agrees at every confirmed step; copy 1's voice of that shot
// fades over 5 ms of output, by its report and by the samples its audio thread rendered; copy 2 never started one; every
// other voice plays on. The planted rollback keeps the replaced step's row: net.rollback fails, a failure naming step 300
// and the kind shot. Wrong programs it fails: the merge base (no voices on a copy, no planted name); a rollback that
// keeps the row or its voice, cuts the voice dead or fades it over another time; a check that names another step or no
// kind.
import { describe, expect, it } from 'vitest';
import { CYCLES_SHORT, CYCLE_300, SAMPLES_PER_STEP, SHORT_STEPS, SHOT, SHOT_300, SPAWN, TURN_295, duelDoc, duelPlays, duelProgram, endsTurn, lateTurns, sha256, shotStep, toneWav } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, audioOf, decodeWav, evidenceBytes, fadeFailures, none, occurrenceLines, play, sameHashes, show, useBuilds, useChildren, useTemp, voicesOf,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const program = duelProgram();
const tone = toneWav();
const document = duelDoc(program, sha256(tone));
const ask = { document, steps: SHORT_STEPS, plays: duelPlays(CYCLES_SHORT), assets: [program, tone], relay: { seed: 553, deliver: lateTurns([CYCLE_300]) }, check: 'net.rollback' as const };

describe(`${AC[2]} a late turn entry at step 295 removes the shot at step 300 and fades its voice`, () => {
  it(`${AC[2]} the late entry drops the shot's row at step 300, its voice fades out over 5 ms, and both copies' occurrence lists and full-state hashes agree`, async () => {
    const evidence = temp();
    const { copies: [one, two], check } = await play(builds.show(), evidence, 'AC2 the duel', ask);
    const f: string[] = [];
    if (check!.verdict !== 'PASS') f.push(`net.rollback fails the honest copies: ${show(check!.failures, 1200)}`);
    if (!(one!.rolledBack ?? []).some((r) => r.to === TURN_295 && r.from >= SHOT_300)) f.push(`copy 1 never rolled back to step ${TURN_295} after running step ${SHOT_300}: ${show(one!.rolledBack)}`);
    const before = Math.min(one!.record?.confirmed ?? 0, two!.record?.confirmed ?? 0) + 1;
    if (before <= SHOT_300) f.push(`the copies confirmed only up to step ${before - 1}`);
    // The shots the run makes: every cycle's but every fourth's (cycles 0, 4 and 8, whose turn ended first).
    const made = Array.from({ length: CYCLES_SHORT }, (_, n) => n).filter((n) => !endsTurn(n)).map(shotStep);
    for (const c of [one!, two!]) {
      const rows = occurrenceLines(c, before, 'AC2').map((l) => JSON.parse(l) as Record<string, unknown>);
      if (rows.some((r) => r['step'] === SHOT_300 && r['kind'] === SHOT)) f.push(`copy ${c.player} still holds the shot at step ${SHOT_300}`);
      const shots = rows.filter((r) => r['kind'] === SHOT).map((r) => Number(r['step'])).sort((x, y) => x - y);
      if (JSON.stringify(shots) !== JSON.stringify(made.filter((k) => k < before))) f.push(`copy ${c.player} holds shot rows at steps ${show(shots)}, not at the steps the run makes them, ${show(made.filter((k) => k < before))}`);
    }
    const [o1, o2] = [occurrenceLines(one!, before, 'AC2'), occurrenceLines(two!, before, 'AC2')];
    if (JSON.stringify(o1) !== JSON.stringify(o2)) f.push(`the copies' occurrence lists differ: ${o1.find((l) => !o2.includes(l)) ?? o2.find((l) => !o1.includes(l)) ?? `${o1.length} rows and ${o2.length}`}`);
    f.push(...sameHashes(one!, two!, 'copy 1 and copy 2', before - 20));
    // The voices: copy 1's of the shot at step 300 fades over 5 ms; copy 2 never had one; every other plays on.
    const [v1, v2] = [voicesOf(one!, 'AC2'), voicesOf(two!, 'AC2')];
    const dropped = v1.filter((v) => v.step === SHOT_300 && v.kind === SHOT);
    if (dropped.length !== 1) f.push(`copy 1 started ${dropped.length} voices of the shot at step ${SHOT_300}, not the one its predicted step made: ${show(v1)}`);
    if (dropped[0] && dropped[0].spawn !== SPAWN) f.push(`copy 1's voice of the shot at step ${SHOT_300} is the spawn ${dropped[0].spawn}'s, not ${SPAWN}'s`);
    if (v2.some((v) => v.step === SHOT_300)) f.push(`copy 2 started a voice of a shot at step ${SHOT_300}, which its on-time run never made`);
    for (const [c, list] of [[1, v1], [2, v2]] as const) {
      const kept = list.filter((v) => v.step !== SHOT_300);
      if (JSON.stringify(kept.map((v) => v.step)) !== JSON.stringify(made)) f.push(`copy ${c} started voices of the shots at steps ${show(kept.map((v) => v.step))}, not one for each shot the run makes, ${show(made)}`);
      for (const v of kept) if (v.faded) f.push(`copy ${c}'s voice of the shot at step ${v.step}, which the run makes, faded at sample ${v.faded.from}`);
    }
    if (dropped[0]) {
      const audio = audioOf(one!, 'AC2');
      const wav = decodeWav(evidenceBytes(evidence, audio.wav, 'AC2 copy 1\'s audio'), 'AC2 copy 1\'s audio');
      const rendered = audio.blocks.reduce((n, b) => n + b.count, 0);
      if (wav.channels[0]!.length !== rendered) f.push(`copy 1's WAV holds ${wav.channels[0]!.length} samples, not the ${rendered} its audio thread rendered`);
      if (dropped[0].start < SHOT_300 * SAMPLES_PER_STEP) f.push(`copy 1's voice of the shot at step ${SHOT_300} began at sample ${dropped[0].start}, before the step's time`);
      f.push(...fadeFailures(dropped[0], wav, audio, 'copy 1'));
    }
    none(f, 'the shot at step 300 removed by the late entry at step 295');
  }, TIMEOUT);

  it(`${AC[2]} a planted rollback that keeps the replaced step's row fails net.rollback, naming step 300 and the kind shot`, async () => {
    const { check } = await play(builds.show(), temp(), 'AC2 the duel, planted', { ...ask, planted: 'net_keeps_replaced_rows' });
    expect(check!.verdict, `net.rollback fails the planted rollback: ${show(check!.raw, 1200)}`).toBe('FAIL');
    const named = check!.failures.filter((x) => x['step'] === SHOT_300 && x['kind'] === SHOT);
    expect(named.length, `a failure names step ${SHOT_300} and the kind ${SHOT}: ${show(check!.failures, 1200)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
