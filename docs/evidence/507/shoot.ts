// Takes #507's taste pictures from `deep-show run`, the binary that plays the hub's canvas side, its displays and its
// present mode. Every picture is one deep-show draws: the presented display and the presenter view come from the
// `present` and `presenter` calls with `pixels: true`, and the handout page is the `pdf` export's page 3 rendered by
// poppler's pdftoppm. The pieces are made here so a viewer can read them: each stage shows its title, and a bar along
// the bottom grows with the timeline's position, so it stops while a stage holds and swings back while a loop replays.
// - stage-full-screen.png: stage 3 of a nine-stage talk held full screen on display B, at the reference window
//   (1512 × 982 points at 2×), its 16:9 frame letterboxed;
// - presenter-view.png: the presenter view on display A at the same moment: the stage's number, name and notes, the
//   elapsed time and the next stage's first frame;
// - handout-page.png: page 3 of the talk's `pdf` handout with notes, its stills exported at 1920 × 1080;
// - held-loop.apng: the loop piece's presented display at 12 fps: it plays to its looped stage, holds 7 s while the
//   span [4 s, 6 s) replays, then the advance goes on from the stage.
// Writes them beside itself and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node --experimental-strip-types docs/evidence/507/shoot.ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, B, DISPLAY_A, DISPLAY_B, ENTER, FILM_PANEL, MS, NINE_NAMES, click, fl, key, noteOf, present } from '../../../tests/acceptance/507/helpers.ts';

type Json = any;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const evidence = mkdtempSync(join(tmpdir(), 'deep-507-shoot-'));
const scratch = mkdtempSync(join(tmpdir(), 'deep-507-shoot-out-'));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const stored = (h: string): Buffer => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const REFERENCE = [3024, 1964];

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
  const shown = room(displays, doc, base);
  if (shown[0].outcome !== 'presented') throw Error(`the piece isn't presented: ${JSON.stringify(shown[0]).slice(0, 1500)}`);
  return [...base, { call: 'pop_out', at: ENTER, panel: FILM_PANEL, display, serial: shown[1].serial, full_screen: true }];
}
const pictureOf = (p: Json, what: string): Buffer => {
  if (!p?.sha256) throw Error(`${what} has no picture: ${JSON.stringify(p).slice(0, 400)}`);
  return stored(p.sha256);
};

// ---- The pieces: 640 × 360 at 30 fps, a title per stage, the position bar along the bottom and a block that slides.
const ulid = (k: number): string => `01JB507E${String(k).padStart(18, '0')}`;
const at = (s: number): string => `${s}s`;
const shownOver = (id: string, from: number, to: number): Json => ({
  target: `items/${id}/adjust/opacity`, type: 'f32',
  keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: at(from), value: 1, interp: 'hold' }, k2: { t: at(to), value: 0, interp: 'hold' } },
});
const linear = (target: string, a: number, b: number, to: number): Json =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: at(to), value: b, interp: 'linear' } } });
function piece(id: string, title: string, span: number, titles: [string, string, number, number][], markers: Json): Json {
  const items: Json[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a000cam', params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640 } },
    { id: 'back', kind: 'rect@1', name: 'Ground', order: 'a0001', params: { box: [0, 0, 640, 360], paint: { fill: { role: 'ground' } } } },
    { id: 'track', kind: 'rect@1', name: 'Track', order: 'a0002', params: { box: [0, 338, 640, 10], paint: { fill: { role: 'muted' } } } },
    { id: 'bar', kind: 'rect@1', name: 'Position', order: 'a0003', params: { box: [0, 338, 0, 10], paint: { fill: { role: 'accent' } } } },
    { id: 'mover', kind: 'rect@1', name: 'Mover', order: 'a0004', params: { box: [0, 250, 48, 48], paint: { fill: { role: 'ink' } } } },
    ...titles.map(([tid, words], k) => ({ id: tid, kind: 'text@1', name: `Title ${tid}`, order: `a01${String(k).padStart(2, '0')}`,
      params: { text: words, font: 'body', size: 44, box: { w: 576, h: 64 }, align: 'start' }, at: { pos: [32, 96, 0] } })),
  ];
  return {
    format: 1, id, profile: 'film', title, description: `${title}: the #507 taste pictures' piece.`, size: [640, 360], safe: 24, camera: 'cam',
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    transport: { span: at(span), frame_rate: [30, 1], sample_rate: 48_000 },
    markers,
    channels: {
      grow: linear('items/bar/params/box/2', 0, 640, span), slide: linear('items/mover/params/box/0', 0, 592, span),
      ...Object.fromEntries(titles.map(([tid, , from, to]) => [`show_${tid}`, shownOver(tid, from, to)])),
    },
  };
}
const TALK = ulid(1);
const talk = piece(TALK, 'A nine-stage talk', 36, NINE_NAMES.map((n, k): [string, string, number, number] => [`t${k + 1}`, n, 4 * k, 4 * k + 4]),
  Object.fromEntries(NINE_NAMES.map((n, k) => [`s${k + 1}`, { kind: 'stage', name: n, t: at(4 * k), notes: noteOf(k + 1) }])));
const LOOPED = ulid(2);
const looped = piece(LOOPED, 'A stage that holds on a loop', 16, [
  ['t_start', 'Playing toward the loop', 0, 4], ['t_span', 'The span the stage loops', 4, 6], ['t_after', 'Going on from the stage', 6, 16],
], {
  s1: { kind: 'stage', name: 'Start', t: '0s' },
  span_start: { kind: 'cue', name: 'The looped span starts', t: '4s' },
  s2: { kind: 'stage', name: 'The loop', t: '6s', hold: { loop: { from: 'span_start' } } },
  s3: { kind: 'stage', name: 'After', t: '14s' },
});

// ---- PNG chunks: an animated PNG of unchanged frames (#504's shoot.mjs).
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
const written: Record<string, string> = {};
const save = (name: string, bytes: Buffer): void => { writeFileSync(join(HERE, name), bytes); written[name] = sha(bytes); };

// ---- The talk presented on B: stage 3 held, the presenter view open on A, and its handout.
const displays = [DISPLAY_A, DISPLAY_B];
const pdf = join(scratch, 'handout.pdf');
const calls = [
  ...entering(displays, TALK, talk, B),
  key(fl(1), 'ArrowRight'), key(fl(6), 'ArrowRight'), key(fl(11), 'P', ['shift']),
  { call: 'present', at: fl(13), panel: FILM_PANEL, pixels: true, size: REFERENCE },
  { call: 'presenter', at: fl(13), pixels: true, size: REFERENCE },
  { call: 'export', at: fl(14), doc: TALK, out: pdf, range: 'stages', video: { codec: 'pdf' }, pdf: { notes: true }, size: [1920, 1080] },
];
const replies = room(displays, TALK, calls);
const [shown, view, handout] = replies.slice(-3);
if (shown.present.display !== B || shown.present.stage !== 's3') throw Error(`present mode isn't holding stage 3 on B: ${JSON.stringify(shown.present).slice(0, 300)}`);
if (view.presenter.display !== A) throw Error(`the presenter view isn't on A: ${JSON.stringify(view.presenter).slice(0, 300)}`);
if (handout.outcome !== 'exported') throw Error(`the handout isn't exported: ${JSON.stringify(handout).slice(0, 800)}`);
save('stage-full-screen.png', pictureOf(shown.present.picture, 'the presented display'));
save('presenter-view.png', pictureOf(view.presenter.picture, 'the presenter view'));
const page = join(scratch, 'page');
const r = spawnSync('/opt/homebrew/bin/pdftoppm', ['-png', '-f', '3', '-l', '3', '-singlefile', '-scale-to-x', '3024', '-scale-to-y', '-1', pdf, page], { encoding: 'utf8' });
if (r.status !== 0) throw Error(`pdftoppm: ${r.stderr}`);
save('handout-page.png', readFileSync(`${page}.png`));

// ---- The loop piece presented on A: its display at 12 fps from 2 s after the advance through 3 s past the hold.
const loopIn = entering([DISPLAY_A], LOOPED, looped, A);
const [advanced] = room([DISPLAY_A], LOOPED, [...loopIn, key(fl(1), 'ArrowRight')]).slice(-1);
const e1: number = advanced.appended[0].t;
const hold = e1 + fl(6);
const times = Array.from({ length: 14 * 12 }, (_, k) => e1 + fl(2) + Math.round((k * fl(1)) / 12));
const frames = times.map((t) => ({ call: 'present', at: t, panel: FILM_PANEL, pixels: true, size: [1512, 982] }));
const recorded = room([DISPLAY_A], LOOPED, [...loopIn, key(fl(1), 'ArrowRight'), key(hold + fl(7), 'ArrowRight'), ...frames]).slice(-frames.length);
save('held-loop.apng', apng(recorded.map((f, k) => pictureOf(f.present.picture, `frame ${k}`)), 12));

for (const [file, digest] of Object.entries(written)) console.log(`${digest}  ${file}`);
