// #538's budgets, the `game-state` mode of benchmarks/canvas.mjs (task `canvas-game-state`): live game state's costs on
// release builds, read from the surfaces #538's acceptance suite names. deep-show's `frames` with `timings` gives each
// logic step's comparison of the 1 MiB `heap` writes (`compares`) and each remap of a 9,216-row atlas layer, one row a
// step and every row on a new reader or a seek (`remaps[].ms`); `deep_show` with `timing` the fit check over 5,000 keys
// in three locales (`timing.copy_fit_ms`); deep-gpu's `view3d` with `timings` each frame's upload of 1,000 changed slots
// of a 100,000-slot instancer and of a 256 × 256 overlay (`upload_ms`); and `frames`' `ran` counts the operators a still
// document with no logic columns runs past a bare one's. Programs are WebAssembly text, assembled by #544's assembler.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const DOC = (n) => `01JB538B${String(n).padStart(18, '0')}`;
const SESSION = { s1: { thread: 'thread-538', name: 'bench', process: { pid: 4100, start: 1000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1000 }];
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'The #538 budgets fixture.' };
const W = 4096;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

// Programs: each writes every element at every step; step k changes element k (heap, layer), block k (crowd), every cell (fog).
const head = (pages) => `(memory (export "memory") ${pages} ${pages}) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const ${W})) (func (export "init") (param $seed i64))`;
const loop = (n, body) => `(loop $each ${body} (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $each (i32.lt_u (local.get $i) (i32.const ${n}))))`;
const at = (base, shift) => `(i32.add (i32.const ${base}) (i32.shl (local.get $i) (i32.const ${shift})))`;
const done = '(i64.le_s (i64.extend_i32_u (local.get $i)) (local.get $k))';
const PROGRAMS = {
  heap: `(module ${head(17)} (func (export "step") (param $k i64) (local $i i32) ${loop(262144, `(i32.store ${at(W, 2)} (i32.add (local.get $i) ${done}))`)}))`,
  layer: `(module ${head(1)} (func (export "step") (param $k i64) (local $i i32) ${loop(9216, `(i32.store ${at(W, 2)} (i32.rem_u (i32.add (i32.add (i32.rem_u (local.get $i) (i32.const 96)) (i32.mul (i32.const 3) (i32.div_u (local.get $i) (i32.const 96)))) ${done}) (i32.const 8)))`)}))`,
  shop: `(module ${head(1)} (func (export "step") (param $k i64) (i32.store (i32.const ${W}) (i32.const 1)) (i32.store (i32.const ${W + 8}) (i32.const 5))))`,
  crowd: `(module ${head(49)} (func (export "step") (param $k i64) (local $i i32) ${loop(100000, `(i32.store ${at(W, 2)} (i32.const 1)) (i32.store ${at(W + 400000, 2)} (i32.const 1))
    (f64.store (i32.add (i32.const ${W + 800000}) (i32.mul (local.get $i) (i32.const 24))) (f64.convert_i32_s (i32.sub (i32.rem_u (local.get $i) (i32.const 400)) (i32.const 200))))
    (f64.store (i32.add (i32.const ${W + 800008}) (i32.mul (local.get $i) (i32.const 24))) (select (f64.const 0.25) (f64.const 0) (i64.le_s (i64.extend_i32_u (i32.div_u (local.get $i) (i32.const 1000))) (local.get $k))))
    (f64.store (i32.add (i32.const ${W + 800016}) (i32.mul (local.get $i) (i32.const 24))) (f64.convert_i32_s (i32.sub (i32.div_u (local.get $i) (i32.const 400)) (i32.const 125))))`)}))`,
  fogger: `(module ${head(5)} (func (export "step") (param $k i64) (local $i i32) ${loop(65536, `(i32.store ${at(W, 2)} (i32.rem_u (i32.add (i32.add (i32.rem_u (local.get $i) (i32.const 256)) (i32.div_u (local.get $i) (i32.const 256))) (i32.wrap_i64 (local.get $k))) (i32.const 3)))`)}))`,
};

function assemble(root, dir) {
  const wat = join(root, 'tests', 'acceptance', '544', 'wat');
  const target = join(root, 'target', 'bench-538-wat');
  const built = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', join(wat, 'Cargo.toml')], { cwd: wat, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`#544's assembler didn't build (exit ${built.status})`);
  const files = Object.entries(PROGRAMS).map(([name, text]) => { const f = join(dir, `${name}.wat`); writeFileSync(f, text); return f; });
  const run = spawnSync(join(target, 'release', 'acceptance-544-wat'), [dir, ...files], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused a program: ${run.stderr}`);
  return Object.fromEntries(Object.keys(PROGRAMS).map((name) => { const bytes = readFileSync(join(dir, `${name}.wasm`)); return [name, { bytes, sha: sha256(bytes), path: join(dir, `${name}.wasm`) }]; }));
}
function store(evidence, bytes) {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** An RGBA PNG of `width` × `height` whose pixel is `color(x, y)`. */
function png(width, height, color) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length); return out; };
  const raw = Buffer.alloc((4 * width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(color(x, y)).copy(raw, y * (4 * width + 1) + 1 + 4 * x);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A step of `heap`, `crowd` or `fogger` writes every one of its elements, past the default budget's fuel: they take
// the most the design allows.
const FUEL = { budget: { fuel: 10_000_000 } };
const logic = (id, p, writes, more = {}) => ({ id, kind: 'logic@1', name: id, order: 'a9', params: { program: p.sha, step_rate: 60, ...more, writes } });
function film(id, size, items, assets, extra = {}) {
  const cam = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
  return { format: 1, profile: 'film', title: id, description: `#538 budgets: ${id}.`, size, seed: 538, camera: 'cam', transport: { span: '4s', frame_rate: [60, 1] }, ...extra,
    items: Object.fromEntries([cam, ...items].map((i) => [i.id, i])), assets: Object.fromEntries(Object.entries(assets).map(([n, sha]) => [n, { sha256: sha, license: LICENSE }])) };
}
const f32 = (xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((v, i) => b.writeFloatLE(v, 4 * i)); return { dtype: 'f32', len: xs.length, data: b.toString('base64') }; };
const short = { span: '0.5s', frame_rate: [60, 1] };
function documents(p, atlas) {
  const names = ['Archer', 'Knight', 'Wizard', 'Healer', 'Thief', 'Scout', 'Guard', 'Smith', 'Miner', 'Baker'];
  const rows = Array.from({ length: 30 }, (_, i) => i);
  const rect = (id, box, parent) => ({ id, kind: 'rect@1', name: id, order: `c${id}`, ...(parent ? { parent } : {}), params: { box, paint: { fill: { role: 'accent' } } } });
  const letters = (k) => (k < 26 ? '' : letters(Math.floor(k / 26) - 1)) + String.fromCharCode(97 + (k % 26));
  const goods = (word) => ({ goods: Object.fromEntries(Array.from({ length: 5000 }, (_, k) => [String(k), `${word} ${letters(k)}: {0}`])) });
  return {
    heap: film('heap', [64, 64], [logic('heap', p.heap, { a: { type: 'i32', count: 262144 } }, FUEL)], { heap_program: p.heap.sha }, { transport: short }),
    layer: film('layer', [582, 582], [logic('map', p.layer, { cells: { type: 'i32', count: 9216 } }), { id: 'layer', kind: 'marks@1', name: 'Layer', order: 'a1', at: { pos: [3, 3, 0] },
      params: { mark: 'image', atlas: { asset: atlas, cell: [4, 4], padding: 1 }, grid: { shape: 'square', cell: [6, 6], size: [96, 96] }, columns: { tile: { array: 'map.cells', as: 'u16' } } } }],
    { map_program: p.layer.sha, layer_atlas: atlas }),
    fit: film('goods', [320, 40], [logic('rules', p.shop, { item: { type: 'i32', count: 1 }, count: { type: 'i32', count: 1 } }), { id: 'ware', kind: 'text@1', name: 'Ware', order: 'a1', at: { pos: [8, 12, 0] },
      params: { text: { copy: 'goods[rules.item]', args: [{ path: 'rules.count', widest: '999' }] }, size: 13 } }], { shop_program: p.shop.sha },
    { locale: 'en', data: { copy: { en: goods('Crate'), fr: goods('Caisse'), de: goods('Kiste') } } }),
    still: film('still', [600, 400], [{ id: 'title', kind: 'text@1', name: 'Title', order: 'a1', at: { pos: [8, 12, 0] }, params: { text: 'A board with no logic', size: 13 } },
      { id: 'labels', kind: 'marks@1', name: 'Labels', order: 'a2', params: { mark: 'text', n: 30, encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' } },
        columns: { x: f32(rows.map((i) => 10 + 200 * Math.floor(i / 10))), y: f32(rows.map((i) => 20 + 40 * (i % 10))), text: { dtype: 'str', len: 30, data: rows.map((i) => names[i % 10]) } } } },
      { id: 'pair', kind: 'group@1', name: 'Pair', order: 'a3', params: {} }, rect('left', [420, 300, 40, 20], 'pair'), rect('right', [480, 300, 40, 20], 'pair')], {}),
    bare: film('bare', [600, 400], [rect('one', [10, 10, 40, 20])], {}),
  };
}
function scene(id, size, items) {
  let order = 0;
  for (const [key, item] of Object.entries(items)) Object.assign(item, { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id, profile: 'scene', title: id, description: `#538 budgets: ${id}.`, size, seed: 538, camera: 'cam', transport: short,
    requires: { modules: { scene3d: '^1', logic: '^1' } }, layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items };
}
const top = (width) => ({ kind: 'camera@1', params: { projection: 'orthographic', position: [0, 50, 0], target: [0, 0, 0], view_width: width, near: 1, far: 200 } });
const sky = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const logic3d = (p, writes, more = {}) => ({ kind: 'logic@1', params: { program: p.sha, step_rate: 60, reads: [], ...more, writes } });

/** The task's readings over one fresh process of each binary. */
function measure(dir, p, once, look) {
  const evidence = join(dir, `evidence-${Math.random().toString(36).slice(2)}`);
  for (const x of Object.values(p)) store(evidence, x.bytes);
  const atlas = store(evidence, png(32, 4, (x) => [[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230]][Math.floor(x / 4)].concat(255)));
  const d = documents(p, atlas);
  const show = (doc, document, o = {}) => ({ call: 'deep_show', session: 's1', doc, document, include: ['issues', ...(o.timing ? ['timing'] : [])] });
  const frames = (doc, count, o = {}) => ({ call: 'frames', doc, count, step: '1f', pixels: false, ...o });
  const docs = [1, 2, 3, 4, 5];
  const seeks = [30, 25, 20, 15, 10];
  const calls = [show(DOC(1), d.heap), frames(DOC(1), 20, { timings: true }), show(DOC(2), d.layer), frames(DOC(2), 40, { timings: true }),
    ...seeks.map((k) => frames(DOC(2), 1, { from: `${k}f`, timings: true })), show(DOC(3), d.fit, { timing: true }),
    show(DOC(4), d.still), frames(DOC(4), 6), show(DOC(5), d.bare), frames(DOC(5), 6)];
  const panels = Object.fromEntries(docs.map((n) => [`p${n}`, { rect: [0, 0, 800, 600] }]));
  const answer = once('deep-show', ['run'], { evidence, sessions: SESSION, processes: PROCESSES, panels, docs: Object.fromEntries(docs.map((n) => [DOC(n), { panel: `p${n}` }])), calls });
  const r = answer.replies ?? [];
  for (const k of [0, 2, 4 + seeks.length, 5 + seeks.length, 7 + seeks.length]) if (r[k]?.outcome !== 'presented') throw Error(`deep-show answered ${JSON.stringify(r[k] ?? answer).slice(0, 1500)}`);
  const layerRemaps = (f) => f.remaps.filter((m) => m.set === 'layer');
  const compare = median(r[1].frames.slice(5).map((f) => f.compares.find((c) => c.logic === 'heap').ms));
  const row = median(r[3].frames.slice(5).map((f) => layerRemaps(f)[0].ms));
  const layer = median([layerRemaps(r[3].frames[0])[0].ms, ...seeks.map((_, i) => layerRemaps(r[4 + i].frames[0])[0].ms)]);
  const [still, bare] = [r[6 + seeks.length], r[8 + seeks.length]].map((x) => x.frames.map((f) => f.ran));
  const idle = still.slice(1).reduce((n, ran, k) => n + Math.max(0, ran - bare[k + 1]), 0);

  const out = join(dir, `gpu-${Math.random().toString(36).slice(2)}`);
  mkdirSync(out);
  const assets = { [p.crowd.sha]: p.crowd.path, [p.fogger.sha]: p.fogger.path };
  const write = (name, doc) => { const f = join(out, `${name}.json`); writeFileSync(f, JSON.stringify(doc)); return f; };
  const swarm = scene('swarm', [640, 400], { cam: top(420), sky, paint: { kind: 'material@1', params: { base_color: [0.9, 0.9, 0.2, 1], unlit: true } },
    pebble: { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.6] }, material: 'paint', visible: false },
    crowd: logic3d(p.crowd, { live: { type: 'bool', count: 100000 }, gen: { type: 'i32', count: 100000 }, pos: { type: 'vec3', count: 100000 } }, FUEL),
    swarm: { kind: 'instance@1', params: { of: ['pebble'], live: { array: 'crowd.live', as: 'bool' }, gen: { array: 'crowd.gen', as: 'u32' }, pos: { array: 'crowd.pos', as: 'f32' } } } });
  const field = scene('field', [512, 512], { cam: top(256), sky, sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-60, 20, 0] } },
    soil: { kind: 'material@1', params: { base_color: [0.16, 0.3, 0.1, 1], metallic: 0, roughness: 1 } }, fogger: logic3d(p.fogger, { fog: { type: 'i32', count: 65536 } }, FUEL),
    field: { kind: 'plate@1', material: 'soil', params: { terrain: { height: '0', size: [256, 256], spacing: 1, tile: 64, lod_levels: 1 },
      overlays: [{ grid: 'fogger.fog', size: [256, 256], roles: ['fog', 'dim', 'none'], opacity: 1 }] } } });
  const view = (doc, size) => ({ call: 'view3d', doc, look, size, fps: 60, frames: 30, counts: true, timings: true, assets });
  const gpu = once('deep-gpu', ['run'], { out, calls: [view(write('swarm', swarm), [640, 400]), view(write('field', field), [512, 512])] });
  if (gpu.ok !== true || gpu.replies.some((x) => x.code)) throw Error(`deep-gpu answered ${JSON.stringify(gpu).slice(0, 1500)}`);
  const upload = (reply, item) => median(reply.frames.slice(5).map((f) => f.upload_ms[item]));
  rmSync(evidence, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  return { compare_ms: compare, remap_row_us: 1000 * row, remap_layer_ms: layer, upload_slots_ms: upload(gpu.replies[0], 'swarm'),
    overlay_upload_ms: upload(gpu.replies[1], 'field'), fit_check_ms: r[4 + seeks.length].timing.copy_fit_ms, idle_steps: idle };
}

/** The `game-state` workload: release builds, a warm-up run and five, printed as the task's reading. */
export function gameState({ root, release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'plain-538', basis: 'physical', palette: { ...look2d.palette, night: '#101114', fogcloud: '#c8ccd4', dusk: '#3a3f4a' },
    roles: { ...look2d.roles, ground: 'night', fog: 'fogcloud', dim: 'dusk' }, tone_map: 'none', finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-game-state-bench-'));
  try {
    const programs = assemble(root, dir);
    const measured = runs(() => measure(dir, programs, once, look));
    console.log(JSON.stringify({ task: 'canvas-game-state', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
