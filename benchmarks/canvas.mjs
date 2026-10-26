// One canvas workload per run, for the perf lane's budgets (issues #96, #305 and #379): node benchmarks/canvas.mjs <task>.
// Each drives a built binary over JSON lines, as the acceptance tests do: `deep-show run` for patches and the seal,
// `deep-canvas merge` for a merge.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function run(binary, subcommand, lines) {
  const out = spawnSync(join(root, 'target', 'debug', binary), [subcommand], { input: `${lines.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
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

// The cost model's micro-benchmark (issue #379): every operator the shipped build seals, timed by `deep-show`'s
// `costs` call over generated boards, and scene3d's two passes timed by their timestamps on the device through
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
    [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, calls: [{ call: 'costs' }] })]);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
  const measured = answer.replies?.[0];
  if (!measured?.terms) throw Error(`deep-show costs answered ${JSON.stringify(answer).slice(0, 1500)}`);
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
  const report = { fingerprint: machine, terms, declared: declared.terms, declaredFingerprint: declared.fingerprint };
  if (write) {
    if (!['Mac15,7', 'Mac15,12'].includes(machine.model)) throw Error(`coefficients come from a reference Mac; this is ${machine.model}`);
    const { model, chip, memoryBytes, macosBuild } = machine;
    writeFileSync(COSTS, `${JSON.stringify({ fingerprint: { model, chip, memoryBytes, macosBuild }, terms }, null, 2)}\n`);
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

workloads.judge = () => {
  const { current, base } = JSON.parse(readFileSync(0, 'utf8'));
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

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
workloads[task]();
