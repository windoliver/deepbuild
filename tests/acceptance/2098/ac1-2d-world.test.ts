// Criterion 1: a 2D world of a ball dropped 2 m onto a floor, both of restitution 0.5, runs on rapier2d 0.36.1 and
// rebounds to within 0.05 of a quarter of the drop; the same world with `backend.name: rapier3d` and `dimensions: 2`
// is refused at check naming `dimensions` and the backend. Its planted twin builds a 2D world on rapier3d.
//
// The base already refuses `dimensions: 2` naming rapier3d, whatever the world's backend, so the refusal is held
// beside the same world accepted and stepped on rapier2d (README: What the base already does).
import { describe, expect, test } from 'vitest';
import {
  AC, BALL, BUILT_ON_RAPIER3D, DIMENSIONS_ON_3D, DROP, DROP_STEPS, PIN, RAPIER2D, RAPIER3D, TIMEOUT, acceptedFailures, ask, backendFailures,
  bake, check, dropWorld, errorsAt, errorsOf, fallOf, pinFailures, prebuild, reboundFailures, reboundOf, refusalFailures,
  type Fall, type JsonObject,
} from './helpers.ts';

prebuild(['release']);
const ON_2D = `the 2D drop with backend.name ${RAPIER2D}`;
const ON_3D = `the same world with backend.name ${RAPIER3D}`;

describe(`${AC[1]} a 2D world of a ball dropped 2 m onto a floor runs on rapier2d 0.36.1; named for rapier3d it is refused at check`, () => {
  test(`${AC[1]} the 2D world, both of restitution 0.5, runs on rapier2d 0.36.1 and the ball rebounds to within 0.05 of a quarter of the 2 m drop`, () => {
    const run = ask([bake(dropWorld(RAPIER2D), DROP_STEPS, [BALL], { checkpoints: true })]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const reply = run.replies[0]!;
    const read = fallOf(reply, BALL, DROP_STEPS, ON_2D);
    expect(typeof read === 'string' ? read : '', `${ON_2D} bakes: the ball's height and vertical velocity after each of ${DROP_STEPS} steps`).toBe('');
    const fall = read as Fall;
    const rebound = reboundOf(fall);
    console.log(`${ON_2D}: ${rebound ? `first rebound ${rebound.apex.toFixed(4)} m after step ${rebound.contact}, ${(rebound.apex / DROP).toFixed(4)} of the drop` : 'no rebound'}`);
    const failures = [
      ...reboundFailures(fall),
      // "Runs on rapier2d 0.36.1": the checkpoints the bake keeps are that backend's, and the build links that version alone.
      ...backendFailures(reply, RAPIER2D, PIN, ON_2D),
      ...pinFailures(RAPIER2D, PIN),
    ];
    expect(failures, `${ON_2D}, baked 2 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} the same world with backend.name rapier3d and dimensions 2 is refused at check naming dimensions and rapier3d, beside the same world accepted and stepped on rapier2d`, () => {
    const run = ask([check(dropWorld(RAPIER2D)), bake(dropWorld(RAPIER2D), 1, [BALL]), check(dropWorld(RAPIER3D))]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [accepted, stepped, refused] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
    const beside = acceptedFailures(accepted, ON_2D);
    const step = fallOf(stepped, BALL, 1, ON_2D);
    if (typeof step === 'string') beside.push(step);
    expect(beside, `${ON_2D} is accepted at check and steps:\n  ${beside.join('\n  ')}`).toEqual([]);
    const failures = refusalFailures(refused, DIMENSIONS_ON_3D, ON_3D);
    expect(failures, `${ON_3D} and dimensions 2 is refused at check naming dimensions and ${RAPIER3D}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted program that builds a 2D world on rapier3d (${BUILT_ON_RAPIER3D}) is caught: its check refuses nothing at dimensions, and the failure names dimensions and rapier3d`, () => {
    const run = ask([check(dropWorld(RAPIER3D))], BUILT_ON_RAPIER3D);
    expect(run.problem, `${run.what} answers: the planted program runs`).toBe('');
    const reply: JsonObject = run.replies[0]!;
    const errors = errorsOf(reply, `${ON_3D} under ${BUILT_ON_RAPIER3D}`);
    expect(typeof errors === 'string' ? errors : '', `${BUILT_ON_RAPIER3D} answers the check of ${ON_3D}`).toBe('');
    const atDimensions = errorsAt(errors as JsonObject[], DIMENSIONS_ON_3D.field);
    expect(atDimensions, `${BUILT_ON_RAPIER3D} lets dimensions 2 through to ${RAPIER3D}: no error issue at dimensions`).toEqual([]);
    const failures = refusalFailures(reply, DIMENSIONS_ON_3D, ON_3D);
    expect(failures.length, `${BUILT_ON_RAPIER3D}: the planted program is caught (the judge finds nothing wrong with a 2D world built on ${RAPIER3D})`).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes('dimensions') && f.includes(RAPIER3D)), `a failure names dimensions and ${RAPIER3D}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
