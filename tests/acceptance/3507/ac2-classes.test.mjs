// Criterion 2 of #3507 as first written: "On each class's fixture, where no bar hides another, the count is 1 a covered
// pixel in every one of the 300 frames". Reworded on 2026-11-26; its test is tests/acceptance/3507-redraft-ac2/'s. This
// first draft is kept as written, by hand only, with no criterion ID: the one it had names no criterion of the issue.
// Each of the six budget classes' perf-lane fixtures, `benchmarks/canvas/<class>.json` as it stands, at its own size,
// under the perf lane's look (tests/acceptance/379/fixtures/look.json), as #3031 counted them: frame k at k ÷ 5 s,
// k from 0 to 299, the whole of the fixture's 60 s. Each frame is drawn by this checkout's `deep-show run` in the
// overdraw mode and its frame row read (README: The surface under test). `classProblems` holds every frame: the
// mode's own count is 2 at most (a bar's front and back, depth ignored: no pixel holds two bars, so no bar hides
// another, which is the criterion's "where"), and the count is fragment for covered pixel. A frame where a bar does
// hide another is INCONCLUSIVE, never a pass; a frame not counted is BLOCKED.
//
// The first class's first frame is read before anything else, so a build whose view gives no such count fails at
// once, on that.
// Run: node --test tests/acceptance/3507/ac2-classes.test.mjs
import test from 'node:test';
import { ALL_FRAMES, classFixture, counted, listed, referenceMac, settle, showBinary, underLease } from './drive.mjs';
import { CLASSES, FRAMES, classProblems } from './judge.mjs';

test('first draft of criterion 2 of #3507, as first written: on each class\'s fixture, where no bar hides another, the count is 1 a covered pixel in every one of the 300 frames', { timeout: 20 * 60_000 }, async (t) => {
  await referenceMac('the count');
  const bin = showBinary();
  const problems = await underLease('the count', async () => {
    const first = (await counted(bin, { ...classFixture(CLASSES[0]), frames: [0] })).get(0);
    settle('criterion 2 of #3507 as first written', first.ok ? [] : [`${first.state}: ${CLASSES[0]}, frame 0: ${first.why}`]);
    const found = [];
    for (const name of CLASSES) {
      const readings = listed(await counted(bin, { ...classFixture(name), frames: ALL_FRAMES, processes: 2 }));
      const mine = classProblems(name, readings);
      const counts = readings.filter((r) => r?.ok);
      t.diagnostic(`${name}: ${counts.length} of ${FRAMES} frames counted, ${counts.filter((r) => r.shaded === r.covered).length} at 1 a covered pixel; covered pixels ${Math.min(...counts.map((r) => r.covered))} to ${Math.max(...counts.map((r) => r.covered))} of ${counts[0]?.pixels}`);
      found.push(...mine);
    }
    return found;
  });
  settle('criterion 2 of #3507 as first written', problems);
});
