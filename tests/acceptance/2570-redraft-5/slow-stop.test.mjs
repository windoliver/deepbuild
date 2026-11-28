import { test } from 'node:test';
import { AC1, LONG, alive, assert, deepStart, ended, hello, hubPid, hubRuns, launchd, serviceCalls, shown, until, wait } from '../2570/helpers.mjs';
import { MAX_HELD_MS, QUIET_MS, exiting, finish, tail } from '../2570-redraft-ac1/scene.mjs';
import { sandbox, slowExitingHub } from './helpers.mjs';

const asks = (box) => launchd(box).filter((e) => e.event === 'ask');

async function startedBesideAnExitingHub(t, kind) {
  const box = sandbox(t, kind, 'slow');
  const { old, heldAt } = await slowExitingHub(box);
  const asksBefore = asks(box).length;
  const startsBefore = hubRuns(box).filter((e) => e.event === 'start-command').length;

  assert.ok(exiting(box, old), `the scene's own step: the old hub (pid ${old}) must still be exiting when the start is asked for`);
  const start = deepStart(box, ['hub', 'start', ...box.flags]);
  let over = false;
  void start.done.then(() => { over = true; });

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

  assert.ok(stillExiting, `${AC1} the stopped hub (pid ${old}) must be left to finish its own exit; it was gone before the test let it go`);
  assert.equal(code, 0, `${AC1} the stopped hub (pid ${old}) must end by its own exit, code 0, never by a signal. Its log: ${tail(box.hubLog)}`);
  if (kind === 'installed') {
    const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === old);
    assert.deepEqual({ code: exit?.code, signal: exit?.signal }, { code: 0, signal: null }, `${AC1} the service manager must see the old job end with exit 0`);
    assert.ok(launchd(box).some((e) => e.event === 'start' && e.pid === now), `${AC1} the installed hub answering afterwards (pid ${now}) must be the job the service manager started. ${asked.join('; ') || 'It was never asked'}`);
    assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
  } else {
    assert.equal(asks(box).length, asksBefore, `${AC1} deep hub start --root must not ask the service manager for a dev hub`);
    assert.deepEqual(serviceCalls(box), [], 'deep hub start --root must not call launchctl or systemctl');
  }
}

async function sceneAtItsLongest(t, kind) {
  const box = sandbox(t, kind, 'slow');
  const { old, heldAt } = await slowExitingHub(box);
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
