// #2570's third criterion, #2570.1d553870 (README.md): #1334's crash case, as redrafted under #2565, reaches "one
// notice, never twice" after its restart. The scene is that redraft's own, `rollbackScene(…, 'crash')` from
// `../1334-redraft-2565/helpers.mjs`, run unchanged. Its own restart (`hub.stop` on the socket with the token alone,
// then `deep hub start`) no longer stops the installed hub on this base: since #1865 the hub refuses a stop that names
// no process for the OS to confirm (README: Why a restart of its own). So after the scene this file restarts the hub
// the way the scene means to, through surfaces the sandbox reaches: `deep hub stop`, confirmed by a stand-in for the
// OS prompt, then `deep hub start` asked for at once, and the record read again.
import { after, before, test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLI, LONG, NODE, assert, call, deep, events, hello, launch, launchd, loadReading, rollbackScene, rollbacks, serviceFile, sha7, shown, told, until, wait,
} from '../1334-redraft-2565/helpers.mjs';

const ID = '#2570.1d553870';
let scene;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });

/**
 * The OS prompt's stand-in, for the hub the login service runs: the hub's `DEEP_HUB_TEST_CONFIRM` names an executable
 * whose exit 0 is you confirming. The launchd stand-in passes a job only its definition's environment, so the variable
 * goes into the definition the base wrote, and the hub is restarted once (`hub.restart`, the token's own restart, which
 * the login service starts again) so the running hub reads it.
 */
function confirmable(o) {
  const stub = join(o.box.dir, 'confirm');
  writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);
  const file = serviceFile(o.box);
  const text = readFileSync(file, 'utf8');
  const edited = /<plist/.test(text)
    ? text.replace(/(<key>EnvironmentVariables<\/key>\s*<dict>)/, `$1\n    <key>DEEP_HUB_TEST_CONFIRM</key>\n    <string>${stub}</string>`)
    : text.replace(/^(Environment=.*)$/m, `$1 "DEEP_HUB_TEST_CONFIRM=${stub}"`);
  writeFileSync(file, edited);
  return edited !== text;
}

/**
 * `deep hub stop` as you run it from your terminal: not as a child of this test process, which the scene's session names
 * as its agent (a command inside an agent's process tree is refused). An outer shell starts it in the background and
 * exits, so its parent is no longer this process when the hub reads whose it is.
 */
async function stopFromTerminal(o) {
  const out = join(o.box.dir, 'stop.out'), code = join(o.box.dir, 'stop.code');
  await launch(o.box, ['/bin/sh', '-c', '("$0" "$1" hub stop > "$2" 2>&1; echo $? > "$3") &', NODE, CLI, out, code], { cwd: o.fx.mac }).done;
  await until(() => existsSync(code) && readFileSync(code, 'utf8').trim() !== '', 120_000, 100);
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : undefined);
  return { status: read(code) === undefined ? null : Number(read(code)), output: read(out) };
}

before(async () => {
  const o = scene = await rollbackScene({ after: (cleanup) => cleanups.push(cleanup) }, 'crash');
  if (!o.afterRestart) return;
  // The hub that answered when the scene's restart was over, and whether the scene's restart restarted it.
  o.sceneHub = o.restarted?.start;
  o.lastPollHub = o.polls.at(-1)?.hello?.start;
  // Our restart: a hub that reads the prompt's stand-in, then the stop, then the start at once.
  o.edited = confirmable(o);
  try { o.restartCall = await call(o.box, 'hub.restart'); } catch (error) { o.restartCall = { error: String(error) }; }
  o.confirmableHub = await until(async () => { const h = await hello(o.box, 1000); return h && h.start !== o.sceneHub ? h : undefined; }, 120_000, 500);
  if (!o.confirmableHub) return;
  o.stop = await stopFromTerminal(o);
  o.stopQuiet = !(await hello(o.box, 500));
  o.start = await deep(o.box, ['hub', 'start'], { cwd: o.fx.mac });
  o.back = await until(() => hello(o.box, 1000), 120_000, 500);
  if (o.back) {
    await wait(3000);
    o.final = await events(o.box).catch(() => undefined);
  }
}, LONG);

test(`${ID} #1334's crash case reaches "one notice, never twice" after its restart (its redraft under #2565)`, LONG, (t) => {
  const o = scene;
  const { fx } = o;
  const stand = () => `launchd stand-in (event, code, ms): ${launchd(o.box).map((e) => `${e.event}${e.code !== undefined ? ` ${e.code}` : ''} ${e.t}`).join('; ')}`;
  // The crash case happened: the good build of c1 was promoted, the crash build of c2 ran, and the good one came back.
  assert.ok(o.first?.status === 0 && o.firstHello, `${ID} the scene never reached its rollback: the first promotion, of the good build of ${sha7(fx.c1)}, left no hub answering\n${shown(o.first)}`);
  assert.ok(o.plantedAt, `${ID} the scene never reached its rollback: the planted crash build of ${sha7(o.c2)} never ran\n${told(o)}`);
  assert.ok(o.backAt, `${ID} the scene never reached its restart: the last good build (${sha7(fx.c1)}) never answered again after the crash build ran\n${told(o)}`);
  assert.equal(o.current?.commit, fx.c1, `${ID} versions/current must name the last good build after the rollback\n${told(o)}`);
  // One notice before the restart, naming the promoted commit.
  assert.ok(o.after, `${ID} the record couldn't be read after the rollback, before the restart\n${told(o)}`);
  const before = rollbacks(o.after);
  assert.equal(before.length, 1, `${ID} one notice of the rollback before the restart, a build.rolled_back naming ${sha7(o.c2)}; there are ${before.length}: ${JSON.stringify(before.map((e) => e.data))}\n${told(o)}`);
  const named = before[0].data?.commit;
  assert.ok(typeof named === 'string' && named.length >= 7 && o.c2.startsWith(named), `${ID} the notice must name the promoted commit ${o.c2} in data.commit, not ${JSON.stringify(before[0].data)}`);
  // The scene's own restart: a hub answers after it (whether or not it was a new one; see the diagnostic).
  assert.ok(o.restarted && o.afterRestart, `${ID} after the scene's restart no hub answered: ${shown(o.restart)}\n${told(o)}`);
  assert.equal(rollbacks(o.afterRestart).length, 1, `${ID} one notice, never twice: after the scene's restart the record holds ${rollbacks(o.afterRestart).length} build.rolled_back events`);
  t.diagnostic(`the scene's restart ${o.sceneHub === o.lastPollHub ? 'left the same hub running (its hub.stop was refused)' : 'started a new hub'}; deep hub start: ${o.restart?.stdout.trim()}`);
  // Our restart's setup: the hub reads the prompt's stand-in and `deep hub stop` is confirmed. Not the criterion: the
  // sandbox's reach, so a failure here is BLOCKED, never a pass.
  assert.ok(o.edited, `BLOCKED: ${ID} the login service's definition at ${serviceFile(o.box)} has no environment to add the prompt's stand-in to`);
  assert.ok(o.confirmableHub, `BLOCKED: ${ID} hub.restart (${JSON.stringify(o.restartCall)}) brought no new hub up within 120 s, so no stop could be confirmed\n${stand()}`);
  assert.ok(o.stop?.status === 0 && o.stopQuiet, `BLOCKED: ${ID} deep hub stop, run from outside the session's process tree with the OS prompt's stand-in confirming, didn't stop the hub: exit ${o.stop?.status}, ${o.stopQuiet ? 'socket quiet' : 'a hub still answers'}\n${o.stop?.output}`);
  // The restart: `deep hub start`, asked for right after the stop, exits 0 and a new hub answers.
  assert.equal(o.start?.status, 0, `${ID} deep hub start, asked for right after deep hub stop, must end with a hub answering, exit 0; it gave ${shown(o.start)}\n${stand()}`);
  assert.ok(o.back, `${ID} deep hub start exited 0 but no hub answered at the socket within 120 s\n${stand()}`);
  assert.notEqual(o.back.start, o.confirmableHub.start, `${ID} the hub answering after the restart is the one that was stopped (start ${o.back.start})`);
  assert.ok(o.final, `${ID} the record couldn't be read after the restart`);
  // Never twice: the same one notice after the restarts, and no other.
  const again = rollbacks(o.final);
  assert.deepEqual(again.map((e) => ({ id: e.id, commit: e.data?.commit })), before.map((e) => ({ id: e.id, commit: e.data?.commit })),
    `${ID} one notice, never twice: after the hub's restarts the record must hold the one build.rolled_back it held before; it holds ${again.length}: ${JSON.stringify(again.map((e) => ({ id: e.id, data: e.data })))}`);
  t.diagnostic(`the good build answered ${((o.backAt - o.plantedAt) / 1000).toFixed(1)} s after the crash build first ran; deep hub start after the stop took ${o.start.ended - o.start.started} ms; ${loadReading()}`);
});
