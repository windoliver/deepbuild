// #3033's budget, the `water-sea` mode of benchmarks/canvas.mjs (task `canvas-water-sea`): what a sea adds over the
// same plate with `waves: wind`. A release deep-gpu draws a 1 km × 1 km plate of 256 × 256 cells seen by a level
// camera 12 m up and 60 m in from its near edge, so the water fills the lower half of a 1080p frame, once as a sea from
// a 10 m/s wind and once with that wind's four waves, 300 frames a side at 30 fps; a run's reading is the difference of
// the sides' median `gpu_ms`. One warm-up run and five, each a fresh process. The stage is
// tests/acceptance/3033/budgets.test.ts's.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = [1920, 1080];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function stage(name, waves) {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 12, 440], target: [0, 12, -500], fov: 60, near: 0.1, far: 5000 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-35, 30, 0] } },
    'sea-water': { kind: 'material@1', params: { roughness: 0.05, water: { waves } } },
    sea: { kind: 'plate@1', params: { grid: [256, 256], size: [1000, 1000] }, at: { pos: [0, 0, 0] }, material: 'sea-water' },
  };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: `half-frame-${name}`, profile: 'scene', title: 'Sea', size: SIZE, camera: 'cam', seed: 3033, transport: { span: '30s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items };
}

export function waterSea({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-3033', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const side = (name, waves) => {
      const doc = join(dir, `${name}.json`);
      writeFileSync(doc, JSON.stringify(stage(name, waves)));
      return { call: 'view3d', doc, look, size: SIZE, frames: 300, fps: 30, timings: true };
    };
    const calls = [side('sea', { sea: { wind: 10, direction: 90, spread: 30, seed: 3033 } }), side('four-waves', { wind: { speed: 10, direction: 90 } })];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [sea, four] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { sea_gpu_ms: Math.max(0, sea - four), four_waves_gpu_ms: four };
    });
    console.log(JSON.stringify({ task: 'canvas-water-sea', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
