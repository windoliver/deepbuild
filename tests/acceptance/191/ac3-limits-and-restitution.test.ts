// Criterion 3: a test backend that skips joint limits fails the hinge limit fixture, naming the joint and the largest
// angle it reached; and one that takes the combined restitution as the minimum while its world declares the maximum fails
// the max bounce fixture, naming the answer 0.81 m and the 0.25 m it bounced.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, failFailures, fixturesOf, isObject, kitCall, kitReport, none, physics, prebuild, resultOf, show,
} from './helpers.ts';

prebuild(['test']);

describe(`${AC[3]} backends that skip joint limits or take the minimum restitution fail their fixtures, naming what they did`, () => {
  test(`${AC[3]} no_joint_limits fails hinge_limit, naming the joint and the largest angle it reached (past 30.5°)`, () => {
    const [fixtures, report] = physics([{ call: 'behavior_fixtures' }, kitCall()], { backend: 'no_joint_limits' });
    const hinge = fixturesOf(fixtures!, 'behavior_fixtures').find((f) => f.name === 'hinge_limit');
    expect(hinge, 'the interface holds hinge_limit').toBeDefined();
    const joints = Object.keys(isObject(hinge!.world['joints']) ? hinge!.world['joints'] : {});
    expect(joints.length, `hinge_limit's world holds one joint: ${show(joints)}`).toBe(1);
    const r = resultOf(kitReport(report!, 'behavior_kit on no_joint_limits'), 'hinge_limit', 'no_joint_limits');
    const failures = failFailures(r, 'no_joint_limits');
    if (r.raw['joint'] !== joints[0]) failures.push(`hinge_limit's fail names joint ${show(r.raw['joint'])}, not ${joints[0]}`);
    if (!r.what.includes(joints[0]!)) failures.push(`hinge_limit's fail text doesn't name the joint ${joints[0]}: ${JSON.stringify(r.what)}`);
    if (r.measured === null || r.measured <= 30.5) failures.push(`hinge_limit names its largest angle as ${show(r.measured)}°, which isn't past the 30.5° a limited hinge never passes`);
    none(failures, 'no_joint_limits on hinge_limit');
  }, TIMEOUT);

  test(`${AC[3]} restitution_min fails bounce_max, naming the answer 0.81 m and the 0.25 m it bounced`, () => {
    const r = resultOf(kitReport(physics([kitCall()], { backend: 'restitution_min' })[0]!, 'behavior_kit on restitution_min'), 'bounce_max', 'restitution_min');
    const failures = failFailures(r, 'restitution_min');
    if (r.answer === null || Math.abs(r.answer - 0.81) > 0.005) failures.push(`bounce_max names answer ${show(r.answer)}, not 0.81 m`);
    // The height it bounced: the minimum's e²h, 0.25 m, within the bounce fixtures' 3%.
    if (r.measured === null || Math.abs(r.measured - 0.25) > 0.03 * 0.25) failures.push(`bounce_max names ${show(r.measured)} m bounced, not the minimum's 0.25 m (within 3%)`);
    none(failures, 'restitution_min on bounce_max');
  }, TIMEOUT);
});
