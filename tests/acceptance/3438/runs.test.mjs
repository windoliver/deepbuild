// #3438 criteria 2, 3 and 5 (README.md): what a task's own run does with the service manager, as far as a run can go
// without a hub launchd started. Each test runs the task's command from benchmarks/budgets.json, as the budget window
// runs it, in a HOME under a temp folder with a `launchctl` stand-in first on PATH that loads a job as a line of its
// state and starts nothing; the real launchd is never reached. So no run here takes a reading: on a temp home whose
// `launchctl` sits outside every temp folder it must read BLOCKED with the one ask before it loads anything; where the
// stand-in loads its job and no hub ever answers it must have loaded the build's own definition under a label of its
// own, left the installed hub's alone, removed its label, and never read PASS; and the planted run that starts a
// child and reports it as launchd's must fail, naming the hub's parent process. A test of criterion 2 or 3 whose
// assertions hold ends INCONCLUSIVE, naming the tasks that take the reading; criterion 5's needs no reading and passes.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import {
  C2, C3, INSTALLED, MAC, answering, assert, calls, deep, forgetCalls, handed, holder, judge, launchdTasks, loaded, needsBuilds, offMac, plain, readPlist,
  runTask, said, samePath, sandbox, shownCalls, stopLeftHub, windowReads,
} from './helpers.mjs';

/** The `launchctl` calls that only read: any other call changes what launchd holds. */
const READS = ['print', 'list', 'blame', 'managername', 'managerpid', 'manageruid'];
const shownCall = ({ argv, exit }, box) => plain(`launchctl ${argv.join(' ')} (exit ${exit})`, box);
/** The run's verdict: it exits 0 and its last line is its report, which its task's judge reads. */
function verdictOf(task, ran, where) {
  assert.equal(ran.status, 0, `${task.id}: its run ${where} exits 0 with its report, as the window needs to judge it\n${ran.shown}`);
  assert.ok(ran.report, `${task.id}: its run ${where} prints its report, one JSON object, as its last line\n${ran.shown}`);
  return judge(task, ran.report);
}

test('#3438.3ead8ec8 on a machine whose home is under a temp folder, with launchctl outside every temp folder, each task that needs launchd reads BLOCKED with the one ask, never PASS, and loads nothing', { timeout: 1_800_000 }, (t) => {
  const tasks = [...new Map([...launchdTasks(C2), ...launchdTasks(C3)].map((task) => [task.id, task])).values()];
  if (!MAC) return t.skip(offMac('a task that loads its hub into launchd'));
  needsBuilds();
  const asks = [];
  for (const task of tasks) {
    const box = sandbox(t, { outside: true });
    const ran = runTask(box, task, { timeout: 300_000 });
    // A temp home loads nothing (#2203): today no task exists; a run that loads on a temp home stops here.
    const changing = calls(box).filter(({ argv }) => !READS.includes(argv[0]));
    assert.deepEqual(changing.map((call) => shownCall(call, box)), [], `${task.id}: its run, in a home under a temp folder with launchctl outside every temp folder, reached the service manager, where a temp home gets no login service\n${ran.shown}`);
    const verdict = verdictOf(task, ran, 'on a temp home');
    assert.equal(verdict.status, 'BLOCKED', `${task.id}: on a temp home, where no login service loads, the task reads BLOCKED, never PASS; its judge said ${said(verdict)}`);
    assert.ok(Array.isArray(verdict.asks) && verdict.asks.length === 1, `${task.id}: BLOCKED with one ask: its verdict's asks are ${JSON.stringify(verdict.asks)}`);
    const [ask] = verdict.asks;
    assert.ok(ask && ask.kind === 'unblock' && typeof ask.what === 'string' && ask.what.trim(), `${task.id}: the one ask is {"kind": "unblock", "what": what a person does to unblock it}: ${JSON.stringify(ask)}`);
    assert.ok(typeof verdict.reason === 'string' && verdict.reason.includes(ask.what), `${task.id}: the verdict's reason holds the ask's words, since the window's record keeps a verdict's status and reason: ${said(verdict)}`);
    asks.push({ task: task.id, ask });
  }
  // One ask, asked once: every task blocked by this one cause asks the same thing in the same words.
  const other = asks.filter(({ ask }) => !isDeepStrictEqual(ask, asks[0].ask));
  assert.deepEqual(other, [], `the tasks a temp home blocks ask one thing, in one ask: ${asks[0].task} asks ${JSON.stringify(asks[0].ask)}, and others ask something else`);
});

/** The definition a run loads is the build's own under another label: the same keys, and the same type, start, restart and limits. */
function heldToTheBuilds(task, own, built) {
  assert.deepEqual(Object.keys(own).sort(), Object.keys(built).sort(), `${task.id}: the definition its run loads first holds the keys of the one deep hub start writes, no more and no fewer`);
  for (const key of ['ProcessType', 'RunAtLoad', 'KeepAlive', 'SoftResourceLimits']) {
    assert.deepEqual(own[key], built[key], `${task.id}: the definition its run loads first holds ${key} as the one deep hub start writes does, ${JSON.stringify(built[key])}: it holds ${JSON.stringify(own[key])}`);
  }
  assert.deepEqual(own.ProgramArguments?.slice(0, built.ProgramArguments.length), built.ProgramArguments, `${task.id}: the definition its run loads first starts the program deep hub start's does, this build's deep hub run: ${plain(JSON.stringify(own.ProgramArguments))}`);
}

/**
 * Each task's run where a login service may load (a temp home whose `launchctl` is under a temp folder, #2203) and the
 * stand-in loads the job it is handed but starts nothing, so the run's hub never answers.
 */
function loadsTheBuildsDefinition(t, criterion) {
  const tasks = launchdTasks(criterion);
  if (!MAC) return t.skip(offMac('a task that loads its hub into launchd'));
  needsBuilds();
  for (const task of tasks) {
    const box = sandbox(t);
    // What the build itself does here: deep hub start, no launcher named, hands its definition to launchctl, which refuses it.
    answering(box, 'refuse');
    const started = deep(box, ['hub', 'start']);
    const builds = calls(box).filter(({ argv }) => argv[0] === 'bootstrap').flatMap(({ loads = [] }) => loads).find(({ path }) => samePath(path, box.plist));
    if (!builds) throw Error(`BLOCKED: deep hub start, in a temp home whose launchctl is under a temp folder, handed launchctl no bootstrap of its definition, so this run can't tell where the build loads and what\n${started.shown}\n${shownCalls(box)}`);
    const built = readPlist(handed(box, builds));
    assert.ok(built.ok && typeof built.value.ProcessType === 'string', `the definition deep hub start hands launchctl names a ProcessType, which a run's own must match: ${built.ok ? Object.keys(built.value).join(', ') : built.said}`);
    const installed = readFileSync(box.plist);
    forgetCalls(box);
    answering(box, 'accept');

    const ran = runTask(box, task);
    const all = calls(box);
    const loads = all.flatMap(({ argv, loads: handedOver = [] }) => handedOver.map((load) => ({ verb: argv[0], ...load })));
    assert.ok(loads.length > 0, `${task.id}: its run, where a login service may load, handed launchctl no definition: it read no hub launchd started\n${ran.shown}\n${shownCalls(box)}`);
    for (const load of loads) {
      assert.equal(load.verb, 'bootstrap', `${task.id}: its run loads with launchctl bootstrap, as deep hub start does\n${shownCalls(box)}`);
      assert.equal(load.domain, builds.domain, `${task.id}: its run loads into ${builds.domain}, the domain deep hub start loads the installed hub into\n${shownCalls(box)}`);
      assert.ok(typeof load.label === 'string' && load.label !== '' && load.label !== INSTALLED, `${task.id}: its run loads under a label of its own, never ${INSTALLED}: it loaded ${JSON.stringify(load.label)}\n${shownCalls(box)}`);
    }
    const first = readPlist(handed(box, loads[0]));
    assert.ok(first.ok, `${task.id}: the definition its run loads first is no property list launchd reads: ${first.said}`);
    heldToTheBuilds(task, first.value, built.value);

    // The installed hub's label is never touched: no call but a read names it or its definition, and the file is as it was.
    const touching = all.filter(({ argv }) => !READS.includes(argv[0]) && argv.some((arg) => arg === INSTALLED || arg.endsWith(`/${INSTALLED}`) || arg.endsWith(`/${INSTALLED}.plist`)));
    assert.deepEqual(touching.map((call) => shownCall(call, box)), [], `${task.id}: its run touched ${INSTALLED}, the installed hub's label`);
    assert.ok(readFileSync(box.plist).equals(installed), `${task.id}: its run rewrote ~/Library/LaunchAgents/${INSTALLED}.plist, the installed hub's definition`);

    // Its hub never answered: the label is removed all the same, and nothing unread passes.
    assert.deepEqual(loaded(box), [], `${task.id}: its run ended with its label still loaded; a job left in launchd outlives the run that loaded it\n${shownCalls(box)}`);
    // A run that ends in an error is BLOCKED to the window, which then judges no report of it; one that reports is judged.
    if (ran.status === 0) {
      const verdict = verdictOf(task, ran, 'whose hub never answered');
      assert.notEqual(verdict.status, 'PASS', `${task.id}: a run whose hub never answered read nothing, and never reads PASS; its judge said ${said(verdict)}`);
    }
  }
  t.skip(windowReads(criterion, tasks));
}

test('#3438.e9cc07fb each task loads the build\'s own definition into the user\'s launchd domain under a label of its own, never touches com.deepbuild.hub, and removes its label when its hub never answers, without a PASS', { timeout: 3_600_000 }, (t) => loadsTheBuildsDefinition(t, C2));

test('#3438.65e37fd0 each task loads the build\'s own definition into the user\'s launchd domain under a label of its own first, never touches com.deepbuild.hub, and removes its label when its hub never answers, without a PASS', { timeout: 3_600_000 }, (t) => loadsTheBuildsDefinition(t, C3));

test('#3438.e9cc07fb a planted run that starts a child and reports it as launchd\'s fails, naming the hub\'s parent process', { timeout: 1_800_000 }, (t) => {
  const tasks = launchdTasks(C2);
  if (!MAC) return t.skip(offMac('a run that starts a hub and reads its parent process'));
  needsBuilds({ hook: true });
  const task = holder(tasks, 'round_trip_p50_ratio');
  const box = sandbox(t);
  answering(box, 'accept');
  const ran = runTask(box, task, { env: { DEEP_HUB_PLANT: 'child-as-launchd' } });
  const hub = ran.report?.hub;
  // A hub that left the run's process group is stopped here by its PID; one inside it went with the group.
  if (Number.isInteger(hub?.pid) && hub.pid > 1) stopLeftHub(hub.pid);
  const verdict = verdictOf(task, ran, 'with DEEP_HUB_PLANT=child-as-launchd');
  assert.ok(hub && Number.isInteger(hub.pid) && Number.isInteger(hub.ppid) && typeof hub.parent === 'string' && hub.parent !== '', `${task.id}: the planted run's report names its hub and the hub's parent process, {pid, ppid, parent}, as the OS gave them: ${JSON.stringify(hub)}`);
  assert.ok(typeof hub.label === 'string' && hub.label !== '' && hub.label !== INSTALLED, `${task.id}: the planted run reports its child as launchd's, under the label a run loads: ${JSON.stringify(hub.label)}`);
  assert.equal(hub.ppid, ran.pid, `${task.id}: the planted run starts the hub as its own child, so the hub's parent is the run, process ${ran.pid}; its report names process ${hub.ppid} (${hub.parent})`);
  assert.equal(verdict.status, 'FAIL', `${task.id}: a run that starts a child and reports it as launchd's fails; its judge said ${said(verdict)}`);
  const named = typeof verdict.reason === 'string' && (new RegExp(`(?<!\\d)${hub.ppid}(?!\\d)`).test(verdict.reason) || verdict.reason.includes(hub.parent));
  assert.ok(named, `${task.id}: the failure names the hub's parent process, ${hub.ppid} or ${hub.parent}: ${said(verdict)}`);
  t.skip(windowReads(C2, tasks));
});
