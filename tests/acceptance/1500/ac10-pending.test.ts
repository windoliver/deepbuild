// Criterion 10: "In that run each of the 20 presses sent in the frame a patch lands is read by the first step run under
// the new revision, 20 of 20. A planted join that clears pending input drops them and fails, naming the first press"
//
// The run is criterion 9’s (helpers: pressRun). A press sent in the frame a patch lands, frame F, is stamped at step
// F + 1, and the patch is taken by frame F + 1’s latch, so step F + 1 is the first run under the new revision (README:
// The join). What the step read is the game’s own record: its program counts the presses it reads (`presses`), keeps
// the step that last read one (`pressed_at`) and writes its rule (`rule`). The judge reads frame F + 1: a run carried
// on from the join under a new revision whose rule it shows, that read the press at step F + 1, the 2 × (i + 1)th press
// of the run. The planted join is `--planted join_clears_pending`; the first press it drops is frame 30’s.
import { describe, expect, it } from "vitest";
import { A, AC, PATCH_FRAMES, PATCH_RULES, TIMEOUT, caughtNaming, none, pressRun, useBuild, useEvidence, valueOf, type Planted, type Played } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();

/** Each press sent in a patch’s frame against the first step under the new revision; a failure per press not read there. */
function judgePending(p: Played): string[] {
  const out: string[] = [];
  PATCH_FRAMES.forEach((f, i) => {
    const row = p.rows.get(f + 1);
    const prev = p.rows.get(f);
    if (!row || !prev) { out.push(`the press sent in frame ${f}: the play lists no frame ${f} or ${f + 1}`); return; }
    const read = [valueOf(row, A.pressed_at, `frame ${f + 1}`), valueOf(row, A.presses, `frame ${f + 1}`), valueOf(row, A.rule, `frame ${f + 1}`)];
    const fresh = row.from === f + 1 && row.rev !== prev.rev;
    if (!fresh || read[0] !== f + 1 || read[1] !== 2 * (i + 1) || read[2] !== PATCH_RULES[i])
      out.push(`the press sent in frame ${f} (stamped at step ${f + 1}) isn’t read by step ${f + 1}, the first step run under the new revision: from ${row.from}, revision ${prev.rev} then ${row.rev}, pressed_at ${read[0]}, presses ${read[1]}, rule ${read[2]} (want rule ${PATCH_RULES[i]})`);
  });
  return out;
}
const played = (planted?: Planted): Played => pressRun(bin(), evidence(), "40 presses while 20 patches land", planted).played;

describe(`${AC[10]} input sent while a patch lands`, () => {
  it(`${AC[10]} each of the 20 presses sent in a patch’s frame is read by the first step under the new revision, 20 of 20`, () => {
    expect(PATCH_FRAMES.length, "20 patches").toBe(20);
    none(judgePending(played()), "the presses sent in a patch’s frame");
  }, TIMEOUT);

  it(`${AC[10]} a planted join that clears pending input (join_clears_pending) drops them and fails, naming the first press`, () => {
    caughtNaming(judgePending(played("join_clears_pending")), ["frame 30", "step 31"], "join_clears_pending");
  }, TIMEOUT);
});
