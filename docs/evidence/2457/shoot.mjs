// Films #2457's soft volumes from the renderer's own output and holds the frames to the physics module's bake.
//
// The scene: three mesh assets, each the source of a soft volume with inflate 1.2 and drawn back by its skin, each
// starting 0.5 m above the ground. `cube` and `tinted` are the acceptance suite's cube of 0.5 m (24 file vertices, no
// face sharing one, 8 welded): `cube` is drawn with the item's material, `tinted` with a material its own file
// carries. `blob` is a ball of 0.3 m radius whose 42 vertices its 80 triangles share, which no criterion and no test
// reaches: an asset as a modeling tool writes one. A 1 kg ball is launched at `cube` at 5 m/s at 1.25 s.
//
// `deep-gpu`'s `view3d` bakes the world itself from the call's assets and draws 90 frames (0 to 3 s at 30 fps), with
// its object-ID target. `deep-physics` bakes the same world from an evidence store. For every frame, the pixels each
// asset covers are held to where its particles, interpolated at the frame's time, project through the scene's
// camera. Held to the assets at rest instead, the same frames must read far off.
//
// Writes beside itself stills.png, settle.apng, the four stills and check.json, and prints PASS or FAIL lines.
// Run from the repository root after `cargo build --locked --bin deep-gpu --bin deep-physics`; needs ffmpeg and macOS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const bin = (name) => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'deep-2457-shoot-'));

// The cube as its file holds it (tests/acceptance/2457/helpers.ts: cubeMesh).
const SIDE = 0.5, LOW = [0.25, 0, -1.5];
const FACES = { '+y': [2, 3, 7, 6], '-x': [0, 1, 3, 2], '+z': [1, 5, 7, 3], '-y': [0, 4, 5, 1], '+x': [4, 6, 7, 5], '-z': [0, 2, 6, 4] };
const FILE = [['+y', 0], ['-x', 1], ['+z', 2], ['-y', 3], ['+x', 1], ['-z', 2]];
const corner = (c) => [LOW[0] + SIDE * ((c >> 2) & 1), LOW[1] + SIDE * ((c >> 1) & 1), LOW[2] + SIDE * (c & 1)];
function cubeMesh() {
  const positions = [], faces = [];
  FILE.forEach(([face, start], i) => {
    const b = positions.length;
    for (let k = 0; k < 4; k++) positions.push(corner(FACES[face][(start + k) % 4]));
    faces.push(i % 2 === 0 ? [[b, b + 1, b + 2], [b, b + 2, b + 3]] : [[b + 1, b + 2, b + 3], [b + 1, b + 3, b]]);
  });
  return { positions, triangles: faces.reverse().flat() };
}
/** A ball of radius `r` resting on y = 0 in its file's space: an icosahedron's faces each cut in four, its 42 vertices shared. */
function ballMesh(r) {
  const t = (1 + Math.sqrt(5)) / 2;
  const points = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mids = new Map();
  const mid = (a, b) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!mids.has(k)) { mids.set(k, points.length); points.push(points[a].map((x, i) => (x + points[b][i]) / 2)); } return mids.get(k); };
  const triangles = faces.flatMap(([a, b, c]) => { const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)]; return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  return { positions: points.map((p) => { const n = Math.hypot(...p); return [Math.fround((r * p[0]) / n), Math.fround((r * p[1]) / n + r), Math.fround((r * p[2]) / n)]; }), triangles };
}
/** A mesh's welded vertices, in the order its file first holds each, and its triangles over them. */
function weld(m) {
  const seen = new Map(), of = [], points = [];
  for (const p of m.positions) { const k = p.join(','); if (!seen.has(k)) { seen.set(k, points.length); points.push(p); } of.push(seen.get(k)); }
  return { points, triangles: m.triangles.map((t) => t.map((i) => of[i])) };
}

/** `m` as a glTF 2.0 binary; with `material`, its one primitive names a material of the file's own. */
function glb(m, material) {
  const { positions, triangles } = m;
  const bound = (pick) => [0, 1, 2].map((k) => pick(...positions.map((p) => p[k])));
  const pos = Buffer.alloc(positions.length * 12); positions.forEach((p, i) => p.forEach((x, k) => pos.writeFloatLE(x, i * 12 + k * 4)));
  const idx = Buffer.alloc(triangles.length * 12); triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    ...(material ? { materials: [{ pbrMetallicRoughness: { baseColorFactor: material, metallicFactor: 0, roughnessFactor: 0.5 } }] } : {}),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4, ...(material ? { material: 0 } : {}) }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min: bound(Math.min), max: bound(Math.max) },
      { bufferView: 1, componentType: 5125, count: triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length }],
  };
  const text = Buffer.from(JSON.stringify(doc), 'utf8');
  const json = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat([pos, idx]);
  const chunk = (b, kind) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, b]); };
  const header = Buffer.alloc(12); header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8);
  return Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(body, 0x004e4942)]);
}

// The assets: as files the view3d call names by hash, and in an evidence store deep-physics reads by hash.
const store = join(work, 'store');
const assets = {};
function asset(name, bytes) {
  const h = sha(bytes), path = join(work, `${name}.glb`);
  writeFileSync(path, bytes);
  mkdirSync(join(store, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, h.slice(0, 2), h.slice(2)), bytes);
  assets[h] = path;
  return h;
}
const [CUBE, BALL] = [cubeMesh(), ballMesh(0.3)];
const ITEMS = {
  cube: { soft: 'jelly', at: [1.5, 0.5, 0.75], mesh: CUBE, sha: asset('cube', glb(CUBE, null)), mass: 1 },
  tinted: { soft: 'jam', at: [2.6, 0.5, 0.75], mesh: CUBE, sha: asset('tinted', glb(CUBE, [0.2, 0.55, 0.85, 1])), mass: 1 },
  blob: { soft: 'gum', at: [4.2, 0.5, -0.5], mesh: BALL, sha: asset('blob', glb(BALL, null)), mass: 0.1 },
};
for (const it of Object.values(ITEMS)) it.welded = weld(it.mesh);

// The scene and its world (the suite's soft cube world, with #524's ball).
const [W, H, FPS, FRAMES] = [640, 360, 30, 90];
const FLICKS = 705_600_000, STEP = FLICKS / 120, LAUNCH_STEP = 150;
const LAUNCH = { step: LAUNCH_STEP, kind: 'launch', target: 'ball', data: { linear: [5, 0, 0] } };
const CAMERA = { projection: 'perspective', position: [3, 1.6, 4.9], target: [3, 0.4, -0.5], fov: 40, near: 0.1, far: 100 };
const volume = (from) => ({ shape: 'volume', from, inflate: 1.2, masses: { default: ITEMS[from].mass }, stretch: { hz: 8, damping_ratio: 0.5 }, contact_material: 'jelly' });
const skin = (from) => ({ from, read: 'particle_positions', to: { skin: { item: 'auto' } } });
const world = {
  kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 524, mode: 'dynamic',
  capacity: { bodies: 8, shapes: 8, joints: 64, contacts: 1024, particles: 1024 }, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { ground: { friction: 0.8, restitution: 0 }, jelly: { friction: 0.8, restitution: 0, density: 1000 }, rubber: { friction: 0.5, restitution: 0, density: 1000 } },
  shapes: { plane: { kind: 'plane', normal: [0, 1, 0] }, ball: { kind: 'sphere', radius: 0.1 } },
  bodies: {
    ground: { kind: 'static', shapes: [{ shape: 'plane', contact_material: 'ground' }] },
    ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos: [0.3, 0.27, -0.5] }, mass: 1, gravity_scale: 0, sleep: false },
  },
  checkpoint: { every: 60 }, inputs: { kick: { kind: 'launch', targets: ['ball'] } },
  soft: { jelly: volume('cube'), jam: volume('tinted'), gum: volume('blob') },
  outputs: { skin: skin('jelly'), skin2: skin('jam'), skin3: skin('gum'), ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } },
};
const material = (base_color, roughness) => ({ kind: 'material@1', params: { base_color, roughness, metallic: 0 } });
const items = {
  cam: { kind: 'camera@1', params: CAMERA },
  sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
  sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-40, 30, 0] } },
  grass: material([0.32, 0.42, 0.26, 1], 0.95), jelly_red: material([0.85, 0.22, 0.28, 1], 0.4), stone: material([0.75, 0.75, 0.78, 1], 0.6),
  gum_yellow: material([0.9, 0.72, 0.2, 1], 0.4),
  ground: { kind: 'mark.box@1', params: { size: [14, 0.02, 8] }, at: { pos: [3, -0.01, -0.5] }, material: 'grass' },
  cube: { kind: 'mesh.asset@1', params: { sha256: ITEMS.cube.sha, node: 0 }, at: { pos: ITEMS.cube.at }, material: 'jelly_red' },
  tinted: { kind: 'mesh.asset@1', params: { sha256: ITEMS.tinted.sha, node: 0 }, at: { pos: ITEMS.tinted.at } },
  blob: { kind: 'mesh.asset@1', params: { sha256: ITEMS.blob.sha, node: 0 }, at: { pos: ITEMS.blob.at }, material: 'gum_yellow' },
  ball: { kind: 'mark.sphere@1', params: { size: [0.2, 0.2, 0.2] }, material: 'stone' },
};
const scene = {
  id: 'soft-cube-assets-2457', format: 1, profile: 'scene', title: 'Soft mesh assets', description: 'Three soft volumes built from mesh assets: #2457 evidence.',
  size: [W, H], camera: 'cam', transport: { span: '3s', frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } }, worlds: { lab: world },
  layers: { main: { writer: 'agent:sess-2457', title: 'main', order: 'a0' } },
  items: Object.fromEntries(Object.entries(items).map(([id, it], i) => [id, { id, name: id, order: `a${String(i).padStart(3, '0')}`, layer: 'main', ...it }])),
};
// The acceptance suites' physical look (tests/acceptance/484/helpers.ts: LOOK).
const STATUS = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const LOOK = {
  id: 'look-484-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #484 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' }, roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false }, mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' }, status: STATUS,
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** One process fed `input`: its stdout's lines as JSON. */
function lines(name, args, input) {
  const run = spawnSync(bin(name), args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 2 ** 31 - 1 });
  if (run.status !== 0) throw Error(`${name} exits ${run.status}: ${(run.stderr ?? '').slice(-1500)}`);
  return run.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** An 8-bit RGB or RGBA PNG's pixels as RGBA. */
function decode(file) {
  let at = 8, width = 0, height = 0, color = 0; const data = [];
  while (at < file.length) {
    const n = file.readUInt32BE(at), type = file.toString('latin1', at + 4, at + 8), body = file.subarray(at + 8, at + 8 + n);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); color = body[9]; }
    if (type === 'IDAT') data.push(body);
    at += 12 + n;
  }
  const ch = color === 6 ? 4 : 3, stride = width * ch, raw = inflateSync(Buffer.concat(data)), rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0, p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
    for (let x = 0; x < width; x++) { for (let k = 0; k < ch; k++) rgba[(y * width + x) * 4 + k] = line[x * ch + k]; if (ch === 3) rgba[(y * width + x) * 4 + 3] = 255; }
    prev = line;
  }
  return { width, height, rgba };
}

// The scene's camera: +Y up, its field of view across the frame's longer side.
const sub = (a, b) => a.map((x, i) => x - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.hypot(...a));
const forward = unit(sub(CAMERA.target, CAMERA.position)), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
const focal = Math.max(W, H) / 2 / Math.tan((CAMERA.fov * Math.PI) / 360);
const project = (p) => { const d = sub(p, CAMERA.position), z = dot(d, forward); return [W / 2 + (focal * dot(d, right)) / z, H / 2 - (focal * dot(d, up)) / z]; };
/** The box [x0, y0, x1, y1] of points, px. */
const boxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const apart = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const enclosed = (ps, triangles) => triangles.reduce((v, [a, b, c]) => v + dot(ps[a], cross(ps[b], ps[c])) / 6, 0);

const out = [];
const say = (ok, line) => { out.push(`${ok ? 'PASS' : 'FAIL'} ${line}`); return ok; };
let good = true;
try {
  const doc = join(work, 'scene.json');
  writeFileSync(doc, JSON.stringify(scene));
  const capture = Array.from({ length: FRAMES }, (_, n) => n);
  const answer = lines('deep-gpu', ['run'], `${JSON.stringify({ out: work, calls: [{ call: 'view3d', look: LOOK, doc, size: [W, H], fps: FPS, from: 0, frames: FRAMES, capture, targets: ['final', 'ids'], assets, tracks: { lab: [LAUNCH] } }] })}\n`)[0];
  const drawn = answer.replies?.[0];
  if (!Array.isArray(drawn?.frames)) throw Error(`view3d drew no frames: ${JSON.stringify(answer).slice(0, 800)}`);
  const baked = lines('deep-physics', [], `${JSON.stringify({ call: 'bake', scene, world: 'lab', evidence: store, steps: 361, track: [LAUNCH] })}\n`)[0];
  if (baked.ok !== true) throw Error(`deep-physics refuses the world: ${JSON.stringify(baked).slice(0, 800)}`);
  const names = Object.keys(ITEMS);
  /** An item's particles v0, v1, … after each step. */
  const states = ({ soft, welded }) => { const p = baked.particles[soft], at = welded.points.map((_, i) => p.addresses.indexOf(`v${i}`)); return p.positions.map((s) => at.map((j) => s[j])); };
  const particles = Object.fromEntries(names.map((n) => [n, states(ITEMS[n])]));
  /** Where a frame at `n` shows each particle (Physics output: k = ⌊t ÷ step⌋, α the rest, positions lerped). */
  const shown = (st, n) => { const t = (n * FLICKS) / FPS, k = Math.floor(t / STEP), a = (t - k * STEP) / STEP; return st[k].map((p, i) => p.map((x, c) => x + a * ((st[k + 1] ?? st[k])[i][c] - x))); };

  const zero = () => Object.fromEntries(names.map((n) => [n, 0]));
  const worst = zero(), atRest = zero(), pixels = Object.fromEntries(names.map((n) => [n, []])), finals = new Map();
  for (const f of drawn.frames) {
    finals.set(f.frame, readFileSync(join(work, `${f.final}.png`)));
    const ids = decode(readFileSync(join(work, `${f.ids}.png`)));
    const found = Object.fromEntries(names.map((n) => [n, []]));
    for (let i = 0; i < ids.width * ids.height; i++) {
      const pick = (ids.rgba[i * 4] + ids.rgba[i * 4 + 1] * 256 + ids.rgba[i * 4 + 2] * 65536 + ids.rgba[i * 4 + 3] * 16777216) >>> 0;
      const item = pick ? f.picks?.[String(pick)] : undefined;
      if (item in found) found[item].push([i % ids.width, Math.floor(i / ids.width)]);
    }
    for (const item of names) {
      pixels[item].push(found[item].length);
      if (found[item].length === 0) { worst[item] = Infinity; continue; }
      const b = boxOf(found[item]), covered = [b[0], b[1], b[2] + 1, b[3] + 1];
      worst[item] = Math.max(worst[item], apart(covered, boxOf(shown(particles[item], f.frame).map(project))));
      atRest[item] = Math.max(atRest[item], apart(covered, boxOf(ITEMS[item].welded.points.map((p) => project(p.map((x, c) => x + ITEMS[item].at[c]))))));
    }
  }
  const BOUND = 1.5;
  const check = { frames: drawn.frames.length, size: [W, H], fps: FPS, bound_px: BOUND, items: {} };
  for (const item of names) {
    const { welded, soft } = ITEMS[item], vol = particles[item].map((ps) => enclosed(ps, welded.triangles)), rest = vol[0];
    const inBand = (v) => Math.abs(v - 1.2 * rest) <= 0.02 * 1.2 * rest, range = (a, b) => [Math.min(...vol.slice(a, b + 1)), Math.max(...vol.slice(a, b + 1))];
    const [settled, last] = [range(120, LAUNCH_STEP), range(300, 360)];
    good = say(worst[item] <= BOUND, `${item}: in all ${drawn.frames.length} frames its pixels' box is within ${worst[item].toFixed(2)} px of its ${welded.points.length} particles' (bound ${BOUND} px); it covers ${Math.min(...pixels[item])} to ${Math.max(...pixels[item])} px`) && good;
    good = say(atRest[item] > 10 * BOUND, `${item}: held to the asset at rest, the same frames read ${atRest[item].toFixed(1)} px off`) && good;
    const line = `${item}: its particles enclose ${(settled[0] / rest).toFixed(4)} to ${(settled[1] / rest).toFixed(4)} × its rest ${rest.toFixed(6)} m³ over steps 120 to ${LAUNCH_STEP} and ${(last[0] / rest).toFixed(4)} to ${(last[1] / rest).toFixed(4)} × over steps 300 to 360`;
    // The criterion's 2% is the cube's; the ball's volume is read, not judged.
    if (ITEMS[item].mesh === CUBE) good = say([...settled, ...last].every(inBand), `${line}; 1.2 × within 2% is 1.176 to 1.224 ×`) && good;
    else out.push(`READ ${line}`);
    check.items[item] = { soft, particles: welded.points.length, worst_px: worst[item], at_rest_px: atRest[item], pixels: [Math.min(...pixels[item]), Math.max(...pixels[item])], volume_m3: { built: rest, settled, after_hit: range(LAUNCH_STEP, 360), last } };
  }
  // The hit, read and not judged (no criterion of #2457 names it): #524's measure of a dent, the most any distance
  // between two of the cube's particles moves from its settled length, and how near the ball's surface comes to the
  // plane of the face it is launched at.
  const dist = (a, b) => Math.hypot(...sub(a, b));
  const after = Array.from({ length: 361 - LAUNCH_STEP }, (_, i) => LAUNCH_STEP + i);
  const corners = ITEMS.cube.welded.points;
  const moved = (k) => Math.max(...corners.flatMap((_, i) => corners.slice(i + 1).map((__, j) => Math.abs(dist(particles.cube[k][i], particles.cube[k][i + 1 + j]) - dist(particles.cube[LAUNCH_STEP][i], particles.cube[LAUNCH_STEP][i + 1 + j])))));
  const ball = baked.bodies.ball;
  const gap = (k) => Math.min(...particles.cube[k].map((p) => p[0])) - (ball[k].pos[0] + 0.1);
  check.hit = { dent_mm: 1000 * Math.max(...after.map(moved)), nearest_mm: 1000 * Math.min(...after.map(gap)), ball_speed_after: Math.hypot(...ball[360].linear) };
  out.push(`READ the hit: the cube's particles move at most ${check.hit.dent_mm.toFixed(2)} mm apart or together; the ball's surface comes within ${check.hit.nearest_mm.toFixed(2)} mm of the face's plane and ends at ${check.hit.ball_speed_after.toFixed(3)} m/s`);
  // The ball's landing, read: the most its height falls below its rest 0.6 m, and where it settles.
  const height = (k) => Math.max(...particles.blob[k].map((p) => p[1])) - Math.min(...particles.blob[k].map((p) => p[1]));
  const heights = particles.blob.map((_, k) => height(k));
  check.blob = { height_m: { built: heights[0], least: Math.min(...heights), last: heights[360] } };
  out.push(`READ blob: 0.6 m tall as built, ${Math.min(...heights).toFixed(3)} m at its flattest (step ${heights.indexOf(Math.min(...heights))}), ${heights[360].toFixed(3)} m at the end`);

  // The pictures: four stills in one sheet, and the recording.
  const STILLS = [0, 11, 46, 89];
  for (const n of capture) writeFileSync(join(work, `f${String(n).padStart(3, '0')}.png`), finals.get(n));
  const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw Error(`ffmpeg: ${r.stderr}`); };
  ffmpeg([...STILLS.flatMap((n) => ['-i', join(work, `f${String(n).padStart(3, '0')}.png`)]), '-filter_complex', 'xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', join(work, 'stills.png')]);
  ffmpeg(['-framerate', String(FPS), '-i', join(work, 'f%03d.png'), '-vf', 'scale=480:270', '-plays', '0', '-f', 'apng', join(work, 'settle.apng')]);
  const keep = (name, bytes) => { writeFileSync(join(HERE, name), bytes); check.files = { ...check.files, [name]: sha(bytes) }; };
  for (const n of STILLS) keep(`still-${(n / FPS).toFixed(2).replace('.', '_')}s.png`, finals.get(n));
  keep('stills.png', readFileSync(join(work, 'stills.png')));
  keep('settle.apng', readFileSync(join(work, 'settle.apng')));
  check.verdict = good ? 'PASS' : 'FAIL';
  check.lines = out;
  writeFileSync(join(HERE, 'check.json'), `${JSON.stringify(check, null, 2)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const line of out) console.log(line);
console.log(`${good ? 'PASS' : 'FAIL'} shoot: ${good ? 'the three assets are drawn on their particles in every frame, and off them when held to the assets at rest' : 'see the lines above'}`);
process.exit(good ? 0 : 1);
