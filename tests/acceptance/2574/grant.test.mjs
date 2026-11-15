// #2574 AC2 (as amended 2026-11-15: the grant waits 30 minutes): a run queues once, before it starts anything.
// `node scripts/affected.mjs <paths>` is run as a process in a scratch tree holding this checkout's scripts/ (README:
// The affected.mjs tree), with the real throttle.mjs (in one test behind a shim of #1115's kind) and a temporary HOME,
// and read by what its jobs noted and by the throttle's log, $HOME/.deepbuild/throttle/log.
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import test from 'node:test';
import { affected, affectedTree, CRATE_SOURCE, dump, events, holdEverySlot, jobs, logLines, oneGrant, PACKAGE_SOURCE, probe, probePaths, sandbox, summary, TEST_SLOTS, throttleCalls, until, within } from './helpers.mjs';

const PATHS = probePaths();
const named = (box, name, event = 'start') => events(box).filter((e) => e.name === name && e.event === event);
const titles = (noted) => noted.map((e) => `${e.name} ${e.args?.join(' ') ?? ''}`.trim());

/** Every job the run noted started inside the grant, and every event of an untimed one came before its release. */
function inside(box, { grantedAt, releasedAt }, all, untimed = () => true) {
  const noted = jobs(box);
  const early = noted.filter((e) => e.t < grantedAt);
  assert.deepEqual(titles(early), [], `${early.length} job events came before the run's grant\n${all}`);
  const late = noted.filter(untimed).filter((e) => e.t > releasedAt);
  assert.deepEqual(titles(late), [], `${late.length} events of untimed jobs came after the run's grant was released\n${all}`);
}

/** A run of the build, cargo test, the lints, a node --test block and `groups` alone groups: one grant, around all. */
async function wholeRun(t, groups, env = {}) {
  const box = sandbox(t);
  const alone = PATHS.alone.slice(0, groups);
  const tree = affectedTree(box, { [PATHS.plain]: probe('plain'), ...Object.fromEntries(alone.map((path, n) => [path, probe(`alone-${n}`)])) });
  const child = affected(box, tree, [PACKAGE_SOURCE, CRATE_SOURCE, PATHS.plain, ...alone], env);
  const run = await within(child, 120_000);
  const all = dump(box, run ?? { status: 'none: still running after 120 s', ...child.out });
  assert.ok(run, `affected.mjs did not end\n${all}`);
  // The fixture is sound only if every kind of job ran: the build, cargo test and clippy, a lint script, and each probe.
  assert.equal(named(box, 'npm').length, 1, `npm run build --workspaces did not run once\n${all}`);
  for (const sub of ['test', 'clippy']) assert.equal(named(box, 'cargo').filter((e) => e.args[0] === sub).length, 1, `cargo ${sub} did not run once\n${all}`);
  assert.ok(named(box, 'lint').length >= 1, `no lint script ran\n${all}`);
  for (const name of ['plain', ...alone.map((_, n) => `alone-${n}`)]) assert.equal(named(box, name, 'end').length, 1, `the ${name} probe did not run once\n${all}`);
  const grant = oneGrant(box, all);
  inside(box, grant, all);
  // The untimed jobs that ask today, the build, cargo test, the node --test block and each alone group, ran under it.
  for (const e of [...named(box, 'npm'), ...named(box, 'cargo').filter((e) => e.args[0] === 'test'), ...named(box, 'plain'), ...alone.flatMap((_, n) => named(box, `alone-${n}`))]) {
    assert.equal(e.throttle, grant.token, `${titles([e])[0]} ran with DEEP_THROTTLE=${e.throttle}, not under the run's grant ${grant.token}\n${all}`);
  }
  assert.match(summary(run.stdout), /^PASS affected: /, `with every job passing, the summary is not PASS\n${all}`);
  assert.equal(run.status, 0, all);
  return { box, run, grant, all };
}

test('#2574 AC2 the throttle log shows one top-level test grant for a run, logged with a wait of 30 min, held from before its first job until its last untimed job ended, a passed event for the jobs that ask, and no build request', async (t) => {
  const { grant, all } = await wholeRun(t, 1);
  // The run waits 30 minutes for its grant, as #1113 has every affected.mjs grant wait and the log's line of it says.
  assert.equal(grant.grant.wait, 30, `the run asked for its grant with a wait of ${grant.grant.wait} min, not 30\n${all}`);
});

test('#2574 AC2 with two alone groups and two shards wanted, the run still holds one top-level test grant around every job', async (t) => {
  await wholeRun(t, 2, { DEEP_SHARDS: '2' });
});

/** Lets a run that waits show it: 3 s after it printed its selection, or 15 s when it prints nothing while it waits. */
async function settle(box, child) {
  const started = () => jobs(box).length > 0;
  if (await until(() => started() || /^parallel node: /m.test(child.out.stdout) || child.exitCode !== null, 15_000)) await until(() => started() || child.exitCode !== null, 3_000);
}

test('#2574 AC2 while every test slot is held by other live processes the run starts no job; it starts once a slot frees', async (t) => {
  const box = sandbox(t);
  const tree = affectedTree(box, { [PATHS.plain]: probe('plain') });
  const holders = await holdEverySlot(box);
  const child = affected(box, tree, [PACKAGE_SOURCE, PATHS.plain]);
  await settle(box, child);
  const waiting = dump(box, { status: child.exitCode ?? 'none: still running', ...child.out });
  assert.deepEqual(titles(jobs(box)), [], `with all ${TEST_SLOTS} test slots held by other processes, the run started a job\n${waiting}`);
  assert.equal(child.exitCode, null, `the run ended while every test slot was held\n${waiting}`);
  assert.ok(holders.every((holder) => holder.exitCode === null), `a holder ended early\n${waiting}`);

  // One holder is stopped, by its PID: the throttle passes the signal on to its command and gives the slot back.
  const freed = Date.now();
  process.kill(holders[0].pid, 'SIGTERM');
  const run = await within(child, 90_000);
  const all = dump(box, run ?? { status: 'none: still running 90 s after a slot freed', ...child.out });
  assert.ok(run, `the run did not go on once a slot freed\n${all}`);
  assert.equal(named(box, 'npm').length, 1, `the build did not run once the slot freed\n${all}`);
  assert.equal(named(box, 'plain', 'end').length, 1, `the node --test block did not run once the slot freed\n${all}`);
  const early = jobs(box).filter((e) => e.t < freed);
  assert.deepEqual(titles(early), [], `jobs started before the slot freed\n${all}`);
  const grant = oneGrant(box, all, { others: TEST_SLOTS });
  assert.ok(grant.grantedAt >= freed, `the run's grant was logged before a slot freed\n${all}`);
  assert.match(summary(run.stdout), /^PASS affected: /, all);
});

// The files a no-grant run is given: a plain probe and an alone one, each a file it would have run, and a package's
// source, so a run that starts anything before its grant starts the build.
const refusedFiles = () => [PATHS.plain, PATHS.alone[0]];
const refusedTree = (box, options) => affectedTree(box, { [PATHS.plain]: probe('plain'), [PATHS.alone[0]]: probe('alone-0') }, options);

/** A run that got no grant within `wait` minutes: its line, an INCONCLUSIVE line for each file, its summary, exit 2. */
function expectNoGrant(run, wait, all) {
  const lines = run.stdout.split('\n');
  const [, said] = run.stdout.match(/^INCONCLUSIVE no grant: no test grant came within (\S+) min\b/m) ?? [];
  assert.ok(said !== undefined, `the run printed no "INCONCLUSIVE no grant: no test grant came within <n> min" line\n${all}`);
  assert.equal(Number(said), wait, `the line names a wait of ${said} min, not ${wait}\n${all}`);
  for (const file of refusedFiles()) assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE') && line.includes(file)), `no INCONCLUSIVE line names ${file}, a file the run would have run\n${all}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `the run's summary does not start "INCONCLUSIVE affected: "\n${all}`);
  assert.equal(run.status, 2, `the run exited ${run.status}, not 2\n${all}`);
}

test('#2574 AC2 the run\'s grant is taken through scripts/throttle.mjs test --wait 30: with every slot held and that throttle\'s clock run fast, the run gives up at its wait, prints "INCONCLUSIVE no grant: no test grant came within 30 min", a line naming each file and its INCONCLUSIVE summary, exits 2 and has started no job', async (t) => {
  const box = sandbox(t);
  const tree = refusedTree(box, { shimThrottle: true });
  const holders = await holdEverySlot(box);
  const child = affected(box, tree, [PACKAGE_SOURCE, ...refusedFiles()]);
  // The shim runs a test request's wait as 1.2 s. A run that waits on a clock of its own is still waiting after 60 s.
  await until(() => child.exitCode !== null, 60_000);
  const run = child.exitCode === null ? null : await child.done;
  const all = dump(box, run ?? { status: 'none: still waiting after 60 s', ...child.out });
  const [first] = throttleCalls(box);
  const asked = first ? first.args.slice(0, Math.max(0, first.args.indexOf('--'))).join(' ') : '';
  assert.equal(asked, 'test --wait 30', `the run's first call of scripts/throttle.mjs was ${first ? `"${first.args.join(' ')}"` : 'none'}, not "test --wait 30 -- ..."\n${all}`);
  assert.deepEqual(titles(jobs(box)), [], `with all ${TEST_SLOTS} test slots held, the run started a job\n${all}`);
  assert.ok(run, `with the throttle's test wait run as 1.2 s the run was still waiting after 60 s: it does not wait through scripts/throttle.mjs test --wait\n${all}`);
  assert.ok(holders.every((holder) => holder.exitCode === null), `a holder ended, so a slot was free\n${all}`);
  expectNoGrant(run, 30, all);
});

test('#2574 AC2 DEEP_TEST_GRANT_WAIT sets the wait in minutes: with every slot held and 0.05, the run prints "INCONCLUSIVE no grant: no test grant came within 0.05 min", a line naming each file and its INCONCLUSIVE summary, exits 2 and has started no job', async (t) => {
  const box = sandbox(t);
  const tree = refusedTree(box);
  const holders = await holdEverySlot(box);
  const child = affected(box, tree, [PACKAGE_SOURCE, ...refusedFiles()], { DEEP_TEST_GRANT_WAIT: '0.05' });
  // 0.05 min is 3 s. A run that starts a job, or is still there after 60 s, has not timed out as the criterion says.
  await until(() => jobs(box).length > 0 || child.exitCode !== null, 60_000);
  const run = child.exitCode === null ? null : await child.done;
  const all = dump(box, run ?? { status: 'none: still running', ...child.out });
  assert.deepEqual(titles(jobs(box)), [], `with all ${TEST_SLOTS} test slots held and a wait of 0.05 min, the run started a job\n${all}`);
  assert.ok(run, `with a wait of 0.05 min the run was still waiting after 60 s\n${all}`);
  assert.ok(holders.every((holder) => holder.exitCode === null), `a holder ended, so a slot was free\n${all}`);
  expectNoGrant(run, 0.05, all);
  const timeouts = logLines(box).filter((line) => line.event === 'timeout');
  assert.deepEqual(timeouts.map((line) => line.class), ['test'], `the throttle log does not show the run's one test request timing out\n${all}`);
});

// A top-level timed grant waits for the one-minute load to fall below the cores (section 6), so on a machine already
// that loaded the timed block can't start: the test is skipped as INCONCLUSIVE, which is never a pass.
const loaded = loadavg()[0] >= cpus().length && `INCONCLUSIVE: the load ${loadavg()[0].toFixed(1)} is at or above the ${cpus().length} cores, so no top-level timed grant can start`;
test('#2574 AC2 the timed files still run after the run\'s grant is released, under a timed grant of their own', { skip: loaded }, async (t) => {
  const box = sandbox(t);
  const tree = affectedTree(box, { [PATHS.plain]: probe('plain'), [PATHS.timed]: probe('timed') });
  const child = affected(box, tree, ['--timed', PACKAGE_SOURCE, PATHS.plain, PATHS.timed]);
  const run = await within(child, 120_000);
  const all = dump(box, run ?? { status: 'none: still running after 120 s', ...child.out });
  assert.ok(run, `affected.mjs --timed did not end\n${all}`);
  const [start] = named(box, 'timed'), [end] = named(box, 'timed', 'end');
  assert.ok(start && end && named(box, 'timed').length === 1, `the timed file did not run once\n${all}`);
  assert.equal(named(box, 'plain', 'end').length, 1, `the untimed file did not run once\n${all}`);
  const grant = oneGrant(box, all);
  inside(box, grant, all, (e) => e.name !== 'timed');
  assert.ok(start.t >= grant.releasedAt, `the timed file started ${grant.releasedAt - start.t} ms before the run's test grant was released\n${all}`);
  const [, cls, id] = String(start.throttle).match(/^([a-z-]+):(\S+)$/) ?? [];
  assert.equal(cls, 'timed', `the timed file ran with DEEP_THROTTLE=${start.throttle}, not under a timed grant\n${all}`);
  const lines = logLines(box).filter((line) => line.id === id && line.class === 'timed');
  const granted = lines.find((line) => line.event === 'granted'), released = lines.find((line) => line.event === 'released');
  assert.ok(granted && granted.grant === 'top-level' && Date.parse(granted.at) <= start.t, `the log shows no top-level timed grant ${id} before the timed file started\n${all}`);
  assert.ok(released && Date.parse(released.at) >= end.t, `the log does not show timed grant ${id} released after the timed file ended\n${all}`);
  assert.match(summary(run.stdout), /^PASS affected: /, all);
});
