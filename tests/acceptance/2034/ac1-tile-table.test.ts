// AC1 #2034.07726d12: "In a new hall fixture with 16 shadowed spots and 2 shadowed points and no counts named, the
// tile table (light, size, slot) at 8 camera poses equals a CPU evaluation of the rule. A planted assignment in arrival
// order differs at one pose at least and fails, naming the pose and the first light"
//
// The hall (helpers: `hallDoc`, `HALL_LAMPS`) at each of its 8 poses (helpers: `HALL_POSES`), one document a pose, one
// frame each, all in one `deep-gpu run --backend noop` process with `shadows: true`: the tile table is evaluated data,
// so this runs wherever the binary builds, Spark included (the issue's "Runs on"). A frame's table is its
// `shadows.maps`, a row per light with `size` and `slots` (README: The surface under test). Each must equal
// `tileTable` (reference.ts), the rule in f64: sizes from each range sphere's diameter on screen, stepped down while
// the tiles cover more than the 4,096 px atlas, slots filled largest first, ties by ID. A failure starts
// `pose <n> (<name>): <light>`, rows in the rule's fill order, so a pose's first failure names its first wrong light.
// The poses are checked first to be what the README says: the policy shades all 18 lights at each, every diameter sits
// 2% or more from 128, 256 and 512 px, and between them the tables hold all four sizes, a pose whose asked tiles
// overflow the atlas and one whose tiles just fit (16,384,000 of 16,777,216 px²) without stepping.
// Wrong programs: the base (no size or slots in a map row, and 2 spots' maps at most); `--planted tile_arrival_order`,
// which fills slots in the order the document creates its lights (shuffled, so neither the IDs' nor the sizes'); sizes
// from a frame's position on screen or its depth rather than the sphere's diameter; a step that lowers every light, or
// only the largest one, or stops at the atlas's size rather than past it; ties by creation order.
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, TIMEOUT, failsNaming, frameAt, framesOf, none, useDir, useGpu, view3dCall, writeJson } from '../1634/helpers.ts';
import { AC, HALL, HALL_LAMPS, HALL_POSES, hallDoc, mapsOf, runGpu, tableProblems, type Planted } from './helpers.ts';
import { ATLAS, askedSize, cover, diameterPx, shaded, thresholdMargin, tileTable } from './reference.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

/** What is wrong with the hall's 8 tables, each failure naming its pose and light. */
function problems(planted?: Planted): string[] {
  const out = dir();
  const calls = HALL_POSES.map((p, k) => ({
    ...view3dCall({ doc: writeJson(out, `hall-${k + 1}`, hallDoc(`hall-pose-${k + 1}`, p.cam)), look: PLAIN_LOOK, size: HALL.size, targets: [] }), shadows: true,
  }));
  const replies = runGpu(bin(), out, calls, { lane: 'noop', ...(planted ? { planted } : {}) });
  return HALL_POSES.flatMap((p, k) => {
    const where = `pose ${k + 1} (${p.name})`;
    const f = frameAt(framesOf(out, replies[k]!, HALL.size, `the hall at ${where}`), 0, `the hall at ${where}`);
    return tableProblems(where, mapsOf(f, where), tileTable(p.cam, HALL_LAMPS));
  });
}

describe(`${ID} the hall's tile table at 8 poses`, () => {
  it(`${ID} at each of the hall's 8 poses the tile table (light, size, slots) equals the CPU evaluation of the rule`, () => {
    const sizes = new Set<number>(); let overflows = 0; let fits = 0;
    HALL_POSES.forEach((p, k) => {
      const lit = shaded(p.cam, HALL_LAMPS);
      expect(lit.length, `pose ${k + 1} (${p.name}): the policy shades all 18 lights`).toBe(18);
      expect(Math.min(...lit.map((l) => thresholdMargin(p.cam, l))), `pose ${k + 1} (${p.name}): every diameter sits 2% or more from a threshold`).toBeGreaterThanOrEqual(0.02);
      const asked = cover(lit, new Map(lit.map((l) => [l.id, askedSize(diameterPx(p.cam, l))])));
      if (asked > ATLAS * ATLAS) overflows++;
      if (asked === 16_384_000) fits++;
      for (const r of tileTable(p.cam, HALL_LAMPS)) sizes.add(r.size);
    });
    expect([...sizes].sort((a, b) => a - b), 'the 8 tables hold every size').toEqual([128, 256, 512, 1024]);
    expect(overflows, 'a pose asks for more than the atlas, so its tiles step down').toBeGreaterThan(0);
    expect(fits, 'a pose asks for 16,384,000 px², which fits without a step').toBe(1);
    none(problems(), `${ID}: the hall's tile tables against the rule`);
  }, TIMEOUT);

  it(`${ID} a planted assignment in arrival order (--planted tile_arrival_order) differs at one pose at least and fails, naming the pose and the first light`, () => {
    const failures = problems('tile_arrival_order');
    console.log(`${ID} --planted tile_arrival_order: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [/^pose [1-8] \([a-z ]+\): (spot_(0[1-9]|1[0-6])|point_[12]) holds \d+ px at slots /], '--planted tile_arrival_order');
  }, TIMEOUT);
});
