// #2011.b8ab4f30: in a world built only from roles (a player, two enemies, ground, a wall, a pickup and a shot fired by the
// player), the expanded matrix gives player and enemies touching ground and wall, the shot touching enemies and wall but
// never its owner, and the pickup's sensor writes one `sensor_enter` for the player and none for enemies. The planted role
// table `role_table_pickup_solid`, which makes the pickup solid to the player, stops the player at the pickup and fails
// physics.pairs, naming the pair.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, ask, bake, contactFailures, failuresNaming, none, occurrencesOf, pairsCall, pairsOf, prebuild,
  sensorEnters, show, statesOf, use, world, type JsonObject,
} from './helpers.ts';

prebuild();

const STEPS = 240; // 2 s at 120 Hz
const SPEED = 3; // the player's m/s along +x
const upright = { angular: [true, true, true] };
/**
 * Roles only: no collision_groups, member or collides. Frictionless ground; the player slides along z = 0 through the
 * pickup (2 m ahead), enemy_b slides the other way along z = 1.5 through the pickup's other end, enemy_a stands, and the
 * shot flies from just ahead of the player toward the wall (10 m ahead).
 */
const ROLES: JsonObject = world({
  defaults: { friction: 0, restitution: 0, damping: 0 },
  shapes: {
    floor: { kind: 'box', half: [12, 0.1, 6] },
    wall: { kind: 'box', half: [0.25, 1, 6] },
    person: { kind: 'box', half: [0.25, 0.5, 0.25] },
    pickup: { kind: 'box', half: [0.25, 0.5, 2] },
    bullet: { kind: 'sphere', radius: 0.1 },
  },
  bodies: {
    ground: { kind: 'static', pose: { pos: [0, -0.1, 0] }, shapes: [{ shape: 'floor', role: 'ground' }] },
    wall: { kind: 'static', pose: { pos: [10, 1, 0] }, shapes: [{ shape: 'wall', role: 'wall' }] },
    pickup: { kind: 'static', pose: { pos: [2, 0.5, 0] }, shapes: [{ shape: 'pickup', role: 'pickup' }] },
    player: { kind: 'dynamic', mass: 80, sleep: false, locks: upright, pose: { pos: [0, 0.5, 0] }, velocity: { linear: [SPEED, 0, 0] }, shapes: [{ shape: 'person', role: 'player' }] },
    enemy_a: { kind: 'dynamic', mass: 80, locks: upright, pose: { pos: [-3, 0.5, -1.5] }, shapes: [{ shape: 'person', role: 'enemy' }] },
    enemy_b: { kind: 'dynamic', mass: 80, sleep: false, locks: upright, pose: { pos: [4, 0.5, 1.5] }, velocity: { linear: [-SPEED, 0, 0] }, shapes: [{ shape: 'person', role: 'enemy' }] },
    shot: { kind: 'dynamic', mass: 0.1, gravity_scale: 0, pose: { pos: [0.5, 0.5, 0] }, velocity: { linear: [10, 0, 0] }, shapes: [{ shape: 'bullet', role: 'shot', owner: 'player' }] },
  },
});
const U = {
  player: use('player', 'person'), enemyA: use('enemy_a', 'person'), enemyB: use('enemy_b', 'person'), ground: use('ground', 'floor'),
  wall: use('wall', 'wall'), pickup: use('pickup', 'pickup'), shot: use('shot', 'bullet'),
};
/** The pickup's near face is at x = 1.75 and the player's half width 0.25, so they first meet as the player passes x = 1.5. */
const MEET_X = 1.5;
const MEET_STEP = (MEET_X / SPEED) * 120; // 60
const bakeRoles = (): JsonObject => bake(ROLES, STEPS, { read: ['player', 'enemy_b'], occurrences: true });

describe(`${CRITERIA[3]} roles expand into collision groups that physics.pairs reads`, () => {
  it(`${CRITERIA[3]} a world built only from roles: player and enemies touch ground and wall, the shot touches enemies and wall but never its owner, and the pickup's sensor writes one sensor_enter for the player and none for enemies`, () => {
    const [pairs, baked] = ask([pairsCall(ROLES), bakeRoles()]);
    const p = pairsOf(pairs!, 'the roles world');
    none(contactFailures(p, [
      [U.player, U.ground, 'touch'], [U.player, U.wall, 'touch'],
      [U.enemyA, U.ground, 'touch'], [U.enemyA, U.wall, 'touch'], [U.enemyB, U.ground, 'touch'], [U.enemyB, U.wall, 'touch'],
      [U.shot, U.enemyA, 'touch'], [U.shot, U.enemyB, 'touch'], [U.shot, U.wall, 'touch'],
      [U.shot, U.player, 'none'],
      [U.pickup, U.player, 'sensor'],
    ]), 'the expanded matrix gives the roles\' pairs');
    expect(p.verdict, `physics.pairs passes the roles world: ${show(p.failures)}`).toBe('PASS');

    const occ = occurrencesOf(baked!, 'the roles world\'s bake');
    const enters = sensorEnters(occ, U.pickup, U.player);
    expect(enters.length, `the pickup's sensor writes one sensor_enter for the player: ${show(enters)}`).toBe(1);
    const step = enters[0]!['step'];
    expect(typeof step === 'number' && Math.abs(step - MEET_STEP) <= 3, `the player enters the pickup at step ${show(step)}, within 3 steps of ${MEET_STEP}, when it reaches it`).toBe(true);
    expect([...sensorEnters(occ, U.pickup, U.enemyA), ...sensorEnters(occ, U.pickup, U.enemyB)], 'the pickup\'s sensor writes no sensor_enter for an enemy').toEqual([]);

    const player = statesOf(baked!, 'player', STEPS + 1, 'the roles world\'s bake');
    const enemyB = statesOf(baked!, 'enemy_b', STEPS + 1, 'the roles world\'s bake');
    const end = player[STEPS]!.pos;
    expect(end[0], 'the player passes through the pickup (its sensor never stops it): at 2 s it is beyond x = 2.5').toBeGreaterThan(2.5);
    expect(Math.abs(end[1] - 0.5), `the player stands on the ground (its centre at y = 0.5), at ${end[1]}`).toBeLessThan(0.05);
    expect(enemyB[STEPS]!.pos[0], 'enemy_b passes through the pickup\'s far end (it overlapped the sensor): at 2 s it is beyond x = 1.5 going -x').toBeLessThan(1.5);
  }, TIMEOUT);

  it(`${CRITERIA[3]} the planted role table that makes the pickup solid to the player stops the player at the pickup and fails physics.pairs, naming the pair`, () => {
    const [pairs, baked] = ask([pairsCall(ROLES), bakeRoles()], 'role_table_pickup_solid');
    const player = statesOf(baked!, 'player', STEPS + 1, 'the roles world under role_table_pickup_solid');
    const xs = player.map((s) => s.pos[0]);
    expect(Math.max(...xs), 'under the planted table the player never passes the pickup\'s near face (x stays at most 1.55)').toBeLessThanOrEqual(MEET_X + 0.05);
    expect(xs[STEPS], 'under the planted table the player is stopped at the pickup (x at 2 s from 1.45 to 1.55)').toBeGreaterThanOrEqual(MEET_X - 0.05);

    const p = pairsOf(pairs!, 'the roles world under role_table_pickup_solid');
    expect(p.verdict, 'physics.pairs fails the planted role table').toBe('FAIL');
    expect(failuresNaming(p, U.pickup, U.player).length, `a failure names the pickup–player pair (both shape uses): ${show(p.failures)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
