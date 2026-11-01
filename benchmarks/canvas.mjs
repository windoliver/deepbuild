// One canvas workload per run, for the perf lane's budgets (issues #96, #305, #379, #383 and #854): node
// benchmarks/canvas.mjs <task>. Each drives a built binary over JSON lines, as the acceptance tests do: `deep-show run`
// for patches and the seal, `deep-canvas merge` for a merge, `deep-gpu run` for the deepest level of a 3D city.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fingerprint, judgeLimit } from '../scripts/benchmark.mjs';

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

function run(binary, subcommand, lines, profile = 'debug') {
  const out = spawnSync(join(root, 'target', profile, binary), subcommand.split(' '), { input: `${lines.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
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

// The cost model's micro-benchmark (issue #379): every operator the shipped build seals, timed by an optimized
// `deep-show`'s `costs` call over generated boards (issue #855: the release build, whose profile and toolchain the
// file records, since the cost model reads no file a debug build measured), and scene3d's two passes timed by their timestamps on the device through
// `deep-gpu`'s live window at two sizes and two box counts. It prints the measured terms beside the declared ones
// with this machine's fingerprint; `--write` on a reference Mac makes them the build's coefficients
// (crates/deep-canvas/costs.json). Off macOS the passes keep their declared terms.
const COSTS = join(root, 'crates', 'deep-canvas', 'costs.json');
const LOOK = join(root, 'tests', 'acceptance', '379', 'fixtures', 'look.json');
// Bytes per pixel from the passes' formats: the linear, object-ID and depth targets, and three BGRA slots.
const PASS_BYTES = { 'scene3d.geometry': 16, 'scene3d.output': 12 };

function sceneDoc({ title, budgetClass, size, boxes }) {
  const items = { cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 1, 0], orbit: { azimuth: 30, elevation: 25, distance: 14 }, fov: 40 } } };
  for (let i = 0; i < boxes; i++) {
    items[`box-${i}`] = { id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(4, '0')}`,
      params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [(i % 8) * 1.5 - 5, 0.5, Math.floor(i / 8) * 1.5 - 5] } };
  }
  return { format: 1, profile: 'scene', title, description: `${title}: a #379 bench document.`, size, camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, budget: { class: budgetClass }, transport: { span: '60s' }, items,
    channels: { slide: { target: 'items/box-0/at/pos/2', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '60s', value: 3, interp: 'linear' } } } } };
}

/** `deep-gpu run` with one live call per entry of `calls`, each over its own documents: the replies. */
function liveCalls(dir, calls) {
  const look = JSON.parse(readFileSync(LOOK, 'utf8'));
  const lines = calls.map(({ docs, ...call }, c) => {
    const sessions = docs.map((doc, i) => {
      const path = join(dir, `doc-${c}-${i}.json`);
      writeFileSync(path, JSON.stringify(doc));
      return { session: `s-${i}`, writer: `agent:bench-${i}`, doc: path };
    });
    return { call: 'live', look, sessions, ...call };
  });
  const [answer] = run('deep-gpu', 'run', [JSON.stringify({ out: dir, calls: lines })]);
  const replies = answer.replies ?? [];
  if (replies.length !== calls.length || replies.some((r) => r.code)) throw Error(`deep-gpu live answered ${JSON.stringify(answer).slice(0, 1500)}`);
  return replies;
}

const live = (dir, docs, call) => liveCalls(dir, [{ docs, ...call }])[0];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Each pass's median interval in ns over frames 11 to 60 of one live view. */
function passTimes(dir, doc) {
  const reply = live(dir, [doc], { frames: 60, report: ['passes'] });
  const by = {};
  for (const f of reply.frames.slice(10)) for (const p of f.passes) (by[p.name] ??= []).push(p.end_ns - p.start_ns);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, median(v)]));
}

// The shipped effects' passes (issue #380), each writing its own linear target: bytes per pixel from that
// Rgba16Float target, and glow's from its mix target and its half-resolution chain.
const EFFECT_BYTES = { 'effects.grid': 8, 'effects.shadow': 8, 'effects.particles': 8, 'effects.outline': 8, 'effects.glow': 11 };
const EFFECTS_LOOK = join(root, 'tests', 'acceptance', '380', 'fixtures', 'look.json');

/** A lamp on a floor under a casting sun, with sparks, the ground grid, bloom and the lamp selected. */
function effectsDoc(size) {
  const box = (id, order, dims, pos, role) => ({ id, kind: 'mark.box@1', name: id, order, layer: 'main', params: { size: dims, paint: { fill: { role } } }, at: { pos } });
  const items = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 0.4, 0], orbit: { azimuth: 30, elevation: 25, distance: 7 }, fov: 40, near: 0.1 } },
    floor: box('floor', 'a1', [12, 0.1, 12], [0, -0.05, 0], 'floor'),
    lamp: box('lamp', 'a2', [1, 1, 1], [0, 0.5, 0], 'lamp'),
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a9', layer: 'main', params: { illuminance: Math.PI, shadow: true }, at: { rot: [-55, -40, 0] } },
    sparks: { id: 'sparks', kind: 'particles@1', name: 'Sparks', order: 'b0', layer: 'main', at: { pos: [0, 1.05, 0] },
      params: { count: 2048, emit: { anchor: 'lamp', shape: 'point', rate: 1200, span: 10 }, life: [0.8, 1.6], motion: { ballistic: { v0: [2, 4], gravity: [0, -9.8, 0], drag: 0.2 } },
        size: 3, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }], draw: 'dot' } },
  };
  return { format: 1, id: 'bench-effects', profile: 'scene', title: 'Effects', description: 'The #380 effects bench document.', size, camera: 'cam',
    requires: { modules: { scene3d: '^1', effects: '^1' } }, transport: { span: '10s' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items };
}

/** Each effects pass's median GPU time in ns over frames 11 to 60 of `view3d` at `size`, as wgpu-profiler times it. */
function effectTimes(dir, size) {
  const doc = join(dir, `effects-${size[0]}.json`);
  writeFileSync(doc, JSON.stringify(effectsDoc(size)));
  const look = { ...JSON.parse(readFileSync(EFFECTS_LOOK, 'utf8')), bloom: { intensity: 0.3, radius: 0.85 },
    ground_3d: { kind: 'grid', height: 0.001, spacing: 1, major_every: 5, width: 1, fade: 'auto', roles: { minor: 'grid-minor', major: 'grid-major', axis: 'grid-axis' } } };
  const [answer] = run('deep-gpu', 'run', [JSON.stringify({ out: dir, calls: [{ call: 'view3d', doc, look, size, frames: 60, fps: 60, selection: ['lamp'], timings: true }] })]);
  const reply = answer.replies?.[0];
  if (!reply?.frames || reply.code) throw Error(`deep-gpu view3d answered ${JSON.stringify(answer).slice(0, 1500)}`);
  const by = {};
  for (const f of reply.frames.slice(10)) for (const [name, ms] of Object.entries(f.passes_ms ?? {})) (by[name] ??= []).push(ms * 1e6);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, median(v)]));
}

workloads.costs = () => {
  const write = process.argv.includes('--write');
  const machine = fingerprint();
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  let answer;
  try {
    const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-show'], { cwd: root, stdio: 'inherit' });
    if (built.status !== 0) throw Error(`cargo build --release -p deep-show exited ${built.status}`);
    [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, calls: [{ call: 'costs' }] })], 'release');
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
  const measured = answer.replies?.[0];
  if (!measured?.terms || !measured.build?.profile) throw Error(`deep-show costs answered ${JSON.stringify(answer).slice(0, 1500)}`);
  const declared = JSON.parse(readFileSync(COSTS, 'utf8'));
  const terms = { ...measured.terms };
  for (const [pass, bytes] of Object.entries({ ...PASS_BYTES, ...EFFECT_BYTES })) terms[pass] = { ...(declared.terms[pass] ?? {}), bytes_per_px: bytes };
  if (process.platform === 'darwin') {
    const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
    try {
      const small = passTimes(dir, sceneDoc({ title: 'Small', budgetClass: 'showpiece', size: [256, 256], boxes: 8 }));
      const large = passTimes(dir, sceneDoc({ title: 'Large', budgetClass: 'showpiece', size: [1024, 1024], boxes: 8 }));
      const many = passTimes(dir, sceneDoc({ title: 'Many', budgetClass: 'showpiece', size: [256, 256], boxes: 64 }));
      for (const pass of Object.keys(PASS_BYTES)) {
        const perPx = Math.max((large[pass] - small[pass]) / (1024 * 1024 - 256 * 256), 0.0001);
        const perVertex = Math.max((many[pass] - small[pass]) / ((64 - 8) * 24), 0);
        terms[pass] = { ns_per_px: Number(perPx.toFixed(4)), ...(perVertex >= 0.01 ? { ns_per_vertex: Number(perVertex.toFixed(2)) } : {}), bytes_per_px: PASS_BYTES[pass] };
      }
      const fxSmall = effectTimes(dir, [256, 256]);
      const fxLarge = effectTimes(dir, [1024, 1024]);
      for (const pass of Object.keys(EFFECT_BYTES)) {
        const perPx = Math.max((fxLarge[pass] - fxSmall[pass]) / (1024 * 1024 - 256 * 256), 0.0001);
        terms[pass] = { ns_per_px: Number(perPx.toFixed(4)), bytes_per_px: EFFECT_BYTES[pass] };
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const report = { fingerprint: machine, build: measured.build, terms, declared: declared.terms, declaredFingerprint: declared.fingerprint };
  if (write) {
    if (!['Mac15,7', 'Mac15,12'].includes(machine.model)) throw Error(`coefficients come from a reference Mac; this is ${machine.model}`);
    const { model, chip, memoryBytes, macosBuild } = machine;
    writeFileSync(COSTS, `${JSON.stringify({ fingerprint: { model, chip, memoryBytes, macosBuild }, build: measured.build, terms }, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
};

// The perf lane's record for each budget class (issue #379; canvas primitives: The cost model, "Cold, warm and
// while authoring"): `class <class>` opens the class's fixture (benchmarks/canvas/<class>.json) in `deep-gpu`'s live
// window and prints three timings with this machine's fingerprint: cold, a fresh process to its first settled frame;
// warm, five runs of 300 frames after 30 of warm-up, each frame's GPU and CPU time at p95; and the authoring loop,
// a patch that moves the Q3 bar from 44 to 48 and one that adds a trend line, a mark kind the chart didn't use and so
// a new pipeline, each from its latch to its settled frame. `judge` holds a report's warm frames to its class's
// limits by the design's rule and keeps cold and authoring as readings beside the merge base's. The planted lanes:
// `class … --planted warm_only` records warm frames only; `judge --planted fails_on_cold` fails a change whose cold
// reading rose.
const CLASS_LIMITS = {
  core_view: { gpu_ms: 1, cpu_ms: 2 },
  data_view: { gpu_ms: 2, cpu_ms: 2 },
  figure: { gpu_ms: 2, cpu_ms: 4 },
  work_product: { gpu_ms: 2, cpu_ms: 4 },
  showpiece: { gpu_ms: 10, cpu_ms: 4 },
  export: { gpu_ms: null, cpu_ms: null },
};
const WARM_UP = 30;
const WARM_FRAMES = 300;
const planted = () => {
  const i = process.argv.indexOf('--planted');
  return i < 0 ? null : process.argv[i + 1];
};
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)];

workloads.class = () => {
  const cls = process.argv[3];
  if (!CLASS_LIMITS[cls]) throw Error(`Unknown class ${cls}; one of: ${Object.keys(CLASS_LIMITS).join(', ')}`);
  const fixture = join('benchmarks', 'canvas', `${cls}.json`);
  const doc = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const report = { class: cls, fixture, fingerprint: fingerprint() };
    const warmOnly = planted() === 'warm_only';
    if (!warmOnly) {
      const started = performance.now();
      const [first] = liveCalls(dir, [{ docs: [doc], frames: 1 }]);
      report.cold = { ms: performance.now() - started };
      if (first.sessions[0]?.state !== 'live') throw Error(`${cls}: the fixture isn't live: ${JSON.stringify(first.sessions[0]).slice(0, 800)}`);
    }
    const runs = liveCalls(dir, Array.from({ length: 5 }, () => ({ docs: [doc], frames: WARM_UP + WARM_FRAMES })));
    report.warm = {
      limits: CLASS_LIMITS[cls],
      runs: runs.map((r) => {
        const frames = r.frames.slice(WARM_UP);
        return { frames: frames.length, gpu_p95_ms: p95(frames.map((f) => f.gpu_ms)), cpu_p95_ms: p95(frames.map((f) => f.cpu_ms)) };
      }),
    };
    if (!warmOnly) {
      const values = structuredClone(doc);
      values.items.q3.params.size[1] = 4.8;
      values.items.q3.at.pos[1] = 2.4;
      const pipeline = structuredClone(doc);
      pipeline.items.trend = { id: 'trend', kind: 'mark.line@1', name: 'Trend', order: 'c0',
        params: { points: ['q1', 'q2', 'q3', 'q4'], width: 2, paint: { fill: { role: 'ink' } } } };
      const paths = [values, pipeline].map((d, i) => {
        const path = join(dir, `patch-${i}.json`);
        writeFileSync(path, JSON.stringify(d));
        return path;
      });
      const [authored] = liveCalls(dir, [{ docs: [doc], frames: 90, events: [
        { frame: 31, revise: { session: 's-0', doc: paths[0] } },
        { frame: 61, revise: { session: 's-0', doc: paths[1] } },
      ] }]);
      const revisions = authored.sessions[0].revisions;
      report.authoring = ['values', 'pipeline'].map((patch, i) => {
        const r = revisions[i + 1];
        if (r?.outcome !== 'current') throw Error(`${cls}: the ${patch} patch wasn't current: ${JSON.stringify(r).slice(0, 800)}`);
        return { patch, ms: r.settled_ms, pipelines: r.pipelines };
      });
    }
    console.log(JSON.stringify(report));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #401: a plug-in's panels in the ring through `deep-show run`, on #400's two displays and the virtual clock.
const RING_DISPLAYS = [
  { uuid: 'A', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: 5_880_000, color_space: 'p3' },
  { uuid: 'B', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 2_116_800, color_space: 'srgb' },
];
const SEC = 705_600_000;
function ring(panels, manifest, calls) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const install = { call: 'install', at: 1, plugin: 'bench', manifest };
    const [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, clock: { lead: 1_411_200, check: 352_800 }, displays: RING_DISPLAYS, window: [1200, 700], panels, calls: [install, ...calls] })]);
    if (answer.ok !== true || answer.replies[0].installed !== true) throw Error(`the run failed: ${JSON.stringify(answer).slice(0, 2000)}`);
    return answer.replies.slice(1);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

// 600 readings of one source, each 100 ms apart, bound to a panel's text, a sheet cell and a chart's label, each
// surface's frame read after every reading; fails unless each frame shows the reading before it.
workloads['panel-bound-value'] = () => {
  const bind = { source: 'reading:ticker', select: 'value', format: { unit: 'USD', precision: 2, notation: 'fixed' }, stale_after: 60 * SEC };
  const n = 600, every = SEC / 10;
  const manifest = {
    sources: { ticker: { fresh_for: 60 * SEC, replay: Array.from({ length: n }, (_, k) => ({ value: 100 + k / 4, unit: 'USD' })) } },
    panels: {
      quote: { tree: [{ id: 'price', component: 'text', bind }], script: { timers: [{ first: SEC, every, until: SEC + (n - 1) * every, do: [{ op: 'read', source: 'ticker' }] }] } },
      table: { tree: [{ id: 'grid', component: 'sheet', cells: [{ id: 'price', bind }] }] },
      chart: { tree: [{ id: 'trend', component: 'chart', label: { bind } }] },
    },
  };
  // Each surface's frame after each reading lands, so p50 holds every reading's draw on three surfaces.
  const frames = Array.from({ length: n }, (_, k) => ['quote', 'table', 'chart'].map((panel) => ({ call: 'drawn', at: SEC + k * every + every / 2, panel }))).flat();
  const drawn = ring({ quote: { rect: [0, 0, 400, 350] }, table: { rect: [400, 0, 400, 350] }, chart: { rect: [800, 0, 400, 350] } }, manifest, frames);
  const missed = drawn.findIndex((d, i) => !d.bound?.[0]?.text?.includes((100 + Math.floor(i / 3) / 4).toFixed(2)));
  if (missed >= 0) throw Error(`frame ${missed} doesn't show its reading: ${JSON.stringify(drawn[missed])}`);
};

// Six of your clicks, each in its own panel, and a pop-out of each onto the second display with its click's serial;
// fails unless every pop-out opens its window.
workloads['panel-pop-out'] = () => {
  const ids = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'];
  const panels = Object.fromEntries(ids.map((id, i) => [id, { rect: [(i % 3) * 400, Math.floor(i / 3) * 350, 400, 350] }]));
  const manifest = { panels: Object.fromEntries(ids.map((id) => [id, { tree: [{ id: 'title', component: 'text', text: id }] }])) };
  const clicks = ids.map((id, i) => ({ call: 'input', at: SEC + i * SEC, panel: id, event: { type: 'down', pos: [10, 10] } }));
  // The router numbers your inputs in order, from 1.
  const pops = ids.map((id, i) => ({ call: 'pop_out', at: 10 * SEC + i * SEC, panel: id, display: 'B', serial: i + 1 }));
  const replies = ring(panels, manifest, [...clicks, ...pops]);
  if (!replies.slice(ids.length).every((r) => r.window)) throw Error(`a pop-out didn't open: ${JSON.stringify(replies.slice(ids.length))}`);
};

workloads.judge = () => {
  const { current, base } = JSON.parse(readFileSync(0, 'utf8'));
  if (EFFICIENCY[current.task]) return judgeEfficiency(current);
  const cls = current.class;
  const limits = CLASS_LIMITS[cls];
  if (!limits) throw Error(`Unknown class ${cls}`);
  const warm = {};
  for (const key of ['gpu', 'cpu']) {
    const limit = limits[`${key}_ms`];
    warm[key] = limit === null ? { status: 'PASS', reason: `the ${cls} class has no frame cap` }
      : judgeLimit({ limit, runs: (current.warm?.runs ?? []).map((r) => r[`${key}_p95_ms`]), fingerprint: current.fingerprint });
  }
  const statuses = Object.values(warm).map((v) => v.status);
  let status = statuses.includes('FAIL') ? 'FAIL' : statuses.every((s) => s === 'PASS') ? 'PASS' : 'INCONCLUSIVE';
  const readings = {
    cold: { current_ms: current.cold?.ms ?? null, base_ms: base?.cold?.ms ?? null },
    authoring: ['values', 'pipeline'].map((patch) => ({
      patch,
      current_ms: current.authoring?.find((a) => a.patch === patch)?.ms ?? null,
      base_ms: base?.authoring?.find((a) => a.patch === patch)?.ms ?? null,
    })),
  };
  let reason = statuses.includes('FAIL') ? `${cls}: warm frames over the class's limits` : undefined;
  if (planted() === 'fails_on_cold' && readings.cold.current_ms > readings.cold.base_ms) {
    status = 'FAIL';
    reason = `${cls}: the cold reading rose`;
  }
  console.log(JSON.stringify({ class: cls, status, warm, readings, ...(reason ? { reason } : {}) }));
};

// #402: a terminal's cell grid fed 600 updates, one every 1/60 s, on the virtual clock; fails unless every update is
// presented in a frame of its own. `terminal-60hz` feeds one numbered line an update, `cell-grid-60hz` a full repaint
// of all 36 rows.
const terminal = (repaint) => () => {
  const step = SEC / 60, rows = 36;
  const line = (k) => `L${String(k).padStart(8, '0')} ${'x'.repeat(26)}`;
  const text = (k) => (repaint ? `\u001b[H${Array.from({ length: rows }, (_, r) => `F${k} R${r} ${line(k * 100 + r)}\u001b[K`).join('\r\n')}` : `${line(k)}\r\n`);
  const feed = Array.from({ length: 600 }, (_, k) => ({ at: 3 * SEC + k * step, text: text(k) }));
  const manifest = { panels: { screen: { raw_input: true, tree: [{ id: 'screen', component: 'cells', terminal: 'T1' }] } } };
  const [, updates] = ring({ screen: { rect: [0, 0, 400, 350] } }, manifest, [
    { call: 'terminal_open', at: SEC, terminal: 'T1', panel: 'screen', cols: 120, rows, feed },
    { call: 'updates', at: 14 * SEC, terminal: 'T1' },
  ]);
  const shown = new Set(updates.updates.map((u) => u.presented));
  if (updates.updates.length !== 600 || updates.updates.some((u) => u.dropped || u.presented === null) || shown.size !== 600) throw Error(`an update wasn't presented in a frame of its own: ${JSON.stringify(updates).slice(0, 600)}`);
};
workloads['terminal-60hz'] = terminal(false);
workloads['cell-grid-60hz'] = terminal(true);

// #854, the efficiency bar for agent work: four tasks that time what an agent's work costs, each on a release build
// of the binaries it times (`fingerprint.build` names the profile and toolchain), one warm-up run and five runs, each
// run a fresh process; `--planted <name>` runs the task's wrong program. Each prints its report; `judge` holds it to
// the task's targets in benchmarks/budgets.json, refusing a reading of any other build. The perf lane compares each
// command with the merge base as it does every task.
const RUNS = 5;
const runs = (once) => {
  once(true);
  return Array.from({ length: RUNS }, () => once(false));
};
const toolchain = () => spawnSync('rustc', ['-V'], { cwd: root, encoding: 'utf8' }).stdout.trim();
function release(pkg, bin) {
  const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', pkg, '--bin', bin], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) throw Error(`cargo build --release -p ${pkg} --bin ${bin} exited ${built.status}`);
  return { ...fingerprint(), build: { profile: 'release', toolchain: toolchain() } };
}
/** One line of `bin args` from target/release: its parsed answer. */
function once(bin, args, line) {
  const out = spawnSync(join(root, 'target', 'release', bin), args, { input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (out.status !== 0) throw Error(`${bin} ${args.join(' ')} exited ${out.status}: ${out.stderr.slice(-2000)}`);
  return JSON.parse(out.stdout.trim().split('\n').at(-1));
}

// The board the patch and read tasks share: 10,000 rects of one agent's layer, 100 to a row; #896 also patches it
// at 1,000.
const BOARD_ITEMS = 10_000;
const boardItem = (i) => `r${String(i).padStart(5, '0')}`;
function board(items = BOARD_ITEMS) {
  const document = { format: 1, profile: 'board', title: 'Bench board', description: 'The #854 board: 10,000 rects of one agent.', size: [1280, 800],
    layers: { 'alpha-main': { writer: 'agent:thread-alpha', title: 'Alpha', order: 'a1' } }, items: {} };
  for (let i = 0; i < items; i++) {
    const id = boardItem(i);
    document.items[id] = { id, kind: 'rect@1', layer: 'alpha-main', name: id, order: `b${String(i).padStart(5, '0')}`,
      params: { box: [0, 0, 8, 6], paint: { fill: { role: 'muted' } } }, at: { pos: [(i % 100) * 12, Math.floor(i / 100) * 8, 0] } };
  }
  return document;
}
/** `deep-show run` on the board of `items` as a shared document, with `calls`: the replies. */
function onBoard(calls, items = BOARD_ITEMS) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const sessions = { 'sess-alpha': { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1000 } } };
    const scenario = { evidence, sessions, panels: { main: { rect: [0, 0, 1280, 800] } }, docs: { [DOC]: { panel: 'main', document: board(items) } }, calls,
      ...(planted() ? { planted: planted() } : {}) };
    const answer = once('deep-show', ['run'], scenario);
    if (answer.ok !== true) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
    return answer.replies;
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

// Patch to settled frame: 200 patches a run, each moving one item of the board, each timed from its arrival to the
// settled frame it causes, the process's CPU plus the frame's GPU time, with the nodes that frame ran by operator and
// (#896) the time of each stage, the bytes the view uploaded and the marks each operator built.
const PATCHES = 200;
const benchPatches = (items) => Array.from({ length: PATCHES }, (_, k) => {
  const id = boardItem((k * 53) % items);
  return { patch: ulid(k + 1), doc: DOC, base: k, reason: 'bench', ops: [{ op: 'set', id, path: `items/${id}/at/pos`, value: [k * 6, 790, 0] }] };
});
function settle(items) {
  const [settled] = onBoard([{ call: 'settle', session: 'sess-alpha', doc: DOC, patches: benchPatches(items) }], items);
  if (settled.outcome !== 'settled') throw Error(`the patches didn't settle: ${JSON.stringify(settled).slice(0, 1500)}`);
  return settled.samples;
}
workloads['patch-settled'] = () => {
  const fingerprint = release('deep-show', 'deep-show');
  const measured = runs(() => {
    const samples = settle(BOARD_ITEMS);
    return { p95_ms: p95(samples.map((s) => s.ms)), samples };
  });
  console.log(JSON.stringify({ task: 'canvas-patch-settled', fingerprint, items: BOARD_ITEMS, patches: PATCHES, runs: measured }));
};

// #896, patch to settled frame in O(dirty): the same 200 patches on a 1,000-item board, then on the 10,000-item one,
// each board in a fresh process, so a run's two boards see the same load.
const DIRTY_BOARDS = [1_000, BOARD_ITEMS];
workloads['patch-dirty'] = () => {
  const fingerprint = release('deep-show', 'deep-show');
  const measured = runs(() => ({ boards: DIRTY_BOARDS.map((items) => ({ items, samples: settle(items) })) }));
  console.log(JSON.stringify({ task: 'canvas-patch-dirty', fingerprint, patches: PATCHES, runs: measured }));
};

// A scene read: deep_query's summary of the board and one paged read of 1,000 rows, each timed in the binary, each
// reply counted in tokens by the tokenizer the codex adapter's facts pin.
workloads['scene-read'] = async () => {
  const fingerprint = release('deep-show', 'deep-show');
  const pinned = JSON.parse(readFileSync(join(root, 'adapters', 'codex.facts.json'), 'utf8')).tokenizer;
  const installed = JSON.parse(readFileSync(join(root, 'node_modules', pinned.package, 'package.json'), 'utf8')).version;
  if (installed !== pinned.version) throw Error(`the facts pin ${pinned.package}@${pinned.version}; ${installed} is installed`);
  const { countTokens } = await import(`${pinned.package}/encoding/${pinned.name}`);
  const read = (reply, rows) => {
    if (reply.outcome !== 'answered') throw Error(`deep_query answered ${JSON.stringify(reply).slice(0, 1500)}`);
    const text = JSON.stringify(reply.result);
    return { ms: reply.ms, tokens: countTokens(text), bytes: Buffer.byteLength(text), rows };
  };
  const measured = runs(() => {
    const [summary, page] = onBoard([{ call: 'deep_query', doc: DOC }, { call: 'deep_query', doc: DOC, page: { limit: 1000 } }]);
    return { summary: read(summary, 0), page: { ...read(page, page.result?.rows?.length ?? 0), next: page.result?.next ?? null } };
  });
  console.log(JSON.stringify({ task: 'canvas-scene-read', fingerprint, items: BOARD_ITEMS,
    tokenizer: { adapter: 'codex', name: pinned.name, version: pinned.version }, runs: measured }));
};

// Idle: a still board held in a window for 60 s of the real clock, its frames, wakeups and CPU read from the process
// that draws it. The warm-up run holds it 5 s.
workloads.idle = () => {
  const fingerprint = release('deep-marks-render', 'deep-canvas-render');
  const fixture = join('benchmarks', 'canvas', 'still.json');
  const doc = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
  const look = { light: { ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200] } };
  const measured = runs((warm) => {
    const answer = once('deep-canvas-render', ['idle'], { doc, look, view: { zoom: 1, theme: 'light' }, seconds: warm ? 5 : 60, ...(planted() ? { planted: planted() } : {}) });
    if (answer.ok !== true) throw Error(`deep-canvas-render idle answered ${JSON.stringify(answer).slice(0, 1500)}`);
    const { ok: _, ...run } = answer;
    return run;
  });
  console.log(JSON.stringify({ task: 'canvas-idle', fingerprint, fixture, seconds: 60, runs: measured }));
};

// A replica's cold start: a fresh process opens a fixture document in the app's headless window, timed from its spawn
// (as the kernel records it) to its first settled frame, with the pipelines it compiled and whether that frame did.
workloads['replica-cold-start'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixture = join('benchmarks', 'canvas', 'figure.json');
  const look = JSON.parse(readFileSync(LOOK, 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const measured = runs(() => {
      const call = { call: 'view3d', doc: join(root, fixture), look, size: [1280, 800], frames: 1, fps: 60, cold: true };
      const answer = once('deep-gpu', ['run', ...(planted() ? ['--planted', planted()] : [])], { out: dir, calls: [call] });
      const cold = answer.replies?.[0]?.cold;
      if (answer.ok !== true || !Number.isFinite(cold?.since_spawn_ms)) throw Error(`deep-gpu view3d answered ${JSON.stringify(answer).slice(0, 1500)}`);
      return { ms: cold.since_spawn_ms, pipelines: cold.pipelines };
    });
    console.log(JSON.stringify({ task: 'replica-cold-start', fingerprint, fixture, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #896's two boards of a run, the 1,000-item one first; `null` for a run with any other boards.
const pair = (r) => {
  const [small, large] = r.boards ?? [];
  return r.boards?.length === 2 && small?.items === DIRTY_BOARDS[0] && large?.items === DIRTY_BOARDS[1] ? [small, large] : null;
};
const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.5 * xs.length) - 1)];
/** The CPU per patch at the last board against the first: the difference of their p50s, over the first's. */
const cpuGrowth = (r) => {
  const [a, b] = [r.boards?.[0], r.boards?.at(-1)].map((board) => p50(board?.samples.map((s) => s.cpu_ms) ?? [0]));
  return a > 0 ? Math.abs(b - a) / a : 0;
};
/** The most bytes the view uploaded for one patch of a run, each patch changing one item. */
const uploadPerItem = (r) => Math.max(0, ...(r.boards ?? []).flatMap((b) => b.samples.map((s) => s.uploaded_bytes)).filter(Number.isInteger));
/** Why a target can't be judged on a run, if it can't. */
const unjudged = {
  cpu_growth: (r) => (pair(r) ? null : `a run patches ${JSON.stringify((r.boards ?? []).map((b) => b.items))} items, not ${DIRTY_BOARDS.join(' then ')}`),
  upload_bytes_per_item: (r) => ((r.boards ?? []).every((b) => b.samples.every((s) => Number.isInteger(s.uploaded_bytes)))
    ? null : 'a patch doesn\'t report the bytes it uploaded'),
};

// Each task's targets: where `judge` reads each from a run, and whether it is a count, judged on any machine.
const EFFICIENCY = {
  'canvas-patch-settled': { settled_p95_ms: (r) => r.p95_ms },
  'canvas-patch-dirty': { cpu_growth: cpuGrowth, upload_bytes_per_item: uploadPerItem },
  'canvas-scene-read': { summary_ms: (r) => r.summary.ms, summary_tokens: (r) => r.summary.tokens, page_ms: (r) => r.page.ms, page_rows: (r) => r.page.rows },
  'canvas-idle': { frames: (r) => r.frames, wakeups: (r) => r.wakeups, cpu_fraction: (r) => r.cpu_fraction },
  'replica-cold-start': { first_settled_ms: (r) => r.ms },
};
const COUNTS = new Set(['summary_tokens', 'page_rows', 'frames', 'upload_bytes_per_item']);

/** The stage that took the most of a sample's time, as a reason names it (#896); none for a sample without stages. */
const costliest = (s) => {
  const [name, ms] = Object.entries(s.stages ?? {}).reduce((a, e) => (e[1] > a[1] ? e : a), ['', -1]);
  return name ? `, most of it stage ${name} ${ms.toFixed(3)} ms` : '';
};
const grouped = (n) => n.toLocaleString('en-US');

/** What a failed target names, run by run: the frame and the nodes it ran, a reply's size, the frames drawn, the pipelines. */
const named = {
  settled_p95_ms: (runs) => runs.map((r, i) => {
    const worst = r.samples.reduce((a, s) => (s.ms > a.ms ? s : a));
    const ran = Object.entries(worst.ran).map(([op, n]) => `${op} ${n}`).join(', ');
    return `run ${i + 1}: patch ${worst.patch} settled in frame ${worst.frame} after ${worst.ms.toFixed(3)} ms${costliest(worst)}, a frame that ran ${ran}`;
  }),
  // The operator that built the most marks for one patch on the larger board.
  cpu_growth: (runs) => runs.map((r, i) => {
    const large = pair(r)?.[1].samples ?? [];
    const [op, n] = large.flatMap((s) => Object.entries(s.marks ?? {})).reduce((a, e) => (e[1] > a[1] ? e : a), ['no operator', 0]);
    return `run ${i + 1}: ${op} built ${grouped(n)} marks for one patch at ${grouped(DIRTY_BOARDS[1])} items`;
  }),
  upload_bytes_per_item: (runs, limit) => runs.map((r, i) => {
    const worst = r.boards.flatMap((b) => b.samples).reduce((a, s) => (s.uploaded_bytes > a.uploaded_bytes ? s : a));
    return worst.uploaded_bytes > limit ? `run ${i + 1}: patch ${worst.patch} uploaded ${grouped(worst.uploaded_bytes)} B` : null;
  }).filter(Boolean),
  summary_tokens: (runs, limit) => runs.filter((r) => r.summary.tokens > limit).map((r) => `summary: ${r.summary.tokens} tokens, ${r.summary.bytes} bytes, ${r.summary.rows} rows`),
  page_rows: (runs, limit) => runs.filter((r) => r.page.rows > limit).map((r) => `page: ${r.page.rows} rows, ${r.page.tokens} tokens, ${r.page.bytes} bytes${r.page.next === null ? ', unpaged' : ''}`),
  frames: (runs, limit) => runs.map((r, i) => [r, i]).filter(([r]) => r.frames > limit)
    .map(([r, i]) => `run ${i + 1} drew ${r.frames} frames while still: ${r.drawn.slice(0, 5).map((d) => `frame ${d.frame} at ${Math.round(d.at_ms)} ms`).join(', ')}${r.frames > 5 ? ', …' : ''}`),
  first_settled_ms: (runs) => {
    const first = [...new Set(runs.flatMap((r) => r.pipelines.filter((p) => p.on_first_frame).map((p) => p.name)))];
    return [first.length ? `pipelines compiled on the first frame: ${first.join(', ')}` : 'no pipeline compiled on the first frame'];
  },
};

function judgeEfficiency(current) {
  const task = current.task;
  const profile = current.fingerprint?.build?.profile ?? null;
  if (profile !== 'release') {
    console.log(JSON.stringify({ task, status: 'INVALID', profile, targets: {},
      reason: profile === null ? 'the reading names no build profile; only a release build is timed' : `the reading comes from a ${profile} build, not release; only a release build is timed` }));
    return;
  }
  const { targets } = JSON.parse(readFileSync(join(root, 'benchmarks', 'budgets.json'), 'utf8')).tasks.find((t) => t.id === task);
  const judged = {};
  const reasons = [];
  for (const [name, limit] of Object.entries(targets)) {
    const values = (current.runs ?? []).map(EFFICIENCY[task][name]);
    const why = (current.runs ?? []).map((r) => unjudged[name]?.(r)).find(Boolean);
    let verdict;
    // A pipeline compiled on the first frame stalls it, whatever the time (Meter and degrade ladder: pipelines
    // compile off-screen), so it fails a cold start on any machine.
    if (why) {
      verdict = { status: 'BLOCKED', limit, runs: values, reason: why };
    } else if (name === 'first_settled_ms' && current.runs.some((r) => r.pipelines.some((p) => p.on_first_frame))) {
      verdict = { status: 'FAIL', limit, runs: values };
    } else if (COUNTS.has(name)) {
      verdict = values.length === RUNS && values.every(Number.isFinite)
        ? (values.some((v) => v > limit) ? { status: 'FAIL', limit, runs: values } : { status: 'PASS', limit, runs: values })
        : { status: 'BLOCKED', limit, runs: values, reason: `a count is judged on five runs, got ${JSON.stringify(values)}` };
    } else {
      verdict = judgeLimit({ limit, runs: values, fingerprint: current.fingerprint });
    }
    if (verdict.status === 'FAIL') {
      verdict.reason = [`${name} over ${limit}`, ...(named[name]?.(current.runs, limit) ?? [verdict.reason])].join('; ');
      reasons.push(verdict.reason);
    } else if (verdict.reason) {
      reasons.push(`${name}: ${verdict.reason}`);
    }
    judged[name] = verdict;
  }
  const statuses = Object.values(judged).map((v) => v.status);
  const status = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((s) => statuses.includes(s)) ?? 'PASS';
  console.log(JSON.stringify({ task, status, profile, targets: judged, ...(reasons.length ? { reason: reasons.join(' | ') } : {}) }));
}

// #105: a bug capture of the second display through `deep-show run` on the virtual clock: picked, the chord held for
// 119.5 s, released and saved; fails unless the saved asset holds every frame of the hold.
workloads['capture-save'] = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const displays = RING_DISPLAYS.map((d) => ({ ...d, feed: `feed-${d.uuid}` }));
    const down = 3 * SEC, up = down + 119.5 * SEC;
    const calls = [
      { call: 'capture', at: 2 * SEC, session: 'alpha', source: 'screen', words: 'The legend overlaps the chart' },
      { call: 'pick', at: 2.5 * SEC, display: 'B' },
      { call: 'shortcut', at: down, phase: 'down', source: 'hid' },
      { call: 'shortcut', at: up, phase: 'up', source: 'hid' },
      { call: 'captures', at: up + SEC },
    ];
    const sessions = { alpha: { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1_000 } } };
    const [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, sessions, clock: { lead: 1_411_200, check: 352_800 }, displays, window: [1200, 700], panels: {}, calls })]);
    const frames = answer.replies?.[4]?.captures?.[0]?.frames;
    // B's vsyncs in [down, up): 60 Hz for 119.5 s.
    if (answer.ok !== true || frames !== 119.5 * 60) throw Error(`the capture didn't keep every frame: ${JSON.stringify(answer).slice(0, 2000)}`);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
await workloads[task]();
