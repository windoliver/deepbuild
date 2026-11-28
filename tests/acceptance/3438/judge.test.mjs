// #3438 criteria 2, 3 and 5 (README.md): what each task's judge reads from a report. The budget window runs a task,
// then `node <the task's script> judge` on its report, and records that verdict; so the limits, samples, rounds, pairs
// and ratios the criteria give, the hub they name, the `Background` control and the one ask are each held here on
// planted reports, on any machine. No test takes a reading or starts a hub. Each planted set is one every way of
// reading it agrees on: readings all within or all well over, constant pairs, constant sides but where the p50 is
// told from the mean. A test of criterion 2 or 3 whose assertions hold ends INCONCLUSIVE, naming the tasks that take
// the reading; criterion 5's needs no reading and passes.
import { test } from 'node:test';
import {
  ASK, C2, C3, INSTALLED, REFERENCE, TARGETS, TERMINAL_MS, assert, chosenType, holder, hubOf, judge, launchdTasks, limitOf, pairsOf, report, said,
  sidesOf, windowReads,
} from './helpers.mjs';

/** The type the build's definition names, read once: a report's hub was loaded with it. */
let chosen;
const typeOf = (t) => (chosen ??= chosenType(t));
const reads = (verdict, status, what) => assert.equal(verdict.status, status, `${what} reads ${status}; the judge said ${said(verdict)}`);
const never = (verdict, what) => assert.notEqual(verdict.status, 'PASS', `${what} never reads PASS; the judge said ${said(verdict)}`);
/** A hub that is a child of another process than launchd, reported under the label and type of the launchd-started one. */
const childOf = (type) => ({ ...hubOf(type), pid: 48302, ppid: 48211, parent: '/opt/bench/bin/node' });
const namesParent = (verdict) => typeof verdict.reason === 'string' && (/(?<!\d)48211(?!\d)/.test(verdict.reason) || verdict.reason.includes('/opt/bench/bin/node'));
/** A reading with every load it carries set to `load`, or dropped. */
function atLoad(reading, load) {
  if (Array.isArray(reading) || reading === null || typeof reading !== 'object') return reading;
  return Object.fromEntries(Object.entries(reading).flatMap(([key, value]) => {
    if (key !== 'loads') return [[key, atLoad(value, load)]];
    return load === undefined ? [] : [[key, value.map(() => ({ start: load, end: load }))]];
  }));
}

/** A budget counts only on a reference Mac, on mains, at rest and at a load below its cores (#568); anywhere else it is a reading. */
function countsOnlyOnAReferenceMac(task, type) {
  const good = report(task, type);
  reads(judge(task, good), 'PASS', `${task.id}: a report read on a reference Mac at rest, on a hub launchd started from the build's definition, each reading within its target,`);
  for (const [what, change] of [['another Mac (Mac14,2)', { model: 'Mac14,2' }], ['battery power', { power: 'battery' }], ['Low Power Mode on', { lowPowerMode: true }], ['a serious thermal state', { thermalState: 'serious' }]]) {
    reads(judge(task, { ...good, machine: { ...REFERENCE, ...change } }), 'INCONCLUSIVE', `${task.id}: the same readings on ${what}: a reading, not a budget result,`);
  }
  never(judge(task, { ...good, machine: null }), `${task.id}: a report that names no machine`);
  reads(judge(task, { ...good, readings: atLoad(good.readings, 4096) }), 'INCONCLUSIVE', `${task.id}: the same readings at a load of 4,096, above any machine's cores,`);
  never(judge(task, { ...good, readings: atLoad(good.readings, undefined) }), `${task.id}: readings with no load at their start and end`);
}

test('#3438.e9cc07fb the judge holds five readings on the launchd-started hub to 10 ms of hook overhead at p95 and to 0.5% of a core idle, and counts them only on a reference Mac at a load below its cores', { timeout: 900_000 }, (t) => {
  const tasks = launchdTasks(C2);
  const { type, skip } = typeOf(t);
  if (skip) return t.skip(skip);
  for (const name of ['hook_overhead_p95_ms', 'idle_cpu_percent']) {
    const task = holder(tasks, name), { value } = TARGETS[name];
    const read = (...runs) => judge(task, report(task, type, { [name]: limitOf(...runs) }));
    reads(read(value * 0.98), 'PASS', `${name}: five readings of ${value * 0.98}, each within ${value},`);
    never(read(value * 1.02), `${name}: five readings of ${value * 1.02}, each over ${value}`);
    reads(read(value * 1.2), 'FAIL', `${name}: five readings of ${value * 1.2}, each over ${value} by a fifth,`);
    reads(read(value / 2, value / 2, value / 2, value / 2, value * 3), 'INCONCLUSIVE', `${name}: four readings within ${value} and one three times it: neither all within nor all over`);
    never(read(value / 2, value / 2, value / 2, value / 2), `${name}: four readings where five are judged`);
    never(read(value / 2, value / 2, null, value / 2, value / 2), `${name}: a reading missing among the five`);
    never(judge(task, { ...report(task, type), readings: Object.fromEntries(Object.entries(report(task, type).readings).filter(([key]) => key !== name)) }), `${name}: a report that holds no reading of it`);
  }
  for (const task of tasks) countsOnlyOnAReferenceMac(task, type);
  t.skip(windowReads(C2, tasks));
});

test('#3438.e9cc07fb the judge holds the round trip and the record append to a p50 no more than 50% above the child-started hub\'s, on 20 samples a side in alternated rounds', { timeout: 900_000 }, (t) => {
  const tasks = launchdTasks(C2);
  const { type, skip } = typeOf(t);
  if (skip) return t.skip(skip);
  const flat = (ms, count = 20) => Array(count).fill(ms);
  /** Twenty samples: six of `few`, spread through the rounds, among fourteen of `most`. */
  const mixed = (few, most) => Array.from({ length: 20 }, (_, i) => (i % 3 === 1 && i < 18 ? few : most));
  for (const name of ['round_trip_p50_ratio', 'record_append_p50_ratio']) {
    const task = holder(tasks, name);
    const read = (reading) => judge(task, report(task, type, { [name]: reading }));
    reads(read(sidesOf(flat(149), flat(100))), 'PASS', `${name}: 20 samples of 149 ms on the launchd-started hub beside 20 of 100 ms on the child-started one, 49% above,`);
    never(read(sidesOf(flat(151), flat(100))), `${name}: 151 ms beside 100 ms, 51% above`);
    reads(read(sidesOf(flat(200), flat(100))), 'FAIL', `${name}: 200 ms beside 100 ms, twice the child-started hub's p50,`);
    // The p50, never the mean or the slowest sample.
    reads(read(sidesOf(mixed(400, 100), flat(100))), 'PASS', `${name}: fourteen samples of 100 ms and six of 400 ms beside 100 ms: the p50 is 100 ms, though the mean is 190 ms,`);
    reads(read(sidesOf(mixed(10, 160), flat(100))), 'FAIL', `${name}: fourteen samples of 160 ms and six of 10 ms beside 100 ms: the p50 is 160 ms, 60% above, though the mean is 115 ms,`);
    // 20 samples a side, in alternated rounds.
    never(read(sidesOf(flat(120, 19), flat(100, 19))), `${name}: 19 samples a side`);
    never(read({ ...sidesOf(flat(120), flat(100)), child: flat(100, 5) }), `${name}: 20 samples on the launchd-started hub beside 5 on the child-started one`);
    never(read({ ...sidesOf(flat(120), flat(100)), child: [] }), `${name}: no sample on a hub started as a child`);
    never(read({ ...sidesOf(flat(120), flat(100)), first: flat('launchd') }), `${name}: rounds that each ran the launchd-started hub first, none alternated`);
    const { first, ...unordered } = sidesOf(flat(120), flat(100));
    never(read(unordered), `${name}: rounds that don't say which side ran first (${first.length} do)`);
  }
  t.skip(windowReads(C2, tasks));
});

test('#3438.e9cc07fb a report whose hub is a child reported as launchd\'s fails, naming the hub\'s parent process; no hub, the installed hub\'s label and another process type never pass', { timeout: 900_000 }, (t) => {
  const tasks = launchdTasks(C2);
  const { type, skip } = typeOf(t);
  if (skip) return t.skip(skip);
  for (const task of tasks) {
    reads(judge(task, report(task, type)), 'PASS', `${task.id}: a report whose hub's parent is launchd, process 1, each reading within its target,`);
    for (const [what, planted] of [['with every reading within its target', report(task, type, {}, { hub: childOf(type) })], ['with nothing read after it', { ...report(task, type, {}, { hub: childOf(type) }), readings: {} }]]) {
      const verdict = judge(task, planted);
      reads(verdict, 'FAIL', `${task.id}: a hub that is a child of process 48211 (/opt/bench/bin/node), reported as launchd's, ${what},`);
      assert.ok(namesParent(verdict), `${task.id}: the failure names the hub's parent process, 48211 or /opt/bench/bin/node: ${said(verdict)}`);
    }
    const { ppid, parent, ...unread } = hubOf(type);
    never(judge(task, report(task, type, {}, { hub: unread })), `${task.id}: a hub whose parent process was never read (launchd is process ${ppid}, ${parent})`);
    never(judge(task, report(task, type, {}, { hub: null })), `${task.id}: readings with no hub launchd started`);
    never(judge(task, report(task, type, {}, { hub: hubOf(type, INSTALLED) })), `${task.id}: readings taken under ${INSTALLED}, the installed hub's label, not a label of the run's own,`);
    never(judge(task, report(task, type, {}, { hub: hubOf(null) })), `${task.id}: a hub loaded from a definition with no ProcessType, which is not the build's,`);
    never(judge(task, report(task, type, {}, { hub: hubOf('Background') })), `${task.id}: a hub loaded with ProcessType Background where the build's definition names ${type}`);
  }
  t.skip(windowReads(C2, tasks));
});

test('#3438.65e37fd0 the judge holds each command\'s 10 alternated pairs to 1.2 times the terminal\'s, and reads INCONCLUSIVE, never PASS, when the pairs with the type planted as Background stay within 1.2 times as well', { timeout: 900_000 }, (t) => {
  const tasks = launchdTasks(C3);
  const { type, skip } = typeOf(t);
  if (skip) return t.skip(skip);
  for (const name of ['spin_ratio', 'write_sync_ratio']) {
    const task = holder(tasks, name), ms = TERMINAL_MS[name];
    const read = (reading) => judge(task, report(task, type, { [name]: reading }));
    const throttled = pairsOf(3, ms);
    reads(read({ chosen: pairsOf(1.19, ms), background: throttled }), 'PASS', `${name}: ten pairs at 1.19 times the terminal's time, and at 3 times with the type planted as Background,`);
    never(read({ chosen: pairsOf(1.21, ms), background: throttled }), `${name}: ten pairs at 1.21 times the terminal's time`);
    reads(read({ chosen: pairsOf(1.5, ms), background: throttled }), 'FAIL', `${name}: ten pairs at 1.5 times the terminal's time`);
    // 10 alternated pairs, read with the build's type and with Background.
    never(read({ chosen: pairsOf(1.1, ms, 9), background: throttled }), `${name}: nine pairs where ten are judged`);
    never(read({ chosen: pairsOf(1.1, ms), background: pairsOf(3, ms, 9) }), `${name}: nine pairs with the type planted as Background`);
    never(read({ chosen: { ...pairsOf(1.1, ms), first: Array(10).fill('hub') }, background: throttled }), `${name}: pairs that each ran the hub's command first, none alternated`);
    never(read({ chosen: { ...pairsOf(1.1, ms), terminal: [] }, background: throttled }), `${name}: no time from a terminal`);
    never(read({ chosen: pairsOf(1.1, ms) }), `${name}: pairs never read with the type planted as Background`);
  }
  const spin = holder(tasks, 'spin_ratio');
  never(judge(spin, report(spin, type, { spin_ratio: { chosen: pairsOf(1.1, 1000), background: pairsOf(3, 1000) } })), 'spin_ratio: a command that took 1 s from a terminal, which is no core spun for 5 s,');
  for (const task of tasks) {
    const pairs = Object.keys(task.targets).filter((name) => TARGETS[name].kind === 'pairs');
    // Every command of the task within 1.2 times under Background too: this Mac doesn't tell the limits apart.
    const flat = Object.fromEntries(pairs.map((name) => [name, { chosen: pairsOf(1.1, TERMINAL_MS[name]), background: pairsOf(1.05, TERMINAL_MS[name]) }]));
    const verdict = judge(task, report(task, type, flat));
    reads(verdict, 'INCONCLUSIVE', `${task.id}: pairs at 1.1 times the terminal's time, and at 1.05 times with the type planted as Background, so nothing tells the limits apart,`);
    // The control is a hub launchd started from the definition with the type planted as Background, and the commands' hub is the build's.
    never(judge(task, report(task, type, {}, { background_hub: null })), `${task.id}: Background pairs with no hub launchd started for them`);
    never(judge(task, report(task, type, {}, { background_hub: hubOf(type, 'com.deepbuild.hub.budget-background') })), `${task.id}: "Background" pairs read on a hub loaded with ${type}, the build's own type,`);
    never(judge(task, report(task, type, {}, { background_hub: { ...childOf('Background'), label: 'com.deepbuild.hub.budget-background' } })), `${task.id}: Background pairs read on a hub that is a child of process 48211, not launchd's,`);
    never(judge(task, report(task, type, {}, { hub: childOf(type) })), `${task.id}: commands started by a hub that is a child of process 48211, not launchd's,`);
    never(judge(task, report(task, type, {}, { hub: null })), `${task.id}: pairs with no hub launchd started`);
    never(judge(task, report(task, type, {}, { hub: hubOf(type, INSTALLED) })), `${task.id}: pairs read under ${INSTALLED}, the installed hub's label,`);
    countsOnlyOnAReferenceMac(task, type);
  }
  t.skip(windowReads(C3, tasks));
});

test('#3438.3ead8ec8 a report of a run that could load no login service reads BLOCKED with its one ask, never PASS, whatever readings it carries', { timeout: 900_000 }, (t) => {
  const tasks = [...new Map([...launchdTasks(C2), ...launchdTasks(C3)].map((task) => [task.id, task])).values()];
  const { type, skip } = typeOf(t);
  if (skip) return t.skip(skip);
  for (const task of tasks) {
    const passed = judge(task, report(task, type));
    reads(passed, 'PASS', `${task.id}: a report read on a hub launchd started, each reading within its target,`);
    assert.deepEqual(passed.asks ?? [], [], `${task.id}: a verdict that passes asks nothing: ${JSON.stringify(passed.asks)}`);
    const unloaded = { task: task.id, machine: { ...REFERENCE }, hub: null, readings: {}, asks: [{ ...ASK }] };
    for (const [what, planted] of [['and read nothing', unloaded], ['yet carries readings within every target', { ...report(task, type), hub: null, asks: [{ ...ASK }] }]]) {
      const verdict = judge(task, planted);
      reads(verdict, 'BLOCKED', `${task.id}: a report whose run could load no login service ${what}`);
      assert.deepEqual(verdict.asks, [ASK], `${task.id}: the BLOCKED verdict carries the run's one ask, and no other`);
      assert.ok(typeof verdict.reason === 'string' && verdict.reason.includes(ASK.what), `${task.id}: the verdict's reason holds the ask's words, since the window's record keeps a verdict's status and reason: ${said(verdict)}`);
    }
  }
});
