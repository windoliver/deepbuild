#!/usr/bin/env node
// Draws the clip #1186's test camera plays in place of a camera (#3347): one right hand, its palm to the camera, held
// open, then closed to a fist, then pinching, for 20 s at 30 frames a second, with a 64 × 64 px block of four colors in
// the top-left corner, which #1186's leak scan searches for. Nobody was recorded. The hand is 21 synthetic points, in
// hands@1's order, posed by joint angles, and the canvas draws it from paths on the CPU, whose pixels are the same on
// every machine. The film is written here, as Motion JPEG in a QuickTime movie, in integer arithmetic, so no platform's
// encoder is in it and the same script gives the same bytes anywhere.
//
//   tests/fixtures/hands@1/open-fist-pinch.mjs <out.mov>
//
// It draws with target/debug/deep-show, or CARGO_TARGET_DIR's, and is BLOCKED when that isn't built.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [W, H, FPS, FRAMES] = [1280, 720, 30, 600];

// The hand: 21 points in units of the wrist-to-middle-knuckle length, y up and z toward the camera, for weights of the
// three poses [open, fist, pinch]. Math.sin's last bit may differ between machines, so the series is summed here.
const turn = 2 * Math.PI;
const sin = (angle) => {
  const a = angle - turn * Math.round(angle / turn);
  let sum = a;
  for (let n = 1, term = a; n < 14; n++) sum += term *= (-a * a) / (2 * n * (2 * n + 1));
  return sum;
};
const cos = (angle) => sin(angle + turn / 4);
const degrees = turn / 360;
// Index to pinky: the knuckle, its three bones, its radius, and per pose its spread and the bend at each of its joints.
const fingers = [
  { at: 5, knuckle: [0.28, 0.98], bones: [0.45, 0.27, 0.22], radius: 0.108, spread: [8, 2, 5], bend: [[4, 4, 2], [82, 100, 62], [42, 52, 30]] },
  { at: 9, knuckle: [0.03, 1.02], bones: [0.5, 0.31, 0.24], radius: 0.112, spread: [1, 0, 0], bend: [[3, 3, 2], [85, 100, 65], [12, 18, 10]] },
  { at: 13, knuckle: [-0.2, 0.96], bones: [0.46, 0.29, 0.23], radius: 0.105, spread: [-7, -2, -6], bend: [[3, 4, 2], [87, 100, 65], [10, 16, 10]] },
  { at: 17, knuckle: [-0.4, 0.85], bones: [0.36, 0.21, 0.19], radius: 0.09, spread: [-17, -6, -14], bend: [[4, 4, 2], [88, 98, 62], [10, 16, 10]] },
];
const thumb = [
  [[0.26, 0.2, 0.06], [0.56, 0.46, 0.12], [0.78, 0.72, 0.16], [0.94, 0.93, 0.18]],
  [[0.26, 0.2, 0.1], [0.46, 0.52, 0.26], [0.34, 0.76, 0.5], [0.06, 0.74, 0.56]],
  [[0.26, 0.2, 0.1], [0.5, 0.46, 0.26], [0.56, 0.78, 0.5], [0.4, 1.1, 0.74]],
];
function points(weights) {
  const mix = (values) => values.reduce((sum, value, pose) => sum + value * weights[pose], 0);
  const out = [[0, 0, 0]];
  for (let k = 0; k < 4; k++) out[1 + k] = [0, 1, 2].map((axis) => mix(thumb.map((pose) => pose[k][axis])));
  for (const { at, knuckle, bones, spread, bend } of fingers) {
    const side = mix(spread) * degrees;
    let angle = 0, p = [...knuckle, 0];
    out[at] = p;
    bones.forEach((length, k) => {
      angle += mix(bend.map((pose) => pose[k])) * degrees;
      p = [p[0] + length * cos(angle) * sin(side), p[1] + length * cos(angle) * cos(side), p[2] + length * sin(angle)];
      out[at + k + 1] = p;
    });
  }
  return out;
}

// Open to 6 s, a fist from 7 s to 13 s, a pinch from 14 s, swaying once a second all through.
const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const pose = (frame) => {
  const closed = ease(frame / FPS - 6), pinched = ease(frame / FPS - 13);
  return [1 - closed, closed * (1 - pinched), pinched];
};
const sway = (frame) => [14 * sin((turn * frame) / FPS), 8 * sin((2 * turn * frame) / FPS)];
// A frame whose pose and sway were drawn before is that drawing again.
const same = (frame) => JSON.stringify([pose(frame), frame % FPS]);

// The drawing: each bone and the palm as nested shapes, darker at the rim and lighter toward the light.
const LAYERS = 6;
const tone = (t) => [[168, 116, 93], [214, 160, 130], [246, 208, 182]].slice(t < 0.5 ? 0 : 1, t < 0.5 ? 2 : 3)
  .reduce((low, high) => low.map((value, i) => Math.round(value + (high[i] - value) * (t < 0.5 ? t * 2 : t * 2 - 1))));
const hex = (color) => `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
const colors = {
  wall: '#c3ccd1', mark0: '#d81e1e', mark1: '#1e9a3c', mark2: '#1e46d8', mark3: '#f0d21e',
  ...Object.fromEntries(Array.from({ length: LAYERS }, (_, n) => [`skin${n}`, hex(tone(0.05 + (0.9 * n) / (LAYERS - 1)))])),
};
const clean = JSON.parse(readFileSync(join(root, 'crates/deep-canvas-marks/looks/clean.json'), 'utf8'));
const look = JSON.stringify({
  ...clean, id: 'hands', description: 'The clean look with a drawn hand\'s skin tones, a wall and the corner block\'s four colors.',
  palette: { ...clean.palette, ...colors }, roles: { ...clean.roles, ...Object.fromEntries(Object.keys(colors).map((name) => [name, name])) },
});
const n2 = (value) => String(Number(value.toFixed(2)));
const at = ([x, y]) => `${n2(x)} ${n2(y)}`;
const UNIT = H / 3.3, ARC = 0.5522847498;
function items(frame) {
  const hand = points(pose(frame)), [dx, dy] = sway(frame), out = [], shapes = [];
  const screen = ([x, y, z = 0]) => { const near = 7 / (7 - z); return [W / 2 + dx + x * near * UNIT, H / 2 + dy - (y - 0.75) * near * UNIT, near]; };
  const rect = (box, role) => out.push({ kind: 'rect@1', params: { box, paint: { fill: { role } } } });
  const path = (d, role) => out.push({ kind: 'path@1', params: { d, paint: { fill: { role } } } });
  rect([0, 0, W, H], 'wall');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) rect([x * 16, y * 16, 16, 16], `mark${(x + 2 * y + ((x * y) % 3)) % 4}`);
  // A bone: a tapered tube with round ends.
  const tube = (depth, from, to, radiusFrom, radiusTo) => {
    const [a, b] = [screen(from), screen(to)], length = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) || 1;
    const along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    shapes.push([depth, (n) => {
      const t = n / (LAYERS - 1), shift = 0.35 * t * Math.min(radiusFrom, radiusTo) * UNIT;
      const end = (c, r) => (across, ahead) => at([c[0] - shift + r * (across * -along[1] + ahead * along[0]), c[1] - shift + r * (across * along[0] + ahead * along[1])]);
      const [A, B] = [end(a, radiusFrom * UNIT * a[2] * (1 - 0.8 * t)), end(b, radiusTo * UNIT * b[2] * (1 - 0.8 * t))];
      const cap = (P, s) => `C ${P(s, s * ARC)} ${P(s * ARC, s)} ${P(0, s)} C ${P(-s * ARC, s)} ${P(-s, s * ARC)} ${P(-s, 0)}`;
      path(`M ${A(1, 0)} L ${B(1, 0)} ${cap(B, 1)} L ${A(-1, 0)} ${cap(A, -1)} Z`, `skin${n}`);
    }]);
  };
  tube(0, [0, -2.4, 0], [0, 0.1, 0], 0.38, 0.27);
  const palm = [[-0.2, -0.16], [0.2, -0.16], [0.4, 0.3], [0.44, 0.7], [0.42, 1.12], [0.03, 1.2], [-0.22, 1.14], [-0.52, 0.98], [-0.52, 0.5], [-0.36, 0.1]].map(screen);
  const middle = [0, 1].map((axis) => palm.reduce((sum, p) => sum + p[axis], 0) / palm.length);
  shapes.push([0, (n) => {
    const t = n / (LAYERS - 1), corners = palm.map((p) => [0, 1].map((axis) => middle[axis] + (p[axis] - middle[axis]) * (1.12 - 0.25 * t) - 8 * t));
    const between = corners.map((p, k) => { const q = corners[(k + 1) % corners.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
    path(`M ${at(between.at(-1))} ${corners.map((p, k) => `Q ${at(p)} ${at(between[k])}`).join(' ')} Z`, `skin${Math.round(t * 0.7 * (LAYERS - 1))}`);
  }]);
  const depth = (a, b, k) => (hand[a][2] + hand[b][2]) / 2 + 0.001 * (k + 1);
  for (const { at: i, radius } of fingers) for (let k = 0; k < 3; k++) tube(depth(i + k, i + k + 1, k), hand[i + k], hand[i + k + 1], radius * (1.1 - 0.07 * k), radius * (1.03 - 0.07 * k));
  [[0.2, 0.145], [0.14, 0.12], [0.12, 0.09]].forEach(([from, to], k) => tube(depth(1 + k, 2 + k, k), hand[1 + k], hand[2 + k], from, to));
  // What lies in the palm's plane is one shape, drawn layer by layer; a bone that stands off it is drawn whole, far to near.
  shapes.sort((a, b) => a[0] - b[0]);
  for (let n = 0; n < LAYERS; n++) for (const [z, draw] of shapes) if (z < 0.22) draw(n);
  for (const [z, draw] of shapes) if (z >= 0.22) for (let n = 0; n < LAYERS; n++) draw(n);
  return out;
}

// The canvas's frames of `list`, as RGBA: a document each, shown to a fresh deep-show and read from its evidence store.
function drawn(show, list) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-drawn-hand-'));
  try {
    const stored = (sha) => join(evidence, sha.slice(0, 2), sha.slice(2));
    const sha256 = createHash('sha256').update(look).digest('hex');
    mkdirSync(join(evidence, sha256.slice(0, 2)), { recursive: true });
    writeFileSync(stored(sha256), look);
    const ids = list.map((_, k) => `01JB33470D${String(k).padStart(16, '0')}`);
    const camera = { kind: 'camera@1', params: { projection: 'orthographic', target: [W / 2, H / 2, 0], view_width: W } };
    const document = (frame) => ({
      format: 1, profile: 'figure', title: 'A drawn hand', description: 'A drawn hand for the test camera.', size: [W, H], camera: 'cam', transport: { span: '1s' },
      look: { asset: 'hands@1', theme: 'light' }, assets: { hands: { sha256, license: { id: 'Apache-2.0', terms: 'Apache License 2.0.', shareable: true, credit: 'DeepBuild' } } },
      items: Object.fromEntries([camera, ...items(frame)].map((item, k) => { const id = k ? `s${k}` : 'cam'; return [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }]; })),
    });
    const scenario = {
      evidence, sessions: { draw: { thread: 'draw', name: 'draw', process: { pid: 2, start: 1 } } }, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 2, ppid: 1, start: 1 }],
      panels: { main: { rect: [0, 0, W, H] } }, docs: Object.fromEntries(ids.map((id) => [id, { panel: 'main' }])),
      calls: list.map((frame, k) => ({ call: 'deep_show', session: 'draw', doc: ids[k], document: document(frame), include: ['issues', 'pixels'], size: [W, H] })),
    };
    const run = spawnSync(show, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (run.status !== 0) throw Error(`deep-show run: ${run.error?.message ?? run.stderr.slice(-2000)}`);
    return JSON.parse(run.stdout).replies.map((reply, k) => {
      if (reply.outcome !== 'presented') throw Error(`frame ${list[k]} wasn't drawn: ${JSON.stringify(reply.issues).slice(0, 800)}`);
      return rgba(readFileSync(stored(reply.snapshots[0].sha256)));
    });
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
function rgba(png) {
  const data = [];
  for (let i = 8; i < png.length; i += png.readUInt32BE(i) + 12) if (png.toString('latin1', i + 4, i + 8) === 'IDAT') data.push(png.subarray(i + 8, i + 8 + png.readUInt32BE(i)));
  const raw = inflateSync(Buffer.concat(data)), row = W * 4, out = Buffer.alloc(row * H);
  if (png.readUInt32BE(16) !== W || png.readUInt32BE(20) !== H || png[24] !== 8 || png[25] !== 6) throw Error('a frame is not 1280 × 720 RGBA8');
  for (let y = 0, o = 0; y < H; y++) for (let x = 0, filter = raw[y * (row + 1)]; x < row; x++, o++) {
    const a = x < 4 ? 0 : out[o - 4], b = y ? out[o - row] : 0, c = x < 4 || !y ? 0 : out[o - row - 4], p = a + b - c;
    const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
    out[o] = raw[y * (row + 1) + 1 + x] + [0, a, b, (a + b) >> 1, paeth][filter];
  }
  return out;
}

// Baseline JPEG, 4:2:0, one set of Huffman tables for the whole film.
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const quantizer = (table) => table.map((q) => Math.max(1, Math.floor((q * 40 + 50) / 100)));
const LUMA = quantizer([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]);
const CHROMA = quantizer([17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array(32).fill(99)]);
const WAVE = Array.from({ length: 64 }, (_, k) => Math.round(cos(((2 * (k % 8) + 1) * (k >> 3) * Math.PI) / 16) * (k >> 3 ? 1 : Math.SQRT1_2) * 8192));
function coefficients(block, quant) {
  const rows = new Int32Array(64), out = new Int32Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let sum = 0; for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * WAVE[u * 8 + x]; rows[y * 8 + u] = (sum + 1024) >> 11; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let sum = 0; for (let y = 0; y < 8; y++) sum += rows[y * 8 + u] * WAVE[v * 8 + y]; out[v * 8 + u] = sum; }
  return ZIGZAG.map((i) => Math.round(out[i] / (131072 * quant[i])));
}
/** A frame as the symbols its scan codes: table, symbol, extra bits, how many. */
function symbols(px) {
  const out = [], half = W / 2, Y = new Int32Array(W * H), Cb = new Int32Array((W * H) / 4), Cr = new Int32Array((W * H) / 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, [r, g, b] = [px[o], px[o + 1], px[o + 2]], c = (y >> 1) * half + (x >> 1);
    Y[y * W + x] = ((19595 * r + 38470 * g + 7471 * b + 32768) >> 16) - 128;
    Cb[c] += -11059 * r - 21709 * g + 32768 * b;
    Cr[c] += 32768 * r - 27439 * g - 5329 * b;
  }
  for (let c = 0; c < Cb.length; c++) { Cb[c] = (Cb[c] + 131072) >> 18; Cr[c] = (Cr[c] + 131072) >> 18; }
  const dc = [0, 0, 0], block = new Int32Array(64);
  const code = (table, symbol, value, bits) => out.push(table, symbol, value < 0 ? value + (1 << bits) - 1 : value, bits);
  const size = (value) => 32 - Math.clz32(Math.abs(value));
  const emit = (plane, width, left, top, which) => {
    for (let k = 0; k < 64; k++) block[k] = plane[(top + (k >> 3)) * width + left + (k % 8)];
    const c = coefficients(block, which ? CHROMA : LUMA), table = which ? 2 : 0, step = c[0] - dc[which];
    dc[which] = c[0];
    code(table, size(step), step, size(step));
    let zeros = 0;
    for (let i = 1; i < 64; i++) {
      if (!c[i]) { zeros++; continue; }
      for (; zeros > 15; zeros -= 16) code(table + 1, 0xf0, 0, 0);
      code(table + 1, (zeros << 4) | size(c[i]), c[i], size(c[i]));
      zeros = 0;
    }
    if (zeros) code(table + 1, 0, 0, 0);
  };
  for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) {
    for (const [right, down] of [[0, 0], [8, 0], [0, 8], [8, 8]]) emit(Y, W, x + right, y + down, 0);
    emit(Cb, half, x / 2, y / 2, 1);
    emit(Cr, half, x / 2, y / 2, 2);
  }
  return out;
}
/** JPEG's own construction (its Annex K.2) of a Huffman table of at most 16 bits, no code of it all ones. */
function table(counts) {
  const length = new Map([...counts.keys(), -1].map((symbol) => [symbol, 0]));
  const trees = [...counts, [-1, 0]].map(([symbol, count]) => ({ count, held: [symbol] }));
  while (trees.length > 1) {
    trees.sort((a, b) => b.count - a.count || Math.max(...b.held) - Math.max(...a.held));
    const [a, b] = [trees.pop(), trees.pop()], held = [...a.held, ...b.held];
    for (const symbol of held) length.set(symbol, length.get(symbol) + 1);
    trees.push({ count: a.count + b.count, held });
  }
  const bits = Array(33).fill(0);
  for (const n of length.values()) bits[n]++;
  for (let i = 32; i > 16; i--) while (bits[i]) { let j = i - 2; while (!bits[j]) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
  bits[bits.findLastIndex((n) => n > 0)]--;
  const values = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([symbol]) => symbol), codes = new Map();
  for (let n = 1, next = 0, k = 0; n <= 16; n++, next <<= 1) for (let i = 0; i < bits[n]; i++) codes.set(values[k++], [next++, n]);
  return { bits: bits.slice(1, 17), values, codes };
}
const u16 = (...values) => values.flatMap((value) => [(value >> 8) & 255, value & 255]);
function jpeg(scan, tables) {
  const bytes = [];
  let held = 0, filled = 0;
  const put = (value, count) => {
    for (let i = count - 1; i >= 0; i--) {
      held = (held << 1) | ((value >> i) & 1);
      if (++filled < 8) continue;
      bytes.push(held, ...(held === 255 ? [0] : []));
      held = filled = 0;
    }
  };
  for (let i = 0; i < scan.length; i += 4) { put(...tables[scan[i]].codes.get(scan[i + 1])); put(scan[i + 2], scan[i + 3]); }
  while (filled) put(1, 1);
  const segment = (marker, ...body) => [0xff, marker, ...u16(body.length + 2), ...body];
  return Buffer.concat([
    [0xff, 0xd8], segment(0xe0, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0), segment(0xdb, 0, ...ZIGZAG.map((i) => LUMA[i])), segment(0xdb, 1, ...ZIGZAG.map((i) => CHROMA[i])),
    segment(0xc0, 8, ...u16(H, W), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1), ...[0x00, 0x10, 0x01, 0x11].map((id, k) => segment(0xc4, id, ...tables[k].bits, ...tables[k].values)),
    segment(0xda, 3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0), bytes, [0xff, 0xd9],
  ].map((part) => Buffer.from(part)));
}

// A QuickTime movie of one video track; `order` names each frame's sample, so a drawing shown again is stored once.
const u32 = (...values) => Buffer.from(values.flatMap((value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]));
const atom = (type, ...body) => { const bytes = Buffer.concat(body.map((part) => Buffer.from(part, 'latin1'))); return Buffer.concat([u32(bytes.length + 8), Buffer.from(type), bytes]); };
function movie(samples, order) {
  const brand = atom('ftyp', 'qt  ', u32(0), 'qt  '), starts = [], frames = order.length;
  samples.reduce((start, sample) => (starts.push(start), start + sample.length), brand.length + 8);
  const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const handler = (type, subtype) => atom('hdlr', u32(0), type, subtype, u32(0, 0, 0), [0]);
  const picture = atom('jpeg', u32(0), u16(0, 1, 0, 0), 'deep', u32(0, 0x3ff), u16(W, H), u32(0x480000, 0x480000, 0), u16(1), Buffer.alloc(32), u16(24, 0xffff));
  const where = atom('stbl', atom('stsd', u32(0, 1), picture), atom('stts', u32(0, 1, frames, 1)), atom('stsc', u32(0, 1, 1, 1, 1)),
    atom('stsz', u32(0, 0, frames, ...order.map((k) => samples[k].length))), atom('stco', u32(0, frames, ...order.map((k) => starts[k]))));
  const media = atom('minf', atom('vmhd', u32(1), u16(0x40, 0x8000, 0x8000, 0x8000)), handler('dhlr', 'url '), atom('dinf', atom('dref', u32(0, 1), atom('url ', u32(1)))), where);
  const track = atom('trak', atom('tkhd', u32(3, 0, 0, 1, 0, frames, 0, 0), u16(0, 0, 0, 0), matrix, u32(W << 16, H << 16)),
    atom('mdia', atom('mdhd', u32(0, 0, 0, FPS, frames), u16(0, 0)), handler('mhlr', 'vide'), media));
  return Buffer.concat([brand, atom('mdat', ...samples), atom('moov', atom('mvhd', u32(0, 0, 0, FPS, frames, 0x10000), u16(0x100, 0), u32(0, 0), matrix, u32(0, 0, 0, 0, 0, 0, 2)), track)]);
}

const out = process.argv[2];
const show = join(process.env.CARGO_TARGET_DIR ?? join(root, 'target'), 'debug', 'deep-show');
if (!out || !existsSync(show)) {
  console.log(out ? 'BLOCKED deep-show is not built: cargo build --locked --bin deep-show --no-default-features --features full' : 'usage: open-fist-pinch.mjs <out.mov>');
  process.exit(1);
}
const first = new Map();
const order = Array.from({ length: FRAMES }, (_, frame) => { const drawing = same(frame); if (!first.has(drawing)) first.set(drawing, frame); return [...first.keys()].indexOf(drawing); });
const list = [...first.values()], scans = [];
for (let k = 0; k < list.length; k += 50) scans.push(...drawn(show, list.slice(k, k + 50)).map(symbols));
const counts = [new Map(), new Map(), new Map(), new Map()];
for (const scan of scans) for (let i = 0; i < scan.length; i += 4) counts[scan[i]].set(scan[i + 1], (counts[scan[i]].get(scan[i + 1]) ?? 0) + 1);
const tables = counts.map(table), film = movie(scans.map((scan) => jpeg(scan, tables)), order);
writeFileSync(out, film);
console.log(`${createHash('sha256').update(film).digest('hex')}  ${out}`);
