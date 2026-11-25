// Spike #3445: `node docs/spikes/3445/analyze.mjs` builds record.json and the tables of README.md (between its
// `<!-- name -->` and `<!-- /name -->` lines) from the kept run outputs in out/. Every number is worked out here from
// a kept row; nothing is typed in. tasks.json, when it is there, names the task filed for an answer that is yes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const text = (file) => readFileSync(join(here, file), 'utf8');
const json = (file) => JSON.parse(text(file));
const pinned = (file) => ({ out: file, sha256: sha256(text(file)) });
/** The middle of the sorted readings, the upper of two, as benchmarks/logic.mjs takes it. */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fixed = (x, places = 1) => x.toFixed(places);
const ms = (ns) => ns / 1e6;

// ---- the canvas core's runs

/** A core run's processes after the one that fills the evidence store, each with its first reply's row. */
function firsts(out) {
  return out.processes.filter((p) => !p.primes).map((p) => ({ ...p, first: out.replies.find((r) => r.pid === p.pid && r.reply === 1), warm: out.replies.find((r) => r.pid === p.pid && r.reply === 2) }));
}
const took = (row) => row.repliedMs - row.startedMs;
const run = (out, file, command) => ({ command, ...pinned(file), lease: out.lease, load: out.load });
const CORE = (build, file) => `node scripts/throttle.mjs timed --wait 60 -- node docs/spikes/3445/measure.mjs core --core <${build}>/deep-show --build <${build}>/build.json --root <staged packs> --out docs/spikes/3445/${file}`;

const stock = json('out/first-reply.json');
const timing = json('out/compile.json');
const firstReply = { ...run(stock, 'out/first-reply.json', CORE('stock', 'out/first-reply.json')), result: firsts(stock).map(({ pid, first }) => ({ pid, reply: 1, ms: took(first) })) };

// The table is read from the timing build's process whose time inside the counted calls is the median of the five.
const timed = firsts(timing);
const chosen = timed.find((p) => p.first.compileNs === median(timed.map((q) => q.first.compileNs)));
const table = {};
for (const ref of timing.packs) table[ref] = [];
for (const call of chosen.first.programs) {
  if (call.pack === null) continue;
  const row = table[call.pack].find((r) => r.program === call.program) ?? table[call.pack][table[call.pack].push({ program: call.program, compiles: 0, ns: 0 }) - 1];
  row.compiles += 1;
  row.ns += call.ns;
}
for (const rows of Object.values(table)) for (const row of rows) { row.ms = ms(row.ns); delete row.ns; }
const compile = { ...run(timing, 'out/compile.json', CORE('timing', 'out/compile.json')), pid: chosen.pid, compiles: chosen.first.compiles, ms: ms(chosen.first.compileNs), packs: table };

// ---- ns per fuel unit

const BENCH = (tree, file) => `node scripts/throttle.mjs timed --wait 60 -- node docs/spikes/3445/measure.mjs bench --tree <${tree}> --out docs/spikes/3445/${file}: node benchmarks/logic.mjs in ${tree}`;
const bench = (file, tree) => { const ran = json(file.replace(/\.json$/, '.run.json')); return { command: BENCH(tree, file), ...pinned(file), lease: ran.lease, load: ran.load }; };
// The benchmark is read twice a side (readings.sh: in, out, then out, in). A 5% question can't be settled by a run
// whose own five runs lie further apart than that, so the pair read is the first whose two runs each keep their five
// within 5% of their median; with no such pair the first stands and the report says the answer isn't settled.
const spread = (out) => (Math.max(...out.runs.app) - Math.min(...out.runs.app)) / median(out.runs.app);
const PAIRS = [['out/epochs-in.json', 'out/epochs-out.json'], ['out/epochs-in-again.json', 'out/epochs-out-again.json']].filter((pair) => pair.every((file) => existsSync(join(here, file))));
const steady = PAIRS.find((pair) => pair.every((file) => spread(json(file)) <= 0.05));
const [inFile, outFile] = steady ?? PAIRS[0];
const epochsIn = json(inFile);
const epochsOut = json(outFile);
const writes = json('out/tracker/writes-logic.json');
const metering = JSON.parse(readFileSync(join(repo, 'crates/deep-logic/metering.json'), 'utf8'));
const patch = 'patches/epochs-out.patch';
const GOLDENS = { 'tests/acceptance/2324/fixtures/base-golden.json': 'out/golden-2324.json', 'tests/acceptance/2662/fixtures/golden.json': 'out/golden-2662.json' };
const commands = json('out/commands.json');
const epochs = {
  patch: { path: patch, sha256: sha256(text(patch)) },
  in: bench(inFile, 'a copy of main'),
  out: bench(outFile, 'a copy of main with patches/epochs-out.patch applied'),
  goldens: Object.fromEntries(Object.entries(GOLDENS).map(([golden, file]) => [golden, { command: commands[file], ...pinned(file) }])),
};
const tracker = { logic: run(writes, 'out/tracker/writes-logic.json', 'node scripts/throttle.mjs timed --wait 60 -- node docs/spikes/3445/measure.mjs tracker --bin <stock>/spike3445_tracker --build <stock>/build.json --out docs/spikes/3445/out/tracker') };

// ---- the three answers

const tasks = existsSync(join(here, 'tasks.json')) ? json('tasks.json') : {};
const answer = (key, readings, over) => ({ ...readings, over, ...(over && tasks[key] ? { task: tasks[key] } : {}) });
const checks = { in: median(epochsIn.runs.app), out: median(epochsOut.runs.app) };
const wrote = { ns_per_fuel: median(writes.runs.app), record: metering.ns_per_fuel.app };
const answers = {
  compiling: answer('compiling', { ms: compile.ms }, compile.ms > 1000),
  checks: answer('checks', checks, checks.in > 1.05 * checks.out),
  writes: answer('writes', wrote, wrote.ns_per_fuel > 2 * wrote.record),
};

const main = json('out/builds/stock.json').base;
const record = { main, firstReply, compile, epochs, tracker, answers };
writeFileSync(join(here, 'record.json'), `${JSON.stringify(record, null, 1)}\n`);

// ---- the report's tables

const tables = {};
const lines = (rows) => rows.join('\n');

// Where each compiled program came from: the timing build's marks name the item's program by its hash, and the
// pack's manifest names the file that holds it.
const marks = text('out/compile.marks.jsonl').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.pid === chosen.pid);
const answered = marks.filter((m) => m.mark === 'answered');
const until = answered[1].at;
const scoped = (m, kind) => m.scope.find(([k]) => k === kind)?.[1];
const files = new Map();
for (const folder of json('out/staged.json').packs) {
  const manifest = JSON.parse(readFileSync(join(repo, 'packs', folder.folder, 'pack.json'), 'utf8'));
  for (const a of manifest.assets ?? []) files.set(a.sha256, a.path);
}
const sources = new Map();
for (const m of marks.filter((x) => x.compile && x.at <= until)) {
  const seen = sources.get(m.compile) ?? { files: new Set(), fixtures: new Set(), bytes: m.bytes };
  seen.files.add(files.get(scoped(m, 'program')) ?? `${String(scoped(m, 'program')).slice(0, 12)}…`);
  if (scoped(m, 'fixture')) seen.fixtures.add(scoped(m, 'fixture'));
  sources.set(m.compile, seen);
}
const short = (ref) => ref.replace(/^deepbuild\//, '');
const rows = ['| Pack | Program (sha256 of the bytes compiled) | From | Bytes | Compiles | ms inside `Module::new` |', '|---|---|---|---|---|---|'];
let sum = 0;
for (const [ref, programs] of Object.entries(table)) {
  if (!programs.length) { rows.push(`| ${short(ref)} | none | | | 0 | 0 |`); continue; }
  const total = programs.reduce((t, p) => t + p.ms, 0);
  sum += total;
  programs.forEach((p, i) => {
    const from = sources.get(p.program);
    rows.push(`| ${i === 0 ? short(ref) : ''} | \`${p.program.slice(0, 12)}\` | ${[...(from?.files ?? [])].map((f) => `\`${f}\``).join(', ')} | ${from?.bytes ?? ''} | ${p.compiles} | ${fixed(p.ms, 3)} |`);
  });
  rows.push(`| | **${short(ref)} in all** | ${programs.length} programs | | ${programs.reduce((t, p) => t + p.compiles, 0)} | **${fixed(total, 3)}** |`);
}
const outside = chosen.first.programs.filter((c) => c.pack === null);
rows.push(`| **The table** | | | | ${chosen.first.programs.length - outside.length} | **${fixed(sum, 3)}** |`);
rows.push(`| **The run's own total** (pid ${chosen.pid}) | every call the compile counter counts | ${outside.length} outside a pack's check | | ${compile.compiles} | **${fixed(compile.ms, 3)}** |`);
tables.compile = lines(rows);

// The first reply, read five times, a build a row.
const part = (name) => (existsSync(join(here, name)) ? json(name) : null);
const builds = [['the base (the result)', stock], ['the base with `patches/timing.patch`', timing], ['with `parallel-compilation` (the unmerged branch)', part('out/parallel.json')], ['with `parallel-compilation` and `patches/timing.patch`', part('out/parallel-compile.json')]].filter(([, out]) => out);
const reply = ['| Build | First reply, ms, five fresh processes | Median | A warm process\'s reply, ms | Load at start and end | Inside the counted calls, ms (compiles) |', '|---|---|---|---|---|---|'];
for (const [name, out] of builds) {
  const five = firsts(out);
  const inside = five.every((p) => p.first.compileNs !== undefined) ? `${five.map((p) => fixed(ms(p.first.compileNs))).join(', ')} (${five[0].first.compiles})` : 'not read: no timing';
  reply.push(`| ${name} | ${five.map((p) => fixed(took(p.first))).join(', ')} | ${fixed(median(five.map((p) => took(p.first))))} | ${five.map((p) => fixed(took(p.warm))).join(', ')} | ${fixed(out.load.start[0], 2)}, ${fixed(out.load.end[0], 2)} | ${inside} |`);
}
tables['first-reply'] = lines(reply);

// Where the chosen process's first reply went, from its own marks.
const at = (name, nth = 0) => marks.filter((m) => m.mark === name)[nth]?.at ?? null;
const installs = marks.filter((m) => m.mark === 'installed' && m.at <= until);
const counted = marks.filter((m) => m.compile && m.at <= until);
const total = (key) => counted.reduce((t, m) => t + m[key], 0);
const span = [
  ['From `main` to the seal', ms(at('sealed'))],
  ['From the seal to the world line\'s answer', ms(answered[0].at - at('sealed'))],
  ['The first call: its line read to its reply written', ms(until - answered[0].at)],
  ['… of it, the pack checks (`check_ms`, 21 packs)', installs.reduce((t, m) => t + m.check_ms, 0)],
  ['… of them, inside `Program::new`', ms(total('program_new_ns'))],
  ['…… `Module::new` (the calls the counter counts)', ms(total('module_new_ns'))],
  ['…… `Engine::new`', ms(total('engine_ns'))],
  ['…… the offset map and the memory\'s size', ms(total('offsets_ns') + total('sized_ns'))],
];
tables.where = lines(['| Where | ms |', '|---|---|', ...span.map(([name, value]) => `| ${name} | ${fixed(value)} |`),
  `| The harness's clock for the same reply (from before the process starts) | ${fixed(took(chosen.first))} |`]);
const distinct = new Set(counted.map((m) => m.compile)).size;
const again = counted.length - distinct;
const first = new Set();
const repeated = counted.reduce((t, m) => (first.has(m.compile) ? t + m.module_new_ns : (first.add(m.compile), t)), 0);
tables.repeats = `${counted.length} counted calls compiled ${distinct} different programs: ${again} calls compiled a program this process had already compiled, ${fixed(ms(repeated))} ms of the ${fixed(compile.ms)} ms.`;

// Each pack's check in the chosen process: its own time (`check_ms`, packs.rs) and what of it the compiler took.
const perPack = installs.map((m) => { const ref = `${scoped(m, 'install')}@${m.version}`; const calls = chosen.first.programs.filter((c) => c.pack === ref); return { ref, check: m.check_ms, ns: calls.reduce((t, c) => t + c.ns, 0), compiles: calls.length, programs: new Set(calls.map((c) => c.program)).size }; });
tables.checks = lines(['| Pack, in the order checked | Its check, ms | Inside `Module::new`, ms | Compiles | Different programs |', '|---|---|---|---|---|',
  ...perPack.map((p) => `| ${short(p.ref)} | ${fixed(p.check)} | ${fixed(ms(p.ns))} | ${p.compiles} | ${p.programs} |`),
  `| **All 21** | **${fixed(perPack.reduce((t, p) => t + p.check, 0))}** | **${fixed(ms(perPack.reduce((t, p) => t + p.ns, 0)))}** | ${perPack.reduce((t, p) => t + p.compiles, 0)} | ${distinct} |`]);

// The epoch checks, in and out: every run of the benchmark, in the order taken, and the pair read.
const more = (checks.in / checks.out - 1) * 100;
const benchRow = (name, file, out) => `| ${name} | ${file ? `\`${file}\`` : ''} | ${out.runs.app.map((r) => fixed(r, 4)).join(', ')} | ${fixed(median(out.runs.app), 4)} | ${fixed(spread(out) * 100, 1)}% | ${out.ns_per_fuel.app} | ${out.fuel.bench}, ${out.fuel.twin} | ${out.steps} |`;
const taken = PAIRS.flatMap(([a, b], i) => (i === 0 ? [['in', a], ['out', b]] : [['out', b], ['in', a]]));
tables.epochs = lines(['| Epoch checks | Output | ns per fuel unit in the app, five runs | Median | Spread of the five | The benchmark\'s own (3 places) | Fuel: the benchmark, its twin | Steps |', '|---|---|---|---|---|---|---|---|',
  ...taken.map(([side, file]) => benchRow(`${side}${[inFile, outFile].includes(file) ? ' (read)' : ''}`, file, json(file))),
  benchRow('the record (`crates/deep-logic/metering.json`), with them in', '', metering),
  '', steady ? `The pair read is \`${inFile}\` and \`${outFile}\`: with the checks in, a fuel unit costs ${fixed(more, 2)}% ${more >= 0 ? 'more' : 'less'} than with them out.`
    : `No pair kept both runs' five readings within 5% of their median, so the first stands and the answer isn't settled: ${fixed(more, 2)}% ${more >= 0 ? 'more' : 'less'} with the checks in.`]);

// The tracker: each program as a plain program and as a logic item's.
const tracked = ['metering-logic', 'metering-plain', 'writes-logic', 'writes-plain', 'writes-marked-inline-plain'].map((name) => part(`out/tracker/${name}.json`)).filter(Boolean);
const iterations = (out) => (out.program === 'metering' ? 120000 : out.program === 'writes' ? out.writes.iterations : out.writes.marked.iterations);
const iteration = (out) => median(out.raw.slice(1).map((r) => r.bench_ns - r.twin_ns)) / (iterations(out) - 1);
tables.tracker = lines(['| Program | Rewritten as | Fuel a step | ns per fuel unit, five runs | Median | Against the record\'s ' + metering.ns_per_fuel.app + ' | ns an iteration |', '|---|---|---|---|---|---|---|',
  ...tracked.map((out) => `| ${out.program} | ${out.rewrite === 'logic' ? 'a logic item\'s (the tracker after each store)' : 'a plain program'} | ${out.fuel.bench} | ${out.runs.app.map((r) => fixed(r, 4)).join(', ')} | ${fixed(median(out.runs.app), 4)} | ${fixed(median(out.runs.app) / metering.ns_per_fuel.app, 2)}× | ${fixed(iteration(out), 2)} |`)]);

// What each change would return, worked out from the rows above.
const med = (out) => median(firsts(out).map((p) => took(p.first)));
const parallel = part('out/parallel.json');
const parallelTimed = part('out/parallel-compile.json');
const inside = (out) => median(firsts(out).map((p) => p.first.compileNs));
const byName = Object.fromEntries(tracked.map((out) => [`${out.program}-${out.rewrite}`, out]));
const store = (name) => iteration(byName[name]) / byName[name].writes.stores;
tables.returns = lines([
  `- **A program compiled once a process.** ${again} of the ${counted.length} counted calls compiled bytes the same process had already compiled. Without them the run would have spent ${fixed(compile.ms - ms(repeated))} ms inside the counted calls in place of ${fixed(compile.ms)} ms: ${fixed(ms(repeated))} ms back, ${fixed(ms(repeated) / took(chosen.first) * 100)}% of that process's first reply.`,
  ...(parallel && parallelTimed ? [`- **\`parallel-compilation\`.** The first reply's median went from ${fixed(med(stock))} ms to ${fixed(med(parallel))} ms, ${fixed(med(stock) - med(parallel))} ms back; the time inside the counted calls, by the timing builds, from ${fixed(ms(inside(timing)))} ms to ${fixed(ms(inside(parallelTimed)))} ms. The same ${parallelTimed.replies.find((r) => r.reply === 1 && !r.primes).compiles} calls are still made.`] : []),
  `- **What isn't compiling.** Of the ${fixed(perPack.reduce((t, p) => t + p.check, 0))} ms the 21 checks took, ${fixed(perPack.reduce((t, p) => t + p.check, 0) - ms(total('program_new_ns')))} ms were outside \`Program::new\`: linking, rewriting and running each fixture, and the checks of packs that hold no program.`,
  `- **The epoch checks.** ${fixed(checks.in, 4)} ns per fuel unit with them in, ${fixed(checks.out, 4)} with them out: taking them out would return ${fixed(more, 2)}% of a step that runs like the benchmark.`,
  `- **The tracker.** In the twin that mostly writes, a store costs ${fixed(store('writes-plain'), 2)} ns as a plain program and ${fixed(store('writes-logic'), 2)} ns as a logic item's, so the tracker's call is ${fixed(store('writes-logic') - store('writes-plain'), 2)} ns a store, ${fixed((1 - store('writes-plain') / store('writes-logic')) * 100)}% of the step. With the same mark written inline, for a bitmap of one word, a store costs ${fixed(store('writes-marked-inline-plain'), 2)} ns: ${fixed(store('writes-logic') - store('writes-marked-inline-plain'), 2)} ns a store back. In the benchmark's own program, which stores once in 40 instructions, the tracker is ${fixed((median(byName['metering-logic'].runs.app) / median(byName['metering-plain'].runs.app) - 1) * 100, 1)}% of a fuel unit.`,
]);

// What each timed run ran under: the issue's `Runs on:` line, as the acceptance tests hold it.
const REFERENCE = { 'Mac15,7': 12, 'Mac15,12': 8, 'Mac17,10': 18 };
const off = (print, lease, load) => {
  const why = [];
  const cores = REFERENCE[print.model];
  if (!cores) why.push(`${print.model} is no reference Mac`);
  if (print.power !== 'ac') why.push(`power is ${print.power}`);
  if (print.lowPowerMode !== false) why.push('Low Power Mode is on');
  if (print.thermalState !== 'nominal') why.push(`the thermal state is ${print.thermalState}`);
  if (!/^timed:[0-9a-f]+$/.test(lease ?? '')) why.push('no timed grant');
  if (cores && (load.start[0] > cores || load.end[0] > cores)) why.push(`the load is above its ${cores} cores`);
  return why;
};
const ran = [['The first reply', 'out/first-reply.json', stock, stock], ['The compile table', 'out/compile.json', timing, timing],
  ['The checks in', inFile, epochsIn, json(inFile.replace(/\.json$/, '.run.json'))], ['The checks out', outFile, epochsOut, json(outFile.replace(/\.json$/, '.run.json'))],
  ['The twin that mostly writes', 'out/tracker/writes-logic.json', writes, writes]];
const readings = ran.filter(([, , out, at]) => off(out.fingerprint, at.lease, at.load).length);
tables.conditions = lines(['| Run | Output | Mac | Power | Low Power Mode | Thermal state | Lease | 1-minute load at its start and end | Counts as |', '|---|---|---|---|---|---|---|---|---|',
  ...ran.map(([name, file, out, at]) => { const why = off(out.fingerprint, at.lease, at.load); const p = out.fingerprint; return `| ${name} | \`${file}\` | ${p.model}, ${p.chip}, macOS ${p.macosBuild} | ${p.power} | ${p.lowPowerMode ? 'on' : 'off'} | ${p.thermalState} | \`${at.lease}\` | ${fixed(at.load.start[0], 2)}, ${fixed(at.load.end[0], 2)} | ${why.length ? `a reading: ${why.join('; ')}` : 'a result'} |`; }),
  '', readings.length ? `**${readings.length} of the ${ran.length} runs are readings, not results.** The numbers below are what those runs gave; none of them settles a criterion until the runs are taken again under the issue's \`Runs on:\` line.` : 'Every run meets the issue\'s `Runs on:` line.']);

// The three answers, each in the issue's words.
const filed = (key) => (answers[key].task ? ` Task #${answers[key].task.issue}.` : answers[key].over ? ' No task is filed yet.' : '');
const word = (over) => (over ? 'yes' : 'no');
tables.answers = lines([
  `- The first reply waits more than 1 s on compiling: ${word(answers.compiling.over)}, ${fixed(compile.ms)} ms inside the calls the compile counter counts (${compile.compiles} compiles, pid ${compile.pid}).${filed('compiling')}`,
  `- The checks cost a live step more than 5%: ${word(answers.checks.over)}, ${fixed(checks.in, 4)} ns per fuel unit with them in and ${fixed(checks.out, 4)} with them out, ${fixed(more, 2)}% ${more >= 0 ? 'more' : 'less'}.${filed('checks')}`,
  `- A step that mostly writes costs more than twice the record's ns per fuel unit: ${word(answers.writes.over)}, ${fixed(wrote.ns_per_fuel, 4)} against the record's ${wrote.record}, ${fixed(wrote.ns_per_fuel / wrote.record, 2)} times.${filed('writes')}`,
]);

let readme = text('README.md');
for (const [name, body] of Object.entries(tables)) {
  const [open, close] = [`<!-- ${name} -->`, `<!-- /${name} -->`];
  if (!readme.includes(open) || !readme.includes(close)) throw Error(`README.md has no ${open} … ${close}`);
  readme = `${readme.slice(0, readme.indexOf(open) + open.length)}\n${body}\n${readme.slice(readme.indexOf(close))}`;
}
writeFileSync(join(here, 'README.md'), readme);
console.log(tables.answers);
