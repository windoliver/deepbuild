// AC6: "An eye inset keeps true parallax: a 1 × 1 m inset with `view.map: eye` on a wall at z = 0 facing +z, with
// `include` holding a sphere 0.1 m in radius at (0, 0, −3) m behind the wall, draws the sphere's centre at the main
// camera's projection of (0, 0, −3) within 1 px from cameras at (0, 0, 4), (1, 0.5, 4) and (−0.8, −0.4, 3) aimed at
// the origin, and its pixels match a frame with a 1 × 1 m hole cut in the wall within 2 code values on 99.9% of the
// window's pixels on one machine; with `through` an anchor at (10, 0, 0) turned 90° about y, a sphere placed in the same
// relation to that anchor draws at the same pixels; an `eye` inset that also names a camera is refused at check, naming
// the inset; and a planted eye inset with a centred frustum from the same eye draws the sphere away from its projection
// from the two off-axis cameras and fails, naming the pixel"
//
// The fixture (helpers.ts: eyeDoc): a 20 × 20 m wall, 2 mm thick, its front face the plane z = 0, unlit white, with the
// 1 × 1 m eye inset `portal` on its anchor `window` (1,024 px a metre); behind it, in the collection `beyond`, an unlit
// red ball 0.1 m in radius at (0, 0, −3) and an unlit grey backdrop at z = −6, under a black sky; 1280 × 960 px, fov 40°.
// The hole's twin cuts the window out of the wall and has no inset. The through twin puts the ball at (7, 0, 0) and the
// backdrop at x = 4, turned 90° about +Y, in the same relation to the anchor `exit#out` at (10, 0, 0) turned 90° about
// +Y as the first to the window, and names it in `through`.
//
// The reference: the window's corners and the point (0, 0, −3) projected through each camera, worked out here; the
// ball's centre read as its redness-weighted centroid inside the window. Window pixels are those whose centres lie at
// least 1 px inside the projected window.
//
// asserts, through `view3d`, for each of the three cameras in one run on this machine:
//   - the inset frame draws the ball's centre within 1 px of the projection of (0, 0, −3) (and so does the hole's
//     frame, which checks the fixture);
//   - the inset frame's window pixels equal the hole frame's within 2 code values on at least 99.9% of them;
//   - the through frame draws the ball's centre within 1 px of the same point, and its window pixels equal the inset
//     frame's within 2 code values on at least 99.9% of them;
//   - an eye inset that also names `camera` is refused at check, the refusal naming `portal`;
//   - under `--planted eye_inset_centred_frustum`, from (1, 0.5, 4) and (−0.8, −0.4, 3), the ball's centre is more than
//     1 px from its projection, and each failure names the pixel it drew at and the pixel it should.
// Wrong programs: the base (no inset kind); a frustum centred on the eye; a view rendered from the camera's own pose
// and pasted on the face; an eye left where it is when `through` names an anchor.
import { describe, expect, it } from 'vitest';
import {
  EYE, EYE_CAMERAS, TIMEOUT, ac, codeOff, eyeCam, eyeDoc, eyeWindow, finalOf, fmt, frameAt, framesOf, look, none, px, quadInside, redCentroid,
  refusedNaming, requireGpu, rgbText, runGpu, toScreen, useBins, useDir, view3d, writeJson, type Image, type V3,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const camText = (p: V3): string => `(${p.join(', ')})`;

/** The ball's centre through the camera at `position`: drawn within 1 px of the projection of (0, 0, −3), or a failure naming both pixels. */
function centreFailures(im: Image, position: V3, what: string): string[] {
  const cam = eyeCam(position);
  const q = eyeWindow(cam);
  const want = toScreen(cam, EYE.ball);
  const c = redCentroid(im, (x, y) => quadInside(q, x + 0.5, y + 0.5).inside);
  if (!(c.weight >= 200)) return [`${what}, camera ${camText(position)}: the window shows no ball (red weight ${fmt(c.weight)}); it should centre on pixel (${fmt(want.x)}, ${fmt(want.y)})`];
  const off = Math.hypot(c.x - want.x, c.y - want.y);
  return off > 1 ? [`${what}, camera ${camText(position)}: the ball's centre draws at pixel (${fmt(c.x)}, ${fmt(c.y)}), ${fmt(off)} px from the main camera's projection of (0, 0, -3), pixel (${fmt(want.x)}, ${fmt(want.y)})`] : [];
}
/** Window pixels of `a` and `b` within 2 codes on at least 99.9% of them, or a failure naming the first that isn't. */
function matchFailures(a: Image, b: Image, position: V3, what: string): string[] {
  const q = eyeWindow(eyeCam(position));
  let judged = 0; let bad = 0; let first = '';
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const { inside, edge } = quadInside(q, x + 0.5, y + 0.5);
    if (!inside || edge < 1) continue;
    judged++;
    if (codeOff(px(a, x, y), px(b, x, y)) > 2) { bad++; if (!first) first = `(${x}, ${y}) reads ${rgbText(px(a, x, y))} against ${rgbText(px(b, x, y))}`; }
  }
  if (judged < 50_000) return [`${what}, camera ${camText(position)}: the window covers only ${judged} pixels (the fixture puts it across far more)`];
  return bad > 0.001 * judged ? [`${what}, camera ${camText(position)}: ${bad} of ${judged} window pixels (${fmt((100 * bad) / judged, 3)}%) are off by more than 2 code values; first ${first}`] : [];
}

describe(`${ac(6)} an eye inset keeps true parallax`, () => {
  it(`${ac(6)} from three cameras the eye inset centres the sphere on its projection within 1 px, matches a hole cut in the wall within 2 codes on 99.9% of the window, does the same through an anchor turned 90°, and an eye inset naming a camera is refused`, () => {
    requireGpu();
    const out = dir();
    const call = (position: V3, variant: 'inset' | 'hole' | 'through' | 'named') =>
      view3d({ doc: writeJson(out, `eye-${variant}-${EYE_CAMERAS.indexOf(position)}`, eyeDoc(position, variant)), look: look(), size: EYE.size });
    const calls = EYE_CAMERAS.flatMap((p) => [call(p, 'inset'), call(p, 'hole'), call(p, 'through')]);
    calls.push(call(EYE_CAMERAS[0]!, 'named'));
    const replies = runGpu(bin('deep-gpu'), out, calls);
    refusedNaming(replies[replies.length - 1]!, ['portal'], 'an eye inset that also names a camera');
    const failures: string[] = [];
    EYE_CAMERAS.forEach((p, k) => {
      const image = (i: number, what: string): Image => finalOf(out, frameAt(framesOf(replies[3 * k + i]!, what), 0, what), what);
      const inset = image(0, 'the eye inset'); const hole = image(1, 'the hole'); const through = image(2, 'the eye inset through the anchor');
      expect(centreFailures(hole, p, 'the fixture: the hole cut in the wall'), `the fixture: through the hole the ball centres on its projection from ${camText(p)}`).toEqual([]);
      failures.push(...centreFailures(inset, p, 'the eye inset'));
      failures.push(...matchFailures(inset, hole, p, 'the eye inset against the hole'));
      failures.push(...centreFailures(through, p, 'the eye inset through the anchor at (10, 0, 0)'));
      failures.push(...matchFailures(through, inset, p, 'the eye inset through the anchor against the eye inset'));
    });
    none(failures, 'the eye inset keeps true parallax');
  }, TIMEOUT);

  it(`${ac(6)} the planted eye inset with a centred frustum from the same eye draws the sphere away from its projection from the two off-axis cameras and fails, naming the pixel`, () => {
    requireGpu();
    const out = dir();
    const offAxis = EYE_CAMERAS.slice(1);
    const replies = runGpu(bin('deep-gpu'), out, offAxis.map((p, k) => view3d({ doc: writeJson(out, `eye-planted-${k}`, eyeDoc(p, 'inset')), look: look(), size: EYE.size })), 'eye_inset_centred_frustum');
    const failures = offAxis.flatMap((p, k) => centreFailures(finalOf(out, frameAt(framesOf(replies[k]!, 'the planted eye inset'), 0, 'the planted eye inset'), 'the planted eye inset'), p, 'the planted eye inset'));
    for (const p of offAxis) {
      expect(failures.some((f) => f.includes(`camera ${camText(p)}`)), `the planted centred frustum fails from ${camText(p)}; the failures: ${failures.join(' | ')}`).toBe(true);
    }
    for (const f of failures) expect(f, 'each failure names the pixel the ball drew at').toMatch(/pixel \(\d+\.\d+, \d+\.\d+\)/);
  }, TIMEOUT);
});
