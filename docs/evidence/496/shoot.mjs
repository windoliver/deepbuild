// Draws the #496 taste pictures from the canvas's own frames: `deep-canvas-render raster` on three small films, a PNG of
// each at a telling moment and one animated PNG of the three together over 4.7 s. Run from the repository root after
// `cargo build --locked --bin deep-canvas-render`; it writes beside itself and prints each SHA-256.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLICKS = 705_600_000;
const SPAN = 4.7;
const FPS = 20;
const LAYERS = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
const film = (id, size, items, rest = {}) => ({
  format: 1, id, profile: 'film', title: id, description: `The #496 taste film ${id}.`, size, layers: LAYERS,
  transport: { span: `${SPAN}s`, frame_rate: '60/1' }, items: Object.fromEntries(items.map((i) => [i.id, i])), ...rest,
});
const text = (id, params, pos) => ({ id, kind: 'text@1', layer: 'main', name: id, order: `b${id}`, ...(pos ? { at: { pos: [...pos, 0] } } : {}), params });
const circle = (r) => {
  const n = 8; const step = (2 * Math.PI) / n; const k = (4 / 3) * Math.tan(step / 4);
  const p = (a) => [r * Math.cos(a), r * Math.sin(a)];
  let d = `M ${r} 0`;
  for (let i = 0; i < n; i++) {
    const a0 = i * step; const a1 = (i + 1) * step; const [x0, y0] = p(a0); const [x1, y1] = p(a1);
    d += ` C ${x0 - k * r * Math.sin(a0)} ${y0 + k * r * Math.cos(a0)} ${x1 + k * r * Math.sin(a1)} ${y1 - k * r * Math.cos(a1)} ${x1} ${y1}`;
  }
  return `${d} Z`;
};
const hold = (list) => Object.fromEntries(list.map(([t, v], i) => [`k${String(i).padStart(2, '0')}`, { t: `${t}s`, value: v, interp: 'hold' }]));

// MOTION, its weight driven from 100 to 900 and back twice over 4.7 s (the issue's formula).
const motion = (pos) => text('motion', { text: 'MOTION', size: 112, weight: 400 }, pos);
const weightDriver = { sweep: { target: 'items/motion/params/weight', expr: 'round(100 + 800 * (0.5 - 0.5 * cos(2 * pi * 2 * t / 4.7)))', vars: { t: 'time' } } };
// A ring of radius 100 and a monospaced run repeated along it, sized so three copies close the ring, sliding one run's
// length over the span. JetBrains Mono advances 0.6 em.
const RUN = 'ON A CURVE · ';
const ADVANCE = (2 * Math.PI * 100) / (3 * RUN.length);
const ring = (pos) => ({ id: 'ring', kind: 'path@1', layer: 'main', name: 'ring', order: 'a0', ...(pos ? { at: { pos: [...pos, 0] } } : {}), params: { d: circle(100), paint: { stroke: { width: 1, role: 'muted' } } } });
const arc = text('arc', { text: RUN, font: 'mono', size: ADVANCE / 0.6, on_curve: { path: 'ring', offset: 0, repeat: true } }, null);
const slide = { slide: { target: 'items/arc/params/on_curve/offset', type: 'f32', keys: { a: { t: '0s', value: 0, interp: 'linear' }, b: { t: '4.7s', value: ADVANCE * RUN.length, interp: 'linear' } }, extrapolate: { before: 'hold', after: 'cycle' } } };
// A countdown from 02:15:04, once a second from 0.4 s, its changed digits rolling over 0.32 s.
const clock = (pos) => text('clock', {
  text: { counter: { source: 'data/left', format: { notation: 'clock' }, roll: { span: '0.32s', interp: { ease: { name: 'in_out_cubic' } } } } },
  size: 64, box: { w: 400, h: 80 }, widest: '88:88:88',
}, pos);
const countdown = { left: { target: 'data/left', type: 'f32', keys: hold([[0, 8104], [0.4, 8103], [1.4, 8102], [2.4, 8101], [3.4, 8100], [4.4, 8099]]) } };

const FILMS = {
  'motion-weight': { doc: film('motion-weight', [720, 200], [motion([16, 16])], { drivers: weightDriver }), t: 1.175 },
  'text-on-circle': { doc: film('text-on-circle', [320, 320], [ring([160, 160]), arc], { channels: slide }), t: 0.8 },
  'rolling-counter': { doc: film('rolling-counter', [480, 160], [clock([16, 16])], { data: { left: { value: 8104 } }, channels: countdown }), t: 4.56 },
};
const ALL = film('text-animators', [960, 380], [motion([16, 8]), ring([780, 190]), arc, clock([16, 230])], {
  drivers: weightDriver, channels: { ...slide, ...countdown }, data: { left: { value: 8104 } },
});

const out = mkdtempSync(join(tmpdir(), 'deep-496-shots-'));
const lines = [];
for (const [name, f] of Object.entries(FILMS)) lines.push({ out: join(out, `${name}.png`), doc: f.doc, look: 'clean', t: Math.round(f.t * FLICKS) });
const frames = Math.round(SPAN * FPS);
for (let n = 0; n < frames; n++) lines.push({ out: join(out, `all-${n}.png`), doc: ALL, look: 'clean', t: Math.round((n * FLICKS) / FPS) });
const run = spawnSync(join('target', 'debug', 'deep-canvas-render'), ['raster'], { input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
run.stdout.split('\n').filter((l) => l !== '').forEach((l, i) => { const a = JSON.parse(l); if (!a.ok) throw Error(`raster refused line ${i + 1}: ${l.slice(0, 600)}`); });

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
function apng(pngs, fps) {
  const first = parts(pngs[0]);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(pngs.length);
  const list = [pngs[0].subarray(0, 8), chunk('IHDR', first.ihdr), chunk('acTL', actl)];
  let seq = 0;
  pngs.forEach((f, i) => {
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
for (const name of Object.keys(FILMS)) {
  const still = readFileSync(join(out, `${name}.png`));
  writeFileSync(join(HERE, `${name}.png`), still);
  console.log(`${name}.png  ${sha(still)}`);
}
const moving = apng(Array.from({ length: frames }, (_, n) => readFileSync(join(out, `all-${n}.png`))), FPS);
writeFileSync(join(HERE, 'text-animators.apng'), moving);
console.log(`text-animators.apng  ${sha(moving)}`);
