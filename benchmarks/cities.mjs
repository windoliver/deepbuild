// The cities' budgets on a release `deep-gpu`, the `occlusion` (#1637) and `many-lamps` (#1634) modes of
// benchmarks/canvas.mjs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p95 } from './canvas-judge.mjs';
import { FLARE_SIZE } from './stages.mjs';

// #1637: occlusion from this frame's depth, at 1920 × 1080 on a release `deep-gpu`. The city of
// tests/acceptance/1637/helpers.ts (20,000 building items on a 200 × 100 grid of 32 m blocks, 100,000 street items in
// one instancer, the same seeds), walked 1.7 m above the street for 10 s at 30 frames a second, drawn twice a run, the
// shipped occlusion cull and `occlusion: off` (frustum only), their order alternating; one warm-up run and five, each a
// fresh process. A run reports p95 GPU time shipped ÷ frustum-only, and the depth pyramid's declared cost against its
// measured time, both medians over the shipped frames.
function occlusionCity() {
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; }; };
  const PITCH = 32, x0 = 40 * PITCH + 16, z = 50 * PITCH + 1, cutX = x0, cutZ = 60 * PITCH + 1;
  const clear = [[x0 - 10, x0 + 60, 50 * PITCH - 6, 50 * PITCH + 6], [cutX - 10, cutX + 60, 60 * PITCH - 6, 60 * PITCH + 6]];
  const r = rng(1637); const u = () => r() / 4294967296; const round = (v) => Math.round(v * 1000) / 1000;
  const rows = [];
  while (rows.length < 100_000) {
    const alongX = u() < 0.5;
    const line = alongX ? Math.floor(u() * 101) * PITCH : Math.floor(u() * 201) * PITCH;
    const along = alongX ? u() * 200 * PITCH : u() * 100 * PITCH;
    const off = (u() < 0.5 ? -1 : 1) * (3.5 + 2 * u());
    const k = u();
    const proto = k < 0.35 ? 0 : k < 0.6 ? 1 : k < 0.8 ? 2 : 3;
    const x = round(alongX ? along : line + off); const zz = round(alongX ? line + off : along);
    const sc = round(0.9 + 0.2 * u());
    if (clear.some(([a, b, c, d]) => x >= a && x <= b && zz >= c && zz <= d)) continue;
    rows.push({ proto, pos: [x, proto === 2 ? round(0.225 * sc) : 0, zz], yaw: alongX ? 0 : 90, scale: sc });
  }
  rows[31_416] = { proto: 3, pos: [x0 + 6, 0, z + 1.2], yaw: 0, scale: 1 };
  rows[31_415] = { proto: 2, pos: [x0 + 10, 0.225, z + 2], yaw: 90, scale: 1 };
  rows[77_777] = { proto: 0, pos: [cutX + 25, 0, cutZ + 3.5], yaw: 0, scale: 1 };
  const box = (size, pos, material, extra = {}) => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...extra });
  const mat = (params) => ({ kind: 'material@1', params });
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [x0, 1.7, z], target: [x0 + 100, 1.7, z], fov: 60, near: 0.1, far: 3000 } },
    sky: { kind: 'sky@1', params: { top: [0.35, 0.5, 0.75, 1], low: [0.75, 0.82, 0.9, 1], ambient_top: [0.25, 0.3, 0.35], ambient_low: [0.1, 0.1, 0.1] } },
    key: { kind: 'light.sun@1', at: { rot: [-20, 90, 0] }, params: { illuminance: Math.PI, color: [1, 1, 1], shadow: false } },
    ground_mat: mat({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.95 }),
    wall0: mat({ base_color: [0.62, 0.55, 0.48, 1], roughness: 0.9 }), wall1: mat({ base_color: [0.5, 0.52, 0.56, 1], roughness: 0.9 }), wall2: mat({ base_color: [0.7, 0.66, 0.6, 1], roughness: 0.9 }),
    lamp_mat: mat({ base_color: [0.2, 0.2, 0.22, 1], metallic: 1, roughness: 0.4 }), tree_mat: mat({ base_color: [0.12, 0.35, 0.12, 1], roughness: 0.85 }),
    bench_mat: mat({ base_color: [0.45, 0.3, 0.15, 1], roughness: 0.8 }), bin_mat: mat({ base_color: [0.1, 0.25, 0.15, 1], roughness: 0.6 }),
    kiosk_mat: mat({ base_color: [0.6, 0.15, 0.1, 1], roughness: 0.7 }), statue_mat: mat({ base_color: [0.8, 0.8, 0.78, 1], roughness: 0.5 }),
    ground: box([6420, 1, 3220], [3200, -0.5, 1600], 'ground_mat'),
    lamp: { kind: 'lathe@1', params: { outline: [[0.08, 0, false], [0.08, 3.8, false], [0.35, 3.9, true], [0.3, 4.1, true], [0.05, 4.2, false]], segments: 48 }, material: 'lamp_mat', visible: false },
    tree: { kind: 'lathe@1', params: { outline: [[0.15, 0, false], [0.15, 2, false], [1.2, 2.5, true], [1.5, 3.5, true], [1, 4.8, true], [0.05, 5.5, false]], segments: 64 }, material: 'tree_mat', visible: false },
    bench: box([1.8, 0.45, 0.5], [0, 0, 0], 'bench_mat', { visible: false }),
    bin: { kind: 'lathe@1', params: { outline: [[0.22, 0, false], [0.25, 0.95, false], [0.27, 1, false], [0.05, 1.02, false]], segments: 32 }, material: 'bin_mat', visible: false },
    street: { kind: 'instance@1', params: { of: ['lamp', 'tree', 'bench', 'bin'], ids: rows.map((_, i) => i), proto: rows.map((x) => x.proto), pos: rows.map((x) => x.pos), yaw: rows.map((x) => x.yaw), scale: rows.map((x) => x.scale) } },
    kiosk: box([0.5, 2.5, 1.6], [x0 + 8, 1.25, z - 3], 'kiosk_mat'),
    probe: { kind: 'light.probe@1', params: { type: 'reflection', size: [4, 3, 4] }, at: { pos: [x0 + 12, 1.5, z - 1] } },
    statue: box([0.6, 2.4, 0.6], [x0 + 12, 1.2, z - 4.5], 'statue_mat'),
  };
  const b = rng(1638);
  for (let j = 0; j < 100; j++) for (let i = 0; i < 200; i++) {
    const h = Math.round(100 + 200 * (b() / 4294967296)) / 10; const k = j * 200 + i;
    items[`b${String(k).padStart(5, '0')}`] = box([20, h, 20], [i * PITCH + 16, h / 2, j * PITCH + 16], `wall${k % 3}`);
  }
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(6, '0')}`, layer: 'main' });
  const at = (axis, x) => ({ target: `items/cam/params/${axis}/0`, type: 'f32', keys: { k0: { t: '0s', value: x, interp: 'linear' }, k1: { t: '10s', value: x + 14, interp: 'linear' } } });
  return { format: 1, id: 'city-1637-bench', profile: 'scene', title: 'city-1637-bench', description: 'The #1637 city walk.', size: FLARE_SIZE, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items, channels: { cam_x: at('position', x0), aim_x: at('target', x0 + 100) } };
}
export function occlusion({ release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look = { id: 'look-1637-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1637 bench look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' }, roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} }, fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false }, mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto' };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = join(dir, 'city.json');
    writeFileSync(doc, JSON.stringify(occlusionCity()));
    const side = (off) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 301, fps: 30, capture: [], timings: true, ...(off ? { occlusion: 'off' } : {}) });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)];
    let k = 0;
    const measured = runs(() => {
      const offFirst = k++ % 2 === 1;
      const answer = once('deep-gpu', ['run'], { out: dir, calls: offFirst ? [side(true), side(false)] : [side(false), side(true)] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [on, off] = offFirst ? [answer.replies[1], answer.replies[0]] : [answer.replies[0], answer.replies[1]];
      const measuredMs = median(on.frames.map((f) => f.passes_ms['scene3d.depth_pyramid']));
      const declaredMs = median(on.frames.map((f) => f.declared_ms['scene3d.depth_pyramid']));
      return { shipped_p95_ms: p95(on.frames.map((f) => f.gpu_ms)), frustum_p95_ms: p95(off.frames.map((f) => f.gpu_ms)),
        gpu_fall: p95(on.frames.map((f) => f.gpu_ms)) / p95(off.frames.map((f) => f.gpu_ms)),
        pyramid_measured_ms: measuredMs, pyramid_declared_ms: declaredMs, pyramid_declared_error: Math.abs(declaredMs - measuredMs) / measuredMs };
    });
    console.log(JSON.stringify({ task: 'canvas-occlusion', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #1634: many lamps in raster light, at 1920 × 1080 on a release `deep-gpu`. The night city of
// tests/acceptance/1634/helpers.ts (2,048 lamp posts on a 64 × 32 lattice 12 m apart, a fill point lamp or a fill spot
// lamp on each by turns, ranges 6 to 12 m, over a ground slab and 128 blocks; a showpiece whose camera orbits it once
// in 10 s), its 300 frames played with timings; one warm-up run and five, each a fresh process. A run reports the p95
// over its frames of the frame's GPU time, of the cluster pass's and of the policy's CPU scoring, the bytes its light
// lists hold, and the farthest any of the cost model's four estimates sits from its measurement, at their medians.
function manyLampsCity() {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 55, distance: 620 }, fov: 60, near: 350 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    ground_mat: { kind: 'material@1', params: { base_color: [0.4, 0.4, 0.4, 1], roughness: 1, specular_level: 0 } },
    block_mat: { kind: 'material@1', params: { base_color: [0.3, 0.32, 0.36, 1], roughness: 0.7 } },
    ground: { kind: 'mark.box@1', params: { size: [820, 0.2, 440] }, at: { pos: [0, -0.1, 0] }, material: 'ground_mat' },
  };
  const pad = (n, width) => String(n).padStart(width, '0');
  for (let b = 0; b < 128; b++) {
    const [i, j] = [b % 16, Math.floor(b / 16)];
    const h = 6 + 2 * ((5 * i + 3 * j) % 8);
    items[`block_${pad(b, 3)}`] = { kind: 'mark.box@1', params: { size: [8, h, 8] }, at: { pos: [48 * i - 366, h / 2, 48 * j - 174] }, material: 'block_mat' };
  }
  for (let n = 0; n < 2048; n++) {
    const [i, j] = [n % 64, Math.floor(n / 64)];
    const params = { power: 1200, color: [1, 1, 1], shadow: false, fill: true, range: 6 + (6 * ((7 * i + 13 * j) % 8)) / 7 };
    const pos = [12 * i - 378, 4, 12 * j - 186];
    items[`post_${pad(i, 2)}_${pad(j, 2)}`] = (i + j) % 2 === 1
      ? { kind: 'light.spot@1', params: { ...params, inner: 30, outer: 50 }, at: { pos, rot: [-90, 0, 0] } }
      : { kind: 'light.point@1', params, at: { pos } };
  }
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${pad(order++, 5)}`, layer: 'main' });
  const spin = { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '10s', value: 360, interp: 'linear' } } };
  return { format: 1, id: 'night-city-bench', profile: 'scene', title: 'night-city-bench', description: 'The #1634 night city.', size: FLARE_SIZE, camera: 'cam', transport: { span: '20s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, channels: { spin }, items };
}
export function manyLamps({ release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look = { id: 'look-1634-filmic', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1634 bench look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' }, roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} }, fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false }, mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    tone_map: 'filmic', exposure: 2, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto' };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = join(dir, 'city.json');
    writeFileSync(doc, JSON.stringify(manyLampsCity()));
    const PASS = 'scene3d.light_clusters';
    const mid = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [{ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, capture: [], targets: [], timings: true }] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const frames = answer.replies[0].frames;
      const column = (read) => frames.map(read);
      const [gpu, pass, scoring, bytes] = [column((f) => f.gpu_ms), column((f) => f.passes_ms[PASS]), column((f) => f.lights.scoring_ms), column((f) => f.lights.lists_bytes)];
      const off = (estimate, got) => Math.abs(mid(estimate) - mid(got)) / mid(got);
      const estimates = { gpu: off(column((f) => f.estimate.gpu_ms), gpu), pass: off(column((f) => f.declared_ms[PASS]), pass), scoring: off(column((f) => f.estimate.scoring_ms), scoring), bytes: off(column((f) => f.estimate.lists_bytes), bytes) };
      return { frame_gpu_p95_ms: p95(gpu), cluster_pass_gpu_p95_ms: p95(pass), scoring_cpu_p95_ms: p95(scoring), light_lists_bytes: Math.max(...bytes), estimates, estimate_off: Math.max(...Object.values(estimates)),
        medians: { gpu_ms: mid(gpu), pass_ms: mid(pass), scoring_ms: mid(scoring) } };
    });
    console.log(JSON.stringify({ task: 'canvas-many-lamps', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
