// #3034.b073da51: "A white card 3 m from the eye in water of `depth` 3 m reads 0.368 of its value in air within 2%,
// and at 6 m 0.135. A planted tint that uses the card's depth below the surface in place of the distance seen reads
// the same at both and fails, naming the card"
//
// The fixture (400 × 400): the camera `cam` 2 m under the water's surface at rest (y = 0), looking level along −Z
// through `fov: 40`; the card `card`, an unlit box 2.4 m × 2.4 m × 2 cm facing the camera on its view axis, whose
// near face a channel holds 3 m from the eye at 0 s and 6 m at 1 s (frames 0 and 30 at 30 fps); the water part `lake`,
// a plate 60 m × 60 m at y = 0 whose material carries still water with `absorption: {depth: 3}` and the design's
// default absorption color; a white sky with no ambient. The card stays 2 m below the surface at both distances, so
// the distance seen changes and its depth below the surface doesn't.
//
// "Its value in air" is the same document with no water part and no water material. The share is read as #166's tint
// test reads the bed's, so that the rest, the absorption color and whatever light it takes, cancels: the card drawn
// white and drawn black, in water (w) and in air (a), each frame's `linear` luminance averaged over the 21 × 21 pixels
// at the frame's centre (all within 1.5° of the axis, where the distance seen is the card's within 0.04%):
// share = (w_white − w_black) ÷ (a_white − a_black). It must be 0.368 at 3 m and 0.135 at 6 m, each within 2% of
// itself (the scope's exp(−d ÷ depth): exp(−1) and exp(−2)).
//
// Guarded: in air the white card reads over 0.1 brighter than the black one, at both distances, so a program that
// draws no card fails. The planted tint (`--planted water_below_tint_by_depth`) takes the share over the card's depth
// below the surface, 2 m at both distances, so it reads exp(−2 ÷ 3) = 0.513 at both: the same check must fail naming
// `card`, and the plant's two shares must agree within 2%. Wrong programs: the merge base, where nothing dims a
// surface seen under water; a share by depth along the view axis measured to somewhere else, by a linear ramp, or by
// the card's depth below the surface.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, type JsonObject, type Planted, SHARE_AT, SHARE_WITHIN, STILL, type V3, WHITE_SKY, box, camItem, channel, failsNaming, frameAt, framesOf,
  look3d, none, paint, patch, plate, readLinear, requireMachine, runGpu, sceneDoc, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [400, 400];
/** 2 m under the surface, looking level along −Z. */
const CAM: Cam = { position: [0, -2, 0], target: [0, -2, -10], fov: 40, size: SIZE };
const LOOK = look3d('card-3034');
const CARD = 'card';
const THICK = 0.02;
/** The card's near face from the eye, in m, at each frame read. */
const AT: [3 | 6, number][] = [[3, 0], [6, 30]];
/** The card's centre along z when its near face is `d` m from the eye. */
const centreAt = (d: number): number => -d - THICK / 2;

function cardDoc(water: boolean, rgb: V3): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camItem(CAM), sky: WHITE_SKY,
    'card-paint': paint(rgb),
    [CARD]: box([2.4, 2.4, THICK], [0, -2, centreAt(3)], 'card-paint'),
  };
  if (water) {
    items['lake-water'] = waterMaterial({ ...STILL, absorption: { depth: 3 } }, { roughness: 0 });
    items['lake'] = plate([60, 60], [8, 8], [0, 0, 0], 'lake-water');
  }
  return sceneDoc(`card-${water ? 'water' : 'air'}-${rgb[0]}`, SIZE, items, {
    transport: { span: '2s' }, channels: { away: channel(`items/${CARD}/at/pos/2`, AT.map(([d], k): [number, number] => [k, centreAt(d)])) },
  });
}

/** The card's share of its value in air at 3 m and at 6 m, and the criterion's reading of them: its failures, each
 * naming the card. */
function cardProblems(planted?: Planted): { failures: string[]; shares: number[] } {
  const dir = out();
  const sides: [boolean, V3][] = [[true, [1, 1, 1]], [true, [0, 0, 0]], [false, [1, 1, 1]], [false, [0, 0, 0]]];
  const label = (k: number): string => `the ${sides[k]![1][0] ? 'white' : 'black'} card in ${sides[k]![0] ? 'water' : 'air'}`;
  const replies = runGpu(bin(), dir, sides.map(([w, c], k) => view3d({
    doc: writeJson(dir, `side-${k}`, cardDoc(w, c)), look: LOOK, size: SIZE, frames: 31, fps: 30, capture: AT.map(([, n]) => n), targets: ['linear'],
  })), planted);
  const centre = (k: number, n: number): number => patch(readLinear(dir, frameAt(framesOf(replies[k]!, label(k)), n, label(k)), SIZE, `${label(k)}, frame ${n}`), SIZE[0] / 2, SIZE[1] / 2, 10);
  const failures: string[] = []; const shares: number[] = [];
  for (const [d, n] of AT) {
    const [ww, wb, aw, ab] = sides.map((_, k) => centre(k, n));
    expect(aw! - ab!, `at ${d} m the card is drawn: in air the white card reads brighter than the black one`).toBeGreaterThan(0.1);
    const share = (ww! - wb!) / (aw! - ab!);
    const want = SHARE_AT[d];
    shares.push(share);
    console.log(`${AC[2]}: the card ${d} m from the eye reads ${share.toFixed(5)} of its value in air; the issue's ${want} (in air white ${aw!.toFixed(4)}, black ${ab!.toFixed(4)}; in water white ${ww!.toFixed(4)}, black ${wb!.toFixed(4)})`);
    if (!(Math.abs(share - want) <= SHARE_WITHIN * want)) failures.push(`the card \`${CARD}\` ${d} m from the eye in water of depth 3 m reads ${share.toFixed(5)} of its value in air, not ${want} within ${SHARE_WITHIN * 100}%`);
  }
  return { failures, shares };
}

describe(`${AC[2]} under water a surface keeps exp(−d ÷ depth) of its own color over the distance from the eye`, () => {
  it(`${AC[2]} a white card 3 m from the eye in water of depth 3 m reads 0.368 of its value in air within 2%, and at 6 m 0.135`, () => {
    requireMachine();
    none(cardProblems().failures, 'the card\'s share of its value in air at 3 m and at 6 m');
  });

  it(`${AC[2]} a planted tint that uses the card's depth below the surface in place of the distance seen (--planted water_below_tint_by_depth) reads the same at both and fails, naming the card`, () => {
    requireMachine();
    const { failures, shares } = cardProblems('water_below_tint_by_depth');
    failsNaming(failures, [`card \`${CARD}\``], 'water_below_tint_by_depth');
    const [near, far] = shares as [number, number];
    expect(Math.abs(near - far), `the planted tint reads the same at 3 m (${near.toFixed(5)}) and at 6 m (${far.toFixed(5)})`).toBeLessThanOrEqual(SHARE_WITHIN * near);
  });
});
