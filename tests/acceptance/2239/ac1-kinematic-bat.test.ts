// Criterion 1: in a new fixture at 120 Hz with gravity_scale 0, a kinematic box 0.02 m thick follows a channel at
// 30 m/s along +x, its leading face starting 0.90 m before the centre of a resting dynamic ball of radius 0.05 m. The
// ball is still at rest after the box has passed it, with `ccd` on the ball or off. `physics.fast_body` raises one
// issue of kind `kinematic`, naming the box, step 1, its 0.25 m move and its 0.01 m half extent, with a fix that names
// no `ccd`. The same box with `ccd: true` is refused at check, naming the field and the backend. A planted lint that
// treats the box as #191 treats a dynamic body offers `ccd` and fails, naming the fix.
import { describe, expect, test } from 'vitest';
import {
  AC, BALL, BAT, BAT_CCD, BAT_FAST, FIXTURE, REFERENCE, TIMEOUT, batScene, capRefusalFailures, errorsOf, fixOf, issuesOf,
  kinematicFailures, lintOf, passedAtRestFailures, physics, planted, prebuild, sceneBake, sceneCheck, show, tolds, xs,
} from './helpers.ts';

prebuild(['release']);
/** A tenth of a second: the box's trailing face is past the ball's far side from step 4 on. */
const STEPS = 12;
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;

describe(`${AC[1]} a fast kinematic box passes through a resting ball, and physics.fast_body says so without offering ccd`, () => {
  test(`${AC[1]} the ball is still at rest after the box has passed it, with ccd on the ball or off, and physics.fast_body raises one issue of kind kinematic naming the box, step 1, its 0.25 m move and its 0.01 m half extent, with a fix that names no ccd`, () => {
    const [off, on] = physics([sceneBake(batScene(), STEPS), sceneBake(batScene({ ball: true }), STEPS)]);
    console.log(`${FIXTURE}, ccd off on the ball: ${BAT} x ${xs(off!, BAT, 'the fixture')}; ${BALL} x ${xs(off!, BALL, 'the fixture')}`);
    console.log(`${FIXTURE}, ccd on the ball: ${BAT} x ${xs(on!, BAT, 'ccd on the ball')}; ${BALL} x ${xs(on!, BALL, 'ccd on the ball')}`);
    console.log(`${FIXTURE}: physics.fast_body raises ${tolds(lintOf(off!, 'the fixture').raised)}`);
    const failures = [
      ...passedAtRestFailures(off!, 'with ccd off on the ball'),
      ...passedAtRestFailures(on!, 'with ccd on the ball'),
      ...kinematicFailures(off!, BAT_FAST, 'the fixture'),
    ];
    expect(failures, `the kinematic box and the resting ball:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} the same box with ccd: true is refused at check, naming the field ${BAT_CCD} and the backend ${REFERENCE}`, () => {
    const [plain, swept] = physics([sceneCheck(batScene()), sceneCheck(batScene({ bat: true }))]);
    console.log(`${FIXTURE} with ccd: true on the box, at check: ${show(issuesOf(swept!))}`);
    // The fixture itself checks, so what is refused is the box's ccd.
    expect(plain!['ok'], `the check of the fixture answers: ${show(plain)}`).toBe(true);
    expect(errorsOf(plain!), 'the fixture as written checks with no error').toEqual([]);
    const failures = capRefusalFailures(issuesOf(swept!), 'the box with ccd: true');
    expect(failures, `the refusal of ccd on the kinematic box:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted lint that treats the box as #191 treats a dynamic body offers ccd and fails, naming the fix`, () => {
    const twin = planted('lint_kinematic_as_dynamic', [sceneBake(batScene(), STEPS)]);
    expect(twin.refused, 'the planted lint runs').toBe('');
    const baked = twin.replies[0]!;
    // It offers ccd: its issue for the box carries a fix that names ccd.
    const offered = lintOf(baked, 'the planted lint').raised.filter((i) => Array.isArray(i['ids']) && i['ids'].includes(BAT) && /ccd/i.test(fixOf(i)));
    console.log(`planted lint_kinematic_as_dynamic: physics.fast_body raises ${tolds(lintOf(baked, 'the planted lint').raised)}`);
    expect(offered.length, `the planted lint raises one issue for the box whose fix offers ccd: ${tolds(lintOf(baked, 'the planted lint').raised)}`).toBe(1);
    const failures = kinematicFailures(baked, BAT_FAST, 'the planted lint');
    console.log(`planted lint_kinematic_as_dynamic fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real lint fails on the planted one').toBeGreaterThan(0);
    const fix = JSON.stringify(fixOf(offered[0]!));
    expect(failures.some((f) => f.includes('fix') && f.includes(fix)), `a failure names the fix ${fix}:${list(failures)}`).toBe(true);
  }, TIMEOUT);
});
