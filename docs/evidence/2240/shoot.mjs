// Draws #2240's pictures (README.md beside this: Pictures) from the renderer's own output, and holds them to the bakes.
// Each run is a scene whose world is the behavior kit's own fixture world with one `pose` output to the drawn body's
// `at`: `deep-gpu run`'s `view3d` bakes that world and draws the `final` target, so the body moves by that output and
// by nothing else. A teal disc rides on the body at the point its weight acts; a pale line hangs from where that point
// starts (the box) or from the hinge (the bar). The camera is orthographic, square on along −Z, so a metre is the same
// count of pixels everywhere in a frame.
// The check reads the pixels of every frame: the sand body's outline gives its middle, long axis and size, the teal
// disc its place, and each is held to `deep-physics`'s own bake of the same world at that frame's step. The kit's
// measures are then read again from the frames alone and held to the kit's answers, and two runs' frames are held to a
// bake that isn't theirs, which they must read off. A planted program can't run inside view3d, so its two pictures pose
// the body from `deep-physics --planted`'s bake, the body's true place in stone, and no frame of theirs is read.
// Writes beside itself:
//   stills.png  the box's four runs at 3 s; under them the two planted programs at 3 s, and the bar's two runs at 0 s
//   box.apng    the box's four runs, 3 s at 30 fps
//   bar.apng    the bar's two runs, 4 s at 60 fps
//   check.json  what the check read
// and prints each SHA-256. Run from the repository root after `cargo build --locked --bin deep-gpu --bin deep-physics`;
// needs ffmpeg and macOS (the GPU layer's Metal device). Exits 1 when a frame is off its bake, a measure is off its
// answer, or a wrong bake reads as the frames'.
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
const [W, H, HZ] = [480, 360, 120];
// How far in front of the body's face the weight's disc rides, m.
const DISC = 0.3;
const DEG = 180 / Math.PI;
const sha = (b) => createHash('sha256').update(b).digest('hex');

function lines(file, args, calls) {
  const r = spawnSync(file, args, { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`${file} ${args.join(' ')} exited ${r.status}: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}
function physics(calls, planted) {
  const replies = lines(bin('deep-physics'), planted ? ['--planted', planted] : [], calls);
  replies.forEach((r) => { if (!r.ok) throw Error(`deep-physics: ${JSON.stringify(r).slice(0, 600)}`); });
  return replies;
}
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${(r.stderr ?? '').slice(-1500)}`);
}
// The look #182's physics pictures draw with: sand bodies, a teal accent, stone and slate on a dark ground.
const LOOK = { ...JSON.parse(readFileSync(join(REPO, 'docs', 'evidence', '182', 'look.json'), 'utf8')), id: 'look-2240-shoot' };

/** `v` turned by the quaternion `[x, y, z, w]`. */
function spin([x, y, z, w], v) {
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const t = cross([x, y, z], v).map((c) => 2 * c);
  const u = cross([x, y, z], t);
  return v.map((c, i) => c + w * t[i] + u[i]);
}
/** The canvas's rotation from a body's quaternion: degrees about X, then Y, then Z (as the physics pose output writes). */
function euler([x, y, z, w]) {
  return [Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG, Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * DEG,
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG];
}
/** The turn about +Z, deg, that stands a body's long axis (its local +Y) along `[x, y]`. */
const turnOf = ([x, y]) => Math.atan2(-x, y) * DEG;
/** An axis's turn against another, deg, in (−90, 90]: an axis has no head. */
const apart = (a, b) => 90 - ((((90 - a + b) % 180) + 180) % 180);
/** The angle, deg, of the turn that takes orientation `a` to `b` (quaternions), as the kit's `turn_between` reads it. */
function turnBetween(a, b) {
  const cross = (i, j) => b[i] * a[j] - b[j] * a[i];
  const v = [0, 1, 2].map((i) => a[3] * b[i] - b[3] * a[i] - cross((i + 1) % 3, (i + 2) % 3));
  return 2 * Math.atan2(Math.hypot(...v), Math.abs(a.reduce((sum, c, i) => sum + c * b[i], 0))) * DEG;
}

/**
 * The scene of one run: the world's static bodies in slate, the body `id` in sand with a teal disc at its local point
 * `centre`, a pale line hanging from `hang`, and a label. With `live`, the world rides in the document and its `pose`
 * output moves the body's item; without, the item stands at `posed` and stone boxes stand at `ghosts`.
 */
function scene(name, { world, id, centre, view, label, hang, live, posed, ghosts = [] }) {
  const items = {};
  let order = 0;
  const add = (key, item) => { items[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item }; };
  const fill = (role) => ({ paint: { fill: { role } } });
  const size = (b) => world.shapes[b.shapes[0].shape].half.map((h) => 2 * h);
  const body = world.bodies[id];
  const depth = size(body)[2] / 2;
  const dot = 0.035 * view.width;
  add('cam', { kind: 'camera@1', params: { projection: 'orthographic', position: [view.at[0], view.at[1], 30], target: [view.at[0], view.at[1], 0], view_width: view.width, near: 0.1, far: 100 } });
  add('label', { kind: 'mark.text@1', params: { text: label, size: 15, ...fill('stone') }, at: { pos: [view.label[0], view.label[1], 6] } });
  for (const [key, b] of Object.entries(world.bodies)) {
    if (b.kind === 'static') add(key, { kind: 'mark.box@1', params: { size: size(b), ...fill('muted') }, at: { pos: b.pose.pos, rot: b.pose.rot ?? [0, 0, 0] } });
  }
  // A ghost stands a little behind the body, so the body draws over it where they share a place.
  ghosts.forEach((g, i) => add(`${id}-true-${i}`, { kind: 'mark.box@1', params: { size: size(body), ...fill('stone') }, at: { pos: [g.pos[0], g.pos[1], g.pos[2] - 0.05], rot: g.rot } }));
  add(id, { kind: 'mark.box@1', params: { size: size(body), ...fill('sand') }, at: posed ?? { pos: body.pose.pos, rot: body.pose.rot ?? [0, 0, 0] } });
  // The disc faces the camera: a cylinder turned onto its side, in front of the body and of the line.
  add('weight', { kind: 'mark.cylinder@1', parent: id, params: { size: [dot, 0.02, dot], ...fill('accent') }, at: { pos: [centre[0], centre[1], depth + DISC], rot: [90, 0, 0] } });
  add('line', { kind: 'mark.box@1', params: { size: [dot / 5, hang.drop, 0.02], ...fill('stone') }, at: { pos: [hang.from[0], hang.from[1] - hang.drop / 2, hang.front ? depth + 0.1 : -depth - 0.1] } });
  const doc = {
    format: 1, id: name, profile: 'scene', title: name, description: 'A fixture of issue 2240 as its bake left it.', size: [W, H], camera: 'cam',
    transport: { span: `${view.seconds + 1}s`, frame_rate: [view.fps, 1] }, requires: { modules: { scene3d: '^1', ...(live ? { physics: '^1' } : {}) } },
    layers: { main: { writer: 'agent:shoot-2240', title: 'main', order: 'a0' } }, items,
  };
  if (live) doc.worlds = { lab: { ...world, outputs: { drawn: { from: id, read: 'pose', to: `items/${id}/at` } } } };
  return doc;
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
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : ul][f];
      px[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  return { w, h, n, px };
}
const isSand = (r, g, b) => r - b > 70 && r > 120;
const isTeal = (r, g, b) => g - r > 40 && b - r > 40;
/** Each row's first and last of the pixels `is` picks: `[y, first x, last x]`. */
function rows(img, is) {
  const out = [];
  for (let y = 0; y < img.h; y++) {
    let [first, last] = [-1, -1];
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.n;
      if (!is(img.px[i], img.px[i + 1], img.px[i + 2])) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0) out.push([y, first, last]);
  }
  return out;
}
/**
 * The convex outline of `points` as a rectangle: its long axis's turn, deg, from the outline's area moments; along
 * that axis and across it, the outline's reach, whose middle is the rectangle's middle and whose length is its side.
 */
function rectangle(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const turn = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && turn(h.at(-2), h.at(-1), p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(pts), ...half(pts.reverse())];
  let [area, sx, sy, sxx, syy, sxy] = [0, 0, 0, 0, 0, 0];
  hull.forEach(([x0, y0], i) => {
    const [x1, y1] = hull[(i + 1) % hull.length];
    const c = x0 * y1 - x1 * y0;
    area += c / 2; sx += (x0 + x1) * c / 6; sy += (y0 + y1) * c / 6;
    sxx += (x0 * x0 + x0 * x1 + x1 * x1) * c / 12; syy += (y0 * y0 + y0 * y1 + y1 * y1) * c / 12;
    sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c / 24;
  });
  const [mx, my] = [sx / area, sy / area];
  const along = 0.5 * Math.atan2(2 * (sxy / area - mx * my), sxx / area - mx * mx - (syy / area - my * my));
  const [ex, ey] = [Math.cos(along), Math.sin(along)];
  const reach = (of) => [Math.min(...hull.map(of)), Math.max(...hull.map(of))];
  const [u, v] = [reach(([x, y]) => x * ex + y * ey), reach(([x, y]) => y * ex - x * ey)];
  const [mu, mv] = [(u[0] + u[1]) / 2, (v[0] + v[1]) / 2];
  return { at: [mu * ex - mv * ey, mu * ey + mv * ex], turn: turnOf([ex, ey]), long: u[1] - u[0], short: v[1] - v[0] };
}
/**
 * The rectangle of the pixels `is` picks, px, x right and y up from the frame's middle: of the convex outline of their
 * middles, so a disc or a line drawn over the body takes nothing from it. None when a picked pixel is on the frame's
 * edge. An edge pixel passes `isSand` from about a third covered (the frame is gamma encoded), so a side reads a few
 * tenths of a pixel long.
 */
function outline(img, is) {
  const runs = rows(img, is);
  if (!runs.length || runs.some(([y, a, b]) => y === 0 || y === img.h - 1 || a === 0 || b === img.w - 1)) return null;
  return rectangle(runs.flatMap(([y, a, b]) => [[a + 0.5, y + 0.5], [b + 0.5, y + 0.5]]).map(([x, y]) => [x - img.w / 2, img.h / 2 - y]));
}
/** The middle of the pixels `is` picks, px, or none when it picks none. */
function middle(img, is) {
  let [sx, sy, n] = [0, 0, 0];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * img.n;
    if (is(img.px[i], img.px[i + 1], img.px[i + 2])) { sx += x + 0.5; sy += y + 0.5; n++; }
  }
  return n ? [sx / n - img.w / 2, img.h / 2 - sy / n] : null;
}

const fixtures = new Map(physics([{ call: 'behavior_fixtures' }])[0].fixtures.map((f) => [f.name, f]));
const LOW = [0, -0.75, 0];
const BOX = { at: [-0.9, 0.9], width: 7, seconds: 3, fps: 30, label: [-0.9, 3.1] };
const BAR = { at: [0, 1.42], width: 1.8, seconds: 4, fps: 60, label: [0, 0.84] };
/** A box's run: its plumb line hangs from where its weight starts, over the box, down into the slope's slab. */
const boxRun = (name, fixture, centre, label) => {
  const world = fixtures.get(fixture).world;
  const { pos, rot } = world.bodies.box.pose;
  const [s, c] = [Math.sin(rot[2] / DEG), Math.cos(rot[2] / DEG)];
  const above = world.shapes.box.half[1] + centre[1] + world.shapes.slope.half[1];
  return { name, fixture, world, id: 'box', centre, view: BOX, label,
    hang: { from: [pos[0] + centre[0] * c - centre[1] * s, pos[1] + centre[0] * s + centre[1] * c], drop: above / c, front: true } };
};
/** A bar's run: its line hangs from the hinge, behind the bar. */
const barRun = (name, fixture, centre, label) => {
  const world = fixtures.get(fixture).world;
  return { name, fixture, world, id: 'bar', centre, view: BAR, label, hang: { from: world.joints.pin.frame_a.anchor, drop: 1.1, front: false } };
};
/** The runs view3d bakes and draws: the kit's six fixtures of this issue. */
const LIVE = [
  boxRun('box-20', 'box_slope_20', [0, 0, 0], '20° slope, no centre_of_mass'),
  boxRun('box-33', 'box_slope_33', [0, 0, 0], '33° slope, no centre_of_mass'),
  boxRun('box-33-centre', 'box_slope_33_centre', LOW, '33° slope, centre_of_mass [0, -0.75, 0]'),
  boxRun('box-45-centre', 'box_slope_45_centre', LOW, '45° slope, centre_of_mass [0, -0.75, 0]'),
  barRun('bar', 'bar_period', [0, 0, 0], 'no centre_of_mass'),
  barRun('bar-centre', 'bar_period_centre', [0, -0.25, 0], 'centre_of_mass [0, -0.25, 0]'),
];
// What a frame may be off its bake by: a pixel in place, a pixel and a half in size, half a degree in turn.
const ROOM = { px: 1, size: 1.5, deg: 0.5 };

const work = mkdtempSync(join(tmpdir(), 'deep-2240-shoot-'));
const written = [];
const save = (name, bytes) => {
  writeFileSync(join(HERE, name), bytes);
  written.push(`${name}  ${sha(bytes)}`);
};
const failures = [];
try {
  // The bakes the frames are held to, a state a step.
  const baked = physics(LIVE.map((r) => ({ call: 'bake', world: r.world, steps: r.view.seconds * HZ, frame_rate: `${HZ}/1`, read: [r.id] })));
  // The planted programs' own bakes of the 33° slope with the field: the wrapper that ignores the field, and the pose
  // output that reads the centre of mass.
  const slope = fixtures.get('box_slope_33_centre').world;
  const [ignored] = physics([{ call: 'bake', world: slope, steps: 360, frame_rate: `${HZ}/1`, read: ['box'] }], 'centre_of_mass_ignored');
  const [sunk] = physics([{ call: 'bake', world: { ...slope, outputs: { box_pose: { from: 'box', read: 'pose' } } }, steps: 360, frame_rate: `${HZ}/1`, read: ['box'] }], 'pose_reads_centre_of_mass');
  const pose = (s) => ({ pos: s.pos, rot: euler(s.rot) });
  const POSED = [
    { ...boxRun('planted-ignored', 'box_slope_33_centre', LOW, 'planted centre_of_mass_ignored'), posed: pose(ignored.bodies.box[360]) },
    { ...boxRun('planted-pose', 'box_slope_33_centre', LOW, 'planted pose_reads_centre_of_mass'), posed: pose(sunk.outputs.series.box_pose[360]), ghosts: [pose(sunk.bodies.box[360])] },
  ];
  const docs = [...LIVE.map((r) => ({ ...r, live: true, frames: r.view.seconds * r.view.fps + 1 })), ...POSED.map((r) => ({ ...r, live: false, frames: 1 }))];
  const calls = docs.map((d) => {
    const path = join(work, `${d.name}.json`);
    writeFileSync(path, JSON.stringify(scene(d.name, d)));
    return { call: 'view3d', look: LOOK, doc: path, size: [W, H], fps: d.view.fps, from: 0, frames: d.frames, capture: 'every', targets: ['final'] };
  });
  const [answer] = lines(bin('deep-gpu'), ['run'], [{ out: work, calls }]);
  if (!answer.ok) throw Error(`deep-gpu run: ${JSON.stringify(answer).slice(0, 2000)}`);
  const frames = new Map(docs.map((d, i) => {
    const got = answer.replies[i].frames?.map((f) => f.final);
    if (!got || got.length !== d.frames || got.some((h) => typeof h !== 'string')) throw Error(`${d.name}: ${JSON.stringify(answer.replies[i]).slice(0, 1200)}`);
    mkdirSync(join(work, d.name));
    got.forEach((hash, k) => copyFileSync(join(work, `${hash}.png`), join(work, d.name, `${String(k).padStart(4, '0')}.png`)));
    return [d.name, got.map((hash) => join(work, `${hash}.png`))];
  }));

  // What view3d drew: each frame's body as a rectangle, and its disc's middle.
  const drawn = new Map(LIVE.map((r) => [r.name, frames.get(r.name).map((path, k) => {
    const img = pixels(path);
    const [body, disc] = [outline(img, isSand), middle(img, isTeal)];
    if (!body || !disc) throw Error(`${r.name} frame ${k}: ${body ? 'no disc drawn' : 'no body drawn whole'}`);
    return { body, disc };
  })]));
  /**
   * The most a run's frames are off `states`, a body's state a step, each seen by the run's camera: the box shape's
   * eight corners about the body's origin, where a pose output puts the item, and the disc at the local point the
   * weight acts at.
   */
  const offBy = (r, states) => {
    const scale = W / r.view.width;
    const half = r.world.shapes[r.world.bodies[r.id].shapes[0].shape].half;
    const off = { place: 0, turn: 0, size: 0, disc: 0 };
    drawn.get(r.name).forEach(({ body, disc }, k) => {
      const s = states[(k * HZ) / r.view.fps];
      const onFrame = (local) => spin(s.rot, local).slice(0, 2).map((c, j) => (c + s.pos[j] - r.view.at[j]) * scale);
      const want = rectangle([-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => onFrame([x * half[0], y * half[1], z * half[2]])))));
      const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      off.place = Math.max(off.place, gap(body.at, want.at));
      off.turn = Math.max(off.turn, Math.abs(apart(body.turn, want.turn)));
      off.size = Math.max(off.size, Math.abs(body.long - want.long), Math.abs(body.short - want.short));
      off.disc = Math.max(off.disc, gap(disc, onFrame([r.centre[0], r.centre[1], half[2] + DISC])));
    });
    return off;
  };
  const within = (off) => off.place <= ROOM.px && off.disc <= ROOM.px && off.size <= ROOM.size && off.turn <= ROOM.deg;
  const rounded = (off) => Object.fromEntries(Object.entries(off).map(([k, v]) => [k, +v.toFixed(2)]));
  const mostTurned = (states) => Math.max(...states.map((s) => turnBetween(states[0].rot, s.rot)));

  // The check: every frame of every live run against its bake's state at that frame's step.
  const runs = LIVE.map((r, i) => {
    const states = baked[i].bodies[r.id];
    const off = offBy(r, states);
    if (!within(off)) failures.push(`${r.name}: a frame is off its bake: ${JSON.stringify(rounded(off))}`);
    const f = fixtures.get(r.fixture);
    const bodies = drawn.get(r.name).map((d) => d.body);
    const row = { run: r.name, fixture: r.fixture, frames: bodies.length, 'a px, mm': +(1000 * r.view.width / W).toFixed(1), 'off the bake, most (px, deg)': rounded(off), measure: f.measure, answer: +f.answer.toFixed(4) };
    if (r.id === 'box') {
      // The kit's measure, from the frames alone: the most the drawn long axis turned from frame 0, followed frame to
      // frame. The kit's own reads the whole turn, the bake's rotation against how the body was built.
      let [turned, most] = [0, 0];
      for (let k = 1; k < bodies.length; k++) {
        turned += apart(bodies[k].turn, bodies[k - 1].turn);
        most = Math.max(most, Math.abs(turned));
      }
      Object.assign(row, { 'from the frames': +most.toFixed(2), 'from the bake': +mostTurned(states).toFixed(4) });
      // The kit's fixture that topples answers 45°, to be passed; the others answer 0°, to be held within their room.
      const past = f.answer > 0;
      if (past ? most <= f.answer : most >= f.tolerance.deg) failures.push(`${r.name}: the drawn box turned ${most.toFixed(2)}°, not ${past ? `past ${f.answer}` : `under ${f.tolerance.deg}`}°`);
    } else {
      // The kit's measure, from the frames alone: the time between the first two times the drawn middle falls through
      // the hinge's x, and the same from the bake's states.
      const period = (xs, rate) => {
        const falls = [];
        for (let k = 1; k < xs.length; k++) if (xs[k - 1] > 0 && xs[k] <= 0) falls.push((k - 1 + xs[k - 1] / (xs[k - 1] - xs[k])) / rate);
        return falls[1] - falls[0];
      };
      const hinge = (r.hang.from[0] - r.view.at[0]) * W / r.view.width;
      const [seen, bake] = [period(bodies.map((b) => b.at[0] - hinge), r.view.fps), period(states.map((s) => s.pos[0] - r.hang.from[0]), HZ)];
      Object.assign(row, { 'from the frames': +seen.toFixed(4), 'from the bake': +bake.toFixed(4) });
      if (!(Math.abs(seen - f.answer) <= f.tolerance.relative * f.answer)) failures.push(`${r.name}: the drawn bar's period is ${seen.toFixed(4)} s, not within ${f.tolerance.relative * 100}% of ${f.answer.toFixed(4)} s`);
    }
    return row;
  });
  // The check on wrong programs: the same frames held to a bake that isn't theirs must read off it.
  const run = (name) => LIVE.find((r) => r.name === name);
  const wrong = {
    'box-33-centre held to the planted centre_of_mass_ignored bake': offBy(run('box-33-centre'), ignored.bodies.box),
    'bar-centre held to the bake with no centre_of_mass': offBy(run('bar-centre'), baked[LIVE.indexOf(run('bar'))].bodies.bar),
  };
  for (const [name, off] of Object.entries(wrong)) if (within(off)) failures.push(`${name}: the check read the frames as on it`);
  // The planted programs' pictures, as their bakes read: the most the ignoring wrapper's box turned, and how far from
  // the body the planted output wrote its place.
  const end = sunk.bodies.box[360], wrote = sunk.outputs.series.box_pose[360];
  const planted = {
    'centre_of_mass_ignored: the most the box turned, deg': +mostTurned(ignored.bodies.box).toFixed(2),
    'pose_reads_centre_of_mass: the output wrote the box this far from its origin, m': +Math.hypot(...wrote.pos.map((c, j) => c - end.pos[j])).toFixed(4),
  };

  // The files: one sheet of stills, and the frames played unchanged.
  const still = (name, k) => frames.get(name).at(k);
  const sheet = [still('box-20', -1), still('box-33', -1), still('box-33-centre', -1), still('box-45-centre', -1), still('planted-ignored', 0), still('planted-pose', 0), still('bar', 0), still('bar-centre', 0)];
  const grid = (cols, n) => Array.from({ length: n }, (_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
  ffmpeg([...sheet.flatMap((p) => ['-i', p]), '-filter_complex', `xstack=inputs=8:layout=${grid(4, 8)}`, '-frames:v', '1', join(work, 'stills.png')]);
  save('stills.png', readFileSync(join(work, 'stills.png')));
  const film = (file, names, cols, fps) => {
    ffmpeg([...names.flatMap((n) => ['-framerate', String(fps), '-i', join(work, n, '%04d.png')]), '-filter_complex', `xstack=inputs=${names.length}:layout=${grid(cols, names.length)}`,
      '-plays', '0', '-f', 'apng', join(work, file)]);
    save(file, readFileSync(join(work, file)));
  };
  film('box.apng', ['box-20', 'box-33', 'box-33-centre', 'box-45-centre'], 2, BOX.fps);
  film('bar.apng', ['bar', 'bar-centre'], 2, BAR.fps);
  const read = { room: ROOM, runs, 'held to a wrong bake, most (px, deg)': Object.fromEntries(Object.entries(wrong).map(([k, v]) => [k, rounded(v)])), planted, failures };
  save('check.json', `${JSON.stringify(read, null, 1)}\n`);
  console.log(JSON.stringify(read, null, 1));
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const line of written) console.log(line);
if (failures.length) {
  console.error(`FAIL shoot: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`PASS shoot: ${LIVE.length} runs' frames are on their bakes and their measures on the kit's answers; held to a wrong bake they read off it`);
