// AC6 #468.1d583371: With a 50 mm lens at f/2.8 on a 36 mm sensor, a 1920-wide frame and focus at 2 m, a one-pixel
// emissive point of linear radiance 50 at 10 m spreads into a disc 19.5 ± 1 px across and one at 4 m into a disc
// 12.2 ± 1 px across, each holding the point's summed linear energy within 2%; with blades 6 the 10 m disc is a hexagon
// whose centre-to-edge distance is cos 30° of its centre-to-corner distance within 1 px; a planted circle of confusion
// linear in |d − s|, matched at 10 m, draws the 4 m disc about 4.9 px across and fails, naming the point.
//
// Through `deep-gpu run`'s `view3d` (#378) with `targets: ["pre_tone"]` (#418: the linear image after the effects chain,
// before exposure and tone mapping, where the issue puts the gather). The fixture (README: Documents): a 1920 × 1280
// frame (3:2, so the 36 × 24 mm sensor's width spans the frame's 1920 px), a camera at the origin looking down −Z
// through `lens: {focal_length: 50, sensor: [36, 24], fit: wider}` with `aperture: {f_stop: 2.8, blades}`, a black sky,
// and two emissive balls of linear radiance 50, each half a pixel in radius at its depth (0.5 × d ÷ 2666.67 px per
// unit focal length) and centred on a pixel centre, so each covers exactly one pixel: `point_10m` at depth 10 m,
// projected to (560.5, 640.5), and `point_4m` at depth 4 m, projected to (1360.5, 640.5). An `effect@1` of kind dof
// focuses at 2 m. The same document without the effect is the in-focus reference.
//
// A disc is measured on the `pre_tone` luminance within 24 px of its point (helpers: `measureDisc`): its energy, its
// level (the mean within 0.4 of its second-moment radius), its width across as 2·√(A ÷ π) of the pixels at or above
// half that level, and its boundary along 360 rays. The hexagon: the six rays 60° apart that reach furthest give the
// centre-to-corner distance, the six between them the centre-to-edge distance (helpers: `polygonOf`).
//
// Wrong programs: the base (no lens, no dof effect: the document is refused); a gather after tone mapping or in
// display light (the energy check); a CoC from a thin-lens rule other than c = f²·|d − s| ÷ (N·d·(s − f)); round
// bokeh at blades 6; and the planted `coc_linear_in_distance`, whose 4 m disc is about 4.9 px across.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, ball, dof, emissive, failsNaming, frameAt, framesOf, lensCamera, measureDisc, none, polygonOf, readPreTone, requireMetal, runGpu, sceneDoc,
  useGpu, useOut, view3d, writeJson, type Disc, type JsonObject, type Planted, type Plane, type V3,
} from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1280];
/** The focal length in px: 1920 px across 36 mm, so 50 mm is 2666.67 px. */
const FOCAL_PX = (SIZE[0] * 50) / 36;
const RADIANCE = 50;
/** The issue's expected widths across, in px, and their tolerance; the hexagon's tolerance. */
const WANT = { point_10m: 19.5, point_4m: 12.2 } as const;
const ACROSS_TOL = 1;
const ENERGY_TOL = 0.02;
const HEX_TOL = 1;
const HALF = 24;

interface Point { id: keyof typeof WANT; depth: number; px: [number, number] }
const POINTS: Point[] = [
  { id: 'point_10m', depth: 10, px: [560.5, 640.5] },
  { id: 'point_4m', depth: 4, px: [1360.5, 640.5] },
];
/** The world point at `depth` along −Z that projects to frame point `px`. */
const worldAt = (p: Point): V3 => [((p.px[0] - SIZE[0] / 2) / FOCAL_PX) * p.depth, (-(p.px[1] - SIZE[1] / 2) / FOCAL_PX) * p.depth, -p.depth];

function bokehDoc(name: string, blades: number | null): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: lensCamera([0, 0, 0], [0, 0, -10], { focal_length: 50, sensor: [36, 24], fit: 'wider' }, { aperture: { f_stop: 2.8, blades: blades ?? 0 } }),
    sky: DARK_SKY, glow_mat: emissive(RADIANCE),
  };
  for (const p of POINTS) items[p.id] = ball((0.5 * p.depth) / FOCAL_PX, worldAt(p), 'glow_mat');
  if (blades !== null) items['fx'] = dof({ focus: 2, max_coc: 32 });
  return sceneDoc(name, SIZE, items, { transport: { span: '1s' } });
}

/** The in-focus reference, the blades 0 disc and, unless planted, the blades 6 disc: each frame's pre_tone luminance. */
function draw(planted?: Planted): Plane[] {
  const dir = out();
  const docs = [bokehDoc('bokeh-reference', null), bokehDoc('bokeh-round', 0), ...(planted ? [] : [bokehDoc('bokeh-hexagon', 6)])];
  const replies = runGpu(bin(), dir, docs.map((d, k) => view3d({ doc: writeJson(dir, `doc-${k}`, d), size: SIZE, capture: [0], targets: ['pre_tone'] })), planted);
  return replies.map((r, k) => readPreTone(dir, frameAt(framesOf(r, String(docs[k]!['id'])), 0, String(docs[k]!['id'])), SIZE, String(docs[k]!['id'])));
}

/** The criterion's discs on the round bokeh, each failure naming its point; the measures, printed. */
function discFailures(reference: Plane, round: Plane, label: string): { failures: string[]; discs: Map<string, Disc> } {
  const failures: string[] = [];
  const discs = new Map<string, Disc>();
  for (const p of POINTS) {
    const ref = measureDisc(reference, p.px, HALF);
    const d = measureDisc(round, p.px, HALF);
    discs.set(p.id, d);
    const share = (d.energy - ref.energy) / ref.energy;
    console.log(`${ID} ${label}: ${p.id} at ${p.depth} m: ${d.across.toFixed(2)} px across (want ${WANT[p.id]} ± ${ACROSS_TOL}); energy ${d.energy.toFixed(3)} against the in-focus ${ref.energy.toFixed(3)} (${(share * 100).toFixed(2)}%)`);
    if (!(Math.abs(d.across - WANT[p.id]) <= ACROSS_TOL)) failures.push(`${p.id}: its disc is ${d.across.toFixed(2)} px across, not ${WANT[p.id]} ± ${ACROSS_TOL}`);
    if (!(Math.abs(share) <= ENERGY_TOL)) failures.push(`${p.id}: its disc holds ${d.energy.toFixed(3)} of linear energy, ${(share * 100).toFixed(2)}% off the in-focus point's ${ref.energy.toFixed(3)} (within 2%)`);
  }
  return { failures, discs };
}

describe(`${ID} bokeh discs from the lens's physical circle of confusion`, () => {
  it(`${ID} the 10 m point spreads into a disc 19.5 ± 1 px across and the 4 m point 12.2 ± 1 px, each within 2% of its energy; at blades 6 the 10 m disc's centre-to-edge is cos 30° of its centre-to-corner within 1 px`, () => {
    requireMetal();
    const [reference, round, hexagon] = draw();
    // The fixture as the criterion states it: each point one pixel of linear radiance 50 in the in-focus frame.
    for (const p of POINTS) {
      const r = measureDisc(reference!, p.px, HALF);
      const pixel = reference!.v[Math.floor(p.px[1]) * SIZE[0] + Math.floor(p.px[0])]!;
      expect(Math.abs(pixel - RADIANCE) / RADIANCE, `${p.id} in focus is one pixel of linear radiance ${RADIANCE}: its pixel reads ${pixel}`).toBeLessThanOrEqual(0.05);
      expect(pixel / r.energy, `${p.id} in focus holds its energy in that one pixel (${pixel} of ${r.energy})`).toBeGreaterThanOrEqual(0.95);
    }
    const { failures } = discFailures(reference!, round!, 'blades 0');
    const hex = polygonOf(measureDisc(hexagon!, POINTS[0]!.px, HALF), 6);
    const want = Math.cos(Math.PI / 6) * hex.corner;
    console.log(`${ID} blades 6: point_10m centre-to-corner ${hex.corner.toFixed(2)} px, centre-to-edge ${hex.edge.toFixed(2)} px (cos 30° of the corner: ${want.toFixed(2)}), corners at ${hex.at}° + k·60°`);
    if (!(Math.abs(hex.edge - want) <= HEX_TOL)) failures.push(`point_10m at blades 6: centre-to-edge ${hex.edge.toFixed(2)} px is not cos 30° × ${hex.corner.toFixed(2)} = ${want.toFixed(2)} px within ${HEX_TOL} px`);
    none(failures, `${ID}: the bokeh discs`);
  });

  it(`${ID} the planted coc_linear_in_distance (a circle of confusion linear in |d − s|, matched at 10 m) draws the 4 m disc about 4.9 px across and fails, naming the point`, () => {
    requireMetal();
    const [reference, round] = draw('coc_linear_in_distance');
    const { failures, discs } = discFailures(reference!, round!, 'planted coc_linear_in_distance');
    console.log(`${ID} planted: the 4 m disc is ${discs.get('point_4m')!.across.toFixed(2)} px across (the planted rule gives 4.9)`);
    failsNaming(failures, ['point_4m'], 'the planted coc_linear_in_distance');
  });
});
