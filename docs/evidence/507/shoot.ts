// Takes #507's taste pictures from `deep-show run`, the binary that plays the hub's canvas side, its displays and its
// present mode, on the suite's own pieces (tests/acceptance/507/helpers.ts):
// - stage-full-screen.png: stage 3 of the nine-stage piece as present mode shows it full screen on a display at the
//   reference window (1512 × 982 points at 2×), its frame letterboxed;
// - presenter-view.png: the presenter view on the second display, drawn by the canvas from the `presenter` call's own
//   fields while stage 3 holds (the stage's number, name and notes, the elapsed time), with the next stage's first frame;
// - handout-page.png: page 3 of the `pdf` handout with notes, rendered by poppler's pdftoppm;
// - held-loop.apng: the loop film reaching its looped stage and holding on the span, frames from present mode's session.
// Writes them beside itself and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node --experimental-strip-types docs/evidence/507/shoot.ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { A, B, DISPLAY_A, DISPLAY_B, DOC, ENTER, FILM_PANEL, MS, NINE_NAMES, click, evalAt, fl, key, loopFilm, ninePiece, present } from '../../../tests/acceptance/507/helpers.ts';

type Json = any;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const evidence = mkdtempSync(join(tmpdir(), 'deep-507-shoot-'));
const scratch = mkdtempSync(join(tmpdir(), 'deep-507-shoot-out-'));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const stored = (h: string): Buffer => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

function run(scenario: Json): Json[] {
  const r = spawnSync(BIN, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== '') ?? '{}');
  if (!answer.ok) throw Error(`deep-show refused the scenario: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  for (const reply of answer.replies) if (reply.outcome === 'refused') throw Error(`a call was refused: ${JSON.stringify(reply).slice(0, 800)}`);
  return answer.replies;
}
/** A room: the scenario's displays and virtual clock, the piece's panel in the main window, calls in time order. */
function room(displays: Json[], doc: string, calls: Json[]): Json[] {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => p.c.at - q.c.at || p.i - q.i).map((p) => p.c);
  const replies = run({ evidence, sessions: {}, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 }, displays, window: [1200, 700],
    panels: { [FILM_PANEL]: { rect: [0, 0, 960, 540] } }, docs: { [doc]: { panel: FILM_PANEL } }, calls: sorted });
  return calls.map((c) => replies[sorted.indexOf(c)]);
}
/** The calls that put `doc` in present mode on `display` at ENTER: shown, your click, its pop-out full screen. */
function entering(displays: Json[], doc: string, document: Json, display: string): Json[] {
  const base = [present(doc, document, 2 * MS), ...click(100 * MS, FILM_PANEL)];
  const serial = room(displays, doc, base)[1].serial;
  return [...base, { call: 'pop_out', at: ENTER, panel: FILM_PANEL, display, serial, full_screen: true }];
}

// ---- PNG: decode 8-bit RGB/RGBA, paste, encode RGBA; an animated PNG of unchanged frames (#504's shoot.mjs).
interface Img { w: number; h: number; rgba: Buffer }
function decode(file: Buffer): Img {
  let p = 8; let w = 0; let h = 0; let color = 0; const data: Buffer[] = [];
  while (p < file.length) {
    const n = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); color = body[9]!; } else if (type === 'IDAT') data.push(body);
    p += 12 + n;
  }
  const ch = color === 6 ? 4 : 3; const stride = w * ch; const raw = inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (f === 0 ? line[i]! : f === 1 ? line[i]! + a : f === 2 ? line[i]! + b : f === 3 ? line[i]! + ((a + b) >> 1) : line[i]! + paeth) & 255;
    }
    for (let x = 0; x < w; x++) { for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = line[x * ch + k]!; out[(y * w + x) * 4 + 3] = ch === 4 ? line[x * ch + 3]! : 255; }
    prev = line;
  }
  return { w, h, rgba: out };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function encode(img: Img): Buffer {
  const rows = Buffer.alloc(img.h * (img.w * 4 + 1));
  for (let y = 0; y < img.h; y++) img.rgba.copy(rows, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
/** A `w` × `h` picture filled with `rgba`, with each image pasted at its top-left corner. */
function canvas(w: number, h: number, rgba: number[], pasted: [Img, number, number][]): Img {
  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) out.set(rgba, p * 4);
  for (const [img, x0, y0] of pasted) for (let y = 0; y < img.h; y++) img.rgba.copy(out, ((y0 + y) * w + x0) * 4, y * img.w * 4, (y + 1) * img.w * 4);
  return { w, h, rgba: out };
}
function parts(png: Buffer): { ihdr: Buffer; data: Buffer } {
  let p = 8; const idat: Buffer[] = []; let ihdr = Buffer.alloc(0);
  while (p < png.length) {
    const n = png.readUInt32BE(p); const type = png.toString('latin1', p + 4, p + 8); const data = png.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') ihdr = data; if (type === 'IDAT') idat.push(data);
    p += 12 + n;
  }
  return { ihdr, data: Buffer.concat(idat) };
}
function apng(list: Buffer[], fps: number): Buffer {
  const first = parts(list[0]!);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(list.length);
  const out = [SIGNATURE, chunk('IHDR', first.ihdr), chunk('acTL', actl)];
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
const still = (out: string, marker: string, size: [number, number], at: number): Json =>
  ({ call: 'export', at, doc: DOC.nine, out, range: { still: { marker } }, video: { codec: 'png_seq' }, size });
const onlyPng = (dir: string): Buffer => {
  const ls = spawnSync('ls', [dir], { encoding: 'utf8' }).stdout.split('\n').filter((f) => f.endsWith('.png'));
  return readFileSync(join(dir, ls[0]!));
};
const written: Record<string, string> = {};
const save = (name: string, bytes: Buffer): void => { writeFileSync(join(HERE, name), bytes); written[name] = sha(bytes); };

// ---- The nine-stage piece presented on B: stage 3 held, the presenter view open on A, its stills and the handout.
const displays = [DISPLAY_A, DISPLAY_B];
const pdf = join(scratch, 'handout.pdf');
const calls = [
  ...entering(displays, DOC.nine, ninePiece(), B),
  key(fl(1), 'ArrowRight'), key(fl(6), 'ArrowRight'), key(fl(11), 'P', ['shift']),
  { call: 'presenter', at: fl(13) },
  still(join(scratch, 's3'), 's3', [3024, 1701], fl(13.5)),
  still(join(scratch, 's4'), 's4', [1400, 788], fl(13.6)),
  { call: 'export', at: fl(14), doc: DOC.nine, out: pdf, range: 'stages', video: { codec: 'pdf' }, pdf: { notes: true } },
];
const replies = room(displays, DOC.nine, calls);
const view = replies[calls.length - 4].presenter;
if (!view || view.display !== A) throw Error(`the presenter view isn't on A: ${JSON.stringify(view)}`);

// A stage full screen: the presented display at the reference window, the film letterboxed in it.
const stage = decode(onlyPng(join(scratch, 's3')));
save('stage-full-screen.png', encode(canvas(3024, 1964, [0, 0, 0, 255], [[stage, 0, Math.floor((1964 - stage.h) / 2)]])));

// The presenter view: its fields drawn as text by the canvas, the next stage's first frame beside them.
const name = (id: string, words: string, size: number, pos: [number, number], w = 640): Json =>
  ({ id, kind: 'text@1', name: id, order: `a${id}`, params: { text: words, name: true, font: 'body', size, box: { w, h: size * 2 }, align: 'start' }, at: { pos: [...pos, 0] } });
const seconds = (view.elapsed / fl(1)).toFixed(1);
const board = {
  format: 1, id: 'presenter-view', profile: 'board', title: 'The presenter view', description: 'What the presenter sees while stage 3 holds.', size: [1512, 982],
  items: Object.fromEntries([
    { id: 'ground', kind: 'rect@1', name: 'Ground', order: 'a0', params: { box: [0, 0, 1512, 982], paint: { fill: { role: 'ground' } } } },
    name('number', `Stage ${view.number} of 9`, 22, [48, 48]),
    name('title', view.name, 44, [48, 88]),
    name('elapsed', `Elapsed ${seconds} s`, 22, [48, 168]),
    name('notes_label', 'Notes', 18, [48, 248]),
    name('notes', view.notes, 28, [48, 280], 640),
    name('next_label', `Next: stage ${view.number + 1}, ${NINE_NAMES[view.number]}`, 18, [780, 248]),
  ].map((i) => [i.id, i])),
};
const [, evaluated] = run({ evidence, sessions: {}, processes: PROCESSES, panels: { p0: { rect: [0, 0, 1512, 982] } }, docs: { [board.id]: { panel: 'p0' } },
  calls: [present(board.id, board), { call: 'eval', doc: board.id, t: 0, pixels: true, size: [3024, 1964] }] });
const drawn = decode(stored(evaluated.snapshots[0].sha256));
const next = decode(onlyPng(join(scratch, 's4')));
const frame: Img = canvas(next.w + 8, next.h + 8, [120, 120, 128, 255], []);
save('presenter-view.png', encode(canvas(3024, 1964, [0, 0, 0, 255], [[drawn, 0, 0], [frame, 1556, 556], [next, 1560, 560]])));

// A page of the handout, page 3, rendered by poppler from the PDF the export wrote.
const page = join(scratch, 'page');
const r = spawnSync('/opt/homebrew/bin/pdftoppm', ['-png', '-f', '3', '-l', '3', '-singlefile', '-scale-to-x', '3024', '-scale-to-y', '-1', pdf, page], { encoding: 'utf8' });
if (r.status !== 0) throw Error(`pdftoppm: ${r.stderr}`);
save('handout-page.png', readFileSync(`${page}.png`));

// The held loop: the loop film in present mode on A, from 2 s before its looped stage through 7 s of the hold, 15 fps.
const loopIn = entering([DISPLAY_A], DOC.loop, loopFilm(), A);
const [advanced] = room([DISPLAY_A], DOC.loop, [...loopIn, key(fl(1), 'ArrowRight')]).slice(-1);
const e1: number = advanced.appended[0].t;
const times = Array.from({ length: 9 * 15 }, (_, k) => e1 + fl(4) + Math.round((k * fl(1)) / 15));
const evals = times.map((t) => ({ ...evalAt(t, DOC.loop), pixels: true, size: [1512, 851] }));
const frames = room([DISPLAY_A], DOC.loop, [...loopIn, key(fl(1), 'ArrowRight'), ...evals]).slice(-evals.length);
save('held-loop.apng', apng(frames.map((f) => stored(f.snapshots[0].sha256)), 15));

for (const [file, digest] of Object.entries(written)) console.log(`${digest}  ${file}`);
