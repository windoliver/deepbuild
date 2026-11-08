// Draws the #494 taste pictures from the canvas's own frames through `deep-show run`'s `eval` with pixels: a position
// key travelling on a 180° arc (the dot, with eight more on the same arc a step behind each other), a path channel
// morphing a circle into a five-point star, and formula A morphing into formula B by `{of}` keys. Writes arc.png,
// circle-star.png, formula-morph.png and arc-and-morphs.apng (the three at 24 fps over their 1 s) beside itself and
// prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FLICKS = 705_600_000;
const evidence = mkdtempSync(join(tmpdir(), 'deep-494-shoot-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const stored = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const ulid = (n) => `01JB494S${String(n).padStart(18, '0')}`;
const SIZE = [640, 400];

const film = (id, items, extra = {}) => ({
  format: 1, id, profile: 'film', title: `#494 ${id}`, description: `The #494 taste film ${id}.`, size: SIZE, camera: 'cam', transport: { span: '2s' },
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
    { id: 'back', kind: 'rect@1', name: 'back', order: 'a1', params: { box: [-400, -400, 1440, 1200], paint: { fill: { role: 'ground' } } } },
    ...items,
  ].map((i) => [i.id, i])),
  ...extra,
});
const key = (s, value, extra = {}) => ({ t: `${s}s`, value, interp: 'linear', ...extra });

// The arc: from (160, 120) to (480, 120) on 180°, so it passes (320, 280). Dot k starts k × 0.1 s late, so a frame
// shows the arc as a trail; the accent dot is the one whose key starts at 0 s.
const dot = (id, role, size) => ({ id, kind: 'rect@1', name: id, order: `c${id}`, params: { box: [-size / 2, -size / 2, size, size], paint: { fill: { role } } }, at: { pos: [160, 120, 0] } });
const dots = Array.from({ length: 9 }, (_, k) => dot(`d${k}`, k === 0 ? 'accent' : 'muted', k === 0 ? 28 : 12));
const ARC = film('arc', dots.reverse(), {
  channels: Object.fromEntries(Array.from({ length: 9 }, (_, k) => [`go${k}`, {
    target: `items/d${k}/at/pos`, type: 'vec3',
    keys: { a: { t: `${k * 6}f`, value: [160, 120, 0], interp: 'linear', travel: { arc: { angle: 180 } } }, b: { t: `${60 + k * 6}f`, value: [480, 120, 0] } },
  }])),
});

// The circle and the star: 64 points on a circle of radius 120 to a star of 10, matched at check.
const C = [320, 200];
const poly = (pts) => `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;
const circle = Array.from({ length: 64 }, (_, i) => [C[0] + 120 * Math.cos((2 * Math.PI * i) / 64), C[1] + 120 * Math.sin((2 * Math.PI * i) / 64)]);
const inner = (150 * Math.sin(Math.PI / 10)) / Math.sin((7 * Math.PI) / 10);
const star = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? inner : 150; return [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]; });
const SHAPE = film('circle-star', [{ id: 'shape', kind: 'path@1', name: 'shape', order: 'c0', params: { d: poly(circle), paint: { fill: { role: 'accent' } } } }], {
  channels: { morph: { target: 'items/shape/path', type: 'path', keys: { a: key(0, poly(circle)), b: key(1, poly(star)) } } },
});

// Formula A ("a = b + c" as three blocks) morphs into formula B (a triangle, a ring of a pentagon and a bar) by
// `{of: fb}` keys; fb is drawn first, in the page's own color, so only fa shows.
const svg = (parts) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE[0]} ${SIZE[1]}" width="${SIZE[0]}" height="${SIZE[1]}">\n${parts.map((p) => `  <path id="${p.id}" d="${poly(p.pts)}" fill="#000000"/>`).join('\n')}\n</svg>\n`);
const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const A = [{ id: 'p', pts: rectPts(80, 160, 200, 240) }, { id: 'q', pts: rectPts(250, 185, 330, 215) }, { id: 'r', pts: rectPts(380, 140, 460, 260) }];
const B = [
  { id: 'p', pts: [[140, 120], [220, 280], [60, 280]] },
  { id: 'q', pts: Array.from({ length: 5 }, (_, i) => [330 + 70 * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 5), 200 + 70 * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 5)]) },
  { id: 'r', pts: rectPts(450, 260, 600, 290) },
];
const vector = (id, src, role, order) => ({ id, kind: 'vector@1', name: id, order, params: { src, size: SIZE, colors: { '#000000': role }, alt: id }, at: { pos: [0, 0, 0] } });
const FORMULA = film('formula-morph', [vector('fb', put(svg(B)), 'ground', 'b0'), vector('fa', put(svg(A)), 'ink', 'b1')], {
  requires: { modules: { vector: '^1' } },
  channels: { morph: { target: 'items/fa/path', type: 'path', keys: { a: key(0, poly(A.flatMap((p) => p.pts))), b: key(1, { of: 'fb' }) } } },
});
// fa's first key is A's outline, written out: one closed sub-path per part.
FORMULA.channels.morph.keys.a.value = A.map((p) => poly(p.pts)).join(' ');

const scenario = (calls) => ({
  evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [ulid(1)]: { panel: 'main' }, [ulid(2)]: { panel: 'main' }, [ulid(3)]: { panel: 'main' } }, calls,
});
const present = (doc, document) => ({ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc, document });
const FPS = 24;
const times = Array.from({ length: FPS + 1 }, (_, k) => Math.round((k * FLICKS) / FPS));
/** Each film's frames at `ts`, drawn by `eval` with pixels. */
function frames(n, doc, ts) {
  const r = spawnSync(join(REPO, 'target', 'debug', 'deep-show'), ['run'], {
    input: `${JSON.stringify(scenario([present(ulid(n), doc), ...ts.map((t) => ({ call: 'eval', doc: ulid(n), t, pixels: true }))]))}\n`, encoding: 'utf8', maxBuffer: 1 << 30,
  });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== ''));
  if (!answer.ok) throw Error(`deep-show refused: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  if (answer.replies[0].outcome !== 'presented') throw Error(`${doc.id} isn't presented: ${JSON.stringify(answer.replies[0]).slice(0, 800)}`);
  return answer.replies.slice(1).map((e) => stored(e.snapshots[0].sha256));
}
const arcTimes = Array.from({ length: 2 * FPS + 1 }, (_, k) => Math.round((k * FLICKS) / FPS));
const arc = frames(1, ARC, arcTimes);
const shape = frames(2, SHAPE, times);
const formula = frames(3, FORMULA, times);

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
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
  const out = [list[0].subarray(0, 8), chunk('IHDR', first.ihdr), chunk('acTL', actl)];
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

const pictures = {
  // The arc at 0.875 s: the accent dot is near its end, the eight behind it trail back along the arc.
  'arc.png': arc[21],
  'circle-star.png': shape[FPS / 2],
  'formula-morph.png': formula[FPS / 2],
  'arc-and-morphs.apng': apng([...arc, ...shape, ...formula], FPS),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
