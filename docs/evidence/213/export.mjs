// Films #213 with the product's own export and checks what it drew against the run's own numbers:
// `node export.mjs <deep-show> <out dir> [mov|png_seq]`.
//
// - hitscan: a logic item, `turret`, asks physics.cast@1 a fan of 32 rays every step and draws each hit it read the
//   step after as a dot (an instancer fed by its arrays). The world holds a wall moving toward it at 1 m/s, two pillars
//   and a falling ball. A dot on the wall must sit on the wall's face at the state the asking step read.
// - mirror: `crowd` writes a 20 × 20 grid of points, lifting one row a step; `copier` mirrors crowd.pos and draws its
//   copy 12 m to the right. Every step its copy must equal crowd's array as the step before left it, and its list must
//   name only the rows that changed.
//
// Programs are WebAssembly text, assembled by #544's assembler (tests/acceptance/544/wat).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [bin, dir, codec = 'mov'] = process.argv.slice(2);
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const ev = join(dir, 'evidence');
mkdirSync(ev, { recursive: true });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'The #213 evidence film.' };
const SPAN = 3;
const STEPS = SPAN * 60;

// ---- Programs

const RAYS = 32;
const REQUEST = 160;
const S = 4096; // services_at
const RAYS_AT = 32768;
const YAWS_AT = RAYS_AT + RAYS * REQUEST;
const angle = (i) => -75 + (150 * i) / (RAYS - 1);
const hex = (b) => [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
/** 32 rays from (0, 1, 0) in the ground plane, fanned evenly from −75° to +75° about +x, 30 m, every group. */
function fan() {
  const b = Buffer.alloc(RAYS * REQUEST);
  for (let i = 0; i < RAYS; i++) {
    const o = i * REQUEST;
    const a = (angle(i) * Math.PI) / 180;
    b.writeUInt32LE(0xffffffff, o + 8);
    b.writeDoubleLE(30, o + 16);
    [0, 1, 0].forEach((v, j) => b.writeDoubleLE(v, o + 24 + 8 * j));
    [Math.cos(a), 0, Math.sin(a)].forEach((v, j) => b.writeDoubleLE(v, o + 48 + 8 * j));
  }
  return hex(b);
}
/** Each ray's beam turned about +y by −its angle, so a unit box along +x lies along the ray. */
function yaws() {
  const b = Buffer.alloc(RAYS * 8);
  for (let i = 0; i < RAYS; i++) b.writeDoubleLE(-angle(i), 8 * i);
  return hex(b);
}
// The turret's write region from 1024: live (32 bool), gen (32 i32), pos (32 vec3, from 1280), beam_pos (32 vec3, from
// 2048), beam_yaw (32 f64, from 2816) and beam_scale (32 vec3, from 3072). Each step it reads the answers to the last
// step's rays (result count at S + 8 + 160 × 32, each result 520 B, its first hit's point 16 B in and its distance 64 B
// in), draws a dot at each hit and a beam from the turret to it, and asks the same 32 again.
const RC = S + 8 + REQUEST * RAYS;
const turret = `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (global (export "services_at") i32 (i32.const ${S}))
  (data (i32.const ${RAYS_AT}) "${fan()}")
  (data (i32.const ${YAWS_AT}) "${yaws()}")
  (func (export "init") (param i64)
    (memory.copy (i32.const ${S + 8}) (i32.const ${RAYS_AT}) (i32.const ${RAYS * REQUEST}))
    (memory.copy (i32.const 2816) (i32.const ${YAWS_AT}) (i32.const ${RAYS * 8})))
  (func (export "step") (param $k i64) (local $i i32) (local $n i32) (local $r i32) (local $o i32)
    (local.set $n (i32.load (i32.const ${RC})))
    (loop $each
      (local.set $r (i32.add (i32.const ${RC + 8}) (i32.mul (local.get $i) (i32.const 520))))
      (if (i32.and (i32.lt_u (local.get $i) (local.get $n)) (i32.ne (i32.load (local.get $r)) (i32.const 0)))
        (then
          (i32.store (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
          (i32.store (i32.add (i32.const 1152) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
          (local.set $o (i32.mul (local.get $i) (i32.const 24)))
          (memory.copy (i32.add (i32.const 1280) (local.get $o)) (i32.add (local.get $r) (i32.const 16)) (i32.const 24))
          (f64.store (i32.add (i32.const 2048) (local.get $o)) (f64.mul (f64.load (i32.add (local.get $r) (i32.const 16))) (f64.const 0.5)))
          (f64.store (i32.add (i32.const 2056) (local.get $o)) (f64.mul (f64.add (f64.load (i32.add (local.get $r) (i32.const 24))) (f64.const 1)) (f64.const 0.5)))
          (f64.store (i32.add (i32.const 2064) (local.get $o)) (f64.mul (f64.load (i32.add (local.get $r) (i32.const 32))) (f64.const 0.5)))
          (f64.store (i32.add (i32.const 3072) (local.get $o)) (f64.load (i32.add (local.get $r) (i32.const 64))))
          (f64.store (i32.add (i32.const 3080) (local.get $o)) (f64.const 1))
          (f64.store (i32.add (i32.const 3088) (local.get $o)) (f64.const 1)))
        (else (i32.store (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${RAYS}))))
    (i32.store (i32.const ${S}) (i32.const ${RAYS}))))`;

const N = 400;
const GRID = 20;
// crowd's write region from 1024: live (400 bool), gen (400 i32), pos (400 vec3, from 4224). Element (row, col) is
// row × 20 + col at x = −10.5 + col / 2, z = −4.75 + row / 2; step k lifts row k mod 20 to y = 1 and lowers the one
// before, so a step changes two runs of 20.
const crowd = `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64) (local $i i32) (local $p i32)
    (loop $each
      (i32.store (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const 2624) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (local.set $p (i32.add (i32.const 4224) (i32.mul (local.get $i) (i32.const 24))))
      (f64.store (local.get $p) (f64.add (f64.const -10.5) (f64.mul (f64.const 0.5) (f64.convert_i32_u (i32.rem_u (local.get $i) (i32.const ${GRID}))))))
      (f64.store (i32.add (local.get $p) (i32.const 16)) (f64.add (f64.const -4.75) (f64.mul (f64.const 0.5) (f64.convert_i32_u (i32.div_u (local.get $i) (i32.const ${GRID}))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${N})))))
  (func $row (param $r i32) (param $y f64) (local $c i32)
    (loop $each
      (f64.store (i32.add (i32.const 4232) (i32.mul (i32.add (i32.mul (local.get $r) (i32.const ${GRID})) (local.get $c)) (i32.const 24))) (local.get $y))
      (local.set $c (i32.add (local.get $c) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $c) (i32.const ${GRID})))))
  (func (export "step") (param $k i64) (local $r i32)
    (local.set $r (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const ${GRID}))))
    (call $row (i32.rem_u (i32.add (local.get $r) (i32.const ${GRID - 1})) (i32.const ${GRID})) (f64.const 0))
    (call $row (local.get $r) (f64.const 1))))`;

// copier's read region holds its list at 0; its mirror of crowd.pos sits at 32768; its write region from 4096: live,
// gen, copy (400 vec3, from 7296) and ranges (one i32, from 16896), the list's count. Each step it copies the mirror
// into `copy`, 12 m along x.
const MIRROR_AT = 32768;
const copier = `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))
  (global (export "crowd_at") i32 (i32.const ${MIRROR_AT}))
  (func (export "init") (param i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const 4096) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const 5696) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${N})))))
  (func (export "step") (param $k i64) (local $i i32) (local $o i32)
    (memory.copy (i32.const 7296) (i32.const ${MIRROR_AT}) (i32.const ${N * 24}))
    (loop $each
      (local.set $o (i32.add (i32.const 7296) (i32.mul (local.get $i) (i32.const 24))))
      (f64.store (local.get $o) (f64.add (f64.load (local.get $o)) (f64.const 12)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${N}))))
    (i32.store (i32.const 16896) (i32.load (i32.const 0)))))`;

function assemble(programs) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-213-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  const files = Object.entries(programs).map(([name, text]) => { const f = join(dir, `${name}.wat`); writeFileSync(f, text); return f; });
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, ...files], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused a program: ${run.stderr}`);
  return Object.fromEntries(Object.keys(programs).map((name) => {
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const h = sha256(bytes);
    mkdirSync(join(ev, h.slice(0, 2)), { recursive: true });
    writeFileSync(join(ev, h.slice(0, 2), h.slice(2)), bytes);
    return [name, h];
  }));
}
const sha = assemble({ turret, crowd, copier });

// ---- Documents

const world = (parts) => ({
  kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 213, mode: 'dynamic',
  capacity: { bodies: 8, shapes: 8, joints: 0, contacts: 32, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0.3, density: 1000 } }, ...parts,
});
const material = (rgb, unlit = false) => ({ kind: 'material@1', params: { base_color: [...rgb, 1], ...(unlit ? { unlit: true } : {}), roughness: 0.8 } });
const col = (array, as) => ({ array, as });
// A sun from the turret's side (it shines along its own −z, turned by Rz·Ry·Rx), and a light sky so shade isn't black.
const SUN = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-55, -60, 0] } };
const SKY = { kind: 'sky@1', params: { top: [0.75, 0.82, 0.92, 1], low: [0.95, 0.95, 0.97, 1], ambient_top: [0.45, 0.47, 0.52], ambient_low: [0.3, 0.3, 0.3] } };
function film(title, description, items, extra) {
  let order = 0;
  const ordered = Object.fromEntries(Object.entries(items).map(([id, i]) => [id, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...i }]));
  const assets = Object.fromEntries(Object.entries(items).filter(([, i]) => i.kind === 'logic@1').map(([id, i]) => [`${id}_program`, { sha256: i.params.program, license: LICENSE }]));
  return { format: 1, profile: 'film', title, description, size: [1280, 720], camera: 'cam', seed: 213, transport: { span: `${SPAN}s`, frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', logic: '^1' } }, ...extra, items: ordered, assets };
}

// The wall: a 1 × 4 × 6 m slab, its centre from x = 10.5 m at 0 s to 7.5 m at 3 s, so its face moves at 1 m/s.
const WALL_X = 10.5;
const hitscan = film('Hit-scan between steps', 'Issue #213: a logic item asks physics.cast@1 32 rays a step and draws the hits it reads one step later.', {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [-3, 11, 13], target: [6, 0, 0], fov: 50, near: 0.1, far: 200 } },
  sky: SKY,
  sun: SUN,
  stone: material([0.55, 0.57, 0.62]),
  glow: { kind: 'material@1', params: { base_color: [1, 0.3, 0.2, 1], unlit: true } },
  red: material([1, 0.15, 0.1], true),
  amber: material([1, 0.7, 0.1]),
  floor: { kind: 'mark.box@1', params: { size: [30, 0.1, 24] }, material: 'stone', at: { pos: [6, -0.05, 0] } },
  wall: { kind: 'mark.box@1', params: { size: [1, 4, 6] }, material: 'stone', at: { pos: [WALL_X, 2, 0] } },
  pillar_a: { kind: 'mark.box@1', params: { size: [0.6, 3, 0.6] }, material: 'stone', at: { pos: [4, 1.5, -2.5] } },
  pillar_b: { kind: 'mark.box@1', params: { size: [0.6, 3, 0.6] }, material: 'stone', at: { pos: [5, 1.5, 3] } },
  ball: { kind: 'mark.sphere@1', params: { size: [0.8, 0.8, 0.8] }, material: 'amber' },
  base: { kind: 'mark.sphere@1', params: { size: [0.3, 0.3, 0.3] }, material: 'red', at: { pos: [0, 1, 0] } },
  dot: { kind: 'mark.sphere@1', params: { size: [0.16, 0.16, 0.16] }, material: 'red', visible: false },
  beam: { kind: 'mark.box@1', params: { size: [1, 0.025, 0.025] }, material: 'glow', visible: false },
  turret_label: { kind: 'mark.text@1', params: { text: 'turret: 32 rays a step', size: 0.45, size_space: 'world', paint: { fill: { role: 'ink' } } }, at: { pos: [-1, 2.2, 0] } },
  wall_label: { kind: 'mark.text@1', params: { text: 'wall, 1 m/s toward the turret', size: 0.45, size_space: 'world', paint: { fill: { role: 'ink' } } }, at: { pos: [11, 4.6, -3] } },
  turret: { kind: 'logic@1', params: { program: sha.turret, step_rate: 60, services: { 'physics.cast@1': { max_per_step: RAYS } },
    writes: { live: { type: 'bool', count: RAYS }, gen: { type: 'i32', count: RAYS }, pos: { type: 'vec3', count: RAYS },
      beam_pos: { type: 'vec3', count: RAYS }, beam_yaw: { type: 'f64', count: RAYS }, beam_scale: { type: 'vec3', count: RAYS } } } },
  hits: { kind: 'instance@1', params: { of: ['dot'], live: col('turret.live', 'bool'), gen: col('turret.gen', 'u32'), pos: col('turret.pos', 'f32') } },
  beams: { kind: 'instance@1', params: { of: ['beam'], live: col('turret.live', 'bool'), gen: col('turret.gen', 'u32'), pos: col('turret.beam_pos', 'f32'),
    yaw: col('turret.beam_yaw', 'f32'), scale: col('turret.beam_scale', 'f32') } },
}, {
  channels: { wall: { target: 'items/wall/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [WALL_X, 2, 0], interp: 'linear' }, k1: { t: `${SPAN}s`, value: [WALL_X - SPAN, 2, 0], interp: 'hold' } } } },
  worlds: { range: world({
    shapes: { slab: { kind: 'box', half: [0.5, 2, 3] }, post: { kind: 'box', half: [0.3, 1.5, 0.3] }, ball: { kind: 'sphere', radius: 0.4 }, ground: { kind: 'box', half: [15, 0.05, 12] } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'm' }], pose: { pos: [6, -0.05, 0] } },
      wall: { kind: 'kinematic', shapes: [{ shape: 'slab', contact_material: 'm' }], pose: { pos: [WALL_X, 2, 0] }, follow: 'items/wall/at/pos' },
      pillar_a: { kind: 'static', shapes: [{ shape: 'post', contact_material: 'm' }], pose: { pos: [4, 1.5, -2.5] } },
      pillar_b: { kind: 'static', shapes: [{ shape: 'post', contact_material: 'm' }], pose: { pos: [5, 1.5, 3] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [3, 6, 0.5] } },
    },
    outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } },
  }) },
});

const mirror = film('Mirror reads', 'Issue #213: copier mirrors crowd.pos, updated by the ranges crowd changed, and draws its copy 12 m to the right.', {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 17, 21], target: [0, 0, 0.5], fov: 45, near: 0.1, far: 200 } },
  sky: SKY,
  sun: SUN,
  teal: material([0.1, 0.7, 0.75]),
  left_label: { kind: 'mark.text@1', params: { text: 'crowd.pos (the writer)', size: 0.5, size_space: 'world', paint: { fill: { role: 'ink' } } }, at: { pos: [-6, 2, -6] } },
  right_label: { kind: 'mark.text@1', params: { text: "copier's mirror of it", size: 0.5, size_space: 'world', paint: { fill: { role: 'ink' } } }, at: { pos: [6, 2, -6] } },
  red: material([1, 0.25, 0.15]),
  point: { kind: 'mark.sphere@1', params: { size: [0.26, 0.26, 0.26] }, material: 'teal', visible: false },
  copy_point: { kind: 'mark.sphere@1', params: { size: [0.26, 0.26, 0.26] }, material: 'red', visible: false },
  crowd: { kind: 'logic@1', params: { program: sha.crowd, step_rate: 60, writes: { live: { type: 'bool', count: N }, gen: { type: 'i32', count: N }, pos: { type: 'vec3', count: N } } } },
  copier: { kind: 'logic@1', params: { program: sha.copier, step_rate: 60, mirrors: [{ array: 'crowd.pos', at: 'crowd_at' }],
    writes: { live: { type: 'bool', count: N }, gen: { type: 'i32', count: N }, copy: { type: 'vec3', count: N }, ranges: { type: 'i32' } } } },
  original: { kind: 'instance@1', params: { of: ['point'], live: col('crowd.live', 'bool'), gen: col('crowd.gen', 'u32'), pos: col('crowd.pos', 'f32') } },
  mirrored: { kind: 'instance@1', params: { of: ['copy_point'], live: col('copier.live', 'bool'), gen: col('copier.gen', 'u32'), pos: col('copier.copy', 'f32') } },
}, {});

// ---- Runs: present, export, and the logic call whose step records the checks read

const SESSION = { 'sess-213': { thread: 'thread-213', name: 'Claude Code: #213 film', process: { pid: 4100, start: 1000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 }];
function run(name, doc, docId) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(doc, null, 1));
  const out = codec === 'png_seq' ? join(dir, `${name}-frames`) : join(dir, `${name}.mov`);
  const calls = [{ call: 'deep_show', session: 'sess-213', doc: docId, document: doc, include: ['issues'] },
    { call: 'export', doc: docId, out, video: { codec: codec === 'png_seq' ? 'png_seq' : 'h264' } },
    { call: 'logic', doc: docId, steps: STEPS }];
  const scenario = { evidence: ev, sessions: SESSION, processes: PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [docId]: { panel: 'main' } }, calls };
  const r = spawnSync(bin, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const reply = JSON.parse((r.stdout ?? '').trim() || '{}');
  const rep = reply.replies ?? [];
  console.log(JSON.stringify({ film: name, ok: reply.ok, code: reply.code, what: reply.what, presented: rep[0]?.outcome, issues: (rep[0]?.issues ?? []).slice(0, 6),
    export: rep[1]?.outcome ?? rep[1], frames: rep[1]?.receipt?.frames }).slice(0, 3000));
  if (r.stderr) console.error(r.stderr.slice(-1500));
  return rep[2];
}

// ---- Checks

const checks = {};
const hs = run('hitscan', hitscan, '01JB213F1LM00000000000000A');
if (hs?.steps) {
  // A dot the turret reads at step k answers step k − 1's ray, against the state that step read: the world after
  // 2 (k − 1) steps of 120 Hz, where the wall's face is at 10 − 2 (k − 1) / 120 m.
  let wallHits = 0, worst = 0, onBall = 0, onPillars = 0;
  for (const s of hs.steps) {
    const k = s.step;
    const live = s.arrays['turret.live'];
    const pos = s.arrays['turret.pos'];
    const face = WALL_X - 0.5 - (2 * (k - 1)) / 120;
    live.forEach((on, i) => {
      if (!on) return;
      const [x, y, z] = pos[i];
      if (Math.abs(z) <= 3 && x > 5.6) { wallHits++; worst = Math.max(worst, Math.abs(x - face)); }
      else if (Math.hypot(x - 4, z + 2.5) < 0.5 || Math.hypot(x - 5, z - 3) < 0.5) onPillars++;
      else onBall++;
    });
  }
  const first = hs.steps.find((s) => s.arrays['turret.live'].some(Boolean));
  checks.hitscan = { steps: hs.steps.length, first_step_with_hits: first?.step, wall_hits: wallHits, wall_face_error_max_m: worst, pillar_hits: onPillars, other_hits: onBall,
    fuel_step_1: hs.steps[1]?.fuel?.turret, fuel_step_0: hs.steps[0]?.fuel?.turret, traps: hs.traps };
}
const mr = run('mirror', mirror, '01JB213F1LM00000000000000B');
if (mr?.steps) {
  // copier's copy at step k is crowd.pos as step k − 1 left it, 12 m along x; its list names the runs crowd changed.
  let mismatched = 0, compared = 0;
  const counts = [];
  for (let i = 1; i < mr.steps.length; i++) {
    const copy = mr.steps[i].arrays['copier.copy'];
    const before = mr.steps[i - 1].arrays['crowd.pos'];
    copy.forEach((c, j) => { compared++; if (c[0] - 12 !== before[j][0] || c[1] !== before[j][1] || c[2] !== before[j][2]) mismatched++; });
    counts.push(mr.steps[i].arrays['copier.ranges'][0]);
  }
  const hist = {};
  for (const c of counts) hist[c >>> 0] = (hist[c >>> 0] ?? 0) + 1;
  checks.mirror = { steps: mr.steps.length, elements_compared: compared, elements_differing: mismatched, list_counts: hist, traps: mr.traps };
}
writeFileSync(join(dir, 'checks.json'), `${JSON.stringify(checks, null, 1)}\n`);
console.log(JSON.stringify(checks, null, 1));
