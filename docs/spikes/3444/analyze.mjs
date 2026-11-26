#!/usr/bin/env node
// #3444: the record and the report's tables, worked out from the kept runs in out/.
//
//   node docs/spikes/3444/analyze.mjs           rewrites record.json from out/ and tasks.json
//   node docs/spikes/3444/analyze.mjs tables    prints the report's tables from the same runs
//
// A run that isn't kept is left out of the record, never filled in: the acceptance tests then read it BLOCKED.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const SCENE = 'tests/acceptance/2189/fixtures/every-pass.json';
const PATCH = 'split-module.patch';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => (existsSync(join(HERE, file)) ? JSON.parse(readFileSync(join(HERE, file), 'utf8')) : null);
/** Nearest rank, as the acceptance tests take p50 over five: the third smallest. */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length / 2) - 1)];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** A kept run as the record cites it: the command that took it, its output and the output's sha256. */
function ref(file, command) {
  if (!existsSync(join(HERE, file))) return undefined;
  return { command: `node docs/spikes/3444/run.mjs ${command} --out docs/spikes/3444/${file}`, out: file, sha256: sha256(readFileSync(join(HERE, file))) };
}
const MAIN = '--bin <deep-gpu of main with the probe> --commit <main>';
const SPLIT = `--bin <deep-gpu of main with ${PATCH} and the probe> --commit <main> --patch docs/spikes/3444/${PATCH}`;

const files = {
  main: 'out/cold-main.json', split: 'out/cold-split.json',
  rounds: [1, 2, 3, 4, 5].map((n) => ({ on: `out/indirect-${n}-on.json`, off: `out/indirect-${n}-off.json` })),
  states: { one_window: 'out/state-one-window.json', four_windows: 'out/state-four-windows.json', export: 'out/state-export.json' },
  one_more: 'out/one-more.json',
};
const runs = {
  main: read(files.main), split: read(files.split),
  rounds: files.rounds.map(({ on, off }) => ({ on: read(on), off: read(off) })),
  states: Object.fromEntries(Object.entries(files.states).map(([state, file]) => [state, read(file)])),
  one_more: read(files.one_more),
};

/** A cold run's pipelines as the table's rows: each one's three times, in ms, and the time around its call. */
const rowsOf = (run) => run.pipelines.map((p) => ({
  name: p.name,
  override: sum(p.stages.map((s) => s.override_ns)) / 1e6, source: sum(p.stages.map((s) => s.source_ns)) / 1e6, compile: sum(p.stages.map((s) => s.compile_ns)) / 1e6,
  state: sum(p.stages.filter((s) => s.stage === 'pipeline').map((s) => s.compile_ns)) / 1e6,
  around: p.around_ns / 1e6,
}));

/** The three thresholds, each with the two numbers it compares, from the kept runs alone. */
function thresholds() {
  const out = {};
  if (runs.main) {
    const reading = sum(rowsOf(runs.main).map((r) => r.override + r.source + r.compile));
    out.translation = { reading, of: runs.main.first_settled_ms, more: reading > runs.main.first_settled_ms / 5 };
  }
  if (runs.rounds.every((r) => r.on && r.off)) {
    for (const [name, clock] of [['validation encode', 'encode_ms'], ['validation gpu', 'gpu_ms']]) {
      const reading = median(runs.rounds.map((r) => r.on.geometry[clock] - r.off.geometry[clock]));
      const of = median(runs.rounds.map((r) => r.on.geometry[clock]));
      out[name] = { reading, of, more: reading > 0.05 * of };
    }
  }
  if (Object.values(runs.states).every(Boolean)) {
    const reading = Math.max(...Object.values(runs.states).map((s) => Math.max(...s.reads.map((r) => r.hal.query_sets))));
    out['query sets'] = { reading, of: 16, more: reading > 16 };
  }
  return out;
}

if (process.argv[2] === 'tables') {
  const tasks = read('tasks.json') ?? {};
  const cell = (x) => x.toFixed(2);
  if (runs.main) {
    const main = rowsOf(runs.main);
    const split = runs.split ? new Map(rowsOf(runs.split).map((r) => [r.name, r])) : new Map();
    const same = runs.split && runs.main.frames.every((f) => runs.split.frames.find((g) => g.frame === f.frame)?.pixel_hash === f.pixel_hash);
    const head = same || !runs.split ? 'split' : 'split (reading)';
    console.log(`| Pipeline | main override ms | main source ms | main compile ms | main around ms | ${head} override ms | ${head} source ms | ${head} compile ms | ${head} around ms |`);
    console.log('|---|---|---|---|---|---|---|---|---|');
    const names = [...main.map((r) => r.name), ...[...split.keys()].filter((n) => !main.some((r) => r.name === n))];
    const side = (r) => (r ? [r.override, r.source, r.compile, r.around].map(cell) : ['', '', '', '']);
    for (const name of names) console.log(`| \`${name}\` | ${[...side(main.find((r) => r.name === name)), ...side(split.get(name))].join(' | ')} |`);
    const total = (rows) => ['override', 'source', 'compile', 'around'].map((k) => cell(sum(rows.map((r) => r[k]))));
    console.log(`| **sum of ${main.length}${runs.split ? ` and ${split.size}` : ''}** | ${[...total(main), ...(runs.split ? total([...split.values()]) : ['', '', '', ''])].join(' | ')} |`);
    console.log('');
    for (const [label, run] of [['main', runs.main], ['split', runs.split]]) {
      if (!run) continue;
      const rows = rowsOf(run);
      const inside = sum(rows.map((r) => r.override + r.source + r.compile));
      console.log(`${label}: ${rows.length} pipelines; override ${cell(sum(rows.map((r) => r.override)))} ms, source ${cell(sum(rows.map((r) => r.source)))} ms, compile ${cell(sum(rows.map((r) => r.compile)))} ms (of it the pipeline states ${cell(sum(rows.map((r) => r.state)))} ms); the three ${cell(inside)} ms against ${cell(sum(rows.map((r) => r.around)))} ms around the calls (${(100 * inside / sum(rows.map((r) => r.around))).toFixed(1)}%); first settled frame ${cell(run.first_settled_ms)} ms; modules ${cell(sum(run.modules.map((m) => m.around_ns)) / 1e6)} ms in ${run.modules.length}; load ${run.load.start.toFixed(1)} to ${run.load.end.toFixed(1)}; frames ${run.frames.map((f) => `${f.frame} \`${f.pixel_hash}\``).join(', ')}`);
    }
    console.log('');
  }
  // The four cold starts side by side: with nothing kept by the system (the table above) and with its compiles kept.
  const starts = [['main, nothing kept', runs.main], ['split, nothing kept', runs.split], ['main, compiles kept', read('out/cold-main-kept.json')], ['split, compiles kept', read('out/cold-split-kept.json')]].filter(([, run]) => run);
  if (starts.length) {
    console.log('| Cold start | First settled frame ms | Override ms | Source ms | Compile ms | Around the calls ms | Shader modules made | Their making ms | Load |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const [label, run] of starts) {
      const rows = rowsOf(run);
      console.log(`| ${label} | ${[run.first_settled_ms, ...['override', 'source', 'compile', 'around'].map((k) => sum(rows.map((r) => r[k])))].map(cell).join(' | ')} | ${run.modules.length} | ${cell(sum(run.modules.map((m) => m.around_ns)) / 1e6)} | ${run.load.start.toFixed(0)} to ${run.load.end.toFixed(0)} |`);
    }
    console.log('');
  }
  if (runs.rounds.some((r) => r.on || r.off)) {
    console.log('| Round | First | on encode ms | off encode ms | on GPU ms | off GPU ms | on pre-pass GPU ms | off pre-pass GPU ms | on pass timer ms | off pass timer ms | Load |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    runs.rounds.forEach(({ on, off }, i) => {
      if (!on || !off) return;
      const g = (run, k, d = 3) => (run.geometry[k] === null ? '' : run.geometry[k].toFixed(d));
      console.log(`| ${i + 1} | ${on.started < off.started ? 'on' : 'off'} | ${g(on, 'encode_ms')} | ${g(off, 'encode_ms')} | ${g(on, 'gpu_ms')} | ${g(off, 'gpu_ms')} | ${g(on, 'pre_pass_gpu_ms')} | ${g(off, 'pre_pass_gpu_ms')} | ${g(on, 'pass_timer_ms')} | ${g(off, 'pass_timer_ms')} | ${[on, off].map((r) => `${r.load.start.toFixed(0)} to ${r.load.end.toFixed(0)}`).join(', ')} |`);
    });
    console.log('');
  }
  if (Object.values(runs.states).some(Boolean) || runs.one_more) {
    console.log('| State | Live timestamp query sets, at most | Reads | Sets alive then |');
    console.log('|---|---|---|---|');
    for (const [state, run] of Object.entries(runs.states)) {
      if (run) console.log(`| ${state.replace('_', ' ')} | ${Math.max(...run.reads.map((r) => r.hal.query_sets))} | ${run.reads_taken} | ${run.sets_at_most.join(', ')} |`);
    }
    if (runs.one_more) console.log(`\none more than 32: ${runs.one_more.attempts.length} asked, ${runs.one_more.created} created, outcome ${runs.one_more.outcome}; first not created ${JSON.stringify(runs.one_more.first_not_created)}`);
    console.log('');
  }
  const t = thresholds();
  const names = { translation: 'translation', 'validation encode': 'validation', 'validation gpu': 'validation', 'query sets': 'query_sets' };
  console.log('| Threshold | Reading | Of | More than | Task |');
  console.log('|---|---|---|---|---|');
  for (const [name, key] of Object.entries(names)) {
    if (!t[name]) continue;
    const unit = name === 'query sets' ? '' : ' ms';
    const shown = (x) => (name === 'query sets' ? String(x) : `${x.toFixed(3)}${unit}`);
    console.log(`| ${name} | ${shown(t[name].reading)} | ${shown(t[name].of)} | ${t[name].more ? 'yes' : 'no'} | ${t[name].more && tasks[key] ? `#${tasks[key].issue}` : ''} |`);
  }
} else {
  const main = runs.main?.commit ?? Object.values(runs.states).find(Boolean)?.commit ?? runs.one_more?.commit;
  const patch = existsSync(join(HERE, PATCH)) ? { path: PATCH, sha256: sha256(readFileSync(join(HERE, PATCH))) } : undefined;
  const split = ref(files.split, `cold ${SPLIT}`);
  const record = {
    main,
    pipelines: {
      scene: { path: SCENE, sha256: sha256(readFileSync(join(ROOT, SCENE))) },
      main: ref(files.main, `cold ${MAIN}`),
      split: split && { ...split, patch },
    },
    indirect: { rounds: files.rounds.map(({ on, off }) => ({ on: ref(on, `indirect ${MAIN} --flag on`), off: ref(off, `indirect ${MAIN} --flag off`) })).filter((r) => r.on && r.off) },
    query_sets: {
      states: Object.fromEntries(Object.entries(files.states).map(([state, file]) => [state, ref(file, `state ${state === 'export' ? MAIN.replace('deep-gpu', 'deep-show') : MAIN} --state ${state}`)]).filter(([, r]) => r)),
      one_more: ref(files.one_more, 'one-more --bin <spike-3444, own-device/> --commit <main>'),
    },
    thresholds: thresholds(),
    tasks: read('tasks.json') ?? {},
  };
  writeFileSync(join(HERE, 'record.json'), `${JSON.stringify(record, null, 1)}\n`);
  console.log(`record.json: main ${main}; ${['main', 'split'].filter((k) => record.pipelines[k]).length} cold runs, ${record.indirect.rounds.length} rounds, ${Object.keys(record.query_sets.states).length} states, one more ${record.query_sets.one_more ? 'kept' : 'not kept'}`);
}
