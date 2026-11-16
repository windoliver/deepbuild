// #457.20f148ec: "Adding an item elsewhere in the scene moves none of a kept item's sample points, and the occluded
// share is equal on macOS and Linux, from evaluated data"
//
// Fixture: criterion 1's castle shot (helpers.ts `castle`), and the same with a well added far to the tower's side
// (8 m right, 3 m back), ordered before the tower in the document, where it hides nothing. The requirement is
// criterion 1's. The machine is #138's scenario `environment` (the convention #1938's machines test proved a reading
// equal across machines by): `{os: macos, driver: metal}` and `{os: linux, driver: vulkan}`, each its own process.
//
// asserts:
//   - on macOS: the tower's occluded entry (`results[].occluded[]`) lists its 64 sample points (`points`, world metres),
//     each on its true shape (the surface of its box, within 1e-9 of it); with the well added the 64 points are the
//     same numbers in the same order, and the share and occluders are the same;
//   - on Linux: the row says `machines: any`, and the tower's entries (share, occluders and points) are macOS's exactly;
//   - planted `occluded_samples_by_order` (each kept item's pattern seeded by its place in the document's item order,
//     not by its ID): adding the well moves the tower's points, so the equality above fails on it.
// Wrong programs: the base (no occluded share or points); a pattern seeded by order, by a shared stream or by the
// scene's contents; points off the true shape (on its bounds' corners, or its pixels); a share read from pixels
// (`machines: same`, or another number on another machine).
import { describe, expect, it } from 'vitest';
import {
  CASTLE_CHECK, TIMEOUT, TOWER, box, brief, castle, claimId, claimOn, docId, none, occludedFor, onTower, proof, reqId, rowOf, run, same,
  scenarioOf, useBuilds, useFolders, verdict, withItem, type JsonObject, type JsonValue, type Occluded,
} from './helpers.ts';

const ID = '#457.20f148ec';
const builds = useBuilds();
const folder = useFolders();
const MACOS = { os: 'macos', driver: 'metal' };
const LINUX = { os: 'linux', driver: 'vulkan' };
const [ALONE, WELL] = [docId(1), docId(2)];
const [C1, C2] = [claimId(1), claimId(2)];
const [R1, R2] = [reqId(1), reqId(2)];
/** The castle with a stone well 8 m right of the tower and 3 m back, drawn before the tower (after the camera). */
const withWell = (): JsonObject => withItem(castle(), 'well', box([1, 1, 1], [8, 0.5, -3], 'stone'), 'a0000');
const claims: JsonObject = { [C1]: claimOn(ALONE, [[R1, CASTLE_CHECK]]), [C2]: claimOn(WELL, [[R2, CASTLE_CHECK]]) };
const entry = (o: Occluded): JsonValue => ({ share: o.share, occluders: o.occluders, points: o.points });

describe(`${ID} a kept item's sample points don't move, and its share is the same on macOS and Linux`, () => {
  it(`${ID} adding an item elsewhere moves none of the tower's 64 points on its true shape, and the share is equal on macOS and Linux from evaluated data; seeded by order, the points move`, () => {
    const towers = (planted?: string): [Occluded[], Occluded[]] => {
      const [a, b] = run(builds.debug(), scenarioOf(folder(), { [ALONE]: castle(), [WELL]: withWell() }, claims, [verdict(C1), verdict(C2)], { environment: MACOS, ...(planted ? { planted } : {}) }));
      return [occludedFor(rowOf(a!, R1, 'the castle'), TOWER.id, 'the castle'), occludedFor(rowOf(b!, R2, 'the castle with a well'), TOWER.id, 'the castle with a well')];
    };
    const [alone, well] = towers();
    proof('the tower on macOS', alone.map(entry));
    const failures: string[] = [];
    alone.forEach((o, k) => {
      if (o.points === null || o.points.length !== 64) { failures.push(`checked time ${k}: the tower's entry lists ${o.points?.length ?? 'no'} sample points, not 64: ${brief(o.raw, 600)}`); return; }
      const off = o.points.filter((p) => Math.abs(onTower(p) - 1) > 1e-9);
      if (off.length) failures.push(`checked time ${k}: ${off.length} of the tower's sample points aren't on its true shape, e.g. ${brief(off[0]!)}`);
    });
    if (alone.length !== well.length) failures.push(`the tower is read at ${alone.length} checked times alone and ${well.length} with the well`);
    alone.forEach((o, k) => {
      const w = well[k];
      if (!w || !same(entry(o), entry(w))) failures.push(`checked time ${k}: with the well added the tower reads ${brief(w ? entry(w) : null, 600)}, alone ${brief(entry(o), 600)}`);
    });
    none(failures, "the tower's 64 sample points lie on its true shape and stay put when an item is added elsewhere");

    const [onLinux] = run(builds.debug(), scenarioOf(folder(), { [ALONE]: castle() }, { [C1]: claims[C1]! }, [verdict(C1)], { environment: LINUX }));
    const linuxRow = rowOf(onLinux!, R1, 'the castle on Linux');
    expect(linuxRow.raw['machines'], "camera.framing's result holds on any machine: it reads evaluated data, not pixels").toBe('any');
    const linux = occludedFor(linuxRow, TOWER.id, 'the castle on Linux');
    expect(linux.map(entry), "the tower's occluded share, occluders and points on Linux are macOS's").toEqual(alone.map(entry));

    const [byOrderAlone, byOrderWell] = towers('occluded_samples_by_order');
    expect(same(byOrderAlone.map(entry), byOrderWell.map(entry)), 'under occluded_samples_by_order, adding the well moves the tower\'s sample points, so the equality above fails on it').toBe(false);
  }, TIMEOUT);
});
