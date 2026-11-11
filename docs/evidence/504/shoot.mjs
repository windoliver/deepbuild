// Draws the #504 taste pictures from the canvas's own frames through `deep-show run`: the projectile board at its
// launch, top and landing stages (each a stage's set and shot, its readouts showing the sliders' values and the range
// the drivers compute), the box figure taken apart and its take-apart played back, a stage gliding from one framed
// pose to the next on input-track entries, and the case recoloured by each pick of a view-class variant choice.
// Writes projectile-board.png, take-apart.png, recoloured-case.png, stage-glide.apng and take-apart.apng beside itself
// and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FLICKS = 705_600_000;
const fl = (s) => Math.round(s * FLICKS);
const evidence = mkdtempSync(join(tmpdir(), 'deep-504-shoot-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stored = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const ulid = (n) => `01JB504S${String(n).padStart(18, '0')}`;

const doc = (id, profile, size, items, extra) => ({
  format: 1, id, profile, title: `#504 ${id}`, description: `The #504 taste picture's ${id}.`, size, camera: 'cam',
  items: Object.fromEntries(items.map((i, k) => [i.id, { name: i.id, order: `a${String(k).padStart(3, '0')}`, ...i }])), ...extra,
});
const box = (id, pos, size, role, extra = {}) => ({ id, kind: 'mark.box@1', role: 'part', params: { size, paint: { fill: { role } } }, at: { pos }, ...extra });
const rect = (id, b, role, extra = {}) => ({ id, kind: 'rect@1', role: 'part', params: { box: b, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra });
const text = (id, pos, template) => ({ id, kind: 'text@1', role: 'data', params: { template, font: 'body', size: 18, box: { w: 320, h: 24 } }, at: { pos: [...pos, 0] } });

// ---- The projectile board: 2D, 20 u to the metre, the launch point at (60, 480).
function board(stage) {
  const vars = { a: 'controls/angle/value', v: 'controls/speed/value', p: 'data/phase' };
  const tau = '(p * 2 * v * sin(a * pi / 180) / 9.81)';
  const shots = { 'at-launch': [200, 400, 480], 'at-top': [480, 270, 960], 'at-landing': [700, 420, 640] };
  const phase = { launch: 0, top: 0.5, landing: 1 };
  const stages = Object.fromEntries(Object.keys(phase).map((s) => [s, { label: s[0].toUpperCase() + s.slice(1), shot: `at-${s}`, set: { 'data/phase': phase[s] } }]));
  // The flight's path as dots at tenths of the flight, each placed by the same closed form.
  const dots = Array.from({ length: 11 }, (_, k) => rect(`dot-${k}`, [-2, -2, 4, 4], 'muted'));
  const dotDrivers = Object.fromEntries(dots.flatMap((d, k) => {
    const t = `(${k / 10} * 2 * v * sin(a * pi / 180) / 9.81)`;
    return [
      [`${d.id}-x`, { target: `items/${d.id}/at/pos/0`, expr: `60 + 20 * v * cos(a * pi / 180) * ${t}`, vars: { a: vars.a, v: vars.v } }],
      [`${d.id}-y`, { target: `items/${d.id}/at/pos/1`, expr: `480 - 20 * (v * sin(a * pi / 180) * ${t} - 4.905 * ${t} * ${t})`, vars: { a: vars.a, v: vars.v } }],
    ];
  }));
  return doc('projectile-board', 'figure', [960, 540], [
    { id: 'cam', kind: 'camera@1', params: { projection: 'orthographic', target: [480, 270, 0], view_width: 960 } },
    rect('ground', [0, 480, 960, 60], 'muted'), rect('cannon', [40, 464, 40, 16], 'ink'), ...dots,
    rect('ball', [-8, -8, 16, 16], 'accent', { at: { pos: [60, 480, 0] } }),
    text('angle-readout', [40, 30], 'Angle {controls/angle/value}°'), text('speed-readout', [40, 60], 'Speed {controls/speed/value} m/s'),
    text('range-readout', [40, 90], 'Range {data/range} m'),
  ], {
    requires: { modules: { motion: '^1', input: '^1' } }, transport: { span: '4s', frame_rate: [12, 1] },
    data: { phase: 0, range: 0 },
    controls: {
      angle: { kind: 'slider', class: 'document', label: 'Angle', role: 'slider', range: [15, 75], default: 45, increment: 1 },
      speed: { kind: 'slider', class: 'document', label: 'Speed', role: 'slider', range: [5, 25], default: 15, increment: 0.5 },
      stage: { kind: 'stages', class: 'document', label: 'Flight', role: 'group', default: stage, stages },
    },
    shots: Object.fromEntries(Object.entries(shots).map(([id, [x, y, w]]) => [id, { camera: 'cam', move: 'hold', target: [x, y, 0], view_width: w }])),
    drivers: {
      x: { target: 'items/ball/at/pos/0', expr: `60 + 20 * v * cos(a * pi / 180) * ${tau}`, vars },
      y: { target: 'items/ball/at/pos/1', expr: `480 - 20 * (v * sin(a * pi / 180) * ${tau} - 4.905 * ${tau} * ${tau})`, vars },
      range: { target: 'data/range', expr: 'round(v * v * sin(2 * a * pi / 180) / 9.81 * 100) / 100', vars: { a: vars.a, v: vars.v } },
      ...dotDrivers,
    },
  });
}

// ---- The box figure: four assemblies in a chain, taken apart at 1 s and back at 4 s, with its card.
const PARTS = { plate: ['base', [0, 0.025, 0], [0.6, 0.05, 0.4], 'muted'], shell: ['body', [0, 0.15, 0], [0.4, 0.2, 0.3], 'accent'],
  cover: ['lid', [0, 0.27, 0], [0.42, 0.04, 0.32], 'ink'], cap: ['knob', [0, 0.31, 0], [0.06, 0.04, 0.06], 'session_readout'] };
const boxFigure = () => doc('box-figure', 'figure', [960, 540], [
  { id: 'cam', kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.45, 0], orbit: { azimuth: 30, elevation: 20, distance: 3.2 }, fov: 40 } },
  ...Object.entries(PARTS).map(([id, [a, pos, size, role]]) => box(id, pos, size, role, { parent: a })),
], {
  requires: { modules: { scene3d: '^1', motion: '^1', input: '^1' } }, transport: { span: '6s', frame_rate: [12, 1] },
  assemblies: {
    base: { parent: null, at: { pos: [0, 0, 0] }, apart: [0, 0, 0], order: 0, value: 0 },
    body: { parent: 'base', at: { pos: [0, 0, 0] }, apart: [0, 0.3, 0], order: 1, value: 0, motion: { kind: 'slide', axis: [0, 1, 0], range: [0, 0.2] } },
    lid: { parent: 'body', at: { pos: [0, 0, 0] }, apart: [0, 0.3, 0], order: 2, value: 0 },
    knob: { parent: 'lid', at: { pos: [0, 0, 0] }, apart: [0.25, 0, 0], order: 3, value: 0 },
  },
  controls: { lift: { kind: 'slider', class: 'document', label: 'Lift', role: 'slider', range: [0, 0.2], default: 0.05, increment: 0.005 } },
  drivers: { raise: { target: 'assemblies/body/value', expr: 's', vars: { s: 'controls/lift/value' } } },
  channels: { take: { target: 'assemblies/apart', type: 'f32', mode: 'follow', follow: {
    source: { keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '1s', value: 1, interp: 'hold' }, k2: { t: '4s', value: 0, interp: 'hold' } } },
    model: { transition: { span: '0.5s', interp: 'linear' } }, stagger: { targets: ['body', 'lid', 'knob'], lag: '0.25s', order: 'index' } } } },
  card: { fig: 'Fig. 1', title: 'A box that opens', hint: 'Drag Lift, then watch it come apart', readout: 'Lift {assemblies/body/value} m' },
});

// ---- The stage tour: a stages control whose shots hold explicit poses; close glides in, snap cuts.
const POSES = { start: [[0, 0.5, 0], 0, 15, 6], mid: [[0.5, 0.6, 0], 50, 20, 5], close: [[1, 0.4, 0], -40, 25, 3], snap: [[-1, 0.6, 0.5], 70, 10, 4, 'cut'] };
const tour = () => doc('stage-tour', 'figure', [960, 540], [
  { id: 'cam', kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 120, elevation: 40, distance: 9 }, fov: 40 } },
  box('floor', [0, -0.05, 0], [6, 0.1, 6], 'muted'), box('crate', [1, 0.4, 0], [0.8, 0.8, 0.8], 'accent'), box('lamp', [-1, 0.6, 0.5], [0.3, 1.2, 0.3], 'ink'),
], {
  requires: { modules: { scene3d: '^1', motion: '^1', input: '^1' } }, transport: { span: '8s', frame_rate: [24, 1] },
  controls: { tour: { kind: 'stages', class: 'document', label: 'Tour', role: 'group', default: 'start',
    stages: Object.fromEntries(Object.keys(POSES).map((s) => [s, { label: s, shot: `${s}-shot` }])) } },
  shots: Object.fromEntries(Object.entries(POSES).map(([s, [target, azimuth, elevation, distance, join]]) =>
    [`${s}-shot`, { camera: 'cam', move: 'hold', target, orbit: { azimuth, elevation, distance }, ...(join ? { join } : {}) }])),
});

// ---- The product: the case recoloured by a view-class choice on a variant set.
const product = () => doc('product', 'figure', [320, 180], [
  { id: 'cam', kind: 'camera@1', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
  rect('case', [100, 40, 120, 100], 'muted'),
], {
  requires: { modules: { input: '^1' } }, transport: { span: '8s', frame_rate: [12, 1] },
  variants: { finish: { options: [['lagoon', 'accent'], ['orchid', 'session_readout'], ['graphite', 'ink']].map(([name, role]) =>
    ({ name, label: name[0].toUpperCase() + name.slice(1), patch: [{ op: 'set', id: 'case', path: 'items/case/params/paint/fill', value: { role } }] })) } },
  controls: { finish: { kind: 'choice', class: 'view', label: 'Finish', role: 'radiogroup', variant: 'finish', options: ['lagoon', 'orchid', 'graphite'] } },
});

const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }];
const present = (id, document, at) => ({ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc: id, document, ...(at === undefined ? {} : { at }) });
function run(docs, rect, calls, clock) {
  const scenario = { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])), ...(clock ? { clock } : {}), calls };
  const r = spawnSync(join(REPO, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== ''));
  if (!answer.ok) throw Error(`deep-show refused: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  for (const reply of answer.replies) if (reply.outcome === 'refused') throw Error(`a call was refused: ${JSON.stringify(reply).slice(0, 800)}`);
  return answer.replies;
}

// ---- PNG: decode 8-bit RGB/RGBA, tile side by side, encode RGBA; and an animated PNG of unchanged frames.
function decode(file) {
  let p = 8; let w = 0; let h = 0; let color = 0; const data = [];
  while (p < file.length) {
    const n = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); color = body[9]; } else if (type === 'IDAT') data.push(body);
    p += 12 + n;
  }
  const ch = color === 6 ? 4 : 3; const stride = w * ch; const raw = inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0; const b = prev[i]; const c = i >= ch ? prev[i - ch] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (f === 0 ? line[i] : f === 1 ? line[i] + a : f === 2 ? line[i] + b : f === 3 ? line[i] + ((a + b) >> 1) : line[i] + paeth) & 255;
    }
    for (let x = 0; x < w; x++) { for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = line[x * ch + k]; out[(y * w + x) * 4 + 3] = ch === 4 ? line[x * ch + 3] : 255; }
    prev = line;
  }
  return { w, h, rgba: out };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The pictures side by side, 8 px apart on the first picture's top-left color. */
function tile(pngs) {
  const imgs = pngs.map(decode); const gap = 8;
  const w = imgs.reduce((s, i) => s + i.w, 0) + gap * (imgs.length - 1); const h = Math.max(...imgs.map((i) => i.h));
  const out = Buffer.alloc(w * h * 4); const ground = imgs[0].rgba.subarray(0, 4);
  for (let p = 0; p < w * h; p++) ground.copy(out, p * 4);
  let x0 = 0;
  for (const img of imgs) { for (let y = 0; y < img.h; y++) img.rgba.copy(out, (y * w + x0) * 4, y * img.w * 4, (y + 1) * img.w * 4); x0 += img.w + gap; }
  const rows = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) out.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function parts(png) {
  let p = 8; const idat = []; let ihdr;
  while (p < png.length) {
    const n = png.readUInt32BE(p); const type = png.toString('latin1', p + 4, p + 8); const data = png.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') ihdr = data; if (type === 'IDAT') idat.push(data);
    p += 12 + n;
  }
  return { ihdr, data: Buffer.concat(idat) };
}
/** An animated PNG of the renderer's frames, their bytes unchanged but for their chunk names. */
function apng(list, fps) {
  const first = parts(list[0]);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(list.length);
  const out = [SIGNATURE, chunk('IHDR', first.ihdr), chunk('acTL', actl)];
  let seq = 0;
  list.forEach((f, i) => {
    const { ihdr, data } = parts(f);
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); ihdr.copy(fctl, 4, 0, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    out.push(chunk('fcTL', fctl));
    if (i === 0) out.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); out.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

// The board at each stage, a frame of each stage's own document (the stage its default).
const stills = ['launch', 'top', 'landing'].map((s, k) => {
  const r = run([ulid(10 + k)], [0, 0, 960, 540], [present(ulid(10 + k), board(s)), { call: 'eval', doc: ulid(10 + k), t: fl(0.5), pixels: true }]);
  return stored(r[1].snapshots[0].sha256);
});

// The box figure: 12 fps from 0.5 to 5.5 s through the 3D frame path; the still at 2.5 s, taken apart.
const FPS = 12;
const boxTimes = Array.from({ length: 5 * FPS + 1 }, (_, k) => fl(0.5 + k / FPS));
const boxRun = run([ulid(20)], [0, 0, 960, 540], [present(ulid(20), boxFigure()), { call: 'determinism', doc: ulid(20), display_hz: FPS, play: 'cold', at_times: boxTimes }]);
const boxFrames = boxRun[1].frames.map((f) => stored(f.play.pixels));

// The stage tour on the scenario's clock: mid at 1 s, close at 2 s, snap at 3.5 s, each an input on its own control.
const CLOCK = { refresh_hz: 60, lead: 0, check: 0 };
const pick = (value, s) => ({ call: 'input', panel: 'main', event: { type: 'control', control: 'tour', value }, at: fl(s) });
const GLIDE_FPS = 24;
const glideTimes = Array.from({ length: Math.round(3.5 * GLIDE_FPS) + 1 }, (_, k) => fl(0.75 + k / GLIDE_FPS));
const glideRun = run([ulid(30)], [0, 0, 960, 540], [present(ulid(30), tour(), fl(0.5)), pick('mid', 1), pick('close', 2), pick('snap', 3.5),
  { call: 'determinism', doc: ulid(30), display_hz: GLIDE_FPS, play: 'cold', at_times: glideTimes, at: fl(3.6) }], CLOCK);
const glideFrames = glideRun[4].frames.map((f) => stored(f.play.pixels));

// The case before any pick and after each, as the panel's view draws it.
const caseCalls = [present(ulid(40), product()), { call: 'view', panel: 'main' }];
for (const value of ['lagoon', 'orchid', 'graphite']) caseCalls.push({ call: 'input', panel: 'main', event: { type: 'control', control: 'finish', value } }, { call: 'view', panel: 'main' });
const caseRun = run([ulid(40)], [0, 0, 320, 180], caseCalls);
const cases = [1, 3, 5, 7].map((k) => stored(caseRun[k].snapshot.sha256));

const pictures = {
  'projectile-board.png': tile(stills),
  'take-apart.png': boxFrames[2 * FPS],
  'recoloured-case.png': tile(cases),
  'stage-glide.apng': apng(glideFrames, GLIDE_FPS),
  'take-apart.apng': apng(boxFrames, FPS),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
