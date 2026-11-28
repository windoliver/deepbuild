// Criterion 2 of #3506 (#3506.0dcb130c): "The listing holds one 4-sample depth for each view and one resolved image
// for motion blur and depth of field. A planted renderer that keeps a depth of the occluders' own fails, naming the
// target"
//
// The listing is #3031's (`spike-3031 frames`, README: The surface under test): what the device holds after the
// every-pass fixture's 300 frames on Metal, each texture with its label, size, sample count and pixel format. Its two
// views are the view, at the fixture's 3456 × 2234, and its mirror's view, at half that. `oneDepthProblems` holds each
// to one texture of 4 samples in a depth format, and the view, where motion blur and depth of field are both on, to
// one texture under the labels a resolved image of either goes by (`scene3d resolved`, the one they share, or either
// of the merge base's, `scene3d.motion resolved` and `scene3d.dof resolved`); the mirror's view, which runs depth of
// field alone, to at most one. The second test builds the same reader with the renderer's planted
// `occluders_own_depth` set (README: The planted programs) and runs the same check on its listing, which must fail
// naming `scene3d occluders' depth`.
// Run: node --test tests/acceptance/3506/ac2-one-depth.test.mjs
import test from 'node:test';
import { EVERY_PASS, allow, listing, reader, referenceMac, settle } from './drive.mjs';
import { AC, FRAMES, listingProblems, oneDepthProblems, plantedDepthProblems } from './judge.mjs';

/** The planted renderer criterion 2 names (README: The planted programs). */
const OWN_DEPTH = 'occluders_own_depth';
// Both tests' runs together: two of 300 frames at 3456 × 2234, and a build of the planted reader.
allow(110);

test(`AC2 ${AC[2]} the listing holds one 4-sample depth for each view and one resolved image for motion blur and depth of field`, { timeout: 120 * 60_000 }, async (t) => {
  await referenceMac('the listing');
  const { listing: listed } = await listing(reader(), FRAMES);
  settle(`AC2 ${AC[2]}`, listingProblems('the change', listed, EVERY_PASS.size, FRAMES));
  t.diagnostic(`${listed.resources.length} resources, ${listed.allocated} B on the device`);
  settle(`AC2 ${AC[2]}`, oneDepthProblems(listed, EVERY_PASS.size));
});

test(`AC2 ${AC[2]} a planted renderer that keeps a depth of the occluders' own fails the same check, naming the target`, { timeout: 120 * 60_000 }, async (t) => {
  await referenceMac('the listing');
  const { listing: listed } = await listing(reader(undefined, OWN_DEPTH), FRAMES);
  settle(`AC2 ${AC[2]} (planted ${OWN_DEPTH})`, listingProblems(`planted ${OWN_DEPTH}`, listed, EVERY_PASS.size, FRAMES));
  t.diagnostic(`planted ${OWN_DEPTH}: the check finds ${oneDepthProblems(listed, EVERY_PASS.size).join('; ') || 'nothing'}`);
  settle(`AC2 ${AC[2]} (planted ${OWN_DEPTH})`, plantedDepthProblems(listed, EVERY_PASS.size));
});
