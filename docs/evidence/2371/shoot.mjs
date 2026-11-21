// Draws #2371's pictures (README.md beside this) from `deep-physics`'s own bakes of the acceptance suite's worlds
// (tests/acceptance/2371/README.md: The worlds), and holds every frame to its bake. Each film is a scene with no
// world: every body is an item posed at each frame from the bake's state at that frame's step, a flat disc for a
// ball and a box for the crate, drawn by `deep-gpu run`'s `view3d`. The camera is orthographic, square on along −Z.
// A film "from above" puts world x across the page and world z down it, so a body's height isn't seen there.
// The check reads the pixels of every frame: each body's middle, from the pixels of its colour in its part of the
// frame, is held to the bake's position at that step. It also reads the criteria's own claims off the frames alone.
// Writes beside itself: stills.png (each film's last frame), films.apng (2 s at 30 fps), check.json; prints each
// SHA-256. Run from the repository root after `cargo build --locked --bin deep-gpu --bin deep-physics`; needs ffmpeg
// and macOS (the GPU layer's Metal device). Exits 1 when a frame is off its bake or a claim doesn't read.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const bin = (name) => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const [W, H, HZ, FPS, STEPS] = [480, 360, 120, 30, 240];
const FRAMES = (STEPS * FPS) / HZ + 1;
const DEG = 180 / Math.PI;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const LOOK = { ...JSON.parse(readFileSync(join(REPO, 'docs', 'evidence', '182', 'look.json'), 'utf8')), id: 'look-2371-shoot' };

function lines(file, args, calls) {
  const r = spawnSync(file, args, { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`${file} ${args.join(' ')} exited ${r.status}: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${(r.stderr ?? '').slice(-1500)}`);
}
/** The canvas's rotation from a body's quaternion: degrees about X, then Y, then Z. */
function euler([x, y, z, w]) {
  return [Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG, Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * DEG,
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG];
}

// The suite's worlds, as tests/acceptance/2371/helpers.ts writes them.
const world = (parts) => ({
  kind: 'physics.world@1', dimensions: 3, step_rate: HZ, substeps: 4, gravity: [0, -9.81, 0], seed: 2371, mode: 'dynamic',
  capacity: { bodies: 8, shapes: 8, joints: 0, contacts: 16, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } }, checkpoint: { every: 60 }, ...parts,
});
const body = (shape, pos, extra = {}) => ({ kind: 'dynamic', shapes: [{ shape, contact_material: 'm' }], pose: { pos }, mass: 1, ...extra });
const FLOATS = { gravity_scale: 0, sleep: false };
const entry = (step, kind, target, data) => ({ step, kind, target, ...(data ? { data } : {}) });
const PUSH = { kind: { uniform: { accel: [2, 0, 0] } }, applies_to: ['puck'], strength: 'throttle' };
const THROTTLE = { kind: 'set', targets: ['push'], path: 'strength', value: 0 };
const ball = { kind: 'sphere', radius: 0.25 }, bead = { kind: 'sphere', radius: 0.05 };
const yard = world({
  shapes: { ball, bead },
  bodies: { sleeper: body('ball', [-4, 0, 0], { active: false }), faller: body('ball', [-2, 0, 0]), puck: body('ball', [0, 0, 0], FLOATS), chip: body('bead', [0.9, 0, 4], FLOATS) },
  forces: { push: PUSH },
  inputs: { throttle: THROTTLE, wake: { kind: 'activate', targets: ['sleeper'] }, halt: { kind: 'deactivate', targets: ['faller'] },
    boom: { kind: 'blast', targets: ['chip'], at: [0, 0, 4], radius: 1, impulse_per_length: 1 } },
});
const YARD = [entry(70, 'activate', 'sleeper'), entry(80, 'set', 'push', { value: 3 }), entry(90, 'deactivate', 'faller'), entry(100, 'blast', 'chip')];
const beads = (radius) => world({
  shapes: { bead }, bodies: { near: body('bead', [0.9, 0, 0], FLOATS), far: body('bead', [0, 0, 1.1], FLOATS) },
  inputs: { boom: { kind: 'blast', targets: ['far', 'near'], at: [0, 0, 0], radius, impulse_per_length: 1 } },
});
const BLAST = [entry(10, 'blast', 'near'), entry(10, 'blast', 'far')];
const crate = world({
  shapes: { crate: { kind: 'box', half: [0.25, 0.25, 0.25] } }, bodies: { crate: body('crate', [0, 0, 0], { ...FLOATS, anchors: { rim: [0.25, 0, 0] } }) },
  inputs: { poke: { kind: 'poke', targets: ['crate'] } },
});
const poke = (data) => [entry(10, 'poke', 'crate', { impulse: [0, 1, 0], ...data })];
const key = (id, t, value) => [id, { t, value, interp: 'hold' }];
const channel = (target, keys) => ({ target, type: 'vec3', keys: Object.fromEntries(keys) });
const marker = (id, order, pos) => ({ id, kind: 'mark.box@1', name: id, order, params: { size: [0.1, 0.1, 0.1] }, at: { pos } });
const field = {
  format: 1, profile: 'scene', title: 'Forces a channel or an input sets', description: 'The field of issue 2371.', size: [640, 360], camera: 'cam',
  transport: { span: '2s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } },
  items: { cam: { id: 'cam', kind: 'camera@1', name: 'cam', order: 'a0', params: { projection: 'perspective', position: [0, 4, 12], target: [0, 1, 0], fov: 40 } },
    wind: marker('wind', 'a1', [0, 0, 0]), anchor: marker('anchor', 'a2', [0, 2, 3]) },
  channels: {
    wind: channel('items/wind/at/pos', [key('k0', '0s', [0, 0, 0]), key('k1', '0.275s', [3, 0, 0]), key('k2', '1.275s', [0, 0, -2])]),
    anchor: channel('items/anchor/at/pos', [key('k0', '0s', [0, 2, 3]), key('k1', '0.375s', [0.5, 2, 3]), key('k2', '1.375s', [0.5, 2.5, 3])]),
  },
  worlds: { field: world({
    shapes: { ball }, bodies: { leaf: body('ball', [0, 0, 0], FLOATS), bob: body('ball', [0, 2, 3], FLOATS), puck: body('ball', [0, 0, -3], FLOATS) },
    forces: { breeze: { kind: { drag: { linear: 2, medium: 'items/wind/at/pos' } }, applies_to: ['leaf'] },
      tether: { kind: { spring_to_point: { point: 'items/anchor/at/pos', hz: 1, damping_ratio: 1 } }, applies_to: ['bob'] }, push: PUSH },
    inputs: { throttle: THROTTLE },
  }) },
};
const FIELD = [entry(40, 'set', 'push', { value: 3 }), entry(190, 'set', 'push', { value: 1 })];

const front = ([x, y]) => [x, y], above = ([x, , z]) => [x, -z];
/** One film: its view (`at` the middle, `width` m across), and its parts, each posed from `states` through `map`. */
const FILMS = [
  { name: 'yard-front', label: 'activate, set, deactivate: from the front', at: [1, -4.5], width: 14, bake: 0, map: front, parts: [
    { id: 'sleeper', role: 'sand', d: 0.5, zone: ([x]) => x < -3 }, { id: 'faller', role: 'sand', d: 0.5, zone: ([x]) => x >= -3 }, { id: 'puck', role: 'accent', d: 0.5 }] },
  { name: 'yard-above', label: 'set and blast (radius 1 m): from above', at: [2.5, -2], width: 8, bake: 0, map: above, reach: [[0, -4], 1], parts: [
    { id: 'puck', role: 'accent', d: 0.5 }, { id: 'chip', role: 'sand', d: 0.1 }] },
  { name: 'beads-1', label: 'blast, radius 1 m: from above', at: [0, -0.4], width: 3.2, bake: 1, map: above, reach: [[0, 0], 1], parts: [
    { id: 'near', role: 'accent', d: 0.1 }, { id: 'far', role: 'sand', d: 0.1 }] },
  { name: 'beads-1.2', label: 'blast, radius 1.2 m: from above', at: [0, -0.4], width: 3.2, bake: 2, map: above, reach: [[0, 0], 1.2], parts: [
    { id: 'near', role: 'accent', d: 0.1 }, { id: 'far', role: 'sand', d: 0.1 }] },
  { name: 'crates', label: 'poke: by address, at the point, at the centre', at: [0, 0.45], width: 4.8, low: true, map: front, parts: [
    { id: 'address', from: 'crate', bake: 3, role: 'sand', box: 0.5, shift: -1.5, zone: ([x]) => x < -0.75 },
    { id: 'point', from: 'crate', bake: 4, role: 'sand', box: 0.5, shift: 0, zone: ([x]) => x >= -0.75 }, { id: 'centre', from: 'crate', bake: 5, role: 'accent', box: 0.5, shift: 1.5 }] },
  { name: 'field-above', label: 'medium, point and strength: from above', at: [3.75, 0], width: 10.5, bake: 6, map: above, parts: [
    { id: 'leaf', role: 'sand', d: 0.5, zone: ([, y]) => y < 1.5 }, { id: 'puck', role: 'sand', d: 0.5, zone: ([, y]) => y >= 1.5 }, { id: 'bob', role: 'accent', d: 0.5 }] },
];

/** A film's scene: each part an item, its place keyed at every frame from the bake. */
function scene(film, bakes) {
  const items = {}, channels = {};
  let order = 0;
  const add = (id, item) => { items[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item }; };
  const fill = (role) => ({ paint: { fill: { role } } });
  const [cx, cy] = film.at;
  add('cam', { kind: 'camera@1', params: { projection: 'orthographic', position: [cx, cy, 30], target: [cx, cy, 0], view_width: film.width, near: 0.1, far: 100 } });
  add('label', { kind: 'mark.text@1', params: { text: film.label, size: 15, ...fill('stone') }, at: { pos: [cx, cy + (film.width * H) / W * (film.low ? -0.46 : 0.43), 6] } });
  if (film.reach) add('reach', { kind: 'mark.cylinder@1', params: { size: [2 * film.reach[1], 0.02, 2 * film.reach[1]], ...fill('muted') }, at: { pos: [...film.reach[0], -1], rot: [90, 0, 0] } });
  for (const p of film.parts) {
    const states = bakes[p.bake ?? film.bake].bodies[p.from ?? p.id];
    p.places = Array.from({ length: FRAMES }, (_, f) => { const s = states[(f * HZ) / FPS]; const [x, y] = film.map(s.pos); return { at: [x + (p.shift ?? 0), y], rot: s.rot }; });
    const keys = (value) => Object.fromEntries(p.places.map((place, f) => [`f${f}`, { t: `${f}f`, value: value(place), interp: 'hold' }]));
    add(p.id, p.box ? { kind: 'mark.box@1', params: { size: [p.box, p.box, p.box], ...fill(p.role) }, at: { pos: [...p.places[0].at, 0], rot: [0, 0, 0] } }
      : { kind: 'mark.cylinder@1', params: { size: [p.d, 0.02, p.d], ...fill(p.role) }, at: { pos: [...p.places[0].at, 0], rot: [90, 0, 0] } });
    channels[`${p.id}-pos`] = { target: `items/${p.id}/at/pos`, type: 'vec3', keys: keys((place) => [...place.at, 0]) };
    if (p.box) channels[`${p.id}-rot`] = { target: `items/${p.id}/at/rot`, type: 'vec3', keys: keys((place) => euler(place.rot)) };
  }
  return { format: 1, id: film.name, profile: 'scene', title: film.name, description: 'A world of issue 2371 as its bake left it.', size: [W, H], camera: 'cam',
    transport: { span: `${STEPS / HZ + 1}s`, frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } },
    layers: { main: { writer: 'agent:shoot-2371', title: 'main', order: 'a0' } }, items, channels };
}

/** A PNG's pixels: 8 bits a channel, RGB or RGBA, not interlaced, as view3d writes them. */
function pixels(path) {
  const b = readFileSync(path);
  let [at, w, h, n] = [8, 0, 0, 0];
  const idat = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at), name = b.toString('latin1', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') {
      [w, h, n] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0];
      if (data[8] !== 8 || !n || data[12] !== 0) throw Error(`${path}: a PNG form this reader doesn't take`);
    }
    if (name === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), row = w * n, px = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    const [f, src, dst] = [raw[y * (row + 1)], y * (row + 1) + 1, y * row];
    for (let i = 0; i < row; i++) {
      const a = i >= n ? px[dst + i - n] : 0, up = y ? px[dst + i - row] : 0, ul = y && i >= n ? px[dst + i - row - n] : 0;
      const [pa, pb, pc] = [Math.abs(up - ul), Math.abs(a - ul), Math.abs(a + up - 2 * ul)];
      px[dst + i] = (raw[src + i] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : ul][f]) & 255;
    }
  }
  return { w, h, n, px };
}
const IS = { sand: (r, g, b) => r - b > 70 && r > 120, accent: (r, g, b) => g - r > 40 && b - r > 40 };
/** The middle, in metres of the film's view, and the count of the pixels of `role` whose place `zone` takes. */
function middle(img, film, role, zone = () => true) {
  const scale = film.width / W, [left, top] = [film.at[0] - film.width / 2, film.at[1] + (film.width * H) / W / 2];
  let [sx, sy, n] = [0, 0, 0];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * img.n, at = [left + (x + 0.5) * scale, top - (y + 0.5) * scale];
    if (IS[role](img.px[i], img.px[i + 1], img.px[i + 2]) && zone(at)) { sx += at[0]; sy += at[1]; n += 1; }
  }
  return n ? { at: [sx / n, sy / n], n } : null;
}

const work = mkdtempSync(join(tmpdir(), 'deep-2371-shoot-'));
const failures = [];
try {
  const read = (ids) => ({ steps: STEPS, frame_rate: `${HZ}/1`, read: ids });
  const calls = [
    { call: 'bake', world: yard, track: YARD, ...read(['sleeper', 'faller', 'puck', 'chip']) },
    { call: 'bake', world: beads(1), track: BLAST, ...read(['near', 'far']) }, { call: 'bake', world: beads(1.2), track: BLAST, ...read(['near', 'far']) },
    { call: 'bake', world: crate, track: poke({ address: 'crate#rim' }), ...read(['crate']) }, { call: 'bake', world: crate, track: poke({ point: [0.25, 0, 0] }), ...read(['crate']) },
    { call: 'bake', world: crate, track: poke({}), ...read(['crate']) },
    { call: 'bake', scene: field, world: 'field', track: FIELD, ...read(['leaf', 'bob', 'puck']) },
  ];
  const bakes = lines(bin('deep-physics'), [], calls);
  bakes.forEach((r, i) => { if (!r.ok) throw Error(`deep-physics, bake ${i}: ${JSON.stringify(r).slice(0, 600)}`); });
  const views = FILMS.map((film) => {
    const path = join(work, `${film.name}.json`);
    writeFileSync(path, JSON.stringify(scene(film, bakes)));
    return { call: 'view3d', look: LOOK, doc: path, size: [W, H], fps: FPS, from: 0, frames: FRAMES, capture: 'every', targets: ['final'] };
  });
  const [answer] = lines(bin('deep-gpu'), ['run'], [{ out: work, calls: views }]);
  if (!answer.ok) throw Error(`deep-gpu run: ${JSON.stringify(answer).slice(0, 2000)}`);
  const runs = {};
  const masks = {};
  FILMS.forEach((film, i) => {
    const got = answer.replies[i].frames?.map((f) => f.final);
    if (!got || got.length !== FRAMES || got.some((h) => typeof h !== 'string')) throw Error(`${film.name}: ${JSON.stringify(answer.replies[i]).slice(0, 1200)}`);
    mkdirSync(join(work, film.name));
    got.forEach((hash, k) => copyFileSync(join(work, `${hash}.png`), join(work, film.name, `${String(k).padStart(4, '0')}.png`)));
    const imgs = got.map((hash) => pixels(join(work, `${hash}.png`)));
    const half = [film.width / 2, (film.width * H) / W / 2], px = film.width / W;
    runs[film.name] = Object.fromEntries(film.parts.map((p) => {
      // A frame counts where the whole body is in view; its middle is held to the bake within 1.5 px.
      const room = (p.box ?? p.d) * 0.75;
      const seen = p.places.map((place, f) => ({ f, place, got: middle(imgs[f], film, p.role, p.zone) }))
        .filter(({ place }) => Math.abs(place.at[0] - film.at[0]) < half[0] - room && Math.abs(place.at[1] - film.at[1]) < half[1] - room);
      const off = seen.map(({ f, place, got }) => ({ f, px: got ? Math.hypot(got.at[0] - place.at[0], got.at[1] - place.at[1]) / px : Infinity }));
      const worst = off.reduce((a, b) => (b.px > a.px ? b : a), { f: -1, px: 0 });
      if (!(worst.px <= 1.5)) failures.push(`${film.name}: ${p.id} is ${worst.px.toFixed(2)} px off its bake at frame ${worst.f}`);
      const moved = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
      const first = p.places.findIndex((place) => moved(place, p.places[0]) > 0);
      masks[`${film.name}/${p.id}`] = seen.map(({ got }) => got);
      return [p.id, { 'frames read': seen.length, 'most off its bake, px': +worst.px.toFixed(3), 'first frame the bake moves it': first, 'moved by the last frame read, m': +moved(seen.at(-1).place, p.places[0]).toFixed(4),
        'the frames show it move, px': +(moved(seen.at(-1).got ?? seen.at(-1).place, seen[0].got ?? seen[0].place) / px).toFixed(2) }];
    }));
  });
  // The criteria's claims, read off the frames alone.
  const still = (name) => masks[name].every((m) => m && m.n === masks[name][0].n && m.at[0] === masks[name][0].at[0] && m.at[1] === masks[name][0].at[1]);
  const shown = (name) => runs[name.split('/')[0]][name.split('/')[1]]['the frames show it move, px'];
  // The three crates stand 1.5 m (150 px) apart; the rasterizer may round an edge pixel differently at each place.
  const apart = (a, b, dx) => Math.max(...masks[a].map((m, f) => { const o = masks[b][f]; return m && o ? Math.hypot(m.at[0] + dx - o.at[0], m.at[1] - o.at[1]) / (4.8 / W) : Infinity; }));
  const sameAs = +apart('crates/address', 'crates/point', 1.5).toFixed(3);
  const turned = masks['crates/address'].some((m, f) => m.n !== masks['crates/centre'][f]?.n);
  const claims = {
    'radius 1 m: the bead 1.1 m away is the same pixels in every frame': still('beads-1/far'),
    'radius 1 m: the bead 0.9 m away moves, px': shown('beads-1/near'),
    'radius 1.2 m: the bead 1.1 m away moves, px': shown('beads-1.2/far'),
    'the crate poked by address against the crate poked at the point: their middles differ by at most, px': sameAs,
    'the crate poked at its centre covers other pixels (it doesn\'t turn)': turned,
    'the deactivated body is the same pixels from frame 23 (step 92) on': masks['yard-front/faller'].slice(23).every((m) => m && m.n === masks['yard-front/faller'][23].n && m.at[1] === masks['yard-front/faller'][23].at[1]),
  };
  for (const [what, v] of Object.entries(claims)) if (v === false || (typeof v === 'number' && !what.includes('at most') && !(v > 1))) failures.push(`claim not read off the frames: ${what} (${v})`);
  if (!(sameAs <= 0.01)) failures.push(`the crate poked by address is ${sameAs} px off the crate poked at the point`);

  const save = (name, bytes) => { writeFileSync(join(HERE, name), bytes); console.log(`${sha(bytes)}  ${name}`); };
  const grid = (cols, n) => Array.from({ length: n }, (_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
  const names = FILMS.map((f) => f.name);
  ffmpeg([...names.flatMap((n) => ['-i', join(work, n, `${String(FRAMES - 1).padStart(4, '0')}.png`)]), '-filter_complex', `xstack=inputs=6:layout=${grid(3, 6)}`, '-frames:v', '1', join(work, 'stills.png')]);
  save('stills.png', readFileSync(join(work, 'stills.png')));
  ffmpeg([...names.flatMap((n) => ['-framerate', String(FPS), '-i', join(work, n, '%04d.png')]), '-filter_complex', `xstack=inputs=6:layout=${grid(3, 6)}`, '-plays', '0', '-f', 'apng', join(work, 'films.apng')]);
  save('films.apng', readFileSync(join(work, 'films.apng')));
  const report = { frames: `${FRAMES} a film at ${FPS} fps, each the bake's state at step 4 × its number`, runs, claims, failures };
  save('check.json', `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify({ claims, failures }, null, 1));
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
