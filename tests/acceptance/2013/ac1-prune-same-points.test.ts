// #2013.8b415be3: "A distribute with a minimum distance and pruning never places two prototype bounds closer than
// allowed, and gives the same points on every machine and for any sibling order"
//
// Fixture (helpers.ts, `gardenDoc`), shown by the working agent through deep_show: the 10 × 10 m plate and two
// instancers fed by a scatter over it, each `from: {distribute: {on: plate, mode: poisson, min_distance: 0.5,
// yaw: [0, 0], seed: 2013}}` of the prototypes `bush` (a 1.2 m box) and `flower` (a 0.3 m box): `shrubs` with
// `prune: larger_first`, and `loose` with pruning left out. Each scatter is read back by the `geometry` call's row
// for its instancer, `elements: [{id, proto, pos, yaw, scale}]`.
//
// asserts:
//   - `shrubs`: at least two elements; every pair of points at least 0.5 m apart; no two elements' bounds (each its
//     prototype's box at its point) pass more than 2 mm into each other;
//   - `loose`: the same scatter unpruned does leave bounds that pass into each other, so pruning is what removed them;
//   - a second, fresh process gives both scatters to the last bit;
//   - the same document with its siblings listed and ordered the other way round gives both scatters to the last bit;
//   - the other CPU architecture's record of both scatters equals this machine's (BLOCKED until that record is given).
//
// Wrong programs this fails on, with no planted program in shipped code:
//   - a scatter that keeps centres 0.5 m apart and never prunes by prototype bounds: two bushes 0.5 m apart pass
//     0.7 m into each other, so `shrubs` fails the bounds rule (the trap is live: `loose` must show such a pair);
//   - one that prunes by dropping everything, or all but one: fewer than two elements;
//   - one whose points depend on sibling order (a random stream shared by the document's scatters and drawn in item
//     order, or a seed taken from an item's place in the list): the reversed document changes a scatter;
//   - one that seeds from the clock, the process or thread order: the second process changes a scatter;
//   - one whose points depend on the machine (a platform's own sin, cos or hash, or a fused multiply-add): the other
//     architecture's record differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LOOSE, MIN_DISTANCE, PROTO_SIDES, REPO, SHRUBS, TIMEOUT, TOLERANCE, blocked, boundsOverlaps, distanceFailures, docId, elementsOf, gardenDoc,
  geometry, judgesFailTheirPlants, none, obj, pointsText, presented, run, scenarioOf, show, useFolders, useShow,
  type Element, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[1];
const bin = useShow();
const folder = useFolders();
const DOC = docId(1);
/** Where the other CPU architecture's record of this test's scatters is given. */
const OTHER = 'DEEP_2013_OTHER_RECORD';

/** Both scatters of the garden, from one fresh process. */
function scattered(reversed: boolean, what: string): { shrubs: Element[]; loose: Element[] } {
  const [shown, read] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, gardenDoc(reversed)), geometry(DOC, [SHRUBS, LOOSE])]));
  presented(shown!, `${what} (instancers fed by from: distribute)`);
  return { shrubs: elementsOf(read!, SHRUBS, PROTO_SIDES.length, what), loose: elementsOf(read!, LOOSE, PROTO_SIDES.length, what) };
}
const textOf = (s: { shrubs: Element[]; loose: Element[] }): JsonObject => ({ [SHRUBS]: pointsText(s.shrubs), [LOOSE]: pointsText(s.loose) });

describe(`${ID} a distribute with a minimum distance and pruning`, () => {
  it(`${ID} never places two prototype bounds closer than allowed, where the same scatter unpruned does, and gives the same points in a second process and for the siblings in reverse order`, () => {
    judgesFailTheirPlants();
    const first = scattered(false, 'the garden');
    none(distanceFailures(first.shrubs.map((e) => e.pos), MIN_DISTANCE, SHRUBS), `every pair of ${SHRUBS}' points is at least ${MIN_DISTANCE} m apart`);
    const overlaps = boundsOverlaps(first.shrubs, PROTO_SIDES, TOLERANCE);
    none(overlaps.map((o) => `${SHRUBS}#${o.a} and ${SHRUBS}#${o.b} pass ${o.depth} m into each other`), `with prune: larger_first no two prototype bounds of ${SHRUBS} pass more than ${TOLERANCE} m into each other`);
    expect(boundsOverlaps(first.loose, PROTO_SIDES, TOLERANCE).length, `the same scatter with no pruning (${LOOSE}, ${first.loose.length} elements) leaves bounds that pass into each other, so pruning is what keeps ${SHRUBS} apart`).toBeGreaterThan(0);

    expect(textOf(scattered(false, 'the garden, in a second process')), 'a second process gives the same points').toEqual(textOf(first));
    expect(textOf(scattered(true, 'the garden with its siblings in reverse order')), 'the siblings listed and ordered the other way round give the same points').toEqual(textOf(first));
  }, TIMEOUT);

  it(`${ID} gives the same points on the other CPU architecture`, () => {
    const here = { machine: { platform: process.platform, arch: process.arch }, document: gardenDoc(), points: textOf(scattered(false, 'the garden')) };
    // This machine's record, kept where the other architecture's run can be pointed at it.
    const dir = join(REPO, 'target', 'acceptance-2013');
    const keep = join(dir, `points-${process.platform}-${process.arch}.json`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(keep, `${JSON.stringify(here)}\n`);

    const path = process.env[OTHER];
    if (!path) blocked(`"the same points on every machine" needs a second machine's points: run this test on a machine of the other CPU architecture (x86_64 for this ${process.arch} one, or the reverse; a linux/amd64 container counts for CPU checks) and set ${OTHER} to the record it writes there (target/acceptance-2013/points-<platform>-<arch>.json); this machine's is at target/acceptance-2013/points-${process.platform}-${process.arch}.json`);
    const other = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `the record ${OTHER} names`);
    const arch = obj(other['machine'], `the record ${OTHER} names: machine`)['arch'];
    if (arch === process.arch) blocked(`the record ${OTHER} names is from ${String(arch)}, this machine's own architecture; it must come from the other one`);
    expect(other['document'], `the record ${OTHER} names is of this test's document`).toEqual(here.document);
    expect(other['points'], `the scatters are the same on ${process.arch} and ${String(arch)}, to the last bit`).toEqual(here.points);
  }, TIMEOUT);
});
