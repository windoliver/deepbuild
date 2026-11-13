// One canvas workload per run, for the perf lane's budgets (issues #96, #305, #379, #383, #417 and #854): node
// benchmarks/canvas.mjs <task>. Each drives a built binary over JSON lines, as the acceptance tests do: `deep-show run`
// for patches and the seal, `deep-canvas merge` for a merge, `deep-gpu run` for the deepest level of a 3D city.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// Passes the bench doesn't time, which keep their declared terms (#200): the shadow map, which its scenes don't cast,
// and the object-ID writes, which run and are timed inside scene3d.geometry, whose bytes count the object-ID target.
const DECLARED_ONLY = ['scene3d.shadow', 'scene3d.object_id'];

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
  const lines = calls.map(({ docs, surface, history, ...call }, c) => {
    const sessions = docs.map((doc, i) => {
      const path = join(dir, `doc-${c}-${i}.json`);
      writeFileSync(path, JSON.stringify(doc));
      return { session: `s-${i}`, writer: `agent:bench-${i}`, doc: path, ...(surface ? { surface } : {}) };
    });
    return { call: 'live', look: history ? { ...look, history } : look, sessions, ...call };
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
  for (const pass of DECLARED_ONLY) if (declared.terms[pass]) terms[pass] = declared.terms[pass];
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
    // #140: the seams' backends that drew the frames, as the live view names them.
    report.backends = runs[0]?.backends;
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

// #429: a composed operator's GPU time in its class. The data_view fixture with a composed pass that tints the
// frame (resolution half, the class's), five runs of 300 frames after 30 of warm-up, each run the p95 of the
// operator's own pass; the perf lane compares it with the merge base, which draws no operator item.
const OPERATOR_LIMITS = { data_view: 0.5 };
workloads.operator = () => {
  const cls = process.argv[3] ?? 'data_view';
  if (!(cls in OPERATOR_LIMITS)) throw Error(`Unknown class ${cls}; one of: ${Object.keys(OPERATOR_LIMITS).join(', ')}`);
  const doc = JSON.parse(readFileSync(join(root, 'benchmarks', 'canvas', `${cls}.json`), 'utf8'));
  doc.requires.modules.effects = '^1';
  doc.items.tint = { id: 'tint', kind: 'gpu.pass@1', name: 'Tint', order: 'z0', params: {
    about: 'The #429 benchmark pass: adds 0.6 to the frame\'s red.', origin: 'composed',
    inputs: { src: { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } } },
    steps: { uv: { op: 'screen_uv@1', args: {} }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
      red: { op: 'const@1', args: { value: [0.6, 0, 0, 0], type: 'vec4' } }, out: { op: 'add@1', args: { a: 'c', b: 'red' } } },
    outputs: { color: 'out' }, chain: 'effects', order: 'a0', resolution: 'half', cost: { ns_per_px: 50 }, fallback: 'look' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const runs = liveCalls(dir, Array.from({ length: 5 }, () => ({ docs: [doc], frames: WARM_UP + WARM_FRAMES, report: ['passes'] })));
    const report = { task: 'operator', class: cls, limit_ms: OPERATOR_LIMITS[cls], fingerprint: fingerprint(), runs: runs.map((r) => {
      const ms = r.frames.slice(WARM_UP).map((f) => f.passes.filter((p) => p.operator === 'tint').reduce((s, p) => s + (p.end_ns - p.start_ns) / 1e6, 0));
      return { frames: ms.length, operator_p95_ms: p95(ms) };
    }) };
    console.log(JSON.stringify(report));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #483: the structural steps' GPU time. sort_by_key of 1,048,576 keys, scan and compact of 1,048,576 elements,
// each a check_operator frame dispatched 300 times on the same inputs, five runs after one of warm-up, each run the
// p95 of the step's GPU time from its passes' own timestamps; the perf lane compares them with the merge base,
// which has none of these steps.
workloads.structural = () => {
  const n = 1_048_576;
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    let x = 4837;
    const word = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return (x >>>= 0); };
    const file = (name, f) => { const p = join(dir, `${name}.u32`); writeFileSync(p, Buffer.from(Uint32Array.from({ length: n }, (_, i) => f(i)).buffer)); return p; };
    const data = { keys: file('keys', word), vals: file('vals', (i) => i), xs: file('xs', word), flags: file('flags', () => (word() % 10 < 3 ? 1 : 0)) };
    const core = (type, name) => ({ type, count: n, from: { storage: { op: 'core', output: name } } });
    const op = (id, steps, outputs, inputs) => ({ id, kind: 'compute', origin: 'composed', about: `The #483 benchmark ${id}.`, inputs, steps, outputs, elements: n, workgroup: 256, cost: { ns_per_element: 100 } });
    const operators = [
      op('srt', { s: { op: 'sort_by_key@1', args: { keys: 'keys', values: 'vals', count: n } } }, { sorted: { storage: { type: 'u32', count: n }, from: 's' } }, { keys: core('u32', 'keys'), vals: core('u32', 'vals') }),
      op('scn', { sc: { op: 'scan@1', args: { in: 'xs', op: 'add' } } }, { out: { storage: { type: 'u32', count: n }, from: 'sc' } }, { xs: core('u32', 'xs') }),
      op('cmp', { c: { op: 'compact@1', args: { in: 'vals', flag: 'flags', count: n } } }, { kept: { storage: { type: 'u32', count: n }, from: 'c.out' }, n: { storage: { type: 'u32', count: 1 }, from: 'c.count' } }, { vals: core('u32', 'vals'), flags: core('bool', 'flags') }),
    ];
    const calls = Array.from({ length: 6 }, () => ({ call: 'check_operator', operators, data, repeat: 300 }));
    const [answer] = run('deep-gpu', 'run', [JSON.stringify({ out: dir, calls })]);
    if (answer.ok !== true || answer.replies.some((r) => r.outcome !== 'accepted')) throw Error(`deep-gpu check_operator answered ${JSON.stringify(answer).slice(0, 1500)}`);
    const limits = { srt: 2, scn: 0.5, cmp: 0.5 };
    const report = { task: 'structural', limits_ms: limits, fingerprint: fingerprint(), runs: answer.replies.slice(1).map((r) =>
      Object.fromEntries(Object.keys(limits).map((k) => [`${k}_p95_ms`, p95(r.timing.gpu_ns[k].map((ns) => ns / 1e6))]))) };
    console.log(JSON.stringify(report));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #386: the upscale's two passes on a 1080p frame of 12 px labels and thin diagonal lines, drawn at
// internal scale 0.5 through the edge-adaptive upscale: each frame's time the two passes cover, by their
// timestamps, five runs after a warm-up one.
const UPSCALE_PASSES = ['surface.upscale', 'surface.sharpen'];
function typeDoc() {
  const items = { cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: 32 } } };
  for (let i = 0; i < 48; i++) {
    items[`t-${i}`] = { id: `t-${i}`, kind: 'mark.text@1', name: `Label ${i}`, order: `b${String(i).padStart(2, '0')}`,
      params: { text: `Latency p95 ${i}.${i % 10} ms`, size: 12, font: 'body', paint: { fill: { role: 'ink' } } }, at: { pos: [-13.5 + (i % 6) * 5.4, 7.2 - Math.floor(i / 6) * 2.05, 0] } };
  }
  for (let i = 0; i < 24; i++) {
    const a = ((15 + (i * 60) / 23) * Math.PI) / 180;
    items[`l-${i}`] = { id: `l-${i}`, kind: 'mark.line@1', name: `Line ${i}`, order: `c${String(i).padStart(2, '0')}`,
      params: { points: [[0, 0, 0], [5 * Math.cos(a), 5 * Math.sin(a), 0]], width: 2, paint: { fill: { role: 'ink' } } }, at: { pos: [-14 + (i % 8) * 4, -6.5 + Math.floor(i / 8) * 5.5, 0] } };
  }
  return { format: 1, profile: 'scene', title: 'Labels and diagonals', description: 'A #386 bench document.', size: [1920, 1080], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, transport: { span: '60s' }, items,
    channels: { slide: { target: 'items/l-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -14, interp: 'linear' }, k1: { t: '60s', value: -10, interp: 'linear' } } } } };
}
workloads.upscale = () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const surface = { internal_scale: 0.5, upscale: 'edge_adaptive', sharpen: 0.2 };
    const call = () => ({ docs: [typeDoc()], frames: 90, fps: 60, report: ['passes'] });
    const runs = Array.from({ length: RUNS + 1 }, () => {
      const [reply] = liveCalls(dir, [call()].map((c) => ({ ...c, surface })));
      const covered = reply.frames.slice(WARM_UP).map((f) => {
        const ps = f.passes.filter((p) => UPSCALE_PASSES.includes(p.name)).sort((a, b) => a.start_ns - b.start_ns);
        if (ps.length !== 2) throw Error(`frame ${f.frame}: the upscale's passes didn't both run: ${JSON.stringify(f.passes).slice(0, 600)}`);
        let ns = 0;
        let end = -Infinity;
        for (const p of ps) { ns += Math.max(0, p.end_ns - Math.max(p.start_ns, end)); end = Math.max(end, p.end_ns); }
        return ns / 1e6;
      });
      return { frames: covered.length, upscale_p95_ms: p95(covered) };
    }).slice(1);
    console.log(JSON.stringify({ task: 'upscale', fingerprint: fingerprint(), runs }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #173: frame history's resolve over an 8-frame window on a 1080p view whose camera orbits: each frame's
// `look.history` pass time by its timestamps, five runs of 90 frames after a warm-up one.
workloads.history = () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = sceneDoc({ title: 'An orbit with frame history', budgetClass: 'showpiece', size: [1920, 1080], boxes: 48 });
    doc.channels = { orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '60s', value: 390, interp: 'linear' } } } };
    const call = { docs: [doc], frames: 90, fps: 60, report: ['passes'], history: { mode: 'antialias', window: 8 } };
    const runs = Array.from({ length: RUNS + 1 }, () => {
      const [reply] = liveCalls(dir, [call]);
      const ms = reply.frames.slice(WARM_UP).flatMap((f) => f.passes.filter((p) => p.name === 'look.history').map((p) => (p.end_ns - p.start_ns) / 1e6));
      if (ms.length === 0) throw Error(`the resolve never ran: ${JSON.stringify(reply.frames.at(-1)).slice(0, 600)}`);
      return { frames: ms.length, resolve_p95_ms: p95(ms) };
    }).slice(1);
    console.log(JSON.stringify({ task: 'history', fingerprint: fingerprint(), runs }));
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

// Idle (#854, #1551): the still board held in the app's real, shown window (`deep-show live`) for 60 s of the real
// clock from the moment it settles: the frames it presented, the request-frame callbacks its display link ran, the
// process's wakeups and CPU over that minute, and whether the window was shown throughout. The warm-up run holds it
// 5 s. `--planted arms_each_vsync` passes deep-show's clock that arms a frame each vsync once settled.
const stillAsAgent = (doc) => {
  const sent = structuredClone(doc);
  delete sent.id;
  delete sent.layers;
  for (const item of Object.values(sent.items)) delete item.layer;
  return sent;
};
workloads.idle = () => {
  const fingerprint = release('deep-show', 'deep-show');
  const fixture = join('benchmarks', 'canvas', 'still.json');
  const document = stillAsAgent(JSON.parse(readFileSync(join(root, fixture), 'utf8')));
  const [w, h] = document.size;
  const measured = runs((warm) => {
    const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
    try {
      const answer = once('deep-show', ['live'], {
        evidence, sessions: { s1: { thread: 'thread-a', name: 'agent-a', process: { pid: 4100, start: 1000 } } },
        processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1000 }],
        panels: { main: { rect: [0, 0, w, h] } }, docs: { still: { panel: 'main' } }, window: [w, h + 40],
        clock: { refresh_hz: 60, lead: 0, check: 0 }, calls: [{ call: 'deep_show', session: 's1', doc: 'still', document, at: 0 }],
        live: { watch_from: 'settled', watch_ms: (warm ? 5 : 60) * 1000 }, ...(planted() ? { planted: planted() } : {}),
      });
      const spent = (p) => ({ seconds: p.seconds, wakeups: p.wakeups, interrupt_wakeups: p.interrupt_wakeups, cpu_ms: p.cpu_ms,
        cpu_fraction: p.cpu_ms / (p.seconds * 1000), energy: p.energy });
      // A window AppKit never showed (covered, hidden, a sleeping display or a locked screen) is read as that: what it
      // and the process did while deep-show waited for a first frame, with no frame drawn.
      if (answer.code === 'no_display' && answer.window && answer.process) {
        return { opened_frames: 0, frames: 0, drawn: [], ...spent(answer.process), request_frames: answer.request_frames, window: answer.window };
      }
      if (answer.ok !== true || !answer.live?.process) throw Error(`deep-show live answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const { frames, process: p, request_frames, window } = answer.live;
      return {
        opened_frames: 1, frames: frames.length,
        drawn: frames.map((f) => ({ frame: f.frame_seq, at_ms: Math.max(0, (f.presented_ns - p.from_ns) / 1e6) })),
        ...spent(p), request_frames, window,
      };
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
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

// #465: the finishes', the flare's and the mirror's GPU cost at 1080p on a release `deep-gpu`, each the difference of
// two sides' median `gpu_ms` over 300 frames of one stage (a floor plate, twelve boxes, a sun, a point light, an orbiting
// camera), and the indexed look's target bytes from `film2d`; one warm-up run and five, each a fresh process. The
// stage and the finishes are tests/acceptance/465/budgets.test.ts's.
const FLARE_SIZE = [1920, 1080];
function flareStage({ flare = false, mirror = false } = {}) {
  const floor = { base_color: [0.05, 0.05, 0.06, 1], metallic: 0, roughness: 0.2 };
  if (mirror) floor.mirror = { strength: 1, blur: 0, plane: 'floor' };
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.8, 0], orbit: { azimuth: 30, elevation: 15, distance: 9 }, fov: 45, near: 0.1, far: 500 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-45, 30, 0] } },
    'key-light': { kind: 'light.point@1', params: { power: 4.93, radius: 0.05, color: [1, 1, 1], shadow: false }, at: { pos: [0.8, 1.6, -1] } },
    floor_mat: { kind: 'material@1', params: floor },
    box_mat: { kind: 'material@1', params: { base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6 } },
    floor: { kind: 'plate@1', params: { grid: [1, 1], size: [20, 20] }, at: { pos: [0, 0, 0], rot: [0, 0, 0] }, material: 'floor_mat' },
  };
  for (let k = 0; k < 12; k++) items[`box${k}`] = { kind: 'mark.box@1', params: { size: [0.7, 0.7 + 0.15 * (k % 4), 0.7] }, at: { pos: [3 * Math.cos((k * Math.PI) / 6), 0.35 + 0.075 * (k % 4), 3 * Math.sin((k * Math.PI) / 6)] }, material: 'box_mat' };
  if (flare) items.flare = { kind: 'effect@1', params: { kind: 'flare', flare: { from: 'lights', ghosts: 8, halo: 0.05, streak: { count: 6, length: 0.25, anamorphic: false }, starburst: { blades: 6 }, intensity: 1 } } };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: 'flares-mirrors', profile: 'scene', title: 'Flares and mirrors', size: FLARE_SIZE, camera: 'cam', seed: 465,
    transport: { span: '10s' }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items,
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '10s', value: 150, interp: 'linear' } } } } };
}
const FLARE_FINISH = [
  { print_wear: { flicker: '5%', weave: 1.5, scratches: { count: [1, 3], width: 2, life: 6 }, dust: { density: 0.3, size: 3 }, hair: 0.2, gate: { corner_radius: 40, softness: 8 }, rate: 24 } },
  { tone_curve: { black: 0.04, white: 0.96, contrast: 1.15, toe: 0.2, shoulder: 0.2 } },
  { screen: { kind: 'crt', scanlines: 240, mask: 'aperture', curvature: 0.1 } },
  { grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } },
  { vignette: { color: 'ink', shape: 'round', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } },
];
workloads['flares-mirrors'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixtures = join(root, 'tests', 'acceptance', '465', 'fixtures');
  const look2d = JSON.parse(readFileSync(join(fixtures, 'look.json'), 'utf8'));
  // A physical look as the suite's FILMIC: its 2D look's palette, roles, fonts and status, a physical basis.
  const look = { ...look2d, id: 'filmic-465', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const docs = Object.fromEntries(['plain', 'flare', 'mirror'].map((k) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(flareStage({ flare: k === 'flare', mirror: k === 'mirror' })));
      return [k, path];
    }));
    const side = (doc, lk) => ({ call: 'view3d', doc, look: lk, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const indexed = { ...look2d, basis: { indexed: { size: [320, 180], scale: 6, palette: ['ground'], tables: {}, protected: [], snap: 'integer', light: { max: 255 } } } };
    const wall = { format: 1, id: 'indexed-465', profile: 'figure', title: 'Indexed', size: FLARE_SIZE, seed: 465, transport: { span: '1s' }, budget: { class: 'showpiece' },
      layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items: {} };
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.plain, look), side(docs.plain, { ...look, finish: FLARE_FINISH }), side(docs.flare, look), side(docs.mirror, look),
        { call: 'film2d', doc: wall, look: indexed, frames: 1, hash: true }] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [plain, finish, flare, mirror] = answer.replies.slice(0, 4).map((r) => median(r.frames.map((f) => f.gpu_ms)));
      return { plain_gpu_ms: plain, finish_gpu_ms: Math.max(0, finish - plain), flare_gpu_ms: Math.max(0, flare - plain),
        mirror_share: Math.max(0, (mirror - plain) / plain), indexed_target_bytes: answer.replies[4].indexed.target_bytes };
    });
    console.log(JSON.stringify({ task: 'canvas-flares-mirrors', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #166: the water's GPU cost at 1080p on a release `deep-gpu`, each the difference of two sides' median `gpu_ms` over
// 300 frames, the water against the same plate as a plain mirror (strength 1, blur 0, roughness 0), so the mirror's own
// pass is in both: a 400 m lake filling the lower half of the frame (four waves, ripples, rain) seen level from 2 m, and
// a 10 m plate of 256 × 256 cells seen 300 m away, whose difference bounds its waves' vertex cost. One warm-up run and
// five, each a fresh process. The stages are tests/acceptance/166/budgets.test.ts's.
const WATER_WAVES = [
  { direction: 20, length: 9, amplitude: 0.12, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.08, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.05, steepness: 0.4 },
  { direction: 300, length: 3.2, amplitude: 0.03, steepness: 0.7 },
];
function waterStage(kind, water) {
  const plain = { base_color: [0.1, 0.12, 0.12, 1], roughness: 0, mirror: { strength: 1, blur: 0, plane: 'lake' } };
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: kind === 'lake' ? [0, 2, 0] : [0, 40, 300], target: kind === 'lake' ? [0, 2, -100] : [0, 0, 0], fov: 60, near: 0.1, far: 1000 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-30, 30, 0] } },
    'lake-water': { kind: 'material@1', params: water ? { roughness: 0, water } : plain },
    crate: { kind: 'material@1', params: { base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 } },
    lake: { kind: 'plate@1', params: { grid: [256, 256], size: kind === 'lake' ? [400, 400] : [10, 10] }, at: { pos: [0, 0, 0] }, material: 'lake-water' },
  };
  if (kind === 'lake') for (let k = 0; k < 12; k++) items[`crate${k}`] = { kind: 'mark.box@1', params: { size: [1.5, 1.5, 1.5] }, at: { pos: [-15 + 2.7 * k, 0.5, -20 - 4 * (k % 3)] }, material: 'crate' };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' });
  return { format: 1, id: `water-${kind}`, profile: 'scene', title: 'Water', size: FLARE_SIZE, camera: 'cam', seed: 166, transport: { span: '30s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items };
}
workloads.water = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-166', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const stages = {
      lake: waterStage('lake', { waves: WATER_WAVES, ripples: { strength: 0.3 }, rain: 50 }), lakeMirror: waterStage('lake', null),
      pond: waterStage('pond', { waves: WATER_WAVES, ripples: { strength: 0 }, rain: 0 }), pondMirror: waterStage('pond', null),
    };
    const docs = Object.fromEntries(Object.entries(stages).map(([k, d]) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: ['lake', 'lakeMirror', 'pond', 'pondMirror'].map((k) => side(docs[k])) });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [lake, lakeMirror, pond, pondMirror] = answer.replies.map((r) => median(r.frames.map((f) => f.gpu_ms)));
      const water = answer.replies[0].frames.map((f) => f.passes_ms?.['scene3d.water'] ?? 0);
      return { lake_gpu_ms: Math.max(0, lake - lakeMirror), waves_vertex_ms: Math.max(0, pond - pondMirror), water_pass_ms: median(water), mirror_gpu_ms: lakeMirror };
    });
    console.log(JSON.stringify({ task: 'canvas-water', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #268: the same 1080p lake with its shore on: twelve piles, a quay and a floating deck in its shore's collection
// (`cell: 0.25`, shade 0.5), against the same plate and items as a plain mirror, so the mirror's own pass is in both;
// and the field's bake time, the frame row's `shore.bake_ms`, as a reading. The stage is
// tests/acceptance/268/budgets.test.ts's.
function shoreStage(water) {
  const doc = waterStage('lake', water);
  const wood = { kind: 'material@1', params: { base_color: [0.5, 0.36, 0.24, 1], roughness: 0.8 } };
  const shapes = { wood, quay: { kind: 'mark.box@1', params: { size: [60, 3, 6] }, at: { pos: [0, -0.5, -40] }, material: 'wood' },
    deck: { kind: 'mark.box@1', params: { size: [8, 0.2, 6] }, at: { pos: [-10, 0.6, -14] }, material: 'wood' } };
  for (let k = 0; k < 12; k++) shapes[`pile${k}`] = { kind: 'mark.cylinder@1', params: { size: [1, 3, 1] }, at: { pos: [-15 + 2.7 * k, 0, -20 - 4 * (k % 3)] }, material: 'wood' };
  for (const id of Object.keys(doc.items)) if (id.startsWith('crate')) delete doc.items[id];
  let order = Object.keys(doc.items).length;
  for (const [id, item] of Object.entries(shapes)) doc.items[id] = { ...item, id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main' };
  doc.collections = { 'lake-shore': { members: Object.keys(shapes).filter((k) => k !== 'wood') } };
  return doc;
}
workloads['water-shore'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'filmic-268', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const shore = { waves: WATER_WAVES, ripples: { strength: 0.3 }, rain: 50, shore: { items: 'lake-shore', cell: 0.25, shade: 0.5 } };
    const docs = Object.fromEntries(Object.entries({ shore: shoreStage(shore), mirror: shoreStage(null) }).map(([k, d]) => {
      const path = join(dir, `${k}.json`);
      writeFileSync(path, JSON.stringify(d));
      return [k, path];
    }));
    const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [side(docs.shore), side(docs.mirror), { ...side(docs.shore), frames: 1, capture: [0], shore: true, timings: false }] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [lake, mirror] = answer.replies.slice(0, 2).map((r) => median(r.frames.map((f) => f.gpu_ms)));
      const water = answer.replies[0].frames.map((f) => f.passes_ms?.['scene3d.water'] ?? 0);
      return { shore_lake_gpu_ms: Math.max(0, lake - mirror), water_pass_ms: median(water), mirror_gpu_ms: mirror, bake_ms: answer.replies[2].frames[0]?.shore?.bake_ms ?? null };
    });
    console.log(JSON.stringify({ task: 'canvas-water-shore', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #2017: the modeling, scatter, terrain and wind task's budgets (#442) on release builds, one warm-up run and five,
// each a fresh process per binary. `deep-show`'s `geometry` with `timings` reads a bevel with weighted normals on a
// 10,000-face prop, two levels of subdivision of a 1,000-face mesh, distributing 100,000 points with pruning, and a
// 1,000-span curve's arc-length table; a still scene (the terrain plate with its levels, a scattered lawn, the prop,
// the mesh and a rail swept along a curve) counts the steps its frames after the first run: the operators the
// scheduler runs past the same scene's without the task's items (one box), frame by frame, and `view3d`'s meshes
// built, instances written, element uploads, batches encoded and terrain tiles selected; and
// 10,000 instanced trees of 2,000 vertices at 1080p add the difference of the median `gpu_ms` with their sway on and
// off, 300 frames a side. The fixtures are tests/acceptance/2017/helpers.ts's.
const GROUND_SESSION = { s1: { thread: 'thread-a', name: 'agent-a', process: { pid: 4100, start: 1000 } } };
const GROUND_PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1000 }];
const VASE = [[0, 0], [0.3, 0.02], [0.34, 0.1], [0.36, 0.3], [0.3, 0.5], [0.2, 0.62], [0.16, 0.7], [0.18, 0.8], [0.22, 0.86], [0.2, 0.9], [0, 0.9]].map((p) => [...p, false]);
const groundMaterial = (base, roughness = 0.8) => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
const groundBox = (size, pos, material, more = {}) => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...more });
const groundFlat = (size, pos, material) => ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos }, material });
const groundCamera = (position, target) => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 60, near: 0.5, far: 2000 } });
const groundSun = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-35, 30, 0] } };
const groundSky = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
const groundMaterials = () => ({ clay: groundMaterial([0.62, 0.4, 0.3], 0.6), leaves: groundMaterial([0.2, 0.42, 0.18], 0.9), petals: groundMaterial([0.85, 0.4, 0.55], 0.7), soil: groundMaterial([0.35, 0.28, 0.2], 1) });
const groundProtos = () => ({ bush: groundBox([0.6, 0.6, 0.6], [0, 0.3, 0], 'leaves', { visible: false }), flower: groundBox([0.2, 0.2, 0.2], [0, 0.1, 0], 'petals', { visible: false }) });
const groundProp = (segments, pos) => ({ kind: 'lathe@1', params: { outline: VASE, segments }, material: 'clay', at: { pos },
  modifiers: [{ kind: 'mod.bevel@1', params: { width: 0.002, segments: 2 } }, { kind: 'mod.normals@1', params: { mode: 'weighted' } }] });
const groundMesh = (segments, pos) => ({ kind: 'lathe@1', params: { outline: VASE, segments }, material: 'clay', at: { pos }, modifiers: [{ kind: 'mod.subdivide@1', params: { levels: 2 } }] });
const groundPath = (spans, c) => ({ kind: 'curve@1', params: { mode: 'catmull_rom',
  points: Array.from({ length: spans + 1 }, (_, k) => [c[0] + 20 * Math.cos(k * 0.05), c[1] + 0.01 * k, c[2] + 20 * Math.sin(k * 0.05)]) } });
const groundScatter = (on, max) => ({ kind: 'instance@1', params: { of: ['bush', 'flower'],
  from: { distribute: { on, mode: 'poisson', min_distance: 0.5, prune: 'larger_first', seed: 2017, ...(max === undefined ? {} : { max }) } } } });
const GROUND_PLATE = { height: '0.03 * (1 - 4 * fract(position.x * 0.5)) + 6 * sin(position.x * 0.025) * cos(position.z * 0.019) + 2 * sin((position.x + position.z) * 0.07)',
  size: [512, 512], spacing: 1, tile: 64, lod_levels: 6 };
function groundDoc(id, size, items) {
  let order = 0;
  for (const [key, item] of Object.entries(items)) Object.assign(item, { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main' });
  return { format: 1, id, profile: 'scene', title: id, description: `${id}: the #2017 budgets' fixture.`, size, camera: 'cam', seed: 2017,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items };
}
const groundStages = () => ({
  budget: groundDoc('budgets-2017', [640, 360], { cam: groundCamera([0, 30, 150], [0, 0, 0]), sun: groundSun, ...groundMaterials(),
    prop: groundProp(1000, [0, 0, 0]), mesh: groundMesh(100, [2, 0, 0]), field: groundFlat([200, 200], [0, 0, 0], 'soil'), ...groundProtos(),
    scatter: groundScatter('field', 100_000), path: groundPath(1000, [0, 1, 0]) }),
  bare: groundDoc('still-2017-bare', [640, 360], { cam: groundCamera([0, 25, 300], [0, 0, 0]), sky: groundSky, sun: groundSun, turf: groundMaterial([0.3, 0.42, 0.2], 0.9),
    ...groundMaterials(), block: groundBox([1, 1, 1], [0, 12.5, 230], 'clay') }),
  still: groundDoc('still-2017', [640, 360], { cam: groundCamera([0, 25, 300], [0, 0, 0]), sky: groundSky, sun: groundSun, turf: groundMaterial([0.3, 0.42, 0.2], 0.9),
    ...groundMaterials(), ground: { kind: 'plate@1', params: { terrain: { ...GROUND_PLATE } }, material: 'turf' },
    lawn: groundFlat([10, 10], [0, 12, 230], 'soil'), ...groundProtos(), shrubs: groundScatter('lawn'), prop: groundProp(64, [-6, 12, 240]), mesh: groundMesh(16, [6, 12, 240]),
    path: groundPath(100, [0, 14, 200]),
    rail: { kind: 'extrude@1', params: { outline: [[0, -0.05], [0.1, -0.05], [0.1, 0.05], [0, 0.05]], along: { curve: 'path', range: [0, 1], rings: 256 } }, material: 'clay' } }),
  ...Object.fromEntries([true, false].map((swaying) => {
    const pos = Array.from({ length: 10_000 }, (_, k) => [3 * (k % 100), 0, 3 * Math.floor(k / 100)]);
    return [swaying ? 'forestOn' : 'forestOff', groundDoc(`forest-2017-${swaying}`, FLARE_SIZE, {
      cam: groundCamera([148.5, 35, 360], [148.5, 0, 140]), sky: groundSky, sun: groundSun, needles: groundMaterial([0.18, 0.4, 0.2], 0.9), soil: groundMaterial([0.35, 0.28, 0.2], 1),
      earth: groundFlat([320, 320], [148.5, 0, 148.5], 'soil'),
      tree: { kind: 'lathe@1', params: { outline: [[0, 0, false], [0.25, 0.1, false], [0.25, 1, false], [1.2, 1.2, false], [0, 3.5, false]], segments: 249 }, material: 'needles', visible: false,
        modifiers: [{ kind: 'mod.sway@1', enabled: swaying, params: { amount: 0.3, wind: { direction: 0, speed: 5, gust: { scale: 20 } }, seed: 7 } }] },
      forest: { kind: 'instance@1', params: { of: ['tree'], ids: pos.map((_, k) => k), proto: pos.map(() => 0), pos, yaw: pos.map((_, k) => (k * 137.5) % 360), scale: pos.map(() => 1) } },
    })];
  })),
});
workloads.ground = () => {
  const fingerprint = release('deep-show', 'deep-show');
  release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'plain-2017', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const stages = groundStages();
    const path = (k) => { const p = join(dir, `${k}.json`); writeFileSync(p, JSON.stringify(stages[k])); return p; };
    const [still, forestOn, forestOff] = ['still', 'forestOn', 'forestOff'].map(path);
    const show = (stage, call) => {
      const answer = once('deep-show', ['run'], { evidence: dir, sessions: GROUND_SESSION, processes: GROUND_PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } },
        docs: { [DOC]: { panel: 'main' } }, calls: [{ call: 'deep_show', session: 's1', doc: DOC, document: stillAsAgent(stages[stage]) }, { doc: DOC, ...call }] });
      if (answer.ok !== true || answer.replies[0]?.outcome !== 'presented' || answer.replies[1]?.code) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
      return answer.replies[1];
    };
    const gpu = (calls) => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      return answer.replies;
    };
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const rows = new Map(show('budget', { call: 'geometry', items: ['prop', 'mesh', 'scatter', 'path'], timings: true }).items.map((r) => [r.id, r]));
      const [task, bare] = ['still', 'bare'].map((k) => show(k, { call: 'frames', count: 6 }).frames.map((f) => f.ran));
      const ran = task.slice(1).reduce((n, r, k) => n + Math.max(0, r - bare[k + 1]), 0);
      const [view] = gpu([{ call: 'view3d', doc: still, look, size: [640, 360], fps: 30, frames: 6, counts: true }]);
      const viewed = view.frames.slice(1).reduce((n, f) => n + f.meshes_built + f.instances_written + f.terrain_tiles_selected + f.encoded.length
        + Object.values(f.element_uploads).reduce((k, ids) => k + ids.length, 0), 0);
      const side = (doc) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 300, fps: 30, timings: true });
      const [on, off] = gpu([side(forestOn), side(forestOff)]).map((r) => median(r.frames.map((f) => f.gpu_ms)));
      const prop = rows.get('prop').stack;
      return { bevel_ms: prop[0].ms + prop[1].ms, subdivide_ms: rows.get('mesh').stack[0].ms, distribute_ms: rows.get('scatter').distribute_ms,
        arc_length_ms: rows.get('path').arc_length_ms, still_steps: ran + viewed, still_ran: ran, still_view_steps: viewed, sway_gpu_ms: Math.max(0, on - off), forest_gpu_ms: off };
    });
    console.log(JSON.stringify({ task: 'canvas-ground', fingerprint, runs: measured }));
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
  'canvas-look-frames': {
    frame_gpu_p95_ms: (r) => Math.max(...Object.values(r.looks).map((look) => p95(look.frames.map((f) => f.gpu_ms)))),
    frame_cpu_p95_ms: (r) => Math.max(...Object.values(r.looks).map((look) => p95(look.frames.map((f) => f.cpu_ms)))),
  },
  'replica-cold-start': { first_settled_ms: (r) => r.ms },
  'canvas-flares-mirrors': { finish_gpu_ms: (r) => r.finish_gpu_ms, flare_gpu_ms: (r) => r.flare_gpu_ms, mirror_share: (r) => r.mirror_share, indexed_target_bytes: (r) => r.indexed_target_bytes },
  'canvas-water': { lake_gpu_ms: (r) => r.lake_gpu_ms, waves_vertex_ms: (r) => r.waves_vertex_ms },
  'canvas-occlusion': { gpu_fall: (r) => r.gpu_fall, pyramid_declared_error: (r) => r.pyramid_declared_error },
  'canvas-water-shore': { shore_lake_gpu_ms: (r) => r.shore_lake_gpu_ms },
  'canvas-ground': {
    bevel_ms: (r) => r.bevel_ms, subdivide_ms: (r) => r.subdivide_ms, distribute_ms: (r) => r.distribute_ms, arc_length_ms: (r) => r.arc_length_ms,
    still_steps: (r) => r.still_steps, sway_gpu_ms: (r) => r.sway_gpu_ms,
  },
  // #538: each reading by its own name (benchmarks/game-state.mjs).
  'canvas-game-state': Object.fromEntries(['compare_ms', 'remap_row_us', 'remap_layer_ms', 'upload_slots_ms', 'overlay_upload_ms', 'fit_check_ms', 'idle_steps'].map((k) => [k, (r) => r[k]])),
};
const COUNTS = new Set(['summary_tokens', 'page_rows', 'frames', 'upload_bytes_per_item', 'indexed_target_bytes', 'still_steps', 'idle_steps']);

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

/** The window each canvas-idle run held (#1551): PASS only when all five runs say it was shown throughout. */
function shownWindow(runs) {
  const states = runs.map((r) => r.window?.state ?? 'headless');
  const off = states.map((state, i) => `run ${i + 1}: ${state}`).filter((_, i) => states[i] !== 'shown');
  if (states.length !== RUNS) off.push(`${states.length} runs, not ${RUNS}`);
  return off.length ? { status: 'INCONCLUSIVE', runs: states, reason: off.join(', ') } : { status: 'PASS', runs: states };
}

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
  // #1551: canvas-idle holds a shown window; a run hidden, covered, on a sleeping display or headless can't pass.
  const window = task === 'canvas-idle' ? shownWindow(current.runs ?? []) : null;
  if (window?.reason) reasons.push(`window: ${window.reason}`);
  const statuses = [...Object.values(judged), ...(window ? [window] : [])].map((v) => v.status);
  let status = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((s) => statuses.includes(s)) ?? 'PASS';
  // A window that wasn't shown leaves its run's readings saying nothing of a shown window: short of a FAIL, that is
  // INCONCLUSIVE, never PASS and never BLOCKED by the readings it couldn't make.
  if (window && window.status !== 'PASS' && status !== 'FAIL') status = 'INCONCLUSIVE';
  console.log(JSON.stringify({ task, status, profile, targets: judged, ...(window ? { window } : {}), ...(task === 'canvas-idle' ? { energy: energyReading(current.runs ?? []) } : {}),
    ...(reasons.length ? { reason: reasons.join(' | ') } : {}) }));
}

/** The idle task's energy, a reading beside CPU and never a target (#1492): the counter's nanojoules a run, or BLOCKED naming it when a run reads zero. */
function energyReading(runs) {
  const counter = runs.find((r) => r.energy?.counter)?.energy.counter ?? 'ri_energy_nj';
  const nj = runs.map((r) => r.energy?.nj);
  if (nj.length === 0 || nj.some((v) => !(Number.isFinite(v) && v > 0))) {
    return { status: 'BLOCKED', counter, reason: `the counter ${counter} read ${JSON.stringify(nj)} nJ over the runs; a reading of zero is not energy` };
  }
  return { status: 'READING', counter, runs: nj };
}

// #417's looks (tests/acceptance/417/README.md, "AC5's reports"): a release `deep-gpu`'s `film2d` plays a 2D film
// in the app's headless window in a look's light theme, one warm-up run and five, each run a fresh process.
// `look-frames` plays each shipped look's fixture film, 30 warm frames then 300 timed, each frame's GPU and CPU
// ms; `look-switch` plays the fixture film and switches between every ordered pair of shipped looks, each switch
// timed from its request to the new look's first frame read back from the window, with that frame's pixel (4, 4).
// `--planted stops_at_request` passes deep-gpu's wrong clock, stopped at the request.
const LOOKS_417 = join('tests', 'acceptance', '417', 'fixtures');
/** Every shipped look's fixture, `{id, fixture, doc}`: the fixtures and the shipped looks are the same set (#417). */
function lookFilms() {
  return readdirSync(join(root, LOOKS_417, 'looks')).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const fixture = `${LOOKS_417}/looks/${f}`;
    const { look, film } = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
    return { id: look, fixture, doc: JSON.parse(readFileSync(join(root, LOOKS_417, film), 'utf8')) };
  });
}
/** One fresh release `deep-gpu run` over `calls`: its replies, each a film2d answer. */
function films(calls) {
  const [answer] = run('deep-gpu', ['run', ...(planted() ? ['--planted', planted()] : [])].join(' '), [JSON.stringify({ out: tmpdir(), calls })], 'release');
  const replies = answer.replies ?? [];
  if (answer.ok !== true || replies.length !== calls.length || replies.some((r) => !Array.isArray(r.frames))) throw Error(`deep-gpu film2d answered ${JSON.stringify(answer).slice(0, 1500)}`);
  return replies;
}

workloads['look-frames'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const looks = lookFilms();
  const measured = runs(() => {
    const replies = films(looks.map(({ id, doc }) => ({ call: 'film2d', doc, look: id, frames: WARM_UP + WARM_FRAMES })));
    return { looks: Object.fromEntries(looks.map(({ id, fixture }, i) => [id, {
      fixture, frames: replies[i].frames.slice(WARM_UP).map(({ gpu_ms, cpu_ms }) => ({ gpu_ms, cpu_ms })),
    }])) };
  });
  console.log(JSON.stringify({ task: 'canvas-look-frames', fingerprint, runs: measured }));
};

// #149's drawn looks (tests/acceptance/149/README.md, "AC10's reports"): a release `deep-gpu` plays each family's
// fixture at 1080p, in 2D through `film2d` and in 3D through `view3d`, 30 warm frames then 300 timed, one warm-up run
// and five, each run a fresh process. `paper-cost` plays the paper family's 2D film with its paper and on a flat ground.
const DRAWN_149 = join('tests', 'acceptance', '149', 'fixtures');
const DRAWN_SIZE = [1920, 1080];
/** Each family fixture, with its look over the suite's base look. */
function drawnFamilies() {
  const base = JSON.parse(readFileSync(join(root, DRAWN_149, 'look.json'), 'utf8'));
  return readdirSync(join(root, DRAWN_149, 'families')).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const fixture = `tests/acceptance/149/fixtures/families/${f}`;
    const family = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
    return { name: f.replace('.json', ''), fixture, family, look: { ...base, ...family.look } };
  });
}

workloads['drawn-frames'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const families = drawnFamilies();
  const dir = mkdtempSync(join(tmpdir(), 'deep-drawn-'));
  try {
    const paths = families.map(({ name, family }) => {
      const path = join(dir, `${name}-3d.json`);
      writeFileSync(path, JSON.stringify(family['3d']));
      return path;
    });
    const frames = WARM_UP + WARM_FRAMES;
    const timed = (reply) => reply.frames.slice(WARM_UP).map(({ gpu_ms, cpu_ms }) => ({ gpu_ms, cpu_ms }));
    const measured = runs(() => {
      const flat = films(families.map(({ family, look }) => ({ call: 'film2d', doc: family['2d'], look, fps: 30, frames })));
      const deep = films(families.map(({ look }, i) => ({ call: 'view3d', doc: paths[i], look, size: DRAWN_SIZE, fps: 30, frames, timings: true })));
      return { families: Object.fromEntries(families.map(({ name, fixture }, i) => [name, {
        '2d': { fixture, size: DRAWN_SIZE, frames: timed(flat[i]) },
        '3d': { fixture, size: DRAWN_SIZE, frames: timed(deep[i]) },
      }])) };
    });
    console.log(JSON.stringify({ task: 'canvas-drawn-frames', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

workloads['paper-cost'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const { family, look, fixture } = drawnFamilies().find((f) => f.name === 'paper');
  const flatLook = { ...look, ground: { kind: 'flat' } };
  const doc = family['2d'];
  const measured = runs(() => {
    const frames = WARM_UP + WARM_FRAMES;
    const [paper, flat, paperHash, flatHash] = films([
      { call: 'film2d', doc, look, fps: 30, frames },
      { call: 'film2d', doc, look: flatLook, fps: 30, frames },
      { call: 'film2d', doc, look, fps: 30, frames: 1, hash: true },
      { call: 'film2d', doc, look: flatLook, fps: 30, frames: 1, hash: true },
    ]);
    const timed = (reply) => ({ frames: reply.frames.slice(WARM_UP).map(({ gpu_ms, cpu_ms }) => ({ gpu_ms, cpu_ms })) });
    return { fixture, paper: timed(paper), flat: timed(flat), paper_hash: paperHash.frames[0].pixel_hash, flat_hash: flatHash.frames[0].pixel_hash };
  });
  console.log(JSON.stringify({ task: 'canvas-paper-cost', fingerprint, runs: measured }));
};

/** A walk through every ordered pair of distinct `ids` once, starting and ending at the first (Hierholzer). */
function everyPair(ids) {
  const used = new Set();
  const walk = [];
  const visit = (from) => {
    for (const to of ids) if (to !== from && !used.has(`${from}>${to}`)) { used.add(`${from}>${to}`); visit(to); }
    walk.push(from);
  };
  visit(ids[0]);
  return walk.reverse();
}
const SWITCH_EVERY = 10;
workloads['look-switch'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixture = `${LOOKS_417}/film.json`;
  const doc = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
  const walk = everyPair(lookFilms().map((l) => l.id));
  const events = walk.slice(1).map((look, i) => ({ frame: SWITCH_EVERY * (i + 1), look }));
  const measured = runs(() => {
    const [reply] = films([{ call: 'film2d', doc, look: walk[0], frames: SWITCH_EVERY * walk.length, events }]);
    if (reply.switches?.length !== events.length) throw Error(`film2d timed ${reply.switches?.length} of ${events.length} switches`);
    return { samples: reply.switches.map(({ ms, ground }, i) => ({ from: walk[i], to: walk[i + 1], ms, ground })) };
  });
  console.log(JSON.stringify({ task: 'canvas-look-switch', fixture, fingerprint, runs: measured }));
};

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

// #1637: occlusion from this frame's depth, at 1920 × 1080 on a release `deep-gpu`. The city of
// tests/acceptance/1637/helpers.ts (20,000 building items on a 200 × 100 grid of 32 m blocks, 100,000 street items in
// one instancer, the same seeds), walked 1.7 m above the street for 10 s at 30 frames a second, drawn twice a run, the
// shipped occlusion cull and `occlusion: off` (frustum only), their order alternating; one warm-up run and five, each a
// fresh process. A run reports p95 GPU time shipped ÷ frustum-only, and the depth pyramid's declared cost against its
// measured time, both medians over the shipped frames.
function occlusionCity() {
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; }; };
  const PITCH = 32, x0 = 40 * PITCH + 16, z = 50 * PITCH + 1, cutX = x0, cutZ = 60 * PITCH + 1;
  const clear = [[x0 - 10, x0 + 60, 50 * PITCH - 6, 50 * PITCH + 6], [cutX - 10, cutX + 60, 60 * PITCH - 6, 60 * PITCH + 6]];
  const r = rng(1637); const u = () => r() / 4294967296; const round = (v) => Math.round(v * 1000) / 1000;
  const rows = [];
  while (rows.length < 100_000) {
    const alongX = u() < 0.5;
    const line = alongX ? Math.floor(u() * 101) * PITCH : Math.floor(u() * 201) * PITCH;
    const along = alongX ? u() * 200 * PITCH : u() * 100 * PITCH;
    const off = (u() < 0.5 ? -1 : 1) * (3.5 + 2 * u());
    const k = u();
    const proto = k < 0.35 ? 0 : k < 0.6 ? 1 : k < 0.8 ? 2 : 3;
    const x = round(alongX ? along : line + off); const zz = round(alongX ? line + off : along);
    const sc = round(0.9 + 0.2 * u());
    if (clear.some(([a, b, c, d]) => x >= a && x <= b && zz >= c && zz <= d)) continue;
    rows.push({ proto, pos: [x, proto === 2 ? round(0.225 * sc) : 0, zz], yaw: alongX ? 0 : 90, scale: sc });
  }
  rows[31_416] = { proto: 3, pos: [x0 + 6, 0, z + 1.2], yaw: 0, scale: 1 };
  rows[31_415] = { proto: 2, pos: [x0 + 10, 0.225, z + 2], yaw: 90, scale: 1 };
  rows[77_777] = { proto: 0, pos: [cutX + 25, 0, cutZ + 3.5], yaw: 0, scale: 1 };
  const box = (size, pos, material, extra = {}) => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...extra });
  const mat = (params) => ({ kind: 'material@1', params });
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [x0, 1.7, z], target: [x0 + 100, 1.7, z], fov: 60, near: 0.1, far: 3000 } },
    sky: { kind: 'sky@1', params: { top: [0.35, 0.5, 0.75, 1], low: [0.75, 0.82, 0.9, 1], ambient_top: [0.25, 0.3, 0.35], ambient_low: [0.1, 0.1, 0.1] } },
    key: { kind: 'light.sun@1', at: { rot: [-20, 90, 0] }, params: { illuminance: Math.PI, color: [1, 1, 1], shadow: false } },
    ground_mat: mat({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.95 }),
    wall0: mat({ base_color: [0.62, 0.55, 0.48, 1], roughness: 0.9 }), wall1: mat({ base_color: [0.5, 0.52, 0.56, 1], roughness: 0.9 }), wall2: mat({ base_color: [0.7, 0.66, 0.6, 1], roughness: 0.9 }),
    lamp_mat: mat({ base_color: [0.2, 0.2, 0.22, 1], metallic: 1, roughness: 0.4 }), tree_mat: mat({ base_color: [0.12, 0.35, 0.12, 1], roughness: 0.85 }),
    bench_mat: mat({ base_color: [0.45, 0.3, 0.15, 1], roughness: 0.8 }), bin_mat: mat({ base_color: [0.1, 0.25, 0.15, 1], roughness: 0.6 }),
    kiosk_mat: mat({ base_color: [0.6, 0.15, 0.1, 1], roughness: 0.7 }), statue_mat: mat({ base_color: [0.8, 0.8, 0.78, 1], roughness: 0.5 }),
    ground: box([6420, 1, 3220], [3200, -0.5, 1600], 'ground_mat'),
    lamp: { kind: 'lathe@1', params: { outline: [[0.08, 0, false], [0.08, 3.8, false], [0.35, 3.9, true], [0.3, 4.1, true], [0.05, 4.2, false]], segments: 48 }, material: 'lamp_mat', visible: false },
    tree: { kind: 'lathe@1', params: { outline: [[0.15, 0, false], [0.15, 2, false], [1.2, 2.5, true], [1.5, 3.5, true], [1, 4.8, true], [0.05, 5.5, false]], segments: 64 }, material: 'tree_mat', visible: false },
    bench: box([1.8, 0.45, 0.5], [0, 0, 0], 'bench_mat', { visible: false }),
    bin: { kind: 'lathe@1', params: { outline: [[0.22, 0, false], [0.25, 0.95, false], [0.27, 1, false], [0.05, 1.02, false]], segments: 32 }, material: 'bin_mat', visible: false },
    street: { kind: 'instance@1', params: { of: ['lamp', 'tree', 'bench', 'bin'], ids: rows.map((_, i) => i), proto: rows.map((x) => x.proto), pos: rows.map((x) => x.pos), yaw: rows.map((x) => x.yaw), scale: rows.map((x) => x.scale) } },
    kiosk: box([0.5, 2.5, 1.6], [x0 + 8, 1.25, z - 3], 'kiosk_mat'),
    probe: { kind: 'light.probe@1', params: { type: 'reflection', size: [4, 3, 4] }, at: { pos: [x0 + 12, 1.5, z - 1] } },
    statue: box([0.6, 2.4, 0.6], [x0 + 12, 1.2, z - 4.5], 'statue_mat'),
  };
  const b = rng(1638);
  for (let j = 0; j < 100; j++) for (let i = 0; i < 200; i++) {
    const h = Math.round(100 + 200 * (b() / 4294967296)) / 10; const k = j * 200 + i;
    items[`b${String(k).padStart(5, '0')}`] = box([20, h, 20], [i * PITCH + 16, h / 2, j * PITCH + 16], `wall${k % 3}`);
  }
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${String(order++).padStart(6, '0')}`, layer: 'main' });
  const at = (axis, x) => ({ target: `items/cam/params/${axis}/0`, type: 'f32', keys: { k0: { t: '0s', value: x, interp: 'linear' }, k1: { t: '10s', value: x + 14, interp: 'linear' } } });
  return { format: 1, id: 'city-1637-bench', profile: 'scene', title: 'city-1637-bench', description: 'The #1637 city walk.', size: FLARE_SIZE, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:bench', title: 'main', order: 'a0' } }, items, channels: { cam_x: at('position', x0), aim_x: at('target', x0 + 100) } };
}
workloads.occlusion = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look = { id: 'look-1637-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1637 bench look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' }, roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} }, fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false }, mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto' };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = join(dir, 'city.json');
    writeFileSync(doc, JSON.stringify(occlusionCity()));
    const side = (off) => ({ call: 'view3d', doc, look, size: FLARE_SIZE, frames: 301, fps: 30, capture: [], timings: true, ...(off ? { occlusion: 'off' } : {}) });
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)];
    let k = 0;
    const measured = runs(() => {
      const offFirst = k++ % 2 === 1;
      const answer = once('deep-gpu', ['run'], { out: dir, calls: offFirst ? [side(true), side(false)] : [side(false), side(true)] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const [on, off] = offFirst ? [answer.replies[1], answer.replies[0]] : [answer.replies[0], answer.replies[1]];
      const measuredMs = median(on.frames.map((f) => f.passes_ms['scene3d.depth_pyramid']));
      const declaredMs = median(on.frames.map((f) => f.declared_ms['scene3d.depth_pyramid']));
      return { shipped_p95_ms: p95(on.frames.map((f) => f.gpu_ms)), frustum_p95_ms: p95(off.frames.map((f) => f.gpu_ms)),
        gpu_fall: p95(on.frames.map((f) => f.gpu_ms)) / p95(off.frames.map((f) => f.gpu_ms)),
        pyramid_measured_ms: measuredMs, pyramid_declared_ms: declaredMs, pyramid_declared_error: Math.abs(declaredMs - measuredMs) / measuredMs };
    });
    console.log(JSON.stringify({ task: 'canvas-occlusion', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #501: 32 looping voices, each a 2 s stereo tone at 0.02 at its own pitch, played live through the device gate on the
// default output for 5 s of the real clock by `deep-show run`'s soak; fails unless it played, and prints its stats.
workloads['media-soak'] = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const wav = (hz) => {
      const frames = 96_000, b = Buffer.alloc(44 + frames * 4);
      b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + frames * 4, 4); b.write('WAVEfmt ', 8, 'ascii'); b.writeUInt32LE(16, 16);
      b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(48_000, 24); b.writeUInt32LE(192_000, 28); b.writeUInt16LE(4, 32);
      b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(frames * 4, 40);
      for (let i = 0; i < frames; i++) for (const [c, f] of [[0, hz], [1, hz + 10]]) b.writeInt16LE(Math.round(0.02 * 32767 * Math.sin((2 * Math.PI * f * i) / 48_000)), 44 + 4 * i + 2 * c);
      const sha = createHash('sha256').update(b).digest('hex');
      mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
      writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), b);
      return sha;
    };
    const strips = Object.fromEntries(Array.from({ length: 32 }, (_, v) => [`v${v}`, { track: v + 1, src: { asset: wav(220 + 17 * v) }, start: 0, in: 0, out: 2 * SEC, loop: true, span: 5 * SEC }]));
    const media = { transport: { sample_rate: 48_000, span: 5 * SEC }, strips };
    const [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, calls: [{ call: 'soak', media, seconds: 5 }] })]);
    const reply = answer.replies?.[0];
    if (reply?.outcome !== 'played') throw Error(`the soak didn't play: ${JSON.stringify(answer).slice(0, 2000)}`);
    console.log(JSON.stringify({ task: 'media-soak', stats: reply.stats }));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
};

// #157: a 10 s 1920 × 1080 film at 60 fps (a ground and a bar moving a pixel a frame, a stereo tone) exported as H.264
// with AAC by `deep-show run`; fails unless it was delivered, and prints the receipt's fidelity decode and colour probe
// times.
workloads['export-fidelity'] = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const sr = 48_000, frames = 600, frame = SEC / 60;
    const b = Buffer.alloc(44 + 10 * sr * 8);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + 10 * sr * 8, 4); b.write('WAVEfmt ', 8, 'ascii'); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 8, 28); b.writeUInt16LE(8, 32);
    b.writeUInt16LE(32, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(10 * sr * 8, 40);
    for (let i = 0; i < 10 * sr; i++) for (const c of [0, 1]) b.writeFloatLE(0.2 * Math.sin((2 * Math.PI * (440 + 220 * c) * i) / sr), 44 + 8 * i + 4 * c);
    const sha = createHash('sha256').update(b).digest('hex');
    mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), b);
    const rect = (id, box, role, order) => ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role } } } });
    const document = {
      format: 1, id: 'bench-157', profile: 'film', title: 'Export fidelity bench', description: 'A bar crossing a 1080p60 frame.', size: [1920, 1080], camera: 'cam',
      transport: { span: frames * frame, frame_rate: [60, 1], sample_rate: sr },
      items: {
        cam: { id: 'cam', kind: 'camera@1', name: 'cam', order: 'a0', params: { projection: 'orthographic', target: [960, 540, 0], view_width: 1920 } },
        back: rect('back', [0, 0, 1920, 1080], 'muted', 'a1'), bar: rect('bar', [100, 0, 48, 1080], 'accent', 'a2'),
      },
      channels: { bar: { target: 'items/bar/params/box/0', type: 'f32', keys: { k0: { t: 0, value: 100, interp: 'linear' }, k1: { t: frames * frame, value: 100 + frames, interp: 'linear' } } } },
      assets: { sound: { sha256: sha, license: { id: 'CC0-1.0', shareable: true, credit: 'Bench tone.' } } },
      strips: { sound: { track: 1, src: sha, start: 0, in: 0, out: 10 * SEC, rate: 1 } },
    };
    const out = join(evidence, 'film.mp4');
    const peer = { pid: 3002, start: 3_000 };
    const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
    const calls = [{ call: 'deep show', peer, doc: DOC, document }, { call: 'export', doc: DOC, out, video: { codec: 'h264' }, audio: { codec: 'aac' } }];
    const sc = { evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
    const [answer] = run('deep-show', 'run', [JSON.stringify(sc)]);
    const reply = answer.replies?.[1];
    if (reply?.outcome !== 'exported') throw Error(`the export wasn't delivered: ${JSON.stringify(answer).slice(0, 2000)}`);
    console.log(JSON.stringify({ task: 'export-fidelity', decode_seconds: reply.receipt.fidelity?.decode_seconds, probe_seconds: reply.receipt.color_probe?.seconds }));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
};

// #538's budgets: live game state's compares, remaps, uploads and fit check (benchmarks/game-state.mjs).
workloads['game-state'] = async () => (await import('./game-state.mjs')).gameState({ root, release, once, runs });

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
await workloads[task]();
