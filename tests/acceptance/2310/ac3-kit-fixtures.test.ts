// #2310.7b0715e2: "On articulated joints the kit's fixtures hold as they do on separate ones: a 1 kg ball on a 1 m ball
// joint released from 10° swings with a period of 2.010 s within 1%, a hinge limited to ±30° under gravity is never past
// 30.5°, and a hinge motor set to 90°/s with torque to spare turns within 1% of it after 0.5 s. A planted wrapper that
// drops an articulated joint's limits passes 30.5° and fails, naming the joint and its largest angle"
//
// Three worlds (README: The worlds), each the kit's own on one articulated joint, baked and read from the body's
// states: the ball's period is the time between its first two crossings under its anchor from the side it is released
// on; the hinge's angle is how far its bar has turned about the hinge's axis from where it was built, and its largest
// is never past 30.5° (and reaches the limit, so the limit is what holds it); the motor's bar turns about the hinge's
// axis at 90°/s within 1% after step 60.
//
// The kit runs its pendulum, hinge limit and hinge motor a second time, as `articulated/pendulum_period`,
// `articulated/hinge_limit` and `articulated/hinge_motor` (README: The fixtures in the behavior kit): each is in the
// kit's data once, on an articulated joint, with the answer and tolerance of the fixture on a separate joint, naming
// the cap `articulations`; the reference backend passes both of each pair; and each one's own world, baked, passes the
// judge above.
//
// On `--planted articulated_drops_limits` the limited hinge's largest angle passes 30.5°, and the judge's failure
// names the joint and that angle.
import { describe, expect, it } from 'vitest';
import {
  AC, HELD, NEVER_PAST, ON_ARTICULATED, ON_SEPARATE, PIN, RATE, TIMEOUT, ask, bake, bakeFixture, fixtureNamed, fmt, heldFailures, hingeLimit,
  hingeMotor, judged, largest, limitData, limitFailures, motorData, motorFailures, oneJoint, passFailures, pendulum, pendulumData,
  periodFailures, prebuild, releasedIn, runOf, show, type Fixture, type Planted, type Run,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[3];
const TWIN: Planted = 'articulated_drops_limits';
/** The pendulum is read over 4 s (it crosses under its anchor at 0.5 s and 2.5 s), the limited hinge over 2 s, the motor to 0.5 s. */
const STEPS = { pendulum: 4 * RATE, limit: 2 * RATE, motor: RATE / 2 } as const;
const KINDS = ['pendulum', 'limit', 'motor'] as const;

describe(`${ID} on articulated joints the kit's pendulum, hinge limit and hinge motor hold as they do on separate ones`, () => {
  it(`${ID} on an articulated joint a 1 kg ball on a 1 m ball joint released from 10° swings with a period of 2.010 s within 1%, a hinge limited to ±30° under gravity is never past 30.5°, and a hinge motor set to 90°/s turns within 1% of it after 0.5 s`, () => {
    const [swing, limited, driven] = [pendulum(), hingeLimit(), hingeMotor()];
    const run = ask([bake(swing, STEPS.pendulum), bake(limited, STEPS.limit), bake(driven, STEPS.motor)]);
    expect(run.problem, `${run.what} answers the three bakes`).toBe('');
    const failures = [
      ...judged(runOf(swing, run.replies[0], 'the pendulum on an articulated ball joint', STEPS.pendulum + 1), (r) => periodFailures(r)),
      ...judged(runOf(limited, run.replies[1], 'the hinge limited to ±30° on an articulated joint', STEPS.limit + 1), (r) => limitFailures(r)),
      ...judged(runOf(driven, run.replies[2], 'the hinge motor on an articulated joint', STEPS.motor + 1), (r) => motorFailures(r)),
    ];
    expect(failures, `the kit's three worlds on articulated joints, baked:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} the behavior kit runs its pendulum, hinge limit and hinge motor a second time on articulated joints, with the answers and tolerances of the fixtures on separate ones, and rapier3d passes both of each pair`, () => {
    const kit = ask([{ call: 'behavior_fixtures' }, { call: 'behavior_kit' }]);
    expect(kit.problem, `${kit.what} answers the kit's calls`).toBe('');
    const found = KINDS.map((k) => fixtureNamed(kit.replies[0], ON_ARTICULATED[k]));
    const missing = found.filter((f): f is string => typeof f === 'string');
    expect(missing, `the kit's data holds each fixture a second time, on an articulated joint:\n  ${missing.join('\n  ')}`).toEqual([]);
    const [swing, limited, driven] = found as [Fixture, Fixture, Fixture];
    const failures = [...pendulumData(swing), ...limitData(limited), ...motorData(driven)];
    KINDS.forEach((k, i) => {
      const [on, off] = [(found as Fixture[])[i]!, fixtureNamed(kit.replies[0], ON_SEPARATE[k])];
      failures.push(...heldFailures(on, HELD[k]), ...passFailures(kit.replies[1], on, HELD[k]));
      if (typeof off === 'string') { failures.push(off); return; }
      // As on a separate joint: the same answer and tolerance, and the fixture on a separate joint still passes.
      if (on.answer !== off.answer || JSON.stringify(on.tolerance) !== JSON.stringify(off.tolerance)) failures.push(`${on.name}: its answer and tolerance ${show(on.answer)} ${show(on.tolerance)} aren't ${off.name}'s ${show(off.answer)} ${show(off.tolerance)}`);
      failures.push(...passFailures(kit.replies[1], off, HELD[k]));
    });
    expect(failures, `the three fixtures on articulated joints, in the kit's data and in its report on rapier3d:\n  ${failures.join('\n  ')}`).toEqual([]);

    // Each fixture's own world, baked over its own steps, holds as the criterion says.
    const own = ask([bakeFixture(swing), bakeFixture(limited), bakeFixture(driven)]);
    expect(own.problem, `${own.what} answers the bakes of the three fixtures' own worlds`).toBe('');
    const [hinge, motor] = [oneJoint(limited), oneJoint(driven)] as [Exclude<ReturnType<typeof oneJoint>, string>, Exclude<ReturnType<typeof oneJoint>, string>];
    const held = [
      ...judged(runOf(swing.world, own.replies[0], `${swing.name}'s world`, swing.steps + 1), (r) => periodFailures(r, releasedIn(swing)!)),
      ...judged(runOf(limited.world, own.replies[1], `${limited.name}'s world`, limited.steps + 1), (r) => limitFailures(r, hinge.joint, hinge.body, hinge.axis)),
      ...judged(runOf(driven.world, own.replies[2], `${driven.name}'s world`, driven.steps + 1), (r) => motorFailures(r, motor.joint, motor.body, motor.axis)),
    ];
    expect(held, `the three fixtures' own worlds, baked:\n  ${held.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted wrapper that drops an articulated joint's limits passes 30.5° and fails, naming the joint and its largest angle`, () => {
    const w = hingeLimit();
    const run = ask([bake(w, STEPS.limit)], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and answers the bake`).toBe('');
    const read = runOf(w, run.replies[0], 'the hinge limited to ±30° on an articulated joint', STEPS.limit + 1);
    expect(typeof read === 'string' ? read : '', `--planted ${TWIN} bakes the limited hinge`).toBe('');
    const r = read as Run;
    const failures = limitFailures(r);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bake`).toBeGreaterThan(0);
    const peak = largest(r);
    expect(peak.angle, `${TWIN} passes ${NEVER_PAST}° (its largest angle: ${fmt(peak.angle)}° at step ${peak.step})`).toBeGreaterThan(NEVER_PAST);
    const named = failures.some((f) => f.startsWith(`${PIN}: `) && f.includes(`${fmt(peak.angle)}°`));
    expect(named, `a failure names the joint ${PIN} and its largest angle, ${fmt(peak.angle)}°:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
