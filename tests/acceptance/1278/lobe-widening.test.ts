// AC2 #1278.2d35ce9a: The specular lobe keeps #422's pixel-footprint widening: a curved smooth solid's lobe still
// widens by the normal's change across the pixel.
//
// What the widening is for (scene3d.wgsl's direct(), #422): a lobe under a pixel wide is point-sampled at pixel
// centers, so a mirror's sun loses light between them, or gains it when a center lands on the peak. So the fixture is
// the smoothest curved solid there is: a white mirror ball (base color 1, metallic 1, roughness 0, `ball@1` with 256
// segments), alone under one sun of 1 lx behind the camera, seen from 6 m on +Z (fov 30°, 320 × 320 px, the linear
// target with tone map none at scale 1). The document has no `sky@1` (README: Notes on the base); the sun's light is
// read as the render with the sun at 1 lx minus the same render with it at 0 lx, so the background and whatever
// ambient light the default gives cancel. Two balls, each in its own document: radius 1 (about 100 px in radius, its
// normal turning about 0.01 rad a pixel at the center) and radius 0.125 (about 12 px, 0.08 rad a pixel): eight times
// the normal's change across the pixel. The sun is tilted so the highlight lands at three sub-pixel phases, 0, 0.25
// and 0.5 px off the pixel corner at the image's center along both axes (a tilt of (2d ÷ R + 1) × phase ÷ focal rad
// about X and about Y, to first order).
//
// Test 1, the highlight's energy holds at every sub-pixel phase: for each ball, the sun's image Σ (sun on − sun off)
// linear × each pixel's solid angle over the frame is the same at the three phases within 2% (largest ÷ smallest);
// and on the big ball, whose widened lobe is still far under a degree, it equals the mirror sphere's
// E × R² ÷ (2d − R)² within 2% at each phase (#422's AC8 judges that at one phase, within 1%; the tilts change it by
// under 1e-4). The small ball's widened lobe (about 6°) is too wide for the mirror's limit, so only its phases are
// compared. With the lobe widened to the pixel's footprint the sum is a fine Riemann sum of the lobe at any phase;
// without it, the lobe (α = 0.045², a fifth of a pixel on the big ball, a fortieth on the small) is point-sampled,
// and the sum swings by a large factor with the phase.
// Test 2, the widening follows the normal's change per pixel: at the 0.5 phase (the highlight on a pixel center),
// the brightest pixel holds between 2% and 50% of the sun's image on each ball (the lobe spans more than half a pixel
// and less than about three), and the two balls' shares agree within a factor of 1.5, although one ball's normal
// turns eight times faster per pixel: a widening by the normal's change across the pixel looks the same in pixels.
// Wrong programs: a lobe with no widening (`dn` forced to 0: Test 1 fails at every phase, Test 2 finds over half
// the image in one pixel); a widening by a fixed angle, not by the pixel's footprint (whatever angle it is, either the
// small ball's sum swings with phase or the big ball's highlight spreads over many pixels and the shares disagree);
// a widening that reads the normal's change in the wrong units (pixels squared off by a large factor).
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, focalOf, framesOf, frameAt, lum, material, none, pixelSolidAngle, readLinear, requireMetal, runGpu, sessionDoc, sun,
  useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [320, 320];
const D = 6;
const CAM: Pinhole = { position: [0, 0, D], target: [0, 0, 0], fov: 30, size: SIZE };
const LUX = 1;
const RADII = [1, 0.125] as const;
const PHASES = [0, 0.25, 0.5] as const;

/** The sun's tilt, in degrees about X and Y, that moves the highlight by `phase` px on a ball of radius `r`. */
const tilt = (r: number, phase: number): number => ((((2 * D) / r + 1) * phase) / focalOf(CAM)) * (180 / Math.PI);
function mirrorDoc(r: number, phase: number, lux: number): JsonObject {
  const t = Number(tilt(r, phase).toFixed(6));
  const rot: V3 = [t, t, 0];
  return sessionDoc(`mirror-r${r}-p${phase}-${lux}lx`, SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: CAM.position, target: CAM.target, fov: CAM.fov, near: 0.1, far: 100 } },
    mirror: material({ base_color: [1, 1, 1, 1], metallic: 1, roughness: 0 }),
    ball: { kind: 'ball@1', params: { radius: r, segments: 256 }, at: { pos: [0, 0, 0] }, material: 'mirror' },
    sun: sun(lux, rot),
  });
}

interface Highlight { r: number; phase: number; sum: number; want: number; peak: number; at: [number, number] }
/** Each ball at each phase, with the sun on and off, drawn once in one process: the sun's image Σ L·Ω and its
 * brightest pixel's share. */
function highlights(bin: string, out: string): Highlight[] {
  const cases = RADII.flatMap((r) => PHASES.map((phase) => ({ r, phase })));
  const calls = cases.flatMap(({ r, phase }, i) => [LUX, 0].map((lux) =>
    view3dCall({ doc: writeJson(out, `mirror-${i}-${lux}`, mirrorDoc(r, phase, lux)), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['linear'] })));
  const replies = runGpu(bin, out, calls);
  return cases.map(({ r, phase }, i) => {
    const what = `ball r ${r}, phase ${phase}`;
    const [on, off] = [0, 1].map((k) => {
      const w = `${what}, sun ${k === 0 ? 'on' : 'off'}`;
      return readLinear(out, frameAt(framesOf(replies[2 * i + k]!, w), 0, w).linear, SIZE, `${w}: linear`);
    });
    let sum = 0; let peak = 0; let at: [number, number] = [0, 0];
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const e = (lum(on!.at(x, y)) - lum(off!.at(x, y))) * pixelSolidAngle(CAM, x, y);
      sum += e;
      if (e > peak) { peak = e; at = [x, y]; }
    }
    const want = (LUX * r * r) / (2 * D - r) ** 2;
    const h = { r, phase, sum, want, peak: sum > 0 ? peak / sum : 0, at };
    console.log(`${AC[2]}: ${what}: the sun's image ${sum.toExponential(5)} against ${want.toExponential(5)} (${((sum / want - 1) * 100).toFixed(2)}%), brightest pixel (${at[0]}, ${at[1]}) holds ${(h.peak * 100).toFixed(1)}%`);
    return h;
  });
}

describe(`${AC[2]} a curved smooth solid's lobe widens by the normal's change across the pixel`, () => {
  it(`${AC[2]} a mirror ball's sun image keeps its energy at sub-pixel phases 0, 0.25 and 0.5 px: the same within 2% on balls 100 px and 12 px in radius, and E·R²/(2d − R)² within 2% on the big one`, () => {
    requireMetal();
    const hs = highlights(bin(), dir());
    const problems: string[] = [];
    for (const r of RADII) {
      const mine = hs.filter((h) => h.r === r);
      const sums = mine.map((h) => h.sum);
      const spread = Math.max(...sums) / Math.min(...sums) - 1;
      if (!(Math.min(...sums) > 0) || spread > 0.02) problems.push(`ball r ${r}: the sun's image is ${mine.map((h) => `${h.sum.toExponential(4)} at phase ${h.phase}`).join(', ')}: it moves by ${(spread * 100).toFixed(1)}% with the sub-pixel phase (over 2%): the lobe is point-sampled, narrower than the pixel's footprint`);
    }
    for (const h of hs.filter((x) => x.r === 1)) {
      if (Math.abs(h.sum - h.want) > 0.02 * h.want) problems.push(`ball r 1, phase ${h.phase}: the sun's image is ${h.sum.toExponential(4)}, ${((h.sum / h.want - 1) * 100).toFixed(1)}% off E·R²/(2d − R)² = ${h.want.toExponential(4)} (over 2%)`);
    }
    none(problems, 'the mirror balls under the sun');
  }, 1_800_000);

  it(`${AC[2]} with the highlight on a pixel center its brightest pixel holds 2% to 50% of it on both balls, and the two shares agree within 1.5× though one normal turns 8× faster a pixel`, () => {
    requireMetal();
    const hs = highlights(bin(), dir()).filter((h) => h.phase === 0.5);
    expect(hs.length, 'both balls at the 0.5 phase').toBe(2);
    const problems: string[] = [];
    for (const h of hs) {
      if (h.peak > 0.5) problems.push(`ball r ${h.r}: the brightest pixel (${h.at.join(', ')}) holds ${(h.peak * 100).toFixed(1)}% of the sun's image (over 50%): the lobe is under a pixel wide`);
      if (h.peak < 0.02) problems.push(`ball r ${h.r}: the brightest pixel (${h.at.join(', ')}) holds ${(h.peak * 100).toFixed(2)}% of the sun's image (under 2%): the lobe is widened over many pixels, past the pixel's footprint`);
    }
    const [big, small] = [hs.find((h) => h.r === 1)!, hs.find((h) => h.r === 0.125)!];
    const ratio = small.peak / big.peak;
    console.log(`${AC[2]}: brightest-pixel share, small ÷ big ball: ${ratio.toFixed(3)}`);
    if (!(ratio >= 1 / 1.5 && ratio <= 1.5)) problems.push(`the brightest pixel's share is ${(small.peak * 100).toFixed(1)}% on the small ball and ${(big.peak * 100).toFixed(1)}% on the big one (ratio ${ratio.toFixed(2)}, outside 1 ÷ 1.5 to 1.5): the widening doesn't follow the normal's change across the pixel`);
    none(problems, 'the highlight on a pixel center');
  }, 1_800_000);
});
