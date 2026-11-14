// #522.dfeb8487: "physics.determinism with at_times [2 s, 5 s, 9 s] passes the ball-and-goal lab with its eight grabs;
// a planted restore without warm-start impulses fails on a continuation probe, naming the input and the first step that
// differs"
//
// The lab is #2010's ball-and-goal lab taking a grab and a release of its ball, with its eight recorded grabs, each
// released 0.2 s later, over 10 s (README: Worlds). physics.determinism is the `determinism` call (README): the bake
// twice from step 0, once from each checkpoint before each sampled time, and a continuation probe for each input the
// world declares at each sampled time, from the straight state and from each restored state. Under
// `--planted restore_without_warm_start` every restore drops the contacts' and joints' warm-start impulses; the check
// must fail, and among its failures one is a continuation probe naming one of the lab's inputs and the first step
// that differs.
import { describe, expect, it } from 'vitest';
import { CRITERIA, EIGHT_GRABS, LAB_INPUTS, LAB_STEPS, TIMEOUT, ask, determinismCall, determinismOf, lab, prebuild, show } from './helpers.ts';

prebuild();

const ID = CRITERIA[8];
const AT_TIMES = [2, 5, 9];
const SAMPLED = AT_TIMES.map((s) => s * 120);
const INPUTS = Object.keys(LAB_INPUTS);

describe(`${ID} physics.determinism over the ball-and-goal lab with its eight grabs, and a restore without warm-start impulses`, () => {
  it(`${ID} physics.determinism with at_times [2 s, 5 s, 9 s] passes the lab with its eight grabs`, () => {
    const [reply] = ask([determinismCall(lab(), EIGHT_GRABS, LAB_STEPS, AT_TIMES)]);
    const d = determinismOf(reply, 'physics.determinism of the lab');
    expect(d.failures.map((f) => f.raw), 'no run disagrees').toEqual([]);
    expect(d.verdict, 'it passes').toBe('PASS');
  }, TIMEOUT);

  it(`${ID} a planted restore without warm-start impulses (restore_without_warm_start) fails on a continuation probe, naming the input and the first step that differs`, () => {
    const [reply] = ask([determinismCall(lab(), EIGHT_GRABS, LAB_STEPS, AT_TIMES)], { planted: 'restore_without_warm_start' });
    const d = determinismOf(reply, 'physics.determinism of the lab, restores without warm-start impulses');
    expect(d.verdict, 'it fails').toBe('FAIL');
    const probes = d.failures.filter((f) => f.run === 'probe');
    expect(probes.length, `it fails on a continuation probe; its failures: ${show(d.failures.map((f) => f.raw))}`).toBeGreaterThan(0);
    const named = probes.filter((f) => f.input !== null && INPUTS.includes(f.input) && f.at !== null && SAMPLED.includes(f.at) && f.step !== null && f.step > f.at);
    expect(named.length, `a probe failure names one of the lab's inputs (${INPUTS.join(', ')}), its sampled step and the first step after it that differs: ${show(probes.map((f) => f.raw))}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
