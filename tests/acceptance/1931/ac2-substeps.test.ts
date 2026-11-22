// Criterion 2: the same orbit world at `substeps: 4` is refused at check, naming the force and `substeps`. A planted
// check that admits it holds each step's force across the 4 substeps, so the orbit gains energy, leaves the 1% band
// within its first turn and fails the fixture, naming it and the step.
import { describe, expect, test } from 'vitest';
import {
  AC, FIRST_TURN, MOON, ORBIT, ORBIT_POINT, ORBIT_STEPS, PULL, TIMEOUT, acceptedFailures, ask, bake, check, codeRefusalFailures, names,
  namesStep, orbitFailures, orbitOf, orbitWorld, prebuild, show, type Orbit,
} from './helpers.ts';

prebuild(['release']);
const PLANTED = 'check_admits_force_substeps';
const held = orbitWorld({ substeps: 4 });

describe(`${AC[2]} a world holding an inverse_square runs at substeps 1: the orbit world at substeps 4 is refused at check`, () => {
  test(`${AC[2]} the orbit world at substeps 4 is refused at check with out_of_range, naming the force ${PULL} and substeps, and the same world at substeps 1 is taken`, () => {
    const run = ask([check(held), check(orbitWorld())]);
    expect(run.problem, `${run.what} answers`).toBe('');
    console.log(`the orbit world at substeps 4: ${show(run.replies[0]!['issues'])}`);
    const failures = [
      ...codeRefusalFailures(run.replies[0]!, { code: 'out_of_range', force: PULL, more: (i) => names(i, 'substeps'), saying: 'substeps' }, 'the orbit world at substeps 4'),
      // The refusal is the substeps', not the law's: the same world at substeps 1 is taken.
      ...acceptedFailures(run.replies[1]!, 'the orbit world at substeps 1'),
    ];
    expect(failures, `the checks of the orbit world:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a planted check that admits it (${PLANTED}) holds each step's force across the 4 substeps: the orbit gains energy, leaves the 1% band within its first turn and fails ${ORBIT}, naming it and the step`, () => {
    const run = ask([check(held), bake(held, ORBIT_STEPS, [MOON])], { planted: PLANTED });
    expect(run.problem, `${run.what} answers: the planted check runs`).toBe('');
    const admitted = acceptedFailures(run.replies[0]!, `the orbit world at substeps 4 under ${PLANTED}`);
    expect(admitted, `${PLANTED} admits the orbit world at substeps 4:\n  ${admitted.join('\n  ')}`).toEqual([]);
    const read = orbitOf(run.replies[1]!, MOON, ORBIT_POINT, `the orbit world at substeps 4 under ${PLANTED}`);
    expect(typeof read === 'string' ? read : '', `${PLANTED} bakes the orbit world at substeps 4`).toBe('');
    const o = read as Orbit;
    console.log(`planted ${PLANTED}: leaves 2 m within 1% at step ${String(o.left)} of a first turn of ${FIRST_TURN} steps, ${o.left === null ? '' : `${o.r[o.left]!.toFixed(4)} m from the point; `}energy ${o.energy[0]!.toFixed(4)} J at the launch, ${o.left === null ? '' : `${o.energy[o.left]!.toFixed(4)} J at that step, `}${o.energy[ORBIT_STEPS]!.toFixed(4)} J at 8 s`);
    // What the admitted world does, as the issue gives it: out of the band within its first turn, its energy above the launch's.
    expect(o.left !== null && o.left <= FIRST_TURN, `the admitted orbit leaves the 1% band within its first turn, ${FIRST_TURN} steps: it leaves at step ${String(o.left)}`).toBe(true);
    expect(o.energy[o.left!]! > o.energy[0]!, `the admitted orbit gains energy: ${o.energy[o.left!]!} J at step ${String(o.left)}, ${o.energy[0]!} J at the launch`).toBe(true);
    // The fixture's judge, which passes the world at substeps 1, fails on it, naming the fixture and the step.
    const failures = orbitFailures(ORBIT, o);
    expect(failures.length, `${PLANTED}: the admitted orbit is caught (the judge finds nothing wrong with it)`).toBeGreaterThan(0);
    expect(failures.some((x) => namesStep(x, ORBIT, o.left!)), `a failure names ${ORBIT} and step ${String(o.left)}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
