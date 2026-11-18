// #2698 AC4: "With the reader's call failing, the reading is missing and `hub-idle` reads INCONCLUSIVE, naming it. A
// planted reader that returns 0 fails, naming the field."
//
// The call is made to fail for real: the reader is asked for PID 1, a live process whose reading the kernel refuses
// to this user. Once directly, read beside planted/returns-zero.mjs, and judged by criteria.mjs's judgeAc4. And once
// inside the real task: `hub-idle` runs in a copy of this checkout whose benchmarks get, in place of the reader's
// startReading, one that asks the reader for PID 1 whatever it is asked for and hands its reading back under the PID
// asked for, and then one that is the planted reader (README: AC4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REFUSED, collectAc4, judgeAc4, refusal } from './criteria.mjs';
import { failsNaming, fixtures, needsBuild, plantedCheckout, planted, runTask, show } from './support.mjs';
import { IDLE_READINGS, IDLE_WORDS, INCONCLUSIVE, READER_MODULE, READER_START, idleLine, reader, realReader } from './surface.mjs';

const wrong = await reader(planted('returns-zero.mjs'), 'the planted reader that returns 0');
// One look at PID 1 for both tests. A base with no reader still takes it, for the planted reader alone.
let collected;
const readings = (t) => (collected ??= realReader().then((real) => [real, wrong], () => [wrong]).then((readers) => collectAc4(readers, (line) => t.diagnostic(line))));

test('#2698 AC4 with the reader\'s call failing, the reading is missing', { timeout: 300_000 }, async (t) => {
  const real = await realReader();
  judgeAc4(await readings(t), real.name);
});

test('#2698 AC4 a planted reader that returns 0 fails, naming the field', { timeout: 300_000 }, async (t) => {
  const data = await readings(t);
  t.diagnostic(await failsNaming(() => judgeAc4(data, wrong.name), /^AC4: total\.instructions, total\.cpuMs, total\.wakeups, total\.footprintBytes.*: the planted reader that returns 0 gives 0 where the kernel refused/, wrong.name));
});

/** `hub-idle`, the budget's own command, where every reading its benchmark asks the reader for is one the kernel refuses. */
async function refusedIdle(t, plant) {
  await realReader();
  const binaries = fixtures();
  needsBuild();
  t.diagnostic(`the kernel refuses PID ${REFUSED} to the suite's own probe: ${refusal()}`);
  const run = await runTask('hub-idle', { cwd: plantedCheckout((real) => plant(real, binaries.probe)), timeoutMs: 900_000 });
  t.diagnostic(show(run));
  return run;
}

/** The task's side of the criterion: no reading of the hub is a number, and the last line reads INCONCLUSIVE, naming each. */
function judgeRefusedIdle(run) {
  const line = idleLine(run.last);
  const zero = IDLE_READINGS.filter((name) => line.hub[name] === 0);
  if (zero.length) assert.fail(`AC4: hub.${zero.join(', hub.')}: hub-idle reports 0 where the kernel refused the reader's call: a reading that can't be taken is missing, never 0\n${show(run)}`);
  const numbers = IDLE_READINGS.filter((name) => line.hub[name] !== null);
  assert.deepEqual(numbers, [], `AC4: hub-idle reports a number for hub.${numbers.join(', hub.')} though every reading its benchmark asked ${READER_MODULE}'s ${READER_START} for was refused: it does not take them from the reader (README: Assumptions, A1)\n${show(run)}`);
  assert.equal(line.status, INCONCLUSIVE, `AC4: hub-idle's last line does not read ${INCONCLUSIVE} though none of the hub's readings could be taken\n${show(run)}`);
  for (const name of IDLE_READINGS) assert.match(line.reason, IDLE_WORDS[name], `AC4: hub-idle reads ${INCONCLUSIVE} without naming the missing ${name}: its reason is ${JSON.stringify(line.reason)}\n${show(run)}`);
}

/**
 * The reader's own function with its call made to fail: it is asked for the refused PID in place of the one the
 * task names, and its reading comes back with that process under the PID the task named, as the reader would give
 * it for a hub the kernel refused. What the reader gives at once stays at once, and a promise stays a promise.
 */
const refusedReader = (real) => `import { ${READER_START} as real } from '${real}';
const then = (value, next) => (typeof value?.then === 'function' ? value.then(next) : next(value));
export const ${READER_START} = (pid, ...rest) => then(real(${REFUSED}, ...rest), (handle) => Object.assign(Object.create(handle), {
  stop: (...given) => then(handle.stop(...given), (reading) => (Array.isArray(reading?.processes)
    ? Object.assign(Object.create(Object.getPrototypeOf(reading)), reading, { processes: reading.processes.filter((process) => process?.pid === ${REFUSED}).map((process) => ({ ...process, pid })) })
    : reading)),
}));`;

test('#2698 AC4 with the reader\'s call failing, hub-idle reads INCONCLUSIVE, naming the reading', { timeout: 1_200_000 }, async (t) => {
  judgeRefusedIdle(await refusedIdle(t, refusedReader));
});

test('#2698 AC4 hub-idle on a planted reader that returns 0 fails, naming the field', { timeout: 1_200_000 }, async (t) => {
  const run = await refusedIdle(t, (_real, probe) => `import { refused } from '${planted('returns-zero.mjs')}';\nexport const ${READER_START} = refused(${JSON.stringify(probe)});`);
  t.diagnostic(await failsNaming(() => judgeRefusedIdle(run), /^AC4: hub\.\w+.*: hub-idle reports 0 where the kernel refused the reader's call/, 'hub-idle on the planted reader that returns 0'));
});
