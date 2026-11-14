// Draws the #222 taste pictures from the canvas's own frames through `deep-show run`'s `eval` with pixels: a
// 40-cue explainer of the right triangle, written as one cue list that plays the first-party verbs (deepbuild/verbs)
// in order. Its texts fade rather than write: the frames don't yet draw a text's channel-driven reveal. Writes explainer-cue-01.png, -10, -20, -30 and -40 (the frames at the ends of those cues, read off the
// expansion's markers `cues.<id>`) and explainer.apng (the whole film at 8 fps) beside itself, and prints each
// SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FLICKS = 705_600_000;
const evidence = mkdtempSync(join(tmpdir(), 'deep-222-shoot-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stored = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
const SIZE = [640, 360];
const DOC = '01JB222S000000000000000001';

// The stage: a right triangle with legs 90 (up) and 120 (along), the squares on its sides, their labels, a dot that
// runs the hypotenuse, the formula, a counter and a star. `goal` and `back` are hidden shapes a morph reads.
const rect = (id, pos, half, role, extra = {}) => ({ id, kind: 'rect@1', name: id, order: `c${id}`, at: { pos: [...pos, 0], ...(extra.rot ? { rot: [0, 0, extra.rot] } : {}) },
  params: { box: [-half, -half, 2 * half, 2 * half], paint: { fill: { role }, stroke: { role: 'ink', width: 2 } } } });
const text = (id, pos, s, size) => ({ id, kind: 'text@1', name: id, order: `t${id}`, at: { pos: [...pos, 0] },
  params: { text: s, font: 'body', size, paint: { fill: { role: 'ink' } } } });
const path = (id, d, role, extra = {}) => ({ id, kind: 'path@1', name: id, order: `p${id}`, params: { d, paint: { stroke: { role, width: 3 } } }, ...extra });
/** A shape the cues read but nobody sees. */
const unseen = (id, d) => path(id, d, 'ink', { adjust: { opacity: 0 } });
const TRI = 'M 250 220 L 370 220 L 250 130 Z';
const items = [
  { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
  { id: 'ground', kind: 'rect@1', name: 'ground', order: 'a1', params: { box: [-400, -400, 1440, 1200], paint: { fill: { role: 'ground' } } } },
  rect('sqa', [205, 175], 45, 'muted'),
  rect('sqb', [310, 280], 60, 'muted'),
  rect('sqc', [370, 130], 75, 'accent', { rot: 36.87 }),
  path('tri', TRI, 'ink'),
  unseen('goal', 'M 250 130 L 370 130 L 370 220 L 250 220 Z'),
  unseen('back', TRI),
  unseen('hyp', 'M 250 130 L 370 220'),
  path('star', 'M 540 60 L 552 92 L 586 92 L 558 112 L 568 146 L 540 126 L 512 146 L 522 112 L 494 92 L 528 92 Z', 'accent'),
  rect('dot', [250, 130], 6, 'accent'),
  text('title', [40, 40], 'Right triangles', 28),
  text('la', [205, 175], 'a', 24),
  text('lb', [310, 280], 'b', 24),
  text('lc', [370, 130], 'c', 24),
  text('formula', [470, 250], 'a² + b² = c²', 28),
  text('count', [500, 300], '', 24),
];
const C = (id, rest) => ({ id, ...rest });
const cues = [
  C('triangle', { kind: 'create', targets: ['tri'] }),
  C('title', { kind: 'fade_in', targets: ['title'], params: { shift: [-20, 0, 0] } }),
  C('square_a', { kind: 'grow', targets: ['sqa'] }),
  C('square_b', { when: 'with', kind: 'grow', targets: ['sqb'] }),
  C('square_c', { kind: 'spin_in', targets: ['sqc'] }),
  C('label_a', { kind: 'fade_in', targets: ['la'], span: '0.5s' }),
  C('label_b', { when: 'with', kind: 'fade_in', targets: ['lb'], span: '0.5s' }),
  C('label_c', { when: 'with', kind: 'fade_in', targets: ['lc'], span: '0.5s' }),
  C('look', { span: '0.5s' }),
  C('show_a', { kind: 'indicate', targets: ['sqa'] }),
  C('show_b', { kind: 'indicate', targets: ['sqb'] }),
  C('frame_b', { kind: 'circumscribe', targets: ['sqb'] }),
  C('dot_in', { kind: 'fade_in', targets: ['dot'], params: { shift: [0, -20, 0] }, span: '0.5s' }),
  C('run', { kind: 'move_along', targets: ['dot'], params: { path: 'hyp' }, span: '1.5s' }),
  C('wiggle_c', { kind: 'wiggle', targets: ['sqc'] }),
  C('formula', { kind: 'fade_in', targets: ['formula'], params: { shift: [20, 0, 0] } }),
  C('wiggle_formula', { kind: 'wiggle', targets: ['formula'] }),
  C('count_in', { kind: 'fade_in', targets: ['count'], span: '0.5s' }),
  C('count', { kind: 'count_to', targets: ['count'], params: { value: 25 }, span: '1.5s' }),
  C('flash_c', { kind: 'flash', targets: ['sqc'] }),
  C('think', { span: '0.5s' }),
  C('blink_a', { kind: 'blink', targets: ['sqa'], params: { count: 2 } }),
  C('blink_b', { when: 'with', kind: 'blink', targets: ['sqb'], params: { count: 2 } }),
  C('focus_c', { kind: 'focus', targets: ['sqc'] }),
  C('echo', { kind: 'broadcast', targets: ['tri'] }),
  C('turn_a', { kind: 'rotate', targets: ['sqa'] }),
  C('swap', { kind: 'swap', targets: ['sqa'], params: { with: 'sqb' } }),
  C('swap_back', { kind: 'swap', targets: ['sqa'], params: { with: 'sqb' } }),
  C('to_square', { kind: 'morph', targets: ['tri'], params: { to: 'goal' } }),
  C('to_triangle', { kind: 'morph', targets: ['tri'], params: { to: 'back' } }),
  C('cycle_1', { kind: 'cycle', targets: ['la', 'lb', 'lc'], span: '0.75s' }),
  C('cycle_2', { kind: 'cycle', targets: ['la', 'lb', 'lc'], span: '0.75s' }),
  C('cycle_3', { kind: 'cycle', targets: ['la', 'lb', 'lc'], span: '0.75s' }),
  C('star_in', { kind: 'spiral_in', targets: ['star'] }),
  C('star_out', { kind: 'shrink', targets: ['star'] }),
  C('triangle_out', { kind: 'uncreate', targets: ['tri'] }),
  C('squares_out', { kind: 'fade_out', targets: ['sqa', 'sqb', 'sqc'], lag: 0.25 }),
  C('rest_out', { when: 'with', kind: 'fade_out', targets: ['la', 'lb', 'lc', 'dot', 'count'] }),
  C('title_out', { kind: 'fade_out', targets: ['title'], params: { shift: [0, -20, 0] } }),
  C('formula_last', { kind: 'indicate', targets: ['formula'] }),
];
if (cues.length !== 40) throw Error(`the explainer holds ${cues.length} cues, not 40`);
const film = {
  format: 1, profile: 'film', title: '#222 the 40-cue explainer', description: 'Right triangles, as one cue list of 40 plays and waits.', size: SIZE, camera: 'cam',
  transport: { span: '40s' }, packs: ['deepbuild/verbs@1.0.0'],
  items: Object.fromEntries([...items, { id: 'list', kind: 'cues@1', name: 'Cue list', order: 'z0', params: { cues } }].map((i) => [i.id, i])),
};

const scenario = (calls) => ({
  evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [DOC]: { panel: 'main' } },
  packs: [{ id: 'deepbuild/verbs', dir: join(REPO, 'packs', 'verbs-1.0.0') }], calls,
});
const present = { call: 'deep show', peer: { pid: 3002, start: 3000 }, doc: DOC, document: film, include: ['issues'] };
function run(calls) {
  const r = spawnSync(join(REPO, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario(calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.split('\n').find((l) => l !== ''));
  if (!answer.ok) throw Error(`deep-show refused: ${r.stdout.slice(0, 800)} ${r.stderr.slice(-800)}`);
  if (answer.replies[0].outcome !== 'presented') throw Error(`the explainer isn't presented: ${JSON.stringify(answer.replies[0].issues).slice(0, 1500)}`);
  return answer.replies;
}
const [shown] = run([present]);
const markers = shown.expansions.find((e) => e.instance === 'list').markers;
const end = (k) => { const m = markers[`cues.${cues[k - 1].id}`]; return m.t + m.span; };
const last = Math.max(...Object.values(markers).map((m) => m.t + m.span));
const FPS = 8;
const recording = Array.from({ length: Math.floor((last * FPS) / FLICKS) + 2 }, (_, k) => Math.min(last, Math.round((k * FLICKS) / FPS)));
const stills = [1, 10, 20, 30, 40].map(end);
const replies = run([present, ...[...stills, ...recording].map((t) => ({ call: 'eval', doc: DOC, t, pixels: true }))]).slice(1);
const frames = replies.map((e) => stored(e.snapshots[0].sha256));

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
  'explainer-cue-01.png': frames[0],
  'explainer-cue-10.png': frames[1],
  'explainer-cue-20.png': frames[2],
  'explainer-cue-30.png': frames[3],
  'explainer-cue-40.png': frames[4],
  'explainer.apng': apng(frames.slice(5), FPS),
};
for (const [name, bytes] of Object.entries(pictures)) {
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${sha(bytes)}`);
}
