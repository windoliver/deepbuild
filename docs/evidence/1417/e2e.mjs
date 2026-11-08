// #1417's e2e through the canvas check path: `deep-show run`'s `deep_show` call, the shipped build, a board in the
// data view class (2 ms of frame CPU) holding one graph@1 item of 1,000, 10,000 and 100,000 nodes, and the same
// 100,000 nodes beside a rect a clip moves, and in the export class (no frame cap). Prints each reply's outcome and
// over_budget issue.
//   node docs/evidence/1417/e2e.mjs target/debug/deep-show
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.argv[2];
const sizes = { 1000: [20, 50], 10000: [40, 250], 100000: [100, 1000] };
function graph(ranks, width) {
  const nodes = []; const edges = [];
  for (let r = 0; r < ranks; r++) for (let j = 0; j < width; j++) {
    nodes.push({ id: `v${r}x${j}`, w: 40 + 8 * ((r + j) % 5), h: 30 });
    if (r > 0) {
      edges.push({ id: `e${r}x${j}`, a: `v${r - 1}x${j}`, b: `v${r}x${j}` });
      if (j % 2 === 1) edges.push({ id: `f${r}x${j}`, a: `v${r - 1}x${j - 1}`, b: `v${r}x${j}` });
    }
  }
  return { nodes, edges };
}
const cases = [[1000, 'data_view'], [10000, 'data_view'], [100000, 'data_view'], [100000, 'data_view', 'moving'], [100000, 'export']];
for (const [n, cls, moving] of cases) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1417-e2e-'));
  const doc = `01JB1417E2E00000000000${String(n).length}${cls === 'export' ? 'X' : 'D'}${moving ? 'M' : 'S'}`;
  const document = {
    format: 1, profile: 'board', seed: 1417, title: `A ${n}-node graph`, description: `A layered graph of ${n} nodes.`,
    size: [1280, 720], budget: { class: cls },
    items: { g: { id: 'g', kind: 'graph@1', name: 'Graph', order: 'a0', params: { graph: graph(...sizes[n]), layout: { algo: 'layered', direction: 'down', seed: 1417 } } } },
  };
  if (moving) {
    document.items.mover = { id: 'mover', kind: 'rect@1', name: 'Mover', order: 'a1', params: { box: [0, 0, 40, 30], paint: { fill: { role: 'ink' } } }, at: { pos: [16, 80, 0] } };
    document.clips = { slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 16, interp: 'linear' }, k1: { t: '2s', value: 260, interp: 'linear' } } } } } };
    document.placements = { p: { clip: 'slide', slots: { target: 'mover' }, start: '0s' } };
  }
  const scenario = {
    evidence, sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: graphs', process: { pid: 4100, start: 1000 } } },
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc, document, include: ['issues'] }],
  };
  const r = spawnSync(bin, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 ** 30 });
  rmSync(evidence, { recursive: true, force: true });
  const reply = JSON.parse(r.stdout.trim()).replies[0];
  const over = (reply.issues ?? []).filter((i) => i.code === 'over_budget');
  console.log(`${n} nodes, ${cls}${moving ? ', beside a moving rect' : ''}: outcome ${reply.outcome}; over_budget: ${over.length ? JSON.stringify(over.map(({ fix_ops, ...i }) => i)) : 'none'}`);
}
