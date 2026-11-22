// Criterion 2: "One source with exponential gaps at a mean of 2 min into one resource that holds each entity for an
// exponential time with a mean of 1 min, seeded, over 100,000 arrivals: the mean time in system is within 5% of 2 min and
// the mean work in progress within 5% of 1, and the same seed gives the same statistics arrays byte for byte."
//
// Through `deep-logic first_party` and `bake` (README: The surface): the M/M/1 scene (scenes.ts: MM1) at a 1 s tick, an
// hour (3,600 ticks) a step, its statistics over a window longer than the run, so `mean` and `wip` in all (index N) are
// the whole run's. Theory (fixtures.ts: ANSWERS.mm1): λ = 1/120 s⁻¹, μ = 1/60 s⁻¹, W = 1/(μ − λ) = 120 s, L = λW = 1.
// The run's statistics are read at the first step whose end has 100,000 made. The draws are README: Random draws',
// keyed by the seed `init` gets (the logic module's hash of the document's seed, the item and step 0): two pieces of
// document seed 980 in two processes write the same bytes in every array at every step, and one of seed 981 differs,
// so the gaps are the seed's. Why a 1 s tick and an hour a step: README: Readings (criterion 2's run).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild, type Bake } from '../190/helpers.ts';
import { ANSWERS } from './fixtures.ts';
import { AC, INTERFACE, carry, layout, processLib, scenePiece } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { MM1, MM1_ARRIVALS, MM1_STEPS, stationCount } from './scenes.ts';

prebuild(() => { logicBin(); });

const NAMES = Object.keys(processWrites(MM1));

describe(`${AC[2]} M/M/1 at ρ = 0.5, seeded`, () => {
  it(`${AC[2]} over 100,000 arrivals the mean time in system is within 5% of 2 min and the mean work in progress within 5% of 1, and the same seed gives the same statistics arrays byte for byte`, () => {
    const lambda = 1 / 120, mu = 1 / 60, W = 1 / (mu - lambda);
    expect([W, lambda * W], `${ANSWERS.mm1}`).toEqual([120, 1]);

    const L = processLib();
    layout(processWrites(MM1));
    const program = sceneProgram(MM1, INTERFACE);
    const assets = carry({ ...L.assets }, program);
    const run = (seed: number): Bake => {
      const [reply] = onHost([bakeCall(scenePiece(MM1, 'mm1', INTERFACE, [L.ref], assets, [], seed), MM1_STEPS)]);
      return bakeOf(reply!, `the M/M/1 run of document seed ${seed}`);
    };
    const a = run(980);
    const N = stationCount(MM1);
    const made = a.steps.map((s) => num((s.arrays['mm1.made_n'] as number[])[0], `made_n at step ${s.step}`));
    const k = made.findIndex((m) => m >= MM1_ARRIVALS);
    expect(k, `the run reaches 100,000 arrivals within ${MM1_STEPS} hours (made at the last step: ${made.at(-1)})`).toBeGreaterThanOrEqual(0);
    const at = a.steps[k]!.arrays;
    const meanW = num((at['mm1.mean'] as number[])[N], 'mean in all'), wip = num((at['mm1.wip'] as number[])[N], 'wip in all');
    const window = (at['mm1.clock'] as number[]);
    console.log(`${AC[2]} after ${made[k]} arrivals (step ${k}, ${window[0]} s): mean time in system ${meanW} s, mean work in progress ${wip}`);
    expect(Math.abs(meanW / 120 - 1), `the mean time in system ${meanW} s is within 5% of 120 s`).toBeLessThanOrEqual(0.05);
    expect(Math.abs(wip - 1), `the mean work in progress ${wip} is within 5% of 1`).toBeLessThanOrEqual(0.05);

    // The same seed in another process: every array, every step, byte for byte; another seed: not.
    const b = run(980);
    const c = run(981);
    const bytes = (x: Bake): string[] => x.steps.map((s) => JSON.stringify(NAMES.map((n) => s.arrays[`mm1.${n}`])));
    const [ax, bx, cx] = [bytes(a), bytes(b), bytes(c)];
    expect(ax.length, 'both runs bake every step').toBe(MM1_STEPS);
    const differs = ax.findIndex((s, i) => s !== bx[i]);
    expect(differs, `the same seed gives the same statistics arrays byte for byte (first difference at step ${differs})`).toBe(-1);
    expect(ax.some((s, i) => s !== cx[i]), 'document seed 981 draws other gaps: its arrays differ').toBe(true);
  }, TIMEOUT);
});
