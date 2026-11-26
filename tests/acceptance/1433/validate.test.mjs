// This suite's own check (#1433), and the planted wrong records its criteria name. The validators record.test.mjs
// uses must pass a well-formed spike and read each wrong one as its criterion says, or those tests prove nothing.
// Each case alters the synthetic well-formed spike of fixture.mjs in a temporary folder and runs the same check the
// kept record takes. Nothing here reads the spike: every test passes on the merge base, where none exists.
// No test here carries a criterion's ID: the before lane holds a test that carries one to failing on the merge base.
// Tests named "validator:" are of no one criterion. Tests named "AC<n>" are the wrong records criterion n names.
// Run: node --test tests/acceptance/1433/validate.test.mjs
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { wellFormed, write } from './fixture.mjs';
import { ARMS, evaluate, gateProblems, GATES, gpuiFastProblems, judgeFive, lineOf, loadRecord, percentile, plantedProblems, recordProblems, SPIKE } from './validate.mjs';

const RAW = Object.fromEntries(ARMS.flatMap((arm) => GATES.arms[arm].map((gate) => [`${arm}.${gate}`, `raw/${arm}-${gate}.json`])));
/**
 * The well-formed spike after `mutate(record, files)` altered it, written to a temporary folder (`after(dir)` then
 * changes kept files behind the record's back), read back as a test reads the kept one, and given to `check`.
 */
function on(mutate, check, after = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v1433-'));
  try {
    const spike = wellFormed();
    mutate(spike.record, spike.files);
    write(dir, spike);
    after(join(dir, SPIKE));
    const { record, problems } = loadRecord(dir);
    assert.deepEqual(problems, []);
    return check(record, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const rejects = (problems, pattern) => assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const all = (raw, change) => raw.runs.forEach(change);
/** Makes a gate unrun, as a spike that never read it keeps it: no raw reading, and the record saying why. */
const unrun = (record, files, arm, gate, why) => { record.arms[arm].gates[gate] = { status: 'inconclusive', why }; files[RAW[`${arm}.${gate}`]] = null; };
/** A candidate whose handoff took 1.25 ms a frame, with the record saying so. */
const slowHandoff = (record, files) => {
  all(files[RAW['candidate.canvas-handoff']], (run) => { run.frame_ms = run.frame_ms.map(() => 1.25); });
  Object.assign(record.arms.candidate.gates['canvas-handoff'], { status: 'fail', reading: { frame_ms: [1.25, 1.25, 1.25, 1.25, 1.25] } });
};

test('validator: the well-formed spike passes every check, and each planted run fails its gate\'s own', () => {
  on(() => {}, (record, dir) => {
    assert.deepEqual(evaluate(record, dir).lines, { candidate: 'fallback', 'gpui-fast': 'fallback' });
    for (const gate of Object.keys(GATES.gates)) assert.deepEqual(gateProblems(gate, record, dir), { problems: [], notes: [] }, gate);
    assert.deepEqual(recordProblems(record, dir), []);
    assert.deepEqual(gpuiFastProblems(record, dir), []);
    const glyph = plantedProblems('retention-frames', record, dir), ledger = plantedProblems('still-ledger', record, dir);
    assert.deepEqual([glyph.problems, ledger.problems], [[], []]);
    assert.match(glyph.notes[0], /frame 2 \(step 2\) is not byte-equal with retention on and off: it differs in the view "row-7"/);
    assert.match(ledger.notes[0], /the ledger doesn't count every command buffer: at vsync 1 it counted 1 of 2/);
  });
});

test('validator: the design\'s rule for five runs, the nearest rank and an arm\'s line', () => {
  assert.equal(judgeFive([0.7, 0.8, 0.9, 0.8, 0.99], 1, true), 'pass');
  assert.equal(judgeFive([0.7, 0.8, 0.9, 0.8, 1], 1, true), 'inconclusive'); // exactly 1 ms is not under it
  assert.equal(judgeFive([4, 4, 4, 4, 4], 4, false), 'pass'); // within the budget
  assert.equal(judgeFive([1.2, 1.2, 1.2, 1.2, 1.2], 1, true), 'fail');
  assert.equal(judgeFive([1.04, 1.04, 1.04, 1.04, 1.04], 1, true), 'inconclusive'); // over, inside the 5% margin
  assert.equal(judgeFive([1.1, 1.2, 1.3, 1.2, 1.25], 1, true), 'inconclusive'); // over, inside the runs' own spread
  assert.equal(percentile([3, 1, 2, 4], 0.5), 2);
  assert.equal(percentile(Array.from({ length: 200 }, (_, i) => i + 1), 0.99), 198);
  const verdicts = (a, b, c) => ({ one: { status: a }, two: { status: b }, three: { status: c } });
  assert.equal(lineOf(verdicts('pass', 'pass', 'pass')), 'fallback');
  assert.equal(lineOf(verdicts('pass', 'inconclusive', 'inconclusive')), 'INCONCLUSIVE: two, three');
  assert.equal(lineOf(verdicts('inconclusive', 'fail', 'pass')), 'closed: two'); // a failed gate closes the question
});

// Each wrong reading, the gate it is a reading of, and what the gate's check makes of it.
const READINGS = [
  ['a 1.25 ms handoff', 'candidate.canvas-handoff', 'fail', /frame ms a run, on average \[1\.25,1\.25,1\.25,1\.25,1\.25\] against under 1: all five runs are over/, (raw) => all(raw, (run) => { run.frame_ms = run.frame_ms.map(() => 1.25); })],
  ['a handoff of exactly 1 ms in one run', 'candidate.canvas-handoff', 'inconclusive', /neither all within it nor all over/, (raw) => { raw.runs[2].frame_ms = raw.runs[2].frame_ms.map(() => 1); }],
  ['a status swatch one code value off', 'candidate.canvas-handoff', 'fail', /the colour check failed: the fail swatch read back as/, (raw) => { raw.swatches.find((s) => s.status === 'fail').read[0] += 1; }],
  ['no swatch for one status', 'candidate.canvas-handoff', 'inconclusive', /read back no swatch for the status stale/, (raw) => { raw.swatches = raw.swatches.filter((s) => s.status !== 'stale'); }],
  ['a slot that differs from the headless canvas', 'candidate.canvas-handoff', 'fail', /doesn't match the headless canvas/, (raw) => { raw.headless.pixel_hash = 'f'.repeat(64); }],
  ['an opaque fixture', 'candidate.canvas-handoff', 'inconclusive', /no translucent fixture was shown/, (raw) => { raw.slot.translucent_px = 0; }],
  ['a handoff at another size', 'candidate.canvas-handoff', 'inconclusive', /slot\.size_px is \[1512,982\], not 1936 × 1584/, (raw) => { raw.slot.size_px = [1512, 982]; }],
  ['299 frames a run', 'candidate.canvas-handoff', 'inconclusive', /at least 300 frames/, (raw) => all(raw, (run) => { run.frame_ms.pop(); })],
  ['four runs', 'candidate.canvas-handoff', 'inconclusive', /the reading holds 4 runs; a limit is judged on 5/, (raw) => { raw.runs.pop(); }],
  ['a reading on another reference Mac', 'candidate.canvas-handoff', 'inconclusive', /read off the reference MacBook Pro \(model "Mac15,12", chip "Apple M3", memoryBytes 17179869184; the issue runs on Mac17,10, Apple M5 Max, 68719476736 bytes\)/, (raw) => Object.assign(raw.machine, { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 })],
  ['a load at the core count', 'candidate.canvas-handoff', 'inconclusive', /is a reading, not a result: a one-minute load of 18 at a run's start or end is at or above the MacBook Pro's 18 cores/, (raw) => { raw.runs[3].load.end = 18; }],
  ['a reading on battery', 'candidate.canvas-handoff', 'inconclusive', /power is "battery", not "ac"/, (raw) => { raw.machine.power = 'battery'; }],
  ['a thermal state of fair', 'candidate.canvas-handoff', 'inconclusive', /thermalState is "fair", not "nominal"/, (raw) => { raw.machine.thermalState = 'fair'; }],
  ['a debug build', 'candidate.canvas-handoff', 'inconclusive', /only a release build is timed/, (raw) => { raw.profile = 'debug'; }],
  ['a run outside the resource lease', 'candidate.canvas-handoff', 'inconclusive', /not taken under the repo's resource lease/, (raw) => { raw.command = './harness --gate canvas-handoff'; }],
  ['a window AppKit never showed', 'candidate.canvas-handoff', 'inconclusive', /run 2's window was "covered", not shown/, (raw) => { raw.runs[1].window.state = 'covered'; }],
  ['a frame drawn while still', 'candidate.idle', 'fail', /frames \[0,0,1,0,0\]: the still window presented a frame; the gate is 0/, (raw) => { raw.runs[2].frames = 1; }],
  ['a frame drawn while still, under load', 'candidate.idle', 'fail', /the still window presented a frame/, (raw) => { raw.runs[2].frames = 1; raw.runs[0].load.start = 40; }],
  ['three wakeups a run', 'candidate.idle', 'fail', /wakeups \[3,3,3,3,3\] against at most 1: all five runs are over/, (raw) => all(raw, (run) => { run.wakeups = 3; })],
  ['a 5 s hold', 'candidate.idle', 'inconclusive', /holds the still window 60 s, as canvas-idle does/, (raw) => { raw.runs[0].seconds = 5; }],
  ['a 6 ms update at p99', 'candidate.list-transcript', 'fail', /update ms at p99 \[6,6,6,6,6\] against at most 4: all five runs are over/, (raw) => all(raw, (run) => { run.update_ms = run.update_ms.map((ms) => ms * 3); })],
  ['one 9 ms update in 200', 'candidate.list-transcript', 'pass', null, (raw) => all(raw, (run) => { run.update_ms = [...run.update_ms.slice(0, -1), 9]; })],
  ['a 1.2 s cold start', 'candidate.list-transcript', 'fail', /coldStartMs \[1200,1200,1200,1200,1200\] against under 1000/, (raw) => all(raw, (run) => { run.coldStartMs = 1200; })],
  ['idle CPU at 1.5%', 'gpui-fast.list-transcript', 'fail', /idleCpuPercent .* against under 1: all five/, (raw) => all(raw, (run) => { run.idleCpuPercent = 1.5; })],
  ['250 MB of memory', 'candidate.list-transcript', 'fail', /memoryBytes .* against under 200000000/, (raw) => all(raw, (run) => { run.memoryBytes = 250_000_000; })],
  ['a 70 MB app', 'candidate.list-transcript', 'fail', /appBytes .* against under 60000000/, (raw) => all(raw, (run) => { run.appBytes = 70_000_000; })],
  ['a 999-row list', 'candidate.list-transcript', 'inconclusive', /rows is 999, not the 1000-row list/, (raw) => { raw.rows = 999; }],
  ['no transcript streaming', 'candidate.list-transcript', 'inconclusive', /the chunks its transcript streamed/, (raw) => { raw.runs[4].streamed = 0; }],
  ['the candidate first in every pair', 'candidate.list-transcript', 'inconclusive', /not in alternating runs: which arm ran first doesn't alternate/, (raw) => all(raw, (run) => { run.started = new Date(Date.parse('2026-11-26T08:00:00Z') + run.pair * 1000).toISOString(); })],
  ['another transcript than the other arm\'s', 'gpui-fast.list-transcript', 'inconclusive', /didn't run the same list and transcript/, (raw) => { raw.transcript = 'e'.repeat(64); }],
  ['no run of the other arm to pair with', 'candidate.list-transcript', 'inconclusive', /not in paired alternating runs: the gpui-fast arm keeps no list-transcript reading/, (raw, record, files) => unrun(record, files, 'gpui-fast', 'list-transcript', 'not run')],
  ['no run of a closed arm to pair with', 'gpui-fast.list-transcript', 'pass', null, (raw, record, files) => { slowHandoff(record, files); unrun(record, files, 'candidate', 'list-transcript', 'not read: the candidate closed at the canvas handoff'); }],
  ['the list in the shape the app doesn\'t ship', 'gpui-fast.list-transcript', 'inconclusive', /shape is "own"; the app's list is read in the shape it ships in, which the list-shapes reading names as "shared"/, (raw) => { raw.shape = 'own'; }],
  ['a wrong commit with Kotoeri', 'candidate.text-input', 'fail', /typing with kotoeri, the person saw a wrong commit/, (raw) => { raw.methods.kotoeri.wrong_commit = true; }],
  ['dictation never tried', 'candidate.text-input', 'inconclusive', /methods\.dictation\.lost_composition is null/, (raw) => { delete raw.methods.dictation; }],
  ['typing no person did', 'candidate.text-input', 'inconclusive', /no person took it: taken_by is "agent"/, (raw) => { raw.taken_by = 'agent'; }],
  ['a node whose bounds differ', 'candidate.accessibility', 'fail', /aren't equal node for node: node 2 \(label "Needs you"\) differs in bounds/, (raw) => { raw.headless.tree.children[0].children[0].bounds[1] += 2; }],
  ['a headless dump one node short', 'candidate.accessibility', 'fail', /the headless dump ends at node 3/, (raw) => { raw.headless.tree.children.pop(); }],
  ['a tree read with VoiceOver off', 'candidate.accessibility', 'inconclusive', /wasn't read while VoiceOver was on/, (raw) => { raw.voiceover = false; }],
  ['a tree deep-live didn\'t read', 'candidate.accessibility', 'inconclusive', /command doesn't name deep-live/, (raw) => { raw.command = 'scripts/lease ./harness --dump-tree'; }],
  ['a window over the card', 'candidate.question-card', 'fail', /the card is covered by \["the candidate's window"\]/, (raw) => { raw.card.covered_by = ['the candidate\'s window']; }],
  ['a synthetic press told as hardware', 'candidate.question-card', 'fail', /1 of 3 presses were told wrong: a synthetic press was told as hardware/, (raw) => { raw.presses[1].told = 'hardware'; }],
  ['no hardware press', 'candidate.question-card', 'inconclusive', /no hardware press was sent/, (raw) => { raw.presses.shift(); }],
  ['a card built with another trusted_input.rs', 'candidate.question-card', 'inconclusive', /built_with is not crates\/deep-app\/src\/trusted_input\.rs as base/, (raw) => { raw.built_with.sha256 = 'a'.repeat(64); }],
  ['no status item', 'candidate.question-card', 'inconclusive', /the status item isn't shown/, (raw) => { raw.status_item.shown = false; }],
  ['a panel tree with one prop changed', 'candidate.panel', 'fail', /no panel-tree parity: line 1 is .*; the app's tree \(tests\/acceptance\/1425\/base-trees\/claude-code\.txt\) holds/, (raw) => { raw.tree = raw.tree.replace('.gap[Number(6.0)]', '.gap[Number(8.0)]'); }],
  ['an edited panel', 'candidate.panel', 'inconclusive', /panel is not crates\/deep-app\/panels\/claude-code\/main\.js as base/, (raw) => { raw.panel.sha256 = 'b'.repeat(64); }],
  ['an 8 ms panel update', 'candidate.panel', 'fail', /update ms at p99 \[8,8,8,8,8\] against at most 4/, (raw) => all(raw, (run) => { run.update_ms = run.update_ms.map((ms) => ms * 4); })],
  ['a frame that differs under retention', 'gpui-fast.retention-frames', 'fail', /frame 3 \(step 3\) is not byte-equal with retention on and off: it differs in the view "transcript"/, (raw) => { const frame = raw.runs[0].frames[2]; frame.sha256 = 'd'.repeat(64); frame.views.transcript = 'c'.repeat(64); }],
  ['a frame fewer with retention on', 'gpui-fast.retention-frames', 'fail', /the journey drew 2 frames with retention on and 3 with it off/, (raw) => { raw.runs[0].frames.pop(); }],
  ['retention on, with no view drawn again', 'gpui-fast.retention-frames', 'inconclusive', /drew no view again from its last frame, as a replica's render_frame does: it says nothing about retention/, (raw) => { for (const frame of raw.runs[0].frames) frame.reused = 0; }],
  ['retention off, with views drawn again', 'gpui-fast.retention-frames', 'inconclusive', /2 views were drawn again from their last frame, so retention wasn't off/, (raw) => { raw.runs[1].frames[1].reused = 2; }],
  ['retention off by another switch', 'gpui-fast.retention-frames', 'inconclusive', /not by GPUI_VIEW_RETENTION=0, the only switch in a shipped build/, (raw) => { raw.runs[1].switch = 'set_view_retention(false)'; }],
  ['another journey with retention off', 'gpui-fast.retention-frames', 'inconclusive', /the run with retention off didn't replay the recorded journey/, (raw) => { raw.runs[1].journey = '9'.repeat(64); }],
  ['frames taken through the replica', 'gpui-fast.retention-frames', 'inconclusive', /taken through the replica, not a real window: a reading through the replica reads INCONCLUSIVE/, (raw) => { raw.surface = 'replica'; }],
  ['a command buffer while still', 'gpui-fast.still-ledger', 'fail', /the still window did GPU work: 1 command buffers and 410000 ns of GPU time over 120 vsyncs/, (raw) => { raw.runs[0].vsyncs[90] = { still: true, committed: { main: 0, layers: 1 }, ledger: { committed: 1, gpu_ns: 410_000 } }; }],
  ['a ledger that misses a layer path\'s buffer', 'gpui-fast.still-ledger', 'fail', /the ledger doesn't count every command buffer: at vsync 5 it counted 1 of 2 \(1 from the main render, 1 from layer paths\)/, (raw) => { raw.runs[0].vsyncs[4].ledger.committed = 1; }],
  ['no layer path before the window went still', 'gpui-fast.still-ledger', 'inconclusive', /can't tell a ledger that counts every command buffer from one that counts only the main render/, (raw) => { for (const v of raw.runs[0].vsyncs.filter((each) => !each.still)) { v.committed.layers = 0; v.ledger.committed = 1; } }],
  ['no still vsync', 'gpui-fast.still-ledger', 'inconclusive', /no vsync of a still window was read/, (raw) => { raw.runs[0].vsyncs = raw.runs[0].vsyncs.filter((v) => !v.still); }],
  ['the own shape with one holder of state', 'gpui-fast.list-shapes', 'inconclusive', /the own shape \(rows that each hold what they draw\) with retention on has 1000 rows whose state 1 entities hold; the shape is 1000 rows and 1000/, (raw) => { raw.runs.find((r) => r.kind === 'list' && r.shape === 'own' && r.retention === 'on').state_entities = 1; }],
  ['no label reading at 3,000 live rows', 'gpui-fast.list-shapes', 'inconclusive', /no run for one label changing at 3000 live rows with retention off/, (raw) => { raw.runs = raw.runs.filter((r) => !(r.kind === 'label' && r.live_rows === 3000 && r.retention === 'off')); }],
  ['a label frame with no element count', 'gpui-fast.list-shapes', 'inconclusive', /one label changing at 1000 live rows with retention on: each frame gives rendered/, (raw) => { delete raw.runs.find((r) => r.kind === 'label' && r.live_rows === 1000 && r.retention === 'on').frames[3].elements; }],
  ['a list reading with retention off that drew views again', 'gpui-fast.list-shapes', 'inconclusive', /the list in the shared shape .* with retention off: 12 views were drawn again/, (raw) => { raw.runs.find((r) => r.kind === 'list' && r.shape === 'shared' && r.retention === 'off').reused = 12; }],
  ['a list reading at a load of 19', 'gpui-fast.list-shapes', 'inconclusive', /its update times and CPU are readings, not results: a one-minute load of 19/, (raw) => { raw.runs[0].load.start = 19; }],
  ['a list reading at a load just under the cores', 'gpui-fast.list-shapes', 'pass', null, (raw) => { raw.runs[0].load.start = 17.9; }],
];
test('validator: each gate\'s check reads a wrong reading as its criterion says', async (t) => {
  for (const [name, at, status, pattern, mutate] of READINGS) {
    await t.test(`${at}: ${name} reads ${status}`, () => {
      const [arm, gate] = at.split('.');
      const verdict = on((record, files) => mutate(files[RAW[at]], record, files), (record, dir) => evaluate(record, dir).gates[arm][gate]);
      assert.equal(verdict.status, status, verdict.why.join('\n'));
      if (pattern) rejects(verdict.why, pattern);
    });
  }
});

test('validator: a gate that isn\'t decided is INCONCLUSIVE, a person\'s gate nobody took is BLOCKED, and neither passes', () => {
  const honest = (record, files) => { unrun(record, files, 'candidate', 'accessibility', 'no person has walked the window yet'); unrun(record, files, 'candidate', 'panel', 'the shim isn\'t written'); record.lines.candidate = 'INCONCLUSIVE: accessibility, panel'; };
  rejects(on(honest, (record, dir) => gateProblems('accessibility', record, dir).problems), /^BLOCKED: candidate accessibility: no person has taken it \(a person walks the candidate's window with VoiceOver on while deep-live reads its tree\)$/);
  rejects(on(honest, (record, dir) => gateProblems('panel', record, dir).problems), /^INCONCLUSIVE: candidate panel: unrun: the shim isn't written$/);
  // The record itself is right, and still no pass: its arm ends INCONCLUSIVE.
  const record = on(honest, recordProblems);
  assert.equal(record.length, 1, record.join('\n'));
  assert.match(record[0], /^INCONCLUSIVE: the candidate arm ends "INCONCLUSIVE: accessibility, panel": accessibility \(no person has taken it .*\); panel \(unrun: the shim isn't written\)$/);
  rejects(on((record, files) => { Object.assign(files[RAW['candidate.idle']].machine, { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 }); Object.assign(record.arms.candidate.gates.idle, { status: 'inconclusive', why: 'read on the design\'s other MacBook Pro', machine: files[RAW['candidate.idle']].machine }); record.lines.candidate = 'INCONCLUSIVE: idle'; },
    (record, dir) => gateProblems('idle', record, dir).problems), /^INCONCLUSIVE: candidate idle: read off the reference MacBook Pro \(model "Mac15,7", chip "Apple M3 Pro", memoryBytes 38654705664; the issue runs on Mac17,10/);
});

test('validator: a failed gate is the spike\'s result: it holds when the record ends the arm closed with it, and the gates left unread hold with it', () => {
  const closed = (record, files) => { slowHandoff(record, files); unrun(record, files, 'candidate', 'text-input', 'not read: the candidate closed at the canvas handoff'); record.lines.candidate = 'closed: canvas-handoff'; };
  on(closed, (record, dir) => {
    assert.deepEqual(recordProblems(record, dir), []);
    const failed = gateProblems('canvas-handoff', record, dir), unread = gateProblems('text-input', record, dir);
    assert.deepEqual([failed.problems, unread.problems], [[], []]);
    assert.match(failed.notes[0], /^candidate canvas-handoff FAILED, a result of the spike: frame ms a run, on average .* The record ends the arm "closed: canvas-handoff"$/);
    assert.match(unread.notes[0], /^candidate text-input wasn't decided \(no person has taken it .*\): the candidate arm is closed: canvas-handoff, by a kept reading that fails it$/);
  });
  // A record that calls the failed gate a pass, or closes the arm with a gate that didn't fail, doesn't hold.
  rejects(on((record, files) => { slowHandoff(record, files); record.arms.candidate.gates['canvas-handoff'].status = 'pass'; }, (record, dir) => gateProblems('canvas-handoff', record, dir).problems), /candidate\.canvas-handoff: status is "pass", but its kept reading gives fail/);
  rejects(on((record, files) => { unrun(record, files, 'candidate', 'text-input', 'not read'); record.lines.candidate = 'closed: idle'; }, (record, dir) => gateProblems('text-input', record, dir).problems), /^BLOCKED: candidate text-input: no person has taken it/);
});

test('validator: the record is held to what is kept: its readings, its cited files, the gates fixed first and its folder', () => {
  rejects(on((record) => { record.arms.candidate.gates.idle.reading.wakeups = [0, 0, 0, 0, 0]; }, recordProblems), /candidate\.idle: reading is \{"frames":\[0,0,0,0,0\],"wakeups":\[0,0,0,0,0\]\}; its raw reading gives \{"frames":\[0,0,0,0,0\],"wakeups":\[0,1,0,0,1\]\}/);
  rejects(on((record) => { record.arms.candidate.gates.idle.load = 0.4; }, recordProblems), /candidate\.idle: load is 0\.4; its raw reading gives 1\.75/);
  rejects(on((record) => { record.arms['gpui-fast'].gates['still-ledger'].machine.model = 'Mac15,7'; }, recordProblems), /gpui-fast\.still-ledger: machine is .*"Mac15,7".*; its raw reading gives .*"Mac17,10"/);
  rejects(on(() => {}, recordProblems, (root) => appendFileSync(join(root, RAW['candidate.idle']), ' ')), /BLOCKED: candidate\.idle: sha256 of raw\/candidate-idle\.json is not what the record says/);
  rejects(on((record, files) => { files[RAW['candidate.panel']] = null; }, recordProblems), /BLOCKED: candidate\.panel: raw\/candidate-panel\.json is not kept with the spike/);
  rejects(on((record) => { record.arms.candidate.gates.idle.raw.file = '../1477/record.json'; }, recordProblems), /is not a path inside docs\/spikes\/1433\//);
  rejects(on((record, files) => { files['gates.json'] = files['gates.json'].replace('"frame_ms_under": 1,', '"frame_ms_under": 2,'); }, recordProblems), /docs\/spikes\/1433\/gates\.json is not tests\/acceptance\/1433\/gates\.json byte for byte: the gates are fixed before the first run/);
  // The sha256 of gates.json as drafted on 2026-11-24, for the Air: a reading stamped with it was read under other gates.
  rejects(on((record, files) => { files[RAW['candidate.idle']].gates = '2bdeff35b4c39b62f485761451cf497842dc0f5a77c663f40026e0559a1a3888'; }, recordProblems), /candidate\.idle: raw\/candidate-idle\.json wasn't read under the gates fixed before the first run \(gates is "2bdeff35b4c39b62f485761451cf497842dc0f5a77c663f40026e0559a1a3888", not the sha256 of gates\.json\)/);
  rejects(on((record, files) => { files[RAW['candidate.idle']].harness = '1'.repeat(64); }, recordProblems), /candidate\.idle: raw\/candidate-idle\.json was taken by another binary than the arm's harness/);
  rejects(on((record, files) => { files[RAW['candidate.idle']].gate = 'panel'; }, recordProblems), /candidate\.idle: raw\/candidate-idle\.json is a reading of "candidate" "panel"/);
  rejects(on(() => {}, recordProblems, (root) => writeFileSync(join(root, 'harness.rs'), 'fn main() {}\n')), /docs\/spikes\/1433\/harness\.rs is neither the record, the gates nor a file the record cites/);
  rejects(on((record) => { record.arms = { 'toolkit-b': record.arms.candidate, 'gpui-fast': record.arms['gpui-fast'] }; }, recordProblems), /arms are \["toolkit-b","gpui-fast"\], not \["candidate","gpui-fast"\]: the record calls the second toolkit the candidate/);
  rejects(on((record) => { delete record.arms.candidate.pin.mirror; }, recordProblems), /arms\.candidate\.pin names no pinned and mirrored revision/);
  rejects(on((record) => { record.note = 'added after the lines'; }, recordProblems), /the record doesn't end in lines, one line per arm/);
  rejects(on((record) => { record.arms.candidate.gates.startup = { status: 'pass' }; }, recordProblems), /candidate\.startup is not a gate fixed before the first run/);
  rejects(on((record) => { record.base = 'f'.repeat(40); }, recordProblems), /BLOCKED: base f{40} is not a commit this checkout's git has/);
});

test('validator: a planted run that doesn\'t fail its gate\'s check, or fails it without naming its view, proves nothing', () => {
  const planted = (gate) => (record, dir) => plantedProblems(gate, record, dir).problems;
  const asOwn = (gate) => (record, files) => { files[`raw/gpui-fast-${gate}.planted.json`] = { ...files[RAW[`gpui-fast.${gate}`]], harness: '2'.repeat(64), planted: 'nothing' }; };
  rejects(on(asOwn('retention-frames'), planted('retention-frames')), /the planted program doesn't fail the gate's check: its kept run reads pass/);
  rejects(on(asOwn('still-ledger'), planted('still-ledger')), /the planted program doesn't fail the gate's check: its kept run reads pass/);
  rejects(on((record) => { record.arms['gpui-fast'].gates['retention-frames'].planted.view = 'list'; }, planted('retention-frames')), /fails the planted run without naming the view the glyph page was retired under, "list": frame 2 \(step 2\) .* in the view "row-7"/);
  rejects(on((record) => { delete record.arms['gpui-fast'].gates['still-ledger'].planted; }, planted('still-ledger')), /gpui-fast\.still-ledger\.planted \(the planted program's kept run\) is missing/);
  rejects(on((record, files) => { files['raw/gpui-fast-still-ledger.planted.json'].harness = record.arms['gpui-fast'].harness.sha256; }, planted('still-ledger')), /is not a planted program's run: it names no planted program, or the arm's own harness/);
  // A planted run that counts every command buffer and fails by drawing while still is another wrong program.
  rejects(on((record, files) => { for (const v of files['raw/gpui-fast-still-ledger.planted.json'].runs[0].vsyncs) { v.committed = v.still ? { main: 1, layers: 0 } : { main: 1, layers: 1 }; v.ledger = { committed: v.still ? 1 : 2, gpu_ns: 410_000 }; } }, planted('still-ledger')), /fails for another reason than a ledger that counts only the main render/);
});

// ------------------------------------------------------------------ the wrong records the criteria name

test('AC8 rejects a planted wrong record: a gate left without its reading', () => {
  rejects(on((record) => { delete record.arms.candidate.gates.idle.reading; }, recordProblems), /^candidate\.idle: the record names no reading for the gate$/);
});

test('AC8 rejects a planted wrong record: a gate left without its machine', () => {
  rejects(on((record) => { delete record.arms['gpui-fast'].gates['list-transcript'].machine; }, recordProblems), /^gpui-fast\.list-transcript: the record names no machine for the gate$/);
});

test('AC8 rejects a planted wrong record: a gate left without its load', () => {
  rejects(on((record) => { delete record.arms.candidate.gates.panel.load; }, recordProblems), /^candidate\.panel: the record names no load for the gate$/);
});

test('AC8 rejects a planted wrong record: an arm that ends fallback with a gate unrun, which leaves it INCONCLUSIVE', () => {
  rejects(on((record, files) => unrun(record, files, 'candidate', 'accessibility', 'no person has walked the window yet'), recordProblems), /^lines\["candidate"\] is "fallback"; its gates give "INCONCLUSIVE: accessibility"$/);
  // The same gate called a pass with no reading behind it.
  rejects(on((record) => { record.arms.candidate.gates.accessibility = { status: 'pass' }; }, recordProblems), /^candidate\.accessibility: status is "pass", but its kept reading gives inconclusive: no person has taken it/);
});

test('AC8 rejects a planted wrong record: an arm that ends fallback with a gate failed, which closes it with that gate', () => {
  rejects(on(slowHandoff, recordProblems), /^lines\["candidate"\] is "fallback"; its gates give "closed: canvas-handoff"$/);
  rejects(on((record, files) => { slowHandoff(record, files); record.lines.candidate = 'closed: idle'; }, recordProblems), /^lines\["candidate"\] is "closed: idle"; its gates give "closed: canvas-handoff"$/);
});

test('AC9 rejects a planted wrong record: a gpui-fast arm that leaves out its version', () => {
  rejects(on((record) => { delete record.arms['gpui-fast'].version; }, gpuiFastProblems), /^arms\["gpui-fast"\]\.version is null: the arm's record names its version, 0\.1\.10$/);
  rejects(on((record) => { record.arms['gpui-fast'].copies['gpui-fast-apple'] = '3'.repeat(64); }, gpuiFastProblems), /copies\["gpui-fast-apple"\] is "3{64}", not the checksum Cargo\.lock pins for gpui-fast-apple 0\.1\.10/);
});

test('AC9 rejects a planted wrong record: a gpui-fast arm that leaves out a carried hunk', () => {
  let left;
  rejects(on((record) => { [left] = record.arms['gpui-fast'].carry.splice(100, 1); }, gpuiFastProblems), /^arms\["gpui-fast"\]\.carry leaves out 1 of the \d+ carried hunks, first vendor\/gpui-pre/);
  assert.match(left.file, /^vendor\/gpui-pre/);
  rejects(on((record) => { record.arms['gpui-fast'].carry.push({ file: 'vendor/gpui-pre/src/window.rs', line: 1, issue: 1433 }); }, gpuiFastProblems), /carry names 1 hunks the carry at base a1ef97760 doesn't hold, first vendor\/gpui-pre\/src\/window\.rs:1#1433/);
});

test('AC9 rejects a planted wrong record: a replica\'s reading taken as the window\'s, which reads INCONCLUSIVE', () => {
  const replica = (record, files) => { files[RAW['gpui-fast.still-ledger']].surface = 'replica'; };
  rejects(on(replica, gpuiFastProblems), /^gpui-fast\.still-ledger: its reading was taken through the replica, so it reads INCONCLUSIVE; the record says "pass"$/);
  rejects(on(replica, gpuiFastProblems), /^lines\["gpui-fast"\] is "fallback" with still-ledger read through the replica$/);
  rejects(on(replica, (record, dir) => gateProblems('still-ledger', record, dir).problems), /status is "pass", but its kept reading gives inconclusive: taken through the replica, not a real window/);
  // Read as INCONCLUSIVE by the record, it holds for this criterion, and the gate's own test still isn't a pass.
  const said = (record, files) => { replica(record, files); Object.assign(record.arms['gpui-fast'].gates['still-ledger'], { status: 'inconclusive', why: 'read through the replica' }); record.lines['gpui-fast'] = 'INCONCLUSIVE: still-ledger'; };
  assert.deepEqual(on(said, gpuiFastProblems), []);
  rejects(on(said, (record, dir) => gateProblems('still-ledger', record, dir).problems), /^INCONCLUSIVE: gpui-fast still-ledger: taken through the replica, not a real window/);
});

test('AC12 rejects a planted wrong record: a list reading with one state shape, which reads INCONCLUSIVE for the list', () => {
  const oneShape = (record, files) => { const raw = files[RAW['gpui-fast.list-shapes']]; raw.runs = raw.runs.filter((run) => run.shape !== 'own' || run.kind !== 'list'); };
  rejects(on(oneShape, (record, dir) => gateProblems('list-shapes', record, dir).problems), /^gpui-fast\.list-shapes: status is "pass", but its kept reading gives inconclusive: INCONCLUSIVE for the list: no run for the list in the own shape \(rows that each hold what they draw\) with retention on/);
  rejects(on(oneShape, recordProblems), /^lines\["gpui-fast"\] is "fallback"; its gates give "INCONCLUSIVE: list-shapes"$/);
});

test('AC12 rejects a planted wrong record: a list reading from a bench whose panels each own their state, which reads INCONCLUSIVE for the list', () => {
  const bench = (record, files) => { const raw = files[RAW['gpui-fast.list-shapes']]; raw.subject = 'panels'; for (const run of raw.runs.filter((each) => each.kind === 'list')) Object.assign(run, { shape: 'own', state_entities: 443, rows: 443 }); };
  rejects(on(bench, (record, dir) => gateProblems('list-shapes', record, dir).problems), /INCONCLUSIVE for the list: the reading's subject is "panels", not the list; a bench whose panels each own their state says nothing about a list fed by one model/);
  rejects(on(bench, recordProblems), /^lines\["gpui-fast"\] is "fallback"; its gates give "INCONCLUSIVE: list-shapes"$/);
});
