// Criterion 5: "A revision that removes a body restarts at 0, naming the body."
//
// The jumper is played 305 frames with presses in frames 100, 200 and 290; while frame 300 is drawn a revision arrives
// whose world no longer has the dynamic `crate` and is otherwise the same. A world that loses a body never carries on
// (README: The join), so the run restarts at step 0: the judge `judgeRestarted` reads the join and the frame after it
// against a fresh run of the new revision from step 0 on the same presses, in another process.
import { describe, expect, it } from "vitest";
import { AC, CRATE, TIMEOUT, V1, WORLD, gameDoc, judgeRestarted, none, obj, play, rowAt, useBuild, useEvidence } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const PRESSES = [100, 200, 290];

describe(`${AC[5]} a revision that removes a body`, () => {
  it(`${AC[5]} the revision at step ${AT} without the crate restarts the run at step 0, naming the crate`, () => {
    const before = gameDoc(bin(), evidence(), { version: V1 });
    const after = gameDoc(bin(), evidence(), { version: V1, crate: false });
    const fresh = play(bin(), evidence(), after, { frames: AT + 5, presses: PRESSES }, "a fresh run of the new revision").played;
    const p = play(bin(), evidence(), before, { frames: AT + 5, presses: PRESSES, revise: [{ frame: AT, document: after }] }, `the run whose crate goes at step ${AT}`).played;
    none(judgeRestarted(p, AT, fresh), "the run restarted at step 0");
    const join = p.joins.find((j) => j.step === AT)!;
    expect(join.differs.filter((d) => d["what"] === "body"), "the join names the removed body").toMatchObject([{ what: "body", world: WORLD, body: CRATE }]);
    expect(join.line, "the line names the body").toContain(CRATE);
    expect(Object.keys(obj(rowAt(p, AT + 1, "the patched run").worlds[WORLD], "step 301’s world")), "the world after the restart has no crate").not.toContain(CRATE);
  }, TIMEOUT);
});
