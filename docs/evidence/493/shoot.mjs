// Draws the #493 taste pictures from the canvas's own frames through `deep-show run`: a 3D shot list (a push, an
// orbit that glides in, a cut and a log zoom) drawn by the 3D frame path at each time, and a 2D cross-fade between two
// looks drawn by `eval` with pixels. Writes push.png, orbit.png, cut.png, log-zoom.png, cross-fade.png and
// shot-list.apng beside itself and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show`.
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
const evidence = mkdtempSync(join(tmpdir(), 'deep-493-shoot-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const stored = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const ulid = (n) => `01JB493S${String(n).padStart(18, '0')}`;

// The 3D shot list: a stage of boxes, pushed in, orbited (gliding in from the push), cut to a low angle, then zoomed
// out in log space over two orders of magnitude.
const box = (id, pos, size, role) => ({ id, kind: 'mark.box@1', name: id, order: `b${id}`, params: { size, paint: { fill: { role } } }, at: { pos } });
const SHOTS = {
  format: 1, id: 'shot-list', profile: 'film', title: '#493 shot list', description: 'A push, an orbit that glides in, a cut and a log zoom.',
  size: [960, 540], camera: 'cam', transport: { span: '8s' }, requires: { modules: { scene3d: '^1' } },
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 35, elevation: 25, distance: 9 }, fov: 40 } },
    box('floor', [0, -0.05, 0], [12, 0.1, 12], 'muted'),
    box('hero', [0, 0.6, 0], [1, 1.2, 1], 'accent'),
    box('left', [-2.2, 0.4, -1], 0.8, 'ink'),
    box('right', [2, 0.3, 1.2], 0.6, 'ink'),
  ].map((i) => [i.id, i])),
  shots: {
    push: { start: '0s', end: '2s', camera: 'cam', move: 'push', frame: { keep: ['hero'] } },
    orbit: { start: '2s', end: '4s', camera: 'cam', move: 'orbit', by: 60, target: [0, 0.6, 0], orbit: { azimuth: 35, elevation: 20, distance: 5 }, join: { glide: { span: '0.6s' } } },
    low: { start: '4s', end: '5.5s', camera: 'cam', move: 'hold', target: [0, 0.8, 0], orbit: { azimuth: -40, elevation: 5, distance: 4.5 } },
    zoom: { start: '5.5s', end: '8s', camera: 'cam', move: 'log_zoom', by: 0.1, target: [0, 0.6, 0], orbit: { azimuth: 20, elevation: 30, distance: 60 } },
  },
  transitions: { k: { from: 'orbit', to: 'low', kind: 'cut' } },
};

// The 2D cross-fade between two looks: the clean look with AgX, and with no tone map.
const clean = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8'));
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };
const looks = { toned: { ...clean, id: 'toned', tone_map: { agx: { white: 16.29, contrast: 1.25 } } }, plain: { ...clean, id: 'plain', tone_map: 'none' } };
const assets = Object.fromEntries(Object.entries(looks).map(([k, v]) => [k, { sha256: put(Buffer.from(JSON.stringify(v))), license: LICENSE }]));
const rect = (id, b, role, at = [0, 0, 0]) => ({ id, kind: 'rect@1', name: id, order: `c${id}`, params: { box: b, paint: { fill: { role } } }, at: { pos: at } });
const FADE = {
  format: 1, id: 'cross-fade', profile: 'film', title: '#493 cross-fade', description: 'A cross-fade from an AgX look to an untoned one.',
  size: [640, 360], camera: 'cam', transport: { span: '4s' }, look: { asset: 'plain@1', theme: 'light' }, assets,
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640 } },
    rect('back', [-400, -200, 1440, 760], 'ground'), rect('s1', [60, 60, 160, 120], 'accent'), rect('s2', [240, 60, 160, 120], 'ink'),
    rect('s3', [420, 60, 160, 120], 'muted'), rect('far', [900, 60, 160, 240], 'accent'),
  ].map((i) => [i.id, i])),
  shots: {
    a: { start: '0s', end: '2s', camera: 'cam', move: 'hold', target: [320, 180, 0], view_width: 640, look: 'toned' },
    b: { start: '2s', end: '4s', camera: 'cam', move: 'hold', target: [700, 180, 0], view_width: 900, look: 'plain' },
  },
  transitions: { xf: { from: 'a', to: 'b', kind: 'cross_fade', span: '1s', progress: 'linear' } },
};

const scenario = (calls) => ({
  evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [ulid(1)]: { panel: 'main' }, [ulid(2)]: { panel: 'main' } }, calls,
});
const present = (doc, document) => ({ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc, document });
function run(calls) {
  const r = spawnSync(join(REPO, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario(calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== ''));
  if (!answer.ok) throw Error(`deep-show refused: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  return answer.replies;
}

const FPS = 12;
const times = Array.from({ length: 8 * FPS }, (_, k) => Math.round((k * FLICKS) / FPS));
const listed = run([present(ulid(1), SHOTS), { call: 'determinism', doc: ulid(1), display_hz: FPS, play: 'cold', at_times: times }]);
if (listed[0].outcome !== 'presented') throw Error(`the shot list isn't presented: ${JSON.stringify(listed[0]).slice(0, 800)}`);
const frames = listed[1].frames.map((f) => stored(f.play.pixels));
const at = (s) => frames[Math.round(s * FPS)];

const fade = run([present(ulid(2), FADE), { call: 'eval', doc: ulid(2), t: fl(2.1), pixels: true }]);
if (fade[0].outcome !== 'presented') throw Error(`the cross-fade isn't presented: ${JSON.stringify(fade[0]).slice(0, 800)}`);
const fadePng = stored(fade[1].snapshots[0].sha256);

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
  'push.png': at(1), 'orbit.png': at(3.25), 'cut.png': at(4.25), 'log-zoom.png': at(6.75), 'cross-fade.png': fadePng,
  'shot-list.apng': apng(frames, FPS),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
