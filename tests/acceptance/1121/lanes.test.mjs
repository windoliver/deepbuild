// #1121 AC3: the Mac's cargo test writes `cargo test -- --list` per target into its evidence record, and a Linux run's
// record lists the tests absent by platform by comparison with it, the lane INCONCLUSIVE (platform), not PASS. The real
// runLanes on the real unit lane's cargo commands, with cargo stubbed for a fixture workspace (README: The surface).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ABSENT, dump, handOver, laneLine, laneState, laneTree, LONG, PRESENT, sandbox, strings, TARGETS, unitRecord } from './helpers.mjs';

const MAC = 'darwin-arm64', SPARK = 'linux-arm64';
// The fields every lane's record had before this issue (#1115); the reference list is something beside them.
const BASE_FIELDS = ['lane', 'state', 'host', 'platform', 'tree', 'tests'];

async function macRun(box, lanes) {
  const home = join(box.dir, 'mac-home');
  mkdirSync(home);
  const ran = await lanes.unit(MAC, home);
  return { ran, home, ...unitRecord(home, 'darwin', ran) };
}

test('#1121.95fa4a52 a Mac\'s cargo test writes each target\'s `cargo test -- --list` into its unit record, beside its tests', LONG, async (t) => {
  const box = sandbox(t);
  const lanes = laneTree(box);
  const mac = await macRun(box, lanes);
  assert.equal(laneState(mac.ran.stdout), 'PASS', `the Mac's run of a workspace whose every test passes isn't PASS\n${dump(mac.ran)}`);
  const beside = Object.fromEntries(Object.entries(mac.record).filter(([key]) => !BASE_FIELDS.includes(key)));
  const written = strings(beside).join('\n');
  for (const target of TARGETS) {
    assert.ok(written.includes(target.bin), `the Mac's unit record (${mac.path}) names no reference list for the target ${target.bin} (${target.crate} ${target.src}) beside its tests; beside them it holds ${JSON.stringify(beside)}`);
    for (const [name] of target.tests) assert.ok(written.includes(name), `the Mac's unit record (${mac.path}) lists no ${name} of ${target.bin} in its reference list; beside its tests it holds ${JSON.stringify(beside)}`);
  }
});

test('#1121.95fa4a52 a Linux run\'s unit record lists each test absent by platform against the Mac\'s list, and the lane is INCONCLUSIVE (platform), not PASS', LONG, async (t) => {
  const box = sandbox(t);
  const lanes = laneTree(box);
  const mac = await macRun(box, lanes);
  const home = join(box.dir, 'spark-home');
  mkdirSync(home);
  const ran = await lanes.unit(SPARK, home, handOver(box, mac.path, home));
  const line = laneLine(ran.stdout);
  assert.equal(laneState(ran.stdout), 'INCONCLUSIVE', `the Linux run's unit lane reads ${line ?? 'nothing'}, not INCONCLUSIVE (platform), though ${ABSENT.length} of the Mac's tests never ran\n${dump(ran)}`);
  assert.match(line, /^INCONCLUSIVE unit \(platform\)/, `the Linux run's lane isn't labelled (platform)\n${dump(ran)}`);
  assert.notEqual(ran.status, 0, `the Linux run exits 0 on an INCONCLUSIVE lane\n${dump(ran)}`);
  // The stub's Linux output never names an absent test, so a line naming one comes from the comparison.
  const lines = ran.stdout.split('\n');
  for (const name of ABSENT) assert.ok(lines.some((l) => l.includes(name)), `the Linux run's summary doesn't list ${name}, which the Mac's list holds and this run never ran\n${dump(ran)}`);
  for (const name of PRESENT) {
    const flagged = lines.find((l) => /^\s+(INCONCLUSIVE|BLOCKED|FAIL|INVALID)\b/.test(l) && l.includes(name));
    assert.ok(!flagged, `the Linux run lists ${name}, which ran and passed here, as unproven: ${flagged}`);
  }
  const spark = unitRecord(home, 'linux', ran);
  const passRows = new Set((spark.record.tests ?? []).filter(({ state }) => state === 'PASS'));
  const elsewhere = strings({ ...spark.record, tests: (spark.record.tests ?? []).filter((row) => !passRows.has(row)) }).join('\n');
  for (const name of ABSENT) assert.ok(elsewhere.includes(name), `the Linux run's unit record (${spark.path}) doesn't list ${name} as absent by platform: ${JSON.stringify(spark.record)}`);
  for (const name of PRESENT) {
    const row = (spark.record.tests ?? []).find(({ id }) => String(id).includes(name));
    assert.equal(row?.state, 'PASS', `the Linux run's unit record doesn't hold ${name}, which ran and passed here, as PASS: ${JSON.stringify(row)}`);
  }
  assert.equal(spark.record.state, 'INCONCLUSIVE', `the Linux run's unit record reads ${spark.record.state}, not INCONCLUSIVE: ${JSON.stringify(spark.record)}`);
});
