// Criterion 6: "Seeking before the join restarts at 0, and a frame there equals a fresh run of the new revision."
//
// The jumper is played with presses in frames 60, 290 and 350 (read by steps 61, 291 and 351); while frame 300 is
// drawn its gravity is patched from −9.81 to −19.62 m/s², which carries on (README: The join). Frame 400 seeks to
// step 120, before the join. A fresh run of the new revision from step 0 on the same presses, in another process, gives
// step 120 to compare: every carried state’s full-state hash, every array and every body. The ball jumped at step 61,
// so at step 120 the old revision’s run and the new one’s differ, which the test checks first: a seek that showed the
// old run’s step 120 would fail.
import { describe, expect, it } from "vitest";
import { AC, GRAVITY, TIMEOUT, V1, WORLD, gameDoc, judgeCarried, none, play, rowAt, sameBodies, useBuild, useEvidence } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const SEEK_FRAME = 400;
const TO = 120;
const PRESSES = [60, 290, 350];

describe(`${AC[6]} a seek before the join`, () => {
  it(`${AC[6]} after a join at step ${AT}, a seek to step ${TO} restarts at step 0 and its frame equals a fresh run of the new revision`, () => {
    const before = gameDoc(bin(), evidence(), { version: V1 });
    const after = gameDoc(bin(), evidence(), { version: V1, gravity: 2 * GRAVITY });
    const fresh = play(bin(), evidence(), after, { frames: TO + 2, presses: PRESSES.filter((f) => f < TO) }, "a fresh run of the new revision").played;
    const p = play(bin(), evidence(), before, { frames: SEEK_FRAME + 3, presses: PRESSES, revise: [{ frame: AT, document: after }], seeks: [{ frame: SEEK_FRAME, to: TO }] }, `the run patched at step ${AT}, then sought to step ${TO}`).played;
    none(judgeCarried(p, AT), "the run carried on from the join");
    const want = rowAt(fresh, TO, "the fresh run");
    expect(rowAt(p, TO, "the patched run").deep[WORLD], `the old revision’s step ${TO} isn’t the new one’s`).not.toBe(want.deep[WORLD]);
    const got = rowAt(p, SEEK_FRAME, "the patched run");
    expect([got.step, got.from], `frame ${SEEK_FRAME} shows step ${TO} of a run from step 0`).toEqual([TO, 0]);
    expect(got.rev, "under the new revision").toBe(rowAt(p, AT + 1, "the patched run").rev);
    expect(got.deep, `step ${TO}’s full-state hashes are a fresh run’s of the new revision`).toEqual(want.deep);
    expect(got.arrays, `step ${TO}’s arrays are a fresh run’s`).toEqual(want.arrays);
    none(sameBodies(got.worlds, want.worlds, `step ${TO}’s bodies against a fresh run’s`), "every body is where a fresh run has it");
    expect(rowAt(p, SEEK_FRAME + 1, "the patched run").step, "play goes on from the seek").toBe(TO + 1);
  }, TIMEOUT);
});
