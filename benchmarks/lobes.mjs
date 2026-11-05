// The perf lane's workload for issue #428: node benchmarks/lobes.mjs. One `deep-gpu run` draws the castle
// (packs/examples/castle.json, its 64 lamps cut to 32) orbiting for 120 frames at internal scale 0.5 with timings, and
// a 12-part product fixture at 1920 × 1080 with sheen, anisotropy and translucency on every part and without them,
// printing each one's p95 or median GPU frame time. The issue's limits (the castle under 10 ms a frame on the reference
// Mac's display, the lobes under 1 ms added at 1080p) stay in tests/acceptance/428/budgets.test.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const binary = join(root, 'target', 'debug', 'deep-gpu');
if (!existsSync(binary)) {
  const built = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) throw Error('cargo build --bin deep-gpu failed');
}
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const look = JSON.parse(readFileSync(join(root, 'packs/examples/castle.look.json'), 'utf8'));

function product(lobes) {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.2, 0], orbit: { azimuth: 0, elevation: 15, distance: 1.2 }, fov: 35, near: 0.05, far: 50 } },
    sun: { kind: 'light.sun@1', params: { illuminance: 30000 }, at: { rot: [-45, 30, 0] } },
  };
  for (let k = 0; k < 12; k++) {
    const params = { base_color: [0.2 + 0.05 * k, 0.3, 0.5 - 0.03 * k, 1], metallic: k % 3 === 0 ? 1 : 0, roughness: 0.35 + 0.04 * k };
    if (lobes) Object.assign(params, { sheen: { weight: 1, roughness: 0.5 }, anisotropy: { strength: 0.8, rotation: 15 * k }, translucency: { kind: 'thin', amount: 0.4 } });
    items[`m${k}`] = { kind: 'material@1', params };
    items[`p${k}`] = { kind: 'ball@1', params: { radius: 0.06, segments: 64, uv0: 'sphere' }, at: { pos: [-0.3 + 0.055 * k, 0.2, 0] }, material: `m${k}` };
  }
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${id}` });
  return {
    format: 1, profile: 'scene', title: 'Product', description: 'Twelve parts, each its own material.', size: [1920, 1080], camera: 'cam', items,
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 360, interp: 'linear' } } } },
  };
}

const out = mkdtempSync(join(tmpdir(), 'deep-lobes-bench-'));
try {
  const docs = [true, false].map((lobes) => { const p = join(out, `product-${lobes}.json`); writeFileSync(p, JSON.stringify(product(lobes))); return p; });
  const castle = JSON.parse(readFileSync(join(root, 'packs/examples/castle.json'), 'utf8'));
  const calls = [
    { call: 'view3d', doc: join(root, 'packs/examples/castle.json'), look, size: castle.size, packs: [join(root, 'packs', 'composites-1.0.0')], frames: 120, fps: 30, timings: true, surface: { internal_scale: 0.5 } },
    ...docs.map((doc) => ({ call: 'view3d', doc, look, size: [1920, 1080], frames: 120, fps: 60, timings: true })),
  ];
  const run = spawnSync(binary, ['run'], { input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0) throw Error(`deep-gpu run exited ${run.status}: ${run.stderr.slice(-2000)}`);
  const replies = JSON.parse(run.stdout.trim().split('\n').at(-1)).replies;
  const gpu = (r, what) => {
    if (!r?.frames || r.code) throw Error(`${what}: ${JSON.stringify(r).slice(0, 1500)}`);
    return r.frames.map((f) => f.gpu_ms).filter((ms) => Number.isFinite(ms));
  };
  const castleMs = gpu(replies[0], 'the castle');
  const [withLobes, without] = [gpu(replies[1], 'with the lobes'), gpu(replies[2], 'without them')];
  console.log(JSON.stringify({ castle_p95_ms: quantile(castleMs, 0.95), lobes_added_ms: quantile(withLobes, 0.5) - quantile(without, 0.5) }));
} finally {
  rmSync(out, { recursive: true, force: true });
}
