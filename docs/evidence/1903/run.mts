// #1903's run on this Mac's own GPU: the combined envelope of the every-pass scene this build can
// draw, `separate-items` and its instanced twin, with the first frame wait, five 60 s runs each,
// no stub. Run from the checkout root:
//
//   cargo build --locked --release --bin deep-gpu
//   node docs/evidence/1903/run.mts target/release/deep-gpu
//
// It writes `envelope.json` (the reply) beside this file, and keeps the store in a temporary
// folder, so its ask is this run's.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instancedTwinDoc, separateItemsDoc } from '../../../tests/acceptance/1903/helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] ?? 'target/release/deep-gpu';
const dir = mkdtempSync(join(tmpdir(), 'deep-1903-evidence-'));
const FULL_SCREEN = [3456, 2234];

// Every pass the build has, on at once: the sky, a sun and a lamp casting shadows (cascades and a
// local map), a mirror floor, a patterned material, a crowd past the GPU cull's line, the lens
// flare, the history window and the upscale the class's fit gives a moving camera.
const items: Record<string, Record<string, unknown>> = {
  cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.8, 0], orbit: { azimuth: 30, elevation: 20, distance: 14 }, fov: 45, near: 0.1, far: 500 } },
  sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
  sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-45, 30, 0] } },
  lamp: { kind: 'light.point@1', params: { power: 40, radius: 0.05, color: [1, 0.9, 0.8], shadow: true }, at: { pos: [0.8, 2.6, -1] } },
  floor_mat: { kind: 'material@1', params: { base_color: [0.05, 0.05, 0.06, 1], metallic: 0, roughness: 0.2, mirror: { strength: 1, blur: 0, plane: 'floor' } } },
  box_mat: { kind: 'material@1', params: { base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6, pattern: 'wood' } },
  floor: { kind: 'plate@1', params: { grid: [1, 1], size: [40, 40] }, at: { pos: [0, 0, 0] }, material: 'floor_mat' },
  proto: { kind: 'mark.box@1', params: { size: [0.3, 0.3, 0.3] }, at: { pos: [0, 0, 0] }, material: 'box_mat', visible: false },
  crowd: {
    kind: 'instance@1',
    params: { of: ['proto'], ids: Array.from({ length: 400 }, (_, i) => i), pos: Array.from({ length: 400 }, (_, i) => [((i % 20) - 9.5) * 0.9, 0.15, (Math.floor(i / 20) - 9.5) * 0.9]) },
    at: { pos: [0, 0, 0] },
  },
  flare: { kind: 'effect@1', params: { kind: 'flare', flare: { from: 'lights', ghosts: 8, halo: 0.05, streak: { count: 6, length: 0.25, anamorphic: false }, starburst: { blades: 6 }, intensity: 1 } } },
};
for (let k = 0; k < 12; k++) {
  items[`box${k}`] = { kind: 'mark.box@1', params: { size: [0.7, 0.7 + 0.15 * (k % 4), 0.7] }, at: { pos: [3 * Math.cos((k * Math.PI) / 6), 0.35 + 0.075 * (k % 4), 3 * Math.sin((k * Math.PI) / 6)] }, material: 'box_mat' };
}
Object.entries(items).forEach(([id, item], k) => Object.assign(item, { id, name: id, order: `a${String(k).padStart(3, '0')}` }));
const scene = {
  format: 1, profile: 'scene', title: 'The envelope scene', description: 'Every pass this build has on at once.',
  size: FULL_SCREEN, camera: 'cam', seed: 1903, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, transport: { span: '60s' }, items,
  channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '60s', value: 390, interp: 'linear' } } } },
};

const write = (name: string, doc: unknown): string => {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
};
const look = JSON.parse(readFileSync(join(here, '..', '..', '..', 'tests', 'acceptance', '1903', 'fixtures', 'look.json'), 'utf8'));
const call = {
  call: 'envelope', look, writer: 'agent:alpha', store: join(dir, 'store'), scene: write('every-pass', scene),
  separate_items: { doc: write('separate-items', separateItemsDoc()), instanced: write('separate-items-instanced', instancedTwinDoc()) },
  render: { seconds: 60, pixels: FULL_SCREEN }, first_frame_wait: true,
};
const run = spawnSync(bin, ['run'], { input: `${JSON.stringify({ out: dir, calls: [call] })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
if (run.status !== 0) throw Error(`${bin} exited ${run.status}: ${run.stderr.slice(-2000)}`);
const reply = JSON.parse(run.stdout.split('\n')[0]!).replies[0];
writeFileSync(join(here, 'envelope.json'), `${JSON.stringify({ made: new Date().toISOString(), scene, reply }, null, 2)}\n`);
console.log(JSON.stringify({ verdict: reply.verdict, fixtures: reply.fixtures.map((f: { fixture: string; verdict: string }) => [f.fixture, f.verdict]) }));
