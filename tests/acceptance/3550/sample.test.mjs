// #3550.20462570, #3550.106a37e8 and #3550.712a690c: one sample of `node scripts/throttle.mjs load`, read from
// `load.log` in the table's folder, against two references of the test's own: its own thread listings of the stubs it
// started, before and after the sample, and the one thread listing `load` itself was given, kept by a ps the test puts
// first on its PATH (README: The surface). The tests of this file run one after another: each spins threads, for a
// few seconds. Criteria 1 and 6 read one sample, taken once.
import assert from 'node:assert/strict';
import { cpus, loadavg, userInfo } from 'node:os';
import test, { after } from 'node:test';
import { ARGUMENT, CLASSES, SECRET, begun, dump, firstSample, hold, logText, loose, psCalls, psListings, psStub, redact, runnable, running, sandbox, span, split, tableLog, threadsOf, tree, warm } from './helpers.mjs';

const KEYS = ['procs', 'threads', 'runnable'];
// The thread listing section 6 names.
const LISTING = 'ps -A -M -o pid=,state=';
const mac = (t) => process.platform === 'darwin' || (t.skip('INCONCLUSIVE: the threads are read on macOS only, and this criterion runs on the Mac'), false);
const three = (entry) => Object.fromEntries(KEYS.map((key) => [key, entry[key]]));
const sum = (list) => list.reduce((total, item) => total + item.runnable, 0);
const read = ({ lo, hi }) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);
/** `entry` holds its processes, their threads and those runnable, as whole numbers that can be one listing's. */
const counted = (entry, what, context) => {
  for (const key of KEYS) assert.ok(Number.isInteger(entry?.[key]) && entry[key] >= 0, `${what} holds no whole number ${key} (${JSON.stringify(entry?.[key])}): a sample that didn't fail gives it its processes, their threads and those runnable\n${context}`);
  assert.ok(entry.runnable <= entry.threads && (entry.procs <= entry.threads), `${what} counts more runnable threads than threads, or more processes than threads: ${JSON.stringify(three(entry))}\n${context}`);
};
const near = (value, { lo, hi }, what, where, context) => assert.ok(value >= lo - 1 && value <= hi + 1,
  `${what} is ${value}; the test's own thread listing read ${read({ lo, hi })} runnable threads ${where} around the sample, so it must be within 1 of that\n${context}`);
/** The stubs didn't keep their threads runnable in the test's own listings: nothing to hold a sample to. */
const inconclusive = (t, spans) => {
  const short = Object.entries(spans).filter(([, { lo, want }]) => lo < want - 1);
  if (!short.length) return false;
  t.skip(`INCONCLUSIVE: the test's own listings (1-minute load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores) read ${short.map(([name, { lo, want }]) => `${name} at ${lo} runnable threads of the ${want} it spins`).join(' and ')}; a stub ends by itself 45 s after its start; run again`);
  return true;
};
/** The one thread listing `load` was given for its first sample, by process: it names each of `pids`, the stubs'. */
function given(calls, listings, pids, context) {
  assert.equal(calls.length, 1, `for its first sample load asked the ps on its PATH for ${calls.length} thread listings (${JSON.stringify(calls)}); section 6 has it make one, ${LISTING}, by name from the PATH\n${context}`);
  const threads = threadsOf(listings[0]);
  assert.ok(pids.every((pid) => threads.has(pid)), `the listing load asked for (ps ${calls[0]}) doesn't read as section 6's, ${LISTING}, a line a thread, ending with its process's pid and the thread's state: it names no thread of the stubs' processes ${pids.filter((pid) => !threads.has(pid)).join(', ')}\n${context}`);
  return threads;
}
/** runTop as section 6 states it: five at most, none at 0, one entry for a name under one grant or under none. */
function listed(sample, ids, context) {
  const { runTop } = sample;
  assert.ok(Array.isArray(runTop) && runTop.length <= 5, `runTop lists the commands with the most runnable threads, five at most: ${JSON.stringify(runTop)}\n${context}`);
  for (const item of runTop) {
    assert.ok(typeof item?.command === 'string' && item.command.length > 0 && Number.isInteger(item.runnable) && item.runnable >= 1, `a runTop entry holds a command and its runnable threads, none at 0: ${JSON.stringify(item)}\n${context}`);
    assert.ok(item.grant === undefined || ids.includes(item.grant), `a runTop entry's grant is the ID it was counted under, when it has one: ${JSON.stringify(item)}\n${context}`);
  }
  const keys = runTop.map((item) => `${item.command} ${item.grant ?? ''}`);
  assert.equal(new Set(keys).size, keys.length, `runTop has one entry for a name under one grant, or under none: ${JSON.stringify(runTop)}\n${context}`);
  for (const grant of sample.grants) assert.ok(sum(runTop.filter((item) => item.grant === grant.id)) <= grant.runnable, `runTop's entries under the grant ${grant.id} hold more runnable threads than the grant's ${grant.runnable}: ${JSON.stringify(runTop)}\n${context}`);
  assert.ok(sum(runTop.filter((item) => item.grant === undefined)) <= sample.outside.runnable, `runTop's entries under no grant hold more runnable threads than outside's ${sample.outside.runnable}: ${JSON.stringify(runTop)}\n${context}`);
  return { runTop, least: runTop.length === 5 ? Math.min(...runTop.map((item) => item.runnable)) : 0 };
}
/** Each name's runnable threads among `pids`, by the listing `load` was given and the names the test's ps printed. */
function byName(threads, procs, pids) {
  const names = new Map();
  for (const pid of pids) names.set(procs.get(pid)?.command, (names.get(procs.get(pid)?.command) ?? 0) + (threads.get(pid)?.runnable ?? 0));
  return names;
}
/** runTop holds each of `names` under the grant `id` with its count, or five entries that each have as many. */
function holds({ runTop, least }, names, id, context) {
  for (const [command, count] of names) {
    const item = runTop.find((entry) => entry.command === command && entry.grant === id);
    if (item) assert.equal(item.runnable, count, `runTop's ${command} under the grant ${id} isn't the ${count} runnable threads the listing load was given shows for the processes of that name under it\n${context}`);
    else assert.ok(count === 0 || (runTop.length === 5 && least >= count), `runTop leaves out ${command} under the grant ${id}, whose ${count} runnable threads are more than its least entry's: ${JSON.stringify(runTop)}\n${context}`);
  }
  for (const item of runTop.filter((entry) => entry.grant === id)) assert.ok(names.has(item.command), `runTop names ${item.command} under the grant ${id}, which holds no process of that name\n${context}`);
}

const boxes = [];
after(() => {
  for (const box of boxes) box.close();
});
let pair;
/**
 * One sample beside a `test` stub grant whose child spins 8 threads and an ungranted process spinning 4, each started
 * with a marked argument, a marked environment value and a script under the sandbox's HOME. Taken once, for criteria
 * 1 and 6; the stubs are stopped as soon as it is in the log.
 */
const taken = () => (pair ??= (async () => {
  const box = sandbox();
  boxes.push(box);
  try {
    const path = psStub(box, 'record');
    const granted = hold(box, 'granted', 8);
    const free = loose(box, 'free', 4);
    const child = await begun(box, granted, 'test');
    await begun(box, free);
    const before = await warm([{ pid: granted.pid, threads: 8 }, { pid: free.pid, threads: 4 }], 20_000);
    const { sample, readings, run } = await firstSample(box, before, path);
    // What the sampler left of the test's stubs and of the table, read before the test stops them.
    const left = { granted: running(granted), free: running(free) };
    const asked = tableLog(box).filter((entry) => entry.pid === run.pid);
    return { box, granted, free, child, sample, readings, run, left, asked, calls: psCalls(box), listings: psListings(box), text: logText(box), context: dump(box, run, granted, free) };
  } finally {
    box.stop();
  }
})());

test('#3550.20462570 one stub grant whose child spins 8 threads and one ungranted process spinning 4: the sample gives each its runnable threads within 1, to the grant\'s ID and to outside', { timeout: 240_000 }, async (t) => {
  if (!mac(t)) return;
  const { granted, free, child, sample, readings, left, asked, calls, listings, context } = await taken();
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  // To its grant ID: one entry for the one grant in the table, with the holder's pid.
  assert.ok(Array.isArray(sample.grants), `grants\n${context}`);
  assert.deepEqual(sample.grants.map((grant) => grant.id), [child.id], `grants holds the table's one grant, by its ID\n${context}`);
  const [entry] = sample.grants;
  const name = `the grant ${child.id}`;
  assert.equal(entry.class, 'test', context);
  assert.equal(entry.pid, granted.pid, `${name}'s pid is its holder's\n${context}`);
  assert.equal(sample.threadsUnread, undefined, `the sample says its threads weren't read (${sample.threadsUnread}), on a Mac whose ps lists them\n${context}`);
  counted(entry, name, context);
  counted(sample.outside, 'outside', context);

  // The first reference, the test's own listings: the grant's tree is its holder and its child, whose 8 threads spin.
  const mine = span(readings, (reading) => runnable(reading, granted.pid));
  const theirs = span(readings, (reading) => runnable(reading, free.pid));
  t.diagnostic(`the test's own listings read, in runnable threads: the grant's tree ${read(mine)}, the ungranted process ${read(theirs)}; the sample: grant ${JSON.stringify(three(entry))}, outside ${JSON.stringify(three(sample.outside))}, runTop ${JSON.stringify(sample.runTop)}`);
  if (inconclusive(t, { 'the grant\'s tree': { ...mine, want: 8 }, 'the ungranted process': { ...theirs, want: 4 } })) return;
  assert.deepEqual(tree(readings.at(-1), granted.pid).sort(), [granted.pid, child.pid].sort(), 'the grant\'s tree is its holder and its child');
  near(entry.runnable, mine, `${name}'s runnable`, 'under its holder', context);
  // Outside is the whole machine: it holds the ungranted process's runnable threads, at the least.
  assert.ok(sample.outside.runnable >= theirs.lo - 1, `outside's runnable is ${sample.outside.runnable}, fewer than the ${read(theirs)} runnable threads of the ungranted process\n${context}`);

  // The second, the listing load itself was given: every thread of it once, to the grant or to outside.
  const threads = given(calls, listings, [granted.pid, child.pid, free.pid], context);
  const want = split(threads, [granted.pid, child.pid]);
  if (inconclusive(t, { 'the grant\'s tree, in the listing load was given,': { lo: want.under.runnable, want: 8 }, 'the ungranted process, in the listing load was given,': { lo: threads.get(free.pid).runnable, want: 4 } })) return;
  assert.deepEqual(three(entry), want.under, `${name}'s procs, threads and runnable aren't what the listing load was given shows for its holder and its child\n${context}`);
  assert.deepEqual(three(sample.outside), want.rest, `outside's procs, threads and runnable aren't what the listing load was given shows for every other process, the ungranted one's ${threads.get(free.pid).runnable} runnable threads among them\n${context}`);

  // runTop: the grant's commands carry its ID, the ungranted process's none.
  const top = listed(sample, [child.id], context);
  const { procs } = readings.at(-1);
  holds(top, byName(threads, procs, [granted.pid, child.pid]), child.id, context);
  const command = procs.get(free.pid).command;
  const loose4 = top.runTop.find((item) => item.command === command && item.grant === undefined);
  if (loose4) assert.ok(loose4.runnable >= threads.get(free.pid).runnable, `runTop's ${command} under no grant holds ${loose4.runnable} runnable threads, fewer than the ungranted process's ${threads.get(free.pid).runnable}\n${context}`);
  else assert.ok(top.runTop.length === 5 && top.least >= threads.get(free.pid).runnable, `runTop leaves out ${command} under no grant, whose runnable threads (the ungranted process's ${threads.get(free.pid).runnable}, at the least) are more than its least entry's: ${JSON.stringify(top.runTop)}\n${context}`);

  // Unchanged (the issue's Change): the sampler stopped no process and took no grant.
  assert.ok(left.granted && left.free, `a stub had ended when the sample was in the log (the grant's holder ${left.granted ? 'ran' : 'had ended'}, the ungranted process ${left.free ? 'ran' : 'had ended'}): load stops no process\n${context}`);
  assert.deepEqual(asked, [], `load asked the table for a grant: it takes none\n${context}`);
});

test('#3550.106a37e8 a process under two nested grants has its threads counted once, under the outer one: the outer grant holds them, the inner one none, and outside none of them', { timeout: 240_000 }, async (t) => {
  if (!mac(t)) return;
  const box = sandbox(t);
  const path = psStub(box, 'record');
  // A test grant whose command asks for timed, which never passes through: a second grant, nested in the first.
  const outer = hold(box, 'nested', 6, { cls: 'test', inner: 'timed' });
  const spinner = await begun(box, outer, 'timed');
  const outerId = tableLog(box).find((entry) => entry.event === 'granted' && entry.pid === outer.pid)?.id;
  assert.ok(outerId && outerId !== spinner.id, `the stub holds two grants, the outer test one and the timed one nested in it\n${dump(box, outer)}`);
  const before = await warm([{ pid: outer.pid, threads: 6 }], 20_000);
  const { sample, readings, run } = await firstSample(box, before, path);
  const calls = psCalls(box);
  const listings = psListings(box);
  const context = dump(box, run, outer);
  box.stop();
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  assert.ok(Array.isArray(sample.grants), `grants\n${context}`);
  assert.deepEqual(sample.grants.map((grant) => grant.id).sort(), [outerId, spinner.id].sort(), `grants has one entry for each of the table's two grants\n${context}`);
  const top = sample.grants.find((grant) => grant.id === outerId);
  const inner = sample.grants.find((grant) => grant.id === spinner.id);
  assert.equal(top.class, 'test', context);
  assert.equal(top.pid, outer.pid, context);
  assert.equal(inner.class, 'timed', context);
  assert.equal(inner.pid, readings.at(-1).procs.get(spinner.pid)?.ppid, `the inner grant's pid is its holder's, the spinner's parent\n${context}`);
  assert.equal(sample.threadsUnread, undefined, `the sample says its threads weren't read (${sample.threadsUnread}), on a Mac whose ps lists them\n${context}`);
  counted(top, `the outer grant ${outerId}`, context);
  counted(inner, `the inner grant ${spinner.id}`, context);
  counted(sample.outside, 'outside', context);

  const mine = span(readings, (reading) => runnable(reading, outer.pid));
  t.diagnostic(`the test's own listings read ${read(mine)} runnable threads under the outer holder; the sample: outer ${JSON.stringify(three(top))}, inner ${JSON.stringify(three(inner))}, outside ${JSON.stringify(three(sample.outside))}, runTop ${JSON.stringify(sample.runTop)}`);
  if (inconclusive(t, { 'the nested grants\' tree': { ...mine, want: 6 } })) return;
  const pids = [outer.pid, inner.pid, spinner.pid];
  assert.deepEqual(tree(readings.at(-1), outer.pid).sort(), [...pids].sort(), 'the outer grant\'s tree is the two holders and the spinner');
  // Once, under the outer one: the outer grant's count is the tree's, and the two together are no more.
  near(top.runnable, mine, `the outer grant ${outerId}'s runnable`, 'under its holder', context);
  near(top.runnable + inner.runnable, mine, `the two grants' runnable together (${top.runnable} under the outer ${outerId} and ${inner.runnable} under the inner ${spinner.id}; a process counted under both makes it twice the tree's)`, 'under the outer holder', context);
  assert.deepEqual(three(inner), { procs: 0, threads: 0, runnable: 0 }, `the inner grant ${spinner.id} counts processes or threads of its own: a process under two nested grants has its threads once, in the outermost\n${context}`);

  // The listing load itself was given: every thread of it once, to the outer grant or to outside.
  const threads = given(calls, listings, pids, context);
  const want = split(threads, pids);
  if (inconclusive(t, { 'the nested grants\' tree, in the listing load was given,': { lo: want.under.runnable, want: 6 } })) return;
  assert.deepEqual(three(top), want.under, `the outer grant ${outerId}'s procs, threads and runnable aren't what the listing load was given shows for the two holders and the spinner\n${context}`);
  assert.deepEqual(three(sample.outside), want.rest, `outside's procs, threads and runnable aren't what the listing load was given shows for every other process: a thread under the grants counts in outside too, or one outside is left out\n${context}`);

  // runTop names the process's command under the outer grant, never under the inner one.
  const ranked = listed(sample, [outerId, spinner.id], context);
  assert.deepEqual(ranked.runTop.filter((item) => item.grant === spinner.id), [], `runTop counts a command under the inner grant ${spinner.id}\n${context}`);
  holds(ranked, byName(threads, readings.at(-1).procs, pids), outerId, context);
});

test('#3550.712a690c the log still holds PIDs, grant IDs, classes and command names only: procs, threads, runnable and runTop add no argument, no path under a home folder, no environment value and no reason text', { timeout: 240_000 }, async (t) => {
  if (!mac(t)) return;
  const { box, child, sample, readings, text, context } = await taken();
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  // The log is read with the new fields in it: on the base they are missing, and the criterion holds of nothing new.
  assert.ok(Array.isArray(sample.runTop) && sample.runTop.length > 0, `the sample holds no runTop, the commands with runnable threads, beside stubs that spin 12: the log isn't read with the new fields in it\n${context}`);
  for (const [what, entry] of [...(sample.grants ?? []).map((grant) => [`the grant ${grant.id}`, grant]), ['outside', sample.outside]]) counted(entry, what, context);
  t.diagnostic(`runTop: ${JSON.stringify(sample.runTop)}`);

  // Every stub and the sampler were given ARGUMENT or SECRET; the stubs run from the sandbox's HOME, throttle.mjs from
  // this checkout, and the machine's other processes from the user's home.
  const shown = redact(box, text);
  const never = { 'a stub\'s argument': ARGUMENT, 'an environment value': SECRET, 'the sandbox\'s HOME': box.home, 'the sandbox': box.dir, 'the user\'s home': userInfo().homedir, 'a script\'s name, an argument': '.mjs' };
  for (const [what, mark] of Object.entries(never)) assert.ok(!text.includes(mark), `load.log holds ${what} (${redact(box, mark)})\n${shown}`);

  // Only: every text in the sample is the time, a class, a grant's ID of this table or a command's name. Threads that
  // were read leave no reason text; a GPU that wasn't leaves #3240's.
  const names = (pid) => new Set(readings.map(({ procs }) => procs.get(pid)?.command).filter((name) => name !== undefined));
  const walk = (value, key, owner) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key, owner));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([name, item]) => walk(item, name, value));
    if (typeof value === 'number') return;
    assert.equal(typeof value, 'string', `${key}: ${JSON.stringify(value)}\n${shown}`);
    if (key === 'at') return assert.ok(!Number.isNaN(Date.parse(value)), `at: ${value}`);
    if (key === 'class') return assert.ok(CLASSES.includes(value), `class: ${value}`);
    if (key === 'id' || key === 'grant') return assert.equal(value, child.id, `${key} ${value} is no grant of this table`);
    if (key === 'gpuUnread') return;
    assert.equal(key, 'command', `a text that is no time, class, grant ID or command name: ${key} ${JSON.stringify(value)}\n${shown}`);
    // The name as ps prints ucomm: no path, no arguments, 16 characters at most.
    assert.ok(!value.includes('/') && value.length <= 16, `a command that isn't a name as ps prints ucomm: ${JSON.stringify(value)}\n${shown}`);
    if (Number.isInteger(owner.pid) && names(owner.pid).size) assert.ok(names(owner.pid).has(value), `pid ${owner.pid}'s command is ${JSON.stringify(value)}; ps prints its ucomm as ${[...names(owner.pid)].map((name) => JSON.stringify(name)).join(' or ')}`);
  };
  walk(sample);
  // The stubs' own commands, when runTop names them, are the name alone.
  const stub = readings.at(-1).procs.get(child.pid)?.command;
  for (const item of sample.runTop.filter((entry) => entry.grant === child.id)) assert.equal(item.command, stub, `runTop names the grant's processes ${JSON.stringify(item.command)}; ps prints their ucomm as ${JSON.stringify(stub)}\n${shown}`);
});
