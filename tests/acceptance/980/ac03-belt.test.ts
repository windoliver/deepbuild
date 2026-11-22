// Criterion 3: "A conveyor 10 m long at 0.5 m/s with 0.6 m spacing carries a lone case end to end in 20 s. With its end
// blocked it holds 17 cases, the 18th waits at the infeed, and `process.conserve` passes at every step."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the belt scene (scenes.ts: BELT) at a 1/60 s
// tick, one step a tick, 1,500 steps: belt A carries one case to a sink; belt B, whose end leads nowhere (README:
// Exports: `to` −1), is fed 18 cases at once through its infeed queue. fixtures.ts (beltRun) works both out: 1,200
// ticks end to end and 72 ticks of spacing, so the lone case is at the end at step 1,199 and out at tick 1,200 = 20 s;
// belt B's cases enter 72 ticks apart and stop with the lead at the end, case i at 10 − 0.6i m, ⌊10 ÷ 0.6⌋ + 1 = 17 of
// them, the 18th at the head of the infeed queue. The wrong programs this fails on: a belt slower or faster than 0.5 m/s
// (the 20 s), one that ignores the spacing or closes up past it (more than 17, or other distances), one that lets the
// lead off a blocked end, and one that drops or makes a case (process.conserve).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild } from '../190/helpers.ts';
import { beltFixture, beltRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, judgeCall, judged, layout, numbers, passes, piece, processLib, rule, series } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { BELT, BELT_ST, BELT_STEPS } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[3]} a conveyor carries a lone case in 20 s and holds 17 behind a blocked end`, () => {
  it(`${AC[3]} a 10 m conveyor at 0.5 m/s with 0.6 m spacing carries a lone case end to end in 20 s; with its end blocked it holds 17 cases, the 18th waits at the infeed, and process.conserve passes at every step`, () => {
    const r = beltRun();
    expect([r.P * BELT.tick, Math.floor(10 / 0.6) + 1, r.dOf(r.pB(16, 1499)!)], 'by the belt\'s geometry: 20 s end to end; 17 fit; the 17th stops 0.4 m along').toEqual([20, 17, 0.4]);

    const L = processLib();
    const writes = processWrites(BELT);
    layout(writes);
    const program = sceneProgram(BELT, INTERFACE);
    const f = beltFixture(program, writes);
    const assets = carry({ ...L.assets }, program);
    const [bake, judge] = onHost([
      bakeCall(fixturePiece(f as never, L.ref, assets), BELT_STEPS),
      judgeCall(piece({ belt: { program, scene: BELT, writes, links: [L.ref] } }, [], assets), BELT_STEPS),
    ]);
    const b = bakeOf(bake!, 'the belt run\'s bake');
    expect(fixtureDiffers(b, f as never), 'the belt fixture\'s arrays hold within 1e-9').toEqual([]);

    // The lone case (row 0): on belt A until it reaches 10 m at step 1,199, out at tick 1,200 after 20 s.
    const d = numbers(series(b, 'fixture', 'd'), 'd');
    const at = numbers(series(b, 'fixture', 'at'), 'at');
    const end = at.findIndex((a, k) => a[0] === BELT_ST.a && Math.abs(d[k]![0]! - 10) <= 1e-9);
    const out = at.findIndex((a) => a[0] !== BELT_ST.a);
    const recW = num((b.steps[out]!.arrays['fixture.rec_w'] as number[])[0], 'rec_w[0]');
    expect([end, out, recW], 'the lone case reaches the end at step 1,199 and leaves at step 1,200 (t = 20 s), 20 s in the system').toEqual([1199, 1200, 20]);

    // Belt B blocked: from step 1,199 on, 17 cases at 10 − 0.6i m, the 18th (row 18) at the infeed queue's head.
    const counts = numbers(series(b, 'fixture', 'count'), 'count');
    const ranks = numbers(series(b, 'fixture', 'rank'), 'rank');
    const bad: string[] = [];
    for (let k = 1199; k < BELT_STEPS; k++) {
      const onB = Array.from({ length: 19 }, (_, row) => row).filter((row) => at[k]![row] === BELT_ST.b);
      const where = onB.map((row) => +d[k]![row]!.toFixed(9));
      if (counts[k]![BELT_ST.b] !== 17 || onB.length !== 17 || where.some((x, i) => Math.abs(x - (10 - 0.6 * i)) > 1e-9)) bad.push(`step ${k}: belt B holds ${onB.length} (count ${counts[k]![BELT_ST.b]}) at ${where.join(', ')}`);
      if (at[k]![18] !== BELT_ST.qb || ranks[k]![18] !== 0 || counts[k]![BELT_ST.qb] !== 1) bad.push(`step ${k}: the 18th case is at ${at[k]![18]} rank ${ranks[k]![18]}, the infeed queue holds ${counts[k]![BELT_ST.qb]}`);
    }
    expect(bad.slice(0, 10), 'blocked, belt B holds 17 cases 0.6 m apart from its end and the 18th waits at the head of its infeed').toEqual([]);

    const j = judged(judge!, 'belt');
    passes(rule(j, 'process.conserve'), 'process.conserve', BELT_STEPS);
  }, TIMEOUT);
});
