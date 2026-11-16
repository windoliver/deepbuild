// The playable page's budget (issue #169, #169.e6c2fc38): node benchmarks/page.mjs, for the perf lane. One `deep-show
// run` (target/debug) exports a 2D walkthrough as a page at 320 × 180 and 30 fps: a stages control of four stages, an
// explode toggle that eases a lid open over 1 s and a three-option finish, 24 states and 144 edges, each state's still
// and each edge's clip rendered through the export. It prints the receipt's timing.wall and the bytes written as one
// JSON line. The criterion's own limits (the 1080p30 walkthrough in under 4 minutes and 250 MB, the player under
// 100 KB) stay with tests/acceptance/169/budgets.test.ts on a reference Mac.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOC = '01JB169B000000000000000001';
const rect = (id, box, role, k) => ({ id, kind: 'rect@1', name: `Part ${id}`, role: 'part', order: `a${String(k).padStart(4, '0')}`, params: { box, paint: { fill: { role } } } });
const stages = Object.fromEntries(['one', 'two', 'three', 'four'].map((s) => [s, { label: s }]));
const document = {
  format: 1, id: DOC, profile: 'figure', title: 'Page export bench', description: 'Four stages, an explode toggle and three finishes.', size: [320, 180], camera: 'cam',
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    { ...rect('back', [0, 0, 320, 180], 'ground', 1), role: 'decoration' },
    { ...rect('band', [0, 120, 320, 60], 'ink', 2), role: 'decoration' },
    rect('base', [100, 90, 120, 30], 'muted', 3),
    rect('lid', [100, 60, 120, 25], 'accent', 4),
  ].map((i) => [i.id, i])),
  transport: { span: '2s', frame_rate: [30, 1] },
  controls: {
    tour: { kind: 'stages', class: 'document', label: 'Tour', role: 'tablist', default: 'one', stages },
    explode: { kind: 'toggle', class: 'document', label: 'Explode', role: 'switch', default: false },
    finish: { kind: 'choice', class: 'document', label: 'Finish', role: 'radiogroup', variant: 'finish', default: 'muted' },
  },
  variants: { finish: { default: 'muted', options: ['muted', 'accent', 'ink'].map((r) => ({ name: r, patch: [{ op: 'set', path: 'items/base/params/paint/fill/role', value: r }] })) } },
  channels: { fade: { target: 'items/lid/adjust/opacity', type: 'f32', mode: 'follow', follow: { source: 'controls/explode/value', model: { transition: { span: '1s', interp: 'linear' } } } } },
};
const evidence = mkdtempSync(join(tmpdir(), 'deep-page-bench-'));
try {
  const peer = { pid: 3002, start: 3_000 };
  const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
  const calls = [{ call: 'deep show', peer, doc: DOC, document }, { call: 'export', doc: DOC, out: join(evidence, 'page'), video: { codec: 'page' }, size: [320, 180], frame_rate: [30, 1] }];
  const sc = { evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
  const out = spawnSync(join(root, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (out.status !== 0) throw Error(`deep-show run exited ${out.status}: ${out.stderr}`);
  const reply = JSON.parse(out.stdout.trim()).replies?.[1];
  if (reply?.outcome !== 'exported') throw Error(`the page wasn't exported: ${JSON.stringify(reply).slice(0, 2000)}`);
  console.log(JSON.stringify({ task: 'page-export', states: reply.receipt.states, edges: reply.receipt.edges, wall_seconds: reply.receipt.timing?.wall, bytes: reply.receipt.bytes }));
} finally {
  rmSync(evidence, { recursive: true, force: true });
}
