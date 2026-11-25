// #2570 criterion 1: `deep hub start` asked for while a stopped hub's process is still exiting ends with a hub
// answering, exit 0. The old hub is a real one, held at its exit by the test (README: The exiting window), once as a
// dev hub and once as the installed hub's job under the service manager's stand-in.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AC1, HOLD_MS, LONG, alive, assert, deepStart, ended, exitingHub, hello, hubPid, hubRuns, launchd, release, sandbox, serviceCalls, shown, until,
} from './helpers.mjs';

const tail = (file) => { try { return readFileSync(file, 'utf8').slice(-600); } catch { return '(none)'; } };

async function startedBesideAnExitingHub(t, kind) {
  const box = sandbox(t, kind);
  const old = await exitingHub(box);
  const asksBefore = launchd(box).filter((e) => e.event === 'ask').length;

  // The start under test, asked for while the old hub's process is still exiting.
  const start = deepStart(box, ['hub', 'start', ...box.flags]);
  let over = false;
  void start.done.then(() => { over = true; });
  // The old hub stays as it is until the start has acted beside it: it asked the service manager, a hub it started
  // has ended, or the command itself has ended. A start that asks nothing meanwhile is given HOLD_MS.
  const acted = () => over
    || launchd(box).filter((e) => e.event === 'ask').length > asksBefore
    || hubRuns(box).some((e) => e.event === 'exit' && e.pid !== old);
  const sawItAct = Boolean(await until(acted, HOLD_MS));
  const stillExiting = alive(old) && !hubRuns(box).some((e) => e.event === 'exit' && e.pid === old);
  t.diagnostic(sawItAct ? 'the old hub was let go once the start had acted beside it' : `the old hub was let go after ${HOLD_MS} ms in which the start asked nothing`);

  // Now the old hub finishes its own exit.
  assert.ok(release(box), "the scene's own step: the held hub didn't take the word to go on");
  assert.ok(await until(() => !alive(old), 60_000), `the scene's own step: the old hub (pid ${old}) didn't end within 60 s of being let go`);

  const run = await ended(start, 60_000);
  const answers = await hello(box);
  const asks = launchd(box).filter((e) => e.event === 'ask').slice(asksBefore).map((e) => `asked while the job ${e.running ? `ran (pid ${e.running})` : "wasn't running"}: did ${e.did}`);
  const seen = `${shown(run)}\n${kind === 'installed' ? `the service manager: ${asks.join('; ') || 'never asked'}\n` : ''}hub.log: ${tail(box.log)}`;
  assert.ok(run.status === 0 && !run.stopped, `${AC1} deep hub start, asked for while the stopped hub (pid ${old}) was still exiting, must end with exit 0; ${answers ? 'a hub answers' : 'no hub answers'} on unix:${box.socket} afterwards. ${seen}`);
  assert.ok(answers, `${AC1} deep hub start exited 0, and no hub answers on unix:${box.socket}. ${seen}`);
  const now = await hubPid(box);
  assert.ok(Number.isSafeInteger(now) && now !== old, `${AC1} the hub answering afterwards must be a new one, not the stopped hub (pid ${old}): deep hub status names pid ${now}`);

  // The old hub ended by itself, as a stop ends it: never stopped by the start.
  assert.ok(stillExiting, `${AC1} the stopped hub (pid ${old}) must be left to finish its own exit; it was gone before the test let it go`);
  assert.deepEqual(hubRuns(box).filter((e) => e.event === 'exit' && e.pid === old).map((e) => e.code), [0], `${AC1} the stopped hub (pid ${old}) must end by its own exit, code 0, never by a signal`);
  if (kind === 'installed') {
    const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === old);
    assert.deepEqual({ code: exit?.code, signal: exit?.signal }, { code: 0, signal: null }, `${AC1} the service manager must see the old job end with exit 0`);
    assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
  }
}

test(`${AC1} a dev hub: deep hub start --root, asked for while the stopped hub's process is still exiting, ends with a hub answering, exit 0`, LONG, (t) => startedBesideAnExitingHub(t, 'dev'));

test(`${AC1} the installed hub: deep hub start, asked for while the stopped job is still exiting under the service manager, ends with a hub answering, exit 0`, LONG, (t) => startedBesideAnExitingHub(t, 'installed'));
