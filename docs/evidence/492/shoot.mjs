// Draws the #492 taste pictures from the canvas's own frames: `deep-gpu run`'s `layers` call on four small films, a PNG
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
const SIZE = [480, 270];
const FRAMES = 48;
const SPAN = 2;

const key = (t, value, interp = 'linear') => ({ t: `${t}s`, value, interp });
const rect = (id, x, y, role, extra = {}) => ({ id, kind: 'rect@1', layer: 'main', name: id, order: `a${id}`, params: { box: [0, 0, 28, 28], paint: { fill: { role } } }, at: { pos: [x, y, 0] }, ...extra });
const film = (id, items, rest) => ({
  format: 1, id, profile: 'film', title: id, description: `The #492 taste film ${id}.`, size: SIZE, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  transport: { span: `${SPAN}s` }, items: Object.fromEntries(items.map((i) => [i.id, i])), ...rest,
});
const across = (from, to) => ({ channels: { x: { target: 'slot:s/at/pos/0', type: 'f32', keys: { a: key(0, from), b: key(SPAN, to) } } } });
const bob = { channels: { y: { target: 'slot:s/at/pos/1', type: 'f32', keys: { a: key(0, 0), b: key(0.5, -50), c: key(1, 0), d: key(1.5, -50), e: key(2, 0) } } } };

const FILMS = {
  // Top: one clip alone. Middle: the other alone. Bottom: both mixed at 0.5 each over the base at x = 226.
  'mix-placement': film('mix-placement', [rect('one', 226, 50, 'ink'), rect('two', 226, 120, 'accent'), rect('both', 226, 190, 'muted')], {
    clips: { right: across(60, 420), left: across(420, 60) },
    placements: {
      solo: { clip: 'right', slots: { s: 'one' }, start: '0s' },
      other: { clip: 'left', slots: { s: 'two' }, start: '0s', extend: { after: 'hold' } },
      m1: { clip: 'right', slots: { s: 'both' }, start: '0s', blend: 'mix', influence: 0.5 },
      m2: { clip: 'left', slots: { s: 'both' }, start: '0s', blend: 'mix', influence: 0.25 },
    },
  }),
  // Top: a walk across. Bottom: the same walk with a bob added on top, from the clip's first key.
  'add-placement': film('add-placement', [rect('walk', 60, 70, 'ink'), rect('rides', 60, 190, 'accent')], {
    clips: { walk: across(60, 420), bob },
    placements: {
      w1: { clip: 'walk', slots: { s: 'walk' }, start: '0s' },
      w2: { clip: 'walk', slots: { s: 'rides' }, start: '0s', order: 'a0' },
      nod: { clip: 'bob', slots: { s: 'rides' }, start: '0s', blend: 'add', order: 'a1' },
    },
  }),
  // Top: smooth. Bottom: the same keys in 8 steps, as animating on twos.
  'quantized-channel': film('quantized-channel', [rect('smooth', 60, 70, 'ink'), rect('stepped', 60, 190, 'accent')], {
    channels: {
      s: { target: 'items/smooth/at/pos/0', type: 'f32', keys: { a: key(0, 60), b: key(SPAN, 420) } },
      q: { target: 'items/stepped/at/pos/0', type: 'f32', keys: { a: key(0, 60, { quantize: { n: 8, jump: 'end' } }), b: key(SPAN, 420) } },
    },
  }),
  // Top: plain. Middle: a ramp from fast to slow. Bottom: a hitstop that holds, then rejoins.
  'time-remap': film('time-remap', [rect('plain', 60, 50, 'ink'), rect('ramped', 60, 120, 'accent'), rect('stopped', 60, 190, 'muted')], {
    clips: { walk: across(60, 420) },
    placements: {
      p0: { clip: 'walk', slots: { s: 'plain' }, start: '0s' },
      p1: { clip: 'walk', slots: { s: 'ramped' }, start: '0s', extend: { after: 'hold' } },
      p2: { clip: 'walk', slots: { s: 'stopped' }, start: '0s' },
    },
    time_remaps: {
      slow: { target: 'p1', map: { ramp: { from: '2/1', to: '1/2', at: '0.4s', over: '0.8s' } } },
      stop: { target: 'p2', map: { hitstop: { at: ['0.6s', '1.2s'], hold: '0.24s', then: 'rejoin' } } },
    },
  }),
};

const flick = (n) => Math.round((n * SPAN * FLICKS) / FRAMES);
const out = mkdtempSync(join(tmpdir(), 'deep-492-shots-'));
const names = Object.keys(FILMS);
const calls = names.flatMap((name) => Array.from({ length: FRAMES }, (_, n) => ({ call: 'layers', doc: FILMS[name], look: 'clean', by: ['gpu_layer'], t: flick(n) })));
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
  const still = pngs[Math.floor(FRAMES * 0.45)]; const moving = apng(pngs, FRAMES / SPAN);
  writeFileSync(join(HERE, `${name}.png`), still); writeFileSync(join(HERE, `${name}.apng`), moving);
  console.log(`${name}.png  ${sha(still)}\n${name}.apng  ${sha(moving)}`);
});
