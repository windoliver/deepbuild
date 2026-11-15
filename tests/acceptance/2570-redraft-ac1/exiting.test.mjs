// #2570 criterion 1, redrafted: `deep hub start` asked for while a stopped hub's process is still exiting ends with
// a hub answering, exit 0. The old hub is a real one whose core is slow to stop (REDRAFT.md), once as a dev hub and
// once as the installed hub's job under the service manager's stand-in. The two `scene:` tests have no start under
// test: they show the scene itself is valid at its longest hold, and pass at the base.
import { test } from 'node:test';
import {
  AC1, LONG, MAX_HELD_MS, QUIET_MS, alive, assert, deepStart, ended, exiting, exitingHub, finish, hello, hubPid, hubRuns, launchd, sandbox, serviceCalls, shown,
  tail, until, wait,
} from './scene.mjs';

const asks = (box) => launchd(box).filter((e) => e.event === 'ask');

async function startedBesideAnExitingHub(t, kind) {
  const box = sandbox(t, kind);
  const { old, heldAt } = await exitingHub(box);
  const asksBefore = asks(box).length;
  const startsBefore = hubRuns(box).filter((e) => e.event === 'start-command').length;

  // The start under test, asked for while the old hub's process is provably still exiting.
  assert.ok(exiting(box, old), `the scene's own step: the old hub (pid ${old}) must still be exiting when the start is asked for`);
  const start = deepStart(box, ['hub', 'start', ...box.flags]);
  let over = false;
  void start.done.then(() => { over = true; });

  // The old hub stays as it is until the start has acted beside it: it asked the service manager, a hub it started
  // has ended, or the command itself has ended. A start that does none of these is waiting for the old hub; it gets
  // QUIET_MS from the moment its process runs, and the old hub is never held past MAX_HELD_MS.
  const acted = () => (over ? 'the command ended'
    : asks(box).length > asksBefore ? 'it asked the service manager'
      : hubRuns(box).some((e) => e.event === 'exit' && e.pid !== old) ? 'a hub it started ended' : undefined);
  const running = () => hubRuns(box).filter((e) => e.event === 'start-command')[startsBefore]?.t;
  let why;
  for (;;) {
    why = acted();
    if (why) break;
    const since = running();
    if (since !== undefined && Date.now() >= since + QUIET_MS) break;
    if (Date.now() >= heldAt + MAX_HELD_MS) break;
    await wait(10);
  }
  const quiet = why === undefined && running() !== undefined && Date.now() >= running() + QUIET_MS;
  const stillExiting = exiting(box, old);
  const { heldMs, code } = await finish(box, old, heldAt);
  t.diagnostic(`the old hub was held ${heldMs} ms and let go ${why ? `once the start had acted beside it (${why})` : `after ${QUIET_MS} ms in which the running start did nothing visible`}`);
  assert.ok(why || quiet, `the scene's own step: this machine was too slow for the scene: the old hub reached its longest hold (${MAX_HELD_MS} ms) before the start had run ${QUIET_MS} ms beside it`);

  const run = await ended(start, 60_000);
  const answers = await hello(box);
  const asked = asks(box).slice(asksBefore).map((e) => `asked while the job ${e.running ? `ran (pid ${e.running})` : "wasn't running"}: did ${e.did}`);
  const seen = `${shown(run)}\n${kind === 'installed' ? `the service manager: ${asked.join('; ') || 'never asked'}\n` : ''}the old hub's log: ${tail(box.hubLog)}`;
  assert.ok(run.status === 0 && !run.stopped, `${AC1} deep hub start, asked for while the stopped hub (pid ${old}) was still exiting, must end with exit 0; ${answers ? 'a hub answers' : 'no hub answers'} on unix:${box.socket} afterwards. ${seen}`);
  assert.ok(answers, `${AC1} deep hub start exited 0, and no hub answers on unix:${box.socket}. ${seen}`);
  const now = await hubPid(box);
  assert.ok(Number.isSafeInteger(now) && now !== old, `${AC1} the hub answering afterwards must be a new one, not the stopped hub (pid ${old}): deep hub status names pid ${now}`);
  assert.ok(alive(now) && hubRuns(box).some((e) => e.event === 'run' && e.pid === now), `${AC1} the hub answering afterwards (pid ${now}) must be a running hub this root's start started`);

  // The old hub ended by itself, as a stop ends it: never stopped by the start.
  assert.ok(stillExiting, `${AC1} the stopped hub (pid ${old}) must be left to finish its own exit; it was gone before the test let it go`);
  assert.equal(code, 0, `${AC1} the stopped hub (pid ${old}) must end by its own exit, code 0, never by a signal. Its log: ${tail(box.hubLog)}`);
  if (kind === 'installed') {
    const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === old);
    assert.deepEqual({ code: exit?.code, signal: exit?.signal }, { code: 0, signal: null }, `${AC1} the service manager must see the old job end with exit 0`);
    // The installed hub is the login service's job, never a child of the command that asked for it (How it installs).
    assert.ok(launchd(box).some((e) => e.event === 'start' && e.pid === now), `${AC1} the installed hub answering afterwards (pid ${now}) must be the job the service manager started. ${asked.join('; ') || 'It was never asked'}`);
    assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
  } else {
    // A dev hub is started by the command itself, as today: the service manager is never asked for it.
    assert.equal(asks(box).length, asksBefore, `${AC1} deep hub start --root must not ask the service manager for a dev hub`);
    assert.deepEqual(serviceCalls(box), [], 'deep hub start --root must not call launchctl or systemctl');
  }
}

// No start under test: the old hub is kept exiting for the scene's longest hold, then let go, and must end as the
// tests above require of it. This is what makes a failure above the start's, never the scene's.
async function sceneAtItsLongest(t, kind) {
  const box = sandbox(t, kind);
  const { old, heldAt } = await exitingHub(box);
  const startsBefore = hubRuns(box).filter((e) => e.event === 'start-command').length;
  await until(() => !exiting(box, old), Math.max(0, heldAt + MAX_HELD_MS - Date.now()), 50);
  assert.ok(exiting(box, old), `scene: the stopped hub (pid ${old}) must still be exiting after ${MAX_HELD_MS} ms held. Its log: ${tail(box.hubLog)}`);
  assert.equal(await hello(box), undefined, 'scene: the held hub must not answer on its socket');
  const { heldMs, code } = await finish(box, old, heldAt);
  t.diagnostic(`the old hub was held ${heldMs} ms, with no start asked for, and ended with its own exit ${code}`);
  assert.equal(code, 0, `scene: a hub held ${heldMs} ms and let go must end by its own exit, code 0. Its log: ${tail(box.hubLog)}`);
  if (kind === 'installed') {
    const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === old);
    assert.deepEqual({ code: exit?.code, signal: exit?.signal }, { code: 0, signal: null }, 'scene: the service manager must see the old job end with exit 0');
    assert.deepEqual(launchd(box).filter((e) => e.event === 'start').length, 1, 'scene: a job that exits 0 stays stopped');
  }
  assert.equal(hubRuns(box).filter((e) => e.event === 'start-command').length, startsBefore, 'scene: no start may have been asked for');
  assert.equal(await hello(box), undefined, 'scene: no hub answers afterwards');
}

test(`${AC1} a dev hub: deep hub start --root, asked for while the stopped hub's process is still exiting, ends with a hub answering, exit 0`, LONG, (t) => startedBesideAnExitingHub(t, 'dev'));

test(`${AC1} the installed hub: deep hub start, asked for while the stopped job is still exiting under the service manager, ends with a hub answering, exit 0`, LONG, (t) => startedBesideAnExitingHub(t, 'installed'));

test(`scene: a dev hub kept exiting for the scene's longest hold, with no start asked for, ends by its own exit 0`, LONG, (t) => sceneAtItsLongest(t, 'dev'));

test(`scene: the installed hub's job kept exiting for the scene's longest hold, with no start asked for, ends by its own exit 0`, LONG, (t) => sceneAtItsLongest(t, 'installed'));
