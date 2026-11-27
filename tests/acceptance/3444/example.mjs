// A synthetic, well-formed spike in the formats README.md gives (#3444): the record, every run output it cites, the
// split-module patch, the scene and the report. It is the worked example of those formats and what validate.test.mjs
// alters to plant each wrong program. Its numbers are made up: they are no reading of anything, and no test compares a
// real run with them.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, SPIKE } from './validate.mjs';

/** The base commit this suite was written on: a commit every later checkout has in its history. */
export const BASE = '390c3f39067e7520ca7d2405d86578d17fe4f668';
const machine = { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 68719476736, macosBuild: '26B8119' };
const adapter = { backend: 'metal', name: 'Apple M5 Max' };
const SCENE = readFileSync(fileURLToPath(new URL('./fixtures/every-pass.json', import.meta.url)), 'utf8');
/** A patch that applies to any tree without the file it adds. */
export const PATCH = [
  'diff --git a/crates/deep-scene3d-render/src/split_3444.wgsl b/crates/deep-scene3d-render/src/split_3444.wgsl',
  'new file mode 100644', '--- /dev/null', '+++ b/crates/deep-scene3d-render/src/split_3444.wgsl', '@@ -0,0 +1 @@', '+// one module a pipeline', '',
].join('\n');
/** The frames each cold run hashed, the same on both sides. */
export const HASHES = { 0: '5d0c9e1f7a3b28466e1b0f9d2c7a4e85', 30: '91be04a77c1d3f5208aa6b3e4d9c0f17', 59: 'c4472f0de19a8b6353f7e2a10b8d6c9e' };
/** A time of the example's day, `seconds` after its start. */
export const at = (seconds) => new Date(Date.UTC(2026, 10, 25, 3, 0, 0) + seconds * 1000).toISOString();

/** What the joined scene module holds here; each of main's scene pipelines uses two of them. */
export const SCENE_ENTRIES = ['vs_main', 'fs_main', 'vs_shadow', 'fs_shadow', 'fs_sky'];

/** A cold run of the every-pass scene: main's, or the split-module branch's (each scene pipeline's module its own, and faster). */
function cold(side) {
  const split = side === 'split';
  const ns = (...times) => Object.fromEntries(['override_ns', 'source_ns', 'compile_ns'].map((k, i) => [k, Math.round(times[i] * (split ? 0.4 : 1) * 1e6)]));
  const scene = (stage, entry_point, pipeline, uses, times) => ({ stage, entry_point, module: split ? pipeline : 'scene3d', module_entry_points: split ? uses : SCENE_ENTRIES, ...ns(...times) });
  const other = (stage, entry_point, module, entries, times) => ({ stage, entry_point, module, module_entry_points: entries, ...ns(...times) });
  const pipelines = [
    { name: 'scene3d.geometry', stages: [
      scene('vertex', 'vs_main', 'scene3d.geometry', ['vs_main', 'fs_main'], [40.2, 55.1, 120.4]),
      scene('fragment', 'fs_main', 'scene3d.geometry', ['vs_main', 'fs_main'], [41.0, 60.3, 150.2]),
      // Metal's own compile of the pipeline as a whole, which no stage holds.
      { stage: 'pipeline', ...ns(0, 0, 35.0) }] },
    { name: 'scene3d.shadow', stages: [
      scene('vertex', 'vs_shadow', 'scene3d.shadow', ['vs_shadow', 'fs_shadow'], [39.8, 20.4, 60.1]),
      scene('fragment', 'fs_shadow', 'scene3d.shadow', ['vs_shadow', 'fs_shadow'], [40.1, 8.2, 22.7])] },
    // No stage of the scene module: its module may hold an entry point the pipeline doesn't use, on both sides.
    { name: 'scene3d.cull', stages: [other('compute', 'cull', 'cull', ['cull', 'clear'], [0.3, 4.1, 30.6])] },
    { name: 'scene3d output', stages: [
      other('vertex', 'vs', 'scene3d output', ['vs', 'fs'], [0.2, 1.1, 9.7]),
      other('fragment', 'fs', 'scene3d output', ['vs', 'fs'], [0.2, 2.3, 14.5])] },
  ];
  // The time around each call: what its stages took and a twentieth more.
  for (const p of pipelines) p.around_ns = Math.round(1.05 * p.stages.reduce((sum, s) => sum + s.override_ns + s.source_ns + s.compile_ns, 0));
  return {
    commit: BASE, patch: split ? sha256(PATCH) : null, machine, adapter,
    open: 'fresh', first_settled_ms: split ? 1046.1 : 1500, pipelines_made: pipelines.length, pipelines,
    frames: Object.entries(HASHES).map(([frame, pixel_hash]) => ({ frame: Number(frame), pixel_hash })),
  };
}

/** The geometry pass's encode time and GPU time in each round's run, in ms, with the flag on and off. */
export const ENCODE = { on: [0.50, 0.52, 0.51, 0.49, 0.50], off: [0.49, 0.51, 0.50, 0.48, 0.49] };
export const GPU = { on: [3.10, 3.12, 3.08, 3.11, 3.09], off: [3.00, 3.02, 2.99, 3.01, 3.00] };
/** One run of the forest: round `i` (from 0), with the flag on or off; the side that runs first swaps each round. */
function forest(i, side) {
  const first = (i % 2 === 0) === (side === 'on');
  const start = 1000 + 120 * i + (first ? 0 : 60);
  return {
    commit: BASE, started: at(start), ended: at(start + 50), machine, adapter, instance_flags: side === 'on' ? 32 : 0,
    forest: { instances: 100000, indirect_draws: 6 }, geometry: { encode_ms: ENCODE[side][i], gpu_ms: GPU[side][i] },
  };
}

/** A device's own counters, as wgpu's `HalCounters` names them (more of its fields may be kept). */
export const hal = (query_sets, buffers = 212) => ({ buffers, textures: 96, bind_groups: 140, render_pipelines: 44, query_sets });
function state(name, start, counts, extra) {
  return {
    commit: BASE, started: at(start), ended: at(start + 40), machine, adapter, state: name, device: { label: 'deep-gpu' }, ...extra,
    reads: counts.map((n, k) => ({ at: at(start + 10 + k), hal: hal(n) })),
  };
}
/** 32 sets created on a device of the run's own, then one more, which here loses the device. */
function oneMore() {
  const attempts = Array.from({ length: 32 }, (_, i) => ({ n: i + 1, error: null, lost: false, query_sets: i + 1 }));
  attempts.push({ n: 33, error: 'Unexpected', lost: true, query_sets: 32 });
  return { commit: BASE, machine, adapter, device: { label: 'spike-3444 one more' }, attempts, outcome: 'lost' };
}

const perPipeline = (out) => out.pipelines.map((p) => ({ name: p.name, ms: ['override_ns', 'source_ns', 'compile_ns'].map((k) => p.stages.reduce((sum, s) => sum + s[k], 0) / 1e6) }));
const median = (five) => [...five].sort((a, b) => a - b)[2];

/** The report, written from the runs: the pipeline table with both columns, the split's pixel hashes, the threshold table. */
function reportOf(outs) {
  const [main, split] = ['out/cold-main.json', 'out/cold-split.json'].map((f) => perPipeline(outs[f]));
  const cell = (x) => x.toFixed(1);
  const total = (rows) => [0, 1, 2].map((k) => cell(rows.reduce((sum, r) => sum + r.ms[k], 0)));
  const translation = main.reduce((sum, r) => sum + r.ms[0] + r.ms[1] + r.ms[2], 0);
  const validation = (clock) => median(clock.on.map((on, i) => on - clock.off[i]));
  return [
    '# #3444: what the GPU backend adds that nothing of ours declares (a made-up example)', '',
    '| Pipeline | main override ms | main source ms | main compile ms | split override ms | split source ms | split compile ms |',
    '|---|---|---|---|---|---|---|',
    ...main.map((r, i) => `| \`${r.name}\` | ${r.ms.map(cell).join(' | ')} | ${split[i].ms.map(cell).join(' | ')} |`),
    `| **sum** | ${total(main).join(' | ')} | ${total(split).join(' | ')} |`, '',
    `The split-module branch's pixel hashes, the same as main's: ${Object.entries(HASHES).map(([frame, hash]) => `frame ${frame} \`${hash}\``).join(', ')}.`, '',
    '| Threshold | Reading | Of | More than | Task |',
    '|---|---|---|---|---|',
    `| translation | ${translation.toFixed(1)} ms | 1,500.0 ms | yes | #3501 |`,
    `| validation encode | ${validation(ENCODE).toFixed(3)} ms | ${median(ENCODE.on).toFixed(3)} ms | no | |`,
    `| validation gpu | ${validation(GPU).toFixed(3)} ms | ${median(GPU.on).toFixed(3)} ms | no | |`,
    '| query sets | 9 | 16 | no | |', '',
  ].join('\n');
}

/** The well-formed spike: the record, and every file of docs/spikes/3444/ as text by its path there. */
export function good() {
  const outs = {
    'out/cold-main.json': cold('main'), 'out/cold-split.json': cold('split'),
    ...Object.fromEntries([0, 1, 2, 3, 4].flatMap((i) => ['on', 'off'].map((side) => [`out/indirect-${i + 1}-${side}.json`, forest(i, side)]))),
    'out/state-one-window.json': state('one_window', 2000, [3], { windows: 1 }),
    'out/state-four-windows.json': state('four_windows', 2100, [9, 8], { windows: 4, views_3d: 4 }),
    'out/state-export.json': state('export', 2200, [5]),
    'out/one-more.json': oneMore(),
  };
  const files = { ...Object.fromEntries(Object.entries(outs).map(([path, out]) => [path, JSON.stringify(out)])), 'split-module.patch': PATCH, 'every-pass.json': SCENE, 'README.md': reportOf(outs) };
  const ref = (out) => ({ command: `node docs/spikes/3444/run.mjs --out ${out}`, out, sha256: sha256(files[out]) });
  const record = {
    main: BASE,
    pipelines: {
      scene: { path: `${SPIKE}/every-pass.json`, sha256: sha256(SCENE) },
      main: ref('out/cold-main.json'),
      split: { ...ref('out/cold-split.json'), patch: { path: 'split-module.patch', sha256: sha256(PATCH) } },
    },
    indirect: { rounds: [1, 2, 3, 4, 5].map((n) => ({ on: ref(`out/indirect-${n}-on.json`), off: ref(`out/indirect-${n}-off.json`) })) },
    query_sets: {
      states: { one_window: ref('out/state-one-window.json'), four_windows: ref('out/state-four-windows.json'), export: ref('out/state-export.json') },
      one_more: ref('out/one-more.json'),
    },
    tasks: { translation: { issue: 3501, title: 'Each scene pipeline is made from a module of its own', criteria: ['- [ ] No pipeline of the scene renderer is made from a module that holds an entry point it does not use'] } },
  };
  return { record, files };
}

/**
 * Runs `check(record, dir)` on a copy of the well-formed spike that `alter(record, files)` changed, written under a
 * temporary checkout `dir` (a file set to null is left out), which is removed after.
 */
export function run(check, alter = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3444-'));
  try {
    const { record, files } = good();
    alter(record, files);
    files['record.json'] = JSON.stringify(record, null, 2);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) continue;
      mkdirSync(dirname(join(dir, SPIKE, path)), { recursive: true });
      writeFileSync(join(dir, SPIKE, path), text);
    }
    return check(record, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Changes a kept run output and pins it again wherever the record cites it, so a wrong one is caught by what it holds, not by its hash. */
export function edit(record, files, path, change) {
  const out = JSON.parse(files[path]);
  change(out);
  files[path] = JSON.stringify(out);
  const pin = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.out === path) node.sha256 = sha256(files[path]);
    Object.values(node).forEach(pin);
  };
  pin(record);
}
