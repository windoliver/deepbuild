// Criterion 1: a 2 kg body 2 m from the point of `inverse_square {k: −4π² N·m²}` (−39.478 N·m²), launched at π m/s
// (3.1416 m/s) square to the line, at 120 Hz and 1 substep, stays 2 m from the point within 1% at every step for 8 s,
// and first comes back to its start line after 2π√(m r³ ÷ |k|) = 4.000 s, within 1%, on Rapier 0.36.1. A planted law
// that falls off as 1 ÷ r leaves the 1% band within its first 12 steps, falls to 1.067 m and fails, naming the fixture,
// the answer and the step.
import { describe, expect, test } from 'vitest';
import {
  AC, FALLS_TO, FIRST_STEPS, K, LAUNCH, MOON, ORBIT, ORBIT_PERIOD, ORBIT_POINT, ORBIT_STEPS, PRINTED, TIMEOUT, ask, bake, failFailures,
  fixtureNamed, kitCall, mm3, namesStep, numberOf, orbitFailures, orbitOf, orbitParts, orbitWorld, prebuild, rowOf, show,
  type Fixture, type KitResult, type Orbit,
} from './helpers.ts';

prebuild(['release']);
const PLANTED = 'inverse_square_one_over_r';
const shown = (o: Orbit): string =>
  `${o.left === null ? 'inside 2 m within 1% at every step' : `outside 2 m within 1% from step ${o.left}`}; farthest from 2 m at ${o.r[o.far]!.toFixed(4)} m (step ${o.far}); back on its start line after ${o.returned === null ? 'no time in 8 s' : `${o.returned.toFixed(4)} s`}, worked ${ORBIT_PERIOD.toFixed(3)} s`;

describe(`${AC[1]} an inverse_square of k = −4π² N·m² holds a 2 kg body launched at π m/s on a circle 2 m from its point`, () => {
  test(`${AC[1]} at 120 Hz and 1 substep the body stays 2 m from the point within 1% at every step for 8 s and first comes back to its start line after 4.000 s, within 1%`, () => {
    expect([K.toFixed(3), LAUNCH.toFixed(4), ORBIT_PERIOD.toFixed(3)], '−4π², π and 2π√(m r³ ÷ |k|), as the issue prints them').toEqual(['-39.478', '3.1416', '4.000']);
    const run = ask([bake(orbitWorld(), ORBIT_STEPS, [MOON])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = orbitOf(run.replies[0]!, MOON, ORBIT_POINT, 'the orbit world');
    expect(typeof read === 'string' ? read : '', `${ORBIT}: the orbit world bakes, a state of its body after each of ${ORBIT_STEPS} steps`).toBe('');
    console.log(`${ORBIT}: ${shown(read as Orbit)}`);
    const failures = orbitFailures(ORBIT, read as Orbit);
    expect(failures, `${ORBIT} baked 8 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted law that falls off as 1 ÷ r (${PLANTED}) leaves the 1% band within its first 12 steps, falls to 1.067 m and fails, naming ${ORBIT}, the answer 2 m and the step`, () => {
    const run = ask([bake(orbitWorld(), ORBIT_STEPS, [MOON]), { call: 'behavior_fixtures' }, kitCall()], { planted: PLANTED });
    expect(run.problem, `${run.what} answers: the planted law runs`).toBe('');
    const [baked, data, report] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
    const read = orbitOf(baked, MOON, ORBIT_POINT, `the orbit world under ${PLANTED}`);
    expect(typeof read === 'string' ? read : '', `${PLANTED} changes the law alone: the orbit world is taken and baked`).toBe('');
    const o = read as Orbit;
    console.log(`planted ${PLANTED}: ${shown(o)}`);
    // What the wrong law does, as the issue gives it: out of the band by step 12, and down to 1.067 m as printed.
    expect(o.left !== null && o.left <= FIRST_STEPS, `${PLANTED} leaves the 1% band within its first ${FIRST_STEPS} steps: it leaves at step ${String(o.left)}`).toBe(true);
    const lowest = Math.min(...o.r);
    expect(Math.abs(lowest - FALLS_TO) <= PRINTED, `${PLANTED} falls to ${FALLS_TO} m: its body comes as near the point as ${lowest} m`).toBe(true);
    // The judge that passes the real law fails on it, naming the fixture, the answer and the step.
    const failures = orbitFailures(ORBIT, o);
    expect(failures.length, `${PLANTED}: the planted law is caught (the judge finds nothing wrong with a body that falls to ${mm3(lowest)} m)`).toBeGreaterThan(0);
    expect(failures.some((x) => namesStep(x, ORBIT, o.left!)), `a failure names ${ORBIT}, the answer 2 m and step ${String(o.left)}; failures:\n  ${failures.join('\n  ')}`).toBe(true);

    // The kit's own fail names them in its row: the fixture, the interface's answer, the step its own world's body left
    // the band at, and the 1.067 m it fell to.
    const row = rowOf(report, ORBIT, `behavior_kit under ${PLANTED}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${PLANTED} holds ${ORBIT} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r);
    if (r.answer !== 2) kit.push(`${ORBIT}'s fail names the answer ${show(r.answer)}, not 2 m`);
    if (r.measured === null || !(Math.abs(r.measured - FALLS_TO) <= PRINTED)) kit.push(`${ORBIT}'s fail reads ${show(r.measured)} m, not the ${FALLS_TO} m the body falls to`);
    const step = numberOf(r, 'step');
    if (step === null || !(step >= 1 && step <= FIRST_STEPS)) kit.push(`${ORBIT}'s fail names step ${show(r.raw['step'])}, not a step of its first ${FIRST_STEPS}`);
    // That step is the one its own world's body leaves the band at, baked here under the same planted law.
    const held = fixtureNamed(data, ORBIT, `behavior_fixtures under ${PLANTED}`);
    const parts = typeof held === 'string' ? null : orbitParts(held as Fixture);
    if (typeof held === 'string' || !parts) kit.push(typeof held === 'string' ? held : `${ORBIT}'s world doesn't hold one dynamic body and an inverse_square force with a point`);
    else {
      const own = ask([bake(held.world, ORBIT_STEPS, [parts.body])], { planted: PLANTED });
      expect(own.problem, `${own.what} answers`).toBe('');
      const theirs = orbitOf(own.replies[0]!, parts.body, parts.point, `${ORBIT}'s own world under ${PLANTED}`);
      if (typeof theirs === 'string') kit.push(theirs);
      else if (theirs.left !== step) kit.push(`${ORBIT}'s fail names step ${show(step)}; its own world's body, baked here, leaves the band at step ${String(theirs.left)}`);
    }
    expect(kit, `${ORBIT}'s row under ${PLANTED}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
