// This suite's own check (#3445): the validators the acceptance tests use must pass a well-formed spike and fail each
// wrong one, or those tests prove nothing. A synthetic spike in a temporary folder, in the formats README.md gives; it
// doubles as their worked example. Its `main` is the base commit this suite was written on, whose packs, metering
// record and goldens the validators read from this checkout's history; every time in it is made up, none was read
// from a run. The wrong spikes are the ones the criteria name: a table that leaves a program out, a reading from a dev
// build or a warm process taken as the result, a golden with one step's hash moved, a report that says a threshold
// wasn't passed when its own readings pass it, and one that files no task for a threshold that was. Carries no
// criterion: it passes on the base, where nothing of the spike exists.
// Run: node --test tests/acceptance/3445/validate.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  answersProblems, compileTableProblems, ENGINE, epochsOutProblems, fileAt, firstReplyProblems, GOLDENS, median, METERING, round3, sha256, shippedPacks, SPIKE,
} from './validate.mjs';

const BASE = 'aafef31316f7da8f741647a5934a717d9019ffff';
const [G2324, G2662] = GOLDENS;
const fingerprint = { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 68719476736, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '26B8119' };
const release = { profile: 'release', toolchain: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' };
const dev = { profile: 'dev', toolchain: release.toolchain };
/** A run as the record cites it: its command, its kept output pinned by sha256, the timed grant it held and the load around it. */
const run = (command, out, text, more = {}) => ({ command, out, sha256: sha256(text), lease: 'timed:5f3a9c1e', load: { start: [6.2, 7.9, 9.4], end: [7.1, 8.0, 9.3] }, ...more });
/** One timed reply of a canvas core: its process, which of that process's replies it is, the build's own word, and the two clock reads. */
const reply = (pid, n, startedMs, ms, build = release) => ({ pid, reply: n, build, startedMs, repliedMs: startedMs + ms });

/** The change that takes the epoch checks out, as a patch against main. */
const PATCH = `diff --git a/${ENGINE} b/${ENGINE}
--- a/${ENGINE}
+++ b/${ENGINE}
@@ -115,7 +115,7 @@ impl Program {
             .wasm_backtrace_max_frames(std::num::NonZeroUsize::new(1))
             .cranelift_nan_canonicalization(false)
             .consume_fuel(faults.wasmtime_fuel)
-            .epoch_interruption(true)
+            .epoch_interruption(false)
             .max_wasm_stack(NATIVE_STACK)
             .wasm_simd(false)
             .wasm_relaxed_simd(false)
`;

/** A well-formed spike: the record, the outputs it cites, the patch and the report, as files under <dir>/docs/spikes/3445. */
function good() {
  const { packs } = shippedPacks(BASE);
  const refs = packs.map((p) => p.ref);

  // Criterion 2: five fresh processes of a release build, and beside them a warm process's reply and a dev build's.
  const t = 1764040200000;
  const first = { date: '2026-11-25T03:10:00.000Z', fingerprint, packs: refs, replies: [
    reply(4101, 1, t, 1930.25), reply(4101, 2, t + 2500, 41.5), reply(4102, 1, t + 5000, 1911.5), reply(4103, 1, t + 10000, 1954.75),
    reply(4104, 1, t + 15000, 1922), reply(4105, 1, t + 20000, 1940.5), reply(4200, 1, t + 30000, 28731.5, dev),
  ] };

  // Criterion 1: one more fresh process, whose core also read each call the compile counter counts. A pack with
  // libraries or interfaces compiles three programs, the first of them twice; one call is outside every pack's check.
  const calls = packs.filter((p) => p.compiles).flatMap((p, i) => [0, 0, 1, 2].map((j, k) => ({ pack: p.ref, program: sha256(`${p.ref} program ${j}`), ns: 30_000_000 + 7_000_000 * ((i * 5 + k * 3) % 9) + 125 * k })));
  calls.push({ pack: null, program: sha256('the logic module\'s own fixture'), ns: 9_000_000 });
  const compileNs = calls.reduce((sum, c) => sum + c.ns, 0);
  const compiled = { date: '2026-11-25T03:20:00.000Z', fingerprint, packs: refs, replies: [{ ...reply(4301, 1, t + 600000, 2104.5), compiles: calls.length, compileNs, programs: calls }] };
  const table = Object.fromEntries(packs.map((p) => {
    const programs = [...new Set(calls.filter((c) => c.pack === p.ref).map((c) => c.program))];
    return [p.ref, programs.map((program) => {
      const of = calls.filter((c) => c.pack === p.ref && c.program === program);
      return { program, compiles: of.length, ms: of.reduce((sum, c) => sum + c.ns, 0) / 1e6 };
    })];
  }));

  // Criteria 3 and 4: the metering benchmark's output, in the record's own shape, with the checks in and out; a metering
  // twin that mostly writes, as a logic item's; and each golden's piece recorded again with the checks out.
  const metering = JSON.parse(fileAt(BASE, METERING));
  const bench = (app) => ({ ...metering, fingerprint, runs: { ...metering.runs, app }, ns_per_fuel: { ...metering.ns_per_fuel, app: round3(median(app)) } });
  const [epochsIn, epochsOut] = [bench([0.2499, 0.2503, 0.2507, 0.2511, 0.2495]), bench([0.2441, 0.245, 0.2447, 0.2455, 0.2449])];
  const writes = { fingerprint, build: release, fuel: { bench: 2400009, twin: 29 }, steps: 20, runs: { app: [0.61, 0.6, 0.62, 0.605, 0.615] }, ns_per_fuel: { app: 0.61 } };
  const golden = (path) => JSON.parse(fileAt(BASE, path)).golden;

  const files = {
    'out/first-reply.json': JSON.stringify(first),
    'out/compile.json': JSON.stringify(compiled),
    'out/epochs-in.json': JSON.stringify(epochsIn, null, 2),
    'out/epochs-out.json': JSON.stringify(epochsOut, null, 2),
    'out/tracker-logic.json': JSON.stringify(writes),
    // deep-logic's reply to `golden` as it prints it, and a golden alone: both are read.
    'out/golden-2324.json': JSON.stringify({ ok: true, golden: golden(G2324) }),
    'out/golden-2662.json': JSON.stringify(golden(G2662)),
    'epochs-out.patch': PATCH,
  };
  const pin = (command, out) => ({ command, out, sha256: sha256(files[out]) });
  const record = {
    main: BASE,
    firstReply: run('node docs/spikes/3445/core.mjs --runs 5 --out out/first-reply.json', 'out/first-reply.json', files['out/first-reply.json'],
      { result: [4101, 4102, 4103, 4104, 4105].map((pid) => { const r = first.replies.find((x) => x.pid === pid && x.reply === 1); return { pid, reply: 1, ms: r.repliedMs - r.startedMs }; }) }),
    compile: run('node docs/spikes/3445/core.mjs --compiles --copy <copy> --out out/compile.json', 'out/compile.json', files['out/compile.json'],
      { pid: 4301, compiles: calls.length, ms: compileNs / 1e6, packs: table }),
    epochs: {
      patch: { path: 'epochs-out.patch', sha256: sha256(PATCH) },
      in: run('node benchmarks/logic.mjs', 'out/epochs-in.json', files['out/epochs-in.json']),
      out: run('node benchmarks/logic.mjs (in <copy>, main with epochs-out.patch applied)', 'out/epochs-out.json', files['out/epochs-out.json']),
      goldens: {
        [G2324]: pin('<copy>/target/release/deep-logic < the golden call of the fixture\'s piece, track and steps', 'out/golden-2324.json'),
        [G2662]: pin('DEEP_2662_PRINT=1 cargo test -p deep-logic --test acceptance_2662_goldens -- --nocapture (in <copy>)', 'out/golden-2662.json'),
      },
    },
    tracker: { logic: run('node docs/spikes/3445/tracker.mjs --logic --out out/tracker-logic.json', 'out/tracker-logic.json', files['out/tracker-logic.json']) },
    answers: {
      compiling: { ms: compileNs / 1e6, over: true, task: { issue: 3501, title: 'Keep a pack\'s compiled programs across starts', criteria: ['- [ ] A second start of the canvas core compiles no program of a pack it has checked'] } },
      checks: { in: median(epochsIn.runs.app), out: median(epochsOut.runs.app), over: false },
      writes: { ns_per_fuel: median(writes.runs.app), record: metering.ns_per_fuel.app, over: true, task: { issue: 3502, title: 'Charge the page tracker\'s call in the step ceiling', criteria: ['- [ ] A step that stores every other instruction stays under its frame at the ceiling'] } },
    },
  };
  const rows = packs.flatMap((p) => (table[p.ref].length ? table[p.ref].map((r) => `| ${p.name} | ${r.program.slice(0, 12)} | ${r.compiles} | ${r.ms.toFixed(3)} |`) : [`| ${p.name} | none | 0 | 0 |`]));
  files['README.md'] = `# #3445: what a sandboxed program costs that the fuel doesn't count

## Compiling

| pack | program | compiles | ms |
|---|---|---|---|
${rows.join('\n')}

The run's own total: ${(compileNs / 1e6).toFixed(3)} ms inside ${calls.length} counted calls.

## Answers

- The first reply waits more than 1 s on compiling: **yes**, ${(compileNs / 1e6).toFixed(1)} ms inside the compiler. Task #3501.
- The checks cost a live step more than 5%: no, 0.2503 ns per fuel unit with them in and 0.2449 with them out.
- A step that mostly writes costs more than twice the record's ns per fuel unit: yes, 0.61 against the record's 0.25. Task #3502.
`;
  return { record, files };
}

function spike(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v3445-'));
  const { record, files } = good();
  mutate(record, files);
  for (const [name, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(dir, SPIKE, name)), { recursive: true });
    writeFileSync(join(dir, SPIKE, name), body);
  }
  return { dir, record };
}
const check = (validator, mutate) => { const { dir, record } = spike(mutate); try { return validator(record, dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
/** Changes a kept output and pins it again, so a wrong spike is caught by its substance, not by its hash. */
const edit = (files, ref, change) => {
  const out = JSON.parse(files[ref.out]);
  change(out);
  files[ref.out] = JSON.stringify(out);
  ref.sha256 = sha256(files[ref.out]);
};
const fails = (problems, pattern) => assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const CHECKS = [compileTableProblems, firstReplyProblems, epochsOutProblems, answersProblems];
const CIRCUIT = 'deepbuild/circuit@1.0.0';

test('validator: a well-formed spike passes every check', () => {
  for (const validator of CHECKS) assert.deepEqual(check(validator), [], validator.name);
  // The base ships 21 packs, seven of them with libraries or interfaces: what the synthetic table is built on.
  const { packs } = shippedPacks(BASE);
  assert.deepEqual([packs.length, packs.filter((p) => p.compiles).length], [21, 7]);
});

test('validator: criterion 1\'s check fails a table that leaves a program out, naming it, and a table its run doesn\'t give', () => {
  const left = good().record.compile.packs[CIRCUIT][1].program;
  // The wrong spike the criterion names: the program is in the run's rows and not in the table.
  fails(check(compileTableProblems, (r) => { r.compile.packs[CIRCUIT].splice(1, 1); }), new RegExp(`the table leaves out program ${left} of deepbuild/circuit@1\\.0\\.0 \\(1 counted call, [\\d.]+ ms in out/compile\\.json\\)`));
  fails(check(compileTableProblems, (r, f) => { f['README.md'] = f['README.md'].split('\n').filter((line) => !line.includes(left.slice(0, 12))).join('\n'); }), new RegExp(`README\\.md's table leaves out program ${left.slice(0, 12)} of circuit@1\\.0\\.0`));
  fails(check(compileTableProblems, (r) => { delete r.compile.packs['deepbuild/art@1.0.0']; }), /the table leaves out the shipped pack deepbuild\/art@1\.0\.0/);
  // A pack whose programs the run never read: neither its rows nor the table hold one.
  fails(check(compileTableProblems, (r, f) => { r.compile.packs[CIRCUIT] = []; edit(f, r.compile, (o) => { const row = o.replies[0]; row.programs = row.programs.filter((p) => p.pack !== CIRCUIT); row.compiles = row.programs.length; row.compileNs = row.programs.reduce((s, p) => s + p.ns, 0); }); }),
    /deepbuild\/circuit@1\.0\.0 carries libraries or interfaces, whose fixtures the core's pack check compiles and runs, and the table gives it no program/);
  // A counted call with no row, and a run that spends more than 5% of its compile time outside the table.
  fails(check(compileTableProblems, (r, f) => edit(f, r.compile, (o) => { o.replies[0].programs.pop(); })), /the run counted 29 compiles and out\/compile\.json holds 28 rows/);
  fails(check(compileTableProblems, (r, f) => { edit(f, r.compile, (o) => { const row = o.replies[0]; row.programs.push({ pack: null, program: sha256('a kit program'), ns: 400_000_000 }); row.compiles += 1; row.compileNs += 400_000_000; }); r.compile.compiles += 1; r.compile.ms += 400; }),
    /the table's times sum to [\d.]+ ms, [\d.]+% under the [\d.]+ ms the same run spent inside the 30 calls the compile counter counts; they sum to within 5%; 2 programs were compiled outside every shipped pack's check/);
  fails(check(compileTableProblems, (r) => { r.compile.packs[CIRCUIT][0].ms += 1; }), /compile\.packs\["deepbuild\/circuit@1\.0\.0"\]\[0\]\.ms is/);
  fails(check(compileTableProblems, (r) => { r.compile.packs[CIRCUIT][0].compiles = 1; }), /\.compiles is 1, out\/compile\.json holds 2 counted calls/);
  fails(check(compileTableProblems, (r) => { r.compile.ms -= 100; }), /compile\.ms \(the run's own total, beside the table\) is/);
  fails(check(compileTableProblems, (r) => { r.compile.packs['deepbuild/zeta@1.0.0'] = []; }), /names deepbuild\/zeta@1\.0\.0, which is none of the 21 packs main ships/);
  fails(check(compileTableProblems, (r, f) => edit(f, r.compile, (o) => { o.packs = o.packs.filter((p) => p !== 'deepbuild/verbs@1.0.0'); })), /the core's world didn't hold the shipped pack deepbuild\/verbs@1\.0\.0/);
  fails(check(compileTableProblems, (r, f) => edit(f, r.compile, (o) => { o.replies[0].build = dev; })), /pid 4301's reply 1 is from a dev build, not a release build: a reading, never the result/);
  fails(check(compileTableProblems, (r, f) => edit(f, r.compile, (o) => { delete o.replies[0].programs; })), /BLOCKED: compile .* the run's compile times weren't read/);
});

test('validator: criterion 2\'s check fails a reading from a dev build or a warm process taken as the result, naming it', () => {
  // The two wrong spikes the criterion names: both readings are kept, and neither may be among the five.
  fails(check(firstReplyProblems, (r) => { r.firstReply.result[4] = { pid: 4200, reply: 1, ms: 28731.5 }; }), /firstReply\.result\[4\]: pid 4200's reply 1 is from a dev build, not a release build: a reading, never the result/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.result[0] = { pid: 4101, reply: 2, ms: 41.5 }; }), /firstReply\.result\[0\]: pid 4101's reply 2 is from a warm process, which had answered 1 call before it: a reading, never the result/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.result.pop(); }), /firstReply\.result holds 4 readings, not 5/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.result[1] = { ...r.firstReply.result[0] }; }), /pid 4101 is taken twice: five readings are five fresh processes/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.result[2].ms -= 400; }), /firstReply\.result\[2\]\.ms is 1554\.75, out\/first-reply\.json gives 1954\.75/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.result[3].pid = 4999; }), /BLOCKED: firstReply\.result\[3\]: out\/first-reply\.json holds no reply 1 of pid 4999: a reading that isn't there/);
  fails(check(firstReplyProblems, (r, f) => edit(f, r.firstReply, (o) => { o.packs.pop(); })), /the core's world didn't hold the shipped pack/);
  fails(check(firstReplyProblems, (r, f) => { f['out/first-reply.json'] += ' '; }), /BLOCKED: firstReply: sha256 of out\/first-reply\.json is not what the record says/);
});

test('validator: criterion 3\'s check fails a golden with one step\'s hash moved, naming the golden and the step, and a reading that isn\'t the record\'s way', () => {
  const pinned = (r, path) => r.epochs.goldens[path];
  // The wrong spike the criterion names, in each of the two forms a replay is kept in.
  fails(check(epochsOutProblems, (r, f) => edit(f, pinned(r, G2662), (o) => { o.step_hashes.a[37] = '0000000000000000'; })), /^golden tests\/acceptance\/2662\/fixtures\/golden\.json: step 37 of a hashes 0000000000000000 with the epoch checks out, and the golden holds [0-9a-f]{16}$/);
  fails(check(epochsOutProblems, (r, f) => edit(f, pinned(r, G2324), (o) => { o.golden.step_hashes.table_copy[119] = 'ffffffffffffffff'; })), /^golden tests\/acceptance\/2324\/fixtures\/base-golden\.json: step 119 of table_copy hashes ffffffffffffffff/);
  fails(check(epochsOutProblems, (r, f) => edit(f, pinned(r, G2662), (o) => { o.step_hashes.b.pop(); })), /golden tests\/acceptance\/2662\/fixtures\/golden\.json: step 239 of b hashes nothing with the epoch checks out/);
  fails(check(epochsOutProblems, (r) => { delete r.epochs.goldens[G2324]; }), /BLOCKED: .*the golden tests\/acceptance\/2324\/fixtures\/base-golden\.json wasn't replayed with the epoch checks out/);
  fails(check(epochsOutProblems, (r, f) => { f['out/golden-2662.json'] = null; }), /BLOCKED: .*out\/golden-2662\.json is not kept with the spike/);
  // The benchmark's reading with the checks out, as the record's was: 20 steps, 5 runs, its own median, the record's fuel and engine, a release build.
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.steps = 19; })), /epochs\.out \(out\/epochs-out\.json\): steps is 19, not the record's 20/);
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.runs.app.pop(); o.ns_per_fuel.app = round3(median(o.runs.app)); })), /runs\.app holds 4 runs, not the record's 5/);
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.ns_per_fuel.app = 0.2; })), /ns_per_fuel\.app is 0\.2, and the benchmark's median of its runs\.app is 0\.245/);
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.fuel.bench += 120000; })), /fuel\.bench is 4920007, not the 4800007 the record's benchmark program is charged/);
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.engines.app = 'wasmtime 50.0.1'; })), /engines\.app is "wasmtime 50\.0\.1", not the record's "wasmtime 49\.0\.5"/);
  fails(check(epochsOutProblems, (r, f) => edit(f, r.epochs.out, (o) => { o.build.profile = 'dev'; })), /build\.profile is "dev", not "release": a reading, never the result/);
  fails(check(epochsOutProblems, (r) => { r.epochs.out.command = 'node docs/spikes/3445/meter.mjs'; }), /doesn't name benchmarks\/logic\.mjs/);
  // The patch: one that leaves the checks in, and one a build flag can turn back on.
  const patched = (text) => (r, f) => { f['epochs-out.patch'] = text; r.epochs.patch.sha256 = sha256(text); };
  fails(check(epochsOutProblems, patched(PATCH.replace('-            .epoch_interruption(true)\n+            .epoch_interruption(false)\n', ' \n'))), /epochs-out\.patch doesn't take epoch_interruption\(true\) out of crates\/deep-sandbox-wasmtime\/src\/lib\.rs/);
  fails(check(epochsOutProblems, patched(PATCH.replace('+            .epoch_interruption(false)', '+            .epoch_interruption(!cfg!(feature = "epochs-out"))'))), /which can turn the checks on again/);
  assert.deepEqual(check(epochsOutProblems, patched(PATCH.replace('+            .epoch_interruption(false)\n', '').replace('+115,7', '+115,6'))), [], 'a patch that takes the line out, leaving the engine\'s default, has the checks out too');
  fails(check(epochsOutProblems, (r) => { delete r.epochs.patch; }), /BLOCKED: epochs\.patch: missing from the record/);
});

test('validator: criterion 4\'s check fails a report that says a threshold wasn\'t passed when its own readings pass it, and one that files no task for it', () => {
  /** The report's line for a question, turned from yes to no. */
  const no = (line) => (r, f) => { f['README.md'] = f['README.md'].replace(line, line.replace(/: \**yes\**$/, ': no')); };
  const COMPILING = 'The first reply waits more than 1 s on compiling: **yes**';
  // The two wrong spikes the criterion names.
  const denied = check(answersProblems, (r, f) => { r.answers.compiling.over = false; delete r.answers.compiling.task; no(COMPILING)(r, f); });
  fails(denied, /answers\.compiling\.over is false, and its own readings say yes: [\d.]+ ms inside the calls the compile counter counts, against 1000 ms/);
  fails(denied, /README\.md says "the first reply waits more than 1 s on compiling: no", and its own readings say yes/);
  fails(check(answersProblems, (r) => { delete r.answers.writes.task; }), /answers\.writes: no task is filed, and a step that mostly writes costs more than twice the record's ns per fuel unit: 0\.61 ns per fuel unit against twice the record's 0\.25/);
  // The other way round, and each part of an answer alone.
  fails(check(answersProblems, (r) => { r.answers.checks.over = true; }), /answers\.checks\.over is true, and its own readings say no: 0\.2503 ns per fuel unit with the checks in against 0\.2449 with them out, 2\.20% more/);
  fails(check(answersProblems, no('A step that mostly writes costs more than twice the record\'s ns per fuel unit: yes')), /README\.md says "a step that mostly writes costs more than twice the record's ns per fuel unit: no", and its own readings say yes/);
  fails(check(answersProblems, (r, f) => { f['README.md'] = f['README.md'].replace('The checks cost a live step more than 5%: no', 'The checks cost little'); }), /README\.md has no line stating whether the checks cost a live step more than 5%/);
  fails(check(answersProblems, (r) => { r.answers.checks.in = 0.26; }), /answers\.checks\.in is 0\.26, the kept runs give 0\.2503/);
  fails(check(answersProblems, (r) => { r.answers.writes.record = 0.3; }), /answers\.writes\.record is 0\.3, the kept runs give 0\.25/);
  fails(check(answersProblems, (r) => { r.answers.writes.task.issue = 3501; }), /answers\.writes\.task is #3501, the task answers\.compiling names: a task is filed for each/);
  fails(check(answersProblems, (r) => { r.answers.compiling.task.issue = 3445; }), /answers\.compiling\.task\.issue is not the number of a task filed apart from #3445/);
  fails(check(answersProblems, (r) => { r.answers.compiling.task.criteria = []; }), /answers\.compiling\.task\.criteria \(the task's own acceptance criteria\) is missing/);
  fails(check(answersProblems, (r, f) => { f['README.md'] = f['README.md'].replace('Task #3502.', ''); }), /README\.md doesn't name the task #3502/);
  fails(check(answersProblems, (r) => { delete r.tracker; }), /BLOCKED: answers\.writes: its readings are missing/);
  fails(check(answersProblems, (r) => { delete r.answers.checks; }), /answers\.checks is missing/);
  // The thresholds are the issue's "more than": a reading at the threshold doesn't pass it, and one past it does.
  const total = (ns) => (r, f) => { edit(f, r.compile, (o) => { o.replies[0].compileNs = ns; }); r.answers.compiling.ms = ns / 1e6; };
  fails(check(answersProblems, total(1_000_000_000)), /answers\.compiling\.over is true, and its own readings say no: 1000 ms/);
  assert.deepEqual(check(answersProblems, (r, f) => { total(1_000_000_000)(r, f); r.answers.compiling.over = false; no(COMPILING)(r, f); }), [], 'at 1 s, no, and its task may stay');
  const checksIn = (app) => (r, f) => { edit(f, r.epochs.in, (o) => { o.runs.app = app; o.ns_per_fuel.app = round3(median(app)); }); r.answers.checks.in = median(app); };
  fails(check(answersProblems, checksIn([0.2601, 0.2599, 0.26, 0.2602, 0.2598])), /answers\.checks\.over is false, and its own readings say yes: 0\.26 ns per fuel unit with the checks in against 0\.2449 with them out, 6\.17% more/);
});

test('validator: a run off a reference Mac, loaded, or with another job\'s lease beside it is INCONCLUSIVE, naming the run, and never passes', () => {
  const machine = (ref, change) => (r, f) => edit(f, ref(r), (o) => { Object.assign(o.fingerprint, change); });
  const linux = { model: null, chip: null, memoryBytes: null, power: null, lowPowerMode: null, thermalState: null, macosBuild: null };
  fails(check(firstReplyProblems, machine((r) => r.firstReply, linux)), /INCONCLUSIVE: firstReply: a reading, not a result: model null, chip null, memoryBytes null is none of the reference Macs \(Mac15,7, Mac15,12, Mac17,10\)/);
  fails(check(compileTableProblems, machine((r) => r.compile, { power: 'battery' })), /INCONCLUSIVE: compile: a reading, not a result: power is "battery", not "ac"/);
  fails(check(epochsOutProblems, machine((r) => r.epochs.out, { thermalState: 'fair' })), /INCONCLUSIVE: epochs\.out: a reading, not a result: the thermal state is "fair", not "nominal"/);
  fails(check(answersProblems, machine((r) => r.tracker.logic, { lowPowerMode: true })), /INCONCLUSIVE: tracker\.logic: a reading, not a result: Low Power Mode is true, not false/);
  fails(check(firstReplyProblems, (r) => { r.firstReply.load.start = [24.3, 20.1, 19.8]; }), /INCONCLUSIVE: firstReply: a reading, not a result: the 1-minute load 24\.3 at the run's start is above the 18 cores of Mac17,10: a loaded run counts neither way/);
  fails(check(epochsOutProblems, (r) => { delete r.epochs.out.load; }), /INCONCLUSIVE: epochs\.out: a reading, not a result: load\.start is not the 1, 5 and 15 minute load averages/);
  fails(check(compileTableProblems, (r) => { r.compile.lease = 'build:5f3a9c1e'; }), /INCONCLUSIVE: compile: a reading, not a result: lease is "build:5f3a9c1e", not a timed grant/);
  fails(check(answersProblems, (r) => { delete r.epochs.in.lease; }), /INCONCLUSIVE: epochs\.in: a reading, not a result: lease is missing, not a timed grant/);
  fails(check(answersProblems, machine((r) => r.tracker.logic, { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 })), /INCONCLUSIVE: tracker\.logic ran on "Mac15,12" "Apple M3" 17179869184 and compile on "Mac17,10" "Apple M5 Max" 68719476736: every reading is from one machine/);
  assert.deepEqual(check(firstReplyProblems, (r) => { r.firstReply.load.end = [18, 17.2, 16.9]; }), [], 'a load at the cores, not above them, still counts');
});

test('validator: a record whose main this checkout doesn\'t have is BLOCKED', () => {
  for (const validator of CHECKS) {
    fails(check(validator, (r) => { r.main = 'f'.repeat(40); }), /BLOCKED: main f{40} is not a commit this checkout's git has/);
    fails(check(validator, (r) => { delete r.main; }), /BLOCKED: main is not the full hash/);
  }
});
