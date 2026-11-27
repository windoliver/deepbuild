// Criterion 1 of #3507 (#3507.f9beb02c): "On a fixture of two walls that face the camera, one wholly behind the other,
// the count is 1 a covered pixel with the nearer drawn first and 2 with the farther drawn first. A planted count that
// leaves the depth test out reads 2 both ways and fails, naming the order"
//
// The fixture is two documents, fixtures/two-walls.nearer-first.json and two-walls.farther-first.json: two boxes of
// 4 m × 3 m × 0.2 m, both of one opaque material that isn't double-sided (so the pass culls their back faces), facing
// an orthographic camera that looks along −Z at their middle, one at z = 1 m and one at z = −1 m, 8 m across a frame
// of 320 × 240 px. Both walls cover the same 160 × 120 pixels. They are one set of the geometry pass (one shape, one
// material), which draws a set's solids in the layer's order, the items' `order` keys: the documents differ only in
// which wall has the earlier key (and in the words that say so).
//
// Each document is shown once to this checkout's `deep-show run` and its frame at 0 s is read in the overdraw mode,
// as #427's suite reads the mode. The frame row's `shaded` and `covered` (README: The surface under test) give the
// count: `wallProblems` holds it to 1 and to 2 a covered pixel, over exactly the walls' 19,200 pixels. The second test
// runs the same documents and the same check on the planted count, the scenario's `planted:
// "shaded_count_skips_depth_test"`: it must read 2 both ways, and the check must fail it on the nearer drawn first
// and on nothing else.
// Run: node --test tests/acceptance/3507/ac1-two-walls.test.mjs
import test from 'node:test';
import { NO_DEPTH_TEST, counted, referenceMac, settle, showBinary, underLease, walls } from './drive.mjs';
import { ORDERS, plantedWallProblems, wallProblems } from './judge.mjs';

/** Each order's reading of its document's frame at 0 s, under `planted` or the shipped view. */
async function read(bin, planted) {
  const readings = {};
  for (const [order, fixture] of Object.entries(walls())) readings[order] = (await counted(bin, { ...fixture, frames: [0], planted })).get(0);
  return readings;
}
const shown = (readings) => Object.keys(ORDERS).map((order) => { const r = readings[order]; return r?.ok ? `${order}: ${r.shaded} fragments over ${r.covered} covered pixels of ${r.pixels}, the mode's own count at most ${r.max}` : `${order}: ${r?.state}`; }).join('; ');

test('AC1 #3507.f9beb02c on two walls that face the camera, one wholly behind the other, the count is 1 a covered pixel with the nearer drawn first and 2 with the farther drawn first', { timeout: 20 * 60_000 }, async (t) => {
  await referenceMac('the count');
  const bin = showBinary();
  const readings = await underLease('the count', () => read(bin, null));
  t.diagnostic(shown(readings));
  settle('AC1 #3507.f9beb02c', wallProblems(readings));
});

test('AC1 #3507.f9beb02c a planted count that leaves the depth test out reads 2 both ways and fails the same check, naming the order', { timeout: 20 * 60_000 }, async (t) => {
  await referenceMac('the count');
  const bin = showBinary();
  const readings = await underLease('the planted count', () => read(bin, NO_DEPTH_TEST));
  t.diagnostic(`planted ${NO_DEPTH_TEST}: ${shown(readings)}`);
  settle('AC1 #3507.f9beb02c', plantedWallProblems(readings));
  t.diagnostic(`the check fails it: ${wallProblems(readings).join('; ')}`);
});
