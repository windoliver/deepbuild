// #1121 AC1, AC2 and AC3 on the real workspace: they're proven only by a run on the Spark (Linux aarch64), so on any
// other machine each skips with a platform note, which lanes.mjs reads as INCONCLUSIVE (platform), never PASS.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { cargoBuild, CHECKOUT, dump, handOver, laneLine, laneState, LONG, NOT_SPARK, realUnit, run, sandbox, SPARK, unitRecord } from './helpers.mjs';

const onSpark = { ...LONG, skip: SPARK ? false : NOT_SPARK };

test('#1121.73d8f179 every crate of the workspace builds on the Spark: N of N, the issue\'s 27 of 27', onSpark, async (t) => {
  const box = sandbox(t);
  const meta = await run(box, ['cargo', 'metadata', '--no-deps', '--format-version', '1', '--locked'], { cwd: CHECKOUT });
  assert.equal(meta.status, 0, `cargo metadata failed\n${dump(meta)}`);
  const members = JSON.parse(meta.stdout).packages.map(({ name }) => name);
  const built = await cargoBuild(box, ['--workspace']);
  const done = new Set(built.artifacts.map(({ package_id: id, target }) => members.find((name) => id.includes(`/${name}#`) || id.includes(`#${name}@`) || id.startsWith(`${name} `)) ?? target?.name));
  const failed = members.filter((name) => !done.has(name));
  assert.ok(built.status === 0 && !failed.length, `${members.length - failed.length} of ${members.length} crates built on ${process.platform}-${process.arch}; not built: ${failed.join(', ')}\n${dump(built)}`);
});

// One real run of the unit lane's cargo test serves AC2 and AC3, with the Mac's record of the same commit handed over.
let spark;
function sparkRun(t) {
  spark ??= (async () => {
    const box = sandbox(t);
    const mac = process.env.T1121_MAC_RECORD;
    const extra = mac && existsSync(mac) ? handOver(box, mac, box.home) : {};
    const ran = await realUnit(box, extra);
    return { box, mac, ran, record: unitRecord(box.home, 'linux', ran) };
  })();
  return spark;
}

test('#1121.b915783e `cargo test` on the Spark has no FAIL or BLOCKED: not the lane, not any test', onSpark, async (t) => {
  const { ran, record } = await sparkRun(t);
  const state = laneState(ran.stdout);
  assert.ok(state && !['FAIL', 'BLOCKED', 'INVALID'].includes(state), `the Spark's unit lane reads ${laneLine(ran.stdout)}\n${dump(ran)}`);
  const bad = record.record.tests.filter(({ state: s }) => s === 'FAIL' || s === 'BLOCKED');
  assert.deepEqual(bad.map(({ id, state: s, note }) => `${s} ${id}${note ? `: ${note}` : ''}`), [], `the Spark's unit record (${record.path}) holds tests that failed or were blocked`);
});

test('#1121.95fa4a52 the Spark\'s real unit record lists the tests absent by platform against the Mac\'s, four whole test files among them, and reads INCONCLUSIVE (platform)', onSpark, async (t) => {
  const { ran, record, mac } = await sparkRun(t);
  assert.ok(mac && existsSync(mac), 'BLOCKED: set T1121_MAC_RECORD to the Mac\'s unit record (~/.deepbuild/lanes/<tree>-unit.json) of this same commit');
  assert.match(laneLine(ran.stdout) ?? '', /^INCONCLUSIVE unit \(platform\)/, `the Spark's unit lane isn't INCONCLUSIVE (platform)\n${dump(ran)}`);
  const reference = JSON.parse(readFileSync(mac, 'utf8'));
  const passedHere = new Set(record.record.tests.filter(({ state }) => state === 'PASS').map(({ id }) => id));
  const macCargo = reference.tests.filter(({ id, state }) => state === 'PASS' && String(id).startsWith('cargo '));
  const absent = macCargo.filter(({ id }) => !passedHere.has(id));
  const text = JSON.stringify({ ...record.record, tests: record.record.tests.filter(({ state }) => state !== 'PASS') });
  const unlisted = absent.filter(({ id }) => !text.includes(String(id).split(' › ').at(-1)));
  assert.deepEqual(unlisted.map(({ id }) => id), [], `the Spark's unit record (${record.path}) doesn't list these Mac tests it never ran`);
  // A whole test file absent: a target the Mac ran tests of, none of which passed here.
  const target = (id) => String(id).split(' › ')[0];
  const whole = [...new Set(absent.map(({ id }) => target(id)))].filter((name) => macCargo.filter(({ id }) => target(id) === name).every(({ id }) => !passedHere.has(id)));
  assert.equal(whole.length, 4, `the Spark lacks ${whole.length} whole test files, not the issue's four: ${whole.join(', ')}`);
  assert.ok(absent.length > macCargo.filter(({ id }) => whole.includes(target(id))).length, 'no cfg-gated single test is absent beside the whole files');
});
