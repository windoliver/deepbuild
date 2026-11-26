// #3550.31d7907e: `load --report` over a fixture log prints the runnable threads by class and `outside`, adding up to
// 100.0%, the median load by what was held, and the commands under no grant with the most. A fixture is copied to
// `load.log` in the test's own table folder; the lines asserted are the ones section 6 states (README: The surface,
// and the fixtures). Each test takes under a second and spins nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { report, threadLines } from './helpers.mjs';

// threads.jsonl: 13 samples on 18 cores. 11 hold their threads; one failed and the thread listing of one failed, both
// above the cores. Of the 11, five are above the cores (samples 1, 3, 8, 10 and 11) and six are not.
const READ = 'threads read in 11 of 13 samples';
/** Shares, each within a tenth of its exact value, that add up to 100.0. */
function addUp(found, exact, what, out) {
  for (const { line, share } of found) assert.ok(Math.abs(share - exact(line)) < 0.1, `${what}: the share in "${line}" is ${share}%, not ${exact(line).toFixed(3)}% to one decimal\n${out}`);
  assert.equal(found.reduce((sum, { share }) => sum + Math.round(10 * share), 0), 1000, `${what} add up to 100.0\n${out}`);
}

test('#3550.31d7907e load --report over a fixture log prints the runnable threads by class and outside, each a mean over the samples above the cores whose threads were read, with shares that add up to 100.0', { timeout: 120_000 }, async (t) => {
  const { out, lines } = await report(t, 'threads.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), [READ], `the report goes on with "${READ}", over every sample\n${out}`);
  // Over the five read above the cores: build 14 + 12 + 10, test 6 + 9 + 5 + 8 + (3 + 4, two grants in one minute),
  // bay-pair 0 (its holder idled in the one minute it was held) and outside 20 + 22 + 18 + 25 + 15, each over 5.
  // timed held a grant only in a minute below the cores, and has no line. Over all 11 read it would be build 9.82;
  // with the sample whose listing failed counted as a zero, build 6.00.
  assert.deepEqual(found.runnable.map(({ name, mean }) => `runnable ${name} ${mean}`).sort(), ['runnable bay-pair 0.00', 'runnable build 7.20', 'runnable outside 20.00', 'runnable test 7.00'],
    `one line a class that held a grant in the samples above the cores whose threads were read and one for outside, each "runnable <name> <t>, <p>%" with its mean runnable threads to two decimals\n${out}`);
  // Shares of the 171 in all: 21.053%, 0%, 20.468% and 58.480%, which rounded each alone add up to 100.1.
  const total = { build: 36, 'bay-pair': 0, test: 35, outside: 100 };
  addUp(found.runnable, (line) => (100 * total[line.split(' ')[1]]) / 171, 'the shares of the runnable threads', out);
  assert.deepEqual(found.odd, [], `a line of these that isn't in section 6's form\n${out}`);
});

test('#3550.31d7907e load --report over a fixture log prints the median load by what was held in the minute, over every sample whose threads were read: one line a set of classes, the most minutes first', { timeout: 120_000 }, async (t) => {
  const { out, lines } = await report(t, 'threads.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), [READ], `the report goes on with "${READ}", over every sample\n${out}`);
  // The 11 read samples, above the cores or not, by the classes that held a grant in them. A median is the middle
  // load, or the mean of the middle two: 61 of 61, 72 and 16.75 (their mean is 49.92); 38.75 of 44.5 and 33.
  const rows = [
    ['build and test', 3, 'median load 61.00, cores busy 13.00, idle 5.00, under grants 4.50, runnable threads under grants 23.00, outside 19.00'],
    ['test', 2, 'median load 38.75, cores busy 10.75, idle 7.25, under grants 2.55, runnable threads under grants 6.50, outside 17.50'],
    ['nothing', 2, 'median load 7.25, cores busy 3.70, idle 14.30, under grants 0.00, runnable threads under grants 0.00, outside 2.50'],
    ['build', 2, 'median load 17.75, cores busy 12.80, idle 5.20, under grants 4.20, runnable threads under grants 28.00, outside 5.00'],
    ['timed', 1, 'median load 12.50, cores busy 15.40, idle 2.60, under grants 7.00, runnable threads under grants 2.00, outside 1.00'],
    ['build and bay-pair and test', 1, 'median load 70.25, cores busy 16.50, idle 1.50, under grants 7.75, runnable threads under grants 17.00, outside 18.00'],
  ];
  const minutes = ({ what, minutes: n, of }) => `held ${what}: ${n} of ${of} minutes`;
  const wanted = rows.map(([what, n]) => `held ${what}: ${n} of 11 minutes`);
  // What was held: the classes in the order build, bay-pair, test, timed, joined by " and ", or "nothing"; two test
  // grants in one minute are "test", and a test grant the table lists before a build grant is still "build and test".
  assert.deepEqual(found.held.map(minutes).sort(), [...wanted].sort(), `one line for each set of classes that held a grant in a minute, with its minutes of the 11 whose threads were read\n${out}`);
  for (const [what, , rest] of rows) {
    assert.equal(found.held.find((line) => line.what === what).rest, rest, `the "held ${what}" line: its median load, its mean cores busy and idle, its mean CPU under grants and its mean runnable threads under grants and outside, to two decimals\n${out}`);
  }
  // The most minutes first, and among equals in the order the log first holds them: test (sample 1), nothing (2) and
  // build (6) with two minutes each, timed (5) before the three classes together (8) with one.
  assert.deepEqual(found.held.map(minutes), wanted, `the lines come with the most minutes first, and among equals in the order the log first holds them\n${out}`);
  // Shares of the 11 minutes: 27.273%, 18.182% three times and 9.091% twice, which rounded each alone add up to 100.1.
  const share = Object.fromEntries(rows.map(([what, n]) => [what, (100 * n) / 11]));
  addUp(found.held, (line) => share[line.slice(5, line.indexOf(':'))], 'the shares of the minutes', out);
  assert.deepEqual(found.odd, [], `a line of these that isn't in section 6's form\n${out}`);
});

test('#3550.31d7907e load --report over a fixture log prints the five commands under no grant with the most runnable threads, each a mean over the samples above the cores whose threads were read', { timeout: 120_000 }, async (t) => {
  const { out, lines } = await report(t, 'threads.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), [READ], `the report goes on with "${READ}", over every sample\n${out}`);
  assert.equal(found.top.length, 1, `one line "top commands under no grant, mean runnable threads: <command> <t>, ..."\n${out}`);
  // What runTop named under no grant in the five samples read above the cores, over 5: rustc 9 + 10 + 11 + 2, node
  // 5 + 7 + 4 + 6 + 3, clang 4 + 3 + 6, swiftc 8, ld 2 + 5; cargo, 3 + 3, is the sixth. Under grants, rustc had 32
  // more, node 23 and deep-app 9; in the minutes not above the cores cargo had 15 and mdworker 4.
  const means = { rustc: 6.4, node: 5, clang: 2.6, swiftc: 1.6, ld: 1.4 };
  const named = found.top[0].commands;
  assert.deepEqual(named.map(({ command }) => command).sort(), Object.keys(means).sort(), `the five commands runTop named under no grant with the most runnable threads\n${out}`);
  for (const { command, mean } of named) assert.ok(Math.abs(mean - means[command]) < 0.005, `${command} had a mean of ${means[command]} runnable threads under no grant over the five samples, not ${mean}\n${out}`);
});

test('#3550.31d7907e load --report goes on with these lines after the ones it printed before, in section 6\'s order: the samples read, the runnable threads, the minutes held and, last, the commands', { timeout: 120_000 }, async (t) => {
  const { out, lines } = await report(t, 'threads.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), [READ], `the report goes on with "${READ}", over every sample\n${out}`);
  const kinds = lines.map((line, index) => (line === '' ? null : ['read', 'runnable', 'held', 'top'].find((kind) => found[kind].some((one) => one.index === index)) ?? 'before')).filter(Boolean);
  const order = kinds.filter((kind, index) => kind !== kinds[index - 1]);
  assert.deepEqual(order, ['before', 'read', 'runnable', 'held', 'top'], `the report's lines, by kind and in order: those of #3067 and #3240, then the samples read, the runnable threads, the minutes held and the commands\n${out}`);
  // What it printed before is still there: #3067's share of minutes above the cores (7 of 13) and #3240's GPU count.
  assert.match(out, /^\S+% of minutes above the cores \(7 of 13\)$/m, `the share of minutes above the cores\n${out}`);
  assert.match(out, /^GPU read in 12 of 13 samples, 0\.000 s in all$/m, `the GPU count\n${out}`);
});

test('#3550.31d7907e load --report over a log written before the threads were read says so and prints no more of these lines', { timeout: 120_000 }, async (t) => {
  // before.jsonl: three samples as the sampler wrote them before #3550, with no procs, threads, runnable, runTop or
  // threadsUnread: their threads weren't read.
  const { out, lines } = await report(t, 'before.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), ['threads read in 0 of 3 samples'], `the report says the threads were read in 0 of 3 samples\n${out}`);
  assert.deepEqual([...found.runnable, ...found.held, ...found.top, ...found.odd].map(({ line }) => line), [], `with no sample read it prints no more of these lines\n${out}`);
});
