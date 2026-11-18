// AC1 to AC4 on the fixtures. Each criterion has a `collect`, which drives its fixture once with every reader it is
// given reading the same process over the same span, and a `judge`, the criterion's assertions on one reader's
// readings. The real reader and the planted one are judged by the same function on the same run, so the planted
// reader's failure is the assertions' doing and not a difference between two runs.
//
// A judge throws an assertion for a reading the criterion calls wrong, naming the reading. Only once the readings
// are right does it look at what the run could not show (load, compression, a host with no counter), and then it
// throws Unproven: a wrong reader is never excused by a precondition, and a right one never passes without it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { blocked, conditions, fixture, fixtures, inconclusive, mb, readingOf, sleep, startAll, stopAll, within } from './support.mjs';

const percent = (share) => `${(share * 100).toFixed(1)}%`;
const tidy = (value) => (Math.abs(value) >= 1000 ? Math.round(value) : Number(value.toPrecision(6)));
const range = (expected, share) => `${tidy(expected * (1 - share))} to ${tidy(expected * (1 + share))}`;
const entryOf = (reading, pid) => reading.processes.find((process) => process.pid === pid);

// ---- AC1: 100 wakeups within 10%, CPU time within 10%, instructions equal within 2% over five runs, under load.

export const AC1 = { runs: 5, wakes: 100, periodMs: 100, wakeups: 0.1, cpu: 0.1, instructions: 0.02 };

export async function collectAc1(readers, note = () => undefined) {
  const binaries = fixtures();
  // The spin is sized once, so all five runs do the same work.
  const { loops } = JSON.parse(execFileSync(binaries['spin-wake'], ['calibrate'], { encoding: 'utf8' }));
  const runs = [];
  for (let run = 1; run <= AC1.runs; run++) {
    const before = conditions();
    const spinner = fixture(binaries['spin-wake'], [loops, AC1.wakes, AC1.periodMs]);
    try {
      const { pid } = await spinner.next();
      const handles = await startAll(readers, pid);
      spinner.say('go');
      const done = await spinner.next(300_000);
      const readings = await stopAll(handles);
      runs.push({ run, pid, before, after: conditions(), done, readings });
      note(`run ${run}: load ${before.load.toFixed(1)} on ${before.cores} cores; the fixture woke ${done.wakes} times in ${(done.elapsedMs / 1000).toFixed(1)} s, used ${done.cpuMs} ms of CPU (${done.spinCpuMs} ms spinning) and the kernel counted ${JSON.stringify(done.kernel)}; read ${JSON.stringify(Object.fromEntries(Object.entries(readings).map(([name, { reading, error }]) => [name, error ? String(error.message).slice(0, 200) : entryOf(reading, pid)])))}`);
    } finally {
      await spinner.end();
    }
  }
  return { loops, runs };
}

export function judgeAc1({ runs }, name) {
  const counts = [], unproven = [];
  for (const { run, pid, done, readings } of runs) {
    const when = `AC1 run ${run} of ${runs.length}`;
    assert.equal(done.wakes, AC1.wakes, `${when}: the fixture woke ${done.wakes} times, not ${AC1.wakes}`);
    const { reading, shortestMs, longestMs } = readingOf(readings, name, when);
    const own = entryOf(reading, pid);
    assert.ok(own, `${when}: ${name} gives no reading of the fixture, PID ${pid}: it read ${reading.processes.map((process) => process.pid).join(', ') || 'no process'}`);
    assert.ok(reading.spanMs >= shortestMs - 5 && reading.spanMs <= longestMs + 5, `${when}: ${name} states a span of ${reading.spanMs} ms where the test's clock saw ${shortestMs.toFixed(0)} to ${longestMs.toFixed(0)} ms between startReading and stop`);

    // The wakeups come first: they are what the criterion's wrong program can't give.
    const kernelAgrees = within(done.kernel.interruptWakeups, AC1.wakes, AC1.wakeups);
    if (own.wakeups === null) assert.fail(`${when}: wakeups: ${name} gives none (missing) where the fixture woke from ${AC1.wakes} timed sleeps; expected ${AC1.wakes} within ${percent(AC1.wakeups)} (${range(AC1.wakes, AC1.wakeups)})`);
    if (!within(own.wakeups, AC1.wakes, AC1.wakeups)) {
      if (kernelAgrees) assert.fail(`${when}: wakeups: ${name} gives ${own.wakeups} where the fixture woke from ${AC1.wakes} timed sleeps; expected ${AC1.wakes} within ${percent(AC1.wakeups)} (${range(AC1.wakes, AC1.wakeups)})`);
      unproven.push(blocked(`${when}: this host's kernel itself counted ${done.kernel.interruptWakeups} wakeups for the fixture's ${AC1.wakes} timed sleeps, so no reader can give ${AC1.wakes} within ${percent(AC1.wakeups)} here`));
    }
    if (own.cpuMs === null || !within(own.cpuMs, done.cpuMs, AC1.cpu)) assert.fail(`${when}: CPU time: ${name} gives ${own.cpuMs === null ? 'none (missing)' : `${own.cpuMs} ms`} where the fixture used ${done.cpuMs} ms by its own clock; expected within ${percent(AC1.cpu)} (${range(done.cpuMs, AC1.cpu)} ms)`);
    if (own.instructions === null) {
      if (done.kernel.instructions > 0) assert.fail(`${when}: instructions: ${name} gives none (missing) where the kernel counted ${done.kernel.instructions} for the fixture`);
      unproven.push(blocked(`${when}: this host's kernel keeps no count of instructions retired`));
    } else counts.push(own.instructions);
  }
  if (counts.length === runs.length) {
    const spread = (values) => (Math.max(...values) - Math.min(...values)) / Math.min(...values);
    const kernel = spread(runs.map(({ done }) => done.kernel.instructions));
    if (spread(counts) > AC1.instructions) {
      if (kernel <= AC1.instructions) assert.fail(`AC1: instructions: ${name} gives ${counts.join(', ')} over the five runs, ${percent(spread(counts))} apart; expected equal within ${percent(AC1.instructions)}, as the kernel's own counts for the fixture were (${percent(kernel)} apart)`);
      unproven.push(inconclusive(`AC1: the kernel's own counts of the fixture's instructions were ${percent(kernel)} apart over the five runs (${runs.map(({ done }) => done.kernel.instructions).join(', ')}), so no reader's can be equal within ${percent(AC1.instructions)} on this run`));
    }
  }
  if (unproven.length) throw unproven[0];
  // The criterion is stated at a load above the core count: a run at a lower load is a reading, not its proof.
  const idle = runs.filter(({ before, after }) => !(before.load > before.cores && after.load > after.cores)).map(({ run, before, after }) => `run ${run}: ${before.load.toFixed(1)} at its start and ${after.load.toFixed(1)} at its end, on ${before.cores} cores`);
  if (idle.length) throw inconclusive(`AC1: ${name}'s readings are within the criterion's limits, but the load was not above the core count at the start and end of every run (${idle.join('; ')}), and the criterion is stated at a load above it`);
}

// ---- AC2: a footprint within 5% of 200 MB above its start, with half of it compressed by the machine.

export const AC2 = { bytes: 200_000_000, footprint: 0.05, half: [0.45, 0.55], waitMs: 180_000 };

export async function collectAc2(readers, note = () => undefined) {
  const binaries = fixtures();
  const holder = fixture(binaries.hold, [AC2.bytes]);
  try {
    const { pid } = await holder.next();
    // Its start: a reading before it holds anything.
    const first = await startAll(readers, pid);
    await sleep(300);
    const start = await stopAll(first);
    holder.say('hold');
    const share = (status) => status.compressedBytes / status.heldBytes;
    const half = (status) => share(status) >= AC2.half[0] && share(status) <= AC2.half[1];
    const began = performance.now();
    let status = await holder.next(120_000), told = began;
    // Only the machine compresses, and only when it wants memory back: the fixture can wait for it, not make it.
    while (!half(status) && performance.now() - began < AC2.waitMs) {
      status = await holder.next();
      if (performance.now() - told > 15_000) { told = performance.now(); note(`after ${((told - began) / 1000).toFixed(0)} s the machine has compressed ${mb(status.compressedBytes)} of the fixture's ${mb(status.heldBytes)}`); }
    }
    const waitedMs = performance.now() - began;
    const handles = await startAll(readers, pid);
    await sleep(300);
    const end = await stopAll(handles);
    // What the machine has compressed once the readers have read, to hold the readings between two looks.
    const after = await holder.fresh();
    note(`the fixture holds ${after.heldBytes} bytes; the machine had compressed ${mb(status.compressedBytes)} (${percent(share(status))}) before the readings and ${mb(after.compressedBytes)} (${percent(share(after))}) after them, ${(waitedMs / 1000).toFixed(0)} s after it wrote them; by the kernel the fixture's footprint is ${after.own.footprintBytes} and its resident memory ${after.own.residentBytes}`);
    return { pid, heldBytes: after.heldBytes, before: status, after, waitedMs, start, end };
  } finally {
    await holder.end();
  }
}

export function judgeAc2({ pid, heldBytes, before, after, waitedMs, start, end }, name) {
  const first = entryOf(readingOf(start, name, 'AC2, at its start').reading, pid), last = entryOf(readingOf(end, name, 'AC2, holding').reading, pid);
  assert.ok(first && last, `AC2: ${name} gives no reading of the fixture, PID ${pid}`);
  const limits = `expected within ${percent(AC2.footprint)} of the ${heldBytes} bytes the fixture holds (${range(heldBytes, AC2.footprint)} bytes)`;
  if (first.footprintBytes === null || last.footprintBytes === null) assert.fail(`AC2: footprint: ${name} gives none (missing): ${JSON.stringify(first.footprintBytes)} bytes at the fixture's start and ${JSON.stringify(last.footprintBytes)} bytes holding; ${limits}`);
  const above = last.footprintBytes - first.footprintBytes;
  if (!within(above, heldBytes, AC2.footprint)) assert.fail(`AC2: footprint: ${name} gives ${above} bytes above its start (${last.footprintBytes} bytes holding, ${first.footprintBytes} at its start), with ${after.compressedBytes} of the fixture's bytes compressed by the machine; ${limits}`);
  const share = (status) => status.compressedBytes / heldBytes;
  if (![before, after].every((status) => share(status) >= AC2.half[0] && share(status) <= AC2.half[1])) {
    throw inconclusive(`AC2: ${name}'s footprint is within the criterion's limit (${above} bytes above its start), but the machine did not compress half of the fixture's memory: ${mb(before.compressedBytes)} (${percent(share(before))}) before the readings and ${mb(after.compressedBytes)} (${percent(share(after))}) after, of ${mb(heldBytes)}, ${(waitedMs / 1000).toFixed(0)} s after the fixture wrote it; half is ${percent(AC2.half[0])} to ${percent(AC2.half[1])}. Only the machine compresses, when it is short of memory`);
  }
}

// ---- AC3: a kept child is read beside its parent and summed, and one that has ended is not counted twice.

/** The issue gives AC3 no limits of its own: these are AC1's and AC2's for the same readings. */
export const AC3 = { wakeups: 0.1, cpuMs: 0.1, instructions: 0.02, footprintBytes: 0.05 };

export async function collectAc3(readers, note = () => undefined) {
  const binaries = fixtures();
  const { loops } = JSON.parse(execFileSync(binaries['spin-wake'], ['calibrate'], { encoding: 'utf8' }));
  const family = fixture(binaries.family, [loops]);
  try {
    // All three processes are up, and idle, when the span starts; the one that ends does so inside it.
    const ready = await family.next();
    const handles = await startAll(readers, ready.pid);
    family.say('go');
    const done = await family.next(300_000);
    const readings = await stopAll(handles);
    note(`the fixture: ${JSON.stringify(done)}; read ${JSON.stringify(Object.fromEntries(Object.entries(readings).map(([name, { reading, error }]) => [name, error ? String(error.message).slice(0, 200) : reading])))}`);
    return { done, readings };
  } finally {
    await family.end();
  }
}

export function judgeAc3({ done, readings }, name) {
  const { parent, kept, ended } = done;
  const { reading } = readingOf(readings, name, 'AC3');
  const child = entryOf(reading, kept.pid);
  // The child comes first: it is what the criterion's wrong program leaves out.
  if (!child) assert.fail(`AC3: the kept child ${kept.pid} is not read beside its parent ${parent.pid}: ${name} read ${reading.processes.map((process) => process.pid).join(', ') || 'no process'}`);
  const unproven = [];
  const expected = { wakeups: 'wakes', cpuMs: 'cpuMs', instructions: 'instructions', footprintBytes: 'heldBytes' };
  const all = [parent, kept, ended];
  for (const [field, share] of Object.entries(AC3)) {
    // What the host's kernel doesn't count as the fixture does can't be held against a reader of the kernel's counts.
    const host = field === 'instructions' && !all.every((process) => process.instructions > 0) ? `this host's kernel keeps no count of instructions retired for the fixture`
      : field === 'wakeups' && !all.every((process) => within(process.kernelWakeups, process.wakes, share)) ? `this host's kernel itself counted ${all.map((process) => process.kernelWakeups).join(', ')} wakeups for the fixture's ${all.map((process) => process.wakes).join(', ')} timed sleeps`
        : null;
    const wrong = (message) => {
      if (!host) assert.fail(message);
      unproven.push(blocked(`AC3: ${host}, so its ${field} can't be judged here`));
    };
    const [mine, childs, gone] = all.map((process) => process[expected[field]]);
    const total = reading.total[field];
    // The footprint is what is held at the span's end, when the ended child holds nothing: counting it at all is counting it again.
    const most = field === 'footprintBytes' ? mine + childs : mine + childs + gone;
    if (child[field] === null || !within(child[field], childs, share)) wrong(`AC3: ${field}: ${name} gives ${JSON.stringify(child[field])} for the kept child ${kept.pid}, whose own is ${childs}; expected within ${percent(share)}`);
    else if (total === null) wrong(`AC3: ${field}: ${name} gives no sum (missing) of the parent ${parent.pid} and the kept child ${kept.pid}`);
    else if (total < (mine + childs) * (1 - share)) wrong(`AC3: ${field}: ${name}'s sum, ${total}, leaves out the kept child ${kept.pid}: the parent's ${mine} and the child's ${childs} are ${mine + childs}; expected no less than that within ${percent(share)}`);
    else if (total > most * (1 + share)) wrong(`AC3: ${field}: ${name}'s sum, ${total}, counts the child that ended, ${ended.pid}, more than once: the parent's ${mine} and the kept child's ${childs}${field === 'footprintBytes' ? `, with nothing held by a child that has ended (it held ${gone})` : ` and the ended child's ${gone} once`} are ${most}; expected no more than that within ${percent(share)}`);
  }
  if (unproven.length) throw unproven[0];
}

// ---- AC4: with the reader's call failing, the reading is missing, never 0.

/** A live process whose reading the kernel refuses to this user: launchd. */
export const REFUSED = 1;

/** The kernel's own words for refusing it, to the suite's probe; BLOCKED where it doesn't refuse. */
export function refusal() {
  const probed = spawnSync(fixtures().probe, [String(REFUSED)], { encoding: 'utf8' });
  if (probed.status === 0) throw blocked(`the kernel gives this user (uid ${process.getuid()}) PID ${REFUSED}'s reading, so no live process here is one whose reading fails: run as a user who is not root`);
  return probed.stderr.trim();
}

export async function collectAc4(readers, note = () => undefined) {
  const refused = refusal();
  const handles = await startAll(readers, REFUSED);
  await sleep(300);
  const readings = await stopAll(handles);
  note(`the kernel refuses PID ${REFUSED} to the suite's own probe: ${refused}; read ${JSON.stringify(Object.fromEntries(Object.entries(readings).map(([name, { reading, error }]) => [name, error ? String(error.message).slice(0, 200) : { total: reading.total, own: entryOf(reading, REFUSED) ?? null }])))}`);
  return { refused, readings };
}

export function judgeAc4({ refused, readings }, name) {
  const mine = readings[name];
  if (mine?.error && !/^(BLOCKED|INCONCLUSIVE)\b/.test(mine.error.message)) assert.fail(`AC4: ${name} threw where the kernel refused the reading of PID ${REFUSED} (${refused}), instead of giving a missing reading: ${mine.error.stack ?? mine.error}`);
  const { reading } = readingOf(readings, name, 'AC4');
  const own = entryOf(reading, REFUSED);
  const given = [...Object.entries(reading.total).map(([field, value]) => [`total.${field}`, value]), ...Object.entries(own ?? {}).filter(([field]) => field !== 'pid').map(([field, value]) => [`the process's ${field}`, value])];
  const zero = given.filter(([, value]) => value === 0).map(([field]) => field);
  if (zero.length) assert.fail(`AC4: ${zero.join(', ')}: ${name} gives 0 where the kernel refused the reading of PID ${REFUSED} (${refused}): a reading that can't be taken is missing, never 0`);
  const numbers = given.filter(([, value]) => value !== null);
  if (numbers.length) assert.fail(`AC4: ${numbers.map(([field, value]) => `${field} ${value}`).join(', ')}: ${name} gives a number where the kernel refused the reading of PID ${REFUSED} (${refused}): a reading that can't be taken is missing`);
}
