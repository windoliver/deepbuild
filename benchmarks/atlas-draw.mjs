// #2386's budget, the `atlas-draw` mode of benchmarks/canvas.mjs (task `canvas-atlas-draw`): what `atlas.draw` and
// `atlas.anchor` add to a frame of 10,000 atlas rows. A release deep-show's `frames` of two documents that differ by
// the two fields alone: 10,000 rows on a 100 × 100 square grid of 4 u cells, each a 4 × 8 px tile with `draw: [4, 8]`
// and `anchor: [0.5, 0.75]`, and the same set without them, each sliding 15 u a second along x by a keyed channel on
// its `at.pos`, so each of the 300 frames at 60 fps places every row again. A side's reading is the median `frame_ms`
// of frames 1 to 299, and a run's the side with `draw` less the side without, the side that goes first alternating.
// One warm-up run and five, each a fresh process. The stage is tests/acceptance/2386/ac6-budget.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png, store } from './game-state.mjs';

const DOC = (n) => `01JB2386B${String(n).padStart(17, '0')}`;
const SESSION = { s1: { thread: 'thread-2386', name: 'bench', process: { pid: 4100, start: 1000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1000 }];
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'The #2386 budget fixture.' };
const ROWS = 10_000;
const FRAMES = 300;
const SLIDE = 15;
const SIZE = [404 + 6 * SLIDE, 408];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const column = (dtype, values) => ({ dtype, len: values.length, data: Buffer.from((dtype === 'i32' ? Int32Array : Uint16Array).from(values).buffer).toString('base64') });

function rows(atlas, draw) {
  const cells = Array.from({ length: ROWS }, (_, i) => [i % 100, Math.floor(i / 100)]);
  const set = { id: 'rows', kind: 'marks@1', name: 'Rows', order: 'a1', at: { pos: [4, 8, 0] }, params: {
    mark: 'image', n: ROWS, atlas: { asset: atlas, cell: [4, 8], padding: 1, ...(draw ? { draw: [4, 8], anchor: [0.5, 0.75] } : {}) },
    grid: { shape: 'square', cell: [4, 4] },
    columns: { cx: column('i32', cells.map(([cx]) => cx)), cy: column('i32', cells.map(([, cy]) => cy)), tile: column('u16', cells.map(([cx, cy]) => (cx + cy) % 2)) } } };
  const cam = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } };
  return { format: 1, id: draw ? 'rows-draw' : 'rows-plain', profile: 'film', title: 'Rows', description: '#2386 budget: 10,000 atlas rows.', size: SIZE, seed: 2386,
    camera: 'cam', transport: { span: '6s', frame_rate: [60, 1] }, items: { cam, rows: set }, assets: { rows_atlas: { sha256: atlas, license: LICENSE } },
    channels: { slide: { target: 'items/rows/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 4, interp: 'linear' }, k1: { t: '6s', value: 4 + 6 * SLIDE, interp: 'linear' } } } } };
}

export function atlasDraw({ release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  const dir = mkdtempSync(join(tmpdir(), 'deep-atlas-draw-bench-'));
  try {
    let run = 0;
    const measured = runs(() => {
      const evidence = join(dir, `evidence-${run}`);
      const atlas = store(evidence, png(8, 8, (x) => (x < 4 ? [64, 112, 72, 255] : [236, 196, 64, 255])));
      // The side with `draw` is document 1; it goes first on every other run.
      const order = run++ % 2 === 0 ? [1, 2] : [2, 1];
      const calls = order.flatMap((n) => [
        { call: 'deep_show', session: 's1', doc: DOC(n), document: rows(atlas, n === 1), include: ['issues'] },
        { call: 'frames', doc: DOC(n), count: FRAMES, step: '1f', pixels: false },
      ]);
      const panels = { p1: { rect: [0, 0, 808, 816] }, p2: { rect: [0, 0, 808, 816] } };
      const answer = once('deep-show', ['run'], { evidence, sessions: SESSION, processes: PROCESSES, panels, docs: { [DOC(1)]: { panel: 'p1' }, [DOC(2)]: { panel: 'p2' } }, calls });
      const r = answer.replies ?? [];
      if (r[0]?.outcome !== 'presented' || r[2]?.outcome !== 'presented' || [r[1], r[3]].some((f) => f?.frames?.length !== FRAMES)) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const ms = (n) => median(r[2 * order.indexOf(n) + 1].frames.slice(1).map((f) => f.frame_ms));
      rmSync(evidence, { recursive: true, force: true });
      return { draw_rows_frame_ms: Math.max(0, ms(1) - ms(2)), plain_frame_ms: ms(2) };
    });
    console.log(JSON.stringify({ task: 'canvas-atlas-draw', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
