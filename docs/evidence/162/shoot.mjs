// Draws the #162 taste pictures from the Lottie export's own check run (the #162 acceptance README: The taste call).
// The title is the suite's fixture (tests/acceptance/162/helpers.ts `titleDoc`): 320 × 180 at 24 fps for 2 s, a thick
// curve drawn by a trim under a rect mask that halves at 0.9375 s, and three accent tiles repeated and turning. The
// export runs with `readback: true`, so its fidelity check keeps, for each of its 20 sampled export frames, the
// document's own render and the reference Lottie renderer's frame of the written file. Writes beside itself:
//   title-from-lottie.png  sampled frame 24 as the reference renderer played it from the exported Lottie file
//   title-own-render.png   the same frame as the document's own render, which the check compared it with
//   title-motion.apng      the 20 sampled frames played from the Lottie file, at 10 frames a second
// Each picture is scaled up 2× by nearest neighbour. Prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const FLICKS = 705_600_000;
const FRAME = FLICKS / 24;
const SCALE = 2;
const SHOWN = 24;
const work = mkdtempSync(join(tmpdir(), 'deep-162-shoot-'));
const evidence = join(work, 'evidence');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const get = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));

// The suite's look, `look-162`: #157's flat colours (tests/acceptance/157/helpers.ts `lookOf`).
const COLOURS = { ground: '#e8e8e8', muted: '#8c8c8c', accent: '#f2c230', raised: '#d4d4d4', paper: '#f0f0f0', black: '#000000', white: '#ffffff', ramp_lo: '#0838a8', ramp_hi: '#f08020' };
const look = {
  id: 'look-162', format: 1, basis: 'drawing', license: 'Apache-2.0', description: 'The #157 acceptance look look-162: flat colours the tests know.',
  palette: {
    ...COLOURS, graphite: '#1b1d22', fog: '#e3e4e6',
    graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d22d6', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
    orchid: '#b0207f', indigo: '#2c3e7b',
  },
  roles: {
    ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog', paper: 'paper', black: 'black', white: 'white',
    ramp_lo: 'ramp_lo', ramp_hi: 'ramp_hi',
    ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled', focus: 'graphite',
    hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo',
  },
  themes: { light: {} },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
  fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
  fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish: [],
};
const lookSha = put(Buffer.from(`${JSON.stringify(look, null, 1)}\n`));

const item = (id, kind, name, order, params, extra = {}) => ({ id, kind, name, order, params, ...extra });
const channel = (target, keys) => ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value, interp], i) => [`k${i}`, { t: Math.round(t * FLICKS), value, interp: interp ?? 'linear' }])) });
const bez = (x1, y1, x2, y2) => ({ bezier: { x1, y1, x2, y2 } });
const title = {
  format: 1, id: 'title', profile: 'film', title: '#162 title', description: 'The #162 taste pictures\' title.', size: [320, 180], camera: 'cam',
  look: { asset: 'look-162@1', theme: 'light' }, transport: { span: 48 * FRAME, frame_rate: [24, 1] },
  assets: { 'look-162': { sha256: lookSha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #162 evidence script.' } } },
  items: Object.fromEntries([
    item('cam', 'camera@1', 'Camera', 'a00', { projection: 'orthographic', target: [160, 90, 0], view_width: 320 }),
    item('back', 'rect@1', 'Ground', 'a01', { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } }),
    item('veil', 'mask@1', 'Veil', 'a02', { shape: 'rect', box: [0, 0, 320, 180], applies_to: 'children' }),
    item('line', 'path@1', 'Line', 'a03', { d: 'M 40 120 C 100 30 220 30 280 120', paint: { stroke: { role: 'ink', width: 24, cap: 'round' } }, ops: [{ trim: { start: 0, end: 0 } }] }, { parent: 'veil' }),
    item('tiles', 'rect@1', 'Tiles', 'a04', { box: [-12, -12, 24, 24], paint: { fill: { role: 'accent' } }, ops: [{ repeater: { copies: 3, at: { pos: [36, 0] }, opacity: [1, 0.5] } }] }, { at: { pos: [36, 150, 0] } }),
  ].map((i) => [i.id, i])),
  channels: {
    trim: channel('items/line/params/ops/0/trim/end', [[0, 0, bez(0.42, 0, 0.58, 1)], [1.5, 1]]),
    lift: channel('items/line/at/pos/1', [[0, 0, bez(0.25, 0.1, 0.25, 1)], [2, -10]]),
    turn: channel('items/tiles/at/rot/2', [[0, 0, bez(0.33, 0, 0.67, 1)], [2, 45]]),
    veil: channel('items/veil/params/box/2', [[0, 320, 'hold'], [0.9375, 160, 'hold']]),
  },
};

const DOC = '01JB162S000000000000000001';
const peer = { pid: 3002, start: 3_000 };
const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const out = join(work, 'title.json');
const sc = {
  evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
  calls: [{ call: 'deep show', peer, doc: DOC, document: title }, { call: 'export', doc: DOC, out, video: { codec: 'lottie' }, lottie: { container: 'json', images: 'embed' }, readback: true }],
};
const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) throw Error(`deep-show run: ${r.stderr.slice(-2000)}`);
const reply = JSON.parse(r.stdout.split('\n')[0]).replies[1];
if (reply.outcome !== 'exported') throw Error(`the title wasn't exported: ${JSON.stringify(reply).slice(0, 2000)}`);
const back = reply.readback;
const [w, h] = back.size;

// PNG and APNG, RGBA, each pixel repeated SCALE times both ways.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
const be32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, 4 * i)); return b; };
const be16 = (...v) => { const b = Buffer.alloc(2 * v.length); v.forEach((x, i) => b.writeUInt16BE(x, 2 * i)); return b; };
function scaled(rgba) {
  const W = w * SCALE; const rows = [];
  for (let y = 0; y < h * SCALE; y++) {
    const row = Buffer.alloc(1 + 4 * W);
    for (let x = 0; x < W; x++) rgba.copy(row, 1 + 4 * x, 4 * ((Math.floor(y / SCALE)) * w + Math.floor(x / SCALE)), 4 * ((Math.floor(y / SCALE)) * w + Math.floor(x / SCALE)) + 4);
    rows.push(row);
  }
  return deflateSync(Buffer.concat(rows));
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = () => chunk('IHDR', Buffer.concat([be32(w * SCALE, h * SCALE), Buffer.from([8, 6, 0, 0, 0])]));
const png = (rgba) => Buffer.concat([SIG, ihdr(), chunk('IDAT', scaled(rgba)), chunk('IEND', Buffer.alloc(0))]);
function apng(frames, fps) {
  const parts = [SIG, ihdr(), chunk('acTL', be32(frames.length, 0))];
  let seq = 0;
  frames.forEach((rgba, i) => {
    parts.push(chunk('fcTL', Buffer.concat([be32(seq++, w * SCALE, h * SCALE, 0, 0), be16(1, fps), Buffer.from([0, 0])])));
    const data = scaled(rgba);
    parts.push(i === 0 ? chunk('IDAT', data) : chunk('fdAT', Buffer.concat([be32(seq++), data])));
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const shown = back.frames.find((f) => f.frame === SHOWN);
if (!shown) throw Error(`frame ${SHOWN} isn't one of the check's sampled frames: ${back.frames.map((f) => f.frame).join(', ')}`);
const pictures = {
  'title-from-lottie.png': png(get(shown.read)),
  'title-own-render.png': png(get(shown.raw)),
  'title-motion.apng': apng(back.frames.map((f) => get(f.read)), 10),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
rmSync(work, { recursive: true, force: true });
