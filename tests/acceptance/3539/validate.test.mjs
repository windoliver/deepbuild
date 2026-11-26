// This suite's own check of its validators (validate.mjs), not a criterion's test: a well-formed spike in the
// formats of README.md passes every check, and each planted wrong one fails the same check with a problem that names
// what its criterion names. The spike is example.mjs's, written into a temporary folder that stands for the checkout;
// its `main` is this checkout's HEAD, so the package's `simulate` it is held to is the one this checkout has
// committed. It passes on the base, where there is no spike.
// Run: node --test tests/acceptance/3539/validate.test.mjs   (needs git and this checkout's node_modules; builds nothing)
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { before, test } from 'node:test';
import { git, simulateAt, tempDir } from './base.mjs';
import { buildExample, neverStopsScript, reportText, tableScript, writeSpike } from './example.mjs';
import { heldFullScript } from './harness-run.mjs';
import {
  followUpProblems, heldFullProblems, holds, loadRecord, neverStopsProblems, ordersProblems, readNeverStops, rowsOf, sameUnderBothProblems, scenarioOf, sha256, SPIKE,
  stateOf, tableProblems, waitOf,
} from './validate.mjs';

const CHECKS = {
  today: (record, dir) => tableProblems(record, 'today', dir),
  changed: (record, dir) => tableProblems(record, 'person-first', dir),
  neverStops: neverStopsProblems,
  orders: ordersProblems,
  followUp: followUpProblems,
};
const NEVER = `${SPIKE}/scripts/never-stops.json`;

let simulate;
let example;
before(async () => {
  const main = git(['rev-parse', 'HEAD']).stdout.trim();
  simulate = await simulateAt(main);
  example = buildExample({ main, simulate });
});

/** The problems a check finds in a copy of the example spike that `change` altered, written to a temporary folder. */
async function on(check, change = () => {}) {
  const spike = structuredClone(example);
  change(spike);
  const dir = tempDir('spike');
  try {
    writeSpike(dir, spike);
    const { record, problems } = loadRecord(dir);
    assert.deepEqual(problems, []);
    return await check(record, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Rewrites one kept JSON file of a spike, and pins it again wherever the record cites it. */
function rekeep(spike, path, change) {
  const value = JSON.parse(spike.files[path]);
  spike.files[path] = `${JSON.stringify(change(value) ?? value, null, 2)}\n`;
  const pin = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.out === path || node.script === path) node.sha256 = sha256(spike.files[path]);
    Object.values(node).forEach(pin);
  };
  pin(spike.record);
}
/** A spike's report, altered; with no change, written again from its record. */
const rereport = (spike, change = () => reportText(spike.record)) => { spike.files['README.md'] = change(spike.files['README.md']); };
/** Fails unless one problem holds every part, in the state given. */
function names(problems, parts, state = 'FAIL') {
  const found = problems.find((p) => parts.every((part) => (part instanceof RegExp ? part.test(p) : p.includes(part))));
  assert.ok(found, `no problem holds ${parts.map(String).join(' and ')}:\n${problems.join('\n') || '(no problem)'}`);
  assert.equal(stateOf(found), state, found);
}
const run = (spike, others, pool) => spike.record.runs.find((r) => r.others === others && r.pool === pool);
const row = (spike, others, pool) => spike.record.table.find((r) => r.others === others && r.pool === pool);
const outOf = (spike, path) => JSON.parse(spike.files[path]);

test('validator: a well-formed spike passes every check, with a follow-up, with the paragraph instead, and with no place that differs', async () => {
  for (const [name, check] of Object.entries(CHECKS)) assert.deepEqual(await on(check), [], name);
  assert.deepEqual(await on(CHECKS.followUp, (s) => { delete s.record.followUp; s.record.stays = 'The order stays as it is: on these scripts the person\'s session gains less than the others lose.'; rereport(s); }), []);
  const same = (s) => {
    const starts = new Map(outOf(s, s.record.orders.package.out).places.map((p) => [`${p.session}/${p.check}`, p.started_at]));
    rekeep(s, s.record.orders.hub.out, (out) => { for (const p of out.places) p.started_at = starts.get(`${p.session}/${p.check}`); });
    s.record.orders.differs = [];
    rereport(s);
  };
  assert.deepEqual(await on(CHECKS.orders, same), []);
});

test('validator: the example shows what the planted wrong spikes need: the orders differ, a place never starts, a stop gets no verdict', () => {
  const places = (others, pool, order) => outOf(example, run(example, others, pool)[order].out).places;
  assert.notDeepEqual(places(3, 4, 'today'), places(3, 4, 'person-first'));
  assert.ok(example.record.table.some((r) => r.today.beside.wait.unstarted > 0 && r.today.beside.verdict.none > 0));
  assert.ok(example.record.table.some((r) => r['person-first'].beside.wait.p95 < r.today.beside.wait.p95));
  assert.ok(example.record.table.some((r) => r['person-first'].longest.wait > 0) && example.record.table.every((r) => r['person-first'].others.n > 0));
  assert.ok(outOf(example, example.record.neverStops.today.out).places.some((p) => waitOf(p) > 0));
  assert.equal(example.record.orders.differs.length, 2);
});

test('validator: criterion 1\'s check fails a table the kept runs don\'t give, a run that is missing or isn\'t the Scope\'s, and an output the package\'s simulate doesn\'t give', async () => {
  const today = CHECKS.today;
  names(await on(today, (s) => { row(s, 3, 4).today.beside.wait.p95 += 1000; }), ['table: 3 others, a pool of 4: today.beside.wait.p95 is', 'the kept run of the person\'s session beside the others gives']);
  names(await on(today, (s) => { row(s, 1, 2).today.alone.verdict.p50 += 1; }), ['table: 1 other, a pool of 2: today.alone.verdict.p50 is', 'alone gives']);
  names(await on(today, (s) => { row(s, 6, 9).today.beside.wait.unstarted += 1; }), ['today.beside.wait.unstarted is']);
  names(await on(today, (s) => { s.record.table = s.record.table.filter((r) => !(r.others === 6 && r.pool === 9)); }), ['table: 6 others, a pool of 9: no row with a reading under today'], 'BLOCKED');
  names(await on(today, (s) => { s.record.runs = s.record.runs.filter((r) => !(r.others === 6 && r.pool === 9)); }), ['runs holds no run of 6 other sessions on a pool of 9 slots'], 'BLOCKED');
  names(await on(today, (s) => { s.record.runs = s.record.runs.filter((r) => !(r.others === 0 && r.pool === 4)); }), ['runs holds no run of the person\'s session alone on a pool of 4 slots'], 'BLOCKED');
  names(await on(today, (s) => { delete run(s, 3, 4).today; }), ['the record cites no output: the script wasn\'t run under today'], 'BLOCKED');
  names(await on(today, (s) => { s.files[run(s, 3, 4).today.out] += ' '; }), ['sha256 of out/beside-3-pool-4.today.json is not what the record says'], 'BLOCKED');
  names(await on(today, (s) => { delete s.files[run(s, 1, 9).script]; }), ['scripts/beside-1-pool-9.json is not kept with the spike'], 'BLOCKED');
  names(await on(today, (s) => { s.record.main = 'f'.repeat(40); }), ['is not a commit this checkout\'s git has'], 'BLOCKED');
  // A kept output that isn't what the package's simulate gives for its script.
  let moved;
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).today.out, (out) => { moved = out.places.find((p) => p.session === 'person' && p.started_at !== null); moved.started_at += 60_000; moved.ended_at += 60_000; })),
    [`${moved.session}'s check ${moved.check} on snapshot ${moved.snapshot} has started_at`, 'the package\'s simulate at main gives']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).today.out, (out) => { out.places.pop(); })), ['holds no place for', 'which the package\'s simulate at main gives']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).today.out, (out) => { out.stops[0].verdict_at = out.stops[0].at; })), ['has verdict_at']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).today.out, (out) => { out.script_sha256 = run(s, 1, 4).sha256; })), ['the output is another script\'s']);
  // A script that isn't what the Scope asks.
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, () => tableScript(2, 4))), ['2 sessions whose turns nobody typed, not 3']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { for (const e of script.sessions[2].events) if (e.kind === 'prompt') e.origin = 'human'; })), ['2 sessions with every turn opened by a person']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[1].events[2].origin = 'human'; })), ['the turns of "other-1" are neither all a person\'s nor all ones nobody typed']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[1].checks[1].expected_ms = 120_000; })), ['session "other-1"\'s checks have expected times of [60000,120000,1200000] ms, not the three slow checks of 1, 5 and 20 minutes']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[2].checks[2].took_ms = 1000; })), ['session "other-2"\'s check "check-20m" takes 1000 ms, not its 1200000']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.config.slots = 5; })), ['config is {"slots":5}, not { "slots": 4 }']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.config.grace_ms = 1000; })), ['config is {"slots":4,"grace_ms":1000}, not { "slots": 4 }']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.foreign = [{ at: 0, ms: 1000, slots: 1 }]; })), ['foreign holds slots: the others are sessions of the script']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[3].checks[0].on_base = 'fails'; })), ['its checks are not all of one on_base']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[2].events = script.sessions[2].events.filter((e) => e.kind !== 'stop'); })), ['session "other-2" never stops']);
  names(await on(today, (s) => rekeep(s, run(s, 3, 4).script, (script) => { script.sessions[0].checks[0].runs = 3; })), ['runs is not a field a script\'s check holds']);
  names(await on(today, (s) => {
    rekeep(s, run(s, 0, 4).script, (script) => { script.sessions[0].events[1].at += 1000; });
    rekeep(s, run(s, 0, 4).today.out, (out) => { out.script_sha256 = run(s, 0, 4).sha256; });
  }), ['beside-3-pool-4.json: its person\'s session is not the session of', 'alone-pool-4.json']);
  // A report that doesn't show the table.
  names(await on(today, (s) => rereport(s, (text) => text.split('\n').filter((line) => !/^\| `today` \| 6 \| 9 \|/.test(line)).join('\n'))), ['the report\'s table has no row for today, 6 others, a pool of 9']);
  names(await on(today, (s) => rereport(s, (text) => text.replace(/^(\| `today` \| 3 \| 4 \| )[^|]+/m, (line, head) => `${head}1.5 `))), ['the report shows 1.5 s for "wait p50 alone s" of today, 3 others, a pool of 4']);
  names(await on(today, (s) => rereport(s, (text) => text.replaceAll('Verdict p95 beside s', 'Verdict max beside s'))), ['the report\'s table gives no "verdict p95 beside s" for today']);
  names(await on(today, (s) => rereport(s, () => 'No table.')), ['the report\'s table has no row for today, 1 other, a pool of 2']);
  names(await on(today, (s) => { s.files['README.md'] = null; }), [`no report at ${SPIKE}/README.md`], 'BLOCKED');
});

test('validator: criterion 2\'s check fails a changed-order table the kept runs don\'t give, one without the others\' waits or the longest wait, and an output that isn\'t the changed order\'s', async () => {
  const changed = CHECKS.changed;
  names(await on(changed, (s) => { row(s, 3, 4)['person-first'].beside.wait.p50 += 1000; }), ['table: 3 others, a pool of 4: person-first.beside.wait.p50 is']);
  names(await on(changed, (s) => { delete row(s, 3, 4)['person-first'].others; }), ['person-first.others (the other sessions\' waits) is missing']);
  names(await on(changed, (s) => { row(s, 3, 4)['person-first'].others.p95 -= 1000; }), ['person-first.others (the other sessions\' waits).p95 is']);
  names(await on(changed, (s) => { delete row(s, 6, 2)['person-first'].longest; }), ['person-first.longest (the longest wait of any place) is missing']);
  names(await on(changed, (s) => { row(s, 6, 2)['person-first'].longest.wait -= 1000; }), ['person-first.longest.wait is', 'the longest wait of any place in the kept run is']);
  names(await on(changed, (s) => { Object.assign(row(s, 6, 2)['person-first'].longest, { session: 'person', check: 'check-1m', snapshot: 'person-3' }); }), ['person-first.longest names person\'s check check-1m on snapshot person-3, which didn\'t wait']);
  names(await on(changed, (s) => { delete row(s, 1, 9)['person-first']; }), ['table: 1 other, a pool of 9: no row with a reading under person-first'], 'BLOCKED');
  names(await on(changed, (s) => { delete run(s, 6, 4)['person-first']; }), ['the script wasn\'t run under person-first'], 'BLOCKED');
  // Today's rows kept as the changed order's: the person's places aren't first.
  names(await on(changed, (s) => rekeep(s, run(s, 3, 4)['person-first'].out, () => ({ ...outOf(s, run(s, 3, 4).today.out), order: 'person-first' }))),
    ['runs: 3 other sessions on a pool of 4 slots, person-first (out/beside-3-pool-4.person-first.json):', 'has started_at', 'taking the places whose turn a person opened first and then as today, gives']);
  names(await on(changed, (s) => rereport(s, (text) => text.replaceAll('| Longest wait s ', '| Longest s '))), ['the report\'s table gives no "longest wait s" for person-first']);
  names(await on(changed, (s) => rereport(s, (text) => text.split('\n').filter((line) => !line.includes('`person-first`')).join('\n'))), ['the report\'s table has no row for person-first, 1 other, a pool of 2']);
});

test('validator: criterion 2\'s check fails a script in which the person\'s session stops, and outputs that report a gain there, naming the script', async () => {
  const never = CHECKS.neverStops;
  names(await on(never, (s) => { delete s.record.neverStops; }), ['neverStops (the script in which the person\'s session never stops'], 'BLOCKED');
  names(await on(never, (s) => rekeep(s, s.record.neverStops.script, (script) => { script.sessions[0].events.push({ at: 60_000, kind: 'stop', snapshot: 'person-1', changed: ['src/person.ts'] }); })), [`${NEVER}: the person's session "person" stops in it`]);
  names(await on(never, (s) => rekeep(s, s.record.neverStops.script, (script) => { script.sessions[1].events[0].origin = 'human'; })), [`${NEVER}: not one session whose every turn a person opened`]);
  names(await on(never, (s) => rekeep(s, s.record.neverStops.script, (script) => { script.sessions = script.sessions.slice(0, 1); })), [`${NEVER}: no other session stops in it`]);
  names(await on(never, (s) => { delete s.record.neverStops['person-first']; }), ['the script wasn\'t run under person-first'], 'BLOCKED');
  // Nothing waits: one other session on nine slots. Its outputs are what simulate gives, so only the check's own reach is at fault.
  const idle = { config: { slots: 9 }, sessions: neverStopsScript().sessions.slice(0, 2) };
  names(await on(never, (s) => {
    rekeep(s, s.record.neverStops.script, () => idle);
    for (const order of ['today', 'person-first']) rekeep(s, s.record.neverStops[order].out, () => ({ script_sha256: s.record.neverStops.sha256, order, ...rowsOf(simulate(scenarioOf(idle))) }));
  }), [`${NEVER}: no place waits for a slot in it`, 'the check can\'t fail'], 'INVALID');
  // The planted wrong record: a kept changed-order output in which a place that waited starts when it was queued.
  let gained;
  const gain = (out) => { gained = out.places.find((p) => waitOf(p) > 0); gained.ended_at -= waitOf(gained); gained.started_at = gained.queued_at; };
  const problems = await on(never, (s) => rekeep(s, s.record.neverStops['person-first'].out, gain));
  names(problems, [`script ${NEVER}, in which the person's session never stops: the harness reports a gain: ${gained.session}'s check ${gained.check} on snapshot ${gained.snapshot} waits 0 ms for a slot under person-first and`, 'under today\'s order']);
  names(problems, ['neverStops, person-first (out/never-stops.person-first.json)', 'has started_at', 'whose order the changed one is where no place\'s turn was a person\'s']);
  // The same check on outputs alone, as the planted twin's run is read.
  const script = neverStopsScript();
  const rows = rowsOf(simulate(scenarioOf(script)));
  assert.deepEqual(sameUnderBothProblems(NEVER, script, rows, structuredClone(rows)), []);
  const twin = structuredClone(rows);
  gain(twin);
  names(sameUnderBothProblems(NEVER, script, rows, twin), ['reports a gain', NEVER]);
  const sooner = structuredClone(rows);
  sooner.stops.find((stop) => stop.verdict_at !== null).verdict_at -= 1000;
  names(sameUnderBothProblems(NEVER, script, rows, sooner), [NEVER, 'the harness reports a gain: stop', 'verdict lands']);
  const later = structuredClone(rows);
  later.places.find((p) => p.started_at !== null).started_at += 1000;
  names(sameUnderBothProblems(NEVER, script, rows, later), [NEVER, 'doesn\'t read the same under both orders']);
  const fewer = structuredClone(rows);
  fewer.places.pop();
  names(sameUnderBothProblems(NEVER, script, rows, fewer), [NEVER, 'is in the today output and not in the person-first one']);
  const persons = structuredClone(rows);
  persons.places.push({ session: 'person', check: 'check-1m', snapshot: 'person-1', queued_at: 0, started_at: 0, ended_at: 60_000 });
  names(sameUnderBothProblems(NEVER, script, rows, persons), [NEVER, 'holds a place for the person\'s session']);
  // What the planted twin's test reads of the record before it runs the harness.
  const kept = await on((record, dir) => readNeverStops(record, dir).name);
  assert.equal(kept, NEVER);
});

test('validator: criterion 3\'s check passes the package\'s own reading of the pool held full and fails a harness that times a slow check from its start, naming the check', () => {
  const { script, held } = heldFullScript();
  const rows = rowsOf(simulate(scenarioOf(script)));
  assert.deepEqual(heldFullProblems(rows, held), []);
  // The script is what the README says: every check is queued at the green stop and none starts before the hold ends.
  assert.deepEqual(rows.places.map((p) => [p.check, p.queued_at, p.started_at >= held.heldUntil]), held.checks.map((id) => [id, held.stopAt, true]));
  const twin = { ...rows, places: rows.places.map((p) => ({ ...p, queued_at: p.started_at })) };
  const problems = heldFullProblems(twin, held);
  for (const id of held.checks) names(problems, ['the harness read a wait of 0 ms for', `person's check ${id} on snapshot person-1,`, 'it waited at least 3540000 ms']);
  const early = { ...rows, places: rows.places.map((p) => ({ ...p, started_at: p.queued_at, ended_at: p.queued_at + 1 })) };
  names(heldFullProblems(early, held), ['person\'s check check-5m on snapshot person-1 as started at 60000, while the test held every slot of the pool (until 3600000)']);
  names(heldFullProblems({ ...rows, places: rows.places.slice(1) }, held), ['the harness\'s output holds no place for person\'s check check-1m on snapshot person-1']);
  names(heldFullProblems({ ...rows, places: rows.places.map((p) => ({ ...p, started_at: null, ended_at: null })) }, held), ['the harness read no time of a start for person\'s check check-20m']);
  assert.throws(() => holds('criterion', heldFullProblems(twin, held)), /^AssertionError.*criterion: the harness read a wait of 0 ms/s);
});

test('validator: criterion 4\'s check fails a list that misses a place that starts at a different time or names one that doesn\'t, a hub output that leaves a place out, and a report that doesn\'t name each', async () => {
  const orders = CHECKS.orders;
  names(await on(orders, (s) => { delete s.record.orders; }), ['orders (the one script'], 'BLOCKED');
  names(await on(orders, (s) => { s.record.orders.differs = s.record.orders.differs.filter((d) => d.check !== 'b1'); }), ['orders.differs doesn\'t name b\'s check b1 on snapshot b-1, which starts at 301000 under the package\'s order and 601000 under the hub\'s']);
  names(await on(orders, (s) => { s.record.orders.differs.push({ session: 'a', check: 'a1', snapshot: 'a-1', package: 1000, hub: 1000 }); }), ['a\'s check a1 on snapshot a-1 doesn\'t start at a different time']);
  names(await on(orders, (s) => { s.record.orders.differs[0].hub += 1; }), ['orders.differs[0]: a\'s check a2 on snapshot a-1 has hub 301001; the hub\'s output gives 301000']);
  names(await on(orders, (s) => { delete s.record.orders.differs; }), ['orders.differs (every place that starts at a different time; an empty list says none) is missing']);
  names(await on(orders, (s) => rekeep(s, s.record.orders.hub.out, (out) => { out.places = out.places.filter((p) => p.check !== 'a2'); })), ['shows no start for a\'s check a2 on snapshot a-1']);
  names(await on(orders, (s) => rekeep(s, s.record.orders.hub.out, (out) => { out.places.push({ session: 'a', check: 'a3', snapshot: 'a-1', started_at: 5000 }); })), ['a\'s check a3 on snapshot a-1 is not a place of']);
  names(await on(orders, (s) => rekeep(s, s.record.orders.hub.out, (out) => { out.places[2].started_at = 500; })), ['b\'s check b1 on snapshot b-1 starts at 500, before its stop (2000)']);
  names(await on(orders, (s) => rekeep(s, s.record.orders.hub.out, (out) => { out.order = 'today'; })), ['order is "today", not "hub"']);
  names(await on(orders, (s) => { delete s.record.orders.hub; }), ['orders, the hub\'s order: the record cites no output: the script wasn\'t run under hub'], 'BLOCKED');
  names(await on(orders, (s) => rekeep(s, s.record.orders.package.out, (out) => { const p = out.places.find((x) => x.check === 'b1'); p.started_at += 60_000; p.ended_at += 60_000; })), ['orders, the package\'s order (out/orders.today.json): b\'s check b1 on snapshot b-1 has started_at 361000; the package\'s simulate at main gives 301000']);
  names(await on(orders, (s) => rereport(s, (text) => text.split('\n').filter((line) => !line.includes('`b1`')).join('\n'))), ['the report doesn\'t name b\'s check b1 on snapshot b-1']);
  names(await on(orders, (s) => rereport(s, (text) => text.replace('| 361 | 301 |', '| 361 | 300 |'))), ['the report shows 300 s for the hub\'s start of a\'s check a2 on snapshot a-1; the kept runs give 301']);
  names(await on(orders, (s) => rereport(s, (text) => text.replace('| `a` | `a2` | `a-1` |', '| `a` | `a1` | `a-1` | 1 | 2 |\n| `a` | `a2` | `a-1` |'))), ['the report names a\'s check a1 on snapshot a-1 as starting at a different time']);
  // One session alone on one slot per check: nothing waits, so no order could differ.
  const idle = { config: { slots: 4 }, sessions: [tableScript(0, 4).sessions[0]] };
  names(await on(orders, (s) => {
    rekeep(s, s.record.orders.script, () => idle);
    rekeep(s, s.record.orders.package.out, () => ({ script_sha256: s.record.orders.sha256, order: 'today', ...rowsOf(simulate(scenarioOf(idle))) }));
  }), ['no place waits for a slot in it under the package\'s order', 'the check can\'t fail'], 'INVALID');
});

test('validator: criterion 5\'s check fails neither, both, a follow-up with no criteria or an earlier number, one the report doesn\'t name, and two paragraphs', async () => {
  const followUp = CHECKS.followUp;
  const stays = 'The order stays as it is: on these scripts the person\'s session gains less than the others lose.';
  names(await on(followUp, (s) => { delete s.record.followUp; }), ['either followUp (the task filed) or stays', 'not both and not neither']);
  names(await on(followUp, (s) => { s.record.stays = stays; }), ['not both and not neither']);
  names(await on(followUp, (s) => { s.record.followUp.criteria = []; }), ['followUp.criteria (its own acceptance criteria) is missing']);
  names(await on(followUp, (s) => { s.record.followUp.issue = 3539; }), ['followUp.issue is not the number of an issue filed after #3539']);
  names(await on(followUp, (s) => { delete s.record.followUp.title; }), ['followUp.title is missing']);
  names(await on(followUp, (s) => rereport(s, (text) => text.replace('#3601', '#36010'))), ['the report doesn\'t name the follow-up #3601']);
  names(await on(followUp, (s) => { delete s.record.followUp; s.record.stays = `${stays}\n\nAnd a second paragraph.`; }), ['stays is more than one paragraph']);
  names(await on(followUp, (s) => { delete s.record.followUp; s.record.stays = stays; s.files['README.md'] = 'Another paragraph.'; }), ['the report doesn\'t hold the paragraph saying why the order stays as it is']);
  names(await on(followUp, (s) => { s.files['README.md'] = null; }), [`no report at ${SPIKE}/README.md`], 'BLOCKED');
});

test('validator: a missing record is BLOCKED, and the worst state among a check\'s problems stands', () => {
  const dir = tempDir('none');
  try {
    const { problems } = loadRecord(dir);
    names(problems, [`no spike record at ${SPIKE}/record.json`], 'BLOCKED');
    assert.throws(() => holds('criterion', problems), /^AssertionError.*BLOCKED: criterion: no spike record/s);
    assert.throws(() => holds('criterion', ['BLOCKED: one thing is missing', 'another is wrong']), /^AssertionError[^\n]*: criterion: another is wrong\nall 2 problems/s);
    assert.doesNotThrow(() => holds('criterion', []));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
