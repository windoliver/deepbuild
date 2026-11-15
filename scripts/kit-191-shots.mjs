// Issue #191's pictures (docs/evidence/191/README.md): each behavior-kit fixture's world drawn by the canvas at the
// steps its measure reads, from `deep-physics`'s own bake of the interface's fixture world, so a reviewer sees what the
// kit measured. Every body is a scene3d mark posed from the bake (a strobe: earlier steps in `muted`, the measured
// step in `sand`, static bodies in `stone`), drawn once by `deep-gpu`'s view3d. Nothing here judges: the kit's report
// holds the numbers; these show the worlds.
//   node scripts/kit-191-shots.mjs <out dir>   (builds nothing: target/debug/deep-physics and deep-gpu must exist)
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'docs', 'evidence', '191');
const bin = (name) => join(process.env.CARGO_TARGET_DIR ?? join(root, 'target'), 'debug', name);
const HZ = 120;

function lines(file, args, calls) {
  const r = spawnSync(file, args, { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`${file} ${args.join(' ')} exited ${r.status}: ${r.stderr.slice(-2000)}`);
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}
const physics = (calls, planted) => lines(bin('deep-physics'), planted ? ['--planted', planted] : [], calls);

/** The canvas's rotation from a body's quaternion: degrees about X, then Y, then Z (as the physics pose output writes). */
function euler([x, y, z, w]) {
  const deg = (r) => (r * 180) / Math.PI;
  return [deg(Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))), deg(Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))))),
    deg(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))];
}

/** The mark that draws one shape use, sized in metres, or none for a shape this picture leaves out. */
function mark(shape) {
  if (shape.kind === 'sphere') return { kind: 'mark.sphere@1', params: { size: [2 * shape.radius, 2 * shape.radius, 2 * shape.radius] } };
  if (shape.kind === 'box') return { kind: 'mark.box@1', params: { size: shape.half.map((h) => 2 * h) } };
  if (shape.kind === 'capsule') return { kind: 'mark.box@1', params: { size: [2 * shape.radius, 2 * (shape.half_height + shape.radius), 2 * shape.radius] } };
  return null;
}

/** A box's twelve edges as thin bars, so what a sensor holds shows through it. */
function wire(half, pos, rot) {
  const t = 0.01;
  const out = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const size = [t, t, t];
      size[axis] = 2 * half[axis];
      const off = [0, 0, 0];
      off[(axis + 1) % 3] = u * half[(axis + 1) % 3];
      off[(axis + 2) % 3] = v * half[(axis + 2) % 3];
      out.push({ size, pos: [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]], rot });
    }
  }
  return out;
}

/** The steps to draw a body at: each of `steps` where it moved since the last one drawn, its last pose at the last. */
function moved(series, steps) {
  const at = (k) => series[Math.min(k, series.length - 1)].pos;
  const kept = [];
  for (const k of steps) {
    const prev = kept.at(-1);
    if (prev !== undefined && at(prev).every((x, i) => Math.abs(x - at(k)[i]) < 1e-4)) kept[kept.length - 1] = k;
    else kept.push(k);
  }
  return kept;
}

/**
 * The scene of `world` at `steps` of its bake (each body's states after each step), seen from `view`: each dynamic or
 * kinematic body once a step it moved, the last in sand; each static body once, in stone; a sensor as a wire box.
 */
function scene(id, world, states, steps, view) {
  const items = {};
  let order = 0;
  const add = (key, item) => { items[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item }; };
  add('cam', { kind: 'camera@1', params: { projection: 'perspective', position: view.from, target: view.at, fov: view.fov ?? 45, near: 0.05, far: 200 } });
  add('sky', { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } });
  add('sun', { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-40, 30, 0] } });
  for (const [bodyId, body] of Object.entries(world.bodies)) {
    const series = states[bodyId];
    const moving = body.kind !== 'static';
    const shown = moving ? moved(series, steps) : [steps.at(-1)];
    shown.forEach((k, n) => {
      const s = series[Math.min(k, series.length - 1)];
      body.shapes.forEach((use, i) => {
        const shape = world.shapes[use.shape];
        const role = use.sensor ? 'ink' : !moving ? 'stone' : n === shown.length - 1 ? 'sand' : 'muted';
        if (use.sensor && shape.kind === 'box') {
          wire(shape.half, s.pos, euler(s.rot)).forEach((e, j) =>
            add(`${bodyId}-${i}-${k}-edge${j}`, { kind: 'mark.box@1', params: { size: e.size, paint: { fill: { role } } }, at: { pos: e.pos, rot: e.rot } }));
          return;
        }
        const m = mark(shape);
        if (!m) return;
        add(`${bodyId}-${i}-${k}`, { ...m, params: { ...m.params, paint: { fill: { role } } }, at: { pos: s.pos, rot: euler(s.rot) } });
      });
    });
  }
  return {
    format: 1, id, profile: 'scene', title: id, description: 'A behavior kit fixture world as its bake left it.', size: [640, 360], camera: 'cam',
    transport: { span: '1s' }, requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:kit-shots', title: 'main', order: 'a0' } }, items,
  };
}

// The look the canvas's physics evidence draws with (#484's acceptance look: physical, tone map none, exposure for scale 1).
const LOOK = {
  id: 'look-191-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A behavior kit evidence look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
  fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

const range = (a, b, d) => Array.from({ length: Math.floor((b - a) / d) + 1 }, (_, i) => a + i * d);
/** Each picture: a fixture of the kit (or a planted run of one), the steps it strobes, its view, and its caption. */
const SHOTS = [
  { fixture: 'free_fall', steps: [0, 60, 120], view: { from: [6, 6, 14], at: [0, 7.5, 0] }, caption: 'Free fall: the ball at 0, 0.5 and 1 s; the kit reads its drop at 1 s.' },
  { fixture: 'projectile_range', steps: range(0, 180, 12), view: { from: [5.2, 2.2, 15], at: [5.2, 1.4, 0] }, caption: 'Projectile: every 0.1 s of its arc; the kit reads where it returns to launch height.' },
  { fixture: 'pendulum_period', steps: range(0, 240, 12), view: { from: [0, 1.2, 3.2], at: [0, 1.1, 0] }, caption: 'Pendulum: the bob every 0.1 s over 2 s, one period swung out and back.' },
  { fixture: 'bounce_max', steps: range(40, 150, 6), view: { from: [0, 0.7, 3.5], at: [0, 0.6, 0] }, caption: 'Bounce under max: the fall, the contact and the first bounce; the kit reads its height.' },
  { fixture: 'bounce_multiply', steps: range(40, 150, 6), view: { from: [0, 0.7, 3.5], at: [0, 0.6, 0] }, caption: 'Bounce under multiply: the same drop, the lowest first bounce.' },
  { fixture: 'slide_geometric', steps: [0, 20, 40, 60, 80, 180], view: { from: [-13.4, 2.5, 6], at: [-13.4, 0.2, 0] }, caption: 'Slide under geometric: the box every 1/6 s for 2/3 s from 5 m/s, then at rest (1.5 s).' },
  { fixture: 'slide_min', steps: [0, 40, 80, 120, 160, 200, 360], view: { from: [-12, 3.5, 9], at: [-12, 0.2, 0] }, caption: 'Slide under min: the lowest friction, the longest slide, every 1/3 s and then at rest (3 s).' },
  { fixture: 'slope_hold', steps: [0, 120, 240], view: { from: [0, 0.8, 3.5], at: [0, 0, 0] }, caption: 'Slope at friction 0.6: the box at 0, 1 and 2 s, held in place.' },
  { fixture: 'slope_slide', steps: [0, 120, 240], view: { from: [0.6, 0.4, 4], at: [0.6, -0.4, 0] }, caption: 'Slope at friction 0.5: the box at 0, 1 and 2 s, sliding down.' },
  { fixture: 'hinge_limit', steps: [0, 10, 20, 30, 60, 240], view: { from: [0.5, 1.6, 3.2], at: [0.5, 1.7, 0] }, caption: 'Hinge limited to 30°: the bar falls and stops at its limit.' },
  { fixture: 'slider_limit', steps: [0, 10, 20, 40, 240], view: { from: [1.5, 1.8, 2.5], at: [0, 1.75, 0] }, caption: 'Slider limited to 0.5 m: the car slides down and stops at its limit.' },
  { fixture: 'hinge_motor', steps: range(0, 60, 10), view: { from: [0, 4, 1.2], at: [0, 2, 0], fov: 50 }, caption: 'Hinge motor at 90°/s, seen from above: the bar every 1/12 s for 0.5 s.' },
  { fixture: 'sensor_entry', steps: [0, 30, 39, 50, 55], view: { from: [0, 0.6, 4], at: [0, 0.5, 0] }, caption: 'The dropped ball: entering the sensor slab (step 39) and first touching the floor (step 55).' },
  { fixture: 'sleep', steps: [0, 20, 42, 104], view: { from: [0, 1, 3.5], at: [0, 0.4, 0] }, caption: 'Sleep: the box settles; the kit reads the steps from slowing to rest.' },
  { fixture: 'ccd_wall', steps: [6, 7, 12, 24], view: { from: [10, 0.9, 4], at: [10, 0.9, 0], fov: 12 }, caption: 'Fast ball with ccd, side on, the wall edge on: steps 6 to 24, held on the wall\'s near side.' },
  { fixture: 'ccd_wall', planted: 'swept_collision_off', steps: [6, 7, 8, 12, 24], view: { from: [10, 0.9, 4], at: [10, 0.9, 0], fov: 12 }, caption: 'Planted wrapper, swept collision off, the same view: the ball works through and ends past the far face.' },
  { fixture: 'sensor/static/dynamic', steps: [0, 75, 120, 165], view: { from: [0, 2.5, 5], at: [0, 1, 0] }, caption: 'Static sensor crossed by a dynamic ball: at 0, the enter step 75, 120 and the exit step 165.' },
  { fixture: 'sensor/static/inside', steps: [1, 240], view: { from: [0, 2.5, 4], at: [0, 1, 0] }, caption: 'A ball inside the static sensor from the start, deactivated at step 240.' },
  { fixture: 'queries', steps: [1], view: { from: [7, 6, 22], at: [0, 1, 10], fov: 40 }, caption: 'The query world: spheres, boxes and a capsule in three groups, two spheres sharing a place.' },
];

const fixtures = new Map(physics([{ call: 'behavior_fixtures' }])[0].fixtures.map((f) => [f.name, f]));
const tmp = mkdtempSync(join(tmpdir(), 'kit-191-shots-'));
mkdirSync(out, { recursive: true });
try {
  const docs = SHOTS.map((s, n) => {
    const f = fixtures.get(s.fixture);
    if (!f) throw Error(`no fixture ${s.fixture}`);
    const last = Math.max(...s.steps);
    const track = s.fixture.endsWith('/inside') ? [{ step: 239, kind: 'deactivate', target: 'mover' }] : undefined;
    const [baked] = physics([{ call: 'bake', world: f.world, steps: Math.max(last, 1), ...(track ? { track } : {}) }], s.planted);
    if (!baked.ok) throw Error(`${s.fixture}: ${JSON.stringify(baked).slice(0, 600)}`);
    const name = `${s.fixture.replaceAll('/', '-')}${s.planted ? `-${s.planted}` : ''}`;
    const path = join(tmp, `${n}.json`);
    writeFileSync(path, JSON.stringify(scene(name.replaceAll('_', '-'), f.world, baked.bodies, s.steps, s.view)));
    return { ...s, name, path };
  });
  const [answer] = lines(bin('deep-gpu'), ['run'], [{ out: tmp, calls: docs.map((d) => ({ call: 'view3d', look: LOOK, doc: d.path, size: [640, 360], fps: 60, from: 0, frames: 1, capture: [0], targets: ['final'] })) }]);
  if (!answer.ok) throw Error(`deep-gpu run: ${JSON.stringify(answer).slice(0, 1500)}`);
  const rows = docs.map((d, i) => {
    const reply = answer.replies[i];
    const hash = reply.frames?.[0]?.final;
    if (typeof hash !== 'string') throw Error(`${d.name}: ${JSON.stringify(reply).slice(0, 800)}`);
    const file = `${d.name}-${hash.slice(0, 12)}.png`;
    copyFileSync(join(tmp, `${hash}.png`), join(out, file));
    return { file, caption: d.caption, sha256: hash };
  });
  console.log(JSON.stringify(rows, null, 1));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
