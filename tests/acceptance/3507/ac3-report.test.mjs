// Criterion 3 of #3507 (#3507.dc916f1d), its count and its report: "The PR's report gives the count for #3031's
// every-pass fixture. Past 1.1 a covered pixel, the change brings it to at most 1.05 there and the geometry pass's p50
// over five alternated rounds is no higher than the merge base's. At 1.1 or under, no pass changes and the report says
// so"
//
// The count is taken here, never read from the report: #3031's every-pass fixture
// (docs/spikes/3031/fixtures/every-pass-plus.json under every-pass-plus.look.json, 3456 × 2234), frame k at k ÷ 5 s,
// k from 0 to 299, each drawn by this checkout's `deep-show run` in the overdraw mode, four runs side by side. The
// fixture's count is #3031's kind of mean: each frame's fragments over its covered pixels, and over its pixels,
// averaged over the 300 frames. Then `reportProblems` reads the report, docs/evidence/3507/README.md (README: The
// report), against it: the report gives that count, to its three decimals; where it says the geometry pass is
// unchanged the count is at 1.1 a covered pixel or under; where it says the pass changed the count is at most 1.05,
// and the report gives the count before and the pass's time before and after.
//
// The other two files of the criterion: ac3-branch.test.mjs (what the report says of the pass, against the merge base)
// and ac3-timing.test.mjs (the five rounds). Frame 0 is read before the rest, so a build whose view gives no such
// count fails at once, on that.
// Run: node --test tests/acceptance/3507/ac3-report.test.mjs
import test from 'node:test';
import { ALL_FRAMES, REPORT, counted, everyPass, listed, referenceMac, report, settle, showBinary, underLease } from './drive.mjs';
import { countOf, reportProblems } from './judge.mjs';

test('AC3 #3507.dc916f1d the report gives the count for #3031\'s every-pass fixture: past 1.1 a covered pixel the change brings it to at most 1.05 there, and at 1.1 or under the report says no pass changed', { timeout: 20 * 60_000 }, async (t) => {
  await referenceMac('the count');
  const bin = showBinary();
  const fixture = everyPass();
  const own = await underLease('the count', async () => {
    const first = (await counted(bin, { ...fixture, frames: [0] })).get(0);
    settle('AC3 #3507.dc916f1d', first.ok ? [] : [`${first.state}: every_pass, frame 0: ${first.why}`]);
    return countOf('every_pass', listed(await counted(bin, { ...fixture, frames: ALL_FRAMES, processes: 4 })));
  });
  if (own.problems.length === 0) t.diagnostic(`every_pass: ${own.aCoveredPixel.toFixed(4)} fragments a covered pixel, ${own.aPixel.toFixed(4)} a pixel, over ${own.frames} frames`);
  settle(`AC3 #3507.dc916f1d (the report is ${REPORT})`, reportProblems(report(), own));
});
