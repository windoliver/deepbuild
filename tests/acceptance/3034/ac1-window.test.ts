// #3034.e507438d: "A camera 5 m under still water looks straight up through a 120° lens at a white sky. The bright
// disk's edge lies 48.8° off the axis within 0.5°, read from the linear target. A planted surface with `ior` 1 has no
// edge and fails, naming the angle"
//
// The fixture (1024 × 1024): the water part `lake`, a plate 60 m × 60 m at y = 0 whose material carries still, clear
// water (helpers.ts `CLEAR`: no wave, ripple or rain, absorption depth 10 km and a black absorption color, so the sky
// keeps its own brightness through 5 m of it) and no `ior`, so the design's default 1.33 draws; a white sky with no
// ambient; a black unlit bed 10 m down, so what the surface mirrors outside the cone is black. The camera `cam` is 5 m
// under the surface, looking straight up (position (0, −5, 0), target (0, 0, 0)) through `fov: 120`. Its view axis is
// the vertical, so a pixel's angle off the axis is the angle its ray meets the still surface at.
//
// Read from the frame's `linear` target (#378: the 3D writer layers' linear target, f32 RGBA), by luminance. The
// disk's level is the mean of the 41 × 41 pixels at the frame's centre (within 5.6° of the axis); the level outside is
// the median, over 72 radial lines 5° apart, of each line's mean from 57° to 59.5° off the axis. Along each line the
// edge is the outermost point still a quarter of the way up from the outside level to the disk's (README: The disk's
// edge), found to a fraction of a pixel, and its angle is atan(r ÷ focal), focal = 512 ÷ tan 60° = 295.6 px, where one
// pixel is 0.08°. Every line's edge must lie 48.8° off the axis within 0.5°.
//
// The check fails, naming the angle, when there is no bright disk (the centre is dark), when the disk has no edge (57°
// off the axis the surface is over half as bright as at the centre, as under the planted surface, whose cone is the
// whole hemisphere), or when any line's edge lies elsewhere. Wrong programs: the merge base, which draws the surface
// from below by no rule; a cone of another angle; a cone about the view axis of a tilted camera rather than the
// vertical (the same here, held apart by criterion 3); `--planted water_below_ior_one`.
import { describe, it } from 'vitest';
import {
  AC, CLEAR, CONE_DEG, CONE_WITHIN_DEG, type Cam, type Floats, type JsonObject, type Planted, WHITE_SKY, box, camItem, failsNaming, frameAt, framesOf, look3d,
  lumAtPoint, mean, median, none, offAxisDeg, paint, patch, plate, radiusAtDeg, readLinear, requireMachine, runGpu, sceneDoc, useGpu, useOut, view3d,
  waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1024, 1024];
/** 5 m under the surface, straight up, a 120° lens. */
const CAM: Cam = { position: [0, -5, 0], target: [0, 0, 0], fov: 120, size: SIZE };
const LOOK = look3d('window-3034');
/** The radial lines: 72, 5° apart. */
const LINES = 72;
/** Where the outside level is read, in degrees off the axis: past the cone, inside the frame (its sides are 60° off). */
const OUTSIDE: [number, number] = [57, 59.5];

function windowDoc(): JsonObject {
  return sceneDoc('window', SIZE, {
    cam: camItem(CAM), sky: WHITE_SKY,
    'lake-water': waterMaterial(CLEAR, { roughness: 0 }),
    lake: plate([60, 60], [8, 8], [0, 0, 0], 'lake-water'),
    'bed-black': paint([0, 0, 0]),
    bed: box([200, 0.2, 200], [0, -10.1, 0], 'bed-black'),
  });
}

/** The criterion's reading of the frame's linear target: its failures, each naming the angle the edge must lie at. */
function edgeProblems(t: Floats): string[] {
  const want = `${CONE_DEG}° off the axis within ${CONE_WITHIN_DEG}°`;
  const [cx, cy] = [SIZE[0] / 2, SIZE[1] / 2];
  const disk = patch(t, cx, cy, 20);
  const step = 0.25; const [r0, r1] = [radiusAtDeg(CAM, OUTSIDE[0]), radiusAtDeg(CAM, OUTSIDE[1])];
  const along = (k: number, r: number): number => { const a = (2 * Math.PI * k) / LINES; return lumAtPoint(t, cx + r * Math.cos(a), cy + r * Math.sin(a)); };
  const outside = median(Array.from({ length: LINES }, (_, k) => { const xs: number[] = []; for (let r = r0; r <= r1; r += step) xs.push(along(k, r)); return mean(xs); }));
  console.log(`${AC[1]}: the disk's centre reads ${disk.toFixed(4)}, the surface ${OUTSIDE[0]}° to ${OUTSIDE[1]}° off the axis ${outside.toFixed(4)}`);
  if (!(disk > 0.05)) return [`there is no bright disk: the surface straight above reads ${disk.toFixed(4)} in the linear target; its edge must lie ${want}`];
  if (!(disk - outside >= 0.5 * disk)) return [`the bright disk has no edge: ${OUTSIDE[0]}° to ${OUTSIDE[1]}° off the axis the surface reads ${outside.toFixed(4)}, at its centre ${disk.toFixed(4)}; its edge must lie ${want}`];
  const level = outside + 0.25 * (disk - outside);
  const failures: string[] = []; const edges: number[] = [];
  for (let k = 0; k < LINES; k++) {
    const azimuth = (360 * k) / LINES;
    let r = r1; let outer = along(k, r);
    if (outer >= level) { failures.push(`the bright disk has no edge along the line at ${azimuth}°: it is bright out to ${OUTSIDE[1]}° off the axis; its edge must lie ${want}`); continue; }
    let found: number | null = null;
    while (r > step) {
      const inner = along(k, r - step);
      if (inner >= level) { found = r - step + (step * (inner - level)) / (inner - outer); break; }
      r -= step; outer = inner;
    }
    if (found === null) { failures.push(`the bright disk has no edge along the line at ${azimuth}°: it is dark in to the axis; its edge must lie ${want}`); continue; }
    const a = (2 * Math.PI * k) / LINES;
    const angle = offAxisDeg(CAM, cx + found * Math.cos(a), cy + found * Math.sin(a));
    edges.push(angle);
    if (!(Math.abs(angle - CONE_DEG) <= CONE_WITHIN_DEG)) failures.push(`the bright disk's edge along the line at ${azimuth}° lies ${angle.toFixed(2)}° off the axis, not ${want}`);
  }
  if (edges.length) console.log(`${AC[1]}: the disk's edge on ${edges.length} of ${LINES} lines lies ${Math.min(...edges).toFixed(2)}° to ${Math.max(...edges).toFixed(2)}° off the axis (mean ${mean(edges).toFixed(2)}°)`);
  return failures;
}

/** The camera 5 m under still water, drawn, and its linear target read. */
function windowProblems(planted?: Planted): string[] {
  const dir = out();
  const what = 'the camera under still water, looking straight up';
  const [reply] = runGpu(bin(), dir, [view3d({ doc: writeJson(dir, 'window', windowDoc()), look: LOOK, size: SIZE, frames: 1, fps: 30, capture: [0], targets: ['linear'] })], planted);
  return edgeProblems(readLinear(dir, frameAt(framesOf(reply!, what), 0, what), SIZE, what));
}

describe(`${AC[1]} from below, still water shows the sky inside a cone of 48.8° about the vertical`, () => {
  it(`${AC[1]} a camera 5 m under still water, looking straight up through a 120° lens at a white sky, reads a bright disk in the linear target whose edge lies 48.8° off the axis within 0.5°`, () => {
    requireMachine();
    none(windowProblems(), `the bright disk's edge lies ${CONE_DEG}° off the axis within ${CONE_WITHIN_DEG}° on every line`);
  });

  it(`${AC[1]} a planted surface with ior 1 (--planted water_below_ior_one) has no edge and fails, naming the angle`, () => {
    requireMachine();
    failsNaming(windowProblems('water_below_ior_one'), ['has no edge', `${CONE_DEG}°`], 'water_below_ior_one');
  });
});
