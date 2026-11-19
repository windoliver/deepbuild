// Criterion 6: a kit run over the first criterion's world writes no assumption row for the box, and its playtest
// fails, naming the box. Over #191's 200 m/s ball it writes the row as before. A planted kit that turns `ccd` on for
// the kinematic box produces a world that is refused at check, and fails, naming the field.
import { describe, expect, test } from 'vitest';
import {
  AC, BAT_CCD, FIXTURE, TIMEOUT, batScene, capRefusalFailures, expand, fastBallWorld, issuesOf, kitFailures, kitRunOf, lintOf,
  physics, planted, playtestFailures, prebuild, reasoned, rowFailures, sceneBake, sceneExpand, show, tolds, withCourt,
} from './helpers.ts';

prebuild(['release']);
/** The playtest run: a tenth of a second, as criterion 1's. */
const STEPS = 12;
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;

describe(`${AC[6]} the kit's default turns ccd on only where the backend sweeps, and a fast kinematic body fails its playtest`, () => {
  test(`${AC[6]} a kit run over the first criterion's world writes no assumption row for the box, and its playtest fails, naming the box`, () => {
    const what = `the kit over ${FIXTURE}`;
    const [reply] = physics([sceneExpand(batScene())]);
    const run = kitRunOf(reply!);
    console.log(`${what}: ok ${show(reply!['ok'])}; rows ${show(run.rows)}`);
    const written = kitFailures(reply!, what);
    expect(written, `${what}:${list(written)}`).toEqual([]);
    // Its playtest: the world the kit wrote, back in its scene, run as a playtest run reads the lint (its bake).
    const [play] = physics([sceneBake(withCourt(batScene(), run.world!), STEPS)]);
    console.log(`${what}, its playtest run: physics.fast_body raises ${tolds(lintOf(play!, what).raised)}`);
    const failures = playtestFailures(play!, `${what}, its playtest run`);
    expect(failures, `${what}, its playtest:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[6]} over #191's 200 m/s ball the kit writes the row as before: ccd on, one row naming the ball and physics.fast_body`, () => {
    const what = 'the kit over #191\'s fast ball';
    const [reply] = physics([expand(fastBallWorld(undefined))]);
    const run = kitRunOf(reply!);
    console.log(`${what}: rows ${show(run.rows)}`);
    const failures = rowFailures(reply!, 'ball', what);
    if (!failures.length && !reasoned(run.rows?.[0])) failures.push(`ball: ${what}: the row's reason doesn't name physics.fast_body: ${show(run.rows?.[0] ?? null)}`);
    expect(failures, `${what}:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[6]} a planted kit that turns ccd on for the kinematic box produces a world that is refused at check, and fails, naming the field ${BAT_CCD}`, () => {
    const twin = planted('kit_turns_ccd_on_kinematic', [sceneExpand(batScene())]);
    expect(twin.refused, 'the planted kit runs').toBe('');
    const reply = twin.replies[0]!;
    console.log(`planted kit_turns_ccd_on_kinematic: ${show(reply)}`);
    // Its world is refused at check: the run answers a refusal by the backend's caps at the box's ccd.
    expect(reply['ok'], `the planted kit's world is refused: ${show(reply)}`).toBe(false);
    const refusal = capRefusalFailures(issuesOf(reply), 'the planted kit\'s world');
    expect(refusal, `the planted kit's world is refused at check, naming the field and the backend:${list(refusal)}`).toEqual([]);
    const failures = kitFailures(reply, 'the planted kit');
    console.log(`planted kit_turns_ccd_on_kinematic fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real kit fails on the planted one').toBeGreaterThan(0);
    expect(failures.some((f) => f.includes(BAT_CCD)), `a failure names the field ${BAT_CCD}:${list(failures)}`).toBe(true);
  }, TIMEOUT);
});
