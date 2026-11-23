// Criterion 4: "A program with a changed layout and no migration restarts at 0 with a line naming both layouts. A
// planted run that reads the old bytes under the new layout fails."
//
// The jumper under layout A is played 305 frames with presses in frames 100, 200 and 290; while frame 300 is drawn its
// program is patched to one with layout B (a field inserted before the score, so every field moves; README: Programs)
// and the piece declares no migration. The judge `judgeRestarted` reads the join and the frame after it against a fresh
// run of the new revision from step 0 on the same presses, in another process. The planted run is
// `--planted join_reads_old_bytes`: the held memory opened under the new program as it is.
import { describe, expect, it } from "vitest";
import { AC, LOGIC, TIMEOUT, V1, V3, caughtNaming, gameDoc, judgeRestarted, layoutHash, none, play, useBuild, useEvidence, type Planted, type Played } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const PRESSES = [100, 200, 290];

function runs(planted?: Planted): { patched: Played; fresh: Played } {
  const before = gameDoc(bin(), evidence(), { version: V1 });
  const after = gameDoc(bin(), evidence(), { version: V3 });
  const fresh = play(bin(), evidence(), after, { frames: AT + 5, presses: PRESSES }, "a fresh run of the new revision").played;
  const patched = play(bin(), evidence(), before, { frames: AT + 5, presses: PRESSES, revise: [{ frame: AT, document: after }] }, `the run whose layout changes at step ${AT}`, planted).played;
  return { patched, fresh };
}

describe(`${AC[4]} a program whose layout changes, with no migration`, () => {
  it(`${AC[4]} the patch at step ${AT} restarts the run at step 0, with a line naming both layouts`, () => {
    const { patched, fresh } = runs();
    none(judgeRestarted(patched, AT, fresh), "the run restarted at step 0");
    const join = patched.joins.find((j) => j.step === AT)!;
    const [held, piece] = [layoutHash("A"), layoutHash("B")];
    expect(join.differs.filter((d) => d["what"] === "layout"), "the join names both layouts").toMatchObject([{ what: "layout", item: LOGIC, held, piece }]);
    expect(join.line.includes(held.slice(0, 8)) && join.line.includes(piece.slice(0, 8)), `the line names both layouts, ${held.slice(0, 8)} and ${piece.slice(0, 8)}: ${JSON.stringify(join.line)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} a planted run that reads the old bytes under the new layout (join_reads_old_bytes) fails`, () => {
    const { patched, fresh } = runs("join_reads_old_bytes");
    caughtNaming(judgeRestarted(patched, AT, fresh), [`step ${AT + 1}`], "join_reads_old_bytes");
  }, TIMEOUT);
});
