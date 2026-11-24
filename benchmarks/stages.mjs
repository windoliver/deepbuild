// Lit 3D stages' GPU costs at 1080p on a release `deep-gpu`, the `flares-mirrors` (#465), `lens-focus` (#468), `water`
// (#166), `water-shore` (#268), `water-flow` (#968), `local-tone-map` (#971) and `fog-linear` (#1992) modes of
// benchmarks/canvas.mjs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p50 } from './canvas-judge.mjs';

// #465: the finishes', the flare's and the mirror's GPU cost at 1080p on a release `deep-gpu`, each the difference of
// two sides' median `gpu_ms` over 300 frames of one stage (a floor plate, twelve boxes, a sun, a point light, an orbiting
// camera), and the indexed look's target bytes from `film2d`; one warm-up run and five, each a fresh process. The
// stage and the finishes are tests/acceptance/465/budgets.test.ts's.
export const FLARE_SIZE = [1920, 1080];
function flareStage({ flare = false, mirror = false } = {}) {
  const floor = { base_color: [0.05, 0.05, 0.06, 1], metallic: 0, roughness: 0.2 };
  if (mirror) floor.mirror = { strength: 1, blur: 0, plane: 'floor' };
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.8, 0], orbit: { azimuth: 30, elevation: 15, distance: 9 }, fov: 45, near: 0.1, far: 500 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-45, 30, 0] } },
    'key-light': { kind: 'light.point@1', params: { power: 4.93, radius: 0.05, color: [1, 1, 1], shadow: false }, at: { pos: [0.8, 1.6, -1] } },
    floor_mat: { kind: 'material@1', params: floor },
    box_mat: { kind: 'material@1', params: { base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6 } },
    floor: { kind: 'plate@1', params: { grid: [1, 1], size: [20, 20] }, at: { pos: [0, 0, 0], rot: [0, 0, 0] }, material: 'floor_mat' },
  };
  for (let k = 0; k < 12; k++) items[`box${k}`] = { kind: 'mark.box@1', params: { size: [0.7, 0.7 + 0.15 * (k % 4), 0.7] }, at: { pos: [3 * Math.cos((k * Math.PI) / 6), 0.35 + 0.075 * (k % 4), 3 * Math.sin((k * Math.PI) / 6)] }, material: 'box_mat' };
  if (flare) items.flare = { kind: 'effect@1', params: { kind: 'flare', flare: { from: 'lights', ghosts: 8, halo: 0.05, streak: { count: 6, length: 0.25, anamorphic: false }, starburst: { blades: 6 }, intensity: 1 } } };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: 'flares-mirrors', profile: 'scene', title: 'Flares and mirrors', size: FLARE_SIZE, camera: 'cam', seed: 465,
    transport: { span: '10s' }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items,
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '10s', value: 150, interp: 'linear' } } } } };
}
const FLARE_FINISH = [
  { print_wear: { flicker: '5%', weave: 1.5, scratches: { count: [1, 3], width: 2, life: 6 }, dust: { density: 0.3, size: 3 }, hair: 0.2, gate: { corner_radius: 40, softness: 8 }, rate: 24 } },
  { tone_curve: { black: 0.04, white: 0.96, contrast: 1.15, toe: 0.2, shoulder: 0.2 } },
  { screen: { kind: 'crt', scanlines: 240, mask: 'aperture', curvature: 0.1 } },
  { grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } },
  { vignette: { color: 'ink', shape: 'round', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } },
];
export function flaresMirrors({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixtures = join(root, 'tests', 'acceptance', '465', 'fixtures');
  const look2d = JSON.parse(readFileSync(join(fixtures, 'look.json'), 'utf8'));
  // A physical look as the suite's FILMIC: its 2D look's palette, roles, fonts and status, a physical basis.
  const look = { ...look2d, id: 'filmic-465', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const docs = Object.fromEntries(['plain', 'flare', 'mirror'].map((k) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(flareStage({ flare: k === 'flare', mirror: k === 'mirror' })));
      return [k, path];
    }));
    const side = (doc, lk) => ({ call: 'view3d', doc, look: lk, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const indexed = { ...look2d, basis: { indexed: { size: [320, 180], scale: 6, palette: ['ground'], tables: {}, protected: [], snap: 'integer', light: { max: 255 } } } };
    const wall = { format: 1, id: 'indexed-465', profile: 'figure', title: 'Indexed', size: FLARE_SIZE, seed: 465, transport: { span: '1s' }, budget: { class: 'showpiece' },
      layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items: {} };
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.plain, look), side(docs.plain, { ...look, finish: FLARE_FINISH }), side(docs.flare, look), side(docs.mirror, look),
        { call: 'film2d', doc: wall, look: indexed, frames: 1, hash: true }] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [plain, finish, flare, mirror] = answer.replies.slice(0, 4).map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { plain_gpu_ms: plain, finish_gpu_ms: Math.max(0, finish - plain), flare_gpu_ms: Math.max(0, flare - plain),
        mirror_share: Math.max(0, (mirror - plain) / plain), indexed_target_bytes: answer.replies[4].indexed.target_bytes };
    });
    console.log(JSON.stringify({ task: 'canvas-flares-mirrors', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #468: depth of field's GPU cost at 1080p on a release `deep-gpu`: the difference of two sides' median `gpu_ms` over
// 300 frames of #465's stage seen through a 50 mm lens at f/2.8, with and without an `effect@1` of kind dof (64 taps,
// focus 6 m); one warm-up run and five, each a fresh process. tests/acceptance/468/ac5-budgets.test.ts holds the
// issue's numbers, the paints' and the transition's beside it.
export function lensFocus({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixtures = join(root, 'tests', 'acceptance', '465', 'fixtures');
  const look2d = JSON.parse(readFileSync(join(fixtures, 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'lens-468', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const docs = Object.fromEntries(['plain', 'dof'].map((k) => {
      const doc = flareStage();
      doc.id = `lens-focus-${k}`;
      doc.items.cam.params = { ...doc.items.cam.params, fov: undefined, lens: { focal_length: 50, sensor: [36, 24], fit: 'wider' }, aperture: { f_stop: 2.8, blades: 0 } };
      if (k === 'dof') doc.items.fx = { id: 'fx', name: 'fx', order: 'a999', layer: 'main', kind: 'effect@1', params: { kind: 'dof', dof: { focus: 6, taps: 64, max_coc: 24 } } };
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(doc));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.plain), side(docs.dof)] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [plain, dof] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { plain_gpu_ms: plain, dof_gpu_ms: Math.max(0, dof - plain) };
    });
    console.log(JSON.stringify({ task: 'canvas-lens-focus', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #166: the water's GPU cost at 1080p on a release `deep-gpu`, each the difference of two sides' median `gpu_ms` over
// 300 frames, the water against the same plate as a plain mirror (strength 1, blur 0, roughness 0), so the mirror's own
// pass is in both: a 400 m lake filling the lower half of the frame (four waves, ripples, rain) seen level from 2 m, and
// a 10 m plate of 256 × 256 cells seen 300 m away, whose difference bounds its waves' vertex cost. One warm-up run and
// five, each a fresh process. The stages are tests/acceptance/166/budgets.test.ts's.
const WATER_WAVES = [
  { direction: 20, length: 9, amplitude: 0.12, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.08, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.05, steepness: 0.4 },
  { direction: 300, length: 3.2, amplitude: 0.03, steepness: 0.7 },
];
function waterStage(kind, water) {
  const plain = { base_color: [0.1, 0.12, 0.12, 1], roughness: 0, mirror: { strength: 1, blur: 0, plane: 'lake' } };
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: kind === 'lake' ? [0, 2, 0] : [0, 40, 300], target: kind === 'lake' ? [0, 2, -100] : [0, 0, 0], fov: 60, near: 0.1, far: 1000 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-30, 30, 0] } },
    'lake-water': { kind: 'material@1', params: water ? { roughness: 0, water } : plain },
    crate: { kind: 'material@1', params: { base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 } },
    lake: { kind: 'plate@1', params: { grid: [256, 256], size: kind === 'lake' ? [400, 400] : [10, 10] }, at: { pos: [0, 0, 0] }, material: 'lake-water' },
  };
  if (kind === 'lake') for (let k = 0; k < 12; k++) items[`crate${k}`] = { kind: 'mark.box@1', params: { size: [1.5, 1.5, 1.5] }, at: { pos: [-15 + 2.7 * k, 0.5, -20 - 4 * (k % 3)] }, material: 'crate' };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: `water-${kind}`, profile: 'scene', title: 'Water', size: FLARE_SIZE, camera: 'cam', seed: 166, transport: { span: '30s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items };
}
export function water({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-166', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const stages = {
      lake: waterStage('lake', { waves: WATER_WAVES, ripples: { strength: 0.3 }, rain: 50 }), lakeMirror: waterStage('lake', null),
      pond: waterStage('pond', { waves: WATER_WAVES, ripples: { strength: 0 }, rain: 0 }), pondMirror: waterStage('pond', null),
    };
    const docs = Object.fromEntries(Object.entries(stages).map(([k, d]) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: ['lake', 'lakeMirror', 'pond', 'pondMirror'].map((k) => side(docs[k])) });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [lake, lakeMirror, pond, pondMirror] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      const water = answer.replies[0].frames.map((f) => f.passes_ms?.['scene3d.water'] ?? 0);
      return { lake_gpu_ms: Math.max(0, lake - lakeMirror), waves_vertex_ms: Math.max(0, pond - pondMirror), water_pass_ms: median(water), mirror_gpu_ms: lakeMirror };
    });
    console.log(JSON.stringify({ task: 'canvas-water', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #268: the same 1080p lake with its shore on: twelve piles, a quay and a floating deck in its shore's collection
// (`cell: 0.25`, shade 0.5), against the same plate and items as a plain mirror, so the mirror's own pass is in both;
// and the field's bake time, the frame row's `shore.bake_ms`, as a reading. The stage is
// tests/acceptance/268/budgets.test.ts's.
function shoreStage(water) {
  const doc = waterStage('lake', water);
  const wood = { kind: 'material@1', params: { base_color: [0.5, 0.36, 0.24, 1], roughness: 0.8 } };
  const shapes = { wood, quay: { kind: 'mark.box@1', params: { size: [60, 3, 6] }, at: { pos: [0, -0.5, -40] }, material: 'wood' },
    deck: { kind: 'mark.box@1', params: { size: [8, 0.2, 6] }, at: { pos: [-10, 0.6, -14] }, material: 'wood' } };
  for (let k = 0; k < 12; k++) shapes[`pile${k}`] = { kind: 'mark.cylinder@1', params: { size: [1, 3, 1] }, at: { pos: [-15 + 2.7 * k, 0, -20 - 4 * (k % 3)] }, material: 'wood' };
  for (const id of Object.keys(doc.items)) if (id.startsWith('crate')) delete doc.items[id];
  let order = Object.keys(doc.items).length;
  for (const [id, item] of Object.entries(shapes)) doc.items[id] = { ...item, id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' };
  doc.collections = { 'lake-shore': { members: Object.keys(shapes).filter((k) => k !== 'wood') } };
  return doc;
}
export function waterShore({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-268', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const shore = { waves: WATER_WAVES, ripples: { strength: 0.3 }, rain: 50, shore: { items: 'lake-shore', cell: 0.25, shade: 0.5 } };
    const docs = Object.fromEntries(Object.entries({ shore: shoreStage(shore), mirror: shoreStage(null) }).map(([k, d]) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.shore), side(docs.mirror), { ...side(docs.shore), frames: 1, capture: [0], shore: true, timings: false }] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [lake, mirror] = answer.replies.slice(0, 2).map((r) => median(r.frames.map((f) => f.gpu_ms)));
      const water = answer.replies[0].frames.map((f) => f.passes_ms?.['scene3d.water'] ?? 0);
      return { shore_lake_gpu_ms: Math.max(0, lake - mirror), water_pass_ms: median(water), mirror_gpu_ms: mirror, bake_ms: answer.replies[2].frames[0]?.shore?.bake_ms ?? null };
    });
    console.log(JSON.stringify({ task: 'canvas-water-shore', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #968: a 30 m × 20 m sheet of water with flow along a straight curve down its middle (speed 1.5, cycle 2, a 3 m/s
// breeze's waves and the default ripples), seen straight down so it fills a third of a 1080p frame, against the same
// sheet with `water: {}`; the difference of the sides' median `gpu_ms` over 300 frames is what the flow adds. One
// warm-up run and five, each a fresh process. The stage is tests/acceptance/968/budgets.test.ts's.
function flowStage(flow) {
  const size = [1920, 1080];
  const height = Math.sqrt((3 * 30 * 20 * size[0]) / size[1]) / 2 / Math.tan(Math.PI / 6);
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, height, 0], target: [0, 0, 0], fov: 60, near: 0.1, far: 1000 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-30, 30, 0] } },
    'sheet-water': { kind: 'material@1', params: { roughness: 0.05, water: flow ? { flow } : {} } },
    c: { kind: 'curve@1', params: { points: [[-15, 0, 0], [15, 0, 0]], mode: 'linear' } },
    sheet: { kind: 'plate@1', params: { grid: [256, 256], size: [30, 20] }, at: { pos: [0, 0, 0] }, material: 'sheet-water' },
  };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: `sheet-${flow ? 'flow' : 'still'}`, profile: 'scene', title: 'Flow', size, camera: 'cam', seed: 968, transport: { span: '30s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items };
}
export function waterFlow({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-968', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const docs = Object.fromEntries(Object.entries({ flow: flowStage({ along: 'c', speed: 1.5, cycle: 2 }), still: flowStage(null) }).map(([k, d]) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: [1920, 1080], frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.flow), side(docs.still)] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [flow, still] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { flow_sheet_gpu_ms: Math.max(0, flow - still), still_gpu_ms: still };
    });
    console.log(JSON.stringify({ task: 'canvas-water-flow', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #971: what the look's local tone map adds to a frame's GPU time on a release `deep-gpu`, at 1920 × 1080 and at
// 3840 × 2160: the difference of two sides' median `gpu_ms` over 300 frames of #465's stage, with
// `local: {strength: 0.5}` on the look and without; one warm-up run and five, each a fresh process.
// tests/acceptance/971/budgets.test.ts holds the issue's numbers on its own fixture.
export function localToneMap({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'local-971', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = join(dir, 'stage.json');
    writeFileSync(doc, JSON.stringify(flareStage()));
    const side = (size, local) => ({ call: 'view3d', doc, look: local ? { ...look, local: { strength: 0.5 } } : look, size, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [[1920, 1080], [3840, 2160]].flatMap((size) => [side(size, true), side(size, false)]) });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [full, fullPlain, uhd, uhdPlain] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { local_1080p_gpu_ms: Math.max(0, full - fullPlain), local_2160p_gpu_ms: Math.max(0, uhd - uhdPlain), plain_1080p_gpu_ms: fullPlain, plain_2160p_gpu_ms: uhdPlain };
    });
    console.log(JSON.stringify({ task: 'canvas-local-tone-map', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #1992's cost: the castle's orbit, 300 frames at 30 fps at its own size, with its exp fog as committed and with the
// linear curve of the same halfway distance; the reading is the ratio of their p50 GPU frame times.
export function fogLinear({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const castle = JSON.parse(readFileSync(join(root, 'packs/examples/castle.json'), 'utf8'));
  const look = JSON.parse(readFileSync(join(root, 'packs/examples/castle.look.json'), 'utf8'));
  const linear = structuredClone(castle);
  Object.values(linear.items).find((i) => i.kind === 'sky@1').params.fog_curve = { linear: { near: 0, far: 693 } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const docs = [castle, linear].map((d, k) => {
      const path = join(dir, `castle-${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return path;
    });
    const measured = runs(() => {
      const [exp, lin] = docs.map((doc) => {
        const drawn = once('deep-gpu', ['run'], { out: dir, calls: [{ call: 'view3d', doc, look, size: castle.size, packs: [join(root, 'packs', 'composites-1.0.0')], frames: 300, fps: 30, timings: true }] });
        if (drawn.ok !== true || drawn.replies[0]?.code) throw Error(`deep-gpu answered ${JSON.stringify(drawn).slice(0, 1500)}`);
        return p50(drawn.replies[0].frames.map((f) => f.gpu_ms));
      });
      return { exp_gpu_ms: exp, linear_gpu_ms: lin, linear_over_exp: lin / exp };
    });
    console.log(JSON.stringify({ task: 'canvas-fog-linear', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
