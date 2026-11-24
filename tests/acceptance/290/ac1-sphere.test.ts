// AC1 #290.052fe5e4: A sphere behind a wall at opacity 0.4: pixels where the wall covers the sphere equal the wall's
// color blended toward the sphere's shaded color at 0.4 within 1/255, and pixels where the sphere shows directly are
// byte for byte as without the hidden view; a planted pass that also draws where the sphere is visible fails, naming
// the pixel
//
// The fixture is helpers.ts's sphere behind a wall: the wall covers the sphere's left half and leaves its right half
// in plain sight, nothing casts, so the wall alone and the sphere alone are lit as they are together. One process
// draws five frames with `view3d`: the sphere with `hidden_view: {opacity: 0.4, color: "base"}`; the same document
// with no `hidden_view`; the wall alone; the sphere alone; and the hidden view tinted, `color: "sand"` (a role of the
// look, far from the sphere's blue).
//
// Judged pixels, found by rays in f64 through #378's pinhole and never from a picture (helpers.ts, `sphereRegions`):
// "where the wall covers the sphere" is every pixel whose centre and the eight points 1.5 px around it all meet the
// wall and then the sphere behind it (10,178 pixels); "where the sphere shows directly" is every pixel where all nine
// meet the sphere and none the wall (10,016). So each judged pixel lies a whole pixel inside its region, off every
// edge the multisampled pass mixes. The renderer's own object-ID targets must agree with the rays there.
//
// Under the wall, the final code of the frame with the hidden view is within 1 of 255 · encode(0.6 · W + 0.4 · S) in
// each channel: W the wall alone and S the sphere alone at that pixel, both read from the same renderer's linear
// target, the blend taken in linear light and judged on the final target (README: Readings). Where the sphere shows
// directly the final bytes are those of the frame with no hidden view, for `color: "base"` and for `color: "sand"`.
// The tinted hidden view must show under the wall in another color than the untinted one, so that a pass drawn over
// the visible sphere would change it: at `color: "base"` such a pass blends the sphere's shading over itself and
// changes nothing, which is why the planted twin is judged on the tinted frame.
//
// Wrong programs it fails: the merge base (`view3d` draws the item with no hidden view: every pixel under the wall
// reads the wall alone); a hidden view at another opacity, in a flat color, or blended after tone mapping; `--planted
// hidden_view_draws_where_visible` (the blended draw without its test against the frame's depth), which changes the
// tinted frame where the sphere shows directly and fails naming those pixels.
import { describe, expect, it } from 'vitest';
import { requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import {
  AC, OPACITY, SIZE, TIMEOUT, blendFailures, changed, count, finalOf, gpu, idsOf, linearOf, refusals, sameFailures, shotsOf, sphereDoc, sphereRegions, standsApart, strays, view3d,
  type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
/** Fewer judged pixels than this in either region and the test proves nothing. */
const MIN = 5_000;
const frame = (out: string, name: string, doc: JsonObject, targets: ('final' | 'linear' | 'ids')[]): JsonObject => view3d({ doc: writeJson(out, name, doc), size: SIZE, targets });
const tinted = (out: string): JsonObject => frame(out, 'tinted', sphereDoc('sphere-tinted', { hidden: { opacity: OPACITY, color: 'sand' } }), ['final']);
const plain = (out: string): JsonObject => frame(out, 'plain', sphereDoc('sphere-plain'), ['final', 'ids']);

describe(`${AC[1]} a sphere behind a wall at opacity 0.4`, () => {
  it(`${AC[1]} pixels where the wall covers the sphere equal the wall's color blended toward the sphere's shaded color at 0.4 within 1/255, and pixels where the sphere shows directly are byte for byte as without the hidden view`, () => {
    requireMetal();
    const out = dir();
    const labels = ['the sphere behind the wall at opacity 0.4', 'the same with no hidden view', 'the wall alone', 'the sphere alone', 'the hidden view tinted toward sand'];
    const run = gpu(bin(), out, [
      frame(out, 'hidden', sphereDoc('sphere-hidden', { hidden: { opacity: OPACITY, color: 'base' } }), ['final']),
      plain(out),
      frame(out, 'wall', sphereDoc('sphere-wall', { sphere: false }), ['linear', 'ids']),
      frame(out, 'alone', sphereDoc('sphere-alone', { wall: false }), ['linear', 'ids']),
      tinted(out),
    ]);
    expect(refusals(run, labels), 'view3d draws the five frames').toEqual([]);
    const [hidden, bare, wall, alone, tint] = run.replies.map((r, i) => shotsOf(r, labels[i]!)[0]!);

    // The fixture: enough pixels in each region, the renderer's ID targets agree with the rays, and the blend asked
    // for stands apart from the wall alone on every judged pixel.
    const regions = sphereRegions();
    expect([count(regions.hidden) >= MIN, count(regions.shown) >= MIN], `the fixture: ${count(regions.hidden)} pixels where the wall covers the sphere and ${count(regions.shown)} where it shows directly, each at least ${MIN}`).toEqual([true, true]);
    expect([
      ...strays(regions.hidden, idsOf(out, wall!, labels[2]!), 'wall', 'the wall alone'),
      ...strays(regions.hidden, idsOf(out, alone!, labels[3]!), 'sphere', 'the sphere alone'),
      ...strays(regions.shown, idsOf(out, bare!, labels[1]!), 'sphere', 'the sphere beside the wall'),
    ], 'the fixture: the object-ID targets show the wall and the sphere where the rays put them').toEqual([]);
    const w = linearOf(out, wall!, SIZE, labels[2]!);
    const s = linearOf(out, alone!, SIZE, labels[3]!);
    expect(standsApart(w, s, regions.hidden, OPACITY), 'the fixture: on every judged pixel the blend stands more than 2 codes from the wall alone').toBe(count(regions.hidden));

    const got = finalOf(out, hidden!, labels[0]!);
    const under = blendFailures(got, w, s, regions.hidden, OPACITY, 'sphere');
    expect(under.failures, `where the wall covers the sphere, ${under.failing} of ${under.judged} pixels aren't the wall's color blended toward the sphere's shaded color at 0.4 within 1/255`).toEqual([]);

    const without = finalOf(out, bare!, labels[1]!);
    const open = sameFailures(got, without, regions.shown, 'as without the hidden view');
    expect(open.failures, `where the sphere shows directly, ${open.failing} of ${open.judged} pixels aren't byte for byte as without the hidden view`).toEqual([]);

    // The tinted hidden view: another color under the wall, and still nothing where the sphere shows.
    const toned = finalOf(out, tint!, labels[4]!);
    const moved = changed(toned, got, regions.hidden);
    expect(moved, `the hidden view tinted toward sand shows under the wall in another color than at color base: ${moved} of ${count(regions.hidden)} pixels differ by more than 2 codes, at least half must`).toBeGreaterThanOrEqual(count(regions.hidden) / 2);
    const openTinted = sameFailures(toned, without, regions.shown, 'as without the hidden view');
    expect(openTinted.failures, `tinted, where the sphere shows directly, ${openTinted.failing} of ${openTinted.judged} pixels aren't byte for byte as without the hidden view`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} a planted pass that also draws where the sphere is visible fails, naming the pixel`, () => {
    requireMetal();
    const out = dir();
    const labels = ['the hidden view tinted toward sand', 'the same with no hidden view'];
    const run = gpu(bin(), out, [tinted(out), plain(out)], 'hidden_view_draws_where_visible');
    expect(refusals(run, labels), '--planted hidden_view_draws_where_visible draws the two frames').toEqual([]);
    const [tint, bare] = run.replies.map((r, i) => shotsOf(r, labels[i]!)[0]!);
    const regions = sphereRegions();
    const open = sameFailures(finalOf(out, tint!, labels[0]!), finalOf(out, bare!, labels[1]!), regions.shown, 'as without the hidden view');
    expect(open.failing, `the planted pass fails the check where the sphere shows directly (${open.judged} pixels judged)`).toBeGreaterThan(0);
    expect(open.failures.filter((f) => !/^pixel \(\d+, \d+\) /.test(f)), 'every failure names its pixel').toEqual([]);
    console.log(`${AC[1]} --planted hidden_view_draws_where_visible: ${open.failing} of ${open.judged} pixels fail; first: ${open.failures[0]}`);
  }, TIMEOUT);
});
