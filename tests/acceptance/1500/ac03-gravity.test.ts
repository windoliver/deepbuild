// Criterion 3: "Patching gravity keeps every body where it was at the join, and the next step uses the new gravity."
//
// The jumper is played 305 frames with one press in frame 290, which launches the ball at step 291, so it is in the air
// from step 291 to past step 302. While frame 300 is drawn the world’s gravity is patched from −9.81 to −19.62 m/s²;
// every body, shape and joint stays, so the run carries on (README: The join). "Keeps every body where it was" is the
// join’s `worlds` (as opened under the new revision) against step 300’s; "the next step uses the new gravity" is the
// ball’s height read at steps 300, 301 and 302: in free flight its second difference is g × (1/60 s)², whatever the
// integrator’s substeps, as long as both steps run under one gravity (probed at the base through `world`: −0.002725 and
// −0.00545 within 1e-7). Steps 298 to 300 give the old gravity’s, so the ball is in flight there.
import { describe, expect, it } from "vitest";
import { AC, BALL, GRAVITY, TIMEOUT, V1, WORLD, gameDoc, judgeCarried, none, obj, play, posOf, rowAt, sameBodies, useBuild, useEvidence, type Played } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const DT2 = 1 / 3600;

/** The ball’s height’s second difference over steps k − 1, k and k + 1. */
function bend(p: Played, k: number): number {
  const y = (s: number): number => posOf(rowAt(p, s, "the patched run").worlds, BALL, `step ${s}`)[1]!;
  return (y(k + 1) - y(k)) - (y(k) - y(k - 1));
}

describe(`${AC[3]} gravity patched while you play`, () => {
  it(`${AC[3]} the patch at step ${AT} keeps every body where it was at the join, and step ${AT + 1} falls under the new gravity`, () => {
    const before = gameDoc(bin(), evidence(), { version: V1 });
    const after = gameDoc(bin(), evidence(), { version: V1, gravity: 2 * GRAVITY });
    const p = play(bin(), evidence(), before, { frames: AT + 5, presses: [290], revise: [{ frame: AT, document: after }] }, `the run whose gravity is patched at step ${AT}`).played;
    none(judgeCarried(p, AT), "the run carried on from the join");
    const join = p.joins.find((j) => j.step === AT)!;
    const at = rowAt(p, AT, "the patched run");
    expect(Object.keys(obj(join.worlds[WORLD], "the join’s world")).sort(), "the join holds every body of the world").toEqual(Object.keys(obj(at.worlds[WORLD], "step 300’s world")).sort());
    none(sameBodies(join.worlds, at.worlds, `the bodies at the join against step ${AT}’s`), "every body stays where it was at the join");
    expect(Math.abs(bend(p, AT - 1) - GRAVITY * DT2), `steps ${AT - 1} and ${AT} fall under the old gravity (the ball is in flight): ${bend(p, AT - 1)}`).toBeLessThan(2e-5);
    expect(Math.abs(bend(p, AT + 1) - 2 * GRAVITY * DT2), `steps ${AT + 1} and ${AT + 2} fall under the new gravity, ${2 * GRAVITY} m/s², not the old: ${bend(p, AT + 1)}`).toBeLessThan(2e-5);
  }, TIMEOUT);
});
