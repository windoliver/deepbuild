// Criterion 2: "Patching a program that keeps its layout keeps the score and positions, and the new `step` runs from
// 301."
//
// The jumper under rule 1 (a press scores 1) is played 330 frames with presses in frames 100, 200, 290 and 320 (read by
// steps 101, 201, 291 and 321). While frame 300 is drawn its program is patched to rule 2 (a press scores 10, and the
// program keeps the step of its first call in `since`), which exports the same layout bytes, so its state layout is
// the same (README: Programs). An unpatched run of the same presses gives the world’s state at step 301.
import { describe, expect, it } from "vitest";
import { A, AC, TIMEOUT, V1, V2, WORLD, gameDoc, judgeCarried, none, obj, play, rowAt, sameBodies, useBuild, useEvidence, valueOf } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const PRESSES = [100, 200, 290, 320];

describe(`${AC[2]} a program patched while you play, keeping its layout`, () => {
  it(`${AC[2]} the patch at step ${AT} keeps the score and every body, and the new step runs from step ${AT + 1}`, () => {
    const v1 = gameDoc(bin(), evidence(), { version: V1 });
    const v2 = gameDoc(bin(), evidence(), { version: V2 });
    const program = (d: typeof v1): unknown => obj(obj(obj(d["items"], "items")["game"], "items.game")["params"], "game.params")["program"];
    expect(program(v2), "the patch changes the program").not.toBe(program(v1));
    const script = { frames: 330, presses: PRESSES };
    const unpatched = play(bin(), evidence(), v1, script, "the unpatched run").played;
    const p = play(bin(), evidence(), v1, { ...script, revise: [{ frame: AT, document: v2 }] }, `the run whose program is patched at step ${AT}`).played;
    none(judgeCarried(p, AT), "the run carried on from the join");
    const at = rowAt(p, AT, "the patched run");
    const next = rowAt(p, AT + 1, "the patched run");
    const join = p.joins.find((j) => j.step === AT)!;
    expect([valueOf(at, A.score, "step 300"), valueOf(at, A.rule, "step 300")], `step ${AT}: three presses scored 1 each, under rule 1`).toEqual([3, 1]);
    expect(valueOf(next, A.score, "step 301"), `step ${AT + 1} keeps the score`).toBe(3);
    expect(valueOf(next, A.rule, "step 301"), `step ${AT + 1} is the new program’s`).toBe(2);
    expect(valueOf(next, A.since, "step 301"), "the new program’s step is first called for step 301").toBe(AT + 1);
    expect(valueOf(rowAt(p, 321, "the patched run"), A.score, "step 321"), "the press read by step 321 scores 10 under the new rule").toBe(13);
    none(sameBodies(join.worlds, at.worlds, `the bodies at the join against step ${AT}’s`), "the join keeps every body where it was");
    const straight = rowAt(unpatched, AT + 1, "the unpatched run");
    expect(next.deep[WORLD], `the world’s full-state hash at step ${AT + 1} is the unpatched run’s`).toBe(straight.deep[WORLD]);
    none(sameBodies(next.worlds, straight.worlds, `step ${AT + 1}’s bodies against the unpatched run’s`), "the positions carry on");
  }, TIMEOUT);
});
