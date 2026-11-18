// #457.a5a83f86: "A castle shot whose kept tower has 60% of its in-frame sample points behind a market stall fails
// camera.framing naming the tower, the stall and the share 0.6, and applying its fix as a patch brings the share under
// 0.4 on the next render-back; the twin with the stall moved aside passes"
//
// Fixture (helpers.ts `castle`): the kept tower, a 1 × 5 × 1 m box, 20 m in front of a camera at 3.05 m looking
// level; a 2 m wide market stall 10 m out on the line of sight whose top is at the camera's height, so it hides
// exactly the tower's surface below 3.05 m: (4 × 3.05 + 1) ÷ (4 × 5 + 2) = 0.6 of it by area. Every sample point on
// the tower is in frame. The twin moves the stall 4 m aside, where it hides none. The requirement is
// `{kind: camera.framing, keep: [tower]}`, every other field at its default (occluded_max 0.4, occluded_samples 64).
//
// asserts:
//   - the castle's row FAILs with an error by camera.framing naming the tower in `ids`, `stall` among its
//     `occluders` and its `share` within 0.1 of 0.6, and a fix as patch ops on the document; the row's results list the
//     tower's occluded share (`results[].occluded[] {item, share, occluders}`) the same way;
//   - the twin PASSes with nothing raised, the tower's share 0 with no occluders;
//   - the fix, sent unchanged as alpha's patch on the revision the verdict judged, is applied as the next revision;
//     render-back presents that revision with a snapshot, and the verdict on it judges it: the tower's occluded share
//     is under 0.4 at every checked time and no occlusion failure names the tower.
// The tolerance: the issue states the share as 0.6, one decimal. The fixture hides 0.6 of the tower's true shape by
// area; 64 points quantize a share at 1/64, and the implementer's pattern seeded by the tower's ID places them, so its
// share departs from the area's by that pattern's own unevenness. 0.1 (six points of 64) allows for that and stays
// well clear of the limit 0.4.
// Wrong programs: the base (no occluded share: the castle passes); a share counted from bounds or pixels; a failure
// that names no occluder or no fix; a fix that leaves the tower hidden.
import { describe, expect, it } from 'vitest';
import {
  CASTLE_CHECK, STALL, TIMEOUT, TOWER, brief, castle, claimId, claimOn, docId, fixOps, judgedRev, none, occludedFor, occludersOf, occlusionIssues,
  opFailures, passFailures, patch, patchId, proof, renderBack, reqId, requireMetal, rowOf, run, scenarioOf, shareOf, snapshotOf, useBuilds,
  useFolders, verdict, type JsonObject,
} from './helpers.ts';

const ID = '#457.a5a83f86';
const builds = useBuilds();
const folder = useFolders();
const [CASTLE, TWIN] = [docId(1), docId(2)];
const [C1, C2] = [claimId(1), claimId(2)];
const [R1, R2] = [reqId(1), reqId(2)];
const claims: JsonObject = { [C1]: claimOn(CASTLE, [[R1, CASTLE_CHECK]]), [C2]: claimOn(TWIN, [[R2, CASTLE_CHECK]]) };
const near06 = (s: number | null): boolean => s !== null && Math.abs(s - 0.6) <= 0.1;

describe(`${ID} the castle's tower behind a market stall`, () => {
  it(`${ID} camera.framing fails the tower 60% behind the stall, naming the tower, the stall and the share 0.6 with a fix as patch ops, and the twin with the stall aside passes`, () => {
    const [onCastle, onTwin] = run(builds.debug(), scenarioOf(folder(), { [CASTLE]: castle(), [TWIN]: castle(4) }, claims, [verdict(C1), verdict(C2)]));
    const row = rowOf(onCastle!, R1, 'the castle shot');
    const twin = rowOf(onTwin!, R2, 'the twin with the stall aside');
    proof('castle row', row.raw);
    const failures: string[] = [];
    if (row.result !== 'FAIL') failures.push(`the castle shot is ${row.result}, not FAIL: ${brief(row.raw)}`);
    const named = occlusionIssues(row, TOWER.id).filter((i) => occludersOf(i).includes(STALL.id) && near06(shareOf(i)));
    if (named.length === 0) failures.push(`no camera.framing error names the tower with ${STALL.id} among its occluders and a share within 0.1 of 0.6: ${brief(row.raw['issues'] ?? null)}`);
    else {
      const withOps = named.filter((i) => fixOps(i) !== null);
      if (withOps.length === 0) failures.push(`the tower's occlusion failure names its fix as text, not patch ops: ${brief(named[0]!.raw)}`);
      else if (withOps.every((i) => opFailures(fixOps(i)!, castle(), 'the fix').length > 0)) failures.push(...opFailures(fixOps(withOps[0]!)!, castle(), "the tower's fix"));
    }
    const read = occludedFor(row, TOWER.id, 'the castle shot');
    if (!read.some((o) => o.occluders.includes(STALL.id) && near06(o.share))) failures.push(`the results' occluded share of the tower isn't within 0.1 of 0.6 behind the stall: ${brief(read.map((o) => o.raw))}`);
    failures.push(...passFailures(twin, 'the twin with the stall moved aside'));
    for (const o of occludedFor(twin, TOWER.id, 'the twin')) if (o.share !== 0 || o.occluders.length > 0) failures.push(`the twin's tower reads share ${o.share} behind ${o.occluders.join(', ') || 'nothing'}, not 0`);
    none(failures, 'the hidden tower fails naming the tower, the stall and the share, and the twin passes');
  }, TIMEOUT);

  it(`${ID} applying the tower's fix as a patch brings its share under 0.4 on the next render-back`, () => {
    requireMetal('render-back of the castle shot');
    const castleOnly = { [C1]: claims[C1]! };
    const [first] = run(builds.debug(), scenarioOf(folder(), { [CASTLE]: castle() }, castleOnly, [verdict(C1)]));
    const failing = occlusionIssues(rowOf(first!, R1, 'the castle shot'), TOWER.id).find((i) => fixOps(i) !== null);
    expect(failing, `the castle shot names the tower's occlusion fix as patch ops: ${brief(first!)}`).toBeDefined();
    const base = judgedRev(first!, CASTLE) ?? 0;
    const ops = fixOps(failing!)!;
    proof('the fix', ops);
    const [applied, drawn, after] = run(builds.debug(), scenarioOf(folder(), { [CASTLE]: castle() }, castleOnly, [
      patch(CASTLE, patchId(1), base, ops, "camera.framing's fix for the hidden tower"), renderBack(CASTLE, base + 1), verdict(C1),
    ]));
    expect(applied!['outcome'], `the fix is applied as alpha's patch: ${brief(applied!)}`).toBe('applied');
    expect(applied!['rev'], 'the patch makes the next revision').toBe(base + 1);
    const snap = snapshotOf(drawn!, base + 1, 'the fixed castle shot');
    expect(typeof snap === 'string' ? snap : '', 'render-back presents the fixed revision with a snapshot').toBe('');
    expect(judgedRev(after!, CASTLE), 'the verdict after it judges the fixed revision').toBe(base + 1);
    const row = rowOf(after!, R1, 'the fixed castle shot');
    proof('fixed castle row', row.raw);
    const failures: string[] = [];
    for (const o of occludedFor(row, TOWER.id, 'the fixed castle shot')) if (o.share === null || !(o.share < 0.4)) failures.push(`after the fix the tower's occluded share reads ${o.share} behind ${o.occluders.join(', ') || 'nothing'}, not under 0.4`);
    for (const i of occlusionIssues(row, TOWER.id)) failures.push(`after the fix camera.framing still fails the tower's occlusion: ${brief(i.raw)}`);
    none(failures, "the tower's fix brings its share under 0.4");
  }, TIMEOUT);
});
