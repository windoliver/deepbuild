// Criterion 1: "Patching a material at step 300 shows it at step 301, and the logic and physics state hash equals an
// unpatched run’s at 301. A planted restart fails, naming the step."
//
// The jumper (README: The fixture game) is played 312 frames with presses in frames 100, 200 and 290. Its revision that
// changes only the material `paint` (red to blue) arrives while frame 300 is drawn, so frame 301 is the first under it
// (README: The join). An unpatched run of the same presses in another process gives each carried state’s full-state
// hash at step 301: the logic item `game`’s and the world `lab`’s. The judge `judgeCarried` reads the join, the frame
// after it and those hashes; the planted restart is `--planted join_restarts`, and the judge must name step 301.
import { describe, expect, it } from "vitest";
import { AC, BLUE, LOGIC, PAINT_PATH, RED, TIMEOUT, V1, WORLD, caughtNaming, gameDoc, judgeCarried, none, play, rowAt, useBuild, useEvidence, type JsonObject, type Planted, type Played } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const PRESSES = [100, 200, 290];
const script = (patch?: JsonObject) => ({ frames: AT + 12, presses: PRESSES, paths: [PAINT_PATH], ...(patch ? { revise: [{ frame: AT, document: patch }] } : {}) });

function runs(planted?: Planted): { unpatched: Played; patched: Played } {
  const before = gameDoc(bin(), evidence(), { version: V1 });
  const after = gameDoc(bin(), evidence(), { version: V1, color: BLUE });
  const unpatched = play(bin(), evidence(), before, script(), "the unpatched run").played;
  const patched = play(bin(), evidence(), before, script(after), `the run whose material is patched at step ${AT}`, planted).played;
  return { unpatched, patched };
}

describe(`${AC[1]} a material patched while you play`, () => {
  it(`${AC[1]} the material patched at step ${AT} shows at step ${AT + 1}, and the logic and physics state hashes there equal an unpatched run’s`, () => {
    const { unpatched, patched } = runs();
    expect(rowAt(patched, AT - 1, "the patched run").values[PAINT_PATH], `step ${AT - 1} shows the material as it was`).toEqual(RED);
    expect(rowAt(patched, AT + 1, "the patched run").values[PAINT_PATH], `step ${AT + 1} shows the patched material`).toEqual(BLUE);
    expect(Object.keys(rowAt(unpatched, AT + 1, "the unpatched run").deep).sort(), "the state hashes cover the logic item and the world").toEqual([LOGIC, WORLD].sort());
    none(judgeCarried(patched, AT, unpatched), "the run carried on from the join");
  }, TIMEOUT);

  it(`${AC[1]} a planted restart (join_restarts) fails, naming step ${AT + 1}`, () => {
    const { unpatched, patched } = runs("join_restarts");
    caughtNaming(judgeCarried(patched, AT, unpatched), [`step ${AT + 1}`], "join_restarts");
  }, TIMEOUT);
});
