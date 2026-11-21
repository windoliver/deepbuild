// #1430's pictures. The text-reflow bench's 50 KB text (benchmarks/text-reflow.mjs: 100 paragraphs of 512 characters)
// drawn by the window's frame path (`deep-canvas-render render`, the clean look's light theme, zoom 1), main's deep-text
// on the left and this branch's on the right:
//   - first at 640 u;
//   - then as its box narrows to 440 u;
//   - then as "hello " is typed into its second paragraph, a character a frame;
//   - then at 640 u again.
// Each side draws all 13 frames in one renderer process, as a window would.
//
// Under each frame, outside the pictures, a strip gives:
//   - how many pixels the two pictures differ in;
//   - for each side, what its `deep-text shape` (release) shaped for the same text, size and box;
//   - and how long that took: from writing the line to reading the answer, the best of nine processes taken in turn.
//     On a loaded Mac a slow line is mostly time spent waiting for a core, so the best run is the nearest to the work.
//
// node docs/evidence/1430/shoot.mjs <main's bin dir> <this branch's bin dir> <out dir> [video.mp4]
// Each bin dir holds deep-canvas-render (debug, as the suites build it) and deep-text (release). Writes reflow.apng,
// typed.png (frame 12) and frames.json to <out dir>, and the frames as an H.264 video when a path is given.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const [baseDir, mineDir, outDir, video] = process.argv.slice(2).map((p) => resolve(p));
if (!outDir) {
  console.error('usage: node shoot.mjs <main bin dir> <branch bin dir> <out dir> [video.mp4]');
  process.exit(2);
}

// The bench's text, as benchmarks/text-reflow.mjs builds it.
const WORDS = ['amber', 'birch', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'heron', 'inlet', 'juniper', 'kestrel', 'linden', 'meadow'];
const paragraph = (k) => {
  let p = `p${k}`;
  for (let i = 0; p.length < 512; i++) p += ` ${WORDS[(i * (1 + (k % 11)) + k) % WORDS.length]}`;
  return p.slice(0, 512);
};
const paragraphs = Array.from({ length: 100 }, (_, k) => paragraph(k));
const WORD = 'hello ';
/** The text with the first `n` characters of WORD typed after the second paragraph's "p1 ". */
const typed = (n) => paragraphs.map((p, k) => (k === 1 ? `${p.slice(0, 3)}${WORD.slice(0, n)}${p.slice(3)}` : p)).join('\n');
const FRAMES = [
  ...[640, 600, 560, 520, 480, 440].map((w, i) => ({ w, text: typed(0), what: i === 0 ? 'first layout, box 640 u wide' : `box ${w} u wide` })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ w: 440, text: typed(n), what: `"${WORD.slice(0, n)}" typed into paragraph 2` })),
  { w: 640, text: typed(6), what: 'box 640 u wide again' },
];

const SIZE = 16;
const PASSES = 9;
const PANEL = [680, 360];
const BOX_H = PANEL[1] - 32;
const GAP = 24;
const STRIP = [2 * PANEL[0] + GAP, 84];
const GREY = [128, 128, 128, 255];

const doc = (id, size, items) => ({
  format: 1, id, profile: 'figure', title: `#1430 ${id}`, description: `#1430's evidence document ${id}.`, size,
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items,
});
const text = (id, k, pos, params) => ({
  id, kind: 'text@1', layer: 'main', name: id, order: `a${k}`, at: { pos: [pos[0], pos[1], 0] },
  params: { font: 'body', paint: { fill: { role: 'ink' } }, ...params },
});
const page = (f) => doc('reflow', PANEL, { body: text('body', 0, [20, 16], { text: f.text, size: SIZE, box: { w: f.w, h: BOX_H }, overflow: 'mask' }) });

// PNG: 8-bit, non-interlaced, RGB or RGBA in; RGBA out, filter 0 on every row.
function decode(buf) {
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      [width, height, type] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]];
      if (data[8] !== 8 || data[12] !== 0) throw Error('only 8-bit, non-interlaced PNGs');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[type];
  if (!bpp) throw Error(`PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= bpp ? up[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const [pa, pb, pc] = [Math.abs(q - a), Math.abs(q - b), Math.abs(q - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(px.subarray(i * bpp, i * bpp + 3), i * 4);
    rgba[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(body));
  return Buffer.concat([n, body, c]);
}
function encode(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** One `render` process drawing `docs` in turn: each frame's picture. */
function render(bin, docs, dir, tag) {
  const lines = docs.map((d, i) => ({ out: join(dir, `${tag}-${String(i + 1).padStart(2, '0')}.png`), doc: d, look: 'clean', view: { zoom: 1, theme: 'light' } }));
  const r = spawnSync(bin, ['render'], { input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`${bin} render exited ${r.status}: ${r.stderr.slice(-2000)}`);
  r.stdout.split('\n').filter(Boolean).forEach((l, i) => {
    const a = JSON.parse(l);
    if (a.ok !== true) throw Error(`${tag} frame ${i + 1}: ${l.slice(0, 800)}`);
  });
  return lines.map((l) => decode(readFileSync(l.out)));
}

/** One `deep-text shape` process over the frames, fonts loaded first: each frame's time and what it shaped. */
async function work(bin) {
  const child = spawn(bin, ['shape'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const answers = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ask = async (line) => {
    const t0 = process.hrtime.bigint();
    child.stdin.write(`${JSON.stringify(line)}\n`);
    const { value } = await answers.next();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const reply = JSON.parse(value);
    if (reply.ok !== true) throw Error(`${bin} shape: ${value.slice(0, 800)}`);
    return { ms, shaped: reply.shaped.map((s) => ({ chars: [...s.text].length, glyphs: s.glyphs })) };
  };
  await ask({ text: 'warm', font: 'body', size: SIZE });
  const out = [];
  for (const f of FRAMES) out.push(await ask({ text: f.text, font: 'body', size: SIZE, box: { w: f.w, h: BOX_H }, overflow: 'mask' }));
  child.stdin.end();
  await new Promise((done) => child.on('close', done));
  return out;
}

const fmt = (n) => n.toLocaleString('en-US');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (v) => `${v.toFixed(v < 10 ? 2 : 1)} ms`;
const total = typed(0).length;
function told(shaped) {
  const chars = shaped.reduce((a, s) => a + s.chars, 0);
  if (shaped.length === 0) return 'shaped nothing';
  if (shaped.length === 1 && chars >= total) return `shaped the whole text, ${fmt(chars)} characters`;
  return `shaped ${shaped.length} paragraph${shaped.length === 1 ? '' : 's'}, ${fmt(chars)} characters`;
}
function differing(a, b) {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) n++;
  }
  return n;
}
function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) dst.rgba.set(src.rgba.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((y0 + y) * dst.width + x0) * 4);
}

const tmp = mkdtempSync(join(tmpdir(), 'deep-1430-shoot-'));
try {
  const bins = { main: join(baseDir, 'deep-canvas-render'), branch: join(mineDir, 'deep-canvas-render') };
  const texts = { main: join(baseDir, 'deep-text'), branch: join(mineDir, 'deep-text') };
  const load = [loadavg()[0]];
  const pictures = { main: render(bins.main, FRAMES.map(page), tmp, 'main'), branch: render(bins.branch, FRAMES.map(page), tmp, 'branch') };
  const passes = { main: [], branch: [] };
  for (let p = 0; p < PASSES; p++) for (const side of ['main', 'branch']) passes[side].push(await work(texts[side]));
  load.push(loadavg()[0]);
  for (const side of ['main', 'branch']) {
    for (const pass of passes[side].slice(1)) {
      if (JSON.stringify(pass.map((f) => f.shaped)) !== JSON.stringify(passes[side][0].map((f) => f.shaped))) throw Error(`${side}: the passes shaped different texts`);
    }
  }
  const frames = FRAMES.map((f, i) => {
    const side = (s) => {
      const runs = passes[s].map((pass) => pass[i].ms);
      return { shaped: passes[s][0][i].shaped, ms: Math.min(...runs), median_ms: median(runs), runs_ms: runs };
    };
    return { what: f.what, width: f.w, chars: f.text.length, pixels_differing: differing(pictures.main[i], pictures.branch[i]), main: side('main'), branch: side('branch') };
  });
  const strips = render(bins.branch, frames.map((f, i) => doc('strip', STRIP, {
    main: text('main', 0, [20, 12], { text: `main (merge base)  ·  ${told(f.main.shaped)}  ·  ${ms(f.main.ms)}`, size: 15 }),
    branch: text('branch', 1, [PANEL[0] + GAP + 20, 12], { text: `#1430 (this branch)  ·  ${told(f.branch.shaped)}  ·  ${ms(f.branch.ms)}`, size: 15 }),
    frame: text('frame', 2, [20, 48], { text: `${i + 1} / ${FRAMES.length}  ·  ${f.what}  ·  the two pictures differ in ${fmt(f.pixels_differing)} pixels  ·  times: deep-text shape, best of ${PASSES} processes`, size: 15 }),
  })), tmp, 'strip');
  mkdirSync(outDir, { recursive: true });
  const shots = join(tmp, 'frames');
  mkdirSync(shots);
  frames.forEach((_, i) => {
    const image = { width: STRIP[0], height: PANEL[1] + 2 + STRIP[1], rgba: new Uint8Array(STRIP[0] * (PANEL[1] + 2 + STRIP[1]) * 4) };
    for (let p = 0; p < image.rgba.length; p += 4) image.rgba.set(GREY, p);
    blit(image, pictures.main[i], 0, 0);
    blit(image, pictures.branch[i], PANEL[0] + GAP, 0);
    blit(image, strips[i], 0, PANEL[1] + 2);
    const png = encode(image);
    writeFileSync(join(shots, `${String(i + 1).padStart(2, '0')}.png`), png);
    if (i === 11) writeFileSync(join(outDir, 'typed.png'), png);
  });
  const ffmpeg = (args) => {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5/6', '-i', join(shots, '%02d.png'), ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw Error(`ffmpeg ${args.at(-1)}: ${r.stderr}`);
  };
  ffmpeg(['-plays', '0', '-pred', 'mixed', '-f', 'apng', join(outDir, 'reflow.apng')]);
  if (video) ffmpeg(['-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', video]);
  const record = {
    text: { characters: total, paragraphs: paragraphs.length, size_u: SIZE, box_h_u: BOX_H }, typed: WORD,
    pictures: 'deep-canvas-render render (debug), the clean look, light theme, zoom 1',
    times: `deep-text shape (release): from writing a line to reading its answer; ms is the best of ${PASSES} processes taken in turn, median_ms their median`,
    load_1min: load, frames,
  };
  writeFileSync(join(outDir, 'frames.json'), `${JSON.stringify(record, null, 1)}\n`);
  for (const [i, f] of frames.entries()) console.log(`${i + 1}. ${f.what}: ${fmt(f.pixels_differing)} px differ; main ${told(f.main.shaped)}, ${ms(f.main.ms)}; #1430 ${told(f.branch.shaped)}, ${ms(f.branch.ms)}`);
  console.log(`load ${load.map((l) => l.toFixed(0)).join(' → ')}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
