// Shoots the #177 taste pictures from the app at the reference window on this Mac's XDR display, through `deep-app
// --hdr` (the hdr-fixture build): the lamp at 8 times paper white with HDR on and with HDR off, and the question card
// over the view with HDR on. The window is the app's real one, its HDR surface beneath GPUI's layer, so the screen must
// be unlocked; the display is held awake with caffeinate while it runs. A PNG can't hold light above paper white, so
// each picture is the window as the compositor composited it, every value divided by the headroom the HDR frame
// rolled off to: paper white (the page) reads 1 ÷ headroom and the lamp at the headroom reads full white. The HDR-off
// picture is divided by the same headroom, so the two compare like for like. Writes lamp-hdr-on.png, lamp-hdr-off.png
// and card-over-view.png beside itself and prints each SHA-256 and the headroom. Run from the repository root after
// `cargo build --locked --release -p deep-app --bin deep-app --features hdr-fixture`.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const APP = join(REPO, 'target', 'release', 'deep-app');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// The suite's own fixtures: the lamps (a lamp at 8 times paper white, a highlight at 2, mid-grey), the big lamp and
// the look whose agx white is the lamp's 8 (tests/acceptance/177/helpers.ts).
const helpers = await import(join(REPO, 'tests', 'acceptance', '177', 'helpers.ts'));
const dir = mkdtempSync(join(tmpdir(), 'deep-177-shoot-'));
const awake = spawn('caffeinate', ['-d', '-u', '-t', '600'], { stdio: 'ignore' });
try {
  writeFileSync(join(dir, 'lamps.json'), JSON.stringify(helpers.lampsDoc()));
  writeFileSync(join(dir, 'big.json'), JSON.stringify(helpers.bigLampDoc()));
  const base = { format: 'hdr-fixture@1', look: helpers.LOOK, window: [1000, 560], page: [255, 255, 255], view: [60, 40, 880, 440], frames: 90, captures: true };
  const card = { question: 'Keep the lamp this bright?', options: [{ label: 'Keep' }, { label: 'Dim' }], rect: [330, 150, 340, 180] };
  const play = (name, scenario) => {
    const out = join(dir, name);
    spawnSync('mkdir', ['-p', out]);
    const file = join(out, 'scenario.json');
    writeFileSync(file, JSON.stringify({ ...base, out, ...scenario }));
    const r = spawnSync(APP, ['--hdr', file], { encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' });
    const line = (r.stdout ?? '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((v) => v?.hdr === 177);
    if (!line) throw Error(`deep-app --hdr ${name}: no report (${r.status ?? r.signal}): ${(r.stderr ?? '').slice(-600)}`);
    return line.frames.at(-1);
  };
  const on = play('on', { doc: join(dir, 'lamps.json'), hdr: 'auto', divide_by_headroom: true });
  if (on.state !== 'on' || !(on.headroom > 1)) throw Error(`HDR didn't show: ${JSON.stringify(on)}`);
  const off = play('off', { doc: join(dir, 'lamps.json'), hdr: 'off' });
  const over = play('card', { doc: join(dir, 'big.json'), hdr: 'auto', divide_by_headroom: true, card });
  copyFileSync(on.capture, join(HERE, 'lamp-hdr-on.png'));
  writeFileSync(join(HERE, 'lamp-hdr-off.png'), divided(readFileSync(off.capture), on.headroom));
  copyFileSync(over.capture, join(HERE, 'card-over-view.png'));
  for (const name of ['lamp-hdr-on.png', 'lamp-hdr-off.png', 'card-over-view.png']) console.log(`${name} ${sha(readFileSync(join(HERE, name)))}`);
  console.log(`headroom ${on.headroom.toFixed(3)} (card ${over.headroom.toFixed(3)})`);
} finally {
  awake.kill();
  rmSync(dir, { recursive: true, force: true });
}

/** An 8-bit RGBA PNG with every value divided by `headroom` in linear light, re-encoded. */
function divided(png, headroom) {
  const { width, height, rgba } = decode(png);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) rgba[i + c] = enc(lin(rgba[i + c]) / headroom);
  return encode(width, height, rgba);
}

function decode(png) {
  let o = 8; let width = 0; let height = 0; const idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o); const type = png.toString('ascii', o + 4, o + 8); const data = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)); const stride = width * 4; const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0; const b = y > 0 ? rgba[(y - 1) * stride + x] : 0; const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      rgba[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { width, height, rgba };
}

function encode(width, height, rgba) {
  const stride = width * 4; const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
