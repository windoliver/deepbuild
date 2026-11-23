// Criterion 8: "From the patch to the first carried-on frame takes under 200 ms (drafted) on the reference Mac, with a
// 64 MiB state."
//
// Pinned to the reference Mac: on any other host the test fails BLOCKED before it builds or measures. On a Mac the
// limit is judged as #189’s criterion 11 judges its budgets: scripts/benchmark.mjs’s judgeLimit over five readings
// after a warm-up (a reference Mac on mains power, Low Power Mode off, thermal state nominal, load under the core
// count); anything but PASS fails, naming the judge’s reason. Each reading is one process: the 64 MiB game (1,024
// pages, each holding a nonzero byte; README: Programs) played 302 frames, its program patched while frame 300 is
// drawn to one that keeps its layout, so the run carries on; the reading is the join’s `ns` (README: Join), in ms.
import { describe, it } from "vitest";
import { AC, BIG1, BIG2, TIMEOUT, gameDoc, judgeBudget, judgeCarried, none, onReferenceMacOnly, play, useBuild, useEvidence } from "./helpers.ts";

const bin = useBuild(process.platform === "darwin");
const evidence = useEvidence();
const AT = 300;

describe(`${AC[8]} the join’s time on the reference Mac`, () => {
  it(`${AC[8]} from the patch to the first carried-on frame takes under 200 ms with a 64 MiB state`, async () => {
    onReferenceMacOnly("criterion 8’s join time");
    const before = gameDoc(bin(), evidence(), { version: BIG1, span: "6s" });
    const after = gameDoc(bin(), evidence(), { version: BIG2, span: "6s" });
    await judgeBudget(200, () => {
      const p = play(bin(), evidence(), before, { frames: AT + 2, revise: [{ frame: AT, document: after }], rows: [AT, AT + 1] }, "the 64 MiB game patched at step 300").played;
      none(judgeCarried(p, AT), "the run carried on from the join");
      return p.joins.find((j) => j.step === AT)!.ns / 1e6;
    }, "from the patch to the first carried-on frame, in ms");
  }, TIMEOUT);
});
