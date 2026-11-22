// Criterion 1: in a new fixture at 120 Hz and 4 substeps, a dynamic disc of 20,000 kg and radius 30 m on a hinge about
// the vertical, its velocity motor's target rising from 0 to 90°/s over 2 s and held 4 s, carries a 1 kg box of half
// extent 0.25 m and friction 0.5, on a disc of friction 0.5, set 1 m from the axis: the box's centre is within 0.06 m
// of 1 m from the axis at every step of the 6 s. With 30°/s in place of 90°/s it is within 0.01 m. A planted wrapper
// that leaves the backend's contact reuse on reads 3.957 m at 6 s and fails, naming the box and the first step past
// the bound.
import { describe, expect, test } from 'vitest';
import {
  AC, BOX, FAST, REFERENCE, REUSE_ON, SLOW, TIMEOUT, TURNTABLE, WITHIN_FAST, WITHIN_SLOW, ask, kitCall, kitFailures,
  prebuild, rideRead, show, shownSeconds, turntableBake,
} from './helpers.ts';

prebuild(['release']);

describe(`${AC[1]} the turntable: a box set 1 m from the axis of a 20,000 kg disc whose hinge motor rises to its speed over 2 s and holds it 4 s`, () => {
  test(`${AC[1]} the box's centre is within 0.06 m of 1 m from the axis at every step of the 6 s at 90°/s, and within 0.01 m at 30°/s`, () => {
    const run = ask([turntableBake(FAST), turntableBake(SLOW)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const fast = rideRead(run.replies[0]!, FAST, WITHIN_FAST, 'the turntable at 90°/s');
    const slow = rideRead(run.replies[1]!, SLOW, WITHIN_SLOW, 'the turntable at 30°/s');
    for (const [name, r] of [['90°/s', fast], ['30°/s', slow]] as const) {
      if (r.seconds.length) console.log(`the turntable at ${name}: the box's distance from the axis at ${shownSeconds(r)}; it has gone ${r.boxTurn?.toFixed(2)}° around of the disc's ${r.discTurn?.toFixed(2)}°`);
    }
    const failures = [...fast.failures, ...slow.failures];
    expect(failures, `the turntable at 120 Hz and 4 substeps:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted wrapper that leaves the backend's contact reuse on reads 3.957 m at 6 s and fails, naming the box and the first step past the bound`, () => {
    const run = ask([turntableBake(FAST), { call: 'behavior_fixtures' }, kitCall()], REUSE_ON);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = rideRead(run.replies[0]!, FAST, WITHIN_FAST, `the turntable at 90°/s under ${REUSE_ON}`);
    if (read.seconds.length) console.log(`planted ${REUSE_ON}: the box's distance from the axis at ${shownSeconds(read)}; first past the bound after step ${String(read.first)}`);
    expect(read.seconds[6]?.toFixed(3) ?? read.failures.join('; '), 'the box\'s distance from the axis at 6 s under the planted wrapper, m, as the issue prints it').toBe('3.957');
    expect(read.failures.length, 'the judge that passes the real program finds something wrong with the planted wrapper\'s bake').toBeGreaterThan(0);
    const named = read.first !== null && read.failures.some((f) => f.startsWith(`${BOX}:`) && new RegExp(`\\bstep ${read.first}\\b`).test(f));
    expect(named, `a failure names the box and the first step past the bound:\n  ${read.failures.join('\n  ')}`).toBe(true);
    // The fixture in the kit fails on the same wrapper, its row naming the box and that step.
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, 'fail', read.measured, REFERENCE, `the behavior kit under ${REUSE_ON}`);
    if (kit.row && (kit.row.raw['body'] !== BOX || kit.row.raw['step'] !== read.first)) kit.failures.push(`${TURNTABLE.name}: the fail names body ${show(kit.row.raw['body'])} and step ${show(kit.row.raw['step'])}, not ${BOX} and step ${String(read.first)}, the first past the bound`);
    expect(kit.failures, `the kit's ${TURNTABLE.name} under ${REUSE_ON}:\n  ${kit.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
