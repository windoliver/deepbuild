// One canvas workload per run, for the perf lane's budgets (issues #96, #305 and #383): node benchmarks/canvas.mjs
// <task>. Each drives a built binary over JSON lines, as the acceptance tests do: `deep-show run` for patches and the
// seal, `deep-canvas merge` for a merge, `deep-gpu run` for the deepest level of a 3D city.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOC = '01JB96D0000000000000000001';
const layers = {
  'you-main': { writer: 'you:you', title: 'You', order: 'a0' },
  'alpha-main': { writer: 'agent:thread-alpha', title: 'Alpha', order: 'a1' },
  'bravo-main': { writer: 'agent:thread-bravo', title: 'Bravo', order: 'a2' },
};
const envelope = { format: 1, profile: 'board', title: 'Bench board', description: 'Shared by three writers.', size: [640, 360], layers, items: {} };
const rect = (id, layer, i) => ({ id, kind: 'rect@1', layer, name: id, order: `b${i}`, params: { box: [0, 0, 8, 8], paint: { fill: { role: 'muted' } } }, at: { pos: [i % 600, 100, 0] } });
const ulid = (n) => `01JB96P${String(n).padStart(19, '0')}`;

function run(binary, subcommand, lines) {
  const out = spawnSync(join(root, 'target', 'debug', binary), subcommand.split(' '), { input: `${lines.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (out.status !== 0) throw Error(`${binary} ${subcommand} exited ${out.status}: ${out.stderr}`);
  return out.stdout.trim().split('\n').map((line) => JSON.parse(line));
}

const workloads = {
  // 200 of an agent's patches on a 1,000-item board, each a move of one of its rects, then a read.
  'patch-apply'() {
    const document = structuredClone(envelope);
    for (let i = 0; i < 500; i++) {
      document.items[`you.r${i}`] = rect(`you.r${i}`, 'you-main', i);
      document.items[`alpha.r${i}`] = rect(`alpha.r${i}`, 'alpha-main', i);
    }
    const calls = Array.from({ length: 200 }, (_, k) => ({
      call: 'deep_show', session: 'sess-alpha', doc: DOC,
      patch: { patch: ulid(k + 1), doc: DOC, base: k, reason: 'bench', ops: [{ op: 'set', id: `alpha.r${k}`, path: `items/alpha.r${k}/at/pos`, value: [k, 220, 0] }] },
    }));
    calls.push({ call: 'read', doc: DOC });
    const sessions = { 'sess-alpha': { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1000 } } };
    const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
    let answer;
    try {
      [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, sessions, panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main', document } }, calls })]);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
    const applied = answer.replies.slice(0, 200).filter((r) => r.outcome === 'applied').length;
    if (applied !== 200) throw Error(`${applied} of 200 patches applied`);
  },
  // A merge by ID of two writers' 10,000-item revisions of one base.
  'merge-10k'() {
    const base = { ...structuredClone(envelope), id: DOC.toLowerCase() };
    const side = (layer, prefix) => {
      const doc = structuredClone(base);
      for (let i = 0; i < 10_000; i++) doc.items[`${prefix}.m${i}`] = rect(`${prefix}.m${i}`, layer, i);
      return doc;
    };
    const [answer] = run('deep-canvas', 'merge', [JSON.stringify({ base, a: side('alpha-main', 'alpha'), b: side('bravo-main', 'bravo') })]);
    if (answer.outcome !== 'merged') throw Error(`the merge was ${answer.outcome}`);
  },
  // A process start that registers and seals the build's canvas modules once, then six frames of a board at
  // six times: the seal's time and count must not move, since nothing runs per frame (issue #305).
  seal() {
    const board = { format: 1, profile: 'board', title: 'Bench board', description: 'One rect, drawn at six times.', size: [320, 200],
      items: { 'r-1': { id: 'r-1', kind: 'rect@1', name: 'Rect', order: 'a0', params: { box: [10, 10, 100, 50] } } } };
    const frames = Array.from({ length: 6 }, (_, k) => ({ call: 'deep_show', session: 'sess-alpha', doc: DOC, document: board, include: ['pixels'], t: `${k}s` }));
    const sessions = { 'sess-alpha': { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1000 } } };
    const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
    let answer;
    try {
      [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, sessions, panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main' } },
        calls: [{ call: 'registry' }, ...frames, { call: 'registry' }] })]);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
    if (answer.ok !== true) throw Error(`deep-show answered ${JSON.stringify(answer)}`);
    const [before, ...rest] = answer.replies;
    const after = rest.pop();
    if (before.state !== 'sealed' || before.seal?.runs !== 1) throw Error(`the build did not seal once at startup: ${JSON.stringify(before)}`);
    const drawn = rest.filter((r) => r.outcome === 'presented').length;
    if (drawn !== 6) throw Error(`${drawn} of 6 frames presented`);
    if (after.seal.runs !== 1 || after.seal.ms !== before.seal.ms) throw Error(`the seal ran again across frames: ${JSON.stringify(after.seal)}`);
  },
};

// The canvas conformance kit (issue #138) over the shipped build: every part on Vello CPU and noop, at 1,000
// fuzzed sequences a module, a tenth of the quick lane's 10,000, so 21 rounds fit the perf lane; the fuzzing
// parts' cost scales with the count.
workloads.kit = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  let answer;
  try {
    [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, calls: [{ call: 'kit', sequences: 1000 }] })]);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
  const [kit] = answer.replies ?? [];
  if (answer.ok !== true || kit?.verdict !== 'PASS') throw Error(`the kit didn't pass: ${JSON.stringify(answer).slice(0, 2000)}`);
};

// The deepest level of a city of 64 parts, 768 tables and 6,144 columns over 833 documents, each part and table
// opening its own document by reference (issue #383): 60 frames in the reference window, looking down at one table, so
// only its part's and its own documents load. Fails unless the view settles with the deepest document resident.
workloads['map-deepest-level'] = () => {
  const out = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const handle = (n) => `doc:01JB383B${String(n).padStart(18, '0')}`;
    const box = (id, size, pos, role, order, open) => ({ id, kind: 'mark.box@1', layer: 'main', name: id, order,
      params: { size, paint: { fill: { role } }, ...(open ? { open: { at_px: 600, doc: open } } : {}) }, at: { pos } });
    const scene = (items, camera) => ({ format: 1, profile: 'scene', title: 'Bench city', description: 'A level of the bench city.',
      size: [3024, 1964], ...(camera ? { camera: 'cam' } : {}), layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
      items: camera ? { cam: camera, ...items } : items });
    const docs = {};
    const write = (h, doc) => { const path = join(out, `${h ? h.slice(4) : 'root'}.json`); writeFileSync(path, JSON.stringify(doc)); if (h) docs[h] = path; return path; };
    let n = 0;
    const rootItems = {};
    for (let p = 0; p < 64; p++) {
      const ph = handle(++n);
      rootItems[`p${p}`] = box(`p${p}`, [40, 0.2, 40], [((p % 8) - 3.5) * 60, 0.1, (Math.floor(p / 8) - 3.5) * 60], 'block', `a${p}`, ph);
      const partItems = {};
      for (let t = 0; t < 12; t++) {
        const th = handle(++n);
        partItems[`p${p}.t${t}`] = box(`p${p}.t${t}`, [7, 0.2, 7], [((t % 4) - 1.5) * 9, 0.2, (Math.floor(t / 4) - 1) * 9], 'near', `a${t}`, th);
        const tableItems = {};
        for (let c = 0; c < 8; c++) {
          const h = 1 + (c % 4) * 0.5;
          tableItems[`p${p}.t${t}.c${c}`] = box(`p${p}.t${t}.c${c}`, [1, h, 1], [((c % 2) - 0.5) * 2.4, 0.1 + h / 2, (Math.floor(c / 2) - 1.5) * 1.6], 'block', `a${c}`);
        }
        write(th, scene(tableItems));
      }
      write(ph, scene(partItems));
    }
    const camera = { id: 'cam', kind: 'camera@1', layer: 'main', name: 'Camera', order: 'a',
      params: { projection: 'perspective', target: [-34.5, 0.3, -30], orbit: { azimuth: 30, elevation: 75, distance: 10 }, fov: 40, near: 0.1 } };
    const doc = write(null, scene(rootItems, camera));
    const look = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '378', 'fixtures', 'look.json'), 'utf8'));
    mkdirSync(join(out, 'frames'));
    const [answer] = run('deep-gpu', 'run', [JSON.stringify({ out: join(out, 'frames'), calls: [{ call: 'view3d', doc, docs, look, size: [3024, 1964], frames: 60, fps: 60 }] })]);
    const last = answer.replies?.[0]?.frames?.at(-1);
    const deepest = handle(27 * 13 + 6 + 1);
    if (answer.ok !== true || !last?.settled || !last.resident?.includes(deepest)) throw Error(`the deepest level didn't settle: ${JSON.stringify(answer).slice(0, 2000)}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
workloads[task]();
