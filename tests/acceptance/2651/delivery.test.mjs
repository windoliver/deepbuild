// #2651 AC4 (#2651.bc5a8e8d): "With eight sandboxed packages whose grants reach `tool.before`, one hook's event is
// serialized once, counted by the test. Each package receives a value equal to what it receives on the merge base, and
// a package that changes a field of what it was handed changes nothing another receives. A planted host that hands
// every package one object they can all write fails, naming the field"
//   DEEP_2651_BASE=<built merge base> node --test tests/acceptance/2651/delivery.test.mjs     # a few minutes, macOS
// Each run is probe.mjs `deliver` in a process of its own, on one checkout's packages (README: AC4).
// - First test: eight sandboxed packages, record grant tool.before; one tool.before, appended to the record and read
//   back, handed to host.deliver once. Asserts: the event is serialized exactly once while deliver runs (JSON.stringify
//   called with the event itself, counted by the test; the failure names the count), and each package's value equals
//   the one the same package receives on the merge base (log_pos read as the event's own in each run).
// - Second test: the same eight, plus a writer and a reader, both release packages in the hub, where a package is
//   handed a value in the host's own process. The writer changes data.call of what it was handed. Asserts: no other
//   package received the writer's change, and the writer was handed the value unchanged; a failure names the field.
//   In the same test, that judgment must fail on the planted host `hands-one-writable-event` (openExtensionHost's
//   `plant` option), naming the field; a host with no such plant ignores the option and the test fails there.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AC, BASE, CHANGE, HERE, machine, sidesProblem, unbuilt } from './lib.mjs';

const MARK = 'changed-by-t2651/writer';
const PLANT = 'hands-one-writable-event';
const NEEDS = ['packages/record/dist/index.js', 'packages/asks/dist/index.js', 'packages/supervisor/dist/index.js', 'packages/extension-host/dist/index.js'];

/** probe.mjs deliver on `checkout`: its one JSON line. */
function deliver(checkout, input) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, 'probe.mjs'), 'deliver', checkout, JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr = (stderr + text).slice(-4000)));
    child.on('close', (code) => {
      try {
        if (code !== 0) throw Error(`exit ${code}`);
        done(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        fail(Error(`BLOCKED: the delivery probe on ${checkout} failed (${error.message}): ${stderr.slice(-2000)}`));
      }
    });
  });
}
/** Each package's values with log_pos read as the event's own position in that run. */
const normalized = (run) => Object.fromEntries(Object.entries(run.received).map(([id, values]) => [id, values.map((v) => {
  const value = v.handed ?? v;
  return { ...value, log_pos: value.log_pos === run.logPos ? '<the event\'s log_pos>' : value.log_pos };
})]));
/** The paths in `value` that hold `mark`. */
function holding(value, mark, at = '') {
  if (value === mark) return [at || '(the value)'];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => holding(v, mark, at ? `${at}.${k}` : k));
  return [];
}
/**
 * The isolation judgment: what each package other than the writer received, and what the writer was handed, must hold
 * none of the writer's change. Returns each problem, naming the package and the field.
 */
function judgeIsolation(run) {
  const problems = [];
  const writer = run.received['t2651/writer'];
  if (!writer?.length) return [`BLOCKED: the writer was handed no event`];
  for (const [id, values] of Object.entries(run.received)) {
    for (const v of values) {
      const seen = id === 't2651/writer' ? v.handed : v;
      for (const path of holding(seen, MARK)) problems.push(`${id} received ${path} = "${MARK}": t2651/writer changed field ${path} of what it was handed, and ${id === 't2651/writer' ? 'it was handed it already changed' : 'that change reached this package'}`);
    }
  }
  return problems;
}

describe(`${AC[4]} one hook's event is serialized once and handed to each package as a value no other package can change`, () => {
  it(`${AC[4]} eight sandboxed packages granted tool.before: the event is serialized once, and each receives the merge base's value`, { timeout: 900_000 }, async () => {
    const blocked = sidesProblem(NEEDS);
    if (blocked) assert.fail(blocked);
    const now = await deliver(CHANGE, { mode: 'count' });
    const then = await deliver(BASE, { mode: 'count' });
    console.log(`AC4 serializations of the event: change ${now.serialized}, merge base ${then.serialized}; places ${JSON.stringify(now.places)} (${machine()})`);
    assert.deepEqual(Object.values(now.places), Array(8).fill('sandbox'), `the eight packages did not all load in the sandbox: ${JSON.stringify(now.places)}`);
    for (const [id, values] of Object.entries(now.received)) assert.equal(values.length, 1, `${id} was handed ${values.length} events; one was delivered`);
    assert.equal(now.serialized, 1, `one hook's event was serialized ${now.serialized} times for eight sandboxed packages (the merge base: ${then.serialized}); once is required`);
    assert.deepEqual(normalized(now), normalized(then), 'a package received a value other than the one it receives on the merge base');
  });

  it(`${AC[4]} a package that changes a field of what it was handed changes nothing another package receives, and the planted host fails naming the field`, { timeout: 1_200_000 }, async () => {
    const blocked = unbuilt(CHANGE, NEEDS);
    if (blocked) assert.fail(blocked);
    const run = await deliver(CHANGE, { mode: 'isolation' });
    console.log(`AC4 isolation: places ${JSON.stringify(run.places)}; the writer's change took: ${JSON.stringify(run.received['t2651/writer']?.map((v) => v.took))}`);
    assert.equal(run.places['t2651/writer'], 'hub', `the writer did not load in the hub: ${JSON.stringify(run.places)}`);
    assert.equal(run.places['t2651/reader'], 'hub', `the reader did not load in the hub: ${JSON.stringify(run.places)}`);
    const problems = judgeIsolation(run);
    assert.deepEqual(problems, [], problems.join('\n'));
    // The criterion's wrong program, in the same test: the judgment must fail on it, naming the field.
    const planted = await deliver(CHANGE, { mode: 'isolation', plant: PLANT });
    const caught = judgeIsolation(planted);
    console.log(`AC4 the planted host ${PLANT}: ${caught.length ? caught.join('; ') : 'the judgment passed'}`);
    assert.ok(caught.some((p) => p.includes('field data.call')), `the planted host ${PLANT} (openExtensionHost's plant option) passed the isolation judgment: no package was named receiving the writer's change of data.call. A host with no such plant ignores the option, so this fails until the plant is added (README, Planted programs)`);
  });
});
