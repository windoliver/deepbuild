// #457.b79d8a1e: "A keyed camera whose height a driver sets to 1.4 + 0.1·sin(30πt) m, under a ceiling at 1.6 m with
// clearance 0.15 m, fails clearance at the sine's peaks, t = 1/60 s first, with a least distance of 0.1 m, naming the
// ceiling and the shot, while a planted check that samples only 30 times a second finds 0.2 m at every sample and
// passes"
//
// Fixture (helpers.ts `bobbing`): a ceiling slab whose underside is 1.6 m up over the camera; the driver `bob` sets
// the camera's height to 1.4 + 0.1·sin(30πt) m through the 1 s keyed shot `hall`; the kept marker 6 m on, well below
// the ceiling. The requirement is `{kind: camera.framing, keep: [marker], clearance: 0.15}`.
// At t = k/30 s the sine is 0, so every 30 Hz sample (the shot's start and end among them) finds the camera at 1.4 m,
// 0.2 m below the ceiling; at t = 1/60 s, and every 1/15 s after, it peaks at 1.5 m, 0.1 m below it.
//
// asserts:
//   - the row FAILs with clearance errors naming the ceiling and the shot `hall`; the earliest is at 1/60 s (within
//     1/300 s, the span over which the distance stays within 5 mm of its least) with a least distance of 0.1 m
//     (within 0.005 m), and none is earlier;
//   - planted `paths_sampled_at_30hz` (path measures read at 30 Hz with no bound between samples): the row PASSes with
//     nothing raised.
// Wrong programs: the base (it samples a film's shot at 30 Hz and reads no clearance); the planted one; a bound that
// finds the dip but names no time or the wrong peak; a distance from the camera's samples, not its bound.
import { describe, expect, it } from 'vitest';
import {
  BOB_CHECK, TIMEOUT, bob, brief, bobbing, claimId, claimOn, docId, none, passFailures, pathIssues, proof, reqId, rowOf, run, scenarioOf,
  secondsOf, shotOf, shown, useBuilds, useFolders, valueOf, verdict, type Row,
} from './helpers.ts';

const ID = '#457.b79d8a1e';
const builds = useBuilds();
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const PEAK = 1 / 60;

describe(`${ID} clearance is bounded between the path's samples`, () => {
  it(`${ID} the bobbing camera fails clearance at the sine's first peak, 1/60 s, 0.1 m under the ceiling, naming the ceiling and the shot, while a check sampled only at 30 Hz finds 0.2 m and passes`, () => {
    for (let k = 0; k <= 30; k++) expect(1.6 - bob(k / 30), `the fixture: at the 30 Hz sample ${k}/30 s the camera is 0.2 m under the ceiling`).toBeCloseTo(0.2, 12);
    expect(1.6 - bob(PEAK), 'the fixture: at 1/60 s the camera is 0.1 m under the ceiling').toBeCloseTo(0.1, 12);
    const judged = (planted?: string): Row => {
      const [v] = run(builds.debug(), scenarioOf(folder(), { [DOC]: bobbing() }, { [CLAIM]: claimOn(DOC, [[REQ, BOB_CHECK]]) }, [verdict(CLAIM)], planted ? { planted } : {}));
      return rowOf(v!, REQ, planted ? `the bobbing camera under ${planted}` : 'the bobbing camera');
    };
    const row = judged();
    proof('bobbing camera row', row.raw);
    const found = pathIssues(row, 'clearance', 'ceiling').filter((i) => shotOf(i) === 'hall' && secondsOf(i) !== null).sort((a, b) => secondsOf(a)! - secondsOf(b)!);
    const first = found[0];
    none([
      ...(row.result === 'FAIL' ? [] : [`the bobbing camera is ${row.result}, not FAIL: ${brief(row.raw)}`]),
      ...(first ? [] : [`no clearance error names the ceiling, the shot hall and a time; it raises: ${row.issues.map(shown).join(' | ') || 'nothing'}`]),
      ...(first && Math.abs(secondsOf(first)! - PEAK) > 1 / 300 ? [`the first clearance failure is at ${secondsOf(first)} s, not the sine's first peak at 1/60 s: ${shown(first)}`] : []),
      ...(first && (valueOf(first) === null || Math.abs(valueOf(first)! - 0.1) > 0.005) ? [`the first clearance failure's least distance is ${valueOf(first)} m, not 0.1 m: ${shown(first)}`] : []),
    ], "clearance fails at the sine's first peak with a least distance of 0.1 m");

    none(passFailures(judged('paths_sampled_at_30hz'), 'the bobbing camera sampled only at 30 Hz'), 'the planted check that samples only 30 times a second passes, so it fails this criterion');
  }, TIMEOUT);
});
