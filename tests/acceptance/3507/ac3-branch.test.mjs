// Criterion 3 of #3507 (#3507.dc916f1d), what the report says of the pass: "… Past 1.1 a covered pixel, the change
// brings it to at most 1.05 there … At 1.1 or under, no pass changes and the report says so"
//
// The report's line `Geometry pass: …` (docs/evidence/3507/README.md; README: The report) says which branch the
// change took. This file holds that line to what a run of its own shows; ac3-report.test.mjs holds the count.
//
// - **`Geometry pass: unchanged`.** "No pass changes" is read from the frames themselves: frames 0, 75, 150 and 225
//   of #3031's every-pass fixture (a quarter of the camera's turn apart) are drawn through `view3d`, with `timings`
//   and `counts`, by this checkout's `deep-gpu` and by the merge base's, from one call. The reply's pass list, each
//   frame's timed passes and each frame's draws (`draws`, `indirect_draws`, `encoded`) are the merge base's
//   (`samePassProblems`). Without the merge base's built checkout (`DEEP_3507_BASE`) this is BLOCKED.
// - **`Geometry pass: occluders' depth | depth pass | nearest first`.** The merge base can't count what its pass
//   shades, so the changed build keeps that pass as a planted wrong program, the scenario's `planted:
//   "geometry_pass_at_merge_base"`: under it the 300 frames are counted again, and what the merge base's pass shades
//   must be past 1.1 a covered pixel (at 1.1 or under no pass changes) and be the count the report gives as before
//   (`beforeProblems`). A build with no such planted program is BLOCKED.
// Run: [DEEP_3507_BASE=<built merge base>] node --test tests/acceptance/3507/ac3-branch.test.mjs
import test from 'node:test';
import { ALL_FRAMES, MERGE_BASE_PASS, REPORT, counted, everyPass, everyPassView, gpuBinary, gpuRun, listed, mergeBase, referenceMac, report, settle, showBinary, tempDir, underLease } from './drive.mjs';
import { UNCHANGED, beforeProblems, countOf, reportOf, samePassProblems } from './judge.mjs';

const SAMPLED = [0, 75, 150, 225];
/** What one build's replies say of the sampled frames: the pass list, and each frame's timed passes and draws. */
const said = (replies) => ({
  passes: replies.map((r) => r.passes),
  frames: replies.flatMap((r) => (Array.isArray(r.frames) ? r.frames : []).map((f) => ({ frame: f.frame, passes_ms: f.passes_ms ?? null, draws: f.draws, indirect_draws: f.indirect_draws, encoded: f.encoded }))),
});

test('AC3 #3507.dc916f1d the report says whether a pass changed, and a run shows it: unchanged, the every-pass frames\' passes and draws are the merge base\'s; changed, the merge base\'s pass shades past 1.1 a covered pixel there', { timeout: 20 * 60_000 }, async (t) => {
  const text = report();
  const stated = reportOf(text);
  settle(`AC3 #3507.dc916f1d (the report is ${REPORT})`, stated.way === null ? stated.problems : []);
  await referenceMac('what a frame draws');
  if (stated.way === UNCHANGED) {
    const base = mergeBase(['deep-gpu']);
    const bin = gpuBinary();
    const calls = SAMPLED.map((k) => everyPassView({ from: k, frames: 1, timings: true, counts: true }));
    const [change, before] = await underLease('the frames', async () => {
      const out = [];
      for (const [side, exe] of [['this checkout', bin], [`the merge base (${base.commit.slice(0, 9)})`, `${base.debug}/deep-gpu`]]) {
        const dir = tempDir('passes');
        try { out.push(said(await gpuRun(exe, dir.dir, calls, { what: `deep-gpu run (${side}, the every-pass fixture's frames ${SAMPLED.join(', ')})` }))); } finally { dir.remove(); }
      }
      return out;
    });
    t.diagnostic(`the report says no pass changed; frames ${SAMPLED.join(', ')} time ${Object.keys(change.frames[0]?.passes_ms ?? {}).length} passes each`);
    settle('AC3 #3507.dc916f1d', samePassProblems(change, before));
    return;
  }
  const bin = showBinary();
  const twin = await underLease('the count before', async () => countOf('every_pass under the merge base\'s pass', listed(await counted(bin, { ...everyPass(), frames: ALL_FRAMES, planted: MERGE_BASE_PASS, processes: 4 }))));
  if (twin.problems.length === 0) t.diagnostic(`the report says the pass changed (${stated.way}); the merge base's pass shades ${twin.aCoveredPixel.toFixed(4)} a covered pixel, ${twin.aPixel.toFixed(4)} a pixel`);
  settle('AC3 #3507.dc916f1d', beforeProblems(text, twin));
});
