// Draws the #468 taste pictures from the renderer's own frames through `deep-gpu run` (`view3d`, its `final` target):
// bokeh discs from the lens's circle of confusion (fairy lights at several depths behind a sharp box, through a 50 mm
// lens at f/2 with six blades), a frame of a focus pull from A to B while the camera dollies, a label's leader on a
// lid that opens while the camera orbits, and a recording of the focus pull and the lid. Writes bokeh-disc.png,
// focus-pull.png, lid-leader.png and focus-pull-and-lid.apng beside itself and prints each SHA-256. Run from the
// repository root after `cargo build --locked --bin deep-gpu`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-gpu');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const FONTS = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const LOOK = {
  id: 'look-468-shoot', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #468 taste pictures.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#e6e8ec', white: '#ffffff' },
  roles: { ground: 'night', ink: 'stone', muted: 'slate', stone: 'stone', caption: 'white' },
  themes: { light: {}, dark: {} }, fonts: FONTS, status: STATUS, status_treatment: { core_min_px: 4, glyph: GLYPHS }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
};
const material = (params) => ({ kind: 'material@1', params });
const box = (size, pos, mat, more = {}) => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat, ...more });
const ball = (radius, pos, mat) => ({ kind: 'ball@1', params: { radius, segments: 24 }, at: { pos }, material: mat });
const linear = (target, keys) => ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) });
const SKY = { kind: 'sky@1', params: { top: [0.02, 0.03, 0.06, 1], low: [0.05, 0.05, 0.07, 1], ambient_top: [0.15, 0.15, 0.18], ambient_low: [0.05, 0.05, 0.06] } };
const SUN = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 0.95, 0.9], shadow: false }, at: { rot: [-40, 35, 0] } };
function scene(id, size, items, extra = {}) {
  const withIds = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #468 taste picture.`, size, camera: 'cam', seed: 468, safe: 24,
    transport: { span: '4s' }, requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

// Fairy lights behind a sharp box: each light a small emissive ball, spread into the aperture's hexagon.
function bokeh() {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 1.1, 2.6], target: [0, 1, 0], lens: { focal_length: 85 }, aperture: { f_stop: 2.8, blades: 6 }, near: 0.05, far: 500 } },
    sky: SKY, sun: SUN, clay: material({ base_color: [0.75, 0.42, 0.28, 1], roughness: 0.55 }), floor_mat: material({ base_color: [0.18, 0.18, 0.2, 1], roughness: 0.9 }),
    floor: box([30, 0.1, 40], [0, -0.05, -12], 'floor_mat'), subject: box([0.3, 0.3, 0.3], [0, 1, 0.6], 'clay'),
    fx: { kind: 'effect@1', params: { kind: 'dof', dof: { focus: 'subject', max_coc: 48, taps: 96 } } },
  };
  const tints = [[1, 0.75, 0.4], [1, 0.55, 0.3], [0.6, 0.8, 1], [1, 0.9, 0.6]];
  for (let k = 0; k < 24; k++) {
    const depth = 4 + (k % 6) * 2.4;
    const x = ((k * 37) % 23) / 23 * 2 - 1;
    const y = ((k * 53) % 17) / 17;
    const c = tints[k % tints.length];
    items[`glow${k}_mat`] = material({ base_color: [0, 0, 0, 1], emission: [...c, 1], emission_strength: 60, roughness: 1 });
    items[`glow${k}`] = ball(0.015, [x * depth * 0.22, 0.75 + y * depth * 0.14, -depth], `glow${k}_mat`);
  }
  return scene('bokeh-468', [960, 640], items, { transport: { span: '1s' } });
}

// The focus pull: A near, B far, the camera dollying in; focus keyed from A to B with no ease named (in_out_cubic).
function pull() {
  return scene('focus-pull-468', [960, 640], {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0.3, 1.1, 4], target: [0, 0.9, -20], lens: { focal_length: 85 }, aperture: { f_stop: 1.8, blades: 0 }, near: 0.05, far: 500 } },
    sky: SKY, sun: SUN, a_mat: material({ base_color: [0.85, 0.35, 0.25, 1], roughness: 0.5 }), b_mat: material({ base_color: [0.25, 0.5, 0.85, 1], roughness: 0.5 }),
    floor_mat: material({ base_color: [0.3, 0.3, 0.32, 1], roughness: 0.9 }), post_mat: material({ base_color: [0.8, 0.8, 0.75, 1], roughness: 0.7 }),
    floor: box([30, 0.1, 40], [0, -0.05, -10], 'floor_mat'),
    A: box([0.3, 0.3, 0.3], [0.05, 0.9, 2], 'a_mat'), B: box([0.6, 0.6, 0.6], [0.6, 0.9, -4], 'b_mat'),
    ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`post${k}`, box([0.12, 1.6, 0.12], [k % 2 ? 1.2 : -1.2, 0.8, 1.5 - k * 1.5], 'post_mat')])),
    fx: { kind: 'effect@1', params: { kind: 'dof', dof: { focus: 'A', max_coc: 40 } } },
  }, {
    transport: { span: '2s' },
    channels: {
      dolly: linear('items/cam/params/position/2', [[0, 4], [2, 3.6]]), a_moves: linear('items/A/at/pos/0', [[0, 0.05], [2, 0.15]]), b_moves: linear('items/B/at/pos/2', [[0, -4], [2, -3.4]]),
      pull: { target: 'items/fx/params/dof/focus', type: 'f32', keys: { k0: { t: '0.5s', value: 'A' }, k1: { t: '1.5s', value: 'B' } } },
    },
  });
}

// The lid opening while the camera orbits, its callout's leader on lid#hinge and a wire from the floor to the hinge.
function lid() {
  const pivot = [0, -0.01, -0.15];
  return scene('lid-leader-468', [960, 640], {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0.1, 0.3, 0], orbit: { azimuth: -30, elevation: 25, distance: 2.4 }, fov: 40, near: 0.05, far: 50 } },
    sky: SKY, sun: SUN, case_mat: material({ base_color: [0.35, 0.3, 0.25, 1], roughness: 0.6 }), lid_mat: material({ base_color: [0.6, 0.5, 0.35, 1], roughness: 0.5 }),
    case: box([0.4, 0.5, 0.3], [0.2, 0.25, 0], 'case_mat'),
    lid: { kind: 'mark.box@1', params: { size: [0.4, 0.02, 0.3], anchors: { hinge: pivot } }, at: { pos: [0.2, 0.5, -0.15], rot: [0, 0, 0], pivot }, material: 'lid_mat' },
    callout: { kind: 'overlay.text@1', role: 'label', params: { anchor: 'right', role: 'caption', template: 'Hinge', size: 16, leader: { to: 'lid#hinge', line: 'ink', width: 1.5, end: 'dot', elbow: 'none', gap: 6 }, hide: 'off_frame' } },
    wire: { kind: 'mark.line@1', params: { points: [[-0.4, 0, 0.3], 'lid#hinge'], width: 2, paint: { fill: { role: 'ink' } } } },
  }, { channels: { orbit: linear('items/cam/params/orbit/azimuth', [[0, -30], [4, 40]]), open: linear('items/lid/at/rot/0', [[0, 0], [4, -110]]) } });
}

// PNG: read the renderer's 8-bit RGB(A) frames, write RGB frames and an animated PNG of them.
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
function decode(file) {
  let at = 8; let w = 0; let h = 0; let color = 0; const idat = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); color = body[9]; }
    if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat)); const out = Buffer.alloc(w * h * 3); const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = line[x * bpp + k];
    prev = line;
  }
  return { w, h, rgb: out };
}
const ihdr = (w, h) => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2; return b; };
const rows = (img) => { const raw = Buffer.alloc(img.h * (img.w * 3 + 1)); for (let y = 0; y < img.h; y++) img.rgb.copy(raw, y * (img.w * 3 + 1) + 1, y * img.w * 3, (y + 1) * img.w * 3); return deflateSync(raw, { level: 9 }); };
const png = (img) => Buffer.concat([SIG, chunk('IHDR', ihdr(img.w, img.h)), chunk('IDAT', rows(img)), chunk('IEND', Buffer.alloc(0))]);
function apng(frames, fps) {
  const { w, h } = frames[0];
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts = [SIG, chunk('IHDR', ihdr(w, h)), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26); fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(w, 4); fctl.writeUInt32BE(h, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const out = mkdtempSync(join(tmpdir(), 'deep-468-shoot-'));
try {
  const doc = (name, d) => { const p = join(out, `${name}.json`); writeFileSync(p, JSON.stringify(d)); return p; };
  const call = (d, size, fps, frames, capture) => ({ call: 'view3d', doc: d, look: LOOK, size, fps, from: 0, frames, capture, targets: ['final'] });
  const pullFrames = Array.from({ length: 31 }, (_, k) => 15 + k);
  const lidFrames = Array.from({ length: 41 }, (_, k) => k * 2);
  const calls = [call(doc('bokeh', bokeh()), [960, 640], 30, 1, [0]), call(doc('pull', pull()), [960, 640], 30, 61, pullFrames), call(doc('lid', lid()), [960, 640], 20, 81, lidFrames)];
  const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`deep-gpu run: ${r.stderr.slice(-2000)}`);
  const answer = JSON.parse(r.stdout.trim().split('\n').at(-1));
  if (answer.ok !== true) throw Error(`deep-gpu run: ${r.stdout.slice(0, 2000)}`);
  const finals = answer.replies.map((reply) => {
    if (reply.code) throw Error(`view3d refused: ${JSON.stringify(reply).slice(0, 800)}`);
    return new Map(reply.frames.filter((f) => f.final).map((f) => [f.frame, decode(readFileSync(join(out, `${f.final}.png`)))]));
  });
  const [b, p, l] = finals;
  const files = {
    'bokeh-disc.png': png(b.get(0)),
    'focus-pull.png': png(p.get(45)),
    'lid-leader.png': png(l.get(40)),
    'focus-pull-and-lid.apng': apng([...pullFrames.map((n) => p.get(n)), ...lidFrames.map((n) => l.get(n))], 15),
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(HERE, name), bytes);
    console.log(`${name} ${sha(bytes)}`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
