// AC2 #2017.e778fe83: "Under a sun 10° above the horizon, a plate pixel's lit color changes by at most one code value
// when its tile changes level; a planted plate that shades from each level's own vertex normals changes it by more and
// fails, naming the tile"
//
// Fixture (helpers.ts `plateDoc`, README: The fixture): a 256 × 256 m terrain plate at 1 m, 4 × 4 tiles of 64 m, six
// levels; its heights an 8 m ripple along x, 8 cm high, on gentle hills, so every level from 2 up drops the ripple from
// its heights entirely. One matte grey; a sun 10° above the horizon on the +x side, no shadow; a black sky with no
// ambient; an orthographic camera straight down, 120 m wide at 960 × 540 (8 px a metre), so a pixel sees the same ground
// (x, z) whatever height its tile is drawn at. `view3d` draws it twice, one frame each, `targets` final and depth, `lod`
// on: as written (lod_px 1) and with the document's `budget.lod_px` lowered to 0.01 (full detail). A tile changes level
// when its row's `level` differs between the two.
//
// Test 1, the shipped program: some tile in view changes level, from coarser than full detail to full detail, and its
// drawn surface moves (its depth changes somewhere by more than 5 mm); every pixel of every such tile keeps its final
// color within one code value in red, green and blue. So the hold can't pass on a picture that shows no light, under 1%
// of the compared pixels are clipped, and at full detail the ripple shows in the light: where its slope faces the sun
// the ground is brighter by at least 10 code values of green on average than where it faces away.
// Test 2: under `--planted terrain_shades_own_level_normals` some tile still changes level, and the judge fails, each
// failure naming a tile that changed level.
import { describe, expect, it } from 'vitest';
import {
  ID, PLAIN, PLANT, SIZE, TIMEOUT, compare, decodeDepth, decodePng, levelsOf, lightFailures, onlyFrame, plateDoc, readNamed,
  requireMetal, runGpu, useDeepGpu, useOut, writeJson, type Draw,
} from './helpers.ts';

const NAME = `AC2 ${ID}`;
const deepGpu = useDeepGpu();
const out = useOut();

/** One frame of the plate, as written or with lod_px lowered: its tiles' levels, its final picture and its depth. */
function draw(lowered: boolean, planted?: string): Draw {
  const what = `the plate${lowered ? ' with lod_px lowered to 0.01' : ' as written'}${planted ? ` under ${planted}` : ''}`;
  const dir = out();
  const doc = writeJson(dir, lowered ? 'full' : 'written', plateDoc(lowered));
  const call = { call: 'view3d', doc, look: PLAIN, size: [...SIZE], frames: 1, capture: [0], targets: ['final', 'depth'], lod: true };
  const [reply] = runGpu(deepGpu(), dir, [call], planted);
  const frame = onlyFrame(reply!, what);
  const image = decodePng(readNamed(dir, frame['final'], 'png', `${what}: the final target`));
  expect([image.width, image.height], `${what}: the picture is ${SIZE[0]} × ${SIZE[1]}`).toEqual([...SIZE]);
  const depth = decodeDepth(readNamed(dir, frame['depth'], 'f32', `${what}: the depth target`), `${what}: the depth target`);
  return { levels: levelsOf(frame, what), image, depth };
}

describe(`${NAME} the light on a tile holds when its level changes`, () => {
  it(`${NAME} under a sun 10° up, every pixel of a tile that changes level keeps its lit color within one code value`, () => {
    requireMetal();
    const written = draw(false);
    const full = draw(true);
    const c = compare(written, full);
    expect(c.changed.map((t) => t.tile), 'some tile in view changes level when lod_px is lowered to 0.01').not.toEqual([]);
    for (const t of c.changed) {
      expect(t.from, `${t.tile} draws coarser than full detail as written`).toBeGreaterThan(0);
      expect(t.to, `${t.tile} draws at full detail with lod_px lowered to 0.01`).toBe(0);
      expect(t.moved, `${t.tile}'s drawn surface moves between level ${t.from} and level 0: its depth changes somewhere by more than 5 mm`).toBeGreaterThan(0.005);
    }
    expect(c.clipped / c.compared, `under 1% of the ${c.compared} pixels compared are clipped at 0 or 255`).toBeLessThan(0.01);
    expect(lightFailures(c), `tiles ${c.changed.map((t) => t.tile).join(', ')} change level; every pixel keeps its lit color within one code value`).toEqual([]);
    expect(c.facing - c.away, `at full detail the ripple shows in the light: green where its slope faces the sun (mean ${c.facing.toFixed(1)}) exceeds green where it faces away (mean ${c.away.toFixed(1)}) by at least 10 code values`).toBeGreaterThanOrEqual(10);
  }, TIMEOUT);

  it(`${NAME} the planted ${PLANT} changes a pixel's lit color by more than one code value and fails, naming the tile`, () => {
    requireMetal();
    const c = compare(draw(false, PLANT), draw(true, PLANT));
    const changed = c.changed.map((t) => t.tile);
    expect(changed, 'under the plant too, some tile in view changes level when lod_px is lowered to 0.01').not.toEqual([]);
    const failures = lightFailures(c);
    console.log(`${ID} ${PLANT}: ${failures.join(' | ')}`);
    expect(failures.length, `shading from each level's own vertex normals changes the lit color by more than one code value`).toBeGreaterThan(0);
    for (const f of failures) {
      const named = /^(tile \[\d+, \d+\])/.exec(f)?.[1];
      expect(named !== undefined && changed.includes(named), `the failure names a tile that changed level: ${f}`).toBe(true);
    }
  }, TIMEOUT);
});
