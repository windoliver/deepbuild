// #2039's budget, the `atlas-slice` mode of benchmarks/canvas.mjs (task `canvas-atlas-slice`): what `slice` adds to a
// frame of 500 free atlas rows. A release deep-show's `frames` of two documents that differ by the issue's fields
// alone: 500 rows of one 24 × 24 px cell, 25 across and 20 down, each with `slice` 8 on each side and its own box, 32
// to 48 u wide and 32 or 40 u tall, and the same rows with no `slice`, `w` and `h`, one quad of the whole cell a row,
// each set sliding 15 u a second along x by a keyed channel on its `at.pos`, so each of the 300 frames at 60 fps
// places every row again. A side's reading is the median `frame_ms` of frames 1 to 299, and a run's the side with
// `slice` less the side without, the side that goes first alternating. One warm-up run and five, each a fresh
// process. The stage is tests/acceptance/2039/ac4-budget.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png, store } from './game-state.mjs';

const DOC = (n) => `01JB2039B${String(n).padStart(17, '0')}`;
const SESSION = { s1: { thread: 'thread-2039', name: 'bench', process: { pid: 4100, start: 1000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1000 }];
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'The #2039 budget fixture.' };
const ROWS = 500;
const FRAMES = 300;
const SLIDE = 15;
const SIZE = [1304 + 6 * SLIDE, 884];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const column = (dtype, values) => ({ dtype, len: values.length, data: Buffer.from((dtype === 'f32' ? Float32Array : Uint16Array).from(values).buffer).toString('base64') });

function rows(atlas, slice) {
  const boxes = Array.from({ length: ROWS }, (_, i) => ({ x: 24 + 52 * (i % 25), y: 20 + 44 * Math.floor(i / 25), w: 32 + 8 * (i % 3), h: 32 + 8 * (i % 2) }));
  const of = (name) => column('f32', boxes.map((b) => b[name]));
  const set = { id: 'rows', kind: 'marks@1', name: 'Rows', order: 'a1', at: { pos: [4, 4, 0] }, params: {
    mark: 'image', n: ROWS, place: 'free', atlas: { asset: atlas, cell: [24, 24], padding: 1 }, grid: { shape: 'square', cell: [24, 24] },
    ...(slice ? { slice: { left: 8, top: 8, right: 8, bottom: 8 } } : {}),
    columns: { x: of('x'), y: of('y'), ...(slice ? { w: of('w'), h: of('h') } : {}), tile: column('u16', boxes.map(() => 4)) } } };
  const cam = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } };
  return { format: 1, id: slice ? 'rows-slice' : 'rows-plain', profile: 'film', title: 'Rows', description: '#2039 budget: 500 free atlas rows.', size: SIZE, seed: 2039,
    camera: 'cam', transport: { span: '6s', frame_rate: [60, 1] }, items: { cam, rows: set }, assets: { rows_atlas: { sha256: atlas, license: LICENSE } },
    channels: { slide: { target: 'items/rows/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 4, interp: 'linear' }, k1: { t: '6s', value: 4 + 6 * SLIDE, interp: 'linear' } } } } };
}

export function atlasSlice({ release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  const dir = mkdtempSync(join(tmpdir(), 'deep-atlas-slice-bench-'));
  try {
    let run = 0;
    const measured = runs(() => {
      const evidence = join(dir, `evidence-${run}`);
      // Nine 24 × 24 px cells, the rows' the middle one, each texel its column and line.
      const atlas = store(evidence, png(72, 72, (x, y) => [10 * (x % 24) + 5, 10 * (y % 24) + 5, x >= 24 && x < 48 && y >= 24 && y < 48 ? 0 : 255, 255]));
      // The side with `slice` is document 1; it goes first on every other run.
      const order = run++ % 2 === 0 ? [1, 2] : [2, 1];
      const calls = order.flatMap((n) => [
        { call: 'deep_show', session: 's1', doc: DOC(n), document: rows(atlas, n === 1), include: ['issues'] },
        { call: 'frames', doc: DOC(n), count: FRAMES, step: '1f', pixels: false },
      ]);
      const panels = { p1: { rect: [0, 0, ...SIZE] }, p2: { rect: [0, 0, ...SIZE] } };
      const answer = once('deep-show', ['run'], { evidence, sessions: SESSION, processes: PROCESSES, panels, docs: { [DOC(1)]: { panel: 'p1' }, [DOC(2)]: { panel: 'p2' } }, calls });
      const r = answer.replies ?? [];
      if (r[0]?.outcome !== 'presented' || r[2]?.outcome !== 'presented' || [r[1], r[3]].some((f) => f?.frames?.length !== FRAMES)) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const ms = (n) => median(r[2 * order.indexOf(n) + 1].frames.slice(1).map((f) => f.frame_ms));
      rmSync(evidence, { recursive: true, force: true });
      return { slice_rows_frame_ms: Math.max(0, ms(1) - ms(2)), plain_frame_ms: ms(2) };
    });
    console.log(JSON.stringify({ task: 'canvas-atlas-slice', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
