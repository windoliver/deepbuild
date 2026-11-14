// Exports #523's fixtures as one film: `node export.mjs <deep-show> <out dir> [mov|png_seq]`. Each fixture is its own
// world in one scene (the blind suite's worlds, tests/acceptance/523/helpers.ts, moved apart), its bodies drawn
// through pose outputs; the joint readings the film can't draw yet (#2248) are baked by `deep-physics` (readings.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [bin, dir, codec = 'mov'] = process.argv.slice(2);
const G = 9.81;
const ev = join(dir, 'evidence');
mkdirSync(ev, { recursive: true });

const world = (parts) => ({
  kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -G, 0], seed: 523, mode: 'dynamic',
  capacity: { bodies: 8, shapes: 8, joints: 8, contacts: 32, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } }, ...parts,
});
const box = (half) => ({ kind: 'box', half });
const sphere = (radius) => ({ kind: 'sphere', radius });
const pose = (body, item = body) => ({ from: body, read: 'pose', to: `items/${item}/at` });
const hinge = (a, b, anchor, frameB = [0, 0, 0], extra = {}) => ({ kind: 'hinge', a, b, frame_a: { anchor, axis: [0, 0, 1] }, frame_b: { anchor: frameB, axis: [0, 0, 1] }, ...extra });

let order = 0;
const items = {};
const item = (id, kind, params, at) => { items[id] = { id, name: id, order: `a${String(order++).padStart(2, '0')}`, kind, params, ...(at ? { at: { pos: at } } : {}) }; };
const label = (id, text, at) => item(id, 'mark.text@1', { text, size: 0.26, size_space: 'world', paint: { fill: { role: 'ink' } } }, at);
const bar = (id, half, role = 'accent') => item(id, 'mark.box@1', { size: half.map((h, i) => (i === 0 ? 2 * h : Math.max(2 * h, 0.16))), paint: { fill: { role } } });
const ball = (id, r, at, role = 'accent') => item(id, 'mark.sphere@1', { size: [2 * r, 2 * r, 2 * r], paint: { fill: { role } } }, at);
const pin = (id, at) => ball(id, 0.07, at, 'ink');

item('cam', 'camera@1', { projection: 'perspective', position: [0, 0.4, 17], target: [0, 0.4, 0], fov: 50, near: 0.1, far: 200 });
const worlds = {};

// 1. The flywheel: a balanced 10 kg bar on a hinge about +z, started at 360 deg/s, no motor or damping.
{
  const [x, y] = [-6, 3];
  bar('fly', [0.8, 0.07, 0.07]); pin('fly_pin', [x, y, 0.2]);
  label('fly_label', 'flywheel, 360°/s', [x, y + 1.3, 0]);
  worlds.flywheel = world({
    gravity: [0, 0, 0], shapes: { bar: box([0.8, 0.07, 0.07]) },
    bodies: { fly: { kind: 'dynamic', shapes: [{ shape: 'bar', contact_material: 'm' }], pose: { pos: [x, y, 0] }, mass: 10, velocity: { angular: [0, 0, 360] }, sleep: false } },
    joints: { axle: hinge('world', 'fly', [x, y, 0]) },
    outputs: { fly: pose('fly'), spin: { from: 'axle', read: 'joint_coordinate', crossings: [90] } },
  });
}
// 2. The arm on its limit: 100 N at 0.5 m, 50 N·m about the hinge, breaks_at 20 N·m over 6 steps; it falls once broken.
{
  const [x, y] = [-3.4, 3];
  bar('limit_arm', [0.5, 0.05, 0.05]); pin('limit_pin', [x, y, 0.2]);
  label('limit_label', 'on its limit: breaks', [x + 0.5, y + 1.3, 0]);
  worlds.limit = world({
    shapes: { bar: box([0.5, 0.05, 0.05]) },
    bodies: { limit_arm: { kind: 'dynamic', shapes: [{ shape: 'bar', contact_material: 'm' }], pose: { pos: [x + 0.5, y, 0] }, mass: 100 / G, sleep: false } },
    joints: { elbow: hinge('world', 'limit_arm', [x, y, 0], [-0.5, 0, 0], { limits: { min: 0, max: 90 }, breaks_at: { torque: 20, over_steps: 6 } }) },
    outputs: { limit_arm: pose('limit_arm'), load: { from: 'elbow', read: 'joint_force' } },
  });
}
// 3. The pressed arm: no gravity; its velocity motor (50 N·m) presses it up against a ball 0.8 m out, and it holds.
{
  const [x, y] = [0.2, 3];
  bar('pressed_arm', [0.5, 0.05, 0.05]); pin('pressed_pin', [x, y, 0.2]); ball('wall', 0.05, [x + 0.8, y + 0.1, 0], 'muted');
  label('pressed_label', 'motor on a wall: holds', [x + 0.5, y + 1.3, 0]);
  worlds.pressed = world({
    gravity: [0, 0, 0], shapes: { bar: box([0.5, 0.05, 0.05]), stop: sphere(0.05) },
    bodies: {
      pressed_arm: { kind: 'dynamic', shapes: [{ shape: 'bar', contact_material: 'm' }], pose: { pos: [x + 0.5, y, 0] }, mass: 100 / G, sleep: false },
      wall: { kind: 'static', shapes: [{ shape: 'stop', contact_material: 'm' }], pose: { pos: [x + 0.8, y + 0.1, 0] } },
    },
    joints: { elbow: hinge('world', 'pressed_arm', [x, y, 0], [-0.5, 0, 0], { limits: { min: -90, max: 90 }, breaks_at: { torque: 20, over_steps: 6 }, motor: { mode: 'velocity', target: 90, max_torque: 50, hz: 10, damping_ratio: 1 } }) },
    outputs: { pressed_arm: pose('pressed_arm'), load: { from: 'elbow', read: 'joint_force' } },
  });
}
// 4. Two balls on fixed joints with breaks_at 15 N over 6 steps: 2 kg (19.62 N) breaks and falls, 1 kg (9.81 N) holds.
{
  const [x, y] = [3.6, 3.6];
  ball('heavy', 0.12, null); ball('light', 0.09, null, 'muted');
  pin('heavy_hook', [x, y + 0.12, 0.2]); pin('light_hook', [x + 1, y + 0.09, 0.2]);
  label('hang_label', '2 kg breaks, 1 kg holds', [x + 0.5, y + 0.7, 0]);
  const hook = (b, at, r) => ({ kind: 'fixed', a: 'world', b, frame_a: { anchor: [at, y + r, 0] }, frame_b: { anchor: [0, r, 0] }, breaks_at: { force: 15, over_steps: 6 } });
  worlds.hanging = world({
    shapes: { big: sphere(0.12), small: sphere(0.09) },
    bodies: {
      heavy: { kind: 'dynamic', shapes: [{ shape: 'big', contact_material: 'm' }], pose: { pos: [x, y, 0] }, mass: 2, sleep: false },
      light: { kind: 'dynamic', shapes: [{ shape: 'small', contact_material: 'm' }], pose: { pos: [x + 1, y, 0] }, mass: 1, sleep: false },
    },
    joints: { heavy_hook: hook('heavy', x, 0.12), light_hook: hook('light', x + 1, 0.09) },
    outputs: { heavy: pose('heavy'), light: pose('light'), load: { from: 'heavy_hook', read: 'joint_force' } },
  });
}
const kinematic = (parts) => world({ mode: 'kinematic', gravity: [0, 0, 0], ...parts });
const dial = (id, z) => item(id, 'mark.box@1', { size: [0.01, 0.01, 0.01], paint: { fill: { role: 'muted' } } }, [0, -40, z]);
dial('crank', -60); dial('lower', -61); dial('reach', -62);
const linear = (from, to, at) => ({ k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: at, value: to, interp: 'hold' } });
const channels = {
  crank: { target: 'items/crank/at/pos/0', type: 'f32', keys: linear(0, 360, '4s') },
  lower: { target: 'items/lower/at/pos/0', type: 'f32', keys: linear(0, -0.8, '3s') },
  reach: { target: 'items/reach/at/pos/0', type: 'f32', keys: linear(1, 3, '4s') },
};
// 5. The gear: the crank drives `drive` at 90°/s and the gear of ratio 2 turns `driven` twice as far.
{
  const [x, y] = [-5.5, -2.2];
  bar('cog_in', [0.45, 0.06, 0.06]); bar('cog_out', [0.45, 0.06, 0.06], 'muted');
  pin('cog_in_pin', [x - 0.6, y, 0.2]); pin('cog_out_pin', [x + 0.6, y, 0.2]);
  label('gear_label', 'gear ×2', [x, y + 1.2, 0]);
  worlds.gears = kinematic({
    shapes: { cog: box([0.45, 0.06, 0.06]) },
    bodies: {
      cog_in: { kind: 'dynamic', shapes: [{ shape: 'cog', contact_material: 'm' }], pose: { pos: [x - 0.6, y, 0] }, mass: 1 },
      cog_out: { kind: 'dynamic', shapes: [{ shape: 'cog', contact_material: 'm' }], pose: { pos: [x + 0.6, y, 0] }, mass: 1 },
    },
    joints: { drive: hinge('world', 'cog_in', [x - 0.6, y, 0]), driven: hinge('world', 'cog_out', [x + 0.6, y, 0]), mesh: { kind: 'gear', a: 'cog_in', b: 'cog_out', of: ['drive', 'driven'], ratio: 2 } },
    solve: { drivers: [{ joint: 'drive', channel: 'items/crank/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
    outputs: { cog_in: pose('cog_in'), cog_out: pose('cog_out'), turn_in: { from: 'drive', read: 'joint_coordinate' }, turn_out: { from: 'driven', read: 'joint_coordinate' } },
  });
}
// 6. The pulley: `left` lowered by its driver, `right` rising so the rope's two lengths keep their sum.
{
  const [x, y] = [-1.5, -1.2];
  bar('left', [0.15, 0.15, 0.15]); bar('right', [0.15, 0.15, 0.15], 'muted');
  pin('ground_a', [x - 0.6, y + 0.6, 0]); pin('ground_b', [x + 0.6, y + 0.6, 0]);
  item('rope_a', 'mark.line@1', { points: ['ground_a', 'left'], width: [3, 3], paint: { fill: { role: 'ink' } } });
  item('rope_b', 'mark.line@1', { points: ['ground_b', 'right'], width: [3, 3], paint: { fill: { role: 'ink' } } });
  label('pulley_label', 'pulley', [x, y + 1.2, 0]);
  const rail = (b, at) => ({ kind: 'slider', a: 'world', b, frame_a: { anchor: at, axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] } });
  worlds.pulley = kinematic({
    shapes: { weight: box([0.15, 0.15, 0.15]) },
    bodies: {
      left: { kind: 'dynamic', shapes: [{ shape: 'weight', contact_material: 'm' }], pose: { pos: [x - 0.6, y - 1, 0] }, mass: 1 },
      right: { kind: 'dynamic', shapes: [{ shape: 'weight', contact_material: 'm' }], pose: { pos: [x + 0.6, y - 1, 0] }, mass: 1 },
    },
    joints: {
      left_rail: rail('left', [x - 0.6, y - 1, 0]), right_rail: rail('right', [x + 0.6, y - 1, 0]),
      rope: { kind: 'pulley', a: 'left', b: 'right', ratio: 1, pulley: { ground_a: [x - 0.6, y + 0.6, 0], ground_b: [x + 0.6, y + 0.6, 0], length_min: 0.2, length_max: 3 } },
    },
    solve: { drivers: [{ joint: 'left_rail', channel: 'items/lower/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
    outputs: { left: pose('left'), right: pose('right'), left_at: { from: 'left', read: 'position' }, right_at: { from: 'right', read: 'position' } },
  });
}
// 7. The two-link arm: its hand slides out along +x from 1 m at 0.5 m/s; at 2 s the arm is straight and jams.
{
  const [x, y] = [1.5, -2.6];
  const S = Math.sqrt(3) / 2;
  bar('upper', [0.5, 0.04, 0.04]); bar('fore', [0.5, 0.04, 0.04], 'muted'); ball('hand', 0.08, null, 'ink'); pin('shoulder_pin', [x, y, 0.2]);
  label('arm_label', 'two-link arm: jams at 2 s', [x + 1.2, y + 1.6, 0]);
  const h = (a, b, at, atB) => ({ kind: 'hinge', a, b, frame_a: { anchor: at, axis: [0, 0, 1] }, frame_b: { anchor: atB, axis: [0, 0, 1] } });
  const link = (pos, deg) => ({ kind: 'dynamic', shapes: [{ shape: 'link', contact_material: 'm' }], pose: { pos, rot: [0, 0, deg] }, mass: 1 });
  worlds.arm = kinematic({
    shapes: { link: box([0.5, 0.04, 0.04]), palm: sphere(0.08) },
    bodies: {
      upper: link([x + 0.25, y + S / 2, 0], 60),
      fore: link([x + 0.75, y + S / 2, 0], -60),
      hand: { kind: 'dynamic', shapes: [{ shape: 'palm', contact_material: 'm' }], pose: { pos: [x + 1, y, 0] }, mass: 1 },
    },
    joints: {
      shoulder: h('world', 'upper', [x, y, 0], [-0.5, 0, 0]), elbow: h('upper', 'fore', [0.5, 0, 0], [-0.5, 0, 0]), grip: h('fore', 'hand', [0.5, 0, 0], [0, 0, 0]),
      reach: { kind: 'slider', a: 'world', b: 'hand', frame_a: { anchor: [x, y, 0], axis: [1, 0, 0] }, frame_b: { anchor: [0, 0, 0], axis: [1, 0, 0] } },
    },
    solve: { drivers: [{ joint: 'reach', channel: 'items/reach/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
    outputs: { upper: pose('upper'), fore: pose('fore'), hand: pose('hand'),
      shoulder_at: { from: 'shoulder', read: 'joint_coordinate' }, elbow_at: { from: 'elbow', read: 'joint_coordinate' } },
  });
}

const doc = {
  format: 1, profile: 'film', title: 'Joints, caps and the kinematic solve', description: 'Issue #523: hinge turns, breaks counted from locks and limits, the kinematic gear, pulley and jam.',
  size: [1280, 720], camera: 'cam', transport: { span: '3s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } },
  items, channels, worlds,
};
writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc, null, 1));
const DOC = '01JB523F1LM00000000000000A';
const out = codec === 'png_seq' ? join(dir, 'frames') : join(dir, 'joints.mov');
const scenario = { evidence: ev, sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: joints', process: { pid: 4100, start: 1000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
  calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document: doc, include: ['issues'] },
    { call: 'export', doc: DOC, out, video: { codec: codec === 'png_seq' ? 'png_seq' : 'h264' } }] };
const r = spawnSync(bin, ['run'], { input: JSON.stringify(scenario) + '\n', encoding: 'utf8', maxBuffer: 1 << 30 });
writeFileSync(join(dir, 'reply.json'), r.stdout ?? '');
const reply = JSON.parse((r.stdout ?? '').trim() || '{}');
const rep = reply.replies ?? [];
console.log(JSON.stringify({ ok: reply.ok, code: reply.code, what: reply.what, presented: rep[0]?.outcome, issues: (rep[0]?.issues ?? []).slice(0, 6), export: rep[1]?.outcome ?? rep[1], frames: rep[1]?.receipt?.frames }, null, 1).slice(0, 4000));
if (r.stderr) console.error(r.stderr.slice(-2000));
