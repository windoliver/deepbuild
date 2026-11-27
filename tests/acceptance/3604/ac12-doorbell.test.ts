// Criterion 12: "A transformer with `turns: [115, 6]` on the 230 V source feeds a load rated 6 W at 12 V. The secondary
// reads 12 V rms and 0.5 A, the primary 0.026087 A, and the source gives 6 W; `circuit.kcl` and `circuit.power` pass at
// every step. A planted library whose primary carries the secondary's current fails `circuit.power`, naming the step
// and a gap of 109 W. A DC source on the primary's network is refused at check, naming the source and the
// transformer."
//
// Through `deep-logic first_party`, `playback`, `judge` and `check` (README: The surface): the doorbell (circuits.ts:
// DOORBELL), its transformer's primary across the mains and its secondary feeding the bell on two nodes of their own,
// 1,000 steps a second, 40 steps (two cycles). By hand: 230 × 6 ÷ 115 = 12 V; the bell is 12² ÷ 6 = 24 Ω, 0.5 A; the
// primary 0.5 × 6 ÷ 115 = 0.026087 A; the source 230 × 0.026087 = 6 W, all of it the bell's. The secondary's rms volts
// are read from its nodes, √(mean of (v[bell_a] − v[bell_b])²) over one cycle, 20 steps of a 50 Hz wave, which is the
// rms exactly. model.ts' nodal solve gives the same. Then the planted library `primary_current`, linked by its own
// name: the primary carries 0.5 A, so the source gives 115 W against the bell's 6 W, and circuit.power fails at step 0
// with a gap of 109 W. And the doorbell with a 12 V battery joined to its primary's network (DOORBELL_DC) is refused,
// `logic_refused` with a refusal whose `parts` name both `battery` and `bell_tx`. The wrong programs: turns read the
// wrong way round (4,408 V), a primary that carries the secondary's current, a transformer that takes power or none
// passed on, and a check that solves a transformer on DC.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, checkCall, logicBin, num, onHost, prebuild, refusedOf, show } from '../190/helpers.ts';
import { BELL, DOORBELL, DOORBELL_DC, index } from './circuits.ts';
import { AC, KCL, POWER, circuitLib, judgeCall, judged, nums, plantedPiece, playbackCall, played, refPiece, rel, rule } from './helpers.ts';
import { solveRms } from './model.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: DOORBELL.steps }, (_, k) => k);
const [mains, tx, bell] = ['mains', 'bell_tx', 'bell'].map((id) => index(DOORBELL.circuit, id)) as [number, number, number];
const [a, b] = [DOORBELL.circuit.nodes.indexOf('bell_a'), DOORBELL.circuit.nodes.indexOf('bell_b')];

describe(`${AC[12]} a doorbell transformer`, () => {
  it(`${AC[12]} turns [115, 6] on the 230 V source feeding 6 W at 12 V: the secondary reads 12 V rms and 0.5 A, the primary 0.026087 A, the source gives 6 W, and circuit.kcl and circuit.power pass at every step`, () => {
    const m = solveRms(DOORBELL.circuit);
    expect([rel(Math.abs(m.v[a]! - m.v[b]!), 12) < 1e-12, rel(Math.abs(m.i[bell]!), 0.5) < 1e-12, rel(Math.abs(m.i2[tx]!), 0.5) < 1e-12, rel(Math.abs(m.i[tx]!), BELL.primary) < 1e-12, Math.abs(BELL.primary - 0.026087) < 5e-7], `by hand and by the nodal solve: 12 V, 0.5 A, 0.026087 A (${show(m as never)})`).toEqual([true, true, true, true, true]);

    const L = circuitLib();
    const p = refPiece(L, [DOORBELL]);
    const [play, judge] = onHost([playbackCall(p, DOORBELL, STEPS), judgeCall(p, DOORBELL)]);
    const at = played(play!, DOORBELL.item);
    const volts = Math.sqrt(STEPS.slice(0, 20).reduce((s, k) => s + (nums(at.get(k), 'v')[a]! - nums(at.get(k), 'v')[b]!) ** 2, 0) / 20);
    expect(rel(volts, BELL.volts), `the secondary reads ${volts} V rms over a cycle: 12 V within 1e-9 relative`).toBeLessThanOrEqual(1e-9);
    const bad = STEPS.flatMap((k) => {
      const x = at.get(k);
      const got = { secondary: nums(x, 'i2_rms')[tx]!, bell: nums(x, 'i_rms')[bell]!, primary: nums(x, 'i_rms')[tx]!, source: nums(x, 'p')[mains]!, taken: nums(x, 'p')[tx]! };
      const ok = rel(got.secondary, BELL.amps) <= 1e-9 && rel(got.bell, BELL.amps) <= 1e-9 && rel(got.primary, BELL.primary) <= 1e-9 && rel(got.source, BELL.watts) <= 1e-9 && Math.abs(got.taken) <= 1e-9;
      return ok ? [] : [`step ${k}: ${show(got as never)}`];
    });
    expect(bad.slice(0, 5), 'at every step the secondary and the bell carry 0.5 A, the primary 0.026087 A, the source gives 6 W and the transformer takes none').toEqual([]);
    const j = judged(judge!, DOORBELL.item);
    for (const code of [KCL, POWER]) {
      const r = rule(j, code);
      expect([r.verdict, r.steps, r.fails], `${code} passes at every one of the ${DOORBELL.steps} steps: ${show(r.fails as never)}`).toEqual(['PASS', DOORBELL.steps, []]);
    }
  }, TIMEOUT);

  it(`${AC[12]} a planted library whose primary carries the secondary's current fails circuit.power, naming the step and a gap of 109 W`, () => {
    expect(BELL.plantedGap, '230 V × 0.5 A − 6 W = 109 W').toBe(109);
    const L = circuitLib();
    const [bad] = onHost([judgeCall(plantedPiece(L, 'primary_current', DOORBELL), DOORBELL)]);
    const failed = rule(judged(bad!, DOORBELL.item), POWER);
    expect(failed.verdict, `circuit.power fails: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails[0]!;
    expect(num(f['step'], 'the fail\'s step'), `its first fail names step 0: ${show(f)}`).toBe(0);
    expect(Math.abs(Math.abs(num(f['gap'], 'the fail\'s gap')) - 109), `and a gap of 109 W, within 1e-6 of the 115 W the source gives: ${show(f)}`).toBeLessThanOrEqual(1e-6 * 115);
  }, TIMEOUT);

  it(`${AC[12]} a DC source on the primary's network is refused at check, naming the source and the transformer`, () => {
    const L = circuitLib();
    const [refused, admitted] = onHost([checkCall(refPiece(L, [DOORBELL_DC])), checkCall(refPiece(L, [DOORBELL]))]);
    const r = refusedOf(refused!, 'the check of the doorbell with a battery on its primary\'s network');
    expect([r.code, r.item], 'it is refused at check, naming the item').toEqual(['logic_refused', DOORBELL_DC.item]);
    const both = r.refusals.filter((x) => Array.isArray(x['parts']) && ['battery', 'bell_tx'].every((id) => (x['parts'] as unknown[]).includes(id)));
    expect(both.length, `a refusal names the source and the transformer: ${show(r.refusals as never)}`).toBeGreaterThan(0);
    expect(admitted!['ok'], `the doorbell without the battery is admitted: ${show(admitted)}`).toBe(true);
  }, TIMEOUT);
});
