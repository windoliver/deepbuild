// One canvas workload per run, for the perf lane's budgets (issues #96, #305, #379, #383, #417 and #854): node
// benchmarks/canvas.mjs <task>. Each drives a built binary over JSON lines, as the acceptance tests do: `deep-show run`
// for patches and the seal, `deep-canvas merge` for a merge, `deep-gpu run` for the deepest level of a 3D city.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fingerprint, judgeLimit, references } from '../scripts/benchmark.mjs';
import { BOARD_ITEMS, CLASS_LIMITS, COUNTS, DIRTY_BOARDS, EFFICIENCY, energyReading, FLOORS, judgeDrawFinish, judgeFloor, loadsOf, named, p95, RUNS, shownWindow, unjudged } from './canvas-judge.mjs';
import { FLARE_SIZE, flaresMirrors, fogLinear, lensFocus, localToneMap, water, waterFlow, waterShore } from './stages.mjs';
import { manyLamps, occlusion } from './cities.mjs';
import { groundCamera, groundDoc, groundMaterial, groundStages, groundSun } from './ground.mjs';

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
  // #1857: a board of 5,000 items, one of them an instance whose step repeats a nested recipe 1,024 times, checked
  // whole once: 4,999 rects and the sheet of tests/acceptance/1857's rows pack, which expands to 2,048 derived items.
  'nested-check'() {
    const items = {};
    for (let i = 0; i < 4_999; i++) items[`r${i}`] = { id: `r${i}`, kind: 'rect@1', name: `r${i}`, order: `b${String(i).padStart(5, '0')}`, params: { box: [0, 0, 8, 8], paint: { fill: { role: 'muted' } } } };
    items.g1 = { id: 'g1', kind: 'rows.sheet@1', name: 'g1', order: 'a0', params: {}, at: { pos: [40, 40, 0] } };
    const document = { format: 1, profile: 'board', title: 'Sheet', description: 'A sheet among 4,999 rects.', size: [640, 360], packs: ['test/rows@1.0.0'], items };
    const sessions = { 'sess-alpha': { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1000 } } };
    const packs = [{ id: 'test/rows', dir: join(root, 'tests/acceptance/1857/fixtures/packs/test-rows-1.0.0') }];
    const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
    let answer;
    try {
      [answer] = run('deep-show', 'run', [JSON.stringify({ evidence, sessions, panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main' } }, packs, calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document, include: ['issues'] }] })]);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
    const derived = Object.keys(answer.replies?.[0]?.expansions?.find((e) => e.instance === 'g1')?.derived ?? {}).length;
    if (derived !== 2_048) throw Error(`g1 expanded to ${derived} derived items, not 2,048: ${JSON.stringify(answer).slice(0, 600)}`);
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
  // #1430: the hits and misses of the text's run and shape caches over the bench.
  const report = { fingerprint: machine, build: measured.build, terms, caches: measured.caches, declared: declared.terms, declaredFingerprint: declared.fingerprint };
  if (write) {
    if (!references.some((reference) => reference.model === machine.model)) throw Error(`coefficients come from a reference Mac; this is ${machine.model}`);
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
const WARM_UP = 30;
const WARM_FRAMES = 300;
const planted = () => {
  const i = process.argv.indexOf('--planted');
  return i < 0 ? null : process.argv[i + 1];
};

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
    // The five warm runs share one deep-gpu process, so each carries the one-minute load at that process's start and end (#2870).
    const loadStart = loadavg()[0];
    const runs = liveCalls(dir, Array.from({ length: 5 }, () => ({ docs: [doc], frames: WARM_UP + WARM_FRAMES })));
    const loadEnd = loadavg()[0];
    // #140: the seams' backends that drew the frames, as the live view names them.
    report.backends = runs[0]?.backends;
    report.warm = {
      limits: CLASS_LIMITS[cls],
      runs: runs.map((r) => {
        const frames = r.frames.slice(WARM_UP);
        return { frames: frames.length, gpu_p95_ms: p95(frames.map((f) => f.gpu_ms)), cpu_p95_ms: p95(frames.map((f) => f.cpu_ms)), loadStart, loadEnd };
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
  const warmRuns = current.warm?.runs ?? [];
  for (const key of ['gpu', 'cpu']) {
    const limit = limits[`${key}_ms`];
    warm[key] = limit === null ? { status: 'PASS', reason: `the ${cls} class has no frame cap` }
      : judgeLimit({ limit, runs: warmRuns.map((r) => r[`${key}_p95_ms`]), fingerprint: current.fingerprint, loads: loadsOf(warmRuns) });
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
// Each run carries the one-minute load at its start and end, as measureOnce names them: judgeLimit's loads (#1830).
const runs = (once) => {
  once(true);
  return Array.from({ length: RUNS }, () => {
    const loadStart = loadavg()[0];
    return { ...once(false), loadStart, loadEnd: loadavg()[0] };
  });
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

// #465's and #468's budgets: the finishes', the flare's, the mirror's and depth of field's GPU cost (benchmarks/stages.mjs).
workloads['flares-mirrors'] = () => flaresMirrors({ root, release, once, runs });
workloads['lens-focus'] = () => lensFocus({ root, release, once, runs });

// #508: a figure's budgets at 1080p on a release `deep-gpu`, the documents tests/acceptance/508/ac4-budgets.test.ts
// draws: the turbofan fixture at 120 fps with its throttle moved to the top at 1 s, the redrawn frame's `wall_ms`
// (frame 120 must differ from the untouched run's and frame 119 must not); 500 boxes in five assemblies taken apart
// while the camera orbits, the worst `wall_ms` of frames 1 to 599 at 120 fps; and a projected inset over the left half
// of a floor, lit and unlit, less the floor alone, the difference of the median `gpu_ms` over 120 frames. One warm-up
// run and five, each a fresh process.
const HD = [1920, 1080];
const SKY = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
const asSession = (doc) => {
  const d = structuredClone(doc);
  d.layers = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
  for (const item of Object.values(d.items)) item.layer = 'main';
  return d;
};
function partsDoc() {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 1, 0], orbit: { azimuth: 0, elevation: 20, distance: 14 }, fov: 40, near: 0.05, far: 200 } },
    sky: SKY,
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-45, 30, 0] } },
    metal: { kind: 'material@1', params: { base_color: [0.6, 0.6, 0.65, 1], roughness: 0.5 } },
  };
  const assemblies = {};
  for (let a = 0; a < 5; a++) assemblies[`a${a}`] = { parent: a === 0 ? null : 'a0', at: { pos: [0, 0, 0] }, apart: a === 0 ? [0, 0, 0] : [0, 0.6 * a, 0], order: a, value: 0 };
  for (let k = 0; k < 500; k++) {
    const a = Math.floor(k / 100), i = k % 100;
    items[`p${String(k).padStart(3, '0')}`] = { kind: 'mark.box@1', params: { size: [0.3, 0.12, 0.3] }, at: { pos: [(i % 10) * 0.4 - 1.8, a * 0.2, Math.floor(i / 10) * 0.4 - 1.8] }, material: 'metal', parent: `a${a}` };
  }
  const keys = { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '1s', value: 1, interp: 'hold' }, k2: { t: '3s', value: 0, interp: 'hold' } };
  return asSession({
    format: 1, id: 'parts-500', profile: 'figure', title: 'Five hundred parts', description: 'A 500-part figure taken apart while the camera orbits.',
    size: HD, camera: 'cam', seed: 508, transport: { span: '5s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' },
    assemblies, items,
    channels: {
      spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '5s', value: 180, interp: 'linear' } } },
      take: { target: 'assemblies/apart', type: 'f32', mode: 'follow', follow: { source: { keys }, model: { transition: { span: '1s', interp: 'linear' } } } },
    },
  });
}
function insetDoc(shading) {
  const items = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 20 * Math.sin(Math.PI / 3), 20 * Math.cos(Math.PI / 3)], target: [0, 0, 0], view_width: 19.2, near: 0.05, far: 200 } },
    sky: SKY,
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-50, 30, 0] } },
    ground: { kind: 'material@1', params: { base_color: [0.4, 0.4, 0.4, 1], roughness: 0.9 } },
    floor: { kind: 'mark.box@1', params: { size: [40, 0.1, 40] }, at: { pos: [0, -0.05, 0] }, material: 'ground' },
  };
  if (shading) {
    items.map = {
      kind: 'inset@1', parent: 'floor', at: { pos: [-4.8, 0, 0] },
      params: { size: [9.6, 14], px_per_unit: 20, content: { ground: { kind: 'rect@1', order: 'a0', params: { box: [0, 0, 192, 280], paint: { fill: { role: 'stone' } } } } }, project: { shading } },
    };
  }
  return asSession({
    format: 1, id: `inset-${shading ?? 'none'}`, profile: 'scene', title: 'A projected inset over half a frame', description: 'A floor with a projected inset over the left half of a 1080p frame.',
    size: HD, camera: 'cam', seed: 508, transport: { span: '2s' }, requires: { modules: { scene3d: '^1', marks2d: '^1' } }, budget: { class: 'figure' }, items,
  });
}
workloads['figure-budgets'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'figure-508', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' }, tone_map: 'none', finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const fan = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'figures', 'turbofan', 'figure.json'), 'utf8'));
  const top = fan.controls.throttle.range[1];
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const write = (name, doc) => {
      const path = join(dir, `${name}.json`);
      writeFileSync(path, JSON.stringify(doc));
      return path;
    };
    const fanDoc = write('turbofan', asSession(fan));
    const track = [{ t: SEC, seq: 0, control: 'throttle', value: top, writer: 'you', player: 1 }];
    const view = (doc, fps, frames, more = {}) => ({ call: 'view3d', doc, look, size: HD, fps, frames, timings: true, ...more });
    const calls = [
      view(fanDoc, 120, 181, { track }), view(fanDoc, 120, 181), view(write('parts', partsDoc()), 120, 600),
      ...['lit', 'unlit', null].map((s) => view(write(`inset-${s ?? 'none'}`, insetDoc(s)), 60, 120)),
    ];
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const measured = runs(() => {
      const answer = once('deep-gpu', ['run'], { out: dir, calls });
      const refused = answer.replies?.findIndex((r) => r.code);
      if (answer.ok !== true || refused >= 0) throw Error(`deep-gpu answered ${JSON.stringify(answer.replies?.[refused] ?? answer).slice(0, 1500)}`);
      const [tracked, untracked, parts, lit, unlit, bare] = answer.replies.map((r) => r.frames);
      if (tracked[119].pixel_hash !== untracked[119].pixel_hash) throw Error('the turbofan: frame 119 differs before the throttle moves');
      if (tracked[120].pixel_hash === untracked[120].pixel_hash) throw Error('the turbofan: frame 120 doesn\'t show the throttle moved at 1 s');
      const plain = median(bare.map((f) => f.gpu_ms));
      return {
        redraw_wall_ms: tracked[120].wall_ms,
        parts_wall_ms: Math.max(...parts.slice(1).map((f) => f.wall_ms)),
        inset_lit_gpu_ms: Math.max(0, median(lit.map((f) => f.gpu_ms)) - plain),
        inset_unlit_gpu_ms: Math.max(0, median(unlit.map((f) => f.gpu_ms)) - plain),
      };
    });
    console.log(JSON.stringify({ task: 'canvas-figure-budgets', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #166's, #268's, #968's and #971's budgets: the water, its shore, its flow and the local tone map (benchmarks/stages.mjs).
workloads.water = () => water({ root, release, once, runs });
workloads['water-shore'] = () => waterShore({ root, release, once, runs });
workloads['water-flow'] = () => waterFlow({ root, release, once, runs });
workloads['local-tone-map'] = () => localToneMap({ root, release, once, runs });

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

// #1636's budgets: a 4-level tree of 4 children a fork, 12 sides and 10 rings (about 21,000 triangles) built by geometry
// with timings, and a forest of 10,000 instances of 8 seeded variants, each in bark and leaf, drawn for one frame with
// counts: the most color-pass draws any (variant, material) of the forest takes.
const treeParams = (seed, more = {}) => ({ seed, levels: 4, length: 4, radius: 0.15, split: 3, angle: 40, roll: 30, gravity: 0.3,
  leaves: { per_twig: 6, size: 0.12 }, segments: 8, rings: 8, ...more });
const treeItem = (params, more = {}) => ({ kind: 'tree@1', params, material: 'bark', materials: { leaves: 'leaf' }, ...more });
const treeStages = () => {
  const pos = Array.from({ length: 10_000 }, (_, k) => [4 * (k % 100), 0, 4 * Math.floor(k / 100)]);
  const variants = Array.from({ length: 8 }, (_, k) => `variant-${k + 1}`);
  const materials = { bark: groundMaterial([0.36, 0.25, 0.16], 0.9), leaf: groundMaterial([0.25, 0.5, 0.18], 0.7) };
  return {
    budget: groundDoc('tree-1636', [640, 360], { cam: groundCamera([7, 5, 14], [0, 4, 0]), sun: groundSun, ...materials,
      tree: treeItem(treeParams(2026, { split: 4, segments: 12, rings: 10 })) }),
    forest: groundDoc('forest-1636', [512, 512], { sun: groundSun, ...materials,
      cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [198, 120, 198], target: [198, 0, 198], view_width: 440, near: 1, far: 300 } },
      ...Object.fromEntries(variants.map((v, k) => [v, treeItem(treeParams(k + 1), { visible: false })])),
      forest: { kind: 'instance@1', params: { of: variants, ids: pos.map((_, k) => k), proto: pos.map((_, k) => k % 8), pos, yaw: pos.map((_, k) => (k * 137.5) % 360), scale: pos.map(() => 1) } } }),
  };
};
workloads.tree = () => {
  const fingerprint = release('deep-show', 'deep-show');
  release('deep-gpu-layer', 'deep-gpu');
  const look2d = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const look = { ...look2d, id: 'plain-1636', basis: 'physical', palette: { ...look2d.palette, night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ...look2d.roles, ground: 'night', ink: 'graphite', muted: 'slate' }, tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' } };
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const stages = treeStages();
    const forest = join(dir, 'forest.json');
    writeFileSync(forest, JSON.stringify(stages.forest));
    const measured = runs(() => {
      const answer = once('deep-show', ['run'], { evidence: dir, sessions: GROUND_SESSION, processes: GROUND_PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } },
        docs: { [DOC]: { panel: 'main' } }, calls: [{ call: 'deep_show', session: 's1', doc: DOC, document: stillAsAgent(stages.budget) },
          { call: 'geometry', doc: DOC, items: ['tree'], t: '0s', timings: true }] });
      if (answer.ok !== true || answer.replies[0]?.outcome !== 'presented' || answer.replies[1]?.code) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const row = answer.replies[1].items.find((r) => r.id === 'tree');
      const drawn = once('deep-gpu', ['run'], { out: dir, calls: [{ call: 'view3d', doc: forest, look, size: [512, 512], fps: 30, frames: 1, counts: true }] });
      if (drawn.ok !== true || drawn.replies[0]?.code) throw Error(`deep-gpu answered ${JSON.stringify(drawn).slice(0, 1500)}`);
      const groups = new Map();
      for (const d of drawn.replies[0].frames[0].draws.filter((d) => d.pass === 'color' && d.of === 'forest')) {
        const key = `${d.mesh} in ${d.material}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      return { tree_build_ms: row.build_ms, tree_triangles: row.indices.length / 3, forest_draws_per_variant_material: Math.max(0, ...groups.values()), forest_groups: groups.size };
    });
    console.log(JSON.stringify({ task: 'canvas-tree', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// #1992's cost: the castle's linear fog against its exp fog (benchmarks/stages.mjs).
workloads['fog-linear'] = () => fogLinear({ root, release, once, runs });

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
  const loads = loadsOf(current.runs ?? []);
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
    } else if (FLOORS.has(name)) {
      verdict = judgeFloor({ limit, runs: values, fingerprint: current.fingerprint, loads });
    } else if (task === 'canvas-gpu-draw-finish') {
      verdict = judgeDrawFinish({ limit, runs: values, fingerprint: current.fingerprint, loads });
    } else {
      verdict = judgeLimit({ limit, runs: values, fingerprint: current.fingerprint, loads });
    }
    if (verdict.status === 'FAIL') {
      verdict.reason = [`${name} ${FLOORS.has(name) ? 'under' : 'over'} ${limit}`, ...(named[name]?.(current.runs, limit) ?? [verdict.reason])].join('; ');
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

// #463's art@1 looks (tests/acceptance/463/README.md, "AC2's reports"): a release `deep-gpu` plays the shared test
// scene in each pack look by ID, its pack installed, at 1080p, 30 warm frames then 300 timed, one warm-up run and five,
// each run a fresh process. `art-frames` times every look in 2D (`film2d`) and 3D (`view3d`); `art-regions` times each
// look, the next look of the list, and the scene with a region in that next look whose edge stays in view, with each
// side's pixel hash at frame 30; `art-switch` switches the 2D film between every ordered pair of looks.
const ART_463 = join('tests', 'acceptance', '463', 'fixtures');
const ART_PACK = () => [{ id: 'deepbuild/art', dir: join(root, 'packs', 'art-1.0.0') }];
const ART_SIZE = [1920, 1080];
const artLooks = () => Object.keys(JSON.parse(readFileSync(join(root, 'packs', 'art-1.0.0', 'pack.json'), 'utf8')).looks);
/** A fixture's 2D film and the path of its 3D scene, written into `dir`. */
function artScene(dir, file) {
  const fixture = `${ART_463}/${file}`;
  const scene = JSON.parse(readFileSync(join(root, fixture), 'utf8'));
  const path = join(dir, file.replace('.json', '-3d.json'));
  writeFileSync(path, JSON.stringify(scene['3d']));
  return { fixture, flat: scene['2d'], deep: path };
}
const artFrames = (reply) => reply.frames.slice(WARM_UP).map(({ gpu_ms, cpu_ms }) => ({ gpu_ms, cpu_ms }));
const artCall = (dim, scene, look, extra = {}) => dim === '2d'
  ? { call: 'film2d', doc: scene.flat, look, packs: ART_PACK(), fps: 30, ...extra }
  : { call: 'view3d', doc: scene.deep, look, packs: ART_PACK(), size: ART_SIZE, fps: 30, timings: true, ...extra };
/** `body(dir)` with a scratch folder removed after it. */
function inScratch(body) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-art-'));
  try { return body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

workloads['art-frames'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const looks = artLooks();
  inScratch((dir) => {
    const scene = artScene(dir, 'scene.json');
    const frames = WARM_UP + WARM_FRAMES;
    const measured = runs(() => {
      const flat = films(looks.map((look) => artCall('2d', scene, look, { frames })));
      const deep = films(looks.map((look) => artCall('3d', scene, look, { frames })));
      return { looks: Object.fromEntries(looks.map((look, i) => [look, {
        '2d': { fixture: scene.fixture, size: ART_SIZE, frames: artFrames(flat[i]) },
        '3d': { fixture: scene.fixture, size: ART_SIZE, frames: artFrames(deep[i]) },
      }])) };
    });
    console.log(JSON.stringify({ task: 'canvas-art-frames', fingerprint, runs: measured }));
  });
};

workloads['art-regions'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const looks = artLooks();
  const pairs = looks.map((look, i) => ({ look, region: looks[(i + 1) % looks.length] }));
  inScratch((dir) => {
    const plain = artScene(dir, 'scene.json');
    const edged = artScene(dir, 'scene-region.json');
    const frames = WARM_UP + WARM_FRAMES;
    const sides = (dim, { look, region }) => [
      artCall(dim, plain, look, { frames }),
      artCall(dim, plain, region, { frames }),
      artCall(dim, edged, look, { frames, looks: { outer: look, inner: region } }),
    ];
    const hashAt = (dim, call) => dim === '2d'
      ? { ...call, frames: WARM_UP + 1, hash: true }
      : { ...call, frames: WARM_UP + 1, capture: [WARM_UP], targets: ['final'], timings: false };
    const measured = runs(() => {
      const byDim = Object.fromEntries(['2d', '3d'].map((dim) => {
        const calls = pairs.flatMap((p) => sides(dim, p));
        const timed = films(calls);
        const hashed = films(calls.map((c) => hashAt(dim, c)));
        return [dim, { timed, hashed }];
      }));
      return { pairs: pairs.map((p, k) => ({ ...p, ...Object.fromEntries(['2d', '3d'].map((dim) => {
        const at = (j) => byDim[dim].timed[3 * k + j];
        const hash = (j) => byDim[dim].hashed[3 * k + j].frames[WARM_UP].pixel_hash;
        return [dim, {
          fixture: edged.fixture,
          outer: { frames: artFrames(at(0)) }, inner: { frames: artFrames(at(1)) }, edge: { frames: artFrames(at(2)) },
          hashes: { outer: hash(0), inner: hash(1), edge: hash(2) },
        }];
      })) })) };
    });
    console.log(JSON.stringify({ task: 'canvas-art-regions', fingerprint, runs: measured }));
  });
};

workloads['art-switch'] = () => {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const fixture = `${ART_463}/scene.json`;
  const doc = JSON.parse(readFileSync(join(root, fixture), 'utf8'))['2d'];
  const walk = everyPair(artLooks());
  const events = walk.slice(1).map((look, i) => ({ frame: SWITCH_EVERY * (i + 1), look }));
  const measured = runs(() => {
    const [reply] = films([{ call: 'film2d', doc, look: walk[0], packs: ART_PACK(), frames: SWITCH_EVERY * walk.length, events }]);
    if (reply.switches?.length !== events.length) throw Error(`film2d timed ${reply.switches?.length} of ${events.length} switches`);
    return { samples: reply.switches.map(({ ms, ground }, i) => ({ from: walk[i], to: walk[i + 1], ms, ground })) };
  });
  console.log(JSON.stringify({ task: 'canvas-art-switch', fixture, fingerprint, runs: measured }));
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

// #1637's and #1634's budgets: occlusion on a city walk, and a night city's many lamps (benchmarks/cities.mjs).
workloads.occlusion = () => occlusion({ release, once, runs });
workloads['many-lamps'] = () => manyLamps({ release, once, runs });

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

// #162: the Lottie export of a 200-item title with 2,000 Bézier keys, its fidelity check included;
// prints the receipt's timing.wall (under 1 s, which tests/acceptance/162/budgets.test.ts judges).
workloads['lottie-export'] = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const frame = SEC / 30;
    const items = { cam: { id: 'cam', kind: 'camera@1', name: 'cam', order: 'a0', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } } };
    const channels = {};
    for (let i = 0; i < 200; i++) {
      const id = `r${String(i).padStart(3, '0')}`;
      items[id] = { id, kind: 'rect@1', name: `Rect ${i}`, order: `b${String(i).padStart(3, '0')}`, params: { box: [0, 0, 12, 12], paint: { fill: { role: i % 2 ? 'accent' : 'ink' } } }, at: { pos: [16 * (i % 20), 18 * Math.floor(i / 20), 0] } };
      const keys = {};
      for (let k = 0; k < 10; k++) keys[`k${k}`] = { t: Math.round(k * 0.4 * SEC), value: 16 * (i % 20) + (k % 2 ? 6 : 0), interp: { bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } } };
      channels[`x${i}`] = { target: `items/${id}/at/pos/0`, type: 'f32', keys };
    }
    const document = { format: 1, id: 'bench-162', profile: 'film', title: 'Lottie export bench', description: 'A 200-item title with 2,000 keys.', size: [320, 180], camera: 'cam', transport: { span: 120 * frame, frame_rate: [30, 1] }, items, channels };
    const out = join(evidence, 'title.json');
    const peer = { pid: 3002, start: 3_000 };
    const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
    const calls = [{ call: 'deep show', peer, doc: DOC, document }, { call: 'export', doc: DOC, out, video: { codec: 'lottie' }, lottie: { container: 'json', images: 'embed' } }];
    const sc = { evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
    const [answer] = run('deep-show', 'run', [JSON.stringify(sc)]);
    const reply = answer.replies?.[1];
    if (reply?.outcome !== 'exported') throw Error(`the export wasn't delivered: ${JSON.stringify(reply ?? answer).slice(0, 2000)}`);
    console.log(JSON.stringify({ task: 'lottie-export', wall_seconds: reply.receipt.timing?.wall }));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
};

// #732: the pptx deck of a 20-stage piece with two 3D stages (a display whose screen carries an inset, in view at stages
// 7 and 14), its fidelity check included; prints the receipt's timing.wall (under 5 s, which
// tests/acceptance/732/ac10-budgets.test.ts judges on a reference Mac).
workloads['pptx-export'] = () => {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const step = 0.5;
    const holds = (target, value) => ({ target, type: 'f32', keys: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, { t: `${i * step}s`, value: value(i + 1), interp: 'hold' }])) });
    const item = (id, kind, order, params, extra = {}) => ({ id, kind, name: id, order, params, ...extra });
    const markers = {};
    for (let k = 1; k <= 20; k++) markers[`s${k}`] = { kind: 'stage', name: `Stop ${String.fromCharCode(64 + k)}`, t: `${(k - 1) * step}s`, notes: `Talk through stop ${String.fromCharCode(64 + k)}.` };
    const items = [
      item('cam', 'camera@1', 'a00', { projection: 'perspective', position: [0, 0, 3], target: [0, 0, 0], fov: 40 }),
      item('sky', 'sky@1', 'a01', { top: [0.9, 0.92, 0.95, 1], low: [0.9, 0.92, 0.95, 1], ambient_top: [0.6, 0.6, 0.6], ambient_low: [0.6, 0.6, 0.6] }),
      item('mat', 'material@1', 'a02', { base_color: [0.8, 0.8, 0.8, 1], unlit: true, double_sided: true }),
      item('screen', 'display@1', 'a03', { size: [1.6, 1.0], bezel: 0.04 }, { at: { pos: [0, 20, 0] }, material: 'mat' }),
      item('screen-inset', 'inset@1', 'a04', {
        face: 'screen#screen', size: [1.52, 0.92], px_per_unit: 400, overflow: 'mask',
        content: { ground: { kind: 'rect@1', order: 'a0', params: { box: [0, 0, 608, 368], paint: { fill: { role: 'accent' } } } } },
      }),
      item('card', 'rect@1', 'a05', { box: [0, 760, 360, 200], radius: 24, paint: { fill: { role: 'muted' } } }),
      item('heading', 'text@1', 'a06', { text: 'Field walk', font: 'body', size: 72, weight: 700, box: { w: 900, h: 110 }, autosize: 'none', paint: { fill: { role: 'ink' } } }, { at: { pos: [120, 80, 0] } }),
    ];
    const document = {
      format: 1, id: 'bench-732', profile: 'film', title: 'Twenty stages', description: 'A 20-stage piece with two 3D stages, exported as a deck.', size: [1920, 1080], camera: 'cam',
      requires: { modules: { scene3d: '^1', marks2d: '^1', effects: '^1' } }, transport: { span: '10s', frame_rate: [30, 1] }, markers,
      items: Object.fromEntries(items.map((i) => [i.id, i])),
      channels: { card_x: holds('items/card/at/pos/0', (k) => 80 + 70 * (k - 1)), screen_y: holds('items/screen/at/pos/1', (k) => (k === 7 || k === 14 ? 0 : 20)) },
    };
    const out = join(evidence, 'deck.pptx');
    const peer = { pid: 3002, start: 3_000 };
    const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
    const calls = [{ call: 'deep show', peer, doc: DOC, document }, { call: 'export', doc: DOC, out, range: 'stages', video: { codec: 'pptx' }, pptx: { slide: [1920, 1080] } }];
    const sc = { evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
    const [answer] = run('deep-show', 'run', [JSON.stringify(sc)]);
    const reply = answer.replies?.[1];
    if (reply?.outcome !== 'exported') throw Error(`the export wasn't delivered: ${JSON.stringify(reply ?? answer).slice(0, 2000)}`);
    console.log(JSON.stringify({ task: 'pptx-export', wall_seconds: reply.receipt.timing?.wall }));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
};
// #538's budgets: live game state's compares, remaps, uploads and fit check (benchmarks/game-state.mjs).
workloads['game-state'] = async () => (await import('./game-state.mjs')).gameState({ root, release, once, runs });
// #548's budgets: the logic module's occurrence rows, linear writes, previews and checkpoints of pages
// (benchmarks/logic-budgets.mjs).
workloads['logic-budgets'] = async () => (await import('./logic-budgets.mjs')).logicBudgets({ root, release });
// #226's budgets: the 3D axes against the same marks, and a still view's maps (benchmarks/axes3d.mjs).
workloads.axes3d = async () => (await import('./axes3d.mjs')).axes3d({ root, release, once, runs });
// #224's budget: the helicoid-to-catenoid family's 128 × 128 rebuild as its slider moves (benchmarks/surface.mjs).
workloads.surface = async () => (await import('./surface.mjs')).surface({ release, once, runs });
// #1968's budgets: a long file's tokens mapped to runs, two versions aligned, a seek into a long terminal recording and a
// still code item's steps per frame (benchmarks/code-film.mjs).
workloads['code-film'] = async () => (await import('./code-film.mjs')).codeFilm({ release, once, runs });
// #1430's budgets: a width change and a typed character on a 50 KB text (benchmarks/text-reflow.mjs).
workloads['text-reflow'] = async () => (await import('./text-reflow.mjs')).textReflow({ release, run, runs });
// #233's budgets: a math@1 document against its expansion written by hand, and a frame's own expansions (benchmarks/math.mjs).
workloads.math = async () => (await import('./math.mjs')).math({ root, release, once, runs });
workloads['between-steps'] = async () => (await import('./between-steps.mjs')).betweenSteps({ root, release, once, runs });
// #211's budgets: 8 moves a step, a checkpoint's 50 changed page map entries, and no work for an item without pages
// (benchmarks/world-pages.mjs).
workloads['world-pages'] = async () => (await import('./world-pages.mjs')).worldPages({ root, release, once, runs });
workloads['water-rings'] = async () => (await import('./water-rings.mjs')).waterRings({ root, release, once, runs });
workloads['water-sea'] = async () => (await import('./water-sea.mjs')).waterSea({ root, release, once, runs }); // #3033's budget
workloads['atlas-draw'] = async () => (await import('./atlas-draw.mjs')).atlasDraw({ release, once, runs });
workloads['atlas-slice'] = async () => (await import('./atlas-slice.mjs')).atlasSlice({ release, once, runs });
// #161's budgets: the fx@1 pack's own check, each operator's compile and a still canvas's dispatches (benchmarks/fx-pack.mjs).
workloads['fx-pack'] = async () => (await import('./fx-pack.mjs')).fxPack({ root, release, once, runs });
workloads['pack-checks'] = async () => (await import('./pack-checks.mjs')).packChecks({ root, release });
// #184's budgets: the maze's 40 runs and replays on two replicas with no work added to a piece played without the
// plug-in, and 20 runs of the 2-minute maze on four replicas as a multiple of real time (benchmarks/playtest.mjs).
for (const task of ['playtest-maze', 'playtest-throughput', 'playtest-crawler']) workloads[task] = async () => (await import('./playtest.mjs')).playtest({ root, release, task, planted: planted() });
workloads.catalog = async () => (await import('./catalog.mjs')).catalogBudgets({ root, release, once }); // #194's budgets
workloads['draw-finish'] = async () => (await import('./draw-finish.mjs')).drawFinish({ root, release, runs }); // #3617's budget

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
await workloads[task]();
