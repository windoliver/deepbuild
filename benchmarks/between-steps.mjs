// #213's budgets, the `between-steps` mode of benchmarks/canvas.mjs (task `logic-between-steps`): between-step services
// and mirror reads on release builds. deep-show's `logic` call gives each step's `service_ns`, the CPU time physics.cast@1
// took answering a logic item's 256 rays in a level of 300 static boxes; deep-logic's bake gives each step's `mirror_ns`,
// the time the logic module took updating a mirror of a 1,000,000-element f64 array whose writer changed 1% in 64 runs;
// and an item with neither shows how many steps did such work at all. Programs are WebAssembly text, assembled by #544's
// assembler.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DOC = (n) => `01JB213B${String(n).padStart(18, '0')}`;
const SESSION = { s1: { thread: 'thread-213', name: 'bench', process: { pid: 4213, start: 1000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4213, ppid: 1, start: 1000 }];
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'The #213 budgets fixture.' };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

const RAYS = 256;
const REQUEST = 160;
const SERVICES_AT = 4096;
const RAYS_AT = 196_608;
const ELEMENTS = 1_000_000;
const MIRROR_AT = 65_536;
const head = (pages, writesAt) => `(memory (export "memory") ${pages} ${pages}) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const ${writesAt}))`;

/** 256 ray requests of physics.cast@1 from (0, 1, 0), evenly around the circle, 100 m, every group, in world 0. */
function rays() {
  const b = Buffer.alloc(RAYS * REQUEST);
  for (let i = 0; i < RAYS; i++) {
    const o = i * REQUEST;
    const t = (2 * Math.PI * i) / RAYS;
    b.writeUInt32LE(0xffffffff, o + 8);
    b.writeDoubleLE(100, o + 16);
    [0, 1, 0].forEach((v, j) => b.writeDoubleLE(v, o + 24 + 8 * j));
    [Math.cos(t), 0, Math.sin(t)].forEach((v, j) => b.writeDoubleLE(v, o + 48 + 8 * j));
  }
  return [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
}
// volley copies its rays into its request slots once and asks all 256 every step, writing the answers' count.
// bulk changes 10,000 of its 1,000,000 f64 a step, in 64 runs (16 of 157 and 48 of 156), each 15,625 apart.
// reader8 mirrors bulk.vals and writes its list's count. ticker asks nothing and mirrors nothing.
const PROGRAMS = {
  volley: `(module ${head(4, 1024)} (global (export "services_at") i32 (i32.const ${SERVICES_AT}))
    (data (i32.const ${RAYS_AT}) "${rays()}")
    (func (export "init") (param i64) (memory.copy (i32.const ${SERVICES_AT + 8}) (i32.const ${RAYS_AT}) (i32.const ${RAYS * REQUEST})))
    (func (export "step") (param $k i64)
      (i32.store (i32.const 1024) (i32.load (i32.const ${SERVICES_AT + 8 + RAYS * REQUEST})))
      (i32.store (i32.const ${SERVICES_AT}) (i32.const ${RAYS}))))`,
  bulk: `(module ${head(128, 1024)} (func (export "init") (param i64))
    (func (export "step") (param $k i64) (local $r i32) (local $i i32) (local $n i32) (local $v f64)
      (local.set $v (f64.convert_i64_s (i64.add (local.get $k) (i64.const 1))))
      (loop $runs
        (local.set $n (select (i32.const 157) (i32.const 156) (i32.lt_u (local.get $r) (i32.const 16))))
        (local.set $i (i32.const 0))
        (loop $each
          (f64.store (i32.add (i32.const 1024) (i32.shl (i32.add (i32.mul (local.get $r) (i32.const 15625)) (local.get $i)) (i32.const 3))) (local.get $v))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $each (i32.lt_u (local.get $i) (local.get $n))))
        (local.set $r (i32.add (local.get $r) (i32.const 1)))
        (br_if $runs (i32.lt_u (local.get $r) (i32.const 64))))))`,
  reader8: `(module ${head(128, 4096)} (global (export "vals_at") i32 (i32.const ${MIRROR_AT}))
    (func (export "init") (param i64)) (func (export "step") (param $k i64) (i32.store (i32.const 4096) (i32.load (i32.const 0)))))`,
  ticker: `(module ${head(1, 1024)} (func (export "init") (param i64))
    (func (export "step") (param $k i64) (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k)))))`,
};

function assemble(root, dir) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-213-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  const files = Object.entries(PROGRAMS).map(([name, text]) => { const f = join(dir, `${name}.wat`); writeFileSync(f, text); return f; });
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, ...files], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused a program: ${run.stderr}`);
  return Object.fromEntries(Object.keys(PROGRAMS).map((name) => { const bytes = readFileSync(join(dir, `${name}.wasm`)); return [name, { bytes, sha: sha256(bytes) }]; }));
}
function store(evidence, bytes) {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

/** The level: 296 pillars at seeded places within 20 m of the origin, at least 1.5 m from it, and 4 closing walls. */
function level() {
  let a = 213;
  const next = () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4_294_967_296; };
  const bodies = {};
  for (let i = 0; i < 296;) {
    const [x, z] = [-20 + 40 * next(), -20 + 40 * next()];
    if (Math.hypot(x, z) < 1.5) continue;
    bodies[`p${String(i++).padStart(3, '0')}`] = { kind: 'static', shapes: [{ shape: 'pillar', contact_material: 'stone' }], pose: { pos: [x, 1, z] } };
  }
  for (const [id, shape, pos] of [['w_n', 'ns', [0, 1, 22]], ['w_s', 'ns', [0, 1, -22]], ['w_e', 'ew', [22, 1, 0]], ['w_w', 'ew', [-22, 1, 0]]]) {
    bodies[id] = { kind: 'static', shapes: [{ shape, contact_material: 'stone' }], pose: { pos } };
  }
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 213, mode: 'dynamic',
    capacity: { bodies: 320, shapes: 320, joints: 0, contacts: 64, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { stone: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { pillar: { kind: 'box', half: [0.2, 1, 0.2] }, ns: { kind: 'box', half: [23, 2, 0.5] }, ew: { kind: 'box', half: [0.5, 2, 23] } },
    bodies,
  };
}
/** A scene of one logic item stepping at 60 Hz beside `worlds`. */
function scene(evidence, id, program, params, worlds) {
  const sha = store(evidence, program.bytes);
  return {
    format: 1, profile: 'scene', title: 'Between-step bench', description: 'The #213 budgets fixture.', size: [640, 360], camera: 'cam', seed: 213,
    transport: { span: '2s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1', logic: '^1' } }, ...(worlds ? { worlds } : {}),
    items: {
      cam: { id: 'cam', name: 'cam', order: 'a000', kind: 'camera@1', params: { projection: 'perspective', position: [0, 30, 30], target: [0, 0, 0], fov: 40 } },
      [id]: { id, name: id, order: 'a001', kind: 'logic@1', params: { program: sha, step_rate: 60, ...params } },
    },
    assets: { [`${id}_program`]: { sha256: sha, license: LICENSE } },
  };
}
/** Each step's reading `field` of item `id` in a `logic` call of `steps` steps on `document`. */
function logicRun(once, evidence, document, id, steps, field) {
  const doc = DOC(1);
  const calls = [{ call: 'deep_show', session: 's1', doc, document, include: ['issues'] }, { call: 'logic', doc, steps }];
  const answer = once('deep-show', ['run'], { evidence, sessions: SESSION, processes: PROCESSES, panels: { p1: { rect: [0, 0, 640, 360] } }, docs: { [doc]: { panel: 'p1' } }, calls });
  const ran = answer.replies?.[1];
  if (!Array.isArray(ran?.steps)) throw Error(`the logic call didn't run: ${JSON.stringify(answer).slice(0, 2000)}`);
  return ran.steps.map((s) => field.map((f) => s[f]?.[id]));
}

function measure(dir, programs, once) {
  const evidence = mkdtempSync(join(dir, 'evidence-'));
  const volley = scene(evidence, 'volley', programs.volley,
    { services: { 'physics.cast@1': { max_per_step: RAYS } }, writes: { answered: { type: 'i32' } }, budget: { fuel: 2_000_000 } }, { level: level() });
  const cast = logicRun(once, evidence, volley, 'volley', 60, ['service_ns']).slice(0, 59).map(([ns]) => ns);
  if (cast.some((ns) => !(ns > 0))) throw Error(`volley's steps read no service time: ${JSON.stringify(cast)}`);
  const piece = (seed) => ({
    seed, assets: { [programs.bulk.sha]: programs.bulk.bytes.toString('base64'), [programs.reader8.sha]: programs.reader8.bytes.toString('base64') },
    items: {
      bulk: { kind: 'logic@1', params: { program: programs.bulk.sha, writes: { vals: { type: 'f64', count: ELEMENTS } }, budget: { memory: 8 } } },
      reader8: { kind: 'logic@1', params: { program: programs.reader8.sha, writes: { ranges: { type: 'i32' } }, mirrors: [{ array: 'bulk.vals', at: 'vals_at' }], budget: { memory: 8 } } },
    },
  });
  const baked = once('deep-logic', [], { call: 'bake', piece: piece(213), steps: 64, track: [], arrays: ['reader8.ranges'] });
  if (baked.ok !== true) throw Error(`the bulk mirror didn't bake: ${JSON.stringify(baked).slice(0, 2000)}`);
  const mirror = baked.steps.slice(1).map((s) => s.items.reader8.mirror_ns);
  const idle = logicRun(once, evidence, scene(evidence, 'ticker', programs.ticker, { writes: { n: { type: 'i32' } } }), 'ticker', 30, ['service_ns', 'mirror_ns']);
  return {
    cast_256_ms: median(cast) / 1e6,
    mirror_1pct_ms: median(mirror) / 1e6,
    idle_work: idle.filter(([s, m]) => s !== 0 || m !== 0).length,
  };
}

/** The `between-steps` workload: release builds, a warm-up run and five, printed as the task's reading. */
export function betweenSteps({ root, release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  release('deep-logic', 'deep-logic');
  const dir = mkdtempSync(join(tmpdir(), 'deep-between-steps-bench-'));
  try {
    const programs = assemble(root, dir);
    const measured = runs(() => measure(dir, programs, once));
    console.log(JSON.stringify({ task: 'logic-between-steps', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
