// Ported from Rapier's bindings/python/tests/test_controllers.py (test_character_controller_autostep_clears_step and
// test_character_collision_event_callback), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0; Copyright
// the upstream project's authors). No upstream code is copied: each setup is our physics.world@1 document with a
// character body, read from `deep-physics`'s bake, and each assertion keeps upstream's numbers. Each test also runs the
// #182 suite's `--planted character_as_kinematic`, which the same assertions must reject.
import { describe, test } from 'vitest';
import {
  AC, TIMEOUT, ballCharacter, capsule, caught, moves, none, physics, prebuild, rowsOf, statesOf, touched, upstreamWorld, walk,
  type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped']);

/**
 * test_character_controller_autostep_clears_step: a ground whose top is at y 0, a 0.3 m step spanning x −1.5 to 4.5;
 * a ball character of radius 0.3 (offset 0.01, snap 0.5) moved 0.05 m a frame along +x at 60 Hz (3 m/s) for 600 frames.
 * With a 0.4 m autostep (min width 0.05) it rises onto the step (its centre reaching y 0.55) and makes at least the
 * progress it makes without (within 1e-3); without one (our character always has a step height: 0.25 m, under the
 * step) it stays on the lower ground. Upstream starts the ball over the step's x span; ours starts left of it, as
 * upstream's docstring says (README: deviations).
 */
function autostepFailures(r: Runner): string[] {
  const world = (step: JsonObject): JsonObject => upstreamWorld({
    statics: { ground: { half: [50, 1, 50], pos: [0, -1, 0] }, step: { half: [3, 0.15, 50], pos: [1.5, 0.15, 0] } },
    movers: { hero: ballCharacter('ball', [-2, 0.31, 0], { offset: 0.01, snap: 0.5, step }) },
    shapes: { ball: capsule(0.3) }, inputs: moves(['hero']),
  });
  const [withStep, without] = physics([
    { call: 'bake', world: world({ height: 0.4, width: 0.05 }), steps: 600, track: [walk('hero', 0, [3, 0, 0])], read: ['hero'] },
    { call: 'bake', world: world({ height: 0.25, width: 0.05 }), steps: 600, track: [walk('hero', 0, [3, 0, 0])], read: ['hero'] },
  ], r);
  const a = statesOf(withStep!, 'hero', 'with autostep');
  const b = statesOf(without!, 'hero', 'without');
  const out: string[] = [];
  const [xWith, xWithout] = [a.at(-1)!.pos[0], b.at(-1)!.pos[0]];
  if (!(xWith >= xWithout - 1e-3)) out.push(`autostep regresses horizontal progress (with ${xWith}, without ${xWithout})`);
  const top = Math.max(...a.map((s) => s.pos[1]));
  if (!(top >= 0.55)) out.push(`with a 0.4 m autostep the centre never reaches y 0.55 (at most ${top}): it didn't climb the 0.3 m step`);
  const low = Math.max(...b.map((s) => s.pos[1]));
  if (!(low < 0.55)) out.push(`without autostep the centre reaches y ${low}: it didn't stay on the lower ground`);
  return out;
}

/**
 * test_character_collision_event_callback: a ground at y 0 and a wall whose face is at x 0.9; a ball character of
 * radius 0.4 at (0, 0.45, 0) moved 1.0 m along +x in one 60 Hz frame. The controller reports the wall it touches and
 * moves less than 0.95 m.
 */
function collisionFailures(r: Runner): string[] {
  const w = upstreamWorld({
    statics: { ground: { half: [50, 1, 50], pos: [0, -1, 0] }, wall: { half: [0.1, 1, 50], pos: [1, 1, 0] } },
    movers: { hero: ballCharacter('ball', [0, 0.45, 0]) }, shapes: { ball: capsule(0.4) }, inputs: moves(['hero']),
  });
  const [reply] = physics([{ call: 'bake', world: w, steps: 1, track: [walk('hero', 0, [60, 0, 0])], read: ['hero'] }], r);
  const out: string[] = [];
  if (!touched(rowsOf(reply!, 'the frame'), 'hero', 'wall').length) out.push('no collision with the wall is reported (no contact_begin naming hero and wall)');
  const s = statesOf(reply!, 'hero', 'hero');
  const moved = s[1]!.pos[0] - s[0]!.pos[0];
  if (!(moved < 0.95)) out.push(`the character moved ${moved} m along x, not less than 0.95`);
  return out;
}

describe(`${AC[2]} ${AC[6]} ${AC[8]} ${AC[10]} upstream test_controllers.py, run on deep-physics`, () => {
  test(`${AC[2]} ${AC[6]} ${AC[8]} ${AC[10]} test_character_controller_autostep_clears_step holds, and a character stepped as a plain kinematic body is rejected`, () => {
    none(autostepFailures({}), 'rapier3d');
    caught(autostepFailures({ planted: 'character_as_kinematic' }), '--planted character_as_kinematic');
  }, TIMEOUT);

  test(`${AC[2]} ${AC[6]} test_character_collision_event_callback holds, and a character stepped as a plain kinematic body is rejected`, () => {
    none(collisionFailures({}), 'rapier3d');
    caught(collisionFailures({ planted: 'character_as_kinematic' }), '--planted character_as_kinematic');
  }, TIMEOUT);
});
