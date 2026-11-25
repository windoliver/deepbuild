// AC5 #2034.1a79031a: "After the camera crosses a threshold, and after an item outside a light's range moves, each
// cached tile equals a clean render by pixel hash. A planted cache keyed without the tile's size reuses a 512 px tile
// at 256 px and fails, naming the light"
//
// AC3's threshold walk (helpers: `walkDoc`) played from frame 0 to 11 with `shadows: true` and the final target in one
// `deep-gpu run` on macOS's Metal device: at frame 3 the camera has crossed the threshold moving out (`edge_lamp`
// 512 → 256 px), at frame 8 it has crossed back moving in (256 → 512 px), and at frame 11 the camera is still and
// `crate`, outside `edge_lamp`'s range and inside `side_lamp_1`'s, has moved 0.5 m. The clean render is the same walk
// with `light_policy.cache: none`, opened at frame 3 and sought to 8, then 11, in the same process: every tile drawn
// in the frame that reads it. At each of the three frames, for every light, the tile's `pixel_hash` (the SHA-256 of the
// texels its tiles hold as the frame reads them: README: The surface under test) must equal the clean render's, and
// so must the frame's own pixel hash; the tile table must be the rule's (`tileTable`, reference.ts); and at frame 11
// `edge_lamp`'s tile must be cached (`drawn: false`), so a cached tile is what is compared there. A failure starts
// `frame <n> (<when>): <light>`.
// Wrong programs: the base (no tiles, no tile hashes); `--planted tile_key_without_size`, whose tile key is today's map
// key alone (neither size nor place in the atlas), so at frame 3 `edge_lamp`'s 256 px tile isn't drawn and its slot
// still holds the 512 px tile's texels; a key that takes in every item, so the crate redraws `edge_lamp`'s tile; a key
// that misses the crate, so `side_lamp_1`'s tile keeps its old shadow.
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, TIMEOUT, failsNaming, frameAt, framesOf, none, requireMetal, useDir, useGpu, view3dCall, writeJson } from '../1634/helpers.ts';
import { AC, CRATE, EDGE, WALK, WALK_LAMPS, mapsOf, runGpu, tableProblems, walkCam, walkDoc, type Planted } from './helpers.ts';
import { tileTable, type Box, type Lamp, type V3 } from './reference.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const CHECKED: [number, string][] = [[3, 'after the camera crosses the threshold moving out'], [8, 'after it crosses back moving in'], [11, 'after the crate, outside edge_lamp\'s range, moves']];

/** The least distance from a light to a box, m. */
function reach(l: Lamp, b: Box): number {
  const e = [0, 1, 2].map((k) => Math.max(b.centre[k]! - b.size[k]! / 2 - l.pos[k]!, l.pos[k]! - b.centre[k]! - b.size[k]! / 2, 0));
  return Math.hypot(e[0]!, e[1]!, e[2]!);
}

function problems(planted?: Planted): string[] {
  const out = dir();
  const common = { look: PLAIN_LOOK, size: WALK.size, fps: WALK.fps, capture: CHECKED.map(([n]) => n), targets: ['final' as const] };
  const [cached, clean] = runGpu(bin(), out, [
    { ...view3dCall({ ...common, doc: writeJson(out, 'walk', walkDoc('walk')), frames: 12 }), shadows: true },
    { ...view3dCall({ ...common, doc: writeJson(out, 'walk-clean', walkDoc('walk-clean', { cache: 'none' })), from: 3, frames: 3, seeks: [{ after: 3, to: 8 }, { after: 8, to: 11 }] }), shadows: true },
  ], planted ? { planted } : {});
  const [c, k] = [framesOf(out, cached!, WALK.size, 'the walk'), framesOf(out, clean!, WALK.size, 'the walk drawn clean')];
  const failures: string[] = [];
  for (const [n, when] of CHECKED) {
    const where = `frame ${n} (${when})`;
    const [f, g] = [frameAt(c, n, where), frameAt(k, n, `${where}, clean`)];
    const maps = mapsOf(f, where);
    const fresh = new Map(mapsOf(g, `${where}, clean`).map((m) => [m.light, m]));
    failures.push(...tableProblems(where, maps, tileTable(walkCam(n), WALK_LAMPS)));
    for (const m of maps) {
      const ref = fresh.get(m.light);
      if (m.hash === null || ref?.hash == null) failures.push(`${where}: ${m.light}'s tile reports no pixel_hash (${String(m.hash)}; clean ${String(ref?.hash)})`);
      else if (m.hash !== ref.hash) failures.push(`${where}: ${m.light}'s ${String(m.size)} px tile (${m.drawn ? 'drawn' : 'cached'}) has pixel hash ${m.hash.slice(0, 12)}…, a clean render's ${ref.hash.slice(0, 12)}…`);
    }
    if (n === 11 && maps.find((m) => m.light === EDGE.id)?.drawn !== false) failures.push(`${where}: ${EDGE.id}'s tile is drawn again though nothing in its range changed, so it isn't cached`);
    if (f.pixelHash === null || f.pixelHash !== g.pixelHash) failures.push(`${where}: the frame's pixel hash ${String(f.pixelHash).slice(0, 12)}… differs from a clean render's ${String(g.pixelHash).slice(0, 12)}…`);
  }
  return failures;
}

describe(`${ID} cached tiles equal clean renders`, () => {
  it(`${ID} after the camera crosses edge_lamp's threshold each way, and after the crate outside its range moves, every tile equals a clean render by pixel hash`, () => {
    requireMetal();
    const crate = (x: number): Box => ({ id: 'crate', centre: [x, CRATE.at[1], CRATE.at[2]] as V3, size: CRATE.size });
    for (const x of [CRATE.at[0], CRATE.movedX]) {
      expect(reach(EDGE, crate(x)), `the crate at x = ${x} lies outside edge_lamp's range`).toBeGreaterThan(EDGE.range);
      expect(reach(WALK_LAMPS[1]!, crate(x)), `the crate at x = ${x} lies inside side_lamp_1's range`).toBeLessThan(WALK_LAMPS[1]!.range);
    }
    none(problems(), `${ID}: the walk's tiles against clean renders`);
  }, TIMEOUT);

  it(`${ID} a planted cache keyed without the tile's size (--planted tile_key_without_size) reuses a 512 px tile at 256 px and fails, naming the light`, () => {
    requireMetal();
    const failures = problems('tile_key_without_size');
    console.log(`${ID} --planted tile_key_without_size: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [/^frame 3 \([^)]*\): edge_lamp/], '--planted tile_key_without_size');
  }, TIMEOUT);
});
