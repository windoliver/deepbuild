// Ported from Rapier's src/control/character_controller.rs, test character_controller_climb_test, at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90. Licensed under the Apache License, Version 2.0 (Apache-2.0,
// https://www.apache.org/licenses/LICENSE-2.0); Copyright the Rapier project's authors. Modified: no upstream code is
// copied; its world is re-expressed as our physics.world@1 document with two character bodies, run by deep-physics's
// bake, and its assertions keep upstream's numbers, read from the bake's states (README: Upstream's world as ours and
// Deviations). The #182 suite's wrong program that ignores the body's own slope limit (`--planted slope_limit_ignored`:
// its controller climbs under 45° whatever `slope_limit` says) must be rejected by the same assertions.
import { describe, expect, test } from 'vitest';
import {
  TIMEOUT, UPSTREAM_RATE, aboutZ, box, capsule, caught, characterStates, none, physics, prebuild, upstreamWorld, use,
  type JsonObject, type Planted, type Vec3,
} from './helpers.ts';

prebuild();

// Upstream's numbers, under its names.
const GROUND_SIZE = 100;
const GROUND_HEIGHT = 0.1;
const SLOPE_ANGLE = 0.2;
const SLOPE_SIZE = 2.0;
const IMPOSSIBLE_SLOPE_ANGLE = 0.6;
const IMPOSSIBLE_SLOPE_SIZE = 2.0;
const BALL_RADIUS = 0.5;
const ITERATIONS = 200;
/** move_shape's desired translation at every iteration, (0.1, −0.1, 0) m a step of 1/60 s: a move of (6, −6, 0) m/s. */
const DESIRED: Vec3 = [0.1, -0.1, 0];
const VELOCITY = DESIRED.map((x) => x * UPSTREAM_RATE);

// Ours (README: Deviations).
/** A ball is a capsule with a tiny half height: our character body holds one capsule. */
const BALL_HALF_HEIGHT = 1e-3;
/** The slope we can't climb, half as long as ours is (upstream: SLOPE_SIZE * 2.0, 4 m), lower end where upstream's is. */
const IMPOSSIBLE_HALF_LENGTH = SLOPE_SIZE * 5.0;
/** Upstream reads translation() after its loop, whose last move is only the next kinematic target: 199 moves applied. */
const READ_AT = ITERATIONS - 1;

const deg = (rad: number): number => (rad * 180) / Math.PI;

function climbWorld(): JsonObject {
  // Upstream: translation (0.1 + slope_size * 2.0 + impossible_slope_size - 0.9 + slope_size,
  // -ground_height + 1.7 + slope_size * impossible_slope_angle.sin(), 0) for a half length of slope_size * 2.0; ours
  // moves that centre up the slope by the length added, so the slope's foot stays put.
  const added = IMPOSSIBLE_HALF_LENGTH - SLOPE_SIZE * 2.0;
  const impossibleCenter: Vec3 = [
    0.1 + SLOPE_SIZE * 2.0 + IMPOSSIBLE_SLOPE_SIZE - 0.9 + SLOPE_SIZE + added * Math.cos(IMPOSSIBLE_SLOPE_ANGLE),
    -GROUND_HEIGHT + 1.7 + SLOPE_SIZE * Math.sin(IMPOSSIBLE_SLOPE_ANGLE) + added * Math.sin(IMPOSSIBLE_SLOPE_ANGLE),
    0,
  ];
  // A kinematic body with a ball of radius 0.5 at (x, 0.5, 0), resting on the ground; ours keeps the capsule's lowest
  // point where the ball's is. Offset and snap are upstream's defaults, 0.01 and 0.2 of the ball's 1 m height.
  const character = (x: number, maxSlopeClimbAngle: number): JsonObject => ({
    kind: 'character',
    shapes: [use('ball')],
    pose: { pos: [x, 0.5 + BALL_HALF_HEIGHT, 0] },
    character: { slope_limit: deg(maxSlopeClimbAngle), offset: 0.01, snap: 0.2 },
  });
  return upstreamWorld({
    shapes: {
      ground: box([GROUND_SIZE, GROUND_HEIGHT, GROUND_SIZE]),
      slope: box([SLOPE_SIZE, GROUND_HEIGHT, SLOPE_SIZE]),
      impossible_slope: box([IMPOSSIBLE_HALF_LENGTH, GROUND_HEIGHT, GROUND_SIZE]),
      ball: capsule(BALL_RADIUS, BALL_HALF_HEIGHT),
    },
    bodies: {
      // Create a flat ground.
      ground: { kind: 'static', shapes: [use('ground')], pose: { pos: [0, -GROUND_HEIGHT, 0] } },
      // Create a slope we can climb.
      slope: { kind: 'static', shapes: [use('slope')], pose: { pos: [0.1 + SLOPE_SIZE, -GROUND_HEIGHT + 0.4, 0], rot: aboutZ(SLOPE_ANGLE) } },
      // Create a slope we can't climb. Upstream: the slope is long enough that the character never reaches its crest
      // within the iteration budget; wrapping around the crest is a knife-edge configuration, not what this test is about.
      impossible_slope: { kind: 'static', shapes: [use('impossible_slope')], pose: { pos: impossibleCenter, rot: aboutZ(IMPOSSIBLE_SLOPE_ANGLE) } },
      // The character which can climb, and the one which cannot.
      can_climb: character(0.6, IMPOSSIBLE_SLOPE_ANGLE + 0.001),
      cannot_climb: character(-0.6, IMPOSSIBLE_SLOPE_ANGLE - 0.001),
    },
    inputs: { walk: { kind: 'move', targets: ['can_climb', 'cannot_climb'] } },
  });
}

/** 200 steps, each character sent by one move at step 0, held until its next (there is none). */
const climbBake = (): JsonObject => ({
  call: 'bake', world: climbWorld(), steps: ITERATIONS, read: ['can_climb', 'cannot_climb'],
  track: ['can_climb', 'cannot_climb'].map((target) => ({ step: 0, kind: 'move', target, data: { velocity: VELOCITY } })),
});

/** Upstream's assertions on our bake; each failure starts with the body it names. */
function climbFailures(planted?: Planted): string[] {
  const [reply] = physics([climbBake()], planted);
  const out: string[] = [];
  const states = {
    can_climb: characterStates(reply!, 'can_climb', 'the climb'),
    cannot_climb: characterStates(reply!, 'cannot_climb', 'the climb'),
  };
  for (const [id, series] of Object.entries(states)) {
    expect(series.length, `the climb: bodies.${id} holds the built state and one state a step`).toBe(ITERATIONS + 1);
    // Grounded-ness must hold except for rare isolated frames: at slope transitions the contact sits right on the
    // detection threshold, so one step may flip. Consecutive ones are a real regression.
    let total = 0;
    let consecutive = 0;
    for (let k = 1; k <= ITERATIONS; k++) {
      if (series[k]!.grounded) {
        consecutive = 0;
        continue;
      }
      total += 1;
      consecutive += 1;
      if (consecutive > 1 || total > 3) {
        out.push(`${id} should be grounded at all times up to isolated threshold flickers: airborne at step ${k} (${consecutive} in a row, ${total} in all), pos ${series[k]!.pos.join(', ')}`);
        break;
      }
    }
  }
  // Upstream's translation is the ball's centre: our capsule's lower cap centre.
  const centre = (id: keyof typeof states): [number, number] => {
    const p = states[id][READ_AT]!.pos;
    return [p[0], p[1] - BALL_HALF_HEIGHT];
  };
  const [cx, cy] = centre('can_climb');
  if (!(cx > 6.0 && cy > 3.0)) out.push(`can_climb ends at x = ${cx}, y = ${cy}: upstream requires x > 6.0 and y > 3.0 (it climbs the slope)`);
  // The blocked character rests against the (extended) steep slope's base.
  const [bx, by] = centre('cannot_climb');
  if (!(bx < 4.5 && by < 2.0)) out.push(`cannot_climb ends at x = ${bx}, y = ${by}: upstream requires x < 4.5 and y < 2.0 (it rests against the steep slope's base)`);
  return out;
}

/** Criteria 1, 3, 8 and 10's IDs (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of each one's
 * text, trimmed, white space collapsed). */
const IDS = '#182.78fd65bc #182.11a4f4a4 #182.a3e169f2 #182.ca0e2323';

describe(`${IDS} upstream character_controller.rs (character_controller_climb_test), run on deep-physics`, () => {
  test(`${IDS} a ball whose slope limit is 0.001 rad over a 0.6 rad slope climbs it, one 0.001 rad under stops at its base, both grounded throughout, and slope_limit_ignored is rejected`, () => {
    none(climbFailures(), 'deep-physics');
    const planted = climbFailures('slope_limit_ignored');
    caught(planted, "the planted controller that climbs under 45° whatever the body's slope_limit");
    expect(planted.some((f) => f.startsWith('cannot_climb ends at')), `the body under its own limit is seen to climb: ${planted.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
