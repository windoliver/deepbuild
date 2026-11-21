// #2098 on wasm32: the three criteria's worlds baked by the native release deep-physics and by the wasm32 build
// (node scripts/physics-wasm32.mjs), their step hashes and occurrence hashes compared.
// Usage (from the checkout): node wasm32-same.mjs target/release/deep-physics
import { spawnSync } from 'node:child_process';
const bin = process.argv[2];
const base = { kind: 'physics.world@1', step_rate: 120, substeps: 4, mode: 'dynamic', capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 } };
const drop = { ...base, dimensions: 2, seed: 2098, backend: { name: 'rapier2d', version: '=0.36.1' },
  contact_materials: { half: { friction: 0.5, restitution: 0.5, density: 1000 } },
  shapes: { ball: { kind: 'circle', radius: 0.1 }, floor: { kind: 'segment', a: [-30, 0], b: [30, 0] } },
  bodies: { floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'half' }] }, ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'half' }], pose: { pos: [0, 2.1] } } } };
const solid = (parts) => ({ ...base, dimensions: 3, gravity: [0, 0, 0], seed: 191, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } }, shapes: { cube: { kind: 'box', half: [0.5, 0.5, 0.5] } }, ...parts });
const use = [{ shape: 'cube', contact_material: 'm' }];
const wind = (extra) => solid({ bodies: { vane: { kind: 'dynamic', shapes: use, mass: 1, sleep: false } },
  forces: { wind: { kind: { wind: { velocity: [2, 0, 0], coupling: { kind: 'aero_triangles', coefficient: 1 }, ...extra } }, applies_to: ['vane'] } } });
const axle = (b, x) => ({ kind: 'hinge', a: 'world', b, frame_a: { anchor: [x, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] }, motor: { mode: 'velocity', target: 3600, max_torque: 1, hz: 10, damping_ratio: 1 } });
const cube = (x, extra = {}) => ({ kind: 'dynamic', shapes: use, pose: { pos: [x, 0, 0] }, mass: 6, sleep: false, ...extra });
const worlds = {
  '2D drop on rapier2d': drop,
  'steady wind': wind({}),
  'gusty wind, seed 7': wind({ gust: { amplitude: 1, scale: 0.5, speed: 2 }, seed: 7 }),
  'inertia [2, 2, 2] beside none': solid({ bodies: { plain: cube(-5), doubled: cube(5, { inertia: [2, 2, 2] }) }, joints: { plain_axle: axle('plain', -5), doubled_axle: axle('doubled', 5) } }),
};
const input = `${Object.values(worlds).map((w) => JSON.stringify({ call: 'bake', world: w, steps: 360, read: [] })).join('\n')}\n`;
const lines = (r) => (r.stdout ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const native = spawnSync(bin, [], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
const wasm = spawnSync('node', ['scripts/physics-wasm32.mjs'], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
const [a, b] = [lines(native), lines(wasm)];
if (a.length !== 4 || b.length !== 4) { console.log(`INCONCLUSIVE: native answered ${a.length} of 4 (exit ${native.status}), wasm32 ${b.length} of 4 (exit ${wasm.status}): ${(wasm.stderr ?? '').slice(-600)}`); process.exit(2); }
let differ = 0;
Object.keys(worlds).forEach((name, i) => {
  const [x, y] = [a[i], b[i]];
  if (x.ok !== true || y.ok !== true) { differ += 1; console.log(`DIFFERS ${name}: not baked on both: native ${JSON.stringify(x).slice(0, 200)} wasm32 ${JSON.stringify(y).slice(0, 200)}`); return; }
  const first = x.step_hashes.findIndex((h, k) => h !== y.step_hashes[k]);
  const same = first < 0 && x.step_hashes.length === y.step_hashes.length && x.occurrences_hash === y.occurrences_hash;
  differ += same ? 0 : 1;
  console.log(same ? `SAME ${name}: ${x.step_hashes.length} step hashes (last ${x.step_hashes.at(-1)}), occurrences hash ${x.occurrences_hash.slice(0, 16)}…`
    : `DIFFERS ${name}: ${first < 0 ? 'occurrences or length' : `first at step ${first}: native ${x.step_hashes[first]} wasm32 ${y.step_hashes[first]}`}`);
});
console.log(differ ? `${differ} differ` : 'every one the same on wasm32 as native');
process.exit(differ ? 1 : 0);
