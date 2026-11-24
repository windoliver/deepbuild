// AC2 #290.8310b458: A torus behind a wall, overlapping itself, shows only its nearest surface: where its two layers
// overlap, the color is one layer's blend; a planted pass without its own depth pass stacks two layers and fails,
// naming the pixel
//
// The fixture is helpers.ts's torus behind a wall: a `lathe@1` on a closed outline lying flat, seen from about 12°
// above its plane, so in a band across its middle its near tube stands before its far tube; the wall covers it from
// its left end to x = 0.4 m, and nothing casts. One process draws three frames with `view3d`: the torus with
// `hidden_view: {opacity: 0.4}` behind the wall; the wall alone; the torus alone.
//
// Judged pixels (helpers.ts, `torusOverlap`): where the two layers overlap under the wall, found by rays in f64 over
// the triangles the lathe builds (#424's reference composite) and never from a picture: the ray through the pixel's
// centre and those ±0.5 px around it cross the torus's surface four times (into and out of the near tube, then the
// far one), at every pixel within 2 px, and the nine rays 1.5 px around the pixel all meet the wall: 2,566 pixels.
// The renderer's own object-ID targets must agree there.
//
// One layer's blend: the final code is within 1 of 255 · encode(0.6 · W + 0.4 · T) in each channel, W the wall alone
// and T the torus alone at that pixel, whose opaque draw shows its nearest surface there, both from the same
// renderer's linear target (README: Readings). Two stacked layers read 0.36 · W + 0.24 · one layer + 0.4 · the other:
// the second layer takes a quarter of the wall's share, and the wall is far bluer than the torus, so the band's blue
// falls by several codes.
//
// Wrong programs it fails: the merge base (no hidden view: every judged pixel reads the wall alone); `--planted
// hidden_view_without_own_depth` (the blended draw with no depth pass of the item's own triangles before it, so
// every one of its faces a nearer surface hides blends), which fails naming the band's pixels.
import { describe, expect, it } from 'vitest';
import { requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import {
  AC, OPACITY, SIZE, TIMEOUT, blendFailures, count, finalOf, gpu, idsOf, linearOf, refusals, shotsOf, standsApart, strays, torusDoc, torusOverlap, view3d,
  type GpuPlanted, type Judged,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const MIN = 2_000;
const LABELS = ['the torus behind the wall at opacity 0.4', 'the wall alone', 'the torus alone'];

/** The three frames and the band's judgement; `blocked` holds what kept the frames from being drawn or the fixture from holding. */
function judge(out: string, planted?: GpuPlanted): { blocked: string[]; band: number; under: Judged | null } {
  const run = gpu(bin(), out, [
    view3d({ doc: writeJson(out, 'hidden', torusDoc('torus-hidden', { hidden: { opacity: OPACITY } })), size: SIZE, targets: ['final'] }),
    view3d({ doc: writeJson(out, 'wall', torusDoc('torus-wall', { torus: false })), size: SIZE, targets: ['linear', 'ids'] }),
    view3d({ doc: writeJson(out, 'alone', torusDoc('torus-alone', { wall: false })), size: SIZE, targets: ['linear', 'ids'] }),
  ], planted);
  const refused = refusals(run, LABELS);
  if (refused.length) return { blocked: refused, band: 0, under: null };
  const [hidden, wall, alone] = run.replies.map((r, i) => shotsOf(r, LABELS[i]!)[0]!);
  const band = torusOverlap();
  const w = linearOf(out, wall!, SIZE, LABELS[1]!);
  const t = linearOf(out, alone!, SIZE, LABELS[2]!);
  const blocked = [
    ...strays(band, idsOf(out, wall!, LABELS[1]!), 'wall', 'the wall alone'),
    ...strays(band, idsOf(out, alone!, LABELS[2]!), 'torus', 'the torus alone'),
  ];
  if (count(band) < MIN) blocked.push(`the fixture: only ${count(band)} pixels where the torus's two layers overlap under the wall, fewer than ${MIN}`);
  const apart = standsApart(w, t, band, OPACITY);
  if (apart !== count(band)) blocked.push(`the fixture: the blend stands more than 2 codes from the wall alone on only ${apart} of ${count(band)} judged pixels`);
  return { blocked, band: count(band), under: blendFailures(finalOf(out, hidden!, LABELS[0]!), w, t, band, OPACITY, 'torus') };
}

describe(`${AC[2]} a torus behind a wall, overlapping itself, shows only its nearest surface`, () => {
  it(`${AC[2]} where the torus's two layers overlap behind the wall, the color is one layer's blend: the wall's color blended toward the torus's nearest surface at 0.4 within 1/255`, () => {
    requireMetal();
    const { blocked, under } = judge(dir());
    expect(blocked, 'view3d draws the three frames, and the fixture holds').toEqual([]);
    expect(under!.failures, `where the two layers overlap, ${under!.failing} of ${under!.judged} pixels aren't one layer's blend`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} a planted pass without its own depth pass stacks two layers and fails, naming the pixel`, () => {
    requireMetal();
    const { blocked, under } = judge(dir(), 'hidden_view_without_own_depth');
    expect(blocked, '--planted hidden_view_without_own_depth draws the three frames, and the fixture holds').toEqual([]);
    expect(under!.failing, `the planted pass fails the check where the two layers overlap (${under!.judged} pixels judged)`).toBeGreaterThan(0);
    expect(under!.failures.filter((f) => !/^pixel \(\d+, \d+\) /.test(f)), 'every failure names its pixel').toEqual([]);
    console.log(`${AC[2]} --planted hidden_view_without_own_depth: ${under!.failing} of ${under!.judged} pixels fail; first: ${under!.failures[0]}`);
  }, TIMEOUT);
});
