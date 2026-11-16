// #233's budgets, the `math` mode of benchmarks/canvas.mjs (task `canvas-math`): criterion 11's math@1 document (axes
// with x_range [−3, 3, 1] and y_range [0, 9, 3] over 8 × 5 units, x² plotted on them, and a square a channel moves)
// against its expansion written by hand, the drawn form deep-show expanded it to with each derived ID's dots written as
// `__`. deep-gpu's frame_budget draws each at 1920 × 1080 for 5 s at 60 fps in look `clean`, in alternating order
// (`math_over_hand`, the ratio of their median GPU p95s); and deep-show's eval of the math document at 0.55 s counts
// the nodes that ran for an instance itself, which a pack that expanded each frame would add (`frame_expansions`).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = [1920, 1080];
const FLICKS = 705_600_000;
const DOC = '01JB233B000000000000000001';
const INSTANCES = ['ax', 'curve'];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function mathDoc() {
  const items = {
    ax: { kind: 'math.axes@1', params: { x_range: [-3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5 } },
    curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2' } },
    mover: { kind: 'rect@1', params: { box: [0, 0, 40, 40], paint: { fill: { role: 'ink' } } }, at: { pos: [100, 900, 0] } },
  };
  return {
    format: 1, profile: 'figure', title: 'Axes and a parabola, and a moving square', description: 'The #233 budgets fixture.',
    size: SIZE, transport: { span: '5s' }, packs: ['deepbuild/math@1.0.0'],
    items: Object.fromEntries(Object.entries(items).map(([id, it], k) => [id, { id, name: id, order: `a${k}`, ...it }])),
    channels: { move: { target: 'items/mover/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 100, interp: 'linear' }, k1: { t: '5s', value: 1700 } } } },
  };
}

/** The drawn form of `doc` as `shown` expanded it, its derived IDs' dots written as `__`: the expansion by hand. */
function byHand(doc, shown) {
  const items = { ...doc.items };
  const channels = { ...doc.channels };
  const ids = [];
  for (const row of shown.expansions ?? []) {
    delete items[row.instance];
    for (const [id, item] of Object.entries(row.derived ?? {})) {
      items[id] = { ...item, id };
      ids.push(id);
    }
    Object.assign(channels, row.channels ?? {});
  }
  let text = JSON.stringify({ ...doc, title: 'Axes and a parabola, written by hand', items, channels });
  for (const id of ids.sort((a, b) => b.length - a.length)) text = text.split(`"${id}"`).join(`"${id.replace(/\./g, '__')}"`);
  const out = JSON.parse(text);
  delete out.packs;
  for (const item of Object.values(out.items)) delete item.layer;
  return out;
}

export function math({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  release('deep-show', 'deep-show');
  const packs = ['math', 'verbs'].map((name) => ({ id: `deepbuild/${name}`, dir: join(root, 'packs', `${name}-1.0.0`) }));
  const look = JSON.parse(readFileSync(join(root, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = mathDoc();
    const show = (calls) => once('deep-show', ['run'], {
      evidence: dir, sessions: {}, panels: { main: { rect: [0, 0, ...SIZE] } }, docs: { [DOC]: { panel: 'main' } }, packs,
      processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
      calls: [{ call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document: doc, include: ['issues'] }, ...calls],
    });
    const shown = show([{ call: 'eval', doc: DOC, t: Math.round(0.5 * FLICKS) }, { call: 'eval', doc: DOC, t: Math.round(0.55 * FLICKS) }]);
    const [presented, , frame] = shown.replies ?? [];
    if (presented?.outcome !== 'presented' || frame?.outcome !== 'evaluated') throw Error(`deep-show answered ${JSON.stringify(shown).slice(0, 1500)}`);
    const frameExpansions = (frame.nodes ?? []).filter((n) => n.run === 'ran' && (INSTANCES.includes(n.item) || n.operator === 'pack.expand')).length;
    const files = { math: join(dir, 'math.json'), hand: join(dir, 'hand.json') };
    writeFileSync(files.math, JSON.stringify(doc));
    writeFileSync(files.hand, JSON.stringify(byHand(doc, presented)));
    const budget = (name) => ({
      call: 'frame_budget', look, writer: 'agent:alpha', doc: files[name], render: { seconds: 5, pixels: SIZE }, fps: 60,
      ...(name === 'math' ? { packs } : {}),
    });
    let k = 0;
    const measured = runs(() => {
      const handFirst = k++ % 2 === 1;
      const order = handFirst ? ['hand', 'math'] : ['math', 'hand'];
      const answer = once('deep-gpu', ['run'], { out: dir, calls: order.map(budget) });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const p95 = Object.fromEntries(order.map((name, i) => [name, median(answer.replies[i].limits.gpu.runs.map((r) => r.p95_ms))]));
      return { math_p95_ms: p95.math, hand_p95_ms: p95.hand, math_over_hand: p95.math / p95.hand, frame_expansions: frameExpansions };
    });
    console.log(JSON.stringify({ task: 'canvas-math', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
