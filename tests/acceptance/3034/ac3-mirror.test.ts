// #3034.f0c06eee: "Outside the cone a red ball 2 m below the surface shows mirrored in it, its centroid within 2 px of
// the mirrored point. A planted surface that shows the sky at every angle fails, naming the ball"
//
// The fixture (480 × 480, two documents): still, clear water (helpers.ts `CLEAR`) on the plate `lake`, 60 m × 60 m at
// y = 0, its material at roughness 0 so its mirror is sharp; a white sky with no ambient; a black unlit bed 10 m down;
// the ball `ball`, an unlit red sphere 0.6 m across whose centre is 2 m below the surface; the eye 2 m below the
// surface too, at the origin's x and z. The ball lies L m away along −Z, so it is level with the eye, and its mirror
// image in the surface, the mirrored point (helpers.ts `mirrorIn`), is 2 m above the surface over the ball: the eye
// sees it along a ray that climbs 4 m over L m and meets the surface at atan(L ÷ 4) off the vertical.
//
// - Outside the cone: L = 4 tan 60° = 6.93 m, so that ray meets the surface 60° off the vertical, 11° outside the
//   cone, and the whole of the ball's image (2.1° in radius at 8 m) lies outside it. The red pixels of the `linear`
//   target (red over 0.05 and over four times green and blue, as #166 reads its red post) must number at least half
//   the image's disk and their centroid must lie within 2 px of where the pinhole puts the mirrored point.
// - Inside the cone: L = 4 tan 30° = 2.31 m, so the ray meets the surface 30° off the vertical and the whole of the
//   image would lie inside the cone, where the surface shows what is above it: the white sky. No pixel may be red.
//   This holds the criterion's "outside the cone" against a surface that mirrors at every angle.
//
// In each document the camera (`fov: 30`) is aimed 0.5 m to the side of and 0.3 m above the mirrored point, so the
// point lands off the frame's centre and a mirror flipped or scaled about the centre misses it; the ball itself, level
// with the eye, is 30° and 60° below the view axis and out of the frame, so every red pixel is the mirror's. The
// image's centre lies under 0.2 px from the mirrored point (a sphere's outline off the axis is an ellipse).
//
// The planted surface (`--planted water_below_sky_at_every_angle`) shows what is above it at every angle and mirrors
// nothing: the same check must fail naming `ball`. Wrong programs: the merge base; a mirror about another plane than
// the water's at rest; a surface that mirrors at every angle; one that mirrors at none.
import { describe, expect, it } from 'vitest';
import {
  AC, CLEAR, type Cam, type Floats, type JsonObject, MIRROR_WITHIN_PX, type Planted, type V3, WHITE_SKY, ball, box, camItem, failsNaming, focal, frameAt,
  framesOf, look3d, mirrorIn, none, norm, offVerticalDeg, paint, plate, project, readLinear, requireMachine, runGpu, sceneDoc, sub, useGpu, useOut, view3d,
  waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 480];
const LOOK = look3d('mirror-3034');
const BALL = 'ball';
/** The ball's radius, and its centre's and the eye's depth below the surface (y = 0), in m. */
const RADIUS = 0.3;
const DEPTH = 2;
const EYE: V3 = [0, -DEPTH, 0];

/** One view: the ball `away` m from the eye along −Z, its mirrored point, and the camera aimed beside that point. */
interface View { name: string; centre: V3; point: V3; cam: Cam }
function viewAt(name: string, offVertical: number): View {
  const away = 2 * DEPTH * Math.tan((offVertical * Math.PI) / 180);
  const centre: V3 = [0, -DEPTH, -away];
  const point = mirrorIn(centre, 0);
  return { name, centre, point, cam: { position: EYE, target: [point[0] + 0.5, point[1] + 0.3, point[2]], fov: 30, size: SIZE } };
}
const OUTSIDE = viewAt('outside', 60);
const INSIDE = viewAt('inside', 30);

function mirrorDoc(v: View): JsonObject {
  return sceneDoc(`mirror-${v.name}`, SIZE, {
    cam: camItem(v.cam), sky: WHITE_SKY,
    'lake-water': waterMaterial(CLEAR, { roughness: 0 }),
    lake: plate([60, 60], [8, 8], [0, 0, 0], 'lake-water'),
    'bed-black': paint([0, 0, 0]),
    bed: box([200, 0.2, 200], [0, -10.1, 0], 'bed-black'),
    'ball-red': paint([1, 0, 0]),
    [BALL]: ball(2 * RADIUS, v.centre, 'ball-red'),
  });
}

/** The red pixels of a linear target: how many, and their centroid in frame coordinates. */
function red(t: Floats): { count: number; x: number; y: number } {
  let count = 0; let sx = 0; let sy = 0;
  for (let j = 0; j < t.height; j++) for (let i = 0; i < t.width; i++) {
    const o = (j * t.width + i) * 4;
    const [r, g, b] = [t.v[o]!, t.v[o + 1]!, t.v[o + 2]!];
    if (r > 0.05 && r > 4 * Math.max(g, b, 0)) { count++; sx += i + 0.5; sy += j + 0.5; }
  }
  return { count, x: sx / count, y: sy / count };
}

/** The criterion's reading of the two views: its failures, each naming the ball. */
function mirrorProblems(planted?: Planted): string[] {
  const dir = out();
  const call = (v: View): JsonObject => view3d({ doc: writeJson(dir, v.name, mirrorDoc(v)), look: LOOK, size: SIZE, frames: 1, fps: 30, capture: [0], targets: ['linear'] });
  const [outside, inside] = runGpu(bin(), dir, [call(OUTSIDE), call(INSIDE)], planted);
  const read = (reply: JsonObject, v: View) => red(readLinear(dir, frameAt(framesOf(reply, `the view ${v.name} the cone`), 0, v.name), SIZE, `the view ${v.name} the cone`));
  const failures: string[] = [];

  // Outside the cone: the ball shows mirrored, its centroid at the mirrored point.
  const [px, py] = project(OUTSIDE.cam, OUTSIDE.point);
  const seen = norm(sub(OUTSIDE.point, EYE));
  const disk = Math.PI * ((focal(OUTSIDE.cam) * RADIUS) / seen) ** 2;
  const o = read(outside!, OUTSIDE);
  console.log(`${AC[3]}: outside the cone (${offVerticalDeg(EYE, OUTSIDE.point).toFixed(1)}° off the vertical) ${o.count} red pixels, centroid (${o.x.toFixed(2)}, ${o.y.toFixed(2)}); the mirrored point lands at (${px.toFixed(2)}, ${py.toFixed(2)}), its image's disk is ${disk.toFixed(0)} px`);
  if (!(o.count >= disk / 2)) {
    failures.push(`the ball \`${BALL}\` 2 m below the surface doesn't show mirrored outside the cone: ${o.count} red pixels where its image covers ${disk.toFixed(0)}, about the mirrored point (${px.toFixed(1)}, ${py.toFixed(1)})`);
  } else {
    const off = Math.hypot(o.x - px, o.y - py);
    if (!(off <= MIRROR_WITHIN_PX)) failures.push(`the ball \`${BALL}\` shows mirrored with its centroid at (${o.x.toFixed(2)}, ${o.y.toFixed(2)}), ${off.toFixed(2)} px from the mirrored point (${px.toFixed(2)}, ${py.toFixed(2)}), not within ${MIRROR_WITHIN_PX} px`);
  }

  // Inside the cone: the surface shows the sky above it, not the ball below it.
  const i = read(inside!, INSIDE);
  console.log(`${AC[3]}: inside the cone (${offVerticalDeg(EYE, INSIDE.point).toFixed(1)}° off the vertical) ${i.count} red pixels`);
  if (i.count > 0) failures.push(`the ball \`${BALL}\` shows mirrored inside the cone, ${offVerticalDeg(EYE, INSIDE.point).toFixed(1)}° off the vertical, where the surface shows what is above it: ${i.count} red pixels about (${i.x.toFixed(1)}, ${i.y.toFixed(1)})`);
  return failures;
}

describe(`${AC[3]} from below, still water mirrors what is below it outside the cone`, () => {
  it(`${AC[3]} outside the cone a red ball 2 m below the surface shows mirrored in it, its centroid within 2 px of the mirrored point, and inside the cone it doesn't`, () => {
    requireMachine();
    // The fixture is what it says: one mirrored point outside the cone, one inside it, each inside its frame.
    expect(offVerticalDeg(EYE, OUTSIDE.point), 'the outside view\'s mirrored point is seen 60° off the vertical').toBeCloseTo(60, 6);
    expect(offVerticalDeg(EYE, INSIDE.point), 'the inside view\'s mirrored point is seen 30° off the vertical').toBeCloseTo(30, 6);
    for (const v of [OUTSIDE, INSIDE]) {
      const [x, y] = project(v.cam, v.point);
      expect(x > 60 && x < SIZE[0] - 60 && y > 60 && y < SIZE[1] - 60, `the ${v.name} view's mirrored point (${x.toFixed(1)}, ${y.toFixed(1)}) lies well inside the frame`).toBe(true);
    }
    none(mirrorProblems(), 'the ball mirrored outside the cone, at the mirrored point, and not inside it');
  });

  it(`${AC[3]} a planted surface that shows the sky at every angle (--planted water_below_sky_at_every_angle) fails, naming the ball`, () => {
    requireMachine();
    failsNaming(mirrorProblems('water_below_sky_at_every_angle'), [`ball \`${BALL}\``, 'doesn\'t show mirrored outside the cone'], 'water_below_sky_at_every_angle');
  });
});
