// #1700.c01ffdd0: "The window built as one extruded profile with four holes and as a slab with four boolean cuts reads
// the same parts, holes and volume, within 1e-9 relative; a planted reading that differs by build route fails, naming
// the reading and both values"
//
// Fixtures, each a stored scene, the one deliverable of its own claim of alpha's:
//   - `windowDoc` (helpers.ts): `window`, an `extrude@1` of a 1 × 1 m square outline with four 0.2 m square holes
//     centred at (±0.25, ±0.25) m, 0.1 m along +z: one extruded profile with four holes;
//   - `cutWindowDoc` (helpers.ts, gltf.ts `cutWindow`): `cut-window`, a `mesh.asset@1` naming, by SHA-256 in the
//     evidence store, the glTF a boolean job leaves of a slab with four square cuts (a boolean is an offline job whose
//     mesh asset an item places: Asset job: modeling, simulation and render kinds). The file holds the slab in
//     decimetres, 10 × 10 × 1 dm cut through by four 2 dm squares centred at (±2.5, ±2.5) dm, every coordinate a
//     multiple of 0.5 and so exact in f32; the item places it at scale 0.1, so in world space it is the same window.
//     Its faces are triangulated on the cut's grid, unlike the extrusion's, and split at every sharp edge.
// The check on each: `{kind: geometry.shape, of: <item>, readings: [parts, holes, volume], expect: {parts: 1, holes: 4,
// volume: [0.0839, 0.0841]}}`.
//
// asserts:
//   - both requirements PASS; each reads one parts result, one holes result and one volume result; the two windows'
//     parts are equal and their holes are equal, and the cut window's volume is within 1e-9 relative of the extruded
//     window's;
//   - with the planted `asset_read_unplaced` (a `mesh.asset@1` item's triangles read as the file holds them, without
//     the item's placement, while a builder's item is placed as shipped): the extruded window still PASSes; the cut
//     window's volume reads the file's 84 (within 1e-9 relative), its requirement FAILs, and a geometry.reading issue
//     on readings/2 names the reading volume and both values, expected [0.0839, 0.0841] and actual that volume.
import { describe, expect, it } from 'vitest';
import { cutWindow } from './gltf.ts';
import {
  PLANTED, TIMEOUT, brief, claimId, claimOf, cutWindowDoc, decided, docId, nearRel, oneAt, putMesh, readingIssuesAt, reqId, rowOf, run,
  scenarioOf, shape, useBuild, useFolders, verdict, windowDoc, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.c01ffdd0';
const bin = useBuild();
const folder = useFolders();

const [EXTRUDED, CUT] = [docId(1), docId(2)];
const VOLUME = [0.0839, 0.0841];
const check = (of: string): JsonObject => shape(of, ['parts', 'holes', 'volume'], { parts: 1, holes: 4, volume: VOLUME });
const claims = {
  [claimId(1)]: claimOf(EXTRUDED, [{ id: reqId(1), check: check('window') }]),
  [claimId(2)]: claimOf(CUT, [{ id: reqId(2), check: check('cut-window') }]),
};
/** Both windows judged in one run, with a planted program or without. */
function judged(planted?: string): [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>] {
  const evidence = folder();
  const sha = putMesh(evidence, cutWindow());
  const [onExtruded, onCut] = run(bin(), scenarioOf(evidence, { [EXTRUDED]: windowDoc(), [CUT]: cutWindowDoc(sha) }, claims,
    [verdict(claimId(1)), verdict(claimId(2))], planted));
  const under = planted ? ` under ${planted}` : '';
  return [rowOf(onExtruded!, reqId(1), `the extruded window${under}`), rowOf(onCut!, reqId(2), `the cut window${under}`)];
}

describe(`${ID} a shape reads the same whatever route built it`, () => {
  it(`${ID} the window extruded with four holes and cut from a slab by four booleans reads the same parts, holes and volume within 1e-9 relative; a planted reading that differs by build route fails, naming the reading and both values`, () => {
    const [extruded, cut] = judged();
    decided(extruded, 'PASS', 'the extruded window read for parts 1, holes 4 and its volume');
    decided(cut, 'PASS', 'the cut window read for parts 1, holes 4 and its volume');
    const [parts, holes, volume] = [0, 1, 2].map((i) => [oneAt(extruded, i, `the extruded window: readings/${i}`).value, oneAt(cut, i, `the cut window: readings/${i}`).value]);
    expect(parts![1], `the two routes read the same parts: extruded ${brief(parts![0])}, cut ${brief(parts![1])}`).toBe(parts![0]);
    expect(holes![1], `the two routes read the same holes: extruded ${brief(holes![0])}, cut ${brief(holes![1])}`).toBe(holes![0]);
    expect(typeof volume![0] === 'number' && nearRel(volume![1], volume![0], 1e-9),
      `the two routes read the same volume within 1e-9 relative: extruded ${brief(volume![0])}, cut ${brief(volume![1])}`).toBe(true);

    // The planted reading that differs by build route.
    const [plantedExtruded, plantedCut] = judged(PLANTED.route);
    decided(plantedExtruded, 'PASS', `the extruded window under ${PLANTED.route}, a builder's item, placed as shipped`);
    const unplaced = oneAt(plantedCut, 2, `the cut window under ${PLANTED.route}: volume`).value;
    expect(nearRel(unplaced, 84, 1e-9), `the planted reading takes the cut window's file as it is: 84 (dm³ read as m³), got ${brief(unplaced)}`).toBe(true);
    decided(plantedCut, 'FAIL', `the cut window under ${PLANTED.route}`);
    const issue = readingIssuesAt(plantedCut, 2)[0];
    expect(issue, `a geometry.reading issue on readings/2: ${brief(plantedCut.raw['issues'] ?? null, 3000)}`).toBeDefined();
    expect(issue!.reading, `the issue names the reading volume: ${brief(issue!.raw)}`).toBe('volume');
    expect(issue!.expected, `the issue names the expected value [0.0839, 0.0841]: ${brief(issue!.raw)}`).toEqual(VOLUME);
    expect(issue!.actual, `the issue names the actual value, the volume read: ${brief(issue!.raw)}`).toBe(unplaced);
  }, TIMEOUT);
});
