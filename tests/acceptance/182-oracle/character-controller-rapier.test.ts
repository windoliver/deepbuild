// Ported from Rapier's src/control/character_controller.rs (character_controller_climb_test,
// character_controller_ground_detection and character_controller_impulses_with_multiple_dynamic_bodies), at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0; Copyright the upstream project's authors). No upstream code is
// copied: each setup is our physics.world@1 document with a character body, read from `deep-physics`'s bake, and each
// assertion keeps upstream's numbers. Each test also runs one of the #182 suite's wrong programs, which the same
// assertions must reject.
import { describe, test } from 'vitest';
import {
  AC, TIMEOUT, ballCharacter, capsule, caught, moves, none, physics, prebuild, rad, rowsOf, statesOf, touched, upstreamWorld,
  walk, type Runner,
} from './helpers.ts';

prebuild(['shipped', 'test']);

/**
 * character_controller_climb_test: a flat ground, a 0.2 rad slope both climb, then a 0.6 rad slope; two ball
 * characters of radius 0.5 whose slope limits sit 0.001 rad over and under 0.6 rad, each moved 0.1 m a step along +x
 * at 60 Hz (6 m/s; gravity pulls them, where upstream adds −0.1 m a step) for 200 steps. Grounded throughout, up to
 * isolated flickers (at most 3, never two in a row); the first ends past x 6 and above y 3, the second before x 4.5
 * and below y 2.
 */
function climbFailures(r: Runner): string[] {
  const w = upstreamWorld({
    statics: {
      floor: { half: [100, 0.1, 100], pos: [0, -0.1, 0] },
      slope: { half: [2, 0.1, 2], pos: [0.1 + 2, -0.1 + 0.4, 0], rotZ: 0.2 },
      steep: { half: [4, 0.1, 100], pos: [0.1 + 2 * 2 + 2 - 0.9 + 2, -0.1 + 1.7 + 2 * Math.sin(0.6), 0], rotZ: 0.6 },
    },
    movers: { can: ballCharacter('ball', [0.6, 0.5, 0], { slope_limit: rad(0.6 + 0.001) }), cannot: ballCharacter('ball', [-0.6, 0.5, 0], { slope_limit: rad(0.6 - 0.001) }) },
    shapes: { ball: capsule(0.5) }, inputs: moves(['can', 'cannot']),
  });
  const [reply] = physics([{ call: 'bake', world: w, steps: 200, track: [walk('can', 0, [6, 0, 0]), walk('cannot', 0, [6, 0, 0])], read: ['can', 'cannot'] }], r);
  const out: string[] = [];
  for (const id of ['can', 'cannot']) {
    const s = statesOf(reply!, id, id);
    let total = 0;
    let run = 0;
    for (let k = 1; k < s.length; k++) {
      if (s[k]!.grounded === true) { run = 0; continue; }
      total++; run++;
      if (run > 1 || total > 3) { out.push(`${id}: airborne at step ${k} (${total} in all, ${run} in a row): not grounded at all times up to isolated flickers`); break; }
    }
  }
  const can = statesOf(reply!, 'can', 'can').at(-1)!.pos;
  const cannot = statesOf(reply!, 'cannot', 'cannot').at(-1)!.pos;
  if (!(can[0] > 6 && can[1] > 3)) out.push(`the character that can climb ends at (${can[0]}, ${can[1]}), not past x 6 and above y 3`);
  if (!(cannot[0] < 4.5 && cannot[1] < 2)) out.push(`the character that can't climb ends at (${cannot[0]}, ${cannot[1]}), not before x 4.5 and below y 2`);
  return out;
}

/**
 * character_controller_ground_detection: a ground whose top is at y 0.5; two ball characters of radius 0.5, one with
 * snap 0.2 and one with none, each moved (0.1, 0, 0.1) m a step at 60 Hz for 10,000 steps: grounded at every step; the
 * one without snap past 930 m along x and z, the one with snap past 960 m. Upstream starts both sunk half into the
 * ground; ours stand on it (README: deviations).
 */
function groundFailures(r: Runner): string[] {
  const top = 0.5;
  const w = upstreamWorld({
    statics: { ground: { half: [1001, 1, 1001], pos: [0, top - 1, 0] } },
    movers: { snapped: ballCharacter('ball', [0.6, top + 0.5 + 0.01, 0], { snap: 0.2 }), loose: ballCharacter('ball', [-0.6, top + 0.5 + 0.01, 0], { snap: 0 }) },
    shapes: { ball: capsule(0.5) }, inputs: moves(['snapped', 'loose']),
  });
  const [reply] = physics([{ call: 'bake', world: w, steps: 10_000, track: [walk('snapped', 0, [6, 0, 6]), walk('loose', 0, [6, 0, 6])], read: ['snapped', 'loose'] }], r);
  const out: string[] = [];
  for (const [id, least] of [['loose', 930], ['snapped', 960]] as const) {
    const s = statesOf(reply!, id, id);
    const k = s.findIndex((x, i) => i >= 1 && x.grounded !== true);
    if (k >= 0) out.push(`${id}: not grounded at step ${k}`);
    const end = s.at(-1)!.pos;
    if (!(end[0] >= least && end[2] >= least)) out.push(`${id}: ends at x ${end[0]}, z ${end[2]}, not at least ${least}`);
  }
  return out;
}

/**
 * character_controller_impulses_with_multiple_dynamic_bodies, with no gravity: a character 1 m across (our capsule of
 * radius 0.5) touching a dynamic unit cube ahead (+x) and one beside (+z), moved 0.1 m along +x in one step. The cube
 * ahead is reported as a collision, the obstacle the controller stops at, so it moves less than the 0.1 m asked; the
 * cube beside, across the motion, is left alone. Upstream then pushes the cube ahead with
 * solve_character_collision_impulses, a separate call our character never makes (it pushes no dynamic body).
 */
function impulseFailures(r: Runner): string[] {
  const w = upstreamWorld({
    gravity: [0, 0, 0],
    statics: { ground: { half: [10, 0.1, 10], pos: [0, -0.6, 0] } },
    movers: {
      hero: ballCharacter('block', [0, 0, 0]),
      ahead: { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'm' }], pose: { pos: [1, 0, 0] } },
      beside: { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'm' }], pose: { pos: [0, 0, 1] } },
    },
    shapes: { block: capsule(0.5), cube: { kind: 'box', half: [0.5, 0.5, 0.5] } }, inputs: moves(['hero']),
  });
  const [reply] = physics([{ call: 'bake', world: w, steps: 1, track: [walk('hero', 0, [6, 0, 0])], read: ['hero', 'beside'] }], r);
  const out: string[] = [];
  if (!touched(rowsOf(reply!, 'the step'), 'hero', 'ahead').length) out.push('the character didn\'t run into the box ahead of it (no contact_begin naming hero and ahead)');
  const hero = statesOf(reply!, 'hero', 'hero');
  const advance = hero[1]!.pos[0] - hero[0]!.pos[0];
  if (!(advance < 0.099)) out.push(`the character moved ${advance} m of the 0.1 m asked: the box ahead didn't stop it`);
  const beside = statesOf(reply!, 'beside', 'beside')[1]!.linear;
  if (beside.some((v) => v !== 0)) out.push(`the box beside, across the motion, moves at ${JSON.stringify(beside)}`);
  return out;
}

describe(`${AC[1]} ${AC[3]} ${AC[8]} ${AC[10]} ${AC[12]} upstream character_controller.rs, run on deep-physics`, () => {
  test(`${AC[1]} ${AC[3]} ${AC[8]} ${AC[10]} character_controller_climb_test holds, and a body that ignores its own slope limit is rejected`, () => {
    none(climbFailures({}), 'rapier3d');
    caught(climbFailures({ planted: 'slope_limit_ignored' }), '--planted slope_limit_ignored');
  }, TIMEOUT);

  test(`${AC[1]} ${AC[3]} ${AC[8]} ${AC[10]} character_controller_ground_detection holds, and a ground distance of 0.001 m is rejected`, () => {
    none(groundFailures({}), 'rapier3d');
    caught(groundFailures({ backend: 'ground_distance_1mm' }), '--backend ground_distance_1mm');
  }, TIMEOUT);

  test(`${AC[12]} character_controller_impulses_with_multiple_dynamic_bodies' collision holds, and a character stepped as a plain kinematic body is rejected`, () => {
    none(impulseFailures({}), 'rapier3d');
    caught(impulseFailures({ planted: 'character_as_kinematic' }), '--planted character_as_kinematic');
  }, TIMEOUT);
});
