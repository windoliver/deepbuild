// AC5 #424.b9bc25e9: Additive surfaces need no order among themselves: two overlapping unlit beams with alpha_mode add,
// linear base colors [0.5, 0.5, 1] and [1, 0.5, 0.5] at alpha 0.5, over a dark floor lit by a sun at 45° elevation,
// read on the linear target where they overlap the floor plus [0.75, 0.5, 0.75] within 1% on one machine, at each of
// 36 orbit poses, whichever beam is nearer; a wall in front hides both; under shadow: auto the floor where their
// shadows would fall keeps its sunlit value within 1%; and a planted add that writes depth drops the farther beam where
// the nearer one drew first, and one drawn without the depth test shows through the wall, each failing, naming the
// pixel.
//
// The fixture (`beamsDoc`, helpers): two 0.5 × 2.4 × 5 m boxes standing on a dark floor (base color 0.05), turned ±30°
// about +Y so they cross in an X: inside the overlap, which beam is nearer changes from pixel to pixel at every pose,
// so any fixed order draws the nearer first somewhere. The sun, at 45° elevation, casts, with π√2 lx. The camera
// orbits [0, 0.8, 0] at 8 m and 35° of elevation, every 10° of azimuth: 36 poses, each drawn with the beams (A) and
// without them (F), linear and ID targets, in one process. Overlap pixels are found by ray: the rays through the
// pixel's centre and ±1 px in x and y all pass through both boxes and then meet the floor, which F's ID target shows
// there. At each such pixel A − F is [0.75, 0.5, 0.75] within 1% of F + [0.75, 0.5, 0.75], per channel; at least 100
// such pixels at each pose. No floor pixel of F reads more than 1% darker in A (beams only add light and cast none).
// That the shadow check can see a shadow: the same beams opaque at the first pose darken at least 300 floor pixels by
// 10%. The wall: a 7 × 4 m wall at z = 3.3 m between the first pose and the beams; on its pixels whose rays then pass
// through both beams (at least 200), the frame with the beams equals the frame without them within 1% (plus 0.001).
// `--planted add_writes_depth` fails the overlap check at some pose and `--planted add_skips_depth_test` fails the wall
// check, every failure naming its pixel.
import { describe, expect, it } from 'vitest';
import {
  AC, BEAMS, BEAMS_SIZE, add, beamsCam, beamsDoc, failsNamingPixels, hitBox, lum, only, rayAt, readIds, readLinear, runGpu, scale,
  requireMetal, useDir, useGpu, view3dCall, within, writeJson, type GpuPlanted, type Ids, type JsonObject, type Linear, type Pinhole,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const POSES = Array.from({ length: 36 }, (_, k) => 10 * k);
const [W, H] = BEAMS_SIZE;

/** Whether the ray through frame point (sx, sy) passes through both beams, both before `limit` (the floor or a wall). */
function throughBoth(cam: Pinhole, sx: number, sy: number, wall: boolean): boolean {
  const d = rayAt(cam, sx, sy);
  if (d[1] >= 0) return false;
  const tFloor = -cam.position[1] / d[1];
  const p = add(cam.position, scale(d, tFloor));
  if (Math.abs(p[0]) > BEAMS.floor - 0.5 || Math.abs(p[2]) > BEAMS.floor - 0.5) return false;
  const tWall = wall ? hitBox(cam.position, d, BEAMS.wall.centre, BEAMS.wall.size) : null;
  if (wall && !tWall) return false;
  return BEAMS.yaw.every((yaw) => { const h = hitBox(cam.position, d, BEAMS.centre, BEAMS.size, yaw); return h !== null && h[0] < tFloor && (!tWall || h[0] > tWall[1]); });
}
const robust = (cam: Pinhole, x: number, y: number, wall: boolean): boolean =>
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => throughBoth(cam, x + 0.5 + dx!, y + 0.5 + dy!, wall));

interface Drawn { lin: Linear; ids: Ids }
function draw(out: string, docs: JsonObject[], planted?: GpuPlanted): Drawn[] {
  const replies = runGpu(bin(), out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `beams-${i}`, d), size: BEAMS_SIZE, targets: ['linear', 'ids'] })), planted);
  return replies.map((r, i) => { const f = only(r, `render ${i}`); return { lin: readLinear(out, f, BEAMS_SIZE, `render ${i}`), ids: readIds(out, f, `render ${i}`) }; });
}
/** The 36 poses' overlap and shadow checks; each failure names its pixel. */
function orbitProblems(out: string, planted?: GpuPlanted): string[] {
  const drawn = draw(out, POSES.flatMap((az) => [beamsDoc(az, { beams: 'add', wall: false }), beamsDoc(az, { beams: 'none', wall: false })]), planted);
  const problems: string[] = [];
  POSES.forEach((az, k) => {
    const a = drawn[2 * k]!; const f = drawn[2 * k + 1]!; const cam = beamsCam(az);
    let overlap = 0; let off = 0; let firstOff = ''; let darker = 0; let firstDark = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (f.ids.at(x, y) !== 'floor') continue;
      const av = a.lin.at(x, y); const fv = f.lin.at(x, y);
      if (lum(av) < 0.99 * lum(fv) && !firstDark) firstDark = `(${x}, ${y}) reads ${lum(av).toFixed(5)}, sunlit ${lum(fv).toFixed(5)}`;
      if (lum(av) < 0.99 * lum(fv)) darker++;
      if (!within(f.ids, x, y, 'floor', 1) || !robust(cam, x, y, false)) continue;
      overlap++;
      const bad = [0, 1, 2].some((c) => Math.abs(av[c]! - fv[c]! - BEAMS.sum[c]!) > 0.01 * (fv[c]! + BEAMS.sum[c]!));
      if (bad) { off++; if (!firstOff) firstOff = `(${x}, ${y}) adds [${[0, 1, 2].map((c) => (av[c]! - fv[c]!).toFixed(4)).join(', ')}]`; }
    }
    if (overlap < 100) problems.push(`azimuth ${az}°: only ${overlap} pixels see both beams over the floor (the fixture)`);
    if (off) problems.push(`azimuth ${az}°: ${off} of ${overlap} overlap pixels don't add [0.75, 0.5, 0.75] to the floor within 1%; first at pixel ${firstOff}`);
    if (darker) problems.push(`azimuth ${az}°: ${darker} floor pixels read over 1% darker than sunlit (the beams cast); first at pixel ${firstDark}`);
  });
  return problems;
}
/** The wall at the first pose hides both beams; each failure names its pixel. */
function wallProblems(out: string, planted?: GpuPlanted): string[] {
  const [aw, w] = draw(out, [beamsDoc(0, { beams: 'add', wall: true }), beamsDoc(0, { beams: 'none', wall: true })], planted);
  const cam = beamsCam(0); let n = 0; let off = 0; let first = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!within(w!.ids, x, y, 'wall', 1) || !robust(cam, x, y, true)) continue;
    n++;
    const av = aw!.lin.at(x, y); const wv = w!.lin.at(x, y);
    if ([0, 1, 2].some((c) => Math.abs(av[c]! - wv[c]!) > 0.01 * wv[c]! + 0.001)) { off++; if (!first) first = `(${x}, ${y}) reads [${av.map((v) => v.toFixed(4)).join(', ')}], the wall alone [${wv.map((v) => v.toFixed(4)).join(', ')}]`; }
  }
  const problems: string[] = [];
  if (n < 200) problems.push(`only ${n} wall pixels at azimuth 0° stand before both beams (the fixture)`);
  if (off) problems.push(`${off} of ${n} wall pixels show the beams through the wall; first at pixel ${first}`);
  return problems;
}

describe(`${AC[5]} additive surfaces need no order among themselves`, () => {
  it(`${AC[5]} two crossing add beams add [0.75, 0.5, 0.75] over the floor within 1% at each of 36 orbit poses, cast no shadow, and a wall hides both`, () => {
    requireMetal();
    const out = dir();
    const problems = [...orbitProblems(out), ...wallProblems(out)];
    expect(problems, `the additive beams:\n  ${problems.join('\n  ')}`).toEqual([]);
    const [opaque, floor] = draw(out, [beamsDoc(0, { beams: 'opaque', wall: false }), beamsDoc(0, { beams: 'none', wall: false })]);
    let shaded = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque!.ids.at(x, y) === 'floor' && lum(opaque!.lin.at(x, y)) < 0.9 * lum(floor!.lin.at(x, y))) shaded++;
    expect(shaded, 'opaque beams at the first pose shade at least 300 visible floor pixels by 10%: their shadows fall where the check looks').toBeGreaterThanOrEqual(300);
  }, 1_800_000);

  it(`${AC[5]} a planted add that writes depth drops the farther beam, and one without the depth test shows through the wall, each failing, naming the pixel`, () => {
    requireMetal();
    const out = dir();
    failsNamingPixels(orbitProblems(out, 'add_writes_depth'), '--planted add_writes_depth');
    failsNamingPixels(wallProblems(out, 'add_skips_depth_test'), '--planted add_skips_depth_test');
  }, 1_800_000);
});
