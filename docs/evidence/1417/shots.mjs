// #1417's screenshots through the same path as e2e.mjs: `deep-show run`'s `deep_show` call on the shipped build,
// asking for the issues and the pixels of t = 0. Each board holds one graph@1 item, scaled so its whole layout
// fits the frame from (8, 8) with 8 px to spare (graph@1 draws its nodes' boxes only); a refused board draws nothing, so
// its PNG is absent and its reply says why. Writes <out>/<case>.png and prints each reply's outcome, every issue
// it holds (code and severity), its over_budget issue in full and the snapshot it drew.
//   node docs/evidence/1417/shots.mjs target/debug/deep-show docs/evidence/1417/shots
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bin, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
function graph(ranks, width) {
  const nodes = []; const edges = [];
  for (let r = 0; r < ranks; r++) for (let j = 0; j < width; j++) {
    nodes.push({ id: `v${r}x${j}`, w: 40 + 8 * ((r + j) % 5), h: 30, label: `${r}.${j}` });
    if (r > 0) {
      edges.push({ id: `e${r}x${j}`, a: `v${r - 1}x${j}`, b: `v${r}x${j}` });
      if (j % 2 === 1) edges.push({ id: `f${r}x${j}`, a: `v${r - 1}x${j - 1}`, b: `v${r}x${j}` });
    }
  }
  return { nodes, edges };
}
// [file name, ranks, width, budget class or null for none]
const cases = [
  ['small-data-view', 4, 6, 'data_view'],
  ['1000-data-view', 20, 50, 'data_view'],
  ['100000-data-view', 100, 1000, 'data_view'],
  ['100000-export', 100, 1000, 'export'],
  ['1000-no-class', 20, 50, null],
  ['15000-no-class', 150, 100, null],
];
// The layered layout's extent for these graphs: ranks 30 u tall 48 u apart, boxes 24 u apart in a rank.
function extent(ranks, width) {
  let w = 0;
  for (let r = 0; r < Math.min(ranks, 5); r++) {
    let row = 24 * (width - 1);
    for (let j = 0; j < width; j++) row += 40 + 8 * ((r + j) % 5);
    w = Math.max(w, row);
  }
  return [w, 30 * ranks + 48 * (ranks - 1)];
}
let k = 0;
for (const [name, ranks, width, cls] of cases) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1417-shots-'));
  const doc = `01JB1417SH0TS00000000000${String(k++).padStart(2, '0')}`;
  const n = ranks * width;
  const [w, h] = extent(ranks, width);
  const scale = Math.min(1, 1264 / w, 704 / h);
  const document = {
    format: 1, profile: 'board', seed: 1417, title: `A ${n}-node graph`, description: `A layered graph of ${n} nodes.`,
    size: [1280, 720], ...(cls ? { budget: { class: cls } } : {}), requires: { modules: { graph: '^1' } },
    items: { g: { id: 'g', kind: 'graph@1', name: 'Graph', order: 'a0', at: { pos: [8, 8, 0], scale: [scale, scale, 1] }, params: { graph: graph(ranks, width), layout: { algo: 'layered', direction: 'down', seed: 1417 } } } },
  };
  const scenario = {
    evidence, sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: graphs', process: { pid: 4100, start: 1000 } } },
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc, document, t: '0s', size: [1280, 720], include: ['issues', 'pixels'] }],
  };
  const r = spawnSync(bin, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 ** 30 });
  const reply = JSON.parse(r.stdout.trim()).replies[0];
  const sha = reply.snapshots?.[0]?.sha256;
  if (sha) copyFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), join(out, `${name}.png`));
  rmSync(evidence, { recursive: true, force: true });
  const over = (reply.issues ?? []).filter((i) => i.code === 'over_budget')
    .map((i) => ({ severity: i.severity, what: i.what, operators: i.actual?.operators?.['graph.layout'] }));
  console.log(`${name} (${n} nodes, ${cls ?? 'no budget class'}, drawn at scale ${scale.toPrecision(3)}): outcome ${reply.outcome}; issues: [${(reply.issues ?? []).map((i) => `${i.code} ${i.severity}`).join(', ')}]; over_budget: ${over.length ? JSON.stringify(over) : 'none'}; snapshot: ${sha ? `${name}.png` : 'none'}`);
}
