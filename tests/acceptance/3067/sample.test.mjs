// #3067: one sample of `node scripts/throttle.mjs load`, read from `load.log` in the table's folder, against the
// test's own ps readings of the stubs it started (README: The surface). The tests of this file run one after another:
// each spins cores.
import assert from 'node:assert/strict';
import { cpus, loadavg, userInfo } from 'node:os';
import test from 'node:test';
import { ARGUMENT, CLASSES, SECRET, dump, firstSample, hold, logText, loose, running, sandbox, span, startOf, tableLog, total, tree, until, warm } from './helpers.mjs';

const WITHIN = 0.5;
// Below this a spinner's CPU can't tell a right attribution from none: nothing, too, is within 0.5 of a core of it.
const ENOUGH = 1;
const near = (value, { lo, hi }, within, what, context) => assert.ok(typeof value === 'number' && value >= lo - within && value <= hi + within,
  `${what} is ${value}; the test's own ps read ${lo.toFixed(2)} to ${hi.toFixed(2)} cores around the sample, so it must be within ${within} of that\n${context}`);
// The shares never sum above the machine: every process once. The machine's whole CPU moves more between two
// listings than one tree's does, so this bound is a core wide and one-sided (README: Gaps and assumptions).
const notAbove = (value, { lo, hi }, what, context) => assert.ok(value <= hi + 2 * WITHIN,
  `${what} sum to ${value.toFixed(2)} cores, above the machine: the test's own ps read ${lo.toFixed(2)} to ${hi.toFixed(2)} for every process around the sample\n${context}`);
const four = (entry, what, context) => {
  for (const key of ['cpu', 'compile', 'node', 'other']) assert.ok(typeof entry?.[key] === 'number' && entry[key] >= 0, `${what} has no number ${key}\n${context}`);
  // "which add up to cpu", to the rounding of four numbers.
  assert.ok(Math.abs(entry.compile + entry.node + entry.other - entry.cpu) <= 0.2, `${what}: compile, node and other don't add up to cpu: ${JSON.stringify(entry)}`);
};
/** A stub started under its grant: its start note, with the grant's ID from the DEEP_THROTTLE it saw. */
async function begun(box, run, cls) {
  await until(() => startOf(box, run.label) || !running(run), 30_000);
  const note = startOf(box, run.label);
  assert.ok(note, `stub ${run.label} never started\n${dump(box, run)}`);
  if (!cls) return note;
  const [, id] = String(note.throttle).match(new RegExp(`^${cls}:(\\S+)$`)) ?? [];
  assert.ok(id, `stub ${run.label} ran under no ${cls} grant: ${note.throttle}\n${dump(box, run)}`);
  return { ...note, id };
}
const head = (sample, context) => {
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  assert.ok(typeof sample.at === 'string' && Math.abs(Date.parse(sample.at) - Date.now()) < 120_000, `at isn't an ISO time of now: ${sample.at}`);
  assert.equal(sample.cores, cpus().length, 'cores');
  assert.ok(typeof sample.load === 'number' && sample.load > 0, `load: ${sample.load}`);
};
const inconclusive = (t, spans) => {
  const starved = Object.entries(spans).filter(([, { lo }]) => lo < ENOUGH);
  if (!starved.length) return false;
  t.skip(`INCONCLUSIVE: the machine (1-minute load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores) gave ${starved.map(([name, { lo }]) => `${name} ${lo.toFixed(2)} cores`).join(' and ')}, under the ${ENOUGH} core a wrong attribution needs to show at ${WITHIN} of a core; run again`);
  return true;
};

test('#3067.d6d9116e one stub grant whose child, named node, spins 2 cores and one ungranted process spinning 2: the sample attributes each within 0.5 of a core, to the grant\'s ID and to outside', { timeout: 240_000 }, async (t) => {
  const box = sandbox(t);
  const granted = hold(box, 'granted', { cores: 2 });
  const free = loose(box, 'free', 2);
  const child = await begun(box, granted, 'test');
  await begun(box, free);
  const { sample, readings, run } = await firstSample(box, await warm([granted.pid, free.pid], 2, 60_000));
  const context = dump(box, run, granted, free);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  head(sample, context);
  assert.equal(readings.at(-1).get(child.pid)?.command, 'node', 'the grant\'s child is a process named node');
  const mine = span(readings, (procs) => tree(procs, granted.pid));
  const other = span(readings, (procs) => tree(procs, free.pid));
  const machine = span(readings, total);
  const read = ({ lo, hi }) => `${lo.toFixed(2)} to ${hi.toFixed(2)}`;
  t.diagnostic(`the test's ps read, in cores: the grant's tree ${read(mine)}, the ungranted process ${read(other)}, every process ${read(machine)}; the sample: grant ${sample.grants?.[0]?.cpu}, outside ${sample.outside?.cpu}`);
  if (inconclusive(t, { 'the grant\'s tree': mine, 'the ungranted process': other })) return;

  // To its grant ID: one entry for the one grant in the table, with the holder's pid and its tree's CPU, all node's.
  assert.ok(Array.isArray(sample.grants), `grants\n${context}`);
  assert.deepEqual(sample.grants.map((grant) => grant.id), [child.id], `grants holds the table's one grant, by its ID\n${context}`);
  const [entry] = sample.grants;
  assert.equal(entry.class, 'test', context);
  assert.equal(entry.pid, granted.pid, `the grant's pid is its holder's\n${context}`);
  four(entry, 'the grant', context);
  near(entry.cpu, mine, WITHIN, 'the grant\'s cpu', context);
  near(entry.node, mine, WITHIN, 'the grant\'s node (its holder and its child are both node)', context);

  // To outside: every other process, the ungranted spinner among them, so the grant and outside make up the machine.
  four(sample.outside, 'outside', context);
  assert.ok(sample.outside.cpu >= other.lo - WITHIN && sample.outside.node >= other.lo - WITHIN, `outside (cpu ${sample.outside.cpu}, node ${sample.outside.node}) doesn't hold the ungranted node process's ${other.lo.toFixed(2)} cores\n${context}`);
  notAbove(entry.cpu + sample.outside.cpu, machine, 'the grant\'s cpu and outside\'s', context);

  // top: the five that used most; the grant's child carries its grant, the ungranted process none.
  assert.ok(Array.isArray(sample.top) && sample.top.length === 5, `top lists five processes\n${context}`);
  for (const proc of sample.top) assert.ok(Number.isInteger(proc.pid) && typeof proc.command === 'string' && typeof proc.cpu === 'number', `a top entry: ${JSON.stringify(proc)}`);
  // A process that led all but four others by 0.5 of a core in every reading of the test's is one of the five.
  for (const [pid, name] of [[child.pid, 'the grant\'s child'], [free.pid, 'the ungranted process']]) {
    const led = readings.every((procs) => [...procs].filter(([at, proc]) => at !== pid && proc.cpu > (procs.get(pid)?.cpu ?? 0) - WITHIN).length <= 4);
    if (led) assert.ok(sample.top.some((proc) => proc.pid === pid), `${name} (pid ${pid}) used more than all but four processes in every reading, and isn't in top\n${context}`);
  }
  const inTop = (pid) => sample.top.find((proc) => proc.pid === pid);
  if (inTop(child.pid)) {
    assert.equal(inTop(child.pid).grant, child.id, `top's entry for the grant's child names its grant\n${context}`);
    assert.equal(inTop(child.pid).command, 'node', context);
    near(inTop(child.pid).cpu, span(readings, (procs) => procs.get(child.pid)?.cpu ?? 0), WITHIN, 'top\'s cpu for the grant\'s child', context);
  }
  if (inTop(free.pid)) {
    assert.equal(inTop(free.pid).grant, undefined, `top's entry for the ungranted process names no grant\n${context}`);
    assert.equal(inTop(free.pid).command, 'node', context);
    near(inTop(free.pid).cpu, other, WITHIN, 'top\'s cpu for the ungranted process', context);
  }
});

test('#3067.a665617d a process under two nested grants is counted once, under the outer top-level grant: the two grants\' shares together are its CPU, not twice it, and no more than the machine with outside', { timeout: 240_000 }, async (t) => {
  const box = sandbox(t);
  // A test grant whose command asks for timed, which never passes through: a second grant, nested in the first.
  const outer = hold(box, 'nested', { cls: 'test', inner: 'timed', cores: 2 });
  const spinner = await begun(box, outer, 'timed');
  const outerId = tableLog(box).find((entry) => entry.event === 'granted' && entry.pid === outer.pid)?.id;
  assert.ok(outerId && outerId !== spinner.id, `the stub holds two grants, the outer test one and the timed one nested in it\n${dump(box, outer)}`);
  const { sample, readings, run } = await firstSample(box, await warm([outer.pid], 2, 60_000));
  const context = dump(box, run, outer);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  head(sample, context);
  const mine = span(readings, (procs) => tree(procs, outer.pid));
  const machine = span(readings, total);
  t.diagnostic(`the test's ps read, in cores: the grants' tree ${mine.lo.toFixed(2)} to ${mine.hi.toFixed(2)}, every process ${machine.lo.toFixed(2)} to ${machine.hi.toFixed(2)}; the sample: grants ${sample.grants?.map((grant) => `${grant.class} ${grant.cpu}`).join(', ')}, outside ${sample.outside?.cpu}`);
  if (inconclusive(t, { 'the nested grants\' process': mine })) return;

  assert.ok(Array.isArray(sample.grants), `grants\n${context}`);
  assert.deepEqual(sample.grants.map((grant) => grant.id).sort(), [outerId, spinner.id].sort(), `grants has one entry for each of the table's two grants\n${context}`);
  const top = sample.grants.find((grant) => grant.id === outerId);
  const inner = sample.grants.find((grant) => grant.id === spinner.id);
  assert.equal(top.class, 'test', context);
  assert.equal(top.pid, outer.pid, context);
  assert.equal(inner.class, 'timed', context);
  assert.equal(inner.pid, readings.at(-1).get(spinner.pid)?.ppid, `the inner grant's pid is its holder's, the spinner's parent\n${context}`);
  four(top, 'the outer grant', context);
  four(inner, 'the inner grant', context);
  four(sample.outside, 'outside', context);
  // Under the outer grant, and once: the outer's share is the tree's CPU, and both shares together are no more.
  near(top.cpu, mine, WITHIN, 'the outer grant\'s cpu', context);
  near(top.cpu + inner.cpu, mine, WITHIN, 'the two grants\' cpu together (a process counted under both makes it twice the tree\'s)', context);
  // "Since the shares sum above the machine": the shares and outside are every process once.
  notAbove(top.cpu + inner.cpu + sample.outside.cpu, machine, 'the grants\' cpu and outside\'s', context);
  const listed = (sample.top ?? []).find((proc) => proc.pid === spinner.pid);
  if (listed) assert.equal(listed.grant, outerId, `top's entry for the process names the outer grant\n${context}`);
});

test('#3067.4ec1293f the log holds PIDs, grant IDs, classes and command names only: no argument, no path under a home folder and no environment value of a grant\'s child, an ungranted process, a holder or the sampler', { timeout: 240_000 }, async (t) => {
  const box = sandbox(t);
  const granted = hold(box, 'granted', { cores: 2 });
  const free = loose(box, 'free', 2);
  const child = await begun(box, granted, 'test');
  await begun(box, free);
  // Spinning puts the stubs among the five that used most, where a command is written; not needed for the check.
  const { sample, readings, run } = await firstSample(box, await warm([granted.pid, free.pid], 2, 30_000));
  const context = dump(box, run, granted, free);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  assert.ok(Array.isArray(sample.grants) && sample.outside && Array.isArray(sample.top), `the sample has grants, outside and top\n${context}`);
  t.diagnostic(`in top: ${sample.top.filter((proc) => [child.pid, free.pid].includes(proc.pid)).length} of the test's 2 stubs`);

  // Every stub and the sampler were given ARGUMENT or SECRET; the stubs run from the sandbox's HOME, throttle.mjs
  // from this checkout, and the machine's other processes from the user's home.
  const text = logText(box);
  const never = { 'a stub\'s argument': ARGUMENT, 'an environment value': SECRET, 'the sandbox\'s HOME': box.home, 'the sandbox': box.dir, 'the user\'s home': userInfo().homedir, 'a script\'s name, an argument': '.mjs' };
  for (const [what, mark] of Object.entries(never)) assert.ok(!text.includes(mark), `load.log holds ${what} (${mark})\n${text}`);

  // Only: every text in the sample is the time, a class, a grant's ID of this table or a command's name.
  const ids = [child.id];
  const names = (pid) => new Set(readings.map((procs) => procs.get(pid)?.command).filter((name) => name !== undefined));
  const walk = (value, key, owner) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key, owner));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([name, item]) => walk(item, name, value));
    if (typeof value === 'number') return;
    assert.equal(typeof value, 'string', `${key}: ${JSON.stringify(value)}`);
    if (key === 'at') return assert.ok(!Number.isNaN(Date.parse(value)), `at: ${value}`);
    if (key === 'class') return assert.ok(CLASSES.includes(value), `class: ${value}`);
    if (key === 'id' || key === 'grant') return assert.ok(ids.includes(value), `${key} ${value} is no grant of this table`);
    assert.equal(key, 'command', `a text that is no time, class, grant ID or command name: ${key} ${JSON.stringify(value)}`);
    assert.ok(!value.includes('/'), `a command with a path: ${value}`);
    // The name as ps prints ucomm, for a process the test's own listings saw.
    if (names(owner.pid).size) assert.ok(names(owner.pid).has(value), `pid ${owner.pid}'s command is ${JSON.stringify(value)}; ps prints its ucomm as ${[...names(owner.pid)].map((name) => JSON.stringify(name)).join(' or ')}`);
  };
  walk(sample);
});
