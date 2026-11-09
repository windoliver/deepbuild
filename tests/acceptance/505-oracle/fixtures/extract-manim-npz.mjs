// Reads manim-ce's control data for test_DrawBorderThenFill (tests/test_graphical_units/control_data/creation/
// DrawBorderThenFill.npz at a6d5cc02b430fb57d22add51236b6406fbf19d91) with Node built-ins only, and writes what each
// stored frame shows as JSON on stdout:
//
//   node fixtures/extract-manim-npz.mjs <DrawBorderThenFill.npz> > fixtures/manim-draw-border-then-fill.json
//
// An .npz is a zip; its one member `frame_data.npy` (deflate, zip64 sizes) is a NumPy array of uint8, shape
// (frames, height, width, 4). Per frame it records: the time t (the frames span DrawBorderThenFill's run_time, 2 s,
// evenly), alpha = manim's double_smooth(t / run_time) (the animation's default rate function), `lit` (pixels not
// the black background), `share` (lit over lit at the frame where alpha is 0.5, when the outline is whole and the
// fill not begun) and `opacity` (the square's center pixel ÷ 255: the white fill over black). It exits non-zero if
// the frames don't follow creation.py's rule (outline only while alpha ≤ 0.5, then fill opacity 2·alpha − 1), so
// the fixture never carries frames read wrong. Generated data; never edited by hand.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const RUN_TIME = 2;
const file = readFileSync(process.argv[2]);
if (file.readUInt32LE(0) !== 0x04034b50) throw Error('not a zip local file header');
const method = file.readUInt16LE(8);
const nameLength = file.readUInt16LE(26);
const extraLength = file.readUInt16LE(28);
const member = file.toString('latin1', 30, 30 + nameLength);
const extra = file.subarray(30 + nameLength, 30 + nameLength + extraLength);
let compressed = file.readUInt32LE(18);
if (compressed === 0xffffffff) {
  // The zip64 extra field (id 1): uncompressed size, then compressed size, as u64.
  if (extra.readUInt16LE(0) !== 1) throw Error('zip64 sizes without a zip64 extra field');
  compressed = Number(extra.readBigUInt64LE(12));
}
const body = file.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + compressed);
const npy = method === 8 ? inflateRawSync(body) : method === 0 ? body : null;
if (!npy) throw Error(`zip method ${method}`);
if (npy.toString('latin1', 1, 6) !== 'NUMPY') throw Error('not an .npy member');
const headerLength = npy[6] === 1 ? npy.readUInt16LE(8) : npy.readUInt32LE(8);
const headerStart = npy[6] === 1 ? 10 : 12;
const header = npy.toString('latin1', headerStart, headerStart + headerLength);
if (!/'descr': '\|u1'/.test(header) || !/'fortran_order': False/.test(header)) throw Error(`unexpected array header ${header}`);
const [frames, height, width, channels] = header.match(/'shape': \(([^)]*)\)/)[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const data = npy.subarray(headerStart + headerLength);
if (data.length !== frames * height * width * channels) throw Error('array size');
const at = (f, y, x, k) => data[((f * height + y) * width + x) * channels + k];

// manim/utils/rate_functions.py's smooth (inflection 10) and double_smooth, re-expressed.
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const smooth = (t) => { const e = sigmoid(-5); return Math.min(Math.max((sigmoid(10 * (t - 0.5)) - e) / (1 - 2 * e), 0), 1); };
const doubleSmooth = (t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1)));

const rows = [];
for (let f = 0; f < frames; f++) {
  let lit = 0; let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (at(f, y, x, 0) + at(f, y, x, 1) + at(f, y, x, 2) > 0) { lit++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const t = (RUN_TIME * f) / (frames - 1);
  rows.push({ frame: f, t, alpha: doubleSmooth(t / RUN_TIME), lit, box: lit ? [x0, y0, x1, y1] : null });
}
const whole = rows.find((r) => Math.abs(r.alpha - 0.5) < 1e-12);
if (!whole) throw Error('no frame at alpha 0.5');
const [bx0, by0, bx1, by1] = rows[rows.length - 1].box;
const cx = Math.round((bx0 + bx1) / 2); const cy = Math.round((by0 + by1) / 2);
for (const r of rows) {
  r.share = r.lit / whole.lit;
  r.opacity = at(r.frame, cy, cx, 0) / 255;
  const want = r.alpha <= 0.5 ? 0 : 2 * r.alpha - 1;
  if (Math.abs(r.opacity - want) > 2 / 255) throw Error(`frame ${r.frame}: center opacity ${r.opacity}, creation.py's rule gives ${want}`);
  if (r.alpha <= 0.5 && Math.abs(r.share - 2 * r.alpha) > 0.07) throw Error(`frame ${r.frame}: outline share ${r.share}, creation.py's rule gives ${2 * r.alpha}`);
  delete r.box;
}
const notice = `${readFileSync(new URL('./manim-LICENSE.txt', import.meta.url), 'utf8').trim()}`;
process.stdout.write(`${JSON.stringify({
  source: 'manim-ce a6d5cc02b430fb57d22add51236b6406fbf19d91 tests/test_graphical_units/control_data/creation/DrawBorderThenFill.npz (test_creation.py: test_DrawBorderThenFill)',
  upstream: 'https://github.com/ManimCommunity/manim/blob/a6d5cc02b430fb57d22add51236b6406fbf19d91/tests/test_graphical_units/control_data/creation/DrawBorderThenFill.npz',
  license: 'MIT (manim-ce; notice below)',
  notice,
  note: `${member}: ${frames} frames of ${width} x ${height} RGBA, a Square(fill_opacity=1) drawn by DrawBorderThenFill over run_time ${RUN_TIME} s with double_smooth; center pixel (${cx}, ${cy}). Generated by extract-manim-npz.mjs; never edited by hand.`,
  frames: rows,
}, null, 1)}\n`);
