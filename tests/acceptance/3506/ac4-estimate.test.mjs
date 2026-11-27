// Criterion 4 of #3506 (#3506.39b8e6ca): "The check's estimate for the fixture falls by the occluders' depth it
// counted: 16 bytes a pixel of the view, and of its mirror's view. A planted estimate that still counts it fails,
// naming the bytes"
//
// The check's estimate is `deep_scene3d_render::held::of`, which #3031's reader asks for the fixture's last frame and
// writes beside its listing as `estimate: {per_px, fixed}` (README: The surface under test). Its bytes at the
// fixture's 3456 × 2234 are per_px × 3456 × 2234 + fixed. Read with the reader built against the merge base's crates
// and against this checkout's, from one frame (the estimate is the scene's, whatever the frame), it must fall by
// exactly 16 B a pixel of the view's 3456 × 2234 and of its mirror's view's 1728 × 1117: 154,414,080 B
// (`estimateProblems`). The second test reads the estimate under the planted `estimate_counts_occluders_depth`
// (README: The planted programs) and must fail the same check, naming the bytes.
// Run: DEEP_3506_BASE=<checkout of the merge base> node --test tests/acceptance/3506/ac4-estimate.test.mjs
import test from 'node:test';
import { EVERY_PASS, allow, listing, mergeBase, reader, referenceMac, settle } from './drive.mjs';
import { AC, estimateBytes, estimateProblems, listingProblems, plantedEstimateProblems } from './judge.mjs';

/** The planted estimate criterion 4 names (README: The planted programs). */
const COUNTS_IT = 'estimate_counts_occluders_depth';
/** One frame: the estimate is of the scene, which every frame of the fixture holds the same targets for. */
const ONE = 1;
// Both tests' runs together: up to four reader builds (one against the merge base's crates) and four frames.
allow(110);

async function estimate(r, name) {
  const { listing: listed } = await listing(r, ONE);
  settle(`AC4 ${AC[4]}`, listingProblems(name, listed, EVERY_PASS.size, ONE));
  return listed.estimate;
}
const shown = (e) => `${Math.round(estimateBytes(e, EVERY_PASS.size))} B (per_px ${e.per_px}, fixed ${e.fixed})`;

test(`AC4 ${AC[4]} the check's estimate for the fixture falls by the occluders' depth it counted: 16 bytes a pixel of the view and of its mirror's view`, { timeout: 120 * 60_000 }, async (t) => {
  await referenceMac('the estimate beside the listing');
  const base = mergeBase();
  const before = await estimate(reader(base.path), 'the merge base');
  const after = await estimate(reader(), 'the change');
  t.diagnostic(`the merge base (${base.commit.slice(0, 9)}): ${shown(before)}; the change: ${shown(after)}`);
  settle(`AC4 ${AC[4]}`, estimateProblems(before, after, EVERY_PASS.size));
});

test(`AC4 ${AC[4]} a planted estimate that still counts the occluders' depth fails the same check, naming the bytes`, { timeout: 120 * 60_000 }, async (t) => {
  await referenceMac('the estimate beside the listing');
  const planted = await estimate(reader(undefined, COUNTS_IT), `planted ${COUNTS_IT}`);
  const base = mergeBase();
  const before = await estimate(reader(base.path), 'the merge base');
  t.diagnostic(`the merge base: ${shown(before)}; planted ${COUNTS_IT}: ${shown(planted)}; the check finds ${estimateProblems(before, planted, EVERY_PASS.size).join('; ') || 'nothing'}`);
  settle(`AC4 ${AC[4]} (planted ${COUNTS_IT})`, plantedEstimateProblems(before, planted, EVERY_PASS.size));
});
