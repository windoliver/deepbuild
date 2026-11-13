// #405.4b5d7511: "A lid whose lift a driver sets to 0.05·exp(−((s − 0.6) ÷ 0.05)²) m from a slider s over [0, 1],
// swept with 5 samples under a shelf 0.03 m above the lid's top, rises under 1 mm at every sample, yet the sweep fails
// the geometry audit, naming the lid, the shelf and a value of s between 0.56 and 0.64, where the lid passes into the
// shelf, while a planted sweep that audits its 5 samples alone passes it; and with the lid lifted through a physics
// world instead, the sweep lists its 5 samples as an estimate, and a definition's geometry audit over the slider's
// range is refused at check, naming the slider and the range"
//
// Fixtures (helpers.ts), each shown by the working agent alpha through deep_show:
//   - `lidScene`: a base plate, two posts and a shelf on them whose underside is 0.03 m above the top of `lid`, a box
//     resting on the base. The slider `lift` (s, a document control over [0, 1]) feeds the driver `raise`, which writes
//     the lid's y as 0.03 + 0.05·exp(−((s − 0.6) ÷ 0.05)²) m (`exp(-pow((s - 0.6) / 0.05, 2))`, from the closed
//     function list). At the samples s = 0, 0.25, 0.5, 0.75 and 1 the lid rises at most 0.92 mm; for s in
//     (0.5643, 0.6357) it passes into the shelf, 0.02 m deep at s = 0.6.
//   - `physicsLidScene`: the same frame, the lid now the one body of a baked physics world (`fixture.world@1`, zero
//     gravity) resting on the base under the shelf, 0.03 m below it; the driver `raise` writes the body's starting
//     height from the slider, so the slider moves the lid only through the world.
// The check, a requirement of a claim of alpha's on each scene: `{kind: geometry.audit, scope: scene, sweeps: {lift:
// 5}, support: {floating: …}}` (the base, and in the driver's scene the lid the slider lifts).
//
// asserts:
//   - the fixture: the lift is under 1 mm at all five samples and 0.05 m, past the 0.03 m gap, at s = 0.6;
//   - the driver's lid: FAIL; at least one geometry.overlap error naming exactly the lid and the shelf with
//     `sweep: {control: lift, value}`, the value in [0.56, 0.64]; every error and warning raised is such an overlap;
//   - the planted `sweep_audits_samples_only` (the scenario's `planted`: the sweep runs the audit at its 5 samples and
//     nothing between them): the same claim PASSes, nothing raised;
//   - the physics lid: the requirement is refused at check, INVALID, its refusal `{code: sweep_unbounded, control: lift,
//     range: [0, 1]}`, and the row lists the sweep's 5 samples as an estimate, `estimates: [{control: lift, samples:
//     [0, 0.25, 0.5, 0.75, 1]}]`.
import { describe, expect, it } from 'vitest';
import {
  FULL, LID_CHECK, PHYSICS_CHECK, SAMPLES, SLIDER, TIMEOUT, brief, claimId, claimOf, docId, estimatesOf, isRange, lidScene, lift, none,
  passFailures, physicsLidScene, presented, raised, refusalsOf, reqId, rowOf, run, scenarioOf, show, sweepOf, useBuilds, useFolders, verdict,
  type Row,
} from './helpers.ts';

/** The criterion's ID: `#405.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#405.4b5d7511';
const bin = useBuilds([FULL]);
const folder = useFolders();

const LID = docId(1);
const PHYSICS = docId(2);
const sameSamples = (got: readonly number[] | null): boolean => got !== null && got.length === SAMPLES.length && got.every((s, i) => Math.abs(s - SAMPLES[i]!) <= 1e-9);

/** The sweep fails between its samples: overlaps of the lid and the shelf at s in [0.56, 0.64], and nothing else. */
function betweenSamplesFailures(row: Row): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`the sweep of the lid is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const all = raised(row);
  const found = all.filter((i) => {
    const { control, value } = sweepOf(i.raw);
    return i.code === 'geometry.overlap' && i.severity === 'error' && i.ids.join() === 'lid,shelf' && control === SLIDER && value !== null && value >= 0.56 && value <= 0.64;
  });
  if (!found.length) failures.push(`no geometry.overlap error names the lid, the shelf and the slider ${SLIDER} at a value of s in [0.56, 0.64]: ${brief(all.map((i) => i.raw))}`);
  for (const i of all.filter((x) => !found.includes(x))) failures.push(`the sweep raises ${i.code} (${i.severity}) naming ${i.ids.join(', ') || 'nothing'} at ${brief(sweepOf(i.raw))}, not the lid passing into the shelf at s in [0.56, 0.64]: ${brief(i.raw, 600)}`);
  return failures;
}

describe(`${ID} a control sweep bounds the slider's whole range between its samples, and refuses what it can only sample`, () => {
  it(`${ID} the lid rises under 1 mm at every sample, yet the sweep fails naming the lid, the shelf and s in [0.56, 0.64]; a planted sweep that audits its 5 samples alone passes it`, () => {
    for (const s of SAMPLES) expect(lift(s), `the fixture: the lid rises under 1 mm at s = ${s}`).toBeLessThan(0.001);
    expect(lift(0.6), 'the fixture: at s = 0.6 the lid rises past the 0.03 m gap').toBeGreaterThan(0.03);

    const claims = { [claimId(1)]: claimOf(LID, reqId(1), LID_CHECK) };
    const judged = (planted?: string): Row => {
      const [shown, v] = run(bin(FULL), scenarioOf(folder(), [LID], claims, [show(LID, lidScene()), verdict(claimId(1))], planted));
      presented(shown!, 'the lid under the shelf');
      return rowOf(v!, reqId(1), 'the lid under the shelf');
    };
    none(betweenSamplesFailures(judged()), 'the sweep fails between its samples, naming the lid, the shelf and s');
    none(passFailures(judged('sweep_audits_samples_only'), 'the planted sweep that audits its 5 samples alone'), 'the planted sweep passes the lid on its samples, so it fails this criterion');
  }, TIMEOUT);

  it(`${ID} with the lid lifted through a physics world, the sweep lists its 5 samples as an estimate and the definition's audit over the slider's range is refused at check, naming the slider and the range`, () => {
    const claims = { [claimId(2)]: claimOf(PHYSICS, reqId(2), PHYSICS_CHECK) };
    const [shown, v] = run(bin(FULL), scenarioOf(folder(), [PHYSICS], claims, [show(PHYSICS, physicsLidScene()), verdict(claimId(2))]));
    presented(shown!, 'the lid a physics world lifts');
    const row = rowOf(v!, reqId(2), 'the lid a physics world lifts');
    expect(row.result, `the definition's audit over the slider's range is refused at check, INVALID, never decided on samples: ${brief(row.raw)}`).toBe('INVALID');
    const refusal = refusalsOf(row).find((r) => r['code'] === 'sweep_unbounded');
    expect(refusal, `the refusal sweep_unbounded is listed: ${brief(row.raw)}`).toBeDefined();
    expect(refusal!['control'], `the refusal names the slider: ${brief(refusal)}`).toBe(SLIDER);
    expect(isRange(refusal!['range'], 0, 1), `the refusal names the range [0, 1]: ${brief(refusal)}`).toBe(true);
    const estimate = estimatesOf(row).find((e) => e.control === SLIDER);
    expect(estimate, `the sweep of ${SLIDER} is listed as an estimate: ${brief(row.raw['estimates'] ?? null)}`).toBeDefined();
    expect(sameSamples(estimate!.samples), `the estimate lists the sweep's 5 samples, ${SAMPLES.join(', ')}: ${brief(estimate!.raw)}`).toBe(true);
  }, TIMEOUT);
});
