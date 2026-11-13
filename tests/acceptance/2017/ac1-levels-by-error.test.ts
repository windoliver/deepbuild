// AC1 #2017.3e1437ba: "A plate seen from the same pose at 1080p and at 4K selects each tile's level by its error
// projected at that size, so at 200 sampled ground points the drawn height stays within `lod_px` of full detail on
// screen at both sizes; a planted selection by distance alone exceeds it at 4K and fails, naming the tile"
//
// Fixture (helpers.ts `plateDoc`, README: Fixtures): a 512 × 512 m terrain plate at 1 m, 8 × 8 tiles of 64 m, six
// levels, rolling hills under a 3 cm zigzag along x, seen from (0, 25, 300) looking at its centre, fov 60, drawn by
// `view3d` at 1920 × 1080 and at 3840 × 2160 from that one pose, one frame each, with `lod: true` and `ground_points`
// (README: Assumed surfaces 1 and 2). The 200 ground points are samples at an odd column and row, off tile edges, on
// screen at 1080p; full detail there is the field's own value.
//
// The first test, the shipped program, at each size:
//   - a row for each of the 64 tiles; each tile's `level` is the coarsest whose reported `errors_px` is within lod_px
//     (1 px): the selection is by projected error;
//   - "at that size": every tile's `errors_px` at 4K is twice its 1080p one (the same pose, twice the focal length);
//     some tile draws coarser than full detail at 1080p, some tile draws finer at 4K than at 1080p, none coarser;
//   - each point names the tile it lies in and that tile's level, and its drawn height is within lod_px of full detail
//     on screen: |y − full| × focal ÷ distance from the eye ≤ 1 px (+ 1e-3 px for f32);
//   - so the points test something: at 1080p at least 20 of them lie on tiles drawn coarser than full detail and are
//     off full detail by more than 0.05 px.
// The second test: `--planted terrain_lod_by_distance` (each tile's level from its distance alone: the levels the
// shipped program draws at 1080p, at every size) drawn at 4K fails the 200-point judge, each failure naming its tile.
import { describe, expect, it } from 'vitest';
import {
  AC, HD, LOD_PX, PLAIN, PLATE, PLATE_ID, TIMEOUT, UHD, coarsestWithin, framesOf, groundPoints, offPx, plateDoc, pointFailures, pointsOf,
  requireMetal, runGpu, tileName, tilesOf, useBins, useOut, writeJson, type Planted, type Size,
} from './helpers.ts';

const ID = AC[1];
const NAME = `AC1 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const POINTS = groundPoints();

/** One frame of the plate at `size` from the one pose: its tiles' rows and the 200 points' readings. */
function draw(size: Size, planted?: Planted) {
  const what = `the plate at ${size[0]} × ${size[1]}${planted ? ` under ${planted}` : ''}`;
  const doc = writeJson(out(), `plate-${size[0]}`, plateDoc(size));
  const call = { call: 'view3d', doc, look: PLAIN, size: [...size], frames: 1, lod: true, ground_points: { item: PLATE_ID, at: POINTS.map((p) => [p.x, p.z]) } };
  const [reply] = runGpu(bin('deep-gpu'), out(), [call], planted);
  const [frame] = framesOf(reply!, 1, what);
  const tiles = tilesOf(frame!, PLATE_ID, PLATE, what);
  return { what, tiles, rows: pointsOf(frame!, POINTS, what) };
}

describe(`${NAME} each tile's level by its error projected at the view's size`, () => {
  it(`${NAME} at 1080p and at 4K from one pose each tile draws the coarsest level within lod_px of its error projected at that size, and 200 ground points stay within lod_px of full detail on screen`, () => {
    requireMetal();
    expect(POINTS.length, 'the fixture has 200 ground points').toBe(200);
    const hd = draw(HD);
    const uhd = draw(UHD);
    for (const v of [hd, uhd]) {
      const wrong = [...v.tiles.values()].filter((t) => t.level !== coarsestWithin(t.errorsPx, LOD_PX))
        .map((t) => `${tileName(t.tile)} draws level ${t.level}, but the coarsest within ${LOD_PX} px is ${coarsestWithin(t.errorsPx, LOD_PX)} (errors_px ${t.errorsPx.map((e) => e.toFixed(3)).join(', ')})`);
      expect(wrong, `${v.what}: each tile's level is the coarsest whose projected error is within lod_px`).toEqual([]);
    }
    const scaled: string[] = [];
    for (const [name, a] of hd.tiles) {
      const b = uhd.tiles.get(name)!;
      a.errorsPx.forEach((e, l) => { if (Math.abs(b.errorsPx[l]! - 2 * e) > 1e-6 * Math.max(1, 2 * e)) scaled.push(`${name} level ${l}: ${e} px at 1080p, ${b.errorsPx[l]} px at 4K`); });
      if (b.level > a.level) scaled.push(`${name} draws coarser at 4K (level ${b.level}) than at 1080p (level ${a.level})`);
    }
    expect(scaled, 'from the same pose each error projects twice as large at 4K, and no tile draws coarser there').toEqual([]);
    expect([...hd.tiles.values()].some((t) => t.level > 0), 'some tile draws coarser than full detail at 1080p').toBe(true);
    expect([...hd.tiles.keys()].some((n) => uhd.tiles.get(n)!.level < hd.tiles.get(n)!.level), 'some tile draws finer at 4K than at 1080p').toBe(true);
    expect(pointFailures(POINTS, hd.rows, hd.tiles, HD, LOD_PX), `${hd.what}: every point within lod_px of full detail on screen`).toEqual([]);
    expect(pointFailures(POINTS, uhd.rows, uhd.tiles, UHD, LOD_PX), `${uhd.what}: every point within lod_px of full detail on screen`).toEqual([]);
    const seen = hd.rows.filter((r, k) => r.level > 0 && offPx(r, POINTS[k]!.full, HD) > 0.05).length;
    expect(seen, 'at 1080p at least 20 points lie on coarser tiles and are off full detail by more than 0.05 px, so the points see the levels').toBeGreaterThanOrEqual(20);
  }, TIMEOUT);

  it(`${NAME} the planted terrain_lod_by_distance, a selection by distance alone, exceeds lod_px at 4K and fails, naming the tile`, () => {
    requireMetal();
    const uhd = draw(UHD, 'terrain_lod_by_distance');
    const failures = pointFailures(POINTS, uhd.rows, uhd.tiles, UHD, LOD_PX).filter((f) => f.includes('over lod_px'));
    console.log(`${ID} terrain_lod_by_distance at 4K: ${failures.length} points over lod_px; first: ${failures.slice(0, 3).join(' | ')}`);
    expect(failures.length, 'the planted selection by distance alone draws some point more than lod_px off full detail at 4K').toBeGreaterThan(0);
    expect(failures.every((f) => /^tile \[\d+, \d+\]/.test(f)), `each failure names its tile: ${failures.slice(0, 5).join('; ')}`).toBe(true);
  }, TIMEOUT);
});
