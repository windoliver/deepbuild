// This suite's own check (#3444): the validators the acceptance tests use must pass a well-formed spike and fail each
// wrong one, or those tests prove nothing. The well-formed spike is example.mjs's, a synthetic one in the formats
// README.md gives, written into a temporary folder. The wrong programs are the ones the criteria name, each an altered
// copy of it run through the same check, which must fail naming what its criterion names. Carries no criterion: it
// passes on the base, where nothing of the spike exists.
// Run: node --test tests/acceptance/3444/validate.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { at, edit, hal, HASHES, PATCH, run, SCENE_ENTRIES } from './example.mjs';
import {
  holds, indirectProblems, loadRecord, pipelineTableProblems, querySetProblems, sha256, shown, splitModuleBranchProblems, stateOf, tables, thresholdProblems,
} from './validate.mjs';

const rewrite = (files, from, to) => { assert.ok(files['README.md'].includes(from), `the example report holds ${from}`); files['README.md'] = files['README.md'].replace(from, to); };
/** A problem matching `pattern` is there, and the check's worst state is `state`. */
function fails(problems, pattern, state = 'FAIL') {
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
  assert.throws(() => holds('the check', problems), (error) => { assert.equal(error.code, 'ERR_ASSERTION'); assert.equal(stateOf(error.message), state, error.message); return true; });
}

// ------------------------------------------------------------------ the well-formed spike passes

test('validator: a well-formed spike passes every check', () => {
  for (const check of [pipelineTableProblems, splitModuleBranchProblems, indirectProblems, querySetProblems, thresholdProblems]) assert.deepEqual(run(check), [], check.name);
  // The record read from its file, as the acceptance tests read it.
  assert.deepEqual(run((_, dir) => { const { record, problems } = loadRecord(dir); return [...problems, ...pipelineTableProblems(record, dir)]; }), []);
  assert.doesNotThrow(() => holds('the check', []));
});

test('validator: a report\'s tables and numbers are read as written', () => {
  const [table] = tables('text\n| `A` | b ms |\n|---|:-:|\n| `x y` | 1,234.50 ms |\n\nmore');
  assert.deepEqual(table, { header: ['`A`', 'b ms'], rows: [['`x y`', '1,234.50 ms']] });
  assert.deepEqual(shown('1,234.50 ms'), { value: 1234.5, decimals: 2 });
  assert.deepEqual(shown('`\u22120.010`'), { value: -0.01, decimals: 3 });
  assert.equal(shown('12 or so'), null);
});

test('validator: with no spike, the record is BLOCKED, never a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3444-'));
  try { fails(loadRecord(dir).problems, /no spike record at docs\/spikes\/3444\/record\.json/, 'BLOCKED'); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ criterion 1

test('wrong program, criterion 1: a table that leaves a pipeline out fails, naming it', () => {
  const problems = run(pipelineTableProblems, (r, f) => { f['README.md'] = f['README.md'].split('\n').filter((line) => !line.startsWith('| `scene3d.shadow`')).join('\n'); });
  fails(problems, /the pipeline table leaves out scene3d\.shadow, a pipeline pipelines\.main \(out\/cold-main\.json\) shows the run making/);
});

test('validator: criterion 1\'s check fails a table its run doesn\'t give, and reads a run that isn\'t there as not passed', () => {
  // The run spent twice as long inside pipeline creation as the table's times account for.
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { for (const p of o.pipelines) p.around_ns *= 2; })), /main times sum to 756\.5 ms, not within 10% of the 1588\.65 ms/);
  fails(run(pipelineTableProblems, (r, f) => rewrite(f, '| `scene3d.cull` | 0.3 | 4.1 | 30.6 |', '| `scene3d.cull` | 0.3 | 4.1 | 3.6 |')), /main compile ms for scene3d\.cull is 3\.6; pipelines\.main \(out\/cold-main\.json\) gives 30\.6/);
  fails(run(pipelineTableProblems, (r, f) => rewrite(f, '| **sum** |', '| `scene3d.sky` | 1.0 | 1.0 | 1.0 | | | |\n| **sum** |')), /gives main times for scene3d\.sky, a pipeline .* doesn't show the run making/);
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { o.pipelines_made = 5; })), /pipelines_made .* is 5, and pipelines holds 4/);
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { o.open = 'same_process'; })), /open is "same_process", not "fresh"/);
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { o.pipelines[0].around_ns = 1000; })), /more than the 1000 ns around the call they are inside/);
  fails(run(pipelineTableProblems, (r, f) => { f['every-pass.json'] = '{"items":{}}'; r.pipelines.scene.sha256 = sha256(f['every-pass.json']); }), /is not #1903's every-pass scene/);
  fails(run(pipelineTableProblems, (r, f) => { f['out/cold-main.json'] += ' '; }), /the sha256 of out\/cold-main\.json is not what the record says/, 'BLOCKED');
  fails(run(pipelineTableProblems, (r, f) => { f['out/cold-main.json'] = null; }), /out\/cold-main\.json is not kept with the spike/, 'BLOCKED');
  fails(run(pipelineTableProblems, (r, f) => { f['README.md'] = null; }), /no report at docs\/spikes\/3444\/README\.md/, 'BLOCKED');
  fails(run(pipelineTableProblems, (r) => { r.main = 'f'.repeat(40); }), /BLOCKED: main f{40} is not a commit/);
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { o.adapter.backend = 'noop'; })), /ran with adapter\.backend "noop".*without a GPU the readings are BLOCKED/, 'BLOCKED');
  fails(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { o.machine = { ...o.machine, model: 'Mac14,2' }; })), /machine\.model "Mac14,2" is not a reference Mac/, 'INCONCLUSIVE');
  // Criterion 1 reads no frame, entry point or module of the run; criterion 2 does.
  const bare = (o) => { delete o.frames; for (const p of o.pipelines) for (const s of p.stages) { delete s.entry_point; delete s.module; delete s.module_entry_points; } };
  assert.deepEqual(run(pipelineTableProblems, (r, f) => edit(r, f, 'out/cold-main.json', bare)), []);
});

// ------------------------------------------------------------------ criterion 2

const HASH_30 = HASHES[30];
const DIFFERENT = '0000000000000000ffffffffffffffff';
const differs = (r, f) => { edit(r, f, 'out/cold-split.json', (o) => { o.frames[1].pixel_hash = DIFFERENT; }); rewrite(f, HASH_30, DIFFERENT); };

test('wrong program, criterion 2: a split-module column whose frame differs, taken as the result, fails', () => {
  fails(run(splitModuleBranchProblems, differs), /^frame 30 of the split-module branch has the pixel hash 0{16}f{16}, and main's has 91be04a77c1d3f5208aa6b3e4d9c0f17: a branch whose frame differs is a reading, never the result/);
});

test('validator: a split-module column whose frame differs, headed as a reading, is INCONCLUSIVE, never a pass', () => {
  const reading = (r, f) => { differs(r, f); f['README.md'] = f['README.md'].replaceAll('| split ', '| split (reading) '); };
  fails(run(splitModuleBranchProblems, reading), /^INCONCLUSIVE: frame 30 of the split-module branch .* the split-module column is a reading/, 'INCONCLUSIVE');
  // Headed as a reading with the same pixel hashes, the criterion still holds.
  assert.deepEqual(run(splitModuleBranchProblems, (r, f) => { f['README.md'] = f['README.md'].replaceAll('| split ', '| split (reading) '); }), []);
});

test('validator: criterion 2\'s check fails a branch that isn\'t the kept patch, isn\'t split, or isn\'t in the report', () => {
  const unsplit = (o) => { for (const s of o.pipelines[0].stages) if (s.entry_point) s.module_entry_points = SCENE_ENTRIES; };
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-split.json', unsplit)), /the scene module isn't split: scene3d\.geometry's vertex module still holds 3 entry points scene3d\.geometry doesn't use \(vs_shadow, fs_shadow, fs_sky\)/);
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { for (const p of o.pipelines) for (const s of p.stages) if (s.module) s.module = 'other'; })), /no stage of any pipeline is made from the scene module/, 'INVALID');
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-split.json', (o) => { o.patch = sha256('another patch'); })), /not split-module\.patch .*so the kept patch is not the branch that drew its frames/);
  fails(run(splitModuleBranchProblems, (r, f) => { f['split-module.patch'] += '\n'; }), /the sha256 of split-module\.patch is not what the record says/);
  const stale = PATCH.replace('new file mode 100644\n--- /dev/null', '--- a/crates/deep-scene3d-render/src/split_3444.wgsl').replace('@@ -0,0 +1 @@', '@@ -1 +1 @@\n-// the module, joined');
  fails(run(splitModuleBranchProblems, (r, f) => { f['split-module.patch'] = stale; r.pipelines.split.patch.sha256 = sha256(stale); edit(r, f, 'out/cold-split.json', (o) => { o.patch = sha256(stale); }); }), /split-module\.patch doesn't apply to main 390c3f390/);
  fails(run(splitModuleBranchProblems, (r, f) => { f['README.md'] = f['README.md'].replace(' | split override ms | split source ms | split compile ms |', ' |'); }), /the pipeline table has no split column/);
  fails(run(splitModuleBranchProblems, (r, f) => rewrite(f, `\`${HASH_30}\``, 'the same')), /the report doesn't give the split-module branch's pixel hash of frame 30/);
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-split.json', (o) => { o.frames.pop(); })), /pipelines\.split hashed frames 0, 30, and pipelines\.main frames 0, 30, 59/);
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-split.json', (o) => { for (const p of o.pipelines) p.around_ns *= 2; })), /split times sum to 302\.6 ms, not within 10%/);
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-split.json', (o) => { delete o.pipelines[1].stages[0].module_entry_points; })), /scene3d\.shadow's vertex stage: module_entry_points .* is missing/);
  fails(run(splitModuleBranchProblems, (r, f) => edit(r, f, 'out/cold-main.json', (o) => { delete o.frames; })), /pipelines\.main \(out\/cold-main\.json\): frames holds no frame/);
  fails(run(splitModuleBranchProblems, (r) => { delete r.pipelines.split; }), /pipelines\.split: the record cites no run/, 'BLOCKED');
});

// ------------------------------------------------------------------ criterion 3

test('wrong program, criterion 3: a side whose flag was not what its column says fails, naming the run', () => {
  const problems = run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-3-off.json', (o) => { o.instance_flags = 32; }));
  fails(problems, /^round 3's off run \(out\/indirect-3-off\.json\) read its instance's flags as 32: VALIDATION_INDIRECT_CALL was on, not what its column says$/);
  // And the other way: an on side whose instance had it off (a debug build's other flags don't count).
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-1-on.json', (o) => { o.instance_flags = 3; })), /^round 1's on run \(out\/indirect-1-on\.json\) .* VALIDATION_INDIRECT_CALL was off/);
});

test('validator: criterion 3\'s check fails readings that aren\'t five runs a side, alternated, on one Mac, of indirect draws', () => {
  fails(run(indirectProblems, (r) => { r.indirect.rounds.pop(); }), /indirect\.rounds holds 4 rounds, not five runs a side/);
  // Round 2 with its sides' times swapped runs its on side first, as round 1 did.
  const swap = (r, f) => { const [on, off] = ['on', 'off'].map((side) => JSON.parse(f[`out/indirect-2-${side}.json`])); edit(r, f, 'out/indirect-2-on.json', (o) => Object.assign(o, { started: off.started, ended: off.ended })); edit(r, f, 'out/indirect-2-off.json', (o) => Object.assign(o, { started: on.started, ended: on.ended })); };
  fails(run(indirectProblems, swap), /round 2 ran its on side first, as round 1 did: the rounds were not alternated/);
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-4-on.json', (o) => { o.started = at(1000 + 120 * 3 + 30); })), /round 4: its on run started before its off run ended/);
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-5-off.json', (o) => { o.machine = { ...o.machine, macosBuild: '26C1' }; })), /indirect\.rounds\[4\]\.off: ran on .*the readings are not from one Mac/);
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-2-on.json', (o) => { o.forest.indirect_draws = 0; })), /so the run read no indirect draw/);
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-2-on.json', (o) => { o.forest.instances = 1000; })), /forest\.instances is 1000, not the forest's 100,000/);
  fails(run(indirectProblems, (r, f) => edit(r, f, 'out/indirect-1-off.json', (o) => { delete o.instance_flags; })), /instance_flags .* is missing/);
  fails(run(indirectProblems, (r) => { r.indirect.rounds[1].off = r.indirect.rounds[0].off; }), /out\/indirect-1-off\.json is also indirect\.rounds\[0\]\.off's output/);
  fails(run(indirectProblems, (r) => { delete r.indirect; }), /indirect\.rounds holds 0 rounds/, 'BLOCKED');
});

// ------------------------------------------------------------------ criterion 4

test('wrong program, criterion 4: a one-more-than-32 run on the app\'s own device fails the lane', () => {
  const problems = run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.device.label = 'deep-gpu'; }));
  fails(problems, /^query_sets\.one_more: ran on the app's own device \(device\.label "deep-gpu".*a run on the app's own device fails the lane$/);
});

test('wrong program, criterion 4: a count that isn\'t the device\'s own fails, naming the state', () => {
  // A count from the instance's registry report, with no read of the device's own counters behind it.
  const problems = run(querySetProblems, (r, f) => edit(r, f, 'out/state-four-windows.json', (o) => { delete o.reads; o.registry = { query_sets: 9 }; }));
  fails(problems, /^query_sets\.states\.four_windows: the count isn't the device's own: out\/state-four-windows\.json holds no reads of the device's own counters/);
});

test('validator: criterion 4\'s check reads a state that wasn\'t read as BLOCKED, and fails a run that doesn\'t show what the device did', () => {
  fails(run(querySetProblems, (r) => { delete r.query_sets.states.export; }), /query_sets\.states\.export: the state wasn't read/, 'BLOCKED');
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/state-one-window.json', (o) => { for (const read of o.reads) read.hal = hal(0, 0); })), /query_sets\.states\.one_window: the state wasn't read: the device's counters count nothing/, 'BLOCKED');
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/state-four-windows.json', (o) => { o.views_3d = 3; })), /windows is 4 and views_3d 3, not four windows each showing a 3D view/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/state-export.json', (o) => { o.reads[0].at = at(2300); })), /is not inside the run .* so it wasn't taken in the state/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/state-export.json', (o) => { o.device.label = 'spike'; })), /read on a device labelled "spike", not on the app's device/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.outcome = 'created'; })), /reports created, and its attempt 33 shows lost/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.attempts[32] = { n: 33, error: 'refused', lost: false, query_sets: 33 }; o.outcome = 'refused'; })), /its attempt 33 was refused, and the device's own counter then read 33, not 32/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.attempts.pop(); })), /32 sets were tried: the one more than 32 was not/, 'BLOCKED');
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.attempts[19] = { n: 20, error: null, lost: true, query_sets: 19 }; })), /set 20 was lost before 32 were alive/, 'INCONCLUSIVE');
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { for (const a of o.attempts) a.query_sets += 4; })), /after set 1 the device's own counter read 5, not 1/);
  fails(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { for (const a of o.attempts) a.query_sets = 0; })), /the device's counters count nothing/, 'BLOCKED');
  // Each outcome a device can show is accepted as it shows it.
  assert.deepEqual(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.attempts[32] = { n: 33, error: null, lost: false, query_sets: 33 }; o.outcome = 'created'; })), []);
  assert.deepEqual(run(querySetProblems, (r, f) => edit(r, f, 'out/one-more.json', (o) => { o.attempts[32] = { n: 33, error: 'Unexpected', lost: false, query_sets: 32 }; o.outcome = 'refused'; })), []);
});

// ------------------------------------------------------------------ criterion 5

test('wrong program, criterion 5: a report that says a threshold wasn\'t passed when its own readings pass it fails', () => {
  const problems = run(thresholdProblems, (r, f) => rewrite(f, '| yes | #3501 |', '| no | #3501 |'));
  fails(problems, /^the report says no for `translation`, and its own readings pass the threshold: translation is more than a fifth of the time to the first settled frame \(756\.5 against 1500\)$/);
});

test('wrong program, criterion 5: a report that files no task for a threshold its readings pass fails', () => {
  const problems = run(thresholdProblems, (r) => { delete r.tasks.translation; });
  fails(problems, /^translation is more than a fifth of the time to the first settled frame, and no task is filed for it: the record has no tasks\.translation$/);
});

test('validator: criterion 5\'s check recomputes each threshold from the kept runs', () => {
  // A state that holds 17 live sets, in a report that still says 9 and no.
  const seventeen = run(thresholdProblems, (r, f) => edit(r, f, 'out/state-export.json', (o) => { o.reads[0].hal.query_sets = 17; }));
  fails(seventeen, /the report says no for `query sets`, and its own readings pass the threshold: a state holds more than 16 live sets \(17 against 16\)/);
  fails(seventeen, /a state holds more than 16 live sets, and no task is filed for it: the record has no tasks\.query_sets/);
  fails(seventeen, /`query sets` row gives its reading as "9"; the kept runs give 17/);
  // Validation that adds 0.3 ms to the geometry pass's GPU time in every round: more than 5% of it.
  const slower = (r, f) => { for (const n of [1, 2, 3, 4, 5]) edit(r, f, `out/indirect-${n}-on.json`, (o) => { o.geometry.gpu_ms += 0.2; }); };
  fails(run(thresholdProblems, slower), /the report says no for `validation gpu`, and its own readings pass the threshold: validation is more than 5% of the geometry pass on the forest \(0\.3 against 3\.3\)/);
  // The same readings, stated and with their task: nothing left to say.
  const stated = (r, f) => { slower(r, f); rewrite(f, '| validation gpu | 0.100 ms | 3.100 ms | no | |', '| validation gpu | 0.300 ms | 3.300 ms | yes | #3502 |'); r.tasks.validation = { issue: 3502, title: 'Indirect-call validation off where the cull pass guarantees its checks', criteria: ['- [ ] ...'] }; };
  assert.deepEqual(run(thresholdProblems, stated), []);
  fails(run(thresholdProblems, (r, f) => { stated(r, f); r.tasks.validation.issue = 3501; rewrite(f, '#3502', '#3501'); }), /two thresholds name one task/);
  fails(run(thresholdProblems, (r, f) => rewrite(f, '| no | |\n| validation gpu', '| yes | |\n| validation gpu')), /the report says yes for `validation encode`, and its own readings don't pass the threshold \(0\.01 against 0\.5\)/);
  fails(run(thresholdProblems, (r, f) => rewrite(f, '| translation | 756.5 ms |', '| translation | 700.0 ms |')), /`translation` row gives its reading as "700\.0 ms"; the kept runs give 756\.5/);
  fails(run(thresholdProblems, (r, f) => rewrite(f, '| yes | #3501 |', '| yes | filed |')), /`translation` row doesn't name its task #3501/);
  fails(run(thresholdProblems, (r) => { r.tasks.translation.issue = 3030; }), /tasks\.translation\.issue is not the number of an issue filed after #3444/);
  fails(run(thresholdProblems, (r) => { r.tasks.translation.criteria = []; }), /tasks\.translation\.criteria .* is missing/);
  fails(run(thresholdProblems, (r, f) => { f['README.md'] = f['README.md'].split('\n').filter((line) => !line.startsWith('| query sets')).join('\n'); }), /the threshold table has 0 `query sets` rows, not one/);
  fails(run(thresholdProblems, (r) => { delete r.query_sets.states.four_windows; }), /the query sets row can't be recomputed/, 'BLOCKED');
  fails(run(thresholdProblems, (r, f) => edit(r, f, 'out/state-export.json', (o) => { o.machine = { ...o.machine, model: 'Mac15,12', chip: 'Apple M3' }; })), /the readings are not from one Mac/);
  // Every run on one Mac that is no reference model: readings, and the statements they give are INCONCLUSIVE.
  const elsewhere = (r, f) => { for (const path of Object.keys(f).filter((p) => p.startsWith('out/'))) edit(r, f, path, (o) => { o.machine = { ...o.machine, model: 'Mac14,2' }; }); };
  fails(run(thresholdProblems, elsewhere), /query_sets\.states\.export: machine\.model "Mac14,2" is not a reference Mac/, 'INCONCLUSIVE');
});
