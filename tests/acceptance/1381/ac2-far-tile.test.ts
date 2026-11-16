// AC2 #1381.60933b30: "A tile 2 km out keeps its shadow with cascades set to zero range; a planted plate with no bake
// lights it and fails"
//
// Fixture (helpers.ts `ridgeDoc`, README: Fixtures): criterion 1's ridge plate and 5° sun, the cascades at zero range
// (`shadow_far: 0`, README: Assumed surfaces 2), seen from (256, 300, 2,000) looking north. Tiles are 512 m: tile [7, 7]
// covers x −512 to 0 and z −512 to 0, 512 m to 1,024 m east of the crest, inside the ridge's shadow (closed form: it
// reaches 1,143 m); tile [9, 7] covers x 512 to 1,024 m, 1,536 m to 2,048 m east of the crest, past it. Each tile's
// nearest point lies 2,038 m from the eye: both are 2 km out. One frame at 640 × 360 reads `ground_points` at a 5 × 5
// grid in each tile, 32 m in from its edges and 112 m apart (README: Assumed surfaces 3).
//
// The first test, the shipped program: every point of tile [7, 7] reads the sun's visibility at most 0.05 (the crest
// stands 5.8° to 10.4° over its points, more than the sun's 5° plus its 0.27° half-width and a texel's change), and
// every point of the lit tile [9, 7] at least 0.95 (the crest stands under 3.7°), so a reading dark everywhere can't pass.
// The second test: `--planted terrain_no_horizon_bake`, the plate with no bake (README: Planted programs), lights tile
// [7, 7]: every point reads over one half, and the first test's judge fails, each failure naming the tile.
//
// Catches: the base (no `horizon`, no zero-range cascades, no readings); a far ground that only cascades shade; the
// planted plate with no bake.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN, RIDGE, SMALL, framesOf, groundPoints, groundRows, requireMetal, ridgeDoc, runGpu, tileName, tileOf, useGpu, useOut, writeJson,
  type GroundRow, type Planted, type Tile, type Xz,
} from './helpers.ts';

const ID = AC[2];
const NAME = `AC2 ${ID}`;
const bin = useGpu();
const out = useOut();
const SHADED: Tile = [7, 7];
const LIT: Tile = [9, 7];
/** A 5 × 5 grid in `t`, 32 m in from its edges and 112 m apart. */
function grid(t: Tile): Xz[] {
  const x0 = -RIDGE.size[0] / 2 + t[0] * RIDGE.tile; const z0 = -RIDGE.size[1] / 2 + t[1] * RIDGE.tile;
  return Array.from({ length: 25 }, (_, k) => [x0 + 32 + 112 * (k % 5), z0 + 32 + 112 * Math.floor(k / 5)] as Xz);
}
const POINTS: Xz[] = [...grid(SHADED), ...grid(LIT)];

function draw(planted?: Planted): { shaded: GroundRow[]; lit: GroundRow[] } {
  const what = `the ridge's far tiles, cascades at zero range${planted ? `, under ${planted}` : ''}`;
  const doc = writeJson(out(), 'ridge', ridgeDoc({ size: SMALL, sun: { still: 5 }, view: 'far' }));
  const [reply] = runGpu(bin(), out(), [{ call: 'view3d', doc, look: PLAIN, size: [...SMALL], frames: 1, ground_points: groundPoints(POINTS) }], planted);
  const [frame] = framesOf(reply!, 1, what);
  const rows = groundRows(frame!, POINTS, what);
  rows.forEach((r, k) => {
    const want = tileOf(RIDGE, r.x, r.z);
    expect(r.tile, `${what}: ground_points[${k}] names ${tileName(want)}, the tile it lies in`).toEqual(want);
  });
  return { shaded: rows.slice(0, 25), lit: rows.slice(25) };
}
/** The judge: each point of the shaded tile in full shadow, each failure naming its tile. */
const shadowFailures = (rows: readonly GroundRow[]): string[] => rows.filter((r) => r.sun > 0.05)
  .map((r) => `${tileName(r.tile ?? SHADED)}: the point (${r.x}, ${r.z}), ${r.x + 1024} m east of the crest, reads sun_visibility ${r.sun.toFixed(3)}, lit inside the ridge's shadow`);

describe(`${NAME} a tile 2 km out keeps its shadow past zero-range cascades`, () => {
  it(`${NAME} with cascades at zero range, tile [7, 7] 2 km out stays in the ridge's shadow and tile [9, 7] beside it past the shadow stays lit`, () => {
    requireMetal();
    const { shaded, lit } = draw();
    expect(shadowFailures(shaded), `${tileName(SHADED)} keeps its shadow`).toEqual([]);
    const dark = lit.filter((r) => r.sun < 0.95).map((r) => `${tileName(LIT)}: the point (${r.x}, ${r.z}) reads sun_visibility ${r.sun.toFixed(3)}, past the shadow's reach`);
    expect(dark, `${tileName(LIT)}, past the shadow's reach, stays lit`).toEqual([]);
  }, 3_600_000);

  it(`${NAME} the planted terrain_no_horizon_bake, a plate with no bake, lights tile [7, 7] and fails, naming the tile`, () => {
    requireMetal();
    const { shaded } = draw('terrain_no_horizon_bake');
    const failures = shadowFailures(shaded);
    console.log(`${ID} terrain_no_horizon_bake: ${failures.length} of 25 points of ${tileName(SHADED)} lit; first: ${failures.slice(0, 2).join(' | ')}`);
    expect(shaded.every((r) => r.sun > 0.5), `the plate with no bake lights every point of ${tileName(SHADED)}: ${shaded.map((r) => r.sun.toFixed(2)).join(', ')}`).toBe(true);
    expect(failures.length, 'the judge fails on the plate with no bake').toBeGreaterThan(0);
    expect(failures.every((f) => f.startsWith(`${tileName(SHADED)}:`)), `each failure names the tile: ${failures.slice(0, 3).join('; ')}`).toBe(true);
  }, 3_600_000);
});
