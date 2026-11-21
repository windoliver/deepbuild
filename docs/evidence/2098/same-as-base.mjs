// #2098: a 3D world on this change's deep-physics against the base's (85203f458): the runtime's digest and pins, and
// each world's bake key, step hashes and occurrence hash. Usage: node same-as-base.mjs <base binary> <change binary>
import { spawnSync } from 'node:child_process';
const [base, change] = process.argv.slice(2);
const world = (parts) => ({ kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 191, mode: 'dynamic',
  capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0.5, density: 1000 } }, ...parts });
const use = (shape) => ({ shape, contact_material: 'm' });
const worlds = {
  drop: world({ shapes: { floor: { kind: 'box', half: [30, 0.1, 30] }, ball: { kind: 'sphere', radius: 0.1 } },
    bodies: { floor: { kind: 'static', shapes: [use('floor')], pose: { pos: [0, -0.1, 0] } }, ball: { kind: 'dynamic', shapes: [use('ball')], pose: { pos: [0, 2.1, 0] }, mass: 1 } } }),
  forces: world({ shapes: { cube: { kind: 'box', half: [0.5, 0.5, 0.5] } },
    bodies: { a: { kind: 'dynamic', shapes: [use('cube')], pose: { pos: [0, 5, 0], rot: [10, 20, 30] }, mass: 2, velocity: { angular: [30, 0, 10] } }, b: { kind: 'dynamic', shapes: [use('cube')], pose: { pos: [4, 5, 0] } } },
    forces: { drag: { kind: { drag: { linear: 0.5, quadratic: 0.1, medium: [1, 0, 0] } }, applies_to: ['a', 'b'] }, pull: { kind: { spring_to_point: { point: [0, 6, 0], hz: 1, damping_ratio: 0.5 } }, applies_to: ['b'] } } }),
  hinge: world({ gravity: [0, 0, 0], shapes: { cube: { kind: 'box', half: [0.5, 0.5, 0.5] } },
    bodies: { spun: { kind: 'dynamic', shapes: [use('cube')], mass: 6, sleep: false } },
    joints: { axle: { kind: 'hinge', a: 'world', b: 'spun', frame_a: { anchor: [0, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] }, motor: { mode: 'velocity', target: 3600, max_torque: 1, hz: 10, damping_ratio: 1 } } } }),
};
const calls = [{ call: 'runtime' }, ...Object.values(worlds).map((w) => ({ call: 'bake', world: w, steps: 600, read: [], checkpoints: true }))];
const ask = (bin) => spawnSync(bin, [], { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const [was, now] = [ask(base), ask(change)];
let differ = 0;
const same = (what, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); differ += ok ? 0 : 1; console.log(`${ok ? 'SAME' : 'DIFFERS'} ${what}${ok ? '' : `: base ${JSON.stringify(a).slice(0, 200)} change ${JSON.stringify(b).slice(0, 200)}`}`); };
same(`runtime digest ${was[0].runtime_digest}`, was[0].runtime_digest, now[0].runtime_digest);
same('runtime backend and pins', [was[0].backend, was[0].pins], [now[0].backend, now[0].pins]);
Object.keys(worlds).forEach((name, i) => {
  const [a, b] = [was[i + 1], now[i + 1]];
  if (a.ok !== true || b.ok !== true) { differ += 1; console.log(`DIFFERS ${name}: not baked: ${JSON.stringify([a, b]).slice(0, 300)}`); return; }
  same(`${name}: bake key ${a.key.slice(0, 16)}…`, a.key, b.key);
  same(`${name}: ${a.step_hashes.length} step hashes (last ${a.step_hashes.at(-1)})`, a.step_hashes, b.step_hashes);
  same(`${name}: occurrences hash ${a.occurrences_hash}`, a.occurrences_hash, b.occurrences_hash);
  same(`${name}: ${a.checkpoints.length} checkpoints' deep hashes and backend`, a.checkpoints.map((c) => [c.deep_hash, c.backend]), b.checkpoints.map((c) => [c.deep_hash, c.backend]));
});
console.log(differ ? `${differ} differ` : 'every one the same');
process.exit(differ ? 1 : 0);
