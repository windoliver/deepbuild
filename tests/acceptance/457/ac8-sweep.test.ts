// #457.0a6c6b77: "Under the brief's sweep of a slider s over [0, 1] at 5 samples, a camera whose height above a table a
// driver sets to 0.3 − 0.25·exp(−((s − 0.6) ÷ 0.05)²) m fails clearance 0.15 m at a value of s between 0.56 and 0.64,
// naming the table, the shot and the slider, though no sample brings it within 0.29 m of the table, while a planted
// check that runs only at the sweep's samples passes"
//
// Fixture (helpers.ts `tableShot`): a table whose top is 0.75 m up and, over its middle, a camera the slider `s` (a
// document control over [0, 1]) lowers through the driver `lower` to 0.75 + 0.3 − 0.25·exp(−((s − 0.6) ÷ 0.05)²) m, in
// the 1 s keyed shot `overhead`, aimed at the kept vase 4 m on. The claim's brief sweeps the slider at 5 samples
// (`brief: {sweeps: {s: 5}}`, Control sweep's shape); its requirement is `{kind: camera.framing, keep: [vase],
// clearance: 0.15}`, sweeps at their default, from_brief. At the samples 0, 0.25, 0.5, 0.75 and 1 the camera is at
// least 0.2954 m above the table; it is under 0.15 m for s in (0.5643, 0.6357), 0.05 m at s = 0.6.
//
// asserts:
//   - the fixture's facts, from the closed form;
//   - the row FAILs with a clearance error naming the table, the shot `overhead`, and `sweep: {control: s, value}` with
//     the value between 0.56 and 0.64;
//   - planted `framing_sweeps_samples_only` (camera.framing runs at the sweep's samples alone, with no bound between
//     them): the row PASSes with nothing raised.
// Wrong programs: the base (no sweeps from the brief, no clearance); the planted one; a sweep that names the time but
// not the slider and its value.
import { describe, expect, it } from 'vitest';
import {
  SAMPLES, TABLE_CHECK, TIMEOUT, above, brief, claimId, claimOn, docId, none, passFailures, pathIssues, proof, reqId, rowOf, run, scenarioOf,
  shotOf, shown, sweepOf, tableShot, useBuilds, useFolders, verdict, type Row,
} from './helpers.ts';

const ID = '#457.0a6c6b77';
const builds = useBuilds();
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];

describe(`${ID} camera.framing runs across the brief's control sweeps, bounded between samples`, () => {
  it(`${ID} the slider lowers the camera within 0.15 m of the table only between the sweep's samples; the sweep fails naming the table, the shot and s between 0.56 and 0.64, and a check run only at the samples passes`, () => {
    for (const s of SAMPLES) expect(above(s), `the fixture: at the sample s = ${s} the camera is at least 0.29 m above the table`).toBeGreaterThanOrEqual(0.29);
    expect(above(0.6), 'the fixture: at s = 0.6 the camera is 0.05 m above the table').toBeCloseTo(0.05, 12);
    const judged = (planted?: string): Row => {
      const claims = { [CLAIM]: claimOn(DOC, [[REQ, TABLE_CHECK]], { sweeps: { s: 5 } }) };
      const [v] = run(builds.debug(), scenarioOf(folder(), { [DOC]: tableShot() }, claims, [verdict(CLAIM)], planted ? { planted } : {}));
      return rowOf(v!, REQ, planted ? `the camera over the table under ${planted}` : 'the camera over the table');
    };
    const row = judged();
    proof('table row', row.raw);
    const found = pathIssues(row, 'clearance', 'table');
    const named = found.filter((i) => {
      const { control, value } = sweepOf(i);
      return shotOf(i) === 'overhead' && control === 's' && typeof value === 'number' && value >= 0.56 && value <= 0.64;
    });
    none([
      ...(row.result === 'FAIL' ? [] : [`the camera over the table under the brief's sweep is ${row.result}, not FAIL: ${brief(row.raw)}`]),
      ...(named.length ? [] : [`no clearance error names the table, the shot overhead and the slider s at a value between 0.56 and 0.64; clearance errors naming the table: ${found.map(shown).join(' | ') || 'none'}`]),
    ], 'the sweep fails clearance between its samples, naming the table, the shot and s');

    none(passFailures(judged('framing_sweeps_samples_only'), 'the camera over the table checked at the sweep\'s samples alone'), 'the planted check that runs only at the sweep\'s samples passes, so it fails this criterion');
  }, TIMEOUT);
});
