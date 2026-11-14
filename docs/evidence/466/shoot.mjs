// Draws the #466 taste pictures from the canvas's own frames through `deep-show run` (`eval` with pixels):
// a pack's mosaic transition between two worlds, an iris on a walker moving along a path, a dip to ink holding at
// its middle, a caption the look designs (a card that unfolds), and a recording of the three transitions and a boil
// of three drawings at 12 Hz. Writes mosaic.png, iris.png, dip.png, caption.png and transitions-boil.apng beside
// itself and prints each SHA-256. Run from the repository root after
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
const fl = (s) => Math.round(s * FLICKS);
const evidence = mkdtempSync(join(tmpdir(), 'deep-466-shoot-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const stored = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const ulid = (n) => `01JB466S${String(n).padStart(18, '0')}`;

const clean = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8'));
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };
const withLook = (doc, look) => ({ ...doc, assets: { shot: { sha256: put(Buffer.from(JSON.stringify(look))), license: LICENSE } }, look: { asset: 'shot@1', theme: 'light' } });
const cam = (w, h) => ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [w / 2, h / 2, 0], view_width: w } });
const rect = (id, b, role, order = `c${id}`) => ({ id, kind: 'rect@1', name: id, order, params: { box: b, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
const circle = (id, r, role, at) => ({ id, kind: 'circle@1', name: id, order: `d${id}`, params: { center: [0, 0], r, paint: { fill: { role } } }, at: { pos: at } });
const film = (id, w, h, items, extra, span = '4s') => ({
  format: 1, id, profile: 'film', title: `#466 ${id}`, description: `The #466 taste picture: ${id}.`, size: [w, h], safe: 24, locale: 'en', camera: 'cam',
  transport: { span, frame_rate: '24/1', sample_rate: 48000 }, items: Object.fromEntries(items.map((i) => [i.id, i])), ...extra,
});
const shot = (s, e, target, vw) => ({ start: `${s}s`, end: `${e}s`, camera: 'cam', move: 'hold', target: [...target, 0], view_width: vw });
// Two worlds side by side on the page: warm squares, then cool bars.
const worlds = [
  rect('a-back', [0, 0, 640, 360], 'ground', 'b0'), rect('a1', [80, 80, 140, 200], 'accent'), rect('a2', [260, 120, 140, 160], 'ink'), rect('a3', [440, 60, 120, 240], 'muted'),
  rect('b-back', [1000, 0, 640, 360], 'muted', 'b1'), rect('b1', [1060, 60, 520, 60], 'ground'), rect('b2', [1060, 160, 520, 60], 'accent'), rect('b3', [1060, 260, 520, 60], 'ink'),
];
const twoShots = { a: shot(0, 2, [320, 180], 640), b: shot(2, 4, [1320, 180], 640) };

const MOSAIC = withLook(film('mosaic', 640, 360, [cam(640, 360), ...worlds], {
  packs: ['test/mosaic@1.0.0'], shots: twoShots,
  transitions: { mz: { from: 'a', to: 'b', kind: 'operator', operator: { op: 'mosaic.dissolve@1', reads: ['outgoing', 'incoming', 'progress'] }, span: '1s', align: 'reveal', progress: 'linear' } },
}), clean);
const PATH = [[80, 290], [320, 70], [560, 290]];
const IRIS = withLook(film('iris', 640, 360, [cam(640, 360), rect('back', [0, 0, 640, 360], 'ground', 'b0'), rect('far', [1000, 0, 640, 360], 'muted', 'b1'),
  rect('far-bar', [1060, 150, 520, 60], 'accent'), circle('walker', 20, 'accent', [...PATH[0], 0])], {
  data: { along: 0 },
  channels: { along: { target: 'data/along', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 1, interp: 'linear' } } } },
  constraints: { go: { owner: 'walker', kind: 'follow_path', path: PATH, fraction: { data: 'along' } } },
  shots: twoShots,
  transitions: { ir: { from: 'a', to: 'b', kind: 'iris', iris: { center: 'walker' }, span: '2s', progress: 'linear' } },
}), clean);
const DIP = withLook(film('dip', 640, 360, [cam(640, 360), ...worlds], {
  shots: { a: shot(0, 3, [320, 180], 640), b: shot(3, 6, [1320, 180], 640) },
  transitions: { dip: { from: 'a', to: 'b', kind: 'dip', dip: { color: 'ink', hold: '0.5s' }, span: '2.9s', progress: 'in_out_quad' } },
}, '6s'), clean);
const CAPTION = withLook(film('caption', 640, 360, [cam(640, 360), ...worlds.slice(0, 4)], {
  script: { narrator: { name: 'Fixture voice', synthetic: false, license: LICENSE }, lines: { note: { t: '0.5s', text: 'Captions belong to the world they are drawn in', kind: 'caption' } },
    captions: { profile: 'netflix-en-adult', font: 'body', size: 16 } },
}), { ...clean, captions: { plate: 'card', entrance: 'unfold', text_after: 0.4, anchor: [0.5, 0.85], stage: 'after_finish' } });
const BOIL = withLook(film('boil', 640, 360, [cam(640, 360), rect('back', [0, 0, 640, 360], 'ground', 'b0'),
  { id: 'line', kind: 'path@1', name: 'Zigzag', order: 'c1', params: { d: 'M 80 280 L 200 80 L 320 280 L 440 80 L 560 280', paint: { stroke: { role: 'ink', width: 6 } } } }], {}), {
  ...clean, time: { ...(clean.time ?? {}), boil: { hz: 12, amount_px: 4, scope: 'all', while: 'always', cycle: 3, seed: 'item' } },
});

const scenario = (calls) => ({
  evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [ulid(n), { panel: 'main' }])),
  packs: [{ id: 'test/mosaic', dir: join(REPO, 'tests', 'acceptance', '466', 'fixtures', 'packs', 'test-mosaic-1.0.0') }], calls,
});
const present = (doc, document) => ({ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc, document });
function run(calls) {
  const r = spawnSync(join(REPO, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario(calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== ''));
  if (!answer.ok) throw Error(`deep-show refused: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  return answer.replies;
}
/** Each document's pictures at each time, from `eval` with pixels. */
function draw(docs, times) {
  const replies = run([...docs.map((d, i) => present(ulid(i + 1), d)), ...docs.flatMap((_, i) => times[i].map((t) => ({ call: 'eval', doc: ulid(i + 1), t, pixels: true })))]);
  docs.forEach((d, i) => { if (replies[i].outcome !== 'presented') throw Error(`${d.id} isn't presented: ${JSON.stringify(replies[i]).slice(0, 800)}`); });
  let k = docs.length;
  return docs.map((d, i) => times[i].map((t) => {
    const r = replies[k++];
    const s = r.snapshots?.[0]?.sha256;
    if (!s) throw Error(`${d.id} at ${t / FLICKS} s draws no snapshot: ${JSON.stringify(r).slice(0, 800)}`);
    return stored(s);
  }));
}

const FPS = 12;
const window = (from, to) => Array.from({ length: Math.round((to - from) * FPS) + 1 }, (_, k) => fl(from + k / FPS));
const [mosaic, iris, dip, caption, boil] = draw([MOSAIC, IRIS, DIP, CAPTION, BOIL], [window(1, 3), window(0.8, 3.2), window(1.3, 4.7), [fl(1.5)], window(0, 1)]);

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
  'mosaic.png': mosaic[Math.round(0.95 * FPS)],
  'iris.png': iris[Math.round(0.8 * FPS)],
  'dip.png': dip[14],
  'caption.png': caption[0],
  'transitions-boil.apng': apng([...mosaic, ...iris, ...dip, ...boil, ...boil], FPS),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
