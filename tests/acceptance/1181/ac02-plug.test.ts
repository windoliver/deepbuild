// Criterion 2: "With the connector's input open, the load's current and power are 0 at every step, the meter doesn't
// move, and the first step after the input closes carries the current above. A planted library that keeps the last
// current while the connector is open fails `circuit.kcl`, naming the step and the node."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the lamp's circuit (circuits.ts:
// REPLUGGED) at 1,000 steps a second, the plug's input `plug_in` 0 from step 0, 1 from step 1,005 and 0 again from step
// 2,003, for 3,000 steps. On the reference library: at every open step the lamp's rms and instantaneous current and its
// power are 0 and the meter's energy is the step before's; at step 1,005, the first step the input is closed, the lamp
// carries criterion 1's current (at t = 1.005 s the wave is at its crest: 0.028284 A); while closed the meter moves
// by 4.6 W × 1 ms a step, this step's included (README: The state and its arrays: energy), so it reads 998 × 4.6 mJ
// at step 2,002 and keeps that from 2,003. Then the kit's planted library for circuit.kcl, linked by its own name
// (README: Planted twins: kept_current), on the same piece: at step 2,003 it keeps step 2,002's currents in every
// part but the open plug, so the plug's two nodes don't balance; circuit.kcl fails, its first fail naming step 2,003
// and one of those nodes, while the reference library passes it. The wrong programs: current through an open
// connector, a meter that counts while open, a current that comes a step late, and a kcl rule blind to it.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show, str } from '../190/helpers.ts';
import { LAMP, REPLUG, REPLUGGED, index } from './circuits.ts';
import { AC, INTERFACE, KCL, circuitLib, fixturePiece, judgeCall, judged, nums, plantedPiece, playbackCall, played, rule } from './helpers.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: REPLUGGED.steps }, (_, k) => k);
const open = (k: number): boolean => k < REPLUG.in || k >= REPLUG.out;
const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[2]} the plug out, in and out again`, () => {
  it(`${AC[2]} with the connector's input open, the load's current and power are 0 at every step, the meter doesn't move, and the first step after the input closes carries the current above`, () => {
    // The steps chosen: 1.005 s is at the crest, and the step before the plug comes out is not at a zero.
    expect([Math.abs(Math.sin(2 * Math.PI * 50 * REPLUG.in / 1000) - 1) < 1e-12, Math.abs(Math.sin(2 * Math.PI * 50 * (REPLUG.out - 1) / 1000)) > 0.5], 'the plug goes in at a crest and comes out away from a zero').toEqual([true, true]);

    const L = circuitLib();
    const p = fixturePiece(REPLUGGED, INTERFACE, [L.ref], L.assets);
    const [play] = onHost([playbackCall(p, REPLUGGED, STEPS)]);
    const at = played(play!, REPLUGGED.item);
    const [plug, lamp, meter] = ['plug', 'lamp', 'meter'].map((id) => index(REPLUGGED.circuit, id)) as [number, number, number];

    const lit: string[] = [], moved: string[] = [];
    for (const k of STEPS.filter(open)) {
      const a = at.get(k);
      const [i, irms, w] = [nums(a, 'i')[lamp]!, nums(a, 'i_rms')[lamp]!, nums(a, 'p')[lamp]!];
      if (Math.abs(i) > 1e-12 || Math.abs(irms) > 1e-12 || Math.abs(w) > 1e-12) lit.push(`step ${k}: i ${i} A, i_rms ${irms} A, p ${w} W`);
      const e = nums(a, 'energy')[meter]!, before = k === 0 ? 0 : nums(at.get(k - 1), 'energy')[meter]!;
      if (Math.abs(e - before) > 1e-12) moved.push(`step ${k}: ${before} J → ${e} J`);
    }
    expect(lit.slice(0, 10), `with the plug's input open (steps 0 to ${REPLUG.in - 1} and ${REPLUG.out} to ${REPLUGGED.steps - 1}) the lamp's current and power are 0 at every step`).toEqual([]);
    expect(moved.slice(0, 10), 'and the meter doesn\'t move').toEqual([]);
    expect([nums(at.get(REPLUG.in - 1), 'on')[plug], nums(at.get(REPLUG.in), 'on')[plug], nums(at.get(REPLUG.out), 'on')[plug]], 'the plug is open, closed at step 1,005, open again at 2,003').toEqual([0, 1, 0]);

    const first = at.get(REPLUG.in);
    expect(rel(nums(first, 'i_rms')[lamp]!, LAMP.amps), `the first step after the input closes carries 0.02 A rms: ${nums(first, 'i_rms')[lamp]}`).toBeLessThanOrEqual(1e-12);
    expect(rel(nums(first, 'p')[lamp]!, LAMP.watts), `and 4.6 W: ${nums(first, 'p')[lamp]}`).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(nums(first, 'i')[lamp]! - LAMP.peak), `and its instantaneous current at t = 1.005 s, the crest, is 0.028284 A to 1e-9 A: ${nums(first, 'i')[lamp]}`).toBeLessThanOrEqual(1e-9);
    const closedSteps = REPLUG.out - REPLUG.in;
    const read = nums(at.get(REPLUG.out - 1), 'energy')[meter]!;
    expect(rel(read, closedSteps * LAMP.watts / 1000), `while closed the meter moved: ${closedSteps} steps × 4.6 W × 1 ms = ${closedSteps * 4.6e-3} J at step ${REPLUG.out - 1}, read ${read}`).toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);

  it(`${AC[2]} a planted library that keeps the last current while the connector is open fails circuit.kcl, naming the step and the node`, () => {
    const L = circuitLib();
    const reference = fixturePiece(REPLUGGED, INTERFACE, [L.ref], L.assets);
    const planted = plantedPiece(L, KCL, REPLUGGED);
    const [ref, bad] = onHost([judgeCall(reference, REPLUGGED), judgeCall(planted, REPLUGGED)]);

    const passed = rule(judged(ref!, REPLUGGED.item), KCL);
    expect([passed.verdict, passed.fails], `the reference library passes circuit.kcl over the same ${REPLUGGED.steps} steps: ${show(passed.fails as never)}`).toEqual(['PASS', []]);

    const failed = rule(judged(bad!, REPLUGGED.item), KCL);
    expect(failed.verdict, `the planted library that keeps the last current fails circuit.kcl: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails[0]!;
    const plug = REPLUGGED.circuit.parts[index(REPLUGGED.circuit, 'plug')]!;
    expect(num(f['step'], 'the first fail\'s step'), `its first fail names step ${REPLUG.out}, the first step the plug is out again: ${show(f)}`).toBe(REPLUG.out);
    expect([plug['from'], plug['to']], `and a node the open plug joins, live or pin: ${show(f)}`).toContain(str(f['node'], 'the fail\'s node'));
    expect(Math.abs(num(f['sum'], 'the fail\'s sum')), `and a sum the size of the current kept, well past 1e-9 A: ${show(f)}`).toBeGreaterThan(1e-3);
  }, TIMEOUT);
});
