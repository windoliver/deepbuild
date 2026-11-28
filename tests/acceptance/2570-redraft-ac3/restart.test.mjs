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

const STOP_MS = 120_000;
async function stopFromTerminal(o) {
  const out = join(o.box.dir, 'stop.out'), code = join(o.box.dir, 'stop.code');
  const shell = launch(o.box, ['/bin/sh', '-c', '("$0" "$1" hub stop > "$2" 2>&1; echo $? > "$3") < /dev/null > /dev/null 2>&1 &', NODE, CLI, out, code], { cwd: o.fx.mac });
  const group = shell.pid;
  const stopGroup = () => { try { process.kill(-group, 'SIGKILL'); } catch { } };
  cleanups.unshift(stopGroup);
  await Promise.race([shell.done, wait(10_000)]);
  const ended = await until(() => existsSync(code) && readFileSync(code, 'utf8').trim() !== '', STOP_MS, 100);
  if (!ended) stopGroup();
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : undefined);
  return { status: ended ? Number(read(code)) : null, output: ended ? read(out) : `no exit within ${STOP_MS / 1000} s; stopped by its process group\n${read(out) ?? ''}` };
}

before(async () => {
  const o = scene = await rollbackScene({ after: (cleanup) => cleanups.push(cleanup) }, 'crash');
  if (!o.afterRestart) return;
  o.sceneHub = o.restarted?.start;
  o.lastPollHub = o.polls.at(-1)?.hello?.start;
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
  assert.ok(o.first?.status === 0 && o.firstHello, `${ID} the scene never reached its rollback: the first promotion, of the good build of ${sha7(fx.c1)}, left no hub answering\n${shown(o.first)}`);
  assert.ok(o.plantedAt, `${ID} the scene never reached its rollback: the planted crash build of ${sha7(o.c2)} never ran\n${told(o)}`);
  assert.ok(o.backAt, `${ID} the scene never reached its restart: the last good build (${sha7(fx.c1)}) never answered again after the crash build ran\n${told(o)}`);
  assert.equal(o.current?.commit, fx.c1, `${ID} versions/current must name the last good build after the rollback\n${told(o)}`);
  assert.ok(o.after, `${ID} the record couldn't be read after the rollback, before the restart\n${told(o)}`);
  const before = rollbacks(o.after);
  assert.equal(before.length, 1, `${ID} one notice of the rollback before the restart, a build.rolled_back naming ${sha7(o.c2)}; there are ${before.length}: ${JSON.stringify(before.map((e) => e.data))}\n${told(o)}`);
  const named = before[0].data?.commit;
  assert.ok(typeof named === 'string' && named.length >= 7 && o.c2.startsWith(named), `${ID} the notice must name the promoted commit ${o.c2} in data.commit, not ${JSON.stringify(before[0].data)}`);
  assert.ok(o.restarted && o.afterRestart, `${ID} after the scene's restart no hub answered: ${shown(o.restart)}\n${told(o)}`);
  assert.equal(rollbacks(o.afterRestart).length, 1, `${ID} one notice, never twice: after the scene's restart the record holds ${rollbacks(o.afterRestart).length} build.rolled_back events`);
  t.diagnostic(`the scene's restart ${o.sceneHub === o.lastPollHub ? 'left the same hub running (its hub.stop was refused)' : 'started a new hub'}; deep hub start: ${o.restart?.stdout.trim()}`);
  assert.ok(o.edited, `BLOCKED: ${ID} the login service's definition at ${serviceFile(o.box)} has no environment to add the prompt's stand-in to`);
  assert.ok(o.confirmableHub, `BLOCKED: ${ID} hub.restart (${JSON.stringify(o.restartCall)}) brought no new hub up within 120 s, so no stop could be confirmed\n${stand()}`);
  assert.ok(o.stop?.status === 0 && o.stopQuiet, `BLOCKED: ${ID} deep hub stop, run from outside the session's process tree with the OS prompt's stand-in confirming, didn't stop the hub: exit ${o.stop?.status}, ${o.stopQuiet ? 'socket quiet' : 'a hub still answers'}\n${o.stop?.output}`);
  assert.equal(o.start?.status, 0, `${ID} deep hub start, asked for right after deep hub stop, must end with a hub answering, exit 0; it gave ${shown(o.start)}\n${stand()}`);
  assert.ok(o.back, `${ID} deep hub start exited 0 but no hub answered at the socket within 120 s\n${stand()}`);
  assert.notEqual(o.back.start, o.confirmableHub.start, `${ID} the hub answering after the restart is the one that was stopped (start ${o.back.start})`);
  assert.ok(o.final, `${ID} the record couldn't be read after the restart`);
  const again = rollbacks(o.final);
  assert.deepEqual(again.map((e) => ({ id: e.id, commit: e.data?.commit })), before.map((e) => ({ id: e.id, commit: e.data?.commit })),
    `${ID} one notice, never twice: after the hub's restarts the record must hold the one build.rolled_back it held before; it holds ${again.length}: ${JSON.stringify(again.map((e) => ({ id: e.id, data: e.data })))}`);
  t.diagnostic(`the good build answered ${((o.backAt - o.plantedAt) / 1000).toFixed(1)} s after the crash build first ran; deep hub start after the stop took ${o.start.ended - o.start.started} ms; ${loadReading()}`);
});
