// Criterion 2 of #3507 as the owner reworded it on 2026-11-26 (#3507.056af128): "On each class's fixture, where no
// bar hides another, the count is from 1 to 2 a covered pixel in every one of the 300 frames, and the report gives
// each fixture's count"
//
// The blind redraft of ../3507/ac2-classes.test.mjs, which holds the criterion as it was ("the count is 1 a covered
// pixel") and stays as written. What is drawn, and how, is that file's: each of the six budget classes' perf-lane
// fixtures, `benchmarks/canvas/<class>.json` as it stands, at its own size, under the perf lane's look
// (tests/acceptance/379/fixtures/look.json), as #3031 counted them: frame k at k ÷ 5 s, k from 0 to 299, the whole of
// the fixture's 60 s. Each frame is drawn by this checkout's `deep-show run` in the overdraw mode and its frame row
// read (../3507/README.md: The surface under test; `shaded` and `covered` beside `max`), through the first suite's
// driver and its reading of a row.
//
// Two clauses, one run. `rangeProblems` holds every frame: the mode's own count is 2 at most (a bar's front and back,
// depth ignored: no pixel holds two bars, so no bar hides another, which is the criterion's "where" and why 2 is the
// most a pixel can take), and the frame's fragments are from once to twice its covered pixels. `reportProblems` then
// holds the report, docs/evidence/3507/README.md, to this run: for each class one line "Shaded on `<class>`: <n.nnn>
// a covered pixel, <n.nnn> a pixel, over 300 frames" whose two numbers are the fixture's count as these 300 frames
// give it (the first suite's `countOf`), to three decimals. A frame where a bar does hide another is INCONCLUSIVE,
// never a pass; a frame not counted is BLOCKED, and so is a report's line for a fixture this run has no count of.
//
// The first class's first frame is read before anything else, so a build whose view gives no such count fails at
// once, on that.
// Run: node --test tests/acceptance/3507-redraft-ac2/ac2-classes.test.mjs
import test from 'node:test';
import { ALL_FRAMES, REPORT, classFixture, counted, listed, referenceMac, report, settle, showBinary, underLease } from '../3507/drive.mjs';
import { CLASSES, FRAMES, countOf } from '../3507/judge.mjs';
import { folded, rangeProblems, reportProblems } from './judge.mjs';

test('AC2 #3507.056af128 on each class\'s fixture, where no bar hides another, the count is from 1 to 2 a covered pixel in every one of the 300 frames, and the report gives each fixture\'s count', { timeout: 20 * 60_000 }, async (t) => {
  await referenceMac('the count');
  const bin = showBinary();
  const { found, counts } = await underLease('the count', async () => {
    const first = (await counted(bin, { ...classFixture(CLASSES[0]), frames: [0] })).get(0);
    settle('AC2 #3507.056af128', first.ok ? [] : [`${first.state}: ${CLASSES[0]}, frame 0: ${first.why}`]);
    const found = []; const counts = {};
    for (const name of CLASSES) {
      const readings = listed(await counted(bin, { ...classFixture(name), frames: ALL_FRAMES, processes: 2 }));
      found.push(...folded(name, rangeProblems(name, readings)));
      counts[name] = countOf(name, readings);
      const each = readings.filter((r) => r?.ok && r.covered > 0).map((r) => r.shaded / r.covered);
      t.diagnostic(`${name}: ${readings.filter((r) => r?.ok).length} of ${FRAMES} frames counted${each.length ? `, each from ${Math.min(...each).toFixed(4)} to ${Math.max(...each).toFixed(4)} a covered pixel` : ''}${counts[name].problems.length ? '' : `; the fixture's count is ${counts[name].aCoveredPixel.toFixed(4)} a covered pixel, ${counts[name].aPixel.toFixed(4)} a pixel, over ${counts[name].frames} frames`}`);
    }
    return { found, counts };
  });
  settle(`AC2 #3507.056af128 (the report is ${REPORT})`, [...found, ...reportProblems(report(), counts)], 60);
});
