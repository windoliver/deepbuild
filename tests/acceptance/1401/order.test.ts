// AC3 #1401.a6573e7a: Through a glass pane over a box, one probe returns two hits, pane first, and two coplanar faces at
// equal distance return the same order on 100 runs.
//
// The fixture: one shared document, stored at revision 0 in test agent alpha's layer, over a black sky with no ground;
// `cam` 12 m up and 4 m back, looking at the origin (fov 50°, 320 × 240 px). Left of centre, `pane`: a glass pane, a
// `mark.box@1` 3 × 1/32 × 3 m centred at (−2.5, 2, 0), its material unlit, double-sided, `alpha_mode: blend` at alpha
// 0.3; under it `box`, an opaque `mark.box@1` 1.5 × 1 × 1.5 m whose top face is y = 1. Right of centre, two opaque boxes
// whose top faces are one square, y = 2 over x 1.75 to 3.25 and z −0.75 to 0.75, the same four corners to the bit:
// `tie.b`, 2 m tall from the ground up, and `tie.a`, 1 m tall from y = 1. `tie.b` comes first in the document, so its
// `order` key is the lower: ties by ID put `tie.a` first, ties by order key, document order or draw order put `tie.b`
// first, and ties left to a map's order differ between runs.
//
// 8 probes: 4 through the pane onto the box's top face, each ray meeting the pane's top and then the box's top, and
// nothing else; 4 onto the shared top face, each ray meeting both tie boxes at one distance, and nothing else (all
// checked here in f64). 100 runs: 10 `deep-show run` processes, each with 10 render-backs by alpha at t = 0 of revision
// 0 from the document's camera, all with the 8 probes. On every run each pane probe answers exactly two hits, `pane`
// then `box`, and each tie probe exactly two, `tie.a` then `tie.b`, every point within 1e-5 m of the analytic hit and
// every `distance` within 1e-5 m of the analytic distance; each tie probe's order is the same on all 100 runs.
import { describe, expect, it } from 'vitest';
import {
  AC3, DARK_SKY, boxHits, boxItem, cameraItem, glass, hitLists, listFailures, pixelOf, probeRay, proof, renderBack, requireMetal, runShow, scenario,
  sceneDoc, shown, slot, unlit, useDir, useShow, type Box, type JsonValue, type Pinhole, type Pixel, type Want,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const BOUND = 1e-5;
const PROCESSES = 10;
const CALLS = 10;
const CAM: Pinhole = { position: [0, 12, 4], target: [0, 0, 0], fov: 50, size: SIZE };
const PANE: Box = { id: 'pane', centre: [-2.5, 2, 0], size: [3, 1 / 32, 3] };
const BOX: Box = { id: 'box', centre: [-2.5, 0.5, 0], size: [1.5, 1, 1.5] };
const TIE_B: Box = { id: 'tie.b', centre: [2.5, 1, 0], size: [1.5, 2, 1.5] };
const TIE_A: Box = { id: 'tie.a', centre: [2.5, 1.5, 0], size: [1.5, 1, 1.5] };
const BOXES = [PANE, BOX, TIE_B, TIE_A];

const DOCUMENT = sceneDoc('A glass pane over a box, and two boxes sharing a top face', 'cam', {
  cam: cameraItem(CAM.position, CAM.target, CAM.fov, 0.5, 100), sky: DARK_SKY,
  glass_mat: glass(), box_mat: unlit([0.8, 0.35, 0.1]), tie_b_mat: unlit([0.1, 0.4, 0.8]), tie_a_mat: unlit([0.2, 0.7, 0.3]),
  pane: boxItem(PANE.centre, PANE.size, 'glass_mat'), box: boxItem(BOX.centre, BOX.size, 'box_mat'),
  'tie.b': boxItem(TIE_B.centre, TIE_B.size, 'tie_b_mat'), 'tie.a': boxItem(TIE_A.centre, TIE_A.size, 'tie_a_mat'),
});

interface Probe { px: Pixel; label: string; tie: boolean; want: Want[] }
const CORNERS: [number, number][] = [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]];
function fixture(): Probe[] {
  const at = (x: number, y: number, z: number, tie: boolean, what: string): Probe => {
    const px = pixelOf(CAM, [x, y, z]);
    return { px, tie, label: `${what} at (${x}, ${y}, ${z}), pixel (${px[0]}, ${px[1]})`, want: boxHits(CAM.position, probeRay(CAM, px), BOXES) };
  };
  return [
    ...CORNERS.map(([dx, dz]) => at(-2.5 + dx, 1, dz, false, 'through the pane onto the box')),
    ...CORNERS.map(([dx, dz]) => at(2.5 + dx, 2, dz, true, 'onto the shared top face')),
  ];
}
const PROBES = fixture();

describe(`${AC3} hits nearest first, ties by ID`, () => {
  it(`${AC3} through a glass pane over a box, one probe returns two hits, pane first, and two coplanar faces at equal distance return the same order on 100 runs`, () => {
    requireMetal();
    // The fixture: each pane probe meets the pane, then the box, and nothing else; each tie probe meets both tie boxes
    // at exactly one distance, and nothing else.
    for (const p of PROBES) {
      expect(p.want.map((w) => w.item), `the fixture: ${p.label} meets exactly these items`).toEqual(p.tie ? ['tie.a', 'tie.b'] : ['pane', 'box']);
      if (p.tie) expect(p.want[0]!.t, `the fixture: ${p.label} meets both tie boxes at one distance`).toBe(p.want[1]!.t);
    }
    expect(new Set(PROBES.map((p) => p.px.join(','))).size, 'the fixture: no pixel probed twice').toBe(PROBES.length);

    const failures: string[] = [];
    const orders = PROBES.map(() => new Map<string, number>());
    for (let run = 0; run < PROCESSES; run++) {
      const calls = Array.from({ length: CALLS }, (_, i) => renderBack(slot(i), { t: 0, rev: 0, probes: PROBES.map((p) => p.px) }));
      const replies = runShow(bin(), scenario(dir(), DOCUMENT, calls), `glass and ties, process ${run + 1} of ${PROCESSES}`);
      replies.forEach((reply, i) => {
        const n = run * CALLS + i + 1;
        const lists: JsonValue[][] = hitLists(reply, PROBES.length, `run ${n}: render-back`);
        PROBES.forEach((p, k) => {
          const got = lists[k]!;
          const items = shown(got.map((h) => (h !== null && typeof h === 'object' && !Array.isArray(h) ? h['item'] ?? null : null)));
          orders[k]!.set(items, (orders[k]!.get(items) ?? 0) + 1);
          failures.push(...listFailures(`run ${n}, ${p.label}`, got, p.want, BOUND, true));
        });
        if (n === 1) proof('AC3 the first run\'s hits', lists.map((l, k) => ({ probe: PROBES[k]!.px, hits: l })));
      });
    }
    proof('AC3 each probe\'s item orders over 100 runs', PROBES.map((p, k) => ({ probe: p.px, orders: Object.fromEntries(orders[k]!) })));
    expect(failures.length, `on every run each pane probe answers pane then box and each tie probe tie.a then tie.b, at the analytic points and distances; ${failures.length} failures:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(0);
    for (const [k, p] of PROBES.entries()) expect([...orders[k]!.keys()], `${p.label}: one order of hits on all ${PROCESSES * CALLS} runs`).toHaveLength(1);
  }, 3_600_000);
});
