// #2098: the three criteria's worlds baked by this change's release deep-physics, as data for the pictures.
// Usage: node make-data.mjs <deep-physics> > data.json
import { spawnSync } from 'node:child_process';
const bin = process.argv[2];
const base = { kind: 'physics.world@1', step_rate: 120, substeps: 4, mode: 'dynamic', capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 } };
const drop = (backend) => ({ ...base, dimensions: 2, seed: 2098, backend: { name: backend, version: '=0.36.1' },
  contact_materials: { half: { friction: 0.5, restitution: 0.5, density: 1000 } },
  shapes: { ball: { kind: 'circle', radius: 0.1 }, floor: { kind: 'segment', a: [-30, 0], b: [30, 0] } },
  bodies: { floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'half' }] }, ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'half' }], pose: { pos: [0, 2.1] } } } });
const solid = (parts) => ({ ...base, dimensions: 3, gravity: [0, 0, 0], seed: 191, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } }, shapes: { cube: { kind: 'box', half: [0.5, 0.5, 0.5] } }, ...parts });
const use = [{ shape: 'cube', contact_material: 'm' }];
const wind = (extra) => solid({ bodies: { vane: { kind: 'dynamic', shapes: use, mass: 1, sleep: false, locks: { angular: [true, true, true] } } },
  forces: { wind: { kind: { wind: { velocity: [2, 0, 0], coupling: { kind: 'aero_triangles', coefficient: 1 }, ...extra } }, applies_to: ['vane'] } } });
const axle = (b, x) => ({ kind: 'hinge', a: 'world', b, frame_a: { anchor: [x, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] }, motor: { mode: 'velocity', target: 3600, max_torque: 1, hz: 10, damping_ratio: 1 } });
const cube = (x, extra = {}) => ({ kind: 'dynamic', shapes: use, pose: { pos: [x, 0, 0] }, mass: 6, sleep: false, ...extra });
const spin = solid({ bodies: { plain: cube(-5), doubled: cube(5, { inertia: [2, 2, 2] }) }, joints: { plain_axle: axle('plain', -5), doubled_axle: axle('doubled', 5) } });
const gust = { gust: { amplitude: 1, scale: 0.5, speed: 2 }, seed: 7 };
const calls = [
  { call: 'bake', world: drop('rapier2d'), steps: 360, read: ['ball'], checkpoints: true },
  { call: 'check', world: drop('rapier3d') },
  { call: 'bake', world: wind({}), steps: 360, read: ['vane'] },
  { call: 'bake', world: wind(gust), steps: 360, read: ['vane'] },
  { call: 'bake', world: spin, steps: 360, read: ['plain', 'doubled'] },
];
const ask = (args) => spawnSync(bin, args, { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r = ask([]);
const twin = ask(['--planted', 'inertia_ignored'])[4];
const col = (reply, id, f) => reply.bodies[id].map(f);
console.log(JSON.stringify({
  drop: { y: col(r[0], 'ball', (s) => s.pos[1]), vy: col(r[0], 'ball', (s) => s.linear[1]), backend: r[0].checkpoints[0].backend, hits: r[0].occurrences.filter((o) => o.kind === 'hit').map((o) => [o.step, o.speed]) },
  refused: r[1].issues.filter((i) => i.severity === 'error').map((i) => ({ path: i.path, actual: i.actual, what: i.what })),
  wind: { vx: col(r[2], 'vane', (s) => s.linear[0]), x: col(r[2], 'vane', (s) => s.pos[0]) },
  gusty: { vx: col(r[3], 'vane', (s) => s.linear[0]), x: col(r[3], 'vane', (s) => s.pos[0]) },
  spin: { plain: col(r[4], 'plain', (s) => s.angular[2]), doubled: col(r[4], 'doubled', (s) => s.angular[2]), ignored: col(twin, 'doubled', (s) => s.angular[2]) },
}));
