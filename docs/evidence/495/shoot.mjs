// Draws the #495 taste pictures from the canvas's own frames: `deep-gpu run`'s `layers` call on four small films, a PNG
// at each film's middle and an animated PNG of its frames. Run from the repository root after
// `cargo build --locked --bin deep-gpu`; it writes beside itself and prints each SHA-256.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLICKS = 705_600_000;
const FRAMES = 48;
// The acceptance tests' palette: the matte's source is sRGB 0.5 grey over an accent target.
const LOOK = { light: { ground: [255, 255, 255], accent: [26, 163, 200], white: [255, 255, 255], grey: [128, 128, 128] } };
const LAYERS = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
const rect = (id, order, box, role, extra = {}, params = {}) => ({ id, kind: 'rect@1', layer: 'main', name: id, order, params: { box, paint: { fill: { role } }, ...params }, ...extra });
const item = (id, kind, order, params, extra = {}) => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const film = (id, size, items, rest = {}, span = '2s') => ({
  format: 1, id, profile: 'film', title: id, description: `The #495 taste film ${id}.`, size, layers: LAYERS,
  transport: { span, frame_rate: [60, 1] }, items: Object.fromEntries(items.map((i) => [i.id, i])), ...rest,
});
const slide = (target, list) => ({ target, type: 'f32', keys: Object.fromEntries(list.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp: 'linear' }])) });

const matte = (mode) => film(`matte-${mode}`, [160, 90], [
  rect('tgt', 'a0', [0, 0, 160, 90], 'accent'),
  rect('msrc', 'a1', [0, 0, 160, 90], 'grey', { visible: false }),
  item('m', 'matte@1', 'a2', { source: 'msrc', mode: 'luma', luma: mode, applies_to: 'tgt' }),
]);
const FILMS = {
  'echo-8-copies': film('echo-8-copies', [1000, 60], [
    item('g', 'group@1', 'a0', { echo: { copies: 8, lag: '2f', decay: 0.5, mode: 'over', newest: 'top' } }),
    rect('bar', 'a1', [0, 10, 4, 40], 'accent', { parent: 'g' }),
  ], { channels: { bx: slide('items/bar/at/pos/0', [[0, 0], [2, 960]]) } }),
  'matte-linear': matte('linear'),
  'matte-encoded': matte('encoded'),
  'flip-group': film('flip-group', [200, 40], [
    item('g', 'group@1', 'a0', { flip: { keys: [{ t: '0s', show: 'c0' }, { t: '0.5s', show: 'c2' }, { t: '1s', show: 'none' }, { t: '1.5s', show: 'c1' }] } }),
    ...[0, 1, 2, 3].map((i) => rect(`c${i}`, `a${i + 1}`, [10 + 40 * i, 10, 20, 20], 'accent', { parent: 'g' })),
  ]),
};
const STILLS = { 'echo-8-copies': 0.45, 'matte-linear': 0, 'matte-encoded': 0, 'flip-group': 0.3 };
const MOVING = new Set(['echo-8-copies', 'flip-group']);

const flick = (n) => Math.round((n * 2 * FLICKS) / FRAMES);
const out = mkdtempSync(join(tmpdir(), 'deep-495-shots-'));
const names = Object.keys(FILMS);
const calls = names.flatMap((name) => Array.from({ length: FRAMES }, (_, n) => ({ call: 'layers', doc: FILMS[name], look: LOOK, by: ['gpu_layer'], t: flick(n) })));
const run = spawnSync(join('target', 'debug', 'deep-gpu'), ['run'], { input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
const answer = JSON.parse(run.stdout.split('\n').find((l) => l !== ''));
if (!answer.ok) throw Error(`deep-gpu refused: ${run.stdout.slice(0, 800)}`);

const pngOf = (reply) => {
  const main = reply.layers?.find((l) => l.layer === 'main');
  const sha = main?.drawn?.gpu_layer?.png;
  if (!sha) throw Error(`no picture: ${JSON.stringify(reply).slice(0, 600)}`);
  return readFileSync(join(out, `${sha}.png`));
};

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** A PNG's IDAT bytes, and its header, as the renderer wrote them. */
function parts(png) {
  let at = 8; const idat = []; let ihdr;
  while (at < png.length) {
    const n = png.readUInt32BE(at); const type = png.toString('latin1', at + 4, at + 8); const data = png.subarray(at + 8, at + 8 + n);
    if (type === 'IHDR') ihdr = data; if (type === 'IDAT') idat.push(data);
    at += 12 + n;
  }
  return { ihdr, data: Buffer.concat(idat) };
}
/** An animated PNG of the renderer's frames, its bytes unchanged but for their chunk names. */
function apng(frames, fps) {
  const first = parts(frames[0]);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length);
  const list = [frames[0].subarray(0, 8), chunk('IHDR', first.ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const { ihdr, data } = parts(f);
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); ihdr.copy(fctl, 4, 0, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    list.push(chunk('fcTL', fctl));
    if (i === 0) list.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); list.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  list.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(list);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
names.forEach((name, f) => {
  const pngs = answer.replies.slice(f * FRAMES, (f + 1) * FRAMES).map(pngOf);
  const still = pngs[Math.floor(FRAMES * STILLS[name])];
  writeFileSync(join(HERE, `${name}.png`), still);
  console.log(`${name}.png  ${sha(still)}`);
  if (MOVING.has(name)) { const moving = apng(pngs, FRAMES / 2); writeFileSync(join(HERE, `${name}.apng`), moving); console.log(`${name}.apng  ${sha(moving)}`); }
});
