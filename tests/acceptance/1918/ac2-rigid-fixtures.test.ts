// #1918.ea47680a: rigid-world fixtures (a stack that sleeps and wakes, a sealed box with continuous collision, friction on
// an incline, a collision-group matrix, a sensor, a joint that breaks at its threshold) pass with occurrence lists whose
// kinds, IDs, order and counts are written in each fixture before the module runs (the sensor's entry at 0.3193 s within
// one step, the breaking joint's one break within over_steps steps, no contact_end for the 0.6-friction incline box over
// 2 s), never baked from the module's own run.
//
// Each fixture below is a world, a run length and its occurrence list written here from the world's own laws (README:
// Criterion 2's fixtures says why each row is there). The list is compared row by row: kind, `a` (the lower ID in
// canonical order) and `b`, shape uses where written, count, and sort order. Times are pinned only where the issue pins
// them. g = 9.81 m/s², 120 Hz, 4 substeps, restitution 0 everywhere, so nothing bounces.
import { describe, it } from 'vitest';
import {
  CRITERIA, G, RATE, TIMEOUT, bake, box, dynamic, floor, listFailures, none, physics, prebuild, rowText, rowsOf, sphere, world,
  type JsonObject, type Row, type Want,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];

interface Fixture { name: string; world: JsonObject; steps: number; want: Want[]; more?: (rows: Row[]) => string[] }
const pair = (kind: string, a: string, b: string, uses?: [number, number]): Want => (uses ? { kind, a, b, aUse: uses[0], bUse: uses[1] } : { kind, a, b });
const one = (kind: string, a: string): Want => ({ kind, a });
const MATERIALS = {
  ground: { friction: 0.6, restitution: 0, density: 1000 },
  block: { friction: 0.5, restitution: 0, density: 500 },
};

// A stack that sleeps and wakes: two 0.5 m cubes stacked at rest on the floor fall asleep together after the world's
// sleep time (0.5 s); a 50 g stone dropped from 3.139 m (½ g t², t = 0.8 s) lands on the upper cube at 0.8 s and wakes
// both. 1 s. IDs in canonical order: floor < lower < stone < upper.
const DROP = 0.5 * G * 0.8 ** 2;
const stack: Fixture = {
  name: 'a stack that sleeps and wakes',
  world: world({
    contact_materials: MATERIALS,
    shapes: { floor: box([10, 0.1, 10]), cube: box([0.25, 0.25, 0.25]), stone: sphere(0.1) },
    bodies: {
      floor: floor('ground', [10, 0.1, 10]),
      lower: dynamic('cube', 'block', [0, 0.25, 0]),
      upper: dynamic('cube', 'block', [0, 0.75, 0]),
      stone: dynamic('stone', 'block', [0, 1.1 + DROP, 0], { mass: 0.05 }),
    },
  }),
  steps: RATE,
  want: [
    pair('contact_begin', 'floor', 'lower'), pair('contact_begin', 'lower', 'upper'),
    one('rest', 'lower'), one('rest', 'upper'),
    pair('contact_begin', 'stone', 'upper'), pair('hit', 'stone', 'upper'), one('wake', 'lower'), one('wake', 'upper'),
  ],
};

// A sealed box with continuous collision: a closed cell of six 0.2 m walls (one static body, six shape uses: −x, +x,
// −y, +y, −z, +z, inner faces at ±0.9 m) and inside it a 5 cm bullet with CCD fired along +x at 100 m/s (0.83 m a step,
// more than a wall and the bullet together), no gravity. It meets the +x wall (shape use 1) once and stays there. 0.5 s.
const wall = (shape: string, pos: [number, number, number]): JsonObject => ({ shape, contact_material: 'ground', offset: { pos } });
const sealed: Fixture = {
  name: 'a sealed box with continuous collision',
  world: world({
    gravity: [0, 0, 0],
    contact_materials: { ...MATERIALS, lead: { friction: 0.5, restitution: 0, density: 11000 } },
    shapes: { bullet: sphere(0.05), wall_x: box([0.1, 1.1, 1.1]), wall_y: box([1.1, 0.1, 1.1]), wall_z: box([1.1, 1.1, 0.1]) },
    bodies: {
      cell: { kind: 'static', shapes: [wall('wall_x', [-1, 0, 0]), wall('wall_x', [1, 0, 0]), wall('wall_y', [0, -1, 0]), wall('wall_y', [0, 1, 0]), wall('wall_z', [0, 0, -1]), wall('wall_z', [0, 0, 1])] },
      bullet: { kind: 'dynamic', shapes: [{ shape: 'bullet', contact_material: 'lead' }], pose: { pos: [0, 0, 0] }, velocity: { linear: [100, 0, 0] }, ccd: true, sleep: false },
    },
  }),
  steps: RATE / 2,
  want: [pair('contact_begin', 'bullet', 'cell', [0, 1]), pair('hit', 'bullet', 'cell', [0, 1])],
};

// Friction on an incline: a 0.5 m cube resting on a static ramp tilted 30°, friction 0.6 on both (geometric: 0.6 >
// tan 30° = 0.577), held for 2 s (the behavior kit: within 1 mm). It touches from the start and never leaves: one
// contact_begin and no contact_end. The cube never sleeps (`sleep: false`), so no rest row. block < ramp.
const COS30 = Math.cos(Math.PI / 6);
const incline: Fixture = {
  name: 'friction on an incline',
  world: world({
    contact_materials: { rough: { friction: 0.6, restitution: 0, density: 500 } },
    shapes: { ramp: box([3, 0.1, 1]), block: box([0.25, 0.25, 0.25]) },
    bodies: {
      ramp: { kind: 'static', shapes: [{ shape: 'ramp', contact_material: 'rough' }], pose: { pos: [0, 1, 0], rot: [0, 0, 30] } },
      block: { kind: 'dynamic', shapes: [{ shape: 'block', contact_material: 'rough' }], pose: { pos: [-0.35 * 0.5, 1 + 0.35 * COS30, 0], rot: [0, 0, 30] }, sleep: false },
    },
  }),
  steps: 2 * RATE,
  want: [pair('contact_begin', 'block', 'ramp')],
  more: (rows) => rows.filter((r) => r.kind === 'contact_end').map((r) => `the 0.6-friction incline box leaves the ramp: ${rowText(r)}`),
};

// A collision-group matrix: groups ground, red, blue; the floor is a member of ground and collides with red. Four balls
// 2 m apart: red (member red, collides ground) dropped 1 m and purple (member red and blue, collides ground) dropped
// 1.5 m interact with the floor both ways and land, red first; blue (member blue, collides ground) and mute (member red,
// collides nothing) don't, and fall through. 0.75 s. floor < purple < red.
const ball = (pos: [number, number, number], member: string[], collides: string[]): JsonObject =>
  ({ kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'block', member, collides }], pose: { pos } });
const groups: Fixture = {
  name: 'a collision-group matrix',
  world: world({
    collision_groups: ['ground', 'red', 'blue'],
    contact_materials: MATERIALS,
    shapes: { floor: box([10, 0.1, 10]), ball: sphere(0.1) },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'ground', member: ['ground'], collides: ['red'] }], pose: { pos: [0, -0.1, 0] } },
      red: ball([-3, 1.1, 0], ['red'], ['ground']),
      blue: ball([-1, 1.1, 0], ['blue'], ['ground']),
      mute: ball([1, 1.1, 0], ['red'], []),
      purple: ball([3, 1.6, 0], ['red', 'blue'], ['ground']),
    },
  }),
  steps: 90,
  want: [pair('contact_begin', 'floor', 'red'), pair('hit', 'floor', 'red'), pair('contact_begin', 'floor', 'purple'), pair('hit', 'floor', 'purple')],
};

// A sensor (the behavior kit's occurrences fixture): a 0.1 m ball whose lowest point falls from 1 m, through a static
// sensor slab whose top is 0.5 m below it (entry at √(2 · 0.5 ÷ g) = 0.3193 s), out of its bottom 0.6 m below, onto the
// floor (0.4515 s). 0.6 s. ball < floor < gate.
const SENSOR_ENTRY = Math.sqrt((2 * 0.5) / G);
const sensor: Fixture = {
  name: 'a sensor',
  world: world({
    contact_materials: MATERIALS,
    shapes: { floor: box([10, 0.1, 10]), ball: sphere(0.1), gate: box([0.5, 0.05, 0.5]) },
    bodies: {
      floor: floor('ground', [10, 0.1, 10]),
      gate: { kind: 'static', shapes: [{ shape: 'gate', contact_material: 'ground', sensor: true }], pose: { pos: [0, 0.45, 0] } },
      ball: dynamic('ball', 'block', [0, 1.1, 0]),
    },
  }),
  steps: 72,
  want: [pair('sensor_enter', 'ball', 'gate'), pair('sensor_exit', 'ball', 'gate'), pair('contact_begin', 'ball', 'floor'), pair('hit', 'ball', 'floor')],
  more: (rows) => {
    const entry = rows.find((r) => r.kind === 'sensor_enter');
    if (!entry) return [];
    const t = entry.step / RATE;
    return Math.abs(t - SENSOR_ENTRY) <= 1 / RATE ? [] : [`the sensor's entry is at step ${entry.step} (${t.toFixed(4)} s), not within one step (1/120 s) of ${SENSOR_ENTRY.toFixed(4)} s`];
  },
};

// A joint that breaks at its threshold: two boxes hang from the world on fixed joints with `breaks_at: {force: 15 N,
// over_steps: 3}`: heavy (2 kg, a load of 19.62 N from the first step) breaks, light (1 kg, 9.81 N) never does. The
// break is written once, within over_steps steps of the load first passing it (steps 3 or 4); nothing else touches.
// 0.5 s; neither body sleeps.
const OVER = 3;
const hang = (x: number, mass: number): JsonObject => ({ kind: 'dynamic', shapes: [{ shape: 'tall', contact_material: 'block' }], pose: { pos: [x, 1.5, 0] }, mass, sleep: false });
const hook = (x: number, body: string): JsonObject => ({ kind: 'fixed', a: 'world', b: body, frame_a: { anchor: [x, 2, 0] }, frame_b: { anchor: [0, 0.5, 0] }, breaks_at: { force: 15, over_steps: OVER } });
const joint: Fixture = {
  name: 'a joint that breaks at its threshold',
  world: world({
    contact_materials: MATERIALS,
    shapes: { tall: box([0.25, 0.5, 0.25]) },
    bodies: { heavy: hang(-2, 2), light: hang(2, 1) },
    joints: { snap: hook(-2, 'heavy'), hold: hook(2, 'light') },
  }),
  steps: RATE / 2,
  want: [one('break', 'snap')],
  more: (rows) => {
    const brk = rows.find((r) => r.kind === 'break');
    if (!brk) return [];
    return brk.step >= OVER && brk.step <= OVER + 1 ? [] : [`the joint breaks at step ${brk.step}, not within over_steps (${OVER}) steps of its load passing 15 N at step 1 (steps ${OVER} to ${OVER + 1})`];
  },
};

describe(`${ID} rigid-world fixtures pass with the occurrence lists written in each before the module runs`, () => {
  for (const f of [stack, sealed, incline, groups, sensor, joint]) {
    it(`${ID} (${f.name}) the world's occurrence list is the fixture's: its kinds, IDs, order and count`, () => {
      const [reply] = physics([bake(f.world, f.steps, { read: [] })]);
      const rows = rowsOf(reply, `${f.name}: the bake`);
      none([...listFailures(rows, f.want, f.name), ...(f.more?.(rows) ?? [])], `${f.name}: the occurrence list`);
    }, TIMEOUT);
  }
});
