// AC2 #2017.e778fe83: "Under a sun 10° above the horizon, a plate pixel's lit color changes by at most one code value
// when its tile changes level; a planted plate that shades from each level's own vertex normals changes it by more and
// fails, naming the tile"
//
// Fixture (helpers.ts `shadedDoc`, README: Fixtures): a 256 × 256 m terrain plate at 1 m, 4 × 4 tiles of 64 m, six
// levels, gentle hills under a 6 m ripple along x (10 cm high), one grey material (0.6, roughness 1), lit by a sun
// 10° above the horizon on the +x side (`at.rot` [−10, 90, 0], no shadow) under a black sky with no ambient, seen
// straight down through an orthographic camera 112 m wide at 960 × 540 (8.57 px a metre), so each pixel sees the same ground
// (x, z) whatever height its tile is drawn at. Drawn twice by `view3d`, one frame each, `targets: ['final']`, `lod:
// true`: as written (lod_px 1, each tile at a coarser level), and with the document's `budget.lod_px` lowered to 0.01
// (every tile at full detail). A tile changes level when its `level` differs between the two.
//
// The first test, the shipped program: some tile in view changes level, it drew coarser than full detail as written;
// every pixel of each tile that changed level has the same final color in both within one code value in each channel;
// and the pixels compared show the light: their green spans at least 40 code values and under 1% are clipped at 0 or 255.
// The second test: `--planted terrain_shades_own_level_normals` (each tile shaded from the vertex normals of the level
// it draws) changes some of those pixels by more than one code value, and the failure names the tile.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN, PLATE_ID, SHADED, SHADED_SIZE, TIMEOUT, decodePng, framesOf, lightFailures, readNamed, requireMetal, runGpu, shadedDoc, shadedGround,
  tileName, tileOf, tilesOf, useBins, useOut, writeJson, type Image, type Planted, type TileRow,
} from './helpers.ts';

const ID = AC[2];
const NAME = `AC2 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();

/** One frame of the shaded plate, as written or with lod_px lowered: its tiles' rows and its final picture. */
function draw(lowered: boolean, planted?: Planted): { tiles: Map<string, TileRow>; image: Image } {
  const what = `the shaded plate${lowered ? ' with lod_px lowered' : ''}${planted ? ` under ${planted}` : ''}`;
  const dir = out();
  const doc = writeJson(dir, `shaded-${lowered ? 'full' : 'levels'}`, shadedDoc(lowered));
  const call = { call: 'view3d', doc, look: PLAIN, size: [...SHADED_SIZE], frames: 1, capture: [0], targets: ['final'], lod: true };
  const [reply] = runGpu(bin('deep-gpu'), dir, [call], planted);
  const [frame] = framesOf(reply!, 1, what);
  const image = decodePng(readNamed(dir, frame!['final'], 'png', `${what}: the final target`));
  expect([image.width, image.height], `${what}: the picture is ${SHADED_SIZE[0]} × ${SHADED_SIZE[1]}`).toEqual([...SHADED_SIZE]);
  return { tiles: tilesOf(frame!, PLATE_ID, SHADED, what), image };
}
/** The tiles under the frame's pixels whose level differs between the two draws. */
function changed(a: Map<string, TileRow>, b: Map<string, TileRow>): string[] {
  const seen = new Set<string>();
  for (let py = 0; py < SHADED_SIZE[1]; py += 4) for (let px = 0; px < SHADED_SIZE[0]; px += 4) {
    const [x, z] = shadedGround(px, py);
    seen.add(tileName(tileOf(SHADED, x, z)));
  }
  return [...seen].filter((n) => a.get(n)?.level !== b.get(n)?.level).sort();
}

describe(`${NAME} the light on a tile holds when its level changes`, () => {
  it(`${NAME} under a sun 10° up, every pixel of a tile that changes level keeps its lit color within one code value`, () => {
    requireMetal();
    const a = draw(false);
    const b = draw(true);
    const moved = changed(a.tiles, b.tiles);
    expect(moved.length, 'some tile in view changes level when lod_px is lowered').toBeGreaterThan(0);
    for (const n of moved) expect(a.tiles.get(n)!.level, `${n} draws coarser than full detail as written`).toBeGreaterThan(0);
    const greens: number[] = [];
    for (let py = 0; py < a.image.height; py++) for (let px = 0; px < a.image.width; px++) {
      const [x, z] = shadedGround(px, py);
      if (moved.includes(tileName(tileOf(SHADED, x, z)))) greens.push(a.image.rgba[(py * a.image.width + px) * 4 + 1]!);
    }
    const span = Math.max(...greens) - Math.min(...greens);
    const clipped = greens.filter((g) => g === 0 || g === 255).length / greens.length;
    expect(span, 'the pixels compared show the light: their green spans at least 40 code values').toBeGreaterThanOrEqual(40);
    expect(clipped, 'under 1% of the pixels compared are clipped at 0 or 255').toBeLessThan(0.01);
    const failures = lightFailures(a.image, b.image, a.tiles, b.tiles);
    expect(failures, `tiles ${moved.join(', ')} change level; every pixel keeps its lit color within one code value`).toEqual([]);
  }, TIMEOUT);

  it(`${NAME} the planted terrain_shades_own_level_normals changes a pixel's lit color by more than one code value and fails, naming the tile`, () => {
    requireMetal();
    const planted: Planted = 'terrain_shades_own_level_normals';
    const a = draw(false, planted);
    const b = draw(true, planted);
    expect(changed(a.tiles, b.tiles).length, 'under the plant too, some tile in view changes level').toBeGreaterThan(0);
    const failures = lightFailures(a.image, b.image, a.tiles, b.tiles);
    console.log(`${ID} ${planted}: ${failures.join(' | ')}`);
    expect(failures.length, 'shading from each level\'s own vertex normals changes the lit color by more than one code value').toBeGreaterThan(0);
    expect(failures.every((f) => /^tile \[\d+, \d+\]/.test(f)), `each failure names its tile: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
